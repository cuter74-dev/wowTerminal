// AI 명령 카드 → 터미널 입력 시험 (#172). 실제 <Terminal>을 happy-dom에 렌더하고(Tauri만 목),
// PTY로 간 바이트를 본다. 사용자가 Enter를 누르기 전에는 어떤 줄도 실행되면(= 괄호 밖 \r) 안 된다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import { getTerminal, insertCommand } from "./terminalRegistry";
import { SESSION_ID, emitEvent, invokeLog, ptyWrites, resetTauriMock } from "./test/tauriMock";

const PANE = "insert-command";
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** 셸 출력을 흉내 낸다(예: bracketed paste 켜기). */
async function shellOutput(text: string) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  await act(async () => emitEvent("pty:output", { session_id: SESSION_ID, data_b64: b64 }));
  await advance(50);
}

/** insertCommand 후 PTY로 간 바이트. */
async function send(code: string): Promise<{ ok: boolean; sent: string }> {
  ptyWrites.length = 0;
  const ok = insertCommand(getTerminal(PANE)!, code);
  await advance(200);
  return { ok, sent: ptyWrites.join("") };
}

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  resetTauriMock();
  localStorage.clear();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <Terminal source={{ kind: "local" }} paneId={PANE} termSettings={DEFAULT_SETTINGS.terminal} />,
    );
  });
  for (let i = 0; i < 50 && !invokeLog.includes("pty_spawn"); i++) await advance(10);
  await advance(50);
  expect(getTerminal(PANE)).toBeDefined();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("insertCommand (#172)", () => {
  it("한 줄 명령은 Enter 없이 그대로 입력한다", async () => {
    expect(await send("ls -la")).toEqual({ ok: true, sent: "ls -la" });
  });

  it("bracketed paste가 꺼진 셸에는 여러 줄을 보내지 않는다", async () => {
    expect(await send("chmod +x deploy.sh\n./deploy.sh")).toEqual({ ok: false, sent: "" });
    // 한 줄 안의 \r도 여러 줄로 본다 — 그대로 쓰면 그 자리에서 실행된다.
    expect(await send("rm -rf build\rnpm run build")).toEqual({ ok: false, sent: "" });
  });

  it("bracketed paste가 켜진 셸에는 여러 줄을 괄호로 감싸 보내 Enter 전까지 실행되지 않는다", async () => {
    await shellOutput("\x1b[?2004h");
    const { ok, sent } = await send("chmod +x deploy.sh\n./deploy.sh");
    expect(ok).toBe(true);
    expect(sent).toBe("\x1b[200~chmod +x deploy.sh\r./deploy.sh\x1b[201~");
    // 셸이 모드를 끄면 다시 막는다.
    await shellOutput("\x1b[?2004l");
    expect(await send("a\nb")).toEqual({ ok: false, sent: "" });
  });
});
