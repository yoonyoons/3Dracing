import { Document, Logger, NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, getBounds, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/** 레이스에서 쓰는 차 길이(앞뒤). 물리 반지름과 맞춘 값입니다. */
export const CAR_LENGTH = 4;
const MAX_HEIGHT = 3.2;
const MAX_WIDTH = 2.6;
const MAX_TRIANGLES = 12000;
const TEXTURE_SIZE = 512;

let ioPromise: Promise<NodeIO> | null = null;
function getIO(): Promise<NodeIO> {
  ioPromise ??= (async () => {
    await MeshoptDecoder.ready;
    await MeshoptSimplifier.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    try {
      // Draco 로 압축된 GLB 도 읽을 수 있게 (출력은 압축하지 않아 브라우저에 디코더가 필요 없습니다)
      const draco = (await import('draco3dgltf')).default;
      io.registerDependencies({ 'draco3d.decoder': await draco.createDecoderModule() });
    } catch { /* Draco 없이도 대부분의 GLB 는 읽힙니다 */ }
    return io;
  })();
  return ioPromise;
}

export function countTriangles(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += Math.floor((idx ? idx.getCount() : pos?.getCount() ?? 0) / 3);
    }
  }
  return tris;
}

export interface GlbStats {
  bytesIn: number;
  bytesOut: number;
  trianglesIn: number;
  trianglesOut: number;
  size: [number, number, number];
}

/**
 * 생성된 GLB 를 레이스용으로 다듬습니다.
 * - 경량화: 중복 제거, 폴리곤 감축(12,000개 초과 시), 텍스처 512px
 * - 정렬: 가장 긴 수평 방향을 앞뒤(Z)로, 길이를 4로, 바닥을 y=0 으로, 가운데 정렬
 * 앞/뒤가 뒤집혔는지는 모델만 보고 알 수 없어서, 화면의 "앞뒤 바꾸기" 버튼으로 맞춥니다.
 */
export async function normalizeCarGlb(input: Buffer): Promise<{ glb: Buffer; stats: GlbStats }> {
  const io = await getIO();
  const doc = await io.readBinary(new Uint8Array(input));
  doc.setLogger(new Logger(Logger.Verbosity.SILENT));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('GLB 안에 장면이 없어요.');
  const trianglesIn = countTriangles(doc);
  if (trianglesIn === 0) throw new Error('GLB 안에 모델이 없어요.');

  for (const a of root.listAnimations()) a.dispose();
  for (const s of root.listSkins()) s.dispose();

  await doc.transform(dedup(), flatten(), weld());
  if (trianglesIn > MAX_TRIANGLES) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: MAX_TRIANGLES / trianglesIn, error: 0.02 }));
  }
  if (root.listTextures().length > 0) {
    await doc.transform(textureCompress({ encoder: sharp, resize: [TEXTURE_SIZE, TEXTURE_SIZE] }));
  }
  await doc.transform(prune());

  // 모든 최상위 노드를 하나의 부모 아래에 넣고, 부모에 회전·크기·위치를 줍니다.
  const wrap = doc.createNode('car-root');
  for (const child of scene.listChildren() as Node[]) wrap.addChild(child);
  scene.addChild(wrap);

  let b = getBounds(scene);
  const sx = b.max[0] - b.min[0];
  const sz = b.max[2] - b.min[2];
  if (sx > sz) {
    wrap.setRotation([0, Math.SQRT1_2, 0, -Math.SQRT1_2]); // Y축 -90°: +X → +Z
    b = getBounds(scene);
  }
  const len = b.max[2] - b.min[2];
  const wid = b.max[0] - b.min[0];
  const hei = b.max[1] - b.min[1];
  if (!(len > 1e-6)) throw new Error('GLB 크기를 알 수 없어요.');
  const s = Math.min(CAR_LENGTH / len, MAX_HEIGHT / Math.max(hei, 1e-6), MAX_WIDTH / Math.max(wid, 1e-6));
  wrap.setScale([s, s, s]);
  wrap.setTranslation([
    -s * (b.min[0] + b.max[0]) / 2,
    -s * b.min[1],
    -s * (b.min[2] + b.max[2]) / 2,
  ]);

  const out = Buffer.from(await io.writeBinary(doc));
  const fb = getBounds(scene);
  return {
    glb: out,
    stats: {
      bytesIn: input.length, bytesOut: out.length, trianglesIn, trianglesOut: countTriangles(doc),
      size: [fb.max[0] - fb.min[0], fb.max[1] - fb.min[1], fb.max[2] - fb.min[2]],
    },
  };
}

