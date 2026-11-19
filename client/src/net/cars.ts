import { prepareDrawing } from '../lib/drawingImage';
import { bytesToB64, rpc } from './supabase';
import type { PlayerController } from './player';

const args = (c: PlayerController) => ({ p_code: c.auth.code, p_pid: c.auth.pid, p_chan: c.auth.chan });

/** 그림 올리기: 이 기기에서 정리 → 저장 → 교사 화면에 알림. mock 모드면 샘플 3D 차도 만듭니다. */
export async function uploadDrawing(ctl: PlayerController, file: File, onProgress?: (p: number) => void): Promise<void> {
  const d = await prepareDrawing(file);
  const r = await rpc<{ version: number; generator: string }>('race_player_upload', {
    ...args(ctl), p_image: await bytesToB64(d.cutout), p_clean: await bytesToB64(d.clean),
  });
  ctl.carChanged();
  if (r.generator === 'mock') {
    // 크레딧 없이 개발·연습할 때: 몇 초 기다렸다가 샘플 3D 차를 붙입니다.
    const total = 6000;
    const t0 = Date.now();
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        const p = (Date.now() - t0) / total;
        onProgress?.(Math.min(0.95, p));
        if (p >= 1) { clearInterval(t); resolve(); }
      }, 300);
    });
    const { makeMockGlb } = await import('../lib/glbBrowser');
    const glb = await makeMockGlb(d.mainColor);
    await rpc('race_player_glb', { ...args(ctl), p_version: r.version, p_glb: await bytesToB64(glb) });
    onProgress?.(1);
    ctl.carChanged();
  }
}

export async function flipCar(ctl: PlayerController): Promise<void> {
  await rpc('race_player_flip', args(ctl));
  ctl.carChanged();
}

export async function removeDrawing(ctl: PlayerController): Promise<void> {
  await rpc('race_player_delete', args(ctl));
  ctl.carChanged();
}
