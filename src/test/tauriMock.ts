// 테스트용 Tauri 목 (#158). 세션 스폰은 고정 id로 성공시키고, pty_write로 간 바이트를 모은다.
// 이벤트(listen)는 등록만 받고 아무것도 보내지 않는다 — 입력 리플레이는 PTY 에코가 필요 없다.

export const SESSION_ID = "test-session";

export const ptyWrites: string[] = [];
export const invokeLog: string[] = [];

export function resetTauriMock(): void {
  ptyWrites.length = 0;
  invokeLog.length = 0;
}

function decodeB64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  invokeLog.push(cmd);
  switch (cmd) {
    case "pty_spawn":
      return SESSION_ID;
    case "pty_write":
      ptyWrites.push(decodeB64(String(args?.dataB64 ?? "")));
      return undefined;
    case "session_history":
      return "";
    default:
      return undefined;
  }
}

export async function listen(): Promise<() => void> {
  return () => {};
}
