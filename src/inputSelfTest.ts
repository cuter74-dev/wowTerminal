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

/** Ctrl 조합 키 (Ctrl-U 줄 비우기 등). */
async function pressCtrl(key: string, keyCode: number): Promise<void> {
  const el = ta();
  if (!el) return;
  const e = new KeyboardEvent("keydown", {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(e, "keyCode", { get: () => keyCode });
  el.dispatchEvent(e);
  await sleep(40);
}

/** 네이티브 composition 경로 구동: 사용자 맥(최신 macOS)처럼 표준 compositionstart →
 *  compositionupdate(한글) → compositionend(한글) 이벤트를 보낸다. 미러 경로(typeMirror)와
 *  달리 이건 xterm 네이티브 IME 경로 + 우리의 compositionMachine 판별 로직을 구동한다.
 *  주의: 합성 composition은 xterm이 음절을 onData로 보내게 만들지는 못한다(실 IME 필요).
 *  그래서 이 헬퍼는 "조합 머신 판별 + imeActive 미고착"만 구동하고, 셸 도달은 단언하지 않는다. */
async function composeHangul(syllable: string): Promise<void> {
  const el = ta();
  if (!el) return;
  el.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
  el.value = syllable;
  el.dispatchEvent(
    new CompositionEvent("compositionupdate", { data: syllable, bubbles: true }),
  );
  el.dispatchEvent(
    new InputEvent("input", {
      data: syllable,
      inputType: "insertCompositionText",
      bubbles: true,
    }),
  );
  el.dispatchEvent(new CompositionEvent("compositionend", { data: syllable, bubbles: true }));
  el.value = "";
  await sleep(80);
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

  // T4 — 붙여넣기 후 한글 타이핑 (#97 회귀 테스트): 실제 ClipboardEvent로 붙여넣고,
  // textarea 잔류 여부를 기록한 뒤 미러 타이핑 — 잔류가 있으면 미러가 그걸 재전송해
  // "붙여넣기가 또 되는" 버그가 재현된다. 기대 파일 내용: "PB123가" 한 번만.
  trace("t4-begin");
  await typePlain("echo ");
  const el4 = ta();
  if (el4) {
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", "PB123");
      el4.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
      // 합성 이벤트는 기본 동작(텍스트 삽입)이 없으므로, 실제 WebKit이 남기는 잔류를
      // 직접 모사한다 — xterm paste 핸들러는 preventDefault하지 않는다(#97).
      el4.value = "PB123";
      await sleep(150);
      trace("t4-residue:[" + el4.value + "]");
    } catch (e) {
      trace("t4-paste-ERR:" + String(e));
    }
  }
  // 실제 IME는 잔류 뒤에 조합을 이어붙인다 — 값 전이도 잔류 접두를 포함해 모사.
  // 수정(#97) 전이면 미러가 PB123을 재전송해 파일에 "PB123PB123가"가 찍힌다.
  const rp = ta()?.value ?? "";
  await typeMirror([rp + "ㄱ", rp + "가"]);
  await typeMirror([rp + "가 ", rp + "가 > /tmp/wt-st4.txt"]);
  await pressKey("Enter", 13);
  await sleep(400);

  // T5 — 네이티브 composition 머신 + 영어 전환 후 삭제 (사용자 제보 회귀:
  // "한글이 제대로 안 써지고 영어로 바꾸면 삭제가 안 됨"). 사용자 맥은 한글을 표준
  // composition 이벤트로 처리하는데(진단 nCS:15/n229:19), 미러가 음절 첫 229에서 잠깐
  // 켜져 stray를 보내고 imeActive가 영어 전환 후까지 남아 Backspace를 삼켰다. 수정:
  // 한글 composition을 보면 compositionMachine으로 latch하고 미러를 영구 OFF.
  // 검증: composition으로 한글을 흘려 latch시킨 뒤, **후속 composition 없는 229**를 하나
  // 보내고(미러가 켜지면 imeActive가 고착됨), 영어 "st5-del"→BS×3→"xyz"로 삭제가
  // 정상인지 본다. 미수정이면 229가 미러를 켜 imeActive 고착 → BS 삼켜져 파일이 깨진다.
  // (selftest가 localStorage에 latch 플래그를 남기지 않도록 시작 전 값을 백업, T5 후 복원.)
  trace("t5-begin");
  let cmpBackup: string | null = null;
  try {
    cmpBackup = localStorage.getItem("wt.ime.cmp");
  } catch {
    /* 무시 */
  }
  await composeHangul("가");
  await composeHangul("나");
  let latched = "?";
  try {
    latched = localStorage.getItem("wt.ime.cmp") ?? "null";
  } catch {
    /* 무시 */
  }
  trace("t5-latched:" + latched);
  await pressCtrl("u", 85); // 합성 composition이 남긴 stray가 있으면 줄 비우기.
  await sleep(60);
  await pressKey("Process", 229); // 후속 composition 없는 229 — 미러가 켜지면 안 된다.
  await typePlain("echo st5-del");
  for (let i = 0; i < 3; i++) await pressKey("Backspace", 8);
  await typePlain("xyz > /tmp/wt-st5.txt");
  await pressKey("Enter", 13);
  trace("t5-enter");
  await sleep(400);
  // latch 플래그 원복 — 실제 사용자/메인테이너 머신 설정을 오염시키지 않는다.
  try {
    if (cmpBackup === null) localStorage.removeItem("wt.ime.cmp");
    else localStorage.setItem("wt.ime.cmp", cmpBackup);
  } catch {
    /* 무시 */
  }

  // T6 — non-breaking space 정규화 (#100 회귀): macOS 인라인 예측 텍스트가 스페이스를
  // U+00A0(nbsp)로 커밋하면 셸 커서 계산이 어긋나 "백스페이스가 스페이스처럼" 동작했다.
  // onData에서 nbsp→일반 스페이스로 정규화한다. 입력값에 nbsp를 넣고, 셸 파일이 일반
  // 스페이스("st6 ok")로 찍히는지 단언(미수정이면 파일에 nbsp가 남아 불일치).
  trace("t6-begin");
  await typePlain("echo st6\u00a0ok > /tmp/wt-st6.txt"); // st6<nbsp>ok → 정규화 후 "st6 ok"
  await pressKey("Enter", 13);
  trace("t6-enter");
  await sleep(400);

  // 완료 마커 (검증 스크립트의 대기 종료용).
  await typePlain("echo done > /tmp/wt-st-done.txt");
  await pressKey("Enter", 13);
  trace("end");
}
