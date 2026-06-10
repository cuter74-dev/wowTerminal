// 터미널 명령 완료(OSC 133 D) 이벤트 버스 — Terminal → App(알림/탭 배지) 연결.
// PaneView를 거치지 않도록 모듈 버스로 처리.

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
