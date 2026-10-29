// 기존 인앱 self-test T1–T7(src/inputSelfTest.ts)의 이식 (#158). 시나리오별로 독립된
// 새 Terminal에서 재생한다(원래는 한 세션에서 이어 실행). expectedLines는 self-test가 셸
// 파일로 검증하던 내용, expectedPty는 현재 코드의 정확한 전송 바이트(골든)다.
import type { ImeTrace } from "../imeTrace";
import { MAC_UA, TraceBuilder } from "./traceBuilder";

function trace(
  name: string,
  note: string,
  opts: { cmpLatched?: boolean },
  build: (b: TraceBuilder) => void,
  expectedLines: string[],
  expectedPty: string,
): ImeTrace {
  const b = new TraceBuilder();
  build(b);
  return {
    version: 1,
    name,
    source: "synthetic",
    note,
    userAgent: MAC_UA,
    cmpLatched: !!opts.cmpLatched,
    events: b.events,
    expectedLines,
    expectedPty,
  };
}

export const SYNTHETIC_TRACES: ImeTrace[] = [
  trace(
    "T1 plain typing + Backspace",
    "영어 통짜 입력 후 BS×3, 덧붙여 실행.",
    {},
    (b) => {
      b.plain("echo st-en-abcdef");
      for (let i = 0; i < 3; i++) b.key("Backspace", 8);
      b.plain("xyz > /tmp/wt-st1.txt").key("Enter", 13);
    },
    ["echo st-en-abcxyz > /tmp/wt-st1.txt"],
    "echo st-en-abcdef\x7f\x7f\x7fxyz > /tmp/wt-st1.txt\r",
  ),
  trace(
    "T2 macOS mirror composition (Type A)",
    "229-only 맥: 229 keydown + textarea 값 전이로 '안녕' 조합.",
    {},
    (b) => {
      b.plain("echo ");
      b.mirror(["ㅇ", "아", "안"]);
      b.mirror(["안ㄴ", "안녀", "안녕"]);
      b.mirror(["안녕 ", "안녕 >", "안녕 > ", "안녕 > /tmp/wt-st2.txt"]);
      b.key("Enter", 13);
    },
    ["echo 안녕 > /tmp/wt-st2.txt"],
    "echo ㅇ\x7f아\x7f안ㄴ\x7f녀\x7f녕 > /tmp/wt-st2.txt\r",
  ),
  trace(
    "T3 mirror composition + deletion",
    "가나다라 조합 후 축소 전이 2회(라·다 삭제).",
    {},
    (b) => {
      b.plain("echo ");
      b.mirror(["ㄱ", "가"]);
      b.mirror(["가ㄴ", "가나"]);
      b.mirror(["가나ㄷ", "가나다"]);
      b.mirror(["가나다ㄹ", "가나다라"]);
      b.mirror(["가나다"]);
      b.mirror(["가나"]);
      b.mirror(["가나 ", "가나 > /tmp/wt-st3.txt"]);
      b.key("Enter", 13);
    },
    ["echo 가나 > /tmp/wt-st3.txt"],
    "echo ㄱ\x7f가ㄴ\x7f나ㄷ\x7f다ㄹ\x7f라\x7f\x7f > /tmp/wt-st3.txt\r",
  ),
  trace(
    "T4 paste residue then Hangul (#97)",
    "WebKit이 붙여넣기 텍스트를 textarea에 남긴 상태에서 미러 조합 — 붙여넣기는 한 번만.",
    {},
    (b) => {
      b.plain("echo ");
      b.paste("PB123", true);
      const rp = b.current;
      b.mirror([rp + "ㄱ", rp + "가"]);
      b.mirror([rp + "가 ", rp + "가 > /tmp/wt-st4.txt"]);
      b.key("Enter", 13);
    },
    ["echo PB123가 > /tmp/wt-st4.txt"],
    "echo PB123ㄱ\x7f가 > /tmp/wt-st4.txt\r",
  ),
  trace(
    "T5 composition machine + lone 229 + English deletion (#100)",
    "한글 composition으로 B형 래치 → 후속 composition 없는 229 → 영어 BS가 먹혀야 한다.",
    {},
    (b) => {
      b.compose("가").compose("나");
      b.key("u", 85, { ctrl: true }).sleep(60);
      b.key("Process", 229);
      b.plain("echo st5-del");
      for (let i = 0; i < 3; i++) b.key("Backspace", 8);
      b.plain("xyz > /tmp/wt-st5.txt").key("Enter", 13);
    },
    // 첫 줄: compose가 흘린 "가나"가 Ctrl-U로 지워진 뒤 실행 줄이 이어진다.
    ["echo st5-xyz > /tmp/wt-st5.txt"],
    "가나\x15echo st5-del\x7f\x7f\x7fxyz > /tmp/wt-st5.txt\r",
  ),
  trace(
    "T6 non-breaking space normalization (#100)",
    "예측 텍스트가 커밋한 U+00A0을 일반 스페이스로 정규화.",
    {},
    (b) => {
      b.plain("echo st6 ok > /tmp/wt-st6.txt").key("Enter", 13);
    },
    ["echo st6 ok > /tmp/wt-st6.txt"],
    "echo st6 ok > /tmp/wt-st6.txt\r",
  ),
  trace(
    "T7 space that commits a composition (#140)",
    "B형(조합 머신 래치) 맥: 조합 중 스페이스 keydown이 조합을 끝낸다 — 음절 1회 + 공백 1회.",
    { cmpLatched: true },
    (b) => {
      b.plain("echo st7-");
      b.raw({ type: "compositionstart", data: "" });
      b.raw({ type: "compositionupdate", data: "가", value: "가" });
      b.raw({ type: "input", data: "가", inputType: "insertCompositionText" });
      b.sleep(30);
      b.raw({ type: "keydown", key: " ", keyCode: 32, isComposing: true });
      b.raw({ type: "compositionend", data: "가" });
      b.sleep(120).setValue("");
      b.plain("x > /tmp/wt-st7.txt").key("Enter", 13);
    },
    ["echo st7-가 x > /tmp/wt-st7.txt"],
    "echo st7-가 x > /tmp/wt-st7.txt\r",
  ),
];
