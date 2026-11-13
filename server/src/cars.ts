import crypto from 'node:crypto';
import type { CarView } from '@racing/shared';
import type { CarRecord, CarStore } from './carStore';
import { config } from './config';
import { buildPrompt, type CarGenerator } from './generators';
import { normalizeCarGlb } from './glb';
import { processDrawing } from './image';
import { emptyCar, type Player, type Room, type RoomManager } from './rooms';
import type { FileStorage } from './storage';

const fileUrl = (key: string | null) => (key ? `/files/${key}` : null);

/** 그림 업로드 → 정리 → (3D 변환) → 후처리 → 방에 반영까지의 흐름을 맡습니다. */
export class CarService {
  records = new Map<string, CarRecord>();
  private progress = new Map<string, number>();
  private jobs = new Map<string, NodeJS.Timeout>();
  private colors = new Map<string, [number, number, number]>();

  constructor(
    private storage: FileStorage,
    private store: CarStore,
    readonly generator: CarGenerator,
    private rooms: RoomManager,
  ) {}

  async init(): Promise<void> {
    for (const r of await this.store.load()) {
      // 서버가 꺼지면서 끊긴 변환 작업은 실패로 정리합니다(그림 차체로 달릴 수 있음).
      if (r.status === 'processing') r.status = 'failed';
      this.records.set(r.id, r);
    }
    setInterval(() => this.sweep().catch((e) => console.error('자동 삭제 실패', e)), 30 * 60 * 1000).unref();
    await this.sweep();
  }

  byPlayer(roomCode: string, playerId: string): CarRecord | undefined {
    for (const r of this.records.values()) if (r.roomCode === roomCode && r.playerId === playerId) return r;
    return undefined;
  }

  view(rec: CarRecord): CarView {
    return {
      status: rec.status,
      imageUrl: rec.hidden ? null : fileUrl(rec.imageKey),
      glbUrl: rec.hidden ? null : fileUrl(rec.glbKey),
      progress: this.progress.get(rec.id) ?? (rec.status === 'ready' ? 1 : 0),
      hidden: rec.hidden,
      flip: rec.glbFlip,
      message: rec.message ?? undefined,
    };
  }

  /** 방에 있는 학생의 차 모습을 최신 기록으로 바꾸고 모두에게 알립니다. */
  private sync(rec: CarRecord | { roomCode: string; playerId: string }, removed = false): void {
    const room = this.rooms.get(rec.roomCode);
    const player = room?.players.get(rec.playerId);
    if (!room || !player) return;
    player.car = removed || !('id' in rec) ? emptyCar() : this.view(rec);
    room.broadcast();
  }

  private async save(rec: CarRecord): Promise<void> {
    this.records.set(rec.id, rec);
    await this.store.upsert(rec);
  }

  private keysOf(rec: CarRecord): string[] {
    return [rec.imageKey, rec.cleanKey, rec.glbKey].filter((k): k is string => !!k);
  }

  private stopJob(id: string): void {
    const t = this.jobs.get(id);
    if (t) clearInterval(t);
    this.jobs.delete(id);
    this.progress.delete(id);
  }

  /** 학생이 그림을 올렸을 때 */
  async upload(room: Room, player: Player, input: Buffer): Promise<CarView> {
    const processed = await processDrawing(input);
    let rec = this.byPlayer(room.code, player.id);
    const old = rec ? this.keysOf(rec) : [];
    if (rec) this.stopJob(rec.id);
    const id = rec?.id ?? crypto.randomBytes(9).toString('hex');
    const ver = crypto.randomBytes(3).toString('hex');
    const base = `cars/${room.code}/${id}`;
    const imageKey = `${base}/drawing-${ver}.png`;
    const cleanKey = `${base}/clean-${ver}.png`;
    await this.storage.put(imageKey, processed.cutout, 'image/png');
    await this.storage.put(cleanKey, processed.clean, 'image/png');
    rec = {
      id, roomCode: room.code, playerId: player.id, nickname: player.name, status: 'drawing',
      imageKey, cleanKey, glbKey: null, hidden: false, glbFlip: false,
      message: processed.backgroundRemoved ? null : '배경을 지우지 못해 그림 전체를 썼어요.',
      createdAt: Date.now(),
    };
    this.colors.set(id, processed.mainColor);
    await this.save(rec);
    await this.storage.remove(old).catch(() => {});
    this.sync(rec);
    if (this.generator.realtime) void this.startJob(rec, processed.clean);
    return this.view(rec);
  }

