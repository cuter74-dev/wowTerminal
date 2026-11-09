// 오류 추적(GlitchTip)으로 나가는 이벤트에서 개인 정보를 걷어 낸다 (#177).
// 보내는 것: 예외 종류·가린 메시지·스택(앱 번들 안 위치)·OS/브라우저/기기 종류·앱 버전·태그.
// 보내지 않는 것: 친 내용, 화면·출력 글자, breadcrumb(콘솔·클릭·IPC 주소), extra, 사용자 정보,
// 메시지 속 경로·주소·user@host·이메일.
import type { Breadcrumb, ErrorEvent } from "@sentry/react";

/** 메시지 한 줄의 최대 길이 — 긴 출력이 통째로 실리지 않게 자른다. */
const MAX_TEXT = 300;

const RULES: [RegExp, string][] = [
  // URL은 스킴만 남긴다(자체 호스팅 게이트웨이 주소·쿼리 토큰).
  [/\b([a-z][a-z0-9+.-]*):\/\/[^\s'"<>()]+/gi, "$1://<url>"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, "<email>"],
  [/\b[\w.-]+@[\w.-]+/g, "<user>@<host>"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>"],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, "<ip>"],
  [/\b[A-Za-z]:\\[^\s'"<>]+/g, "<path>"],
  [/~(?:\/[^\s'"<>:/]+)+\/?/g, "<path>"],
  [/(?<![\w:/.~])(?:\/[^\s'"<>:/]+){2,}\/?/g, "<path>"],
];

/** 한 문자열에서 경로·주소·계정을 가리고 길이를 자른다. */
export function scrubText(text: string): string {
  let s = text;
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

/** contexts 중 남기는 것 — 실행 환경 종류만. */
const KEEP_CONTEXTS = new Set(["os", "browser", "device", "runtime", "app"]);

/** Sentry `beforeSend` — 개인 정보가 실릴 수 있는 필드를 지우고 글자를 가린다. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.breadcrumbs;
  delete event.extra;
  delete event.user;
  delete event.server_name;
  if (event.request) {
    const ua = event.request.headers?.["User-Agent"];
    event.request = ua ? { headers: { "User-Agent": ua } } : {};
  }
  if (event.contexts) {
    for (const k of Object.keys(event.contexts)) {
      if (!KEEP_CONTEXTS.has(k)) delete event.contexts[k];
    }
  }
  if (typeof event.message === "string") event.message = scrubText(event.message);
  if (event.logentry?.message) event.logentry.message = scrubText(event.logentry.message);
  if (event.logentry?.params) delete event.logentry.params;
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  return event;
}

/** Sentry `beforeBreadcrumb` — 하나도 남기지 않는다(콘솔 글자·클릭 위치·IPC 주소). */
export function dropBreadcrumb(_b: Breadcrumb): null {
  return null;
}
