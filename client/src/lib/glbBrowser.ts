import { WebIO } from '@gltf-transform/core';
import { makeSampleCarGlb, normalizeCarGlb, prepareIO, type TextureResizer } from '@racing/shared/glb';

let io: Promise<WebIO> | null = null;
const getIO = () => (io ??= prepareIO(new WebIO()));

/** 텍스처를 canvas 로 줄입니다(512px). 이미 작으면 그대로 둡니다. */
const resizeTexture: TextureResizer = async (image, mimeType, max) => {
  const bmp = await createImageBitmap(new Blob([image as BlobPart], { type: mimeType }));
  if (bmp.width <= max && bmp.height <= max) { bmp.close(); return null; }
  const k = max / Math.max(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const type = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const blob: Blob = await new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('resize'))), type, 0.88));
  return { image: new Uint8Array(await blob.arrayBuffer()), mimeType: type };
};

/** 교사가 올린 GLB 를 레이스용으로 다듬습니다 (크기·바닥·방향·경량화). */
export async function normalizeGlbFile(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 20 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'glTF') {
    throw new Error('GLB 파일(.glb)만 올릴 수 있어요.');
  }
  return normalizeCarGlb(await getIO(), bytes, resizeTexture);
}

/** mock 모드: 그림의 대표 색으로 칠한 샘플 3D 차 */
export async function makeMockGlb(rgb255: [number, number, number]): Promise<Uint8Array> {
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  const raw = await makeSampleCarGlb(await getIO(), [lin(rgb255[0]), lin(rgb255[1]), lin(rgb255[2])]);
  return (await normalizeCarGlb(await getIO(), raw)).glb;
}
