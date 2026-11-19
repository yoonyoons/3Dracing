import { cutDrawing } from '@racing/shared';

const WORK = 640;
const OUT = 512;

export interface PreparedDrawing {
  /** 배경을 지운 투명 PNG (차체 텍스처·미리보기용) */
  cutout: Blob;
  /** 흰 배경 정사각형 PNG (3D 변환 입력용) */
  clean: Blob;
  backgroundRemoved: boolean;
  mainColor: [number, number, number];
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(c: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했어요'))), type));
}

/**
 * 학생이 올린 사진을 이 기기에서 정리합니다. 원본 사진은 어디에도 보내지 않습니다.
 * 다시 그려서 저장하므로 촬영 위치 같은 사진 정보도 남지 않습니다.
 */
export async function prepareDrawing(file: Blob): Promise<PreparedDrawing> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    throw new Error('그림을 읽지 못했어요. 다른 사진으로 해 볼까요?');
  }
  const k = Math.min(1, WORK / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const work = canvas(w, h);
  const g = work.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const px = g.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
  const cut = cutDrawing(rgb, w, h);

  const full = canvas(w, h);
  full.getContext('2d')!.putImageData(new ImageData(cut.rgba as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const { left, top, width, height } = cut.crop;
  const s = Math.min(1, OUT / Math.max(width, height));
  const ow = Math.max(1, Math.round(width * s));
  const oh = Math.max(1, Math.round(height * s));
  const out = canvas(ow, oh);
  const og = out.getContext('2d')!;
  og.imageSmoothingQuality = 'high';
  og.drawImage(full, left, top, width, height, 0, 0, ow, oh);

  // 3D 변환기는 "흰 배경 + 여백 있는 정사각형"을 가장 잘 알아봅니다.
  const side = Math.round(Math.max(ow, oh) * 1.25);
  const sq = canvas(side, side);
  const sg = sq.getContext('2d')!;
  sg.fillStyle = '#fff';
  sg.fillRect(0, 0, side, side);
  sg.drawImage(out, Math.round((side - ow) / 2), Math.round((side - oh) / 2));

  return { cutout: await toBlob(out), clean: await toBlob(sq), backgroundRemoved: cut.backgroundRemoved, mainColor: cut.mainColor };
}
