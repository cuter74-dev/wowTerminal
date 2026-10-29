// 입력 이벤트 트레이스 (#158). 실제 기기에서 xterm 숨은 textarea에 도착한 입력 이벤트를
// 그대로 녹화하고, 그 시퀀스가 PTY로 보낸 바이트를 함께 남긴다. 테스트는 같은 이벤트를
// happy-dom의 실제 Terminal 컴포넌트에 재생해 바이트가 같은지 본다 — 우리가 "상상한" 이벤트
// 순서가 아니라 WebView가 실제로 보낸 순서로 회귀를 잡기 위함(#83/#100/#133/#140/#147의 공통 원인).
//
// 녹화는 사용자가 명시적으로 켰을 때만 동작하고, 메모리에만 쌓았다가 사용자가 내보낼 때
// 한 번 파일로 저장한다. 입력 내용이 그대로 담기므로(비밀번호 포함 가능) 자동 전송하지 않는다.

/** 녹화 대상 이벤트. keydown~compositionend는 IME 경로가 실제로 반응하는 전부다. */
export const TRACE_EVENT_TYPES = [
  "keydown",
  "keypress",
  "keyup",
  "beforeinput",
  "input",
  "compositionstart",
  "compositionupdate",
  "compositionend",
  "paste",
  // 포커스 왕복은 IME 상태를 바꾼다(#159: 돌아오면 textarea가 비워짐) — 재생에도 필요하다.
  "focus",
  "blur",
] as const;

export interface TraceEvent {
  /** 녹화 시작 기준 ms. 재생 시 이 간격만큼 (가짜) 타이머를 진행시킨다. */
  t: number;
  type: string;
  key?: string;
  code?: string;
  keyCode?: number;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  isComposing?: boolean;
  data?: string | null;
  inputType?: string;
  /** 이벤트가 관측된 시점(캡처 단계 = 핸들러들보다 먼저)의 textarea 값. 재생 시 디스패치 전에 적용. */
  value: string;
  selStart?: number;
  selEnd?: number;
  /** paste의 text/plain. */
  clipboard?: string;
}

export interface ImeTrace {
  version: 1;
  name: string;
  /** recorded = 실기기 녹화, synthetic = 손으로 만든 시퀀스(옛 self-test 이식 등). */
  source: "recorded" | "synthetic";
  /** 예: "macOS 26.1 / M5 / 2-Set Korean / wowTerminal 0.20.17". */
  recordedFrom?: string;
  note?: string;
  /** 녹화 환경의 UA(지문·참고용). */
  userAgent: string;
  /** 녹화 환경의 OS(plugin-os `platform()`: macos/ios/windows/linux/android). 미러 경로는 UA가
   *  아니라 이 값으로 결정된다(#161 — iPad는 Mac UA를 보낸다). 없으면 UA에서 추정(옛 트레이스). */
  platform?: string;
  /** 녹화 시작 시 composition 머신 래치(wt.ime.cmp) 상태 — macOS A형/B형 구분. */
  cmpLatched: boolean;
  events: TraceEvent[];
  /** 이 이벤트들로 PTY에 보내져야 하는 바이트(UTF-8 문자열). 녹화 시엔 실제 전송분. */
  expectedPty: string;
  /** 사람이 읽는 기대값: 셸 라인 에디터가 실행할 줄들(DEL/CR 적용 후). 바이트 골든이 맞는지
   *  검토하는 근거이자, 바이트 표현만 바뀐 무해한 변경과 실제 회귀를 구분하는 기준. */
  expectedLines?: string[];
}

/** KeyboardEvent/InputEvent/CompositionEvent/ClipboardEvent → TraceEvent. */
export function toTraceEvent(
  e: Event,
  ta: HTMLTextAreaElement,
  t: number,
): TraceEvent {
  const out: TraceEvent = { t, type: e.type, value: ta.value };
  if (ta.selectionStart !== ta.value.length || ta.selectionEnd !== ta.value.length) {
    out.selStart = ta.selectionStart ?? undefined;
    out.selEnd = ta.selectionEnd ?? undefined;
  }
  // 클래스(instanceof)가 아니라 이벤트 타입으로 판별한다. 합성·리플레이 이벤트는 클래스가
  // 다를 수 있고, 일부 DOM 구현(happy-dom)은 일반 Event도 instanceof CompositionEvent가 참이다.
  if (e.type.startsWith("key")) {
    const k = e as KeyboardEvent;
    out.key = k.key;
    out.code = k.code;
    out.keyCode = k.keyCode;
    if (k.ctrlKey) out.ctrl = true;
    if (k.altKey) out.alt = true;
    if (k.shiftKey) out.shift = true;
    if (k.metaKey) out.meta = true;
    if (k.isComposing) out.isComposing = true;
  } else if (e.type === "input" || e.type === "beforeinput") {
    const i = e as InputEvent;
    out.data = i.data;
    out.inputType = i.inputType;
    if (i.isComposing) out.isComposing = true;
  } else if (e.type.startsWith("composition")) {
    out.data = (e as CompositionEvent).data;
  } else if (e.type === "paste") {
    out.clipboard = (e as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
  }
  return out;
}

/** TraceEvent → 디스패치할 DOM 이벤트. 일부 DOM 구현(happy-dom 등)이 init의 keyCode/data/
 *  isComposing을 무시하므로 정의 속성으로 덮어쓴다(실 WebView에선 원래 값이 들어 있다). */
export function fromTraceEvent(r: TraceEvent): Event {
  const force = (ev: Event, k: string, v: unknown) => {
    if (v !== undefined) Object.defineProperty(ev, k, { get: () => v });
  };
  let ev: Event;
  if (r.type.startsWith("key")) {
    ev = new KeyboardEvent(r.type, {
      key: r.key,
      code: r.code,
      ctrlKey: !!r.ctrl,
      altKey: !!r.alt,
      shiftKey: !!r.shift,
      metaKey: !!r.meta,
      isComposing: !!r.isComposing,
      bubbles: true,
      cancelable: true,
    });
    force(ev, "keyCode", r.keyCode);
    force(ev, "which", r.keyCode);
    force(ev, "isComposing", !!r.isComposing);
  } else if (r.type === "input" || r.type === "beforeinput") {
    ev = new InputEvent(r.type, {
      data: r.data ?? null,
      inputType: r.inputType,
      isComposing: !!r.isComposing,
      bubbles: true,
      cancelable: r.type === "beforeinput",
    });
    force(ev, "data", r.data ?? null);
    force(ev, "inputType", r.inputType ?? "");
    force(ev, "isComposing", !!r.isComposing);
  } else if (r.type.startsWith("composition")) {
    ev = new CompositionEvent(r.type, { data: r.data ?? "", bubbles: true });
    force(ev, "data", r.data ?? "");
  } else if (r.type === "paste") {
    ev = new Event("paste", { bubbles: true, cancelable: true });
    const text = r.clipboard ?? "";
    force(ev, "clipboardData", {
      getData: (fmt: string) => (fmt === "text/plain" || fmt === "text" ? text : ""),
      types: ["text/plain"],
    });
  } else if (r.type === "focus" || r.type === "blur") {
    ev = new FocusEvent(r.type, { bubbles: false });
  } else {
    ev = new Event(r.type, { bubbles: true, cancelable: true });
  }
  return ev;
}
