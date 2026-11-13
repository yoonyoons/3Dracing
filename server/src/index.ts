import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSockets } from './sockets';
import { config, useSupabase } from './config';
import { createStorage } from './storage';
import { createCarStore } from './carStore';
import { createGenerator } from './generators';
import { CarService } from './cars';
import { mountApi } from './api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = config.port;

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

const server = http.createServer(app);
export const { io, rooms } = createSockets(server);

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

// 교사 노트북에서 localhost 로 열었을 때 학생이 접속할 주소(QR)를 알려 줍니다.
app.get('/api/info', (_req, res) => {
  res.json({ publicUrl: config.publicUrl, lan: lanAddresses().map((a) => `http://${a}:${PORT}`) });
});

export const cars = new CarService(createStorage(), createCarStore(), createGenerator(), rooms);
// 방을 닫으면 그 방의 그림·GLB 를 바로 지웁니다.
rooms.onClose = (code) => void cars.removeRoom(code).catch((e) => console.error('방 파일 삭제 실패', e));
mountApi(app, rooms, cars);

// 빌드된 프론트(client/dist)를 같은 주소에서 서빙합니다. 외부 CDN 을 쓰지 않습니다.
const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api|files|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

await cars.init().catch((e) => console.error('차 기록을 불러오지 못했어요:', (e as Error).message));

server.listen(PORT, () => {
  console.log(`\n🏎️  드로잉 레이싱 서버가 켜졌어요!`);
  console.log(`   이 컴퓨터에서:  http://localhost:${PORT}`);
  for (const a of lanAddresses()) console.log(`   학생 기기에서:  http://${a}:${PORT}`);
  console.log(`   3D 변환 모드:   ${cars.generator.name}${cars.generator.realtime ? ' (실시간)' : ' (교사가 관리자 화면에서 GLB 업로드)'}`);
  console.log(`   저장소:         ${useSupabase ? 'Supabase Storage' : '이 컴퓨터의 data 폴더'} · ${config.retentionHours}시간 뒤 자동 삭제`);
  console.log(`   관리자 비밀번호: ${config.adminPasswordGenerated ? config.adminPassword + '  (서버를 켤 때마다 바뀜. .env 의 ADMIN_PASSWORD 로 고정 가능)' : '(.env 에 설정됨)'}`);
  console.log('');
});
