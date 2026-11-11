// AI 에이전트 작업 표시 시험 (#180). 실제 <Terminal>을 happy-dom에 띄워(Tauri만 목) 에이전트의
// 상태 줄 출력을 흘려 보내고, 일하는 중/끝남 판정이 버스로 나가는지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import { looksWorking } from "./aiActivity";
import { onAiActivity } from "./commandBus";
import { SESSION_ID, emitEvent, invokeLog, resetTauriMock } from "./test/tauriMock";

describe("looksWorking", () => {
  it.each([
    ["· Meandering…", true],
    ["✳ Wrangling… (2s · ↓ 229 tokens · thinking with xhigh effort)", true],
    ["* Thinking…", true],
    ["✻ Baked for 1s · done 3:44 PM", false],
    ["⏺ Searching for files…", false],
    ["✻ Thinking… (12s · ↓ 1.2k tokens · esc to interrupt)", true],
    ["• Working (5s • Esc to interrupt)", true],
    ["⠋ Generating the plan (esc to cancel, 3s)", true],
    ["✻ Thinking… (esc to interrupt · ctrl+t to hide todos)", true],
    ["> 무엇을 도와드릴까요?", false],
    ["Press esc to interrupt the agent at any time.", false],
    ["the line ends with (esc to interrupt) as text", false],
    ["demo@macbook ~/projects % ls", false],
  ])("%s → %s", (line, want) => {
    expect(looksWorking(["", line, ""])).toBe(want);
  });
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

let root: Root;
let container: HTMLDivElement;
const events: boolean[] = [];
let off: () => void;

beforeEach(async () => {
  resetTauriMock();
  vi.useFakeTimers();
  events.length = 0;
  off = onAiActivity(({ paneId, working }) => {
    if (paneId === "ai-pane") events.push(working);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <Terminal source={{ kind: "local" }} paneId="ai-pane" termSettings={DEFAULT_SETTINGS.terminal} />,
    );
  });
  for (let i = 0; i < 50 && !invokeLog.includes("pty_spawn"); i++) await advance(10);
  await advance(50);
});

afterEach(async () => {
  off();
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function output(text: string) {
  await act(async () => emitEvent("pty:output", { session_id: SESSION_ID, data_b64: b64(text) }));
}

it("상태 줄이 뜨면 일하는 중, 1.5초 넘게 사라지면 끝남 (#180)", async () => {
  await output("\x1b[2J\x1b[H❯ fix the build\r\n\r\n✳ Wrangling… (3s · ↓ 229 tokens)\r\n");
  await advance(400);
  expect(events).toEqual([true]);

  // 도구 호출 사이에 잠깐 사라졌다가 다시 뜨면 끝남으로 보지 않는다.
  await output("\x1b[3;1H\x1b[2K");
  await advance(700);
  await output("\x1b[3;1H✶ Running tests… (9s · ↓ 1.1k tokens)");
  await advance(2000);
  expect(events).toEqual([true]);

  // 상태 줄이 사라지고 그대로면 끝남.
  await output("\x1b[3;1H\x1b[2K✻ Baked for 12s · done 3:44 PM\r\n❯ ");
  await advance(400);
  expect(events).toEqual([true]);
  await advance(1500);
  expect(events).toEqual([true, false]);
});

it("에이전트가 없는 평범한 출력은 아무것도 알리지 않는다", async () => {
  await output("demo@macbook ~ % npm run build\r\nbuilding…\r\ndone in 3.2s\r\n");
  await advance(3000);
  expect(events).toEqual([]);
});
