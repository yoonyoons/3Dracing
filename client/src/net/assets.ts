import { b64ToBytes, rpc } from './supabase';

const cache = new Map<string, Promise<string>>();

/**
 * 차 파일 참조("car:<id>:<image|glb>:<버전>")를 브라우저에서 쓸 수 있는 주소(blob:)로 바꿉니다.
 * 같은 파일은 한 번만 내려받습니다. 일반 주소는 그대로 돌려줍니다.
 */
export function resolveAsset(ref: string): Promise<string> {
  if (!ref.startsWith('car:')) return Promise.resolve(ref);
  let p = cache.get(ref);
  if (!p) {
    const [, id, kind] = ref.split(':');
    p = rpc<{ data: string | null }>('race_car_file', { p_id: id, p_kind: kind }).then(({ data }) => {
      if (!data) throw new Error('파일이 없어요');
      const type = kind === 'glb' ? 'model/gltf-binary' : 'image/png';
      return URL.createObjectURL(new Blob([b64ToBytes(data) as BlobPart], { type }));
    });
    p.catch(() => cache.delete(ref));
    cache.set(ref, p);
  }
  return p;
}
