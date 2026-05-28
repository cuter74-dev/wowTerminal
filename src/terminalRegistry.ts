// 활성 터미널(leaf pane)의 버퍼 읽기 / 입력 주입을 컴포넌트 트리 밖에서 접근하기 위한
// 모듈 레벨 레지스트리. AIPanel이 포커스된 패널의 출력을 컨텍스트로 가져오거나,
// AI가 제안한 명령을 그 패널에 입력할 때 사용한다.

export interface TerminalHandle {
  /** 최근 maxLines 줄의 화면/스크롤백 텍스트 (trim된 빈 줄 제거). */
  getRecentText: (maxLines?: number) => string;
  /** 텍스트를 그 세션에 입력으로 보냄 (예: AI 제안 명령). 개행은 호출자가 포함. */
  sendInput: (text: string) => void;
}

const registry = new Map<string, TerminalHandle>();

export function registerTerminal(id: string, handle: TerminalHandle): void {
  registry.set(id, handle);
}

export function unregisterTerminal(id: string): void {
  registry.delete(id);
}

export function getTerminal(id: string | null | undefined): TerminalHandle | undefined {
  if (!id) return undefined;
  return registry.get(id);
}

// 세션 인계용: 다른 윈도우로 분리된 sessionId는 원본 Terminal unmount 시 kill하지 않는다.
const detachedSessions = new Set<string>();

export function markSessionDetached(sessionId: string): void {
  detachedSessions.add(sessionId);
}

export function isSessionDetached(sessionId: string): boolean {
  return detachedSessions.has(sessionId);
}
