import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processDrawing } from '../src/image';
import { makeSampleCarGlb, normalizeCarGlb, CAR_LENGTH } from '../src/glb';

/** 종이 사진처럼: 한쪽이 어두운 회색빛 종이 위에 빨간 자동차 그림 + 작은 얼룩 */
async function fakePhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f1ea"/><stop offset="1" stop-color="#cfcabd"/></linearGradient></defs>
    <rect width="800" height="600" fill="url(#g)"/>
    <path d="M150 380 Q150 300 260 290 L330 220 L520 220 L590 290 Q680 300 680 380 Z" fill="#e63946" stroke="#222" stroke-width="8"/>
    <rect x="350" y="240" width="150" height="50" fill="#ffffff" stroke="#222" stroke-width="6"/>
    <circle cx="270" cy="390" r="55" fill="#222"/><circle cx="560" cy="390" r="55" fill="#222"/>
    <circle cx="60" cy="60" r="5" fill="#555"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

test('그림 정리: 종이 배경이 지워지고 자동차만 잘려 나온다', async () => {
  const out = await processDrawing(await fakePhoto());
  assert.equal(out.backgroundRemoved, true);
  const { data, info } = await sharp(out.cutout).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  // 가로로 긴 자동차 모양이어야 함 (원본 530x225 정도)
  assert.ok(info.width / info.height > 2 && info.width / info.height < 2.8, `비율 ${info.width}x${info.height}`);
  const alpha = (x: number, y: number) => data[(Math.round(y) * info.width + Math.round(x)) * 4 + 3];
  assert.equal(alpha(3, 3), 0, '왼쪽 위 모서리는 투명');
  assert.equal(alpha(info.width - 4, 3), 0, '오른쪽 위 모서리는 투명');
  assert.equal(alpha(info.width / 2, info.height * 0.55), 255, '차체 가운데는 불투명');
  assert.equal(alpha(info.width / 2, info.height * 0.2), 255, '흰 창문은 차 안쪽이라 남아 있어야 함');
  // 대표 색은 빨강 계열
  assert.ok(out.mainColor[0] > 180 && out.mainColor[1] < 110, `대표색 ${out.mainColor}`);
  const clean = await sharp(out.clean).metadata();
  assert.equal(clean.width, clean.height);
  assert.equal(clean.hasAlpha, false);
});

test('그림 정리: 좌우 뒤집기와 꽉 찬 그림 처리', async () => {
  const full = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#3a86ff' } }).png().toBuffer();
  const out = await processDrawing(full);
  assert.equal(out.backgroundRemoved, false);
  assert.equal(out.width, 300);
  await assert.rejects(() => processDrawing(Buffer.from('not an image')));
});

test('GLB 후처리: 크기·바닥·방향을 맞춘다', async () => {
  const raw = await makeSampleCarGlb([0.2, 0.6, 1]);
  const { glb, stats } = await normalizeCarGlb(raw);
  assert.equal(glb.subarray(0, 4).toString('latin1'), 'glTF');
  const [w, h, len] = stats.size;
  assert.ok(Math.abs(len - CAR_LENGTH) < 0.01, `길이 ${len}`);
  assert.ok(w < len && h < len, '가장 긴 방향이 앞뒤(Z)여야 함');
  assert.ok(stats.trianglesOut > 0 && stats.trianglesOut <= stats.trianglesIn);
  // 다시 넣어도 그대로 (이미 정규화된 모델)
  const again = await normalizeCarGlb(glb);
  assert.ok(Math.abs(again.stats.size[2] - CAR_LENGTH) < 0.01);
  await assert.rejects(() => normalizeCarGlb(Buffer.from('glTF-not-really')));
});
