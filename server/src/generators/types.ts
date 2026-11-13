export interface GenerateInput {
  carId: string;
  /** 흰 배경으로 정리된 그림 PNG */
  image: Buffer;
  /** 외부 변환기가 그림을 내려받을 공개 주소 (PUBLIC_URL 이 있을 때만) */
  imageUrl: string | null;
  /** 그림의 대표 색 (0~255) */
  mainColor: [number, number, number];
  /** 원래 그림을 살리도록 안내하는 프롬프트 (텍스처 단계가 있는 모델에서 사용) */
  prompt: string;
}

export type JobState =
  | { status: 'pending'; progress: number }
  | { status: 'done'; glb: Buffer }
  | { status: 'failed'; error: string };

/**
 * 그림 → 3D 모델(GLB) 변환기. 제공자를 바꾸고 싶으면 이 인터페이스만 구현하면 됩니다.
 * (예: Meshy, Tripo, fal.ai 의 image-to-3D API)
 */
export interface CarGenerator {
  readonly name: string;
  /**
   * true: 학생이 올리면 서버가 바로 변환을 시작합니다 (A 모드).
   * false: 서버는 변환하지 않고, 교사가 관리자 화면에서 GLB 를 올립니다 (B 모드).
   */
  readonly realtime: boolean;
  submit(input: GenerateInput): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<JobState>;
}

/** 원래 그림을 살리는 프롬프트 템플릿 */
export function buildPrompt(): string {
  return [
    'A toy racing car made from this child\'s drawing.',
    'Side view of a racing car with four wheels.',
    'Keep the original colors, shapes and hand-drawn details exactly as drawn.',
    '3D toy style, chunky and simple, single object, plain white background.',
  ].join(' ');
}
