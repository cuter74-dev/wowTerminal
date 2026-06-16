import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";

// 에러·크래시 추적(GlitchTip = Sentry 호환). DSN은 공개 수집 키라 임베드해도 안전(비밀 아님).
// VITE_GLITCHTIP_DSN 환경변수로 덮어쓰거나, 빈 값으로 두면 추적을 끈다(opt-out).
const GLITCHTIP_DSN =
  import.meta.env.VITE_GLITCHTIP_DSN ??
  "https://663f23ace357492887f838d73b57a50c@glitchtip.oopnwow.com/1";

if (GLITCHTIP_DSN) {
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
  });
}

// 플랫폼별 CSS 분기용 클래스 (예: macOS 전용 IME 미러의 composition-view 숨김 — App.css 참고).
if (navigator.userAgent.includes("Mac")) {
  document.body.classList.add("plat-mac");
  // composition 머신(네이티브 IME)으로 판별된 적이 있으면 composition-view 숨김을 해제한다
  // — 조합 중 음절이 보이도록(#100). Terminal.tsx가 latch 시에도 이 클래스를 부여한다.
  try {
    if (localStorage.getItem("wt.ime.cmp") === "1") {
      document.body.classList.add("wt-native-ime");
    }
  } catch {
    /* 무시 */
  }
}

// StrictMode는 dev에서 effect를 mount→unmount→mount로 두 번 실행한다.
// PTY/SSH 세션은 mount당 1개 생성되므로 이 이중 실행이 세션 인계 도중
// 잘못된 kill(인계된 세션 사망)과 detached_init 이중 호출을 유발한다.
// prod 빌드에는 StrictMode가 없으므로(1회 실행) 동작 일관성을 위해 제거.
// Sentry.ErrorBoundary로 감싸 React 렌더 단계의 미처리 에러도 GlitchTip에 보고한다.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Sentry.ErrorBoundary fallback={<p>An unexpected error occurred.</p>}>
    <App />
  </Sentry.ErrorBoundary>,
);
