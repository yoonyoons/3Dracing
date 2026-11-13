import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config, useSupabase } from './config';

/** 그림·GLB 파일 저장소. 로컬 개발은 파일시스템, 배포는 Supabase Storage(비공개 버킷). */
export interface FileStorage {
  readonly kind: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(keys: string[]): Promise<void>;
}

const safeKey = (key: string) => /^[a-zA-Z0-9/_.-]+$/.test(key) && !key.includes('..');

export class LocalStorage implements FileStorage {
  readonly kind = 'local';
  constructor(private root: string) {}
  private file(key: string): string {
    if (!safeKey(key)) throw new Error('bad key');
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer): Promise<void> {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.file(key));
    } catch {
      return null;
    }
  }
  async remove(keys: string[]): Promise<void> {
    for (const k of keys) {
      const f = this.file(k);
      await fs.rm(f, { force: true });
      // 빈 폴더 정리
      await fs.rmdir(path.dirname(f)).catch(() => {});
    }
  }
}

export class SupabaseStorage implements FileStorage {
  readonly kind = 'supabase';
  constructor(private client: SupabaseClient, private bucket: string) {}
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    if (!safeKey(key)) throw new Error('bad key');
    const { error } = await this.client.storage.from(this.bucket).upload(key, data, { contentType, upsert: true });
    if (error) throw new Error(`Supabase 업로드 실패: ${error.message}`);
  }
  async get(key: string): Promise<Buffer | null> {
    if (!safeKey(key)) return null;
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { error } = await this.client.storage.from(this.bucket).remove(keys);
    if (error) throw new Error(`Supabase 삭제 실패: ${error.message}`);
  }
}

let supabase: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

export function createStorage(): FileStorage {
  if (useSupabase) return new SupabaseStorage(getSupabase(), config.supabase.bucket);
  return new LocalStorage(path.join(config.dataDir, 'files'));
}
