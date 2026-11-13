// 서버 ↔ 클라이언트가 주고받는 데이터 모양.

export type CarStatus =
  /** 그림 없음: 기본 카트 */
  | 'none'
  /** 그림 차체(즉석 변환)로 달릴 수 있음. 3D 변환은 아직이거나 하지 않음 */
  | 'drawing'
  /** 3D 변환 대기/진행 중 (그동안은 그림 차체로 달림) */
  | 'processing'
  /** 3D 모델(GLB) 준비 완료 */
  | 'ready'
  /** 3D 변환 실패: 그림 차체로 계속 달림 */
  | 'failed';

export interface CarView {
  status: CarStatus;
  /** 배경을 정리한 그림 PNG 주소 */
  imageUrl: string | null;
  glbUrl: string | null;
  /** 0~1, 변환 진행률 */
  progress: number;
  /** 교사가 숨긴 그림 */
  hidden: boolean;
  /** 3D 모델의 앞뒤를 뒤집어 보여 줄지 */
  flip: boolean;
  message?: string;
}

export interface PlayerView {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  car: CarView;
}

export interface RoomSettings {
  trackId: string;
  laps: number;
  /** 한 번에 달리는 인원 (2~10) */
  heatSize: number;
}

export interface RaceResult {
  id: string;
  name: string;
  place: number;
  /** 완주 시간(초). 완주 못 했으면 null */
  time: number | null;
}

export interface RacePlanView {
  label: string;
  ids: string[];
  isFinal: boolean;
  results: RaceResult[] | null;
}

export type RoomPhase = 'lobby' | 'countdown' | 'racing' | 'results' | 'podium';

export interface RaceInfo {
  trackId: string;
  laps: number;
  racers: string[];
  label: string;
  isFinal: boolean;
  /** 레이스 시계 기준 출발 시각(ms) */
  startAt: number;
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: PlayerView[];
  /** 조 편성. 아직 안 했으면 null */
  plan: RacePlanView[] | null;
  /** 다음에 달릴(또는 지금 달리는) 조 번호 */
  planIndex: number;
  race: RaceInfo | null;
  lastResults: RaceResult[] | null;
  finalResults: RaceResult[] | null;
  maxPlayers: number;
}

/**
 * 레이스 상태 스냅샷.
 * c[i] = [x, z, h, v, boost, prog, finished(0|1)] — RaceInfo.racers 와 같은 순서
 */
export interface Snap {
  /** 레이스 시계(ms) */
  t: number;
  c: number[][];
  /** 순위 순서대로의 racers 인덱스 */
  o: number[];
}

export type Ack<T> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServer {
  'host:create': (cb: Ack<{ code: string; hostToken: string }>) => void;
  'host:resume': (p: { code: string; hostToken: string }, cb: Ack<{}>) => void;
  'host:settings': (p: Partial<RoomSettings>) => void;
  'host:plan': () => void;
  'host:start': () => void;
  'host:next': () => void;
  'host:reset': () => void;
  'host:stop': () => void;
  'host:kick': (playerId: string) => void;
  'host:close': () => void;
  'player:join': (p: { code: string; name: string; playerId?: string; token?: string }, cb: Ack<{ playerId: string; token: string; name: string }>) => void;
  'player:leave': () => void;
  /** [steer, throttle, brake] */
  in: (i: [number, number, number]) => void;
  rtt: (cb: () => void) => void;
}

export interface ServerToClient {
  room: (view: RoomView) => void;
  snap: (snap: Snap) => void;
  kicked: (reason: string) => void;
  closed: () => void;
}

export const LIMITS = {
  maxPlayers: 30,
  minHeat: 2,
  maxHeat: 10,
  maxLaps: 9,
  countdownMs: 4000,
  /** 1등 도착 후 이만큼 지나면 레이스를 끝냅니다(초) */
  finishGrace: 25,
  maxRaceSeconds: 300,
  snapRate: 15,
};
