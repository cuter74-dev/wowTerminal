// IME 리플레이 회귀 테스트 (#158). 각 트레이스를 실제 Terminal에 재생해
//  1) 사람이 읽는 기대값(expectedLines: 셸이 실행할 줄)과
//  2) 정확한 PTY 바이트(expectedPty 골든)를 함께 검증한다.
// 실기기 녹화 트레이스는 src/test/fixtures/ime/*.json — 앱의 "입력 트레이스 녹화"로 만든다.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ImeTrace } from "../imeTrace";
import { replayTrace, resolveLines } from "./imeReplay";
import { SYNTHETIC_TRACES } from "./syntheticTraces";

// import.meta.glob이 아니라 실행 시점에 폴더를 읽는다 — vitest 5의 디스크 모듈 캐시가 glob
// 결과를 변환 결과에 박아 두어, 새 픽스처 파일을 추가해도 안 보이는 일이 있었다(#159에서 실측).
// (happy-dom 환경에선 import.meta.url이 file: URL이 아니라 vitest 루트=저장소 루트 기준 경로를 쓴다.)
const FIXTURE_DIR = resolve(process.cwd(), "src/test/fixtures/ime") + "/";
const recorded: ImeTrace[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(FIXTURE_DIR + f, "utf-8")) as ImeTrace);

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
