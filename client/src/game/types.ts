export interface RenderCar {
  id: string;
  x: number;
  z: number;
  h: number;
  v: number;
  boost: number;
}

/** 차의 겉모습 정보 */
export interface CarLook {
  id: string;
  name: string;
  color: string;
  /** 학생 그림(배경 정리된 PNG). 있으면 그림으로 차체를 만듭니다. */
  imageUrl?: string | null;
  /** 3D 변환이 끝난 GLB. 있으면 이걸 우선 씁니다. */
  glbUrl?: string | null;
  /** 3D 모델 앞뒤 뒤집기 */
  flip?: boolean;
}

export type CameraMode =
  | { mode: 'chase'; followId: string }
  | { mode: 'follow' }
  | { mode: 'overview' };

export const CAR_COLORS = [
  '#ff5a5f', '#ffb400', '#2ec4b6', '#3a86ff', '#8338ec', '#ff7ac6', '#70c13a', '#ff8c42', '#00b4d8', '#b08968',
];
