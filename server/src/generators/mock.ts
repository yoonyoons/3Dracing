import crypto from 'node:crypto';
import { makeSampleCarGlb } from '../glb';
import type { CarGenerator, GenerateInput, JobState } from './types';

/**
 * 개발용 가짜 변환기. 크레딧을 쓰지 않고 몇 초 뒤 샘플 GLB(그림의 대표 색으로 칠한 차)를 돌려줍니다.
 * MOCK 닉네임/시간으로 실패·지연 상황도 연습할 수 있습니다.
 */
export class MockGenerator implements CarGenerator {
  readonly name = 'mock';
  readonly realtime = true;
  private jobs = new Map<string, { start: number; color: [number, number, number] }>();
  constructor(private delayMs: number, private failRate = 0) {}

  async submit(input: GenerateInput): Promise<{ jobId: string }> {
    const jobId = 'mock-' + crypto.randomBytes(6).toString('hex');
    this.jobs.set(jobId, { start: Date.now(), color: input.mainColor });
    return { jobId };
  }

  async poll(jobId: string): Promise<JobState> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: 'failed', error: '작업을 찾을 수 없어요.' };
    const p = (Date.now() - job.start) / this.delayMs;
    if (p < 1) return { status: 'pending', progress: p };
    this.jobs.delete(jobId);
    if (Math.random() < this.failRate) return { status: 'failed', error: '(mock) 일부러 낸 실패' };
    // glTF 의 색은 선형 색공간이라 sRGB 값을 바꿔서 넣습니다.
    const lin = (v: number) => Math.pow(v / 255, 2.2);
    const glb = await makeSampleCarGlb([lin(job.color[0]), lin(job.color[1]), lin(job.color[2])]);
    return { status: 'done', glb };
  }
}
