import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSockets } from './sockets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

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
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
export const { io, rooms } = createSockets(server);

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

// 교사 노트북에서 localhost 로 열었을 때 학생이 접속할 주소(QR)를 알려 줍니다.
app.get('/api/info', (_req, res) => {
  const pub = process.env.PUBLIC_URL?.replace(/\/$/, '') || null;
  res.json({ publicUrl: pub, lan: lanAddresses().map((a) => `http://${a}:${PORT}`) });
});

// 빌드된 프론트(client/dist)를 같은 주소에서 서빙합니다. 외부 CDN 을 쓰지 않습니다.
const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api|files|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`\n🏎️  드로잉 레이싱 서버가 켜졌어요!`);
  console.log(`   이 컴퓨터에서:  http://localhost:${PORT}`);
  for (const a of lanAddresses()) console.log(`   학생 기기에서:  http://${a}:${PORT}`);
  console.log('');
});
