// 입력 자가 테스트 (#95). 입력(한글/영어)은 이 앱의 최우선 검증 항목이라, 릴리스 전
// 자동으로 돌릴 수 있는 내장 하니스를 둔다. localStorage "wowterminal.selftest"="1"로
// 기동하면 App이 세션 복원을 건너뛰고(로컬 탭 1개) 이 모듈이 xterm의 숨은 textarea에
// 합성 이벤트를 보내 실제 입력 경로(키다운/IME 미러/onData→PTY→셸)를 구동한다.
// 결과는 셸이 /tmp/wt-st*.txt 파일로 남기고 외부 스크립트가 내용을 검증한다.
// 일반 사용자 환경에서는 플래그가 없으므로 아무 것도 하지 않는다. 플래그는 1회용.

export const SELFTEST_KEY = "wowterminal.selftest";

export function selfTestRequested(): boolean {
  try {
    return localStorage.getItem(SELFTEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearSelfTest(): void {
  try {
    localStorage.removeItem(SELFTEST_KEY);
  } catch {
    /* 무시 */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 진행 흔적 — 외부 검증 스크립트가 sqlite로 읽는다(실패 지점 추적용). */
function trace(msg: string): void {
  try {
    const k = "wt.selftest.trace";
    const prev = localStorage.getItem(k) ?? "";
    localStorage.setItem(k, prev + msg + ";");
  } catch {
    /* 무시 */
  }
}

function ta(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(
    "textarea.xterm-helper-textarea",
  );
}

/** keyCode까지 실어 보내는 합성 keydown — xterm의 실제 keydown 리스너(+우리의
 *  attachCustomKeyEventHandler)를 그대로 통과한다. */
function kbd(key: string, keyCode: number): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  Object.defineProperty(e, "keyCode", { get: () => keyCode });
  return e;
}

/** 일반(비-IME) 타이핑: xterm은 printable을 textarea input 이벤트로 받는다.
 *  문자별 keydown 합성은 일부 키에서 멈추는 문제가 있어 통짜 insertText로 보낸다. */
async function typePlain(text: string): Promise<void> {
  const el = ta();
  if (!el) return;
  el.value = text;
  el.dispatchEvent(
    new InputEvent("input", { data: text, inputType: "insertText", bubbles: true }),
  );
  el.value = "";
  await sleep(60);
}

/** 특수키 (Enter/Backspace 등) — xterm keydown 경로가 직접 처리한다. */
async function pressKey(key: string, keyCode: number): Promise<void> {
  const el = ta();
  if (!el) return;
  el.dispatchEvent(kbd(key, keyCode));
  await sleep(40);
}

/** IME 미러 경로 타이핑: keyCode 229 keydown으로 미러를 켠 뒤, textarea 값의 전이
 *  시퀀스(조합 중 값 전체)를 input 이벤트로 흘린다 — 실제 한글 조합과 동일한 형태. */
async function typeMirror(valueSequence: string[]): Promise<void> {
  const el = ta();
  if (!el) return;
  for (const v of valueSequence) {
    trace("m:" + v.length);
    el.dispatchEvent(kbd("Process", 229));
    el.value = v;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await sleep(20);
  }
}


/** 시나리오 실행. App이 셸 준비(스폰+프롬프트) 후 호출한다.
 *  T1: 영어 타이핑+백스페이스 / T2: 한글 미러 조합 / T3: 한글 조합 중 백스페이스. */
export async function runInputSelfTest(): Promise<void> {
  // 하트비트 — 드라이버가 멈춰도 JS 컨텍스트가 살아 있는지 판별(외부에서 trace로 읽음).
  let beats = 0;
  const hb = setInterval(() => {
    beats++;
    trace("hb" + beats);
    if (beats >= 60) clearInterval(hb);
  }, 500);
  try {
    await runScenarios();
    trace("scenarios-ok");
  } catch (e) {
    trace("ERROR:" + String(e));
  } finally {
    clearInterval(hb);
  }
}

async function runScenarios(): Promise<void> {
  trace("start");
  trace(ta() ? "ta-found" : "ta-MISSING");
  // T1 — 영어: "echo st-en-abcdef" 친 뒤 BS×3로 def 삭제, "xyz" 덧붙여 실행.
  await typePlain("echo st-en-abcdef");
  trace("t1-typed");
  for (let i = 0; i < 3; i++) await pressKey("Backspace", 8);
  trace("t1-bs");
  trace("t1-x1");
  await typePlain("xyz > /tmp/wt-st1.txt");
  trace("t1-x2");
  await pressKey("Enter", 13);
  trace("t1-enter");
  await sleep(400);

  // T2 — 한글 미러: '안'(ㅇ→아→안), '녕'(안ㄴ→안녀→안녕) 조합 후 리다이렉트.
  // 미러가 켜진 동안에는 공백/ASCII도 textarea 값 전이로 흘러간다(실제 동작과 동일).
  trace("t2-begin");
  await typePlain("echo ");
  await typeMirror(["ㅇ", "아", "안"]);
  await typeMirror(["안ㄴ", "안녀", "안녕"]);
  await typeMirror(["안녕 ", "안녕 >", "안녕 > ", "안녕 > /tmp/wt-st2.txt"]);
  await pressKey("Enter", 13);
  trace("t2-enter");
  await sleep(400);

  // T3 — 한글 조합 + 백스페이스: 가나다라 조합 후 BS×2(라,다 삭제) → "가나"만 실행.
  trace("t3-begin");
  await typePlain("echo ");
  await typeMirror(["ㄱ", "가"]);
  await typeMirror(["가ㄴ", "가나"]);
  await typeMirror(["가나ㄷ", "가나다"]);
  await typeMirror(["가나다ㄹ", "가나다라"]);
  trace("t3-bs");
  // 축소 전이(Backspace에 해당)도 typeMirror와 동일한 229+input 패턴으로 보낸다 —
  // flushMirror의 백스페이스 diff 경로를 그대로 검증한다.
  await typeMirror(["가나다"]);
  await typeMirror(["가나"]);
  await typeMirror(["가나 ", "가나 > /tmp/wt-st3.txt"]);
  await pressKey("Enter", 13);
  trace("t3-enter");
  await sleep(400);

  // 완료 마커 (검증 스크립트의 대기 종료용).
  await typePlain("echo done > /tmp/wt-st-done.txt");
  await pressKey("Enter", 13);
  trace("end");
}
