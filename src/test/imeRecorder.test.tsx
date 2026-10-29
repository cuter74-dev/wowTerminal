// 녹화기 왕복 검증 (#158): 트레이스를 재생하는 동안 녹화기를 켜 두면, 녹화된 트레이스는
// (1) 실제로 PTY에 간 바이트를 expectedPty로 담고 (2) 다시 재생해도 같은 바이트를 낸다.
// 실기기에서 녹화한 파일이 그대로 픽스처가 될 수 있다는 근거.
import { afterEach, expect, it } from "vitest";
import { armTraceRecording, stopTraceRecording, traceRecordingActive } from "../imeTraceRecorder";
import { replayTrace } from "./imeReplay";
import { SYNTHETIC_TRACES } from "./syntheticTraces";

afterEach(() => {
  stopTraceRecording("cleanup", "test");
});

it.each(SYNTHETIC_TRACES.map((t) => [t.name, t] as const))(
  "recorder round-trip: %s",
  async (_name, source) => {
    armTraceRecording();
    const sent = await replayTrace(source);
    const recorded = stopTraceRecording("rt", "test");
    expect(recorded).not.toBeNull();
    expect(traceRecordingActive()).toBe(false);
    expect(recorded!.source).toBe("recorded");
    expect(recorded!.cmpLatched).toBe(source.cmpLatched);
    // 하니스의 ta.focus()도 실제 focus 이벤트라 함께 녹화된다(#159부터 focus/blur 녹화).
    const inputOnly = (evs: { type: string }[]) =>
      evs.filter((e) => e.type !== "focus" && e.type !== "blur").length;
    expect(inputOnly(recorded!.events)).toBe(inputOnly(source.events));
    expect(recorded!.expectedPty).toBe(sent);
    // 녹화본을 그대로 재생하면 같은 바이트.
    expect(await replayTrace(recorded!)).toBe(recorded!.expectedPty);
  },
);

it("stop without a recording returns null and clears the arm", () => {
  armTraceRecording();
  expect(traceRecordingActive()).toBe(true);
  expect(stopTraceRecording("x", "y")).toBeNull();
  expect(traceRecordingActive()).toBe(false);
});

// 같은 pane에서 터미널이 다시 만들어지면(SSH 비밀번호 후 재시도 등) 녹화가 새 터미널로 넘어가
// 처음부터 다시 쌓인다(#162). 다른 pane의 터미널은 이어받지 않는다.
it("recording follows a terminal recreated in the same pane, restarting from it", async () => {
  const { maybeStartTraceRecording, releaseTraceRecording, recordTracePty } = await import(
    "../imeTraceRecorder"
  );
  const ta1 = document.createElement("textarea");
  const ta2 = document.body.appendChild(document.createElement("textarea"));
  const other = document.createElement("textarea");
  armTraceRecording();
  expect(maybeStartTraceRecording(ta1, "pane-a")).toBe(true);
  recordTracePty(ta1, "old");
  releaseTraceRecording(ta1);
  expect(maybeStartTraceRecording(other, "pane-b")).toBe(false); // 다른 pane은 무시
  expect(maybeStartTraceRecording(ta2, "pane-a")).toBe(true);
  recordTracePty(ta1, "ignored"); // 폐기된 터미널의 전송은 안 쌓인다
  recordTracePty(ta2, "new");
  ta2.dispatchEvent(new InputEvent("input", { data: "x", inputType: "insertText", bubbles: true }));
  const t = stopTraceRecording("x", "y");
  expect(t?.expectedPty).toBe("new");
  expect(t?.events.map((e) => e.type)).toEqual(["input"]);
  ta2.remove();
});
