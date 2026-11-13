/** 사진을 보내기 전에 기기에서 먼저 줄입니다(학교 와이파이 부담↓, 서버에는 필요한 만큼만 전송). */
async function shrink(file: File, max = 1400): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (blob) return blob;
  } catch { /* 줄이기에 실패하면 원본을 보냅니다 */ }
  return file;
}

export interface PlayerAuth { code: string; playerId: string; token: string }

async function call(auth: PlayerAuth, path: string, init: RequestInit): Promise<void> {
  const res = await fetch(`/api/rooms/${auth.code}/${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), 'x-player-id': auth.playerId, 'x-player-token': auth.token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? '잠시 후 다시 해 주세요.');
  }
}

export async function uploadDrawing(auth: PlayerAuth, file: File): Promise<void> {
  const blob = await shrink(file);
  await call(auth, 'drawing', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
}

export const flipCar = (auth: PlayerAuth) => call(auth, 'flip', { method: 'POST' });
export const removeDrawing = (auth: PlayerAuth) => call(auth, 'drawing', { method: 'DELETE' });
