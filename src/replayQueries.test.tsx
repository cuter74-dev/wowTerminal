// 다시 붙을 때 옛 출력 재생 시험 (#174, #193). 실제 <Terminal>을 happy-dom에 띄워(Tauri만 목) 데몬에
// 살아 있던 세션에 재attach하고, 재생한 기록 속 옛 터미널 질의에 대한 응답이 세션으로 가지 않는지,
// 옛 알림·클립보드 복사·상태 보고가 다시 일어나지 않는지, 프로그램이 화면을 다시 그리게 하는지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import { onAgentStatus, onPaneNotice } from "./commandBus";

const h = vi.hoisted(() => ({ copied: [] as string[] }));
vi.mock("./clipboard", async (orig) => ({
  ...(await orig<typeof import("./clipboard")>()),
  copyText: async (text: string) => {
    h.copied.push(text);
    return true;
  },
}));
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
const PROBE_REPLY = "\x1b]7501;?\x1b\\";

let root: Root;
let container: HTMLDivElement;
/** 이번 시험에서 데몬이 돌려줄 옛 출력. */
let history = HISTORY;
/** 세션 크기 바꾸기 요청 — 순서대로 [cols, rows]. */
let resizes: [number, number][] = [];

beforeEach(() => {
  resetTauriMock();
  history = HISTORY;
  resizes = [];
  h.copied.length = 0;
  localStorage.clear();
  vi.useFakeTimers();
  setInvokeHandler(async (cmd, args) => {
    invokeLog.push(cmd);
    if (cmd === "pty_spawn") return SESSION_ID; // 힌트와 같은 id = 살아 있던 세션에 재attach
    if (cmd === "session_history") return b64(history);
    if (cmd === "pty_resize") resizes.push([Number(args?.cols), Number(args?.rows)]);
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

async function mountRestored(paneId: string) {
  await act(async () => {
    root.render(
      <Terminal
        source={{ kind: "local" }}
        paneId={paneId}
        termSettings={DEFAULT_SETTINGS.terminal}
        restoreSessionId={SESSION_ID}
      />,
    );
  });
  for (let i = 0; i < 50 && !invokeLog.includes("session_history"); i++) await advance(10);
  await advance(500);
}

it("재생한 OSC 7501 질의에는 답하지 않고, 지금 질의에는 답한다 (#193)", async () => {
  history = "\x1b]7501;?\x1b\\❯ \r\n";
  await mountRestored("replay-probe");
  expect(ptyWrites.join("")).not.toContain(PROBE_REPLY);
  await act(async () => emitEvent("pty:output", { session_id: SESSION_ID, data_b64: b64("\x1b]7501;?\x1b\\") }));
  await advance(50);
  expect(ptyWrites.join("")).toContain(PROBE_REPLY);
});

it("재생한 옛 상태 보고는 다 읽은 뒤 마지막 것만 알린다 (#193)", async () => {
  const events: string[] = [];
  const off = onAgentStatus(({ paneId, agent, state }) => {
    if (paneId === "replay-status") events.push(agent ? `${agent}:${state}` : "none");
  });
  // 옛 기록: 일하는 중 → 끝남. 켜자마자 "끝남"(일하는 중 → 쉬는 중)으로 보이면 안 된다.
  history =
    "\x1b]7501;state=working:app=claude-code\x07✻ Working…\r\n" + "\x1b]7501;state=done:app=claude-code\x07done\r\n";
  await mountRestored("replay-status");
  expect(events).toEqual(["claude:idle"]);
  // 그 뒤 실제 보고는 그대로 알린다.
  await act(async () =>
    emitEvent("pty:output", { session_id: SESSION_ID, data_b64: b64("\x1b]7501;state=working:app=claude-code\x07") }),
  );
  await advance(50);
  expect(events).toEqual(["claude:idle", "claude:working"]);
  off();
});

it("재생한 옛 알림·벨·클립보드 복사는 다시 일어나지 않는다 (#193)", async () => {
  const notices: string[] = [];
  const off = onPaneNotice(({ paneId, body }) => {
    if (paneId === "replay-notice") notices.push(body ?? "(bell)");
  });
  history =
    "\x1b]9;build finished\x07\x07\x1b]777;notify;CI;green\x07" + "\x1b]52;c;" + btoa("old secret") + "\x07$ \r\n";
  await mountRestored("replay-notice");
  expect(notices).toEqual([]);
  expect(h.copied).toEqual([]);
  // 지금 오는 알림·복사는 그대로.
  await act(async () =>
    emitEvent("pty:output", {
      session_id: SESSION_ID,
      data_b64: b64("\x1b]9;tests passed\x07\x1b]52;c;" + btoa("new") + "\x07"),
    }),
  );
  await advance(50);
  expect(notices).toEqual(["tests passed"]);
  expect(h.copied).toEqual(["new"]);
  off();
});

describe("다시 그리게 하기 (#193)", () => {
  const proto = HTMLElement.prototype;
  const saved = {
    w: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    h: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
  };
  const setSize = (w: number, hgt: number) => {
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => w });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => hgt });
  };
  afterEach(() => {
    // 덮어쓴 크기를 원래(happy-dom: 레이아웃이 없어 0)로 되돌린다.
    for (const [k, d] of [["clientWidth", saved.w], ["clientHeight", saved.h]] as const) {
      if (d) Object.defineProperty(proto, k, d);
      else delete (proto as unknown as Record<string, unknown>)[k];
    }
  });

  it("보이는 패널은 재생 뒤 높이를 한 줄 줄였다 되돌린다", async () => {
    setSize(800, 600);
    await mountRestored("replay-nudge");
    const n = resizes.length;
    expect(n).toBeGreaterThanOrEqual(2);
    const [cols, rows] = resizes[n - 1];
    expect(resizes[n - 2]).toEqual([cols, rows - 1]);
  });

  it("숨은 패널(크기 0)은 건드리지 않는다 — 보일 때 실제 크기로 바뀌며 다시 그린다", async () => {
    setSize(0, 0);
    await mountRestored("replay-hidden");
    const rowsSeen = new Set(resizes.map(([, r]) => r));
    expect(rowsSeen.size).toBeLessThanOrEqual(1);
  });
});