  /** A 모드: 서버가 변환기를 호출하고 끝날 때까지 상태를 확인합니다. */
  private async startJob(rec: CarRecord, cleanImage: Buffer): Promise<void> {
    const id = rec.id;
    const fail = async (msg: string) => {
      this.stopJob(id);
      const cur = this.records.get(id);
      if (!cur || cur.status !== 'processing') return;
      // Fallback: 실패해도 그림 차체로 바로 달릴 수 있습니다.
      cur.status = 'failed';
      cur.message = msg;
      await this.save(cur);
      this.sync(cur);
    };
    rec.status = 'processing';
    this.progress.set(id, 0.02);
    await this.save(rec);
    this.sync(rec);
    const version = rec.cleanKey;
    let jobId: string;
    try {
      ({ jobId } = await this.generator.submit({
        carId: id,
        image: cleanImage,
        imageUrl: config.publicUrl && rec.cleanKey ? `${config.publicUrl}/files/${rec.cleanKey}` : null,
        mainColor: this.colors.get(id) ?? [255, 90, 95],
        prompt: buildPrompt(),
      }));
    } catch (e) {
      console.error('3D 변환 제출 실패:', (e as Error).message);
      return fail('3D 변환을 시작하지 못했어요. 그림 차로 달려요!');
    }
    const started = Date.now();
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const cur = this.records.get(id);
        if (!cur || cur.cleanKey !== version) return this.stopJob(id);
        if (Date.now() - started > config.genTimeoutSec * 1000) {
          return await fail('3D 변환이 너무 오래 걸려요. 그림 차로 달려요!');
        }
        const state = await this.generator.poll(jobId);
        if (state.status === 'pending') {
          const p = Math.max(0.02, Math.min(0.95, state.progress));
          if (Math.abs(p - (this.progress.get(id) ?? 0)) >= 0.05) {
            this.progress.set(id, p);
            this.sync(cur);
          }
        } else if (state.status === 'failed') {
          console.error('3D 변환 실패:', state.error);
          await fail('3D 변환에 실패했어요. 그림 차로 달려요!');
        } else {
          this.stopJob(id);
          await this.attachGlb(id, state.glb);
        }
      } catch (e) {
        console.error('3D 변환 확인 중 오류:', (e as Error).message);
      } finally {
        busy = false;
      }
    }, 1500);
    this.jobs.set(id, timer);
  }

  /** GLB 를 후처리해서 차에 붙입니다. (A 모드 완료 시, B 모드에서 교사가 올릴 때) */
  async attachGlb(id: string, raw: Buffer): Promise<CarRecord> {
    const rec = this.records.get(id);
    if (!rec) throw new Error('차를 찾을 수 없어요.');
    const { glb, stats } = await normalizeCarGlb(raw);
    const cur = this.records.get(id);
    if (!cur) throw new Error('차가 삭제되었어요.');
    this.stopJob(id);
    const oldKey = cur.glbKey;
    const key = `cars/${cur.roomCode}/${cur.id}/model-${crypto.randomBytes(3).toString('hex')}.glb`;
    await this.storage.put(key, glb, 'model/gltf-binary');
    cur.glbKey = key;
    cur.status = 'ready';
    cur.message = null;
    await this.save(cur);
    if (oldKey) await this.storage.remove([oldKey]).catch(() => {});
    console.log(`GLB 준비: ${cur.nickname} · ${(stats.bytesIn / 1024).toFixed(0)}KB→${(stats.bytesOut / 1024).toFixed(0)}KB · 삼각형 ${stats.trianglesIn}→${stats.trianglesOut}`);
    this.sync(cur);
    return cur;
  }

  /** 앞뒤 바꾸기: 그림을 좌우로 뒤집고, 3D 모델은 반 바퀴 돌려 보여 줍니다. */
  async flip(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) return;
    if (rec.imageKey && rec.cleanKey) {
      const sharp = (await import('sharp')).default;
      const ver = crypto.randomBytes(3).toString('hex');
      const base = `cars/${rec.roomCode}/${rec.id}`;
      const pairs: [string, string][] = [[rec.imageKey, `${base}/drawing-${ver}.png`], [rec.cleanKey, `${base}/clean-${ver}.png`]];
      const made: string[] = [];
      for (const [from, to] of pairs) {
        const buf = await this.storage.get(from);
        if (!buf) continue;
        await this.storage.put(to, await sharp(buf).flop().png().toBuffer(), 'image/png');
        made.push(to);
      }
      if (made.length === 2) {
        const old = [rec.imageKey, rec.cleanKey];
        // 진행 중인 변환 작업은 그대로 이어지도록 cleanKey 는 작업이 없을 때만 바꿉니다.
        rec.imageKey = made[0];
        if (!this.jobs.has(rec.id)) { rec.cleanKey = made[1]; await this.storage.remove(old).catch(() => {}); }
        else { await this.storage.remove([old[0], made[1]]).catch(() => {}); }
      }
    }
    rec.glbFlip = !rec.glbFlip;
    await this.save(rec);
    this.sync(rec);
  }

  async setHidden(id: string, hidden: boolean): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.hidden = hidden;
    await this.save(rec);
    this.sync(rec);
  }

  async remove(ids: string[]): Promise<number> {
    const keys: string[] = [];
    const gone: CarRecord[] = [];
    for (const id of ids) {
      const rec = this.records.get(id);
      if (!rec) continue;
      this.stopJob(id);
      keys.push(...this.keysOf(rec));
      this.records.delete(id);
      this.colors.delete(id);
      gone.push(rec);
    }
    await this.storage.remove(keys).catch((e) => console.error('파일 삭제 실패', e));
    await this.store.remove(gone.map((r) => r.id));
    for (const rec of gone) this.sync(rec, true);
    return gone.length;
  }

  removeRoom(code: string): Promise<number> {
    return this.remove([...this.records.values()].filter((r) => r.roomCode === code).map((r) => r.id));
  }

  removeAll(): Promise<number> {
    return this.remove([...this.records.keys()]);
  }

  /** 보관 기간이 지난 그림·GLB 자동 삭제 */
  async sweep(): Promise<void> {
    const limit = Date.now() - config.retentionHours * 3600 * 1000;
    const old = [...this.records.values()].filter((r) => r.createdAt < limit).map((r) => r.id);
    if (old.length) {
      const n = await this.remove(old);
      console.log(`보관 기간(${config.retentionHours}시간)이 지난 차 ${n}대를 삭제했어요.`);
    }
  }

  getFile(key: string): Promise<Buffer | null> {
    return this.storage.get(key);
  }
}
