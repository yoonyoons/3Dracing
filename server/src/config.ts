import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/.env 를 먼저, 없으면 저장소 맨 위의 .env 를 읽습니다.
dotenv.config({ path: [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../.env')] });
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export type GeneratorMode = 'mock' | 'pregenerated' | 'higgsfield';

const mode = (process.env.GENERATOR ?? 'pregenerated').toLowerCase();

// 모든 비밀 값은 서버 환경변수(.env)에서만 읽습니다. 클라이언트로 보내는 코드는 없습니다.
export const config = {
  port: num(process.env.PORT, 3000),
  publicUrl: process.env.PUBLIC_URL?.replace(/\/$/, '') || null,
  dataDir: path.resolve(process.env.DATA_DIR ?? path.resolve(__dirname, '../../data')),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminPasswordGenerated: false,
  generator: (['mock', 'pregenerated', 'higgsfield'].includes(mode) ? mode : 'pregenerated') as GeneratorMode,
  genTimeoutSec: num(process.env.GEN_TIMEOUT_SEC, 180),
  mockDelaySec: num(process.env.MOCK_DELAY_SEC, 8),
  retentionHours: num(process.env.RETENTION_HOURS, 24),
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'race-assets',
  },
  higgsfield: {
    baseUrl: (process.env.HIGGSFIELD_API_URL || 'https://api.higgsfield.ai').replace(/\/$/, ''),
    keyId: process.env.HIGGSFIELD_KEY_ID || '',
    keySecret: process.env.HIGGSFIELD_KEY_SECRET || '',
    model3d: process.env.HIGGSFIELD_3D_MODEL || '',
  },
};

if (!config.adminPassword) {
  config.adminPassword = crypto.randomBytes(4).toString('hex');
  config.adminPasswordGenerated = true;
}

export const useSupabase = !!(config.supabase.url && config.supabase.serviceKey);
