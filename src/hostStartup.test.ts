// 접속 직후 입력 시험 (#89, #191). tmux 입력은 이 Mac의 tmux 3.7로 실제 동작을 확인한 문법이다
// (새 세션일 때만 시작 명령 실행, 다시 부르면 보내지 않음, 이름은 정확히 일치).
import { describe, expect, it } from "vitest";
import { connectInput, shQuote } from "./hostStartup";

describe("connectInput", () => {
  it("아무것도 없으면 null", () => {
    expect(connectInput("", "")).toBeNull();
    expect(connectInput("", "   ")).toBeNull();
  });
  it("tmux만 — 예전과 같다", () => {
    expect(connectInput("work", "")).toBe("tmux new-session -A -s 'work'\r");
  });
  it("시작 명령만 — 셸에 그대로", () => {
    expect(connectInput("", "cd ~/proj && claude")).toBe("cd ~/proj && claude\r");
  });
  it("tmux + 시작 명령 — 새 세션일 때만 그 안에 입력", () => {
    expect(connectInput("work", "cd ~/proj && claude")).toBe(
      "tmux has-session -t '=work' 2>/dev/null || { tmux new-session -d -s 'work' && " +
        "tmux send-keys -t '=work:' -l 'cd ~/proj && claude' && tmux send-keys -t '=work:' Enter; }; " +
        "tmux attach-session -t '=work'\r",
    );
  });
  it("줄바꿈은 한 줄로, 작은따옴표는 안전하게", () => {
    expect(connectInput("", "echo a\necho b")).toBe("echo a echo b\r");
    expect(connectInput("w", "echo 'hi'")).toContain(`-l ${shQuote("echo 'hi'")}`);
    expect(shQuote("it's")).toBe("'it'\\''s'");
  });
});
