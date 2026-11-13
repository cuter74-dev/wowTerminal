// 에이전트 상태 판정 (#187). 기준 화면은 실제 에이전트를 가상 터미널(100×30)에 띄워 찍은 것이다
// (Claude Code 2.1.323, Codex 0.167.1 — 경로·세션 id는 가림). Gemini는 이 기기에 없어 소스의
// 문구로 만든 화면이다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanAgent, type AgentScan } from "./aiActivity";

const screen = (name: string) =>
  readFileSync(join(__dirname, "test/fixtures/agents", `${name}.txt`), "utf8").split("\n");

describe("scanAgent — 실제 화면 (#187)", () => {
  it.each<[string, AgentScan | null]>([
    ["claude-idle", { agent: "claude", state: "idle" }],
    ["claude-working", { agent: "claude", state: "working" }],
    ["claude-blocked", { agent: "claude", state: "blocked" }],
    ["claude-after-esc", { agent: "claude", state: "idle" }],
    // 종료 뒤에도 `✳ Bloviating…`이 남지만 입력 상자가 깨져 있다 → 에이전트 없음.
    ["claude-after-exit", null],
    ["codex-idle", { agent: "codex", state: "idle" }],
    ["codex-working", { agent: "codex", state: "working" }],
    ["codex-blocked", { agent: "codex", state: "blocked" }],
    ["codex-after-esc", { agent: "codex", state: "idle" }],
    ["codex-after-exit", null],
    ["gemini-idle", { agent: "gemini", state: "idle" }],
    ["gemini-working", { agent: "gemini", state: "working" }],
    ["gemini-blocked", { agent: "gemini", state: "blocked" }],
  ])("%s", (name, want) => {
    expect(scanAgent(screen(name))).toEqual(want);
  });
});

describe("scanAgent — 그 밖의 화면 (#187)", () => {
  it("Claude 질문 창(AskUserQuestion)은 입력 기다림", () => {
    const lines = [
      "❯ Use the AskUserQuestion tool once to ask me: which color do I prefer, red or blue.",
      "─".repeat(100),
      " ☐ Color",
      "Which color do you prefer, red or blue?",
      "❯ 1. Red",
      "     You prefer red.",
      "  2. Blue",
      "     You prefer blue.",
      "  3. Type something.",
      "─".repeat(100),
      "  4. Chat about this",
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ];
    expect(scanAgent(lines)).toEqual({ agent: "claude", state: "blocked" });
  });

  it("Codex 시작 때 업데이트 메뉴도 입력 기다림", () => {
    const lines = [
      "  Update available · 0.167.1 → 0.169.0",
      "  Release notes: https://github.com/openai/codex/releases/latest",
      "› 1. Update now (runs `sh -c '…'`)",
      "  2. Skip",
      "  3. Skip until next version",
      "  enter continue · esc skip",
    ];
    expect(scanAgent(lines)).toEqual({ agent: "codex", state: "blocked" });
  });

  it("평범한 셸 화면은 에이전트 없음", () => {
    expect(scanAgent(["demo@mac ~/project % ls", "README.md  src", "demo@mac ~/project % "])).toBeNull();
    expect(scanAgent(["", "", ""])).toBeNull();
  });

  it("Pure/Starship 같은 ❯ 프롬프트만으로는 Claude로 보지 않는다", () => {
    expect(scanAgent(["~/project", "❯ git status", "On branch main", "~/project", "❯ "])).toBeNull();
  });

  it("예전 Claude 상태 줄이 셸 화면에 남아 있어도 일하는 중이 아니다", () => {
    const lines = ["✻ Thinking… (12s · ↓ 1.2k tokens · esc to interrupt)", "~/project % exit", "~/project % "];
    expect(scanAgent(lines)).toBeNull();
  });

  it("출력 속 번호 목록은 메뉴로 보지 않는다", () => {
    const lines = ["Steps:", "1. Install", "2. Run", "Press esc to cancel the download.", "~/project % "];
    expect(scanAgent(lines)).toBeNull();
  });

  it("메뉴 아래에 출력이 한참 이어지면(답한 뒤 남은 화면) 기다림이 아니다", () => {
    const lines = [
      "❯ 1. Yes",
      "  2. No",
      "Esc to cancel",
      ...Array.from({ length: 10 }, (_, i) => `output line ${i}`),
      "~/project % ",
    ];
    expect(scanAgent(lines)).toBeNull();
  });
});
