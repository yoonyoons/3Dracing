import type { CarGenerator, JobState } from './types';

/**
 * B 모드(사전 생성): 서버는 3D 변환을 하지 않습니다.
 * 교사가 Higgsfield 웹/앱에서 미리 만든 GLB 를 관리자 화면에서 학생 그림과 짝지어 올립니다.
 * 올리기 전까지 학생은 "그림 차체"로 달립니다.
 */
export class PregeneratedGenerator implements CarGenerator {
  readonly name = 'pregenerated';
  readonly realtime = false;
  async submit(): Promise<{ jobId: string }> {
    throw new Error('사전 생성 모드에서는 서버가 변환하지 않습니다.');
  }
  async poll(): Promise<JobState> {
    return { status: 'failed', error: '사전 생성 모드' };
  }
}
