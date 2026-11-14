// AI 에이전트 상태 시험 (#180, #187). 실제 <Terminal>을 happy-dom에 띄워(Tauri만 목) 에이전트
// 화면을 흘려 보내고, 일하는 중·입력 기다림·쉬는 중·종료 판정이 버스로 나가는지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import { looksWorking } from "./aiActivity";
import { onAgentStatus, onPaneNotice } from "./commandBus";
import { SESSION_ID, emitEvent, invokeLog, ptyWrites, resetTauriMock } from "./test/tauriMock";

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
const events: string[] = [];
let off: () => void;

beforeEach(async () => {
  resetTauriMock();
  vi.useFakeTimers();
  events.length = 0;
  off = onAgentStatus(({ paneId, agent, state }) => {
    if (paneId === "ai-pane") events.push(agent ? `${agent}:${state}` : "none");
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

// Claude Code 화면 한 장을 통째로 다시 그린다 — 입력 상자(테두리 / ❯ / 테두리) 위에 본문 줄.
const RULE = "─".repeat(60);
const claude = (...body: string[]) =>
  output("\x1b[2J\x1b[H" + [...body, RULE, "❯ ", RULE, "  ⏸ manual mode on"].join("\r\n"));

it("상태 줄이 뜨면 일하는 중, 1.5초 넘게 사라지면 쉬는 중 (#180)", async () => {
  await claude("❯ fix the build", "", "✳ Wrangling… (3s · ↓ 229 tokens)");
  await advance(400);
  expect(events).toEqual(["claude:working"]);

  // 도구 호출 사이에 잠깐 사라졌다가 다시 뜨면 끝남으로 보지 않는다.
  await claude("❯ fix the build", "", "⏺ Bash(npm test)");
  await advance(700);
  await claude("❯ fix the build", "", "✶ Running tests… (9s · ↓ 1.1k tokens)");
  await advance(2000);
  expect(events).toEqual(["claude:working"]);

  // 상태 줄이 사라지고 그대로면 쉬는 중.
  await claude("❯ fix the build", "", "✻ Baked for 12s · done 3:44 PM");
  await advance(400);
  expect(events).toEqual(["claude:working"]);
  await advance(1500);
  expect(events).toEqual(["claude:working", "claude:idle"]);
});

it("권한 확인 창은 바로 입력 기다림, 답하면 바로 풀린다 (#187)", async () => {
  await claude("❯ clean up", "", "✳ Thinking… (2s)");
  await advance(400);
  await output(
    "\x1b[2J\x1b[H" +
      ["❯ clean up", RULE, " Bash command", " rm -rf build", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", " Esc to cancel · Tab to amend"].join("\r\n"),
  );
  await advance(400);
  expect(events).toEqual(["claude:working", "claude:blocked"]);
  await claude("❯ clean up", "", "✶ Removing… (1s)");
  await advance(400);
  expect(events).toEqual(["claude:working", "claude:blocked", "claude:working"]);
});

it("에이전트가 끝나 셸로 돌아오면 3초 뒤 목록에서 빠진다 — 남은 상태 줄은 무시 (#187)", async () => {
  await claude("❯ hi", "", "✻ Brewed for 1s · done 3:44 PM");
  await advance(400);
  expect(events).toEqual(["claude:idle"]);
  // /exit 뒤: 마지막 상태 줄과 위 테두리가 남고, 셸 프롬프트가 아래 테두리를 덮는다.
  await output(
    "\x1b[2J\x1b[H" + ["❯ /exit", "✳ Bloviating…", RULE, "❯ %", "~/project % "].join("\r\n"),
  );
  await advance(400);
  expect(events).toEqual(["claude:idle"]);
  await advance(3000);
  expect(events).toEqual(["claude:idle", "none"]);
});

it("셸 통합이 명령 끝(OSC 133 D)을 알리면 입력 상자가 남아 있어도 바로 내린다 (#187)", async () => {
  await output("\x1b]133;C\x07");
  await claude("❯ hi", "", "✻ Brewed for 1s · done 3:44 PM");
  await advance(400);
  expect(events).toEqual(["claude:idle"]);
  // 상자를 지우지 못하고 끝난 경우: 상자 아래에 셸 프롬프트만 찍힌다.
  await output("\r\n\x1b]133;D;0\x07demo@mac ~ % ");
  await advance(400);
  expect(events).toEqual(["claude:idle", "none"]);
  await advance(5000);
  expect(events).toEqual(["claude:idle", "none"]);
  // 다음 명령(C)이 시작되면 다시 화면으로 판정한다.
  await output("\x1b]133;C\x07");
  await claude("❯ again", "", "✳ Thinking… (1s)");
  await advance(400);
  expect(events).toEqual(["claude:idle", "none", "claude:working"]);
});

it("에이전트가 없는 평범한 출력은 아무것도 알리지 않는다", async () => {
  await output("demo@macbook ~ % npm run build\r\nbuilding…\r\ndone in 3.2s\r\n");
  await advance(3000);
  expect(events).toEqual([]);
});

it("패널이 닫히면 에이전트도 내린다 (#187)", async () => {
  await claude("❯ hi");
  await advance(400);
  expect(events).toEqual(["claude:idle"]);
  await act(async () => root.unmount());
  expect(events).toEqual(["claude:idle", "none"]);
  root = createRoot(container); // afterEach가 다시 unmount한다
});

describe("에이전트 표준 신호 (#189)", () => {
  it("OSC 7501 질의에 답한다", async () => {
    await output("\x1b]7501;?\x1b\\");
    await advance(50);
    expect(ptyWrites.join("")).toContain("\x1b]7501;?\x1b\\");
  });

  it("상태 보고가 오는 동안은 그 보고를 따르고, clear면 내린다", async () => {
    await output("\x1b]7501;state=working:app=claude-code:progress=30\x07");
    await advance(50);
    expect(events).toEqual(["claude:working"]);
    // 화면에 상태 줄이 없어도(보고가 우선) 그대로 일하는 중.
    await output("plain output\r\n");
    await advance(2000);
    expect(events).toEqual(["claude:working"]);
    await output("\x1b]7501;state=blocked:app=claude-code:kind=permission\x07");
    await advance(50);
    await output("\x1b]7501;state=done:app=claude-code\x07");
    await advance(50);
    await output("\x1b]7501;state=clear\x07");
    await advance(50);
    expect(events).toEqual(["claude:working", "claude:blocked", "claude:idle", "none"]);
  });

  it("하위 작업(id 있음) 보고는 이 패널 상태로 쓰지 않는다", async () => {
    await output("\x1b]7501;state=working:app=claude-code:id=task-1\x07");
    await advance(50);
    expect(events).toEqual([]);
  });

  it("진행률을 함께 알린다", async () => {
    const got: (number | null | undefined)[] = [];
    const offP = onAgentStatus(({ paneId, progress }) => {
      if (paneId === "ai-pane") got.push(progress);
    });
    await output("\x1b]7501;state=working:app=claude-code:progress=30\x07");
    await advance(50);
    await output("\x1b]7501;state=working:app=claude-code:progress=60\x07");
    await advance(50);
    offP();
    expect(got).toEqual([30, 60]);
  });

  it("OSC 9·777 알림과 벨을 버스로 보낸다", async () => {
    const notices: unknown[] = [];
    const offN = onPaneNotice(({ paneId, ...n }) => {
      if (paneId === "ai-pane") notices.push(n);
    });
    await output("\x1b]9;Claude needs your permission\x07");
    await output("\x1b]777;notify;Codex;Task finished\x07");
    await output("\x07");
    await advance(50);
    offN();
    expect(notices).toEqual([
      { body: "Claude needs your permission" },
      { title: "Codex", body: "Task finished" },
      {},
    ]);
  });
});
