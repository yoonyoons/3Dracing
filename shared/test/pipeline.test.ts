import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { cutDrawing } from '../src/drawing';
import { prepareIO, makeSampleCarGlb, normalizeCarGlb, CAR_LENGTH } from '../src/glb';

/** 종이 사진처럼: 한쪽이 어두운 회색빛 종이 위에 빨간 자동차 그림 + 작은 얼룩 */
async function fakePhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f1ea"/><stop offset="1" stop-color="#cfcabd"/></linearGradient></defs>
    <rect width="800" height="600" fill="url(#g)"/>
    <path d="M150 380 Q150 300 260 290 L330 220 L520 220 L590 290 Q680 300 680 380 Z" fill="#e63946" stroke="#222" stroke-width="8"/>
    <rect x="350" y="240" width="150" height="50" fill="#ffffff" stroke="#222" stroke-width="6"/>
    <circle cx="270" cy="390" r="55" fill="#222"/><circle cx="560" cy="390" r="55" fill="#222"/>
    <circle cx="60" cy="60" r="5" fill="#555"/>
  </svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
    .then((b) => sharp(b).resize(640, 640, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
  return { data, w: info.width, h: info.height };
}

test('그림 정리: 종이 배경이 지워지고 자동차만 잘려 나온다', async () => {
  const { data, w, h } = await fakePhoto();
  const out = cutDrawing(data, w, h);
  assert.equal(out.backgroundRemoved, true);
  const { left, top, width, height } = out.crop;
  assert.ok(width / height > 2 && width / height < 2.8, `비율 ${width}x${height}`);
  const alpha = (x: number, y: number) => out.rgba[(Math.round(top + y) * w + Math.round(left + x)) * 4 + 3];
  assert.equal(alpha(3, 3), 0, '왼쪽 위 모서리는 투명');
  assert.equal(alpha(width - 4, 3), 0, '오른쪽 위 모서리는 투명');
  assert.equal(alpha(width / 2, height * 0.55), 255, '차체 가운데는 불투명');
  assert.equal(alpha(width / 2, height * 0.2), 255, '흰 창문은 차 안쪽이라 남아 있어야 함');
  assert.equal(out.rgba[(60 * w + 48) * 4 + 3], 0, '작은 얼룩은 지워짐');
  assert.ok(out.mainColor[0] > 180 && out.mainColor[1] < 110, `대표색 ${out.mainColor}`);
});

test('그림 정리: 꽉 찬 그림은 전체를 그대로 쓴다', () => {
  const w = 300, h = 200;
  const data = new Uint8Array(w * h * 3).map((_, i) => [58, 134, 255][i % 3]);
  const out = cutDrawing(data, w, h);
  assert.equal(out.backgroundRemoved, false);
  assert.deepEqual(out.crop, { left: 0, top: 0, width: w, height: h });
  assert.throws(() => cutDrawing(new Uint8Array(30), 5, 2));
});

test('GLB 후처리: 크기·바닥·방향을 맞추고 텍스처 줄이기를 부른다', async () => {
  const io = await prepareIO(new NodeIO());
  const raw = await makeSampleCarGlb(io, [0.2, 0.6, 1]);
  let resized = 0;
  const { glb, stats } = await normalizeCarGlb(io, raw, async () => { resized++; return null; });
  assert.equal(Buffer.from(glb.subarray(0, 4)).toString('latin1'), 'glTF');
  const [w, h, len] = stats.size;
  assert.ok(Math.abs(len - CAR_LENGTH) < 0.01, `길이 ${len}`);
  assert.ok(w < len && h < len, '가장 긴 방향이 앞뒤(Z)여야 함');
  assert.equal(resized, 0, '샘플 차에는 텍스처가 없음');
  const again = await normalizeCarGlb(io, glb);
  assert.ok(Math.abs(again.stats.size[2] - CAR_LENGTH) < 0.01);
  await assert.rejects(() => normalizeCarGlb(io, new TextEncoder().encode('glTF-not-really')));
});