function addBox(doc: Document, buffer: ReturnType<Document['createBuffer']>, name: string, size: [number, number, number], color: [number, number, number]) {
  const [w, h, d] = size.map((v) => v / 2);
  // 면마다 꼭짓점 4개 (평평한 음영)
  const faces: [number[], number[][]][] = [
    [[1, 0, 0], [[w, -h, -d], [w, h, -d], [w, h, d], [w, -h, d]]],
    [[-1, 0, 0], [[-w, -h, d], [-w, h, d], [-w, h, -d], [-w, -h, -d]]],
    [[0, 1, 0], [[-w, h, -d], [-w, h, d], [w, h, d], [w, h, -d]]],
    [[0, -1, 0], [[-w, -h, d], [-w, -h, -d], [w, -h, -d], [w, -h, d]]],
    [[0, 0, 1], [[w, -h, d], [w, h, d], [-w, h, d], [-w, -h, d]]],
    [[0, 0, -1], [[-w, -h, -d], [-w, h, -d], [w, h, -d], [w, -h, -d]]],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  faces.forEach(([n, vs], f) => {
    for (const v of vs) { pos.push(...v); nor.push(...n); }
    const o = f * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const mat = doc.createMaterial(name).setBaseColorFactor([color[0], color[1], color[2], 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
    .setMaterial(mat);
  return doc.createMesh(name).addPrimitive(prim);
}

/**
 * mock 모드용 샘플 GLB. 실제 생성 결과처럼 크기·방향·높이가 제멋대로인 상태로 만들어
 * 후처리(normalizeCarGlb)가 제대로 도는지 개발 중에 확인할 수 있습니다.
 * @param rgb 차체 색 (0~1). 학생 그림의 대표 색을 넣어 줍니다.
 */
export async function makeSampleCarGlb(rgb: [number, number, number] = [1, 0.35, 0.37]): Promise<Buffer> {
  const io = await getIO();
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('sample');
  const dark: [number, number, number] = [rgb[0] * 0.6, rgb[1] * 0.6, rgb[2] * 0.6];
  const parts: [string, [number, number, number], [number, number, number], [number, number, number]][] = [
    // 이름, 크기(x=길이), 위치, 색 — 일부러 X축 방향으로 긴 차
    ['body', [4, 0.7, 1.8], [0, 0.75, 0], rgb],
    ['nose', [1.0, 0.4, 1.4], [1.9, 0.6, 0], dark],
    ['cabin', [1.7, 0.6, 1.4], [-0.3, 1.4, 0], [0.75, 0.92, 1]],
    ['roof', [1.8, 0.12, 1.5], [-0.3, 1.76, 0], dark],
    ['wing', [0.5, 0.12, 2.0], [-1.9, 1.7, 0], dark],
    ['wingL', [0.3, 0.6, 0.12], [-1.9, 1.35, 0.6], dark],
    ['wingR', [0.3, 0.6, 0.12], [-1.9, 1.35, -0.6], dark],
    ['wheelFL', [1.0, 1.0, 0.45], [1.25, 0.5, 1.0], [0.15, 0.15, 0.18]],
    ['wheelFR', [1.0, 1.0, 0.45], [1.25, 0.5, -1.0], [0.15, 0.15, 0.18]],
    ['wheelRL', [1.0, 1.0, 0.45], [-1.25, 0.5, 1.0], [0.15, 0.15, 0.18]],
    ['wheelRR', [1.0, 1.0, 0.45], [-1.25, 0.5, -1.0], [0.15, 0.15, 0.18]],
  ];
  const group = doc.createNode('model').setScale([13, 13, 13]).setTranslation([40, 25, -10]);
  for (const [name, size, at, color] of parts) {
    group.addChild(doc.createNode(name).setMesh(addBox(doc, buffer, name, size, color)).setTranslation(at));
  }
  scene.addChild(group);
  return Buffer.from(await io.writeBinary(doc));
}
