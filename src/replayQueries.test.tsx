// 다시 붙을 때 옛 출력 재생 시험 (#174). 실제 <Terminal>을 happy-dom에 띄워(Tauri만 목) 데몬에
// 살아 있던 세션에 재attach하고, 재생한 기록 속 옛 터미널 질의에 대한 응답이 세션으로 가지 않는지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import {
  SESSION_ID,
  emitEvent,
  invokeLog,
  ptyWrites,
  resetTauriMock,
  setInvokeHandler,
} from "./test/tauriMock";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

// tmux가 시작할 때 보내는 장치 속성 질의(DA1·DA2)가 섞인 옛 출력.
const HISTORY = "demo@api-02:~$ tmux\r\n\x1b[c\x1b[>c02:28:24  synced batch 1\r\n";
const DA1_REPLY = "\x1b[?1;2c";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  resetTauriMock();
  localStorage.clear();
  vi.useFakeTimers();
  setInvokeHandler(async (cmd, args) => {
    invokeLog.push(cmd);
    if (cmd === "pty_spawn") return SESSION_ID; // 힌트와 같은 id = 살아 있던 세션에 재attach
    if (cmd === "session_history") return b64(HISTORY);
    if (cmd === "pty_write") {
      const bin = atob(String(args?.dataB64 ?? ""));
      ptyWrites.push(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    }
    return undefined;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setInvokeHandler(null);
  vi.useRealTimers();
});

it("재생한 옛 질의에는 답하지 않고, 그 뒤 실제 질의에는 답한다 (#174)", async () => {
  await act(async () => {
    root.render(
      <Terminal
        source={{ kind: "local" }}
        paneId="replay-queries"
        termSettings={DEFAULT_SETTINGS.terminal}
        restoreSessionId={SESSION_ID}
      />,
    );
  });
  for (let i = 0; i < 50 && !invokeLog.includes("session_history"); i++) await advance(10);
  expect(invokeLog).toContain("session_history");
  await advance(500);
  expect(ptyWrites.join("")).not.toContain(DA1_REPLY);
  expect(ptyWrites.join("")).not.toContain("\x1b[>");

  // 재생이 끝난 뒤 프로그램이 지금 묻는 질의에는 예전처럼 답해야 한다.
  await act(async () => emitEvent("pty:output", { session_id: SESSION_ID, data_b64: b64("\x1b[c") }));
  await advance(100);
  expect(ptyWrites.join("")).toContain(DA1_REPLY);
});
