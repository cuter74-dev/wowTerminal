// 터미널 명령 완료(OSC 133 D) 이벤트 버스 — Terminal → App(알림/탭 배지) 연결.
// PaneView를 거치지 않도록 모듈 버스로 처리.
import type { AgentKind, AgentState } from "./aiActivity";

export type CommandDoneInfo = {
  paneId: string;
  durationMs: number;
  exit: number;
};

type Listener = (info: CommandDoneInfo) => void;

const listeners = new Set<Listener>();

export function onCommandDone(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitCommandDone(info: CommandDoneInfo): void {
  listeners.forEach((l) => l(info));
}

// --- 터미널 제목(OSC 0/2) 변경 버스 — 탭 라벨 동기화 (#89). tmux가 set-titles on이면
// tmux 윈도우 제목이, 일반 셸이면 셸이 설정한 제목이 흘러온다. ---

export type TitleInfo = { paneId: string; title: string };

type TitleListener = (info: TitleInfo) => void;

const titleListeners = new Set<TitleListener>();

export function onTitleChange(cb: TitleListener): () => void {
  titleListeners.add(cb);
  return () => titleListeners.delete(cb);
}

export function emitTitleChange(info: TitleInfo): void {
  titleListeners.forEach((l) => l(info));
}

// --- AI 에이전트 상태 버스 (#180, #187) — Terminal(화면 판정) → App(탭 표시·알림·에이전트 목록).
// agent가 null이면 그 패널에 에이전트가 없다(끝났거나 패널이 닫힘). ---
export type AgentStatusInfo = {
  paneId: string;
  agent: AgentKind | null;
  state: AgentState | null;
  /** 에이전트가 알려 준 진행률 0~100(OSC 7501 progress·OSC 9;4, #189). 모르면 null. */
  progress?: number | null;
};
type AgentStatusListener = (info: AgentStatusInfo) => void;
const agentStatusListeners = new Set<AgentStatusListener>();
export function onAgentStatus(cb: AgentStatusListener): () => void {
  agentStatusListeners.add(cb);
  return () => agentStatusListeners.delete(cb);
}
export function emitAgentStatus(info: AgentStatusInfo): void {
  agentStatusListeners.forEach((l) => l(info));
}

// --- 프로그램이 보낸 알림·벨 버스 (#189) — Terminal(OSC 9/777/99, BEL) → App(탭 알림 점·데스크톱 알림).
// body가 없으면 벨이다(점만 붙인다). ---
export type PaneNoticeInfo = { paneId: string; title?: string; body?: string };
type PaneNoticeListener = (info: PaneNoticeInfo) => void;
const paneNoticeListeners = new Set<PaneNoticeListener>();
export function onPaneNotice(cb: PaneNoticeListener): () => void {
  paneNoticeListeners.add(cb);
  return () => paneNoticeListeners.delete(cb);
}
export function emitPaneNotice(info: PaneNoticeInfo): void {
  paneNoticeListeners.forEach((l) => l(info));
}
