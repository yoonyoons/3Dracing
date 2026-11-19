// 학생 그림 사진에서 종이 배경을 지우는 알고리즘. 픽셀 배열만 다루므로 브라우저와 테스트(Node) 모두에서 돕니다.

export interface DrawingCut {
  /** 원본 크기의 RGBA (배경은 투명) */
  rgba: Uint8ClampedArray;
  /** 잘라낼 영역 */
  crop: { left: number; top: number; width: number; height: number };
  /** 배경 제거가 잘 됐는지. false 면 그림 전체를 그대로 씁니다. */
  backgroundRemoved: boolean;
  /** 그림의 대표 색 [r,g,b] 0~255 */
  mainColor: [number, number, number];
}

const THRESH = 40;

/**
 * 1) 가장자리에서 종이색을 추정(조명 기울기 포함)하고, 가장자리와 이어진 종이색 영역을 투명하게
 * 2) 가장 큰 덩어리(자동차)와 그에 준하는 덩어리만 남기고 여백을 잘라냄
 * @param data RGB 3채널 픽셀 (흰 배경으로 합성된 상태)
 */
export function cutDrawing(data: ArrayLike<number>, w: number, h: number): DrawingCut {
  if (w < 16 || h < 16) throw new Error('그림이 너무 작아요.');
  const n = w * h;
  // 가장자리 띠의 색으로 "종이색 = a + b·x + c·y" 평면을 맞춥니다(조명이 한쪽으로 어두운 사진 대응).
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const fit = [0, 1, 2].map(() => ({ sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, sv: 0, sxv: 0, syv: 0, k: 0 }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        const f = fit[c];
        const v = data[i + c];
        f.sx += x; f.sy += y; f.sxx += x * x; f.syy += y * y; f.sxy += x * y;
        f.sv += v; f.sxv += x * v; f.syv += y * v; f.k++;
      }
    }
  }
  const plane = fit.map((f) => {
    // 3x3 정규방정식 풀이 (크래머)
    const m = [f.k, f.sx, f.sy, f.sx, f.sxx, f.sxy, f.sy, f.sxy, f.syy];
    const det = (a: number[]) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
    const d = det(m);
    if (Math.abs(d) < 1e-6) return [f.sv / f.k, 0, 0];
    const r = [f.sv, f.sxv, f.syv];
    const col = (j: number) => m.map((v, idx) => (idx % 3 === j ? r[Math.floor(idx / 3)] : v));
    return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
  });

  // 종이색과 비슷한지
  const like = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let diff = 0;
      for (let c = 0; c < 3; c++) {
        const bg = plane[c][0] + plane[c][1] * x + plane[c][2] * y;
        diff = Math.max(diff, Math.abs(data[p * 3 + c] - bg));
      }
      like[p] = diff < THRESH ? 1 : 0;
    }
  }

  // 가장자리에서 시작해 이어진 종이색 영역 = 배경
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (p: number) => {
    if (like[p] && !bg[p]) { bg[p] = 1; stack[sp++] = p; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }

  // 덩어리 나누기: 가장 큰 덩어리와 그 5% 이상인 덩어리만 남깁니다(종이의 점·얼룩 제거).
  const label = new Int32Array(n);
  const sizes: number[] = [0];
  for (let s = 0; s < n; s++) {
    if (bg[s] || label[s]) continue;
    const id = sizes.length;
    let count = 0;
    sp = 0;
    label[s] = id;
    stack[sp++] = s;
    while (sp > 0) {
      const p = stack[--sp];
      count++;
      const x = p % w;
      const tryPush = (q: number) => { if (!bg[q] && !label[q]) { label[q] = id; stack[sp++] = q; } };
      if (x > 0) tryPush(p - 1);
      if (x < w - 1) tryPush(p + 1);
      if (p >= w) tryPush(p - w);
      if (p < n - w) tryPush(p + w);
    }
    sizes.push(count);
  }
  const biggest = Math.max(0, ...sizes);
  const keep = sizes.map((s) => s > 0 && s >= biggest * 0.05);

  let fg = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const rgba = new Uint8ClampedArray(n * 4);
  const sum = [0, 0, 0];
  let colorCount = 0;
  for (let p = 0; p < n; p++) {
    const on = !bg[p] && keep[label[p]];
    rgba[p * 4] = data[p * 3];
    rgba[p * 4 + 1] = data[p * 3 + 1];
    rgba[p * 4 + 2] = data[p * 3 + 2];
    rgba[p * 4 + 3] = on ? 255 : 0;
    if (!on) continue;
    fg++;
    const x = p % w;
    const y = (p - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    // 대표 색: 검은 테두리·흰 부분을 뺀 "색칠된" 부분의 평균
    const r = data[p * 3], g = data[p * 3 + 1], b = data[p * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 40 && mx > 70) { sum[0] += r; sum[1] += g; sum[2] += b; colorCount++; }
  }
  const mainColor: [number, number, number] = colorCount > 50
    ? [Math.round(sum[0] / colorCount), Math.round(sum[1] / colorCount), Math.round(sum[2] / colorCount)]
    : [255, 90, 95];

  const ratio = fg / n;
  const removed = ratio > 0.015 && ratio < 0.92 && maxX - minX > 12 && maxY - minY > 8;
  if (!removed) {
    // 배경을 못 지웠으면(종이가 꽉 찬 그림 등) 그림 전체를 그대로 씁니다.
    for (let p = 0; p < n; p++) rgba[p * 4 + 3] = 255;
    minX = 0; minY = 0; maxX = w - 1; maxY = h - 1;
  }
  const pad = removed ? 2 : 0;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const width = Math.min(w - left, maxX - minX + 1 + pad * 2);
  const height = Math.min(h - top, maxY - minY + 1 + pad * 2);
  return { rgba, crop: { left, top, width, height }, backgroundRemoved: removed, mainColor };
}
