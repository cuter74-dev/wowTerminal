// 오류 추적(GlitchTip)으로 나가는 이벤트에서 개인 정보를 걷어 낸다 (#177).
// 보내는 것: 예외 종류·가린 메시지·스택(앱 번들 안 위치)·OS/브라우저/기기 종류·앱 버전·태그.
// 보내지 않는 것: 친 내용, 화면·출력 글자, breadcrumb(콘솔·클릭·IPC 주소), extra, 사용자 정보,
// 메시지 속 경로·주소·user@host·이메일.
import * as Sentry from "@sentry/react";
import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import { invoke } from "@tauri-apps/api/core";

// DSN은 공개 수집 키라 임베드해도 안전(비밀 아님). VITE_GLITCHTIP_DSN 빌드 변수로 덮어쓰거나
// 빈 값으로 두면 빌드 자체에서 끈다.
const GLITCHTIP_DSN: string =
  import.meta.env.VITE_GLITCHTIP_DSN ??
  "https://663f23ace357492887f838d73b57a50c@glitchtip.oopnwow.com/1";

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

let started = false;

/** 프런트 오류 보고를 시작한다. 꺼져 있으면 SDK를 아예 띄우지 않아 오류도, 실행마다 가는
 *  익명 세션 신호도 보내지 않는다. 백엔드에도 같은 선택을 알린다(#178). */
export function startErrorReporting(enabled: boolean): void {
  void invoke("set_error_reporting", { enabled }).catch(() => {});
  if (!enabled || !GLITCHTIP_DSN || started) return;
  started = true;
  Sentry.init({
    dsn: GLITCHTIP_DSN,
    release: `wowterminal@${__APP_VERSION__}`,
    environment: import.meta.env.MODE, // development | production
    // 빌드 출처로 같은 버전의 공식(ci) vs 자체/게이트(local) 빌드를 구분한다 — 로컬 게이트
    // 실행이 실 사용자 진단을 오염시키지 않도록(#100). GlitchTip에서 dist=local 필터로 분리.
    dist: __BUILD_CHANNEL__,
    // 백엔드/프론트를 한 GlitchTip 프로젝트에서 태그로 구분한다.
    initialScope: {
      tags: { component: "frontend", build: `${__BUILD_CHANNEL__}.${__BUILD_REV__}` },
    },
    // 개인 정보는 보내지 않는다(#177): breadcrumb(콘솔 글자·클릭·IPC 주소) 없음, 이벤트의
    // extra·사용자·요청 정보를 지우고 메시지 속 경로·주소·계정을 가린다.
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: dropBreadcrumb,
    beforeSend: scrubEvent,
  });
}

/** 설정에서 "오류 보고 보내기"를 바꿀 때. 끄면 곧바로 SDK를 닫아 더 보내지 않는다. */
export function setErrorReporting(enabled: boolean): void {
  if (enabled) {
    startErrorReporting(true);
    return;
  }
  void invoke("set_error_reporting", { enabled: false }).catch(() => {});
  if (started) {
    started = false;
    void Sentry.close().catch(() => {});
  }
}
