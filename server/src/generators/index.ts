import { config } from '../config';
import { HiggsfieldGenerator } from './higgsfield';
import { MockGenerator } from './mock';
import { PregeneratedGenerator } from './pregenerated';
import type { CarGenerator } from './types';

export * from './types';

export function createGenerator(): CarGenerator {
  if (config.generator === 'mock') return new MockGenerator(config.mockDelaySec * 1000);
  if (config.generator === 'higgsfield') {
    try {
      return new HiggsfieldGenerator({
        ...config.higgsfield,
        model: config.higgsfield.model3d,
      });
    } catch (e) {
      console.warn(`⚠️  Higgsfield 실시간 모드를 켤 수 없어 사전 생성(B) 모드로 동작합니다: ${(e as Error).message}`);
    }
  }
  return new PregeneratedGenerator();
}
