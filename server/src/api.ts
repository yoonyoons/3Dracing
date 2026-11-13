import crypto from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { CarService } from './cars';
import { config, useSupabase } from './config';
import type { RoomManager } from './rooms';

const MIME: Record<string, string> = { png: 'image/png', glb: 'model/gltf-binary', jpg: 'image/jpeg' };

function safeEqual(a: string, b: string): boolean {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

export function mountApi(app: Express, rooms: RoomManager, cars: CarService): void {
  const rawImage = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '8mb' });
  const rawGlb = express.raw({ type: ['model/gltf-binary', 'application/octet-stream'], limit: '40mb' });
  const lastUpload = new Map<string, number>();

  // ───── 학생 ─────
  const playerOf = (req: Request, res: Response) => {
    const room = rooms.get(req.params.code);
    const player = room?.players.get(String(req.header('x-player-id') ?? ''));
    if (!room || !player || !safeEqual(player.token, String(req.header('x-player-token') ?? ''))) {
      res.status(403).json({ error: '다시 입장해 주세요.' });
      return null;
    }
    return { room, player };
  };

  app.post('/api/rooms/:code/drawing', rawImage, wrap(async (req, res) => {
    const ctx = playerOf(req, res);
    if (!ctx) return;
    if (ctx.room.race?.racers.includes(ctx.player.id)) return res.status(409).json({ error: '레이스 중에는 바꿀 수 없어요.' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: '그림 파일을 다시 골라 주세요.' });
    const now = Date.now();
    if (now - (lastUpload.get(ctx.player.id) ?? 0) < 4000) return res.status(429).json({ error: '조금만 기다렸다가 다시 올려 주세요.' });
    lastUpload.set(ctx.player.id, now);
    try {
      res.json({ ok: true, car: await cars.upload(ctx.room, ctx.player, req.body) });
    } catch (e) {
      console.error('그림 처리 실패:', (e as Error).message);
      res.status(400).json({ error: '그림을 읽지 못했어요. 다른 사진으로 해 볼까요?' });
    }
  }));

  app.post('/api/rooms/:code/flip', wrap(async (req, res) => {
    const ctx = playerOf(req, res);
    if (!ctx) return;
    const rec = cars.byPlayer(ctx.room.code, ctx.player.id);
    if (rec) await cars.flip(rec.id);
    res.json({ ok: true });
  }));

  app.delete('/api/rooms/:code/drawing', wrap(async (req, res) => {
    const ctx = playerOf(req, res);
    if (!ctx) return;
    const rec = cars.byPlayer(ctx.room.code, ctx.player.id);
    if (rec) await cars.remove([rec.id]);
    res.json({ ok: true });
  }));

  // ───── 교사(방 주인): 대기실에서 바로 그림 숨기기 ─────
  app.post('/api/rooms/:code/hide/:playerId', express.json(), wrap(async (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room || !safeEqual(room.hostToken, String(req.header('x-host-token') ?? ''))) return res.status(403).json({ error: '권한이 없어요.' });
    const rec = cars.byPlayer(room.code, req.params.playerId);
    if (rec) await cars.setHidden(rec.id, !!req.body?.hidden);
    res.json({ ok: true });
  }));

  // ───── 파일 ─────
  // 주소에 추측할 수 없는 임의 문자열이 들어 있고, 저장소(로컬/Supabase 비공개 버킷)는 서버만 읽습니다.
  app.get('/files/*', wrap(async (req, res) => {
    const key = String((req.params as Record<string, string>)[0] ?? '');
    const ext = key.split('.').pop() ?? '';
    if (!/^cars\/\d{4}\/[a-f0-9]+\/[a-z]+-[a-f0-9]+\.(png|glb)$/.test(key)) return res.status(404).end();
    const buf = await cars.getFile(key);
    if (!buf) return res.status(404).end();
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(buf);
  }));

  // ───── 관리자 ─────
  const attempts = new Map<string, { n: number; at: number }>();
  const admin = (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? 'x';
    const a = attempts.get(ip);
    if (a && a.n >= 8 && Date.now() - a.at < 60_000) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
    if (!safeEqual(String(req.header('x-admin-password') ?? ''), config.adminPassword)) {
      attempts.set(ip, { n: (a && Date.now() - a.at < 60_000 ? a.n : 0) + 1, at: Date.now() });
      return res.status(401).json({ error: '비밀번호가 달라요.' });
    }
    attempts.delete(ip);
    next();
  };

  app.get('/api/admin/cars', admin, (_req, res) => {
    const list = [...cars.records.values()].sort((a, b) => b.createdAt - a.createdAt).map((r) => ({
      id: r.id, roomCode: r.roomCode, nickname: r.nickname, status: r.status, hidden: r.hidden, flip: r.glbFlip,
      message: r.message, createdAt: r.createdAt,
      imageUrl: r.imageKey ? `/files/${r.imageKey}` : null,
      cleanUrl: r.cleanKey ? `/files/${r.cleanKey}` : null,
      glbUrl: r.glbKey ? `/files/${r.glbKey}` : null,
      roomOpen: !!rooms.get(r.roomCode),
    }));
    res.json({
      cars: list,
      generator: cars.generator.name,
      realtime: cars.generator.realtime,
      storage: useSupabase ? 'supabase' : 'local',
      retentionHours: config.retentionHours,
      rooms: [...rooms.rooms.values()].map((r) => ({ code: r.code, players: r.players.size, phase: r.phase })),
    });
  });

  app.post('/api/admin/cars/:id/hide', admin, express.json(), wrap(async (req, res) => {
    await cars.setHidden(req.params.id, !!req.body?.hidden);
    res.json({ ok: true });
  }));

  app.post('/api/admin/cars/:id/flip', admin, wrap(async (req, res) => {
    await cars.flip(req.params.id);
    res.json({ ok: true });
  }));

  // B 모드: 교사가 미리 만든 GLB 를 학생 그림과 짝지어 올립니다.
  app.post('/api/admin/cars/:id/glb', admin, rawGlb, wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 20 || req.body.subarray(0, 4).toString('latin1') !== 'glTF') {
      return res.status(400).json({ error: 'GLB 파일(.glb)만 올릴 수 있어요.' });
    }
    try {
      await cars.attachGlb(req.params.id, req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: `GLB 를 처리하지 못했어요: ${(e as Error).message}` });
    }
  }));

  app.delete('/api/admin/cars/:id', admin, wrap(async (req, res) => {
    res.json({ ok: true, removed: await cars.remove([req.params.id]) });
  }));

  // 수업이 끝나면 한 번에 지우기 (room 을 주면 그 방만)
  app.delete('/api/admin/cars', admin, wrap(async (req, res) => {
    const code = typeof req.query.room === 'string' ? req.query.room : '';
    res.json({ ok: true, removed: code ? await cars.removeRoom(code) : await cars.removeAll() });
  }));

  app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '파일이 너무 커요.' });
    console.error(err);
    res.status(err.status ?? 500).json({ error: '서버에서 문제가 생겼어요.' });
  });
}
