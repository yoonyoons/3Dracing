// 교사 화면(호스트) ↔ 학생 기기가 Supabase Realtime 채널로 주고받는 데이터 모양.
//
// 채널
//   lobby:<방코드>        교사 → 모두      방 상태(room), 방 닫힘(closed)
//   join:<방코드>         학생 → 교사      입장 요청(join) / 교사 → 학생 거절(deny)
//   p:<방코드>:<비밀값>   학생 ↔ 교사      학생 한 명 전용 (입력, 살아 있음 알림, 환영, 내보내기)
//   race:<방코드>         교사 → 달리는 학생  레이스 스냅샷(snap)
//
// Supabase 무료 플랜은 초당 메시지 100개까지라서(받는 사람 수만큼 따로 셈),
// 스냅샷 빈도와 입력 전송을 아껴 씁니다.

export type CarStatus =
  /** 그림 없음: 기본 카트 */
  | 'none'
  /** 그림 차체로 달릴 수 있음 */
  | 'drawing'
  /** 3D 변환 중 (그동안은 그림 차체로 달림) */
  | 'processing'
  /** 3D 모델(GLB) 준비 완료 */
  | 'ready'
  /** 3D 변환 실패: 그림 차체로 계속 달림 */
  | 'failed';

export interface CarView {
  status: CarStatus;
  /** 그림 파일 참조 ("car:<id>:image:<버전>") */
  imageUrl: string | null;
  /** 3D 모델 참조 ("car:<id>:glb:<버전>") */
  glbUrl: string | null;
  progress: number;
  hidden: boolean;
  /** 앞뒤 뒤집기 */
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
  /** 레이스마다 새로 정해지는 번호 */
  id: string;
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
  plan: RacePlanView[] | null;
  planIndex: number;
  race: RaceInfo | null;
  lastResults: RaceResult[] | null;
  finalResults: RaceResult[] | null;
  maxPlayers: number;
  /** 3D 변환 모드 */
  generator: 'pregenerated' | 'mock';
}

/**
 * 레이스 상태 스냅샷.
 * c[i] = [x, z, h, v, boost, prog, finished(0|1)] — RaceInfo.racers 와 같은 순서
 */
export interface Snap {
  /** 레이스 번호 */
  r: string;
  /** 레이스 시계(ms) */
  t: number;
  c: number[][];
  /** 순위 순서대로의 racers 인덱스 */
  o: number[];
}

/** 학생 → 교사 (전용 채널) */
export type PlayerMessage =
  /** fresh: 페이지를 새로 열었음 → 방 상태를 다시 보내 달라는 뜻 */
  | { type: 'hello'; fresh?: boolean }
  | { type: 'in'; e: [number, number, number, number][] }
  | { type: 'car' }
  | { type: 'leave' }
  | { type: 'ping'; t: number };

/** 교사 → 학생 (전용 채널) */
export type HostMessage =
  | { type: 'welcome'; pid: string; name: string }
  | { type: 'kicked'; reason: string }
  | { type: 'pong'; t: number };

export interface JoinRequest {
  nonce: string;
  name: string;
  pid: string;
  chan: string;
}

export const LIMITS = {
  maxPlayers: 30,
  minHeat: 2,
  maxHeat: 10,
  maxLaps: 9,
  countdownMs: 4500,
  /** 1등 도착 후 이만큼 지나면 레이스를 끝냅니다(초) */
  finishGrace: 25,
  maxRaceSeconds: 300,
  /** 학생 입력을 묶어서 보내는 간격(ms) */
  inputBatchMs: 300,
  /** 학생이 "살아 있어요"를 보내는 간격(ms) */
  heartbeatMs: 10_000,
  /** 이 시간 동안 소식이 없으면 접속이 끊긴 것으로 봅니다(ms) */
  offlineMs: 32_000,
};

/**
 * 달리는 인원에 맞춘 스냅샷 빈도(초당). 메시지 수 = 빈도 × (받는 학생 수 + 보낸 1개)
 * 입력까지 더해 초당 100개를 넘지 않도록 맞춥니다.
 */
export function snapRateFor(racers: number): number {
  return Math.max(4, Math.min(10, Math.floor(48 / (racers + 1))));
}
