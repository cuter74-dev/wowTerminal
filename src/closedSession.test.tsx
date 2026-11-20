// 끝난 세션 시험 (#195). 셸·SSH 채널이 끝난 뒤의 크기 맞춤·입력 보내기는 "session not found"·"channel: …"로
// 거부된다. 예전엔 받는 곳이 없어 처리 안 된 오류로 오류 보고에 올라갔다 — 이제 조용히 넘어가는지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import { getTerminal } from "./terminalRegistry";
import { SESSION_ID, invokeLog, resetTauriMock, setInvokeHandler } from "./test/tauriMock";

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let root: Root;
let container: HTMLDivElement;
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
const proto = HTMLElement.prototype;
const saved = {
  w: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
  h: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
};
const setSize = (w: number, hgt: number) => {
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => w });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => hgt });
};

beforeEach(() => {
  resetTauriMock();
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  vi.useFakeTimers();
  setInvokeHandler(async (cmd) => {
    invokeLog.push(cmd);
    if (cmd === "pty_spawn") return SESSION_ID;
    if (cmd === "pty_write" || cmd === "pty_resize") throw `session not found: ${SESSION_ID}`;
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
  process.off("unhandledRejection", onUnhandled);
  for (const [k, d] of [["clientWidth", saved.w], ["clientHeight", saved.h]] as const) {
    if (d) Object.defineProperty(proto, k, d);
    else delete (proto as unknown as Record<string, unknown>)[k];
  }
  vi.useRealTimers();
});

it("끝난 세션으로 가는 입력·크기 맞춤의 거부를 받아 넘긴다", async () => {
  await act(async () => {
    root.render(<Terminal source={{ kind: "local" }} paneId="closed-pane" termSettings={DEFAULT_SETTINGS.terminal} />);
  });
  for (let i = 0; i < 50 && !invokeLog.includes("pty_spawn"); i++) await advance(10);
  await advance(50);
  const handle = getTerminal("closed-pane")!;
  // AI 패널·에이전트 목록이 쓰는 입력 보내기
  handle.sendInput("ls\r");
  // 창 크기가 바뀌어 터미널 크기를 맞춤
  setSize(900, 700);
  handle.fit();
  await advance(50);
  // 처리 안 된 거부는 마이크로태스크가 다 돈 뒤 알려진다 — 진짜 시계로 잠깐 기다린다.
  vi.useRealTimers();
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  expect(invokeLog).toContain("pty_write");
  expect(invokeLog).toContain("pty_resize");
  expect(invokeLog.filter((c) => c === "pty_resize").length).toBeGreaterThanOrEqual(2);
  expect(unhandled).toEqual([]);
});
