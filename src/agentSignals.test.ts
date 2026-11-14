// 에이전트 표준 신호 해석 시험 (#189). OSC 7501은 설치된 Claude Code 2.1.325가 만드는 꼴 그대로.
import { describe, expect, it } from "vitest";
import {
  Osc99Collector,
  parseOsc777,
  parseOsc9,
  parseProgramStatus,
  programStatusToScan,
} from "./agentSignals";

describe("OSC 7501", () => {
  it("지원 여부 질의", () => {
    expect(parseProgramStatus("?")).toBe("probe");
  });
  it("상태 보고", () => {
    expect(parseProgramStatus("state=working:app=claude-code:progress=42:msg=UnVubmluZw==")).toEqual({
      app: "claude-code",
      state: "working",
      progress: 42,
    });
    expect(parseProgramStatus("state=blocked:app=claude-code:kind=permission")).toEqual({
      app: "claude-code",
      state: "blocked",
      kind: "permission",
    });
    expect(parseProgramStatus("state=clear")).toEqual({ app: "", state: "clear" });
    expect(parseProgramStatus("state=working:app=claude-code:id=task-1")).toMatchObject({ id: "task-1" });
    expect(parseProgramStatus("state=dancing:app=claude-code")).toBeNull();
  });
  it("목록 상태로", () => {
    const s = (state: string) => programStatusToScan(parseProgramStatus(`state=${state}:app=claude-code`) as never);
    expect(s("working")).toEqual({ agent: "claude", state: "working" });
    expect(s("blocked")).toEqual({ agent: "claude", state: "blocked" });
    expect(s("done")).toEqual({ agent: "claude", state: "idle" });
    expect(s("idle")).toEqual({ agent: "claude", state: "idle" });
    expect(s("error")).toEqual({ agent: "claude", state: "idle" });
    expect(s("clear")).toBeNull();
    expect(programStatusToScan({ app: "something-else", state: "working" })).toBeNull();
  });
});

describe("OSC 9", () => {
  it("ConEmu 진행률", () => {
    expect(parseOsc9("4;1;42")).toEqual({ progress: { state: 1, value: 42 } });
    expect(parseOsc9("4;0")).toEqual({ progress: { state: 0, value: null } });
    expect(parseOsc9("4;3;")).toEqual({ progress: { state: 3, value: null } });
  });
  it("다른 ConEmu 명령(9;9 cwd 등)은 무시", () => {
    expect(parseOsc9("9;C:\\Users\\demo")).toBeNull();
  });
  it("그 밖은 iTerm2식 알림 글", () => {
    expect(parseOsc9("Claude needs your permission to use Bash")).toEqual({
      notice: { body: "Claude needs your permission to use Bash" },
    });
    expect(parseOsc9("   ")).toBeNull();
  });
});

describe("OSC 777", () => {
  it("notify;제목;본문", () => {
    expect(parseOsc777("notify;Claude Code;Waiting for your input")).toEqual({
      title: "Claude Code",
      body: "Waiting for your input",
    });
    expect(parseOsc777("notify;Done;a;b")).toEqual({ title: "Done", body: "a;b" });
    expect(parseOsc777("notify;Only title;")).toEqual({ body: "Only title" });
    expect(parseOsc777("preexec")).toBeNull();
  });
});

describe("OSC 99 (kitty)", () => {
  it("한 번에 온 제목", () => {
    expect(new Osc99Collector().feed(";Build finished")).toEqual({ body: "Build finished" });
  });
  it("조각으로 온 제목·본문, base64", () => {
    const c = new Osc99Collector();
    expect(c.feed("i=1:d=0:p=title;Claude Code")).toBeNull();
    const body = btoa(String.fromCharCode(...new TextEncoder().encode("답을 기다립니다")));
    expect(c.feed(`i=1:p=body:e=1;${body}`)).toEqual({ title: "Claude Code", body: "답을 기다립니다" });
  });
  it("아이콘 같은 다른 조각은 무시", () => {
    expect(new Osc99Collector().feed("i=2:p=icon;abc")).toBeNull();
  });
});
