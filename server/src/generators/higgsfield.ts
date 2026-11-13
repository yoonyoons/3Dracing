import type { CarGenerator, GenerateInput, JobState } from './types';

interface Options {
  baseUrl: string;
  keyId: string;
  keySecret: string;
  /** 예: "meshy/image-to-3d" 처럼 Higgsfield API 문서에 나온 모델 경로 */
  model: string;
}

/**
 * A 모드(실시간) 어댑터 — ⚠️ 아직 실제 호출로 검증하지 못했습니다.
 *
 * 2026-11 기준 Higgsfield 공개 API(api.higgsfield.ai) 카탈로그에는 이미지·영상 모델만 있고
 * 3D(GLB) 모델이 없습니다. 3D 는 웹 앱과 MCP 로만 쓸 수 있어서, 이 클래스는
 * "공개 API 에 3D 모델이 추가되면 HIGGSFIELD_3D_MODEL 만 채워서 켤 수 있도록" 문서에 나온
 * 공통 비동기 방식(제출 → request_id → /requests/{id}/status 폴링)에 맞춰 둔 틀입니다.
 * 요청/응답 필드 이름은 실제 모델 문서를 보고 맞춰야 합니다.
 *
 * API 키는 서버 환경변수에서만 읽고, 브라우저로는 절대 보내지 않습니다.
 */
export class HiggsfieldGenerator implements CarGenerator {
  readonly name = 'higgsfield';
  readonly realtime = true;
  constructor(private o: Options) {
    if (!o.keyId || !o.keySecret) throw new Error('HIGGSFIELD_KEY_ID / HIGGSFIELD_KEY_SECRET 가 필요합니다.');
    if (!o.model) throw new Error('HIGGSFIELD_3D_MODEL 이 비어 있습니다. (공개 API 에 3D 모델이 생기면 그 경로를 넣으세요)');
  }

  private headers() {
    return { Authorization: `Key ${this.o.keyId}:${this.o.keySecret}`, 'Content-Type': 'application/json' };
  }

  async submit(input: GenerateInput): Promise<{ jobId: string }> {
    const imageUrl = input.imageUrl;
    if (!imageUrl) throw new Error('PUBLIC_URL 이 없어 그림 주소를 변환기에 알려 줄 수 없어요.');
    const res = await fetch(`${this.o.baseUrl}/${this.o.model}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ image_url: imageUrl, prompt: input.prompt }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Higgsfield 제출 실패 (${res.status})`);
    const body = (await res.json()) as { request_id?: string };
    if (!body.request_id) throw new Error('Higgsfield 응답에 request_id 가 없어요.');
    return { jobId: body.request_id };
  }

  async poll(jobId: string): Promise<JobState> {
    const res = await fetch(`${this.o.baseUrl}/requests/${encodeURIComponent(jobId)}/status`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { status: 'pending', progress: 0.5 };
    const body = (await res.json()) as { status?: string; model?: { url?: string }; outputs?: { url?: string }[]; error?: string };
    if (body.status === 'failed' || body.status === 'nsfw') return { status: 'failed', error: body.error ?? body.status };
    if (body.status !== 'completed') return { status: 'pending', progress: body.status === 'in_progress' ? 0.6 : 0.2 };
    const url = body.model?.url ?? body.outputs?.[0]?.url;
    if (!url) return { status: 'failed', error: '결과에 GLB 주소가 없어요.' };
    // 결과 주소는 만료될 수 있으므로 바로 내려받아 우리 저장소에 보관합니다.
    const file = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!file.ok) return { status: 'failed', error: `GLB 내려받기 실패 (${file.status})` };
    return { status: 'done', glb: Buffer.from(await file.arrayBuffer()) };
  }
}
