// 에이전트 창의 키 시험 (#190). 실제 <Terminal>을 happy-dom에 띄워(Tauri만 목) Shift+Enter가
// 에이전트 창에서는 Ctrl+J(\n, 줄바꿈)로, 평범한 셸에서는 그대로 Enter(\r)로 가는지 본다.
// "⌥를 Meta로" 설정은 여기서 시험하지 않는다 — xterm이 Node 환경을 늘 맥이 아닌 것으로 보아(⌥가 원래
// ESC로 감) 맥의 차이를 재현할 수 없다. 실제 macOS 앱에서 확인한다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import { SESSION_ID, emitEvent, invokeLog, ptyWrites, resetTauriMock } from "./test/tauriMock";

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let root: Root;
let container: HTMLDivElement;
let ta: HTMLTextAreaElement;

async function mount(termSettings = DEFAULT_SETTINGS.terminal) {
  await act(async () => {
    root.render(<Terminal source={{ kind: "local" }} paneId="keys-pane" termSettings={termSettings} />);
  });
  for (let i = 0; i < 50 && !invokeLog.includes("pty_spawn"); i++) await advance(10);
  await advance(50);
  ta = container.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea")!;
  ta.focus();
}

async function output(text: string) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  await act(async () => emitEvent("pty:output", { session_id: SESSION_ID, data_b64: b64 }));
  await advance(400); // 화면 판정(300ms 뒤)까지
}

async function key(init: KeyboardEventInit) {
  ptyWrites.length = 0;
  await act(async () => {
    ta.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  await advance(20);
  return ptyWrites.join("");
}

const RULE = "─".repeat(60);
const shiftEnter = { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true };

beforeEach(() => {
  resetTauriMock();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Shift+Enter (#190)", () => {
  it("에이전트 창에서는 줄바꿈(Ctrl+J)", async () => {
    await mount();
    await output("\x1b[2J\x1b[H" + [RULE, "❯ first line", RULE, "  ⏸ manual mode on"].join("\r\n"));
    expect(await key(shiftEnter)).toBe("\n");
  });

  it("평범한 셸에서는 그대로 Enter", async () => {
    await mount();
    await output("demo@mac ~ % ");
    expect(await key(shiftEnter)).toBe("\r");
  });

  it("한글 조합 중(229)에는 건드리지 않는다", async () => {
    await mount();
    await output("\x1b[2J\x1b[H" + [RULE, "❯ ", RULE].join("\r\n"));
    expect(await key({ ...shiftEnter, keyCode: 229 })).not.toBe("\n");
  });
});
