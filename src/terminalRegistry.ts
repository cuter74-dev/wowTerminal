// 활성 터미널(leaf pane)의 버퍼 읽기 / 입력 주입을 컴포넌트 트리 밖에서 접근하기 위한
// 모듈 레벨 레지스트리. AIPanel이 포커스된 패널의 출력을 컨텍스트로 가져오거나,
// AI가 제안한 명령을 그 패널에 입력할 때 사용한다.

export interface TerminalHandle {
  /** 최근 maxLines 줄의 화면/스크롤백 텍스트 (trim된 빈 줄 제거). */
  getRecentText: (maxLines?: number) => string;
  /** 텍스트를 그 세션에 입력으로 보냄 (예: AI 제안 명령). 개행은 호출자가 포함. */
  sendInput: (text: string) => void;
  /** 컨테이너 크기에 맞춰 다시 fit (탭 전환/표시 시 — display:none에서 복귀 후 필요). */
  fit: () => void;
  /** 현재 화면+스크롤백을 ANSI 포함 문자열로 직렬화 (세션 인계 시 새 창 복원용). */
  serialize: () => string;
  /** OSC 7로 추적한 셸 현재 작업 디렉토리 (없으면 null). 파일 브라우저 시작 위치용. */
  getCwd: () => string | null;
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

// --- 입력 브로드캐스트 (#59): 켜면 한 패널에 친 입력을 다른 모든 패널에도 보낸다. ---
let broadcastEnabled = false;
export function setBroadcastEnabled(v: boolean): void {
  broadcastEnabled = v;
}
export function isBroadcastEnabled(): boolean {
  return broadcastEnabled;
}
/** origin을 제외한 모든 등록 터미널에 text를 입력으로 보낸다(브로드캐스트 ON일 때만).
 *  sendInput은 PTY로 직접 쓰므로 대상 패널의 onData를 다시 거치지 않아 루프가 없다. */
export function broadcastInput(originId: string, text: string): void {
  if (!broadcastEnabled) return;
  registry.forEach((h, id) => {
    if (id !== originId) h.sendInput(text);
  });
}

// 세션 인계 보호는 백엔드(SshManager/PtyManager의 detach_guard)에서 처리한다.
// 원본 창의 kill 명령은 그대로 보내되, 백엔드가 인계된 세션의 첫 kill을 무시한다.
