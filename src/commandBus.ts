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
