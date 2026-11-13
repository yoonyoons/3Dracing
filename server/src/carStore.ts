import fs from 'node:fs/promises';
import path from 'node:path';
import type { CarStatus } from '@racing/shared';
import { config, useSupabase } from './config';
import { getSupabase } from './storage';

/** 차 한 대의 기록. 닉네임 말고는 학생 정보를 담지 않습니다. */
export interface CarRecord {
  id: string;
  roomCode: string;
  playerId: string;
  nickname: string;
  status: CarStatus;
  /** 배경을 지운 그림 (투명 PNG) */
  imageKey: string | null;
  /** 흰 배경 그림 (3D 변환 입력용) */
  cleanKey: string | null;
  glbKey: string | null;
  hidden: boolean;
  glbFlip: boolean;
  message: string | null;
  createdAt: number;
}

export interface CarStore {
  readonly kind: string;
  load(): Promise<CarRecord[]>;
  upsert(rec: CarRecord): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

class JsonCarStore implements CarStore {
  readonly kind = 'json';
  private file = path.join(config.dataDir, 'cars.json');
  private cache = new Map<string, CarRecord>();
  private writing: Promise<void> = Promise.resolve();
  async load(): Promise<CarRecord[]> {
    try {
      const list = JSON.parse(await fs.readFile(this.file, 'utf8')) as CarRecord[];
      for (const r of list) this.cache.set(r.id, r);
    } catch { /* 처음 실행 */ }
    return [...this.cache.values()];
  }
  private flush(): Promise<void> {
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify([...this.cache.values()]));
    }).catch((e) => console.error('cars.json 저장 실패', e));
    return this.writing;
  }
  async upsert(rec: CarRecord): Promise<void> {
    this.cache.set(rec.id, { ...rec });
    await this.flush();
  }
  async remove(ids: string[]): Promise<void> {
    for (const id of ids) this.cache.delete(id);
    await this.flush();
  }
}

class SupabaseCarStore implements CarStore {
  readonly kind = 'supabase';
  private toRow(r: CarRecord) {
    return {
      id: r.id, room_code: r.roomCode, player_id: r.playerId, nickname: r.nickname, status: r.status,
      image_key: r.imageKey, clean_key: r.cleanKey, glb_key: r.glbKey, hidden: r.hidden, glb_flip: r.glbFlip,
      message: r.message, created_at: new Date(r.createdAt).toISOString(),
    };
  }
  async load(): Promise<CarRecord[]> {
    const { data, error } = await getSupabase().from('cars').select('*');
    if (error) throw new Error(`Supabase cars 읽기 실패: ${error.message}`);
    return (data ?? []).map((d) => ({
      id: d.id, roomCode: d.room_code, playerId: d.player_id, nickname: d.nickname, status: d.status,
      imageKey: d.image_key, cleanKey: d.clean_key, glbKey: d.glb_key, hidden: d.hidden, glbFlip: d.glb_flip,
      message: d.message, createdAt: new Date(d.created_at).getTime(),
    }));
  }
  async upsert(rec: CarRecord): Promise<void> {
    const { error } = await getSupabase().from('cars').upsert(this.toRow(rec));
    if (error) console.error('Supabase cars 저장 실패:', error.message);
  }
  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await getSupabase().from('cars').delete().in('id', ids);
    if (error) console.error('Supabase cars 삭제 실패:', error.message);
  }
}

export function createCarStore(): CarStore {
  return useSupabase ? new SupabaseCarStore() : new JsonCarStore();
}
