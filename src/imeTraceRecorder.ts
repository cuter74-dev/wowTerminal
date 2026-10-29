// 입력 트레이스 녹화기 (#158). 명령 팔레트로 켜면 **다음에 열리는 터미널 1개**의 숨은
// textarea에 도착하는 입력 이벤트와, 그 터미널이 PTY로 보낸 바이트를 함께 메모리에 쌓는다.
// 끄면 ImeTrace(JSON)로 돌려주고, 사용자가 저장 위치를 고른다 — 자동 전송은 하지 않는다.
//
// 새 터미널에서만 녹화하는 이유: 리플레이 테스트는 새로 마운트한 Terminal에서 재생한다.
// 이미 쓰던 터미널은 IME 상태(미러 활성·기준선·자가치유 카운터 등)가 쌓여 있어, 같은
// 이벤트라도 새 터미널에선 다르게 처리될 수 있다.
import { TRACE_EVENT_TYPES, toTraceEvent, type ImeTrace, type TraceEvent } from "./imeTrace";

interface Recording {
  ta: HTMLTextAreaElement;
  start: number;
  events: TraceEvent[];
  pty: string[];
  cmpLatched: boolean;
  detach: () => void;
}

let armed = false;
let rec: Recording | null = null;

/** 녹화 대기(다음에 마운트되는 터미널에서 시작) 또는 진행 중인지. */
export function traceRecordingActive(): boolean {
  return armed || rec !== null;
}

/** 다음에 마운트되는 터미널에서 녹화를 시작하도록 예약한다. */
export function armTraceRecording(): void {
  if (rec) return;
  armed = true;
}

/** Terminal이 xterm을 연 직후 호출한다. 예약돼 있으면 이 textarea에서 녹화를 시작하고 true. */
export function maybeStartTraceRecording(ta: HTMLTextAreaElement | undefined): boolean {
  if (!armed || rec || !ta) return false;
  armed = false;
  const start = Date.now();
  const events: TraceEvent[] = [];
  // 윈도우 캡처 단계에서 본다 — xterm·우리 핸들러보다 먼저, 즉 그들이 본 textarea 값 그대로.
  const onEvent = (e: Event) => {
    if (e.target === ta) events.push(toTraceEvent(e, ta, Date.now() - start));
  };
  for (const type of TRACE_EVENT_TYPES) window.addEventListener(type, onEvent, true);
  let cmpLatched = false;
  try {
    // 새 터미널은 마운트 시 이 래치를 (지문이 맞으면) 그대로 믿는다 — 리플레이도 같게 시작.
    cmpLatched =
      localStorage.getItem("wt.ime.cmp") === "1" &&
      localStorage.getItem("wt.ime.cmp.fp") === `${__APP_VERSION__}|${navigator.userAgent}`;
  } catch {
    /* 무시 */
  }
  rec = {
    ta,
    start,
    events,
    pty: [],
    cmpLatched,
    detach: () => {
      for (const type of TRACE_EVENT_TYPES) window.removeEventListener(type, onEvent, true);
    },
  };
  return true;
}

/** Terminal이 PTY로 보내는 모든 텍스트를 넘긴다. 녹화 중인 그 터미널 것만 쌓는다. */
export function recordTracePty(ta: HTMLTextAreaElement | undefined, text: string): void {
  if (rec && ta === rec.ta) rec.pty.push(text);
}

/** 녹화를 끝내고 트레이스를 돌려준다(진행 중이 아니면 null — 예약만 된 상태면 예약 취소). */
export function stopTraceRecording(name: string, recordedFrom: string): ImeTrace | null {
  armed = false;
  const r = rec;
  rec = null;
  if (!r) return null;
  r.detach();
  return {
    version: 1,
    name,
    source: "recorded",
    recordedFrom,
    userAgent: navigator.userAgent,
    cmpLatched: r.cmpLatched,
    events: r.events,
    expectedPty: r.pty.join(""),
  };
}
