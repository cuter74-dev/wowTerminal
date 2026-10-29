// IME 리플레이 회귀 테스트 (#158). 각 트레이스를 실제 Terminal에 재생해
//  1) 사람이 읽는 기대값(expectedLines: 셸이 실행할 줄)과
//  2) 정확한 PTY 바이트(expectedPty 골든)를 함께 검증한다.
// 실기기 녹화 트레이스는 src/test/fixtures/ime/*.json — 앱의 "입력 트레이스 녹화"로 만든다.
import { describe, expect, it } from "vitest";
import type { ImeTrace } from "../imeTrace";
import { replayTrace, resolveLines } from "./imeReplay";
import { SYNTHETIC_TRACES } from "./syntheticTraces";

const recorded = Object.values(
  import.meta.glob<ImeTrace>("./fixtures/ime/*.json", { eager: true, import: "default" }),
);

/** 실패 메시지에서 제어 문자를 보이게 한다(JSON.stringify는 DEL을 이스케이프하지 않는다). */
function visible(s: string): string {
  return [...s]
    .map((c) =>
      c < " " || c === "\x7f" ? `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}` : c,
    )
    .join("");
}

describe.each([
  ["synthetic", SYNTHETIC_TRACES],
  ["recorded", recorded],
] as const)("%s traces", (_kind, traces) => {
  it.skipIf(traces.length > 0)("(none yet)", () => {});
  it.each(traces.map((t) => [t.name, t] as const))("%s", async (_name, trace) => {
    const pty = await replayTrace(trace);
    if (trace.expectedLines) expect(resolveLines(pty)).toEqual(trace.expectedLines);
    expect(visible(pty)).toBe(visible(trace.expectedPty));
  });
});
