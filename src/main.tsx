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
    // 백엔드/프론트를 한 GlitchTip 프로젝트에서 태그로 구분한다.
    initialScope: { tags: { component: "frontend" } },
  });
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
