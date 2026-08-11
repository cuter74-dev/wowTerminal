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
  // 단 래치는 **현재 환경 지문**에 각인된 것만 신뢰한다(#136). 업데이트/OS변경으로 지문이
  // 바뀌면 옛 판정으로 클래스를 미리 켜지 않는다(재검출은 Terminal.tsx가 담당).
  try {
    const fp = `${__APP_VERSION__}|${navigator.userAgent}`;
    if (
      localStorage.getItem("wt.ime.cmp") === "1" &&
      localStorage.getItem("wt.ime.cmp.fp") === fp
    ) {
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
  <Sentry.ErrorBoundary
    fallback={
      // 렌더 크래시 시의 최후 화면(#144) — 검정 배경 위 기본 텍스트는 읽히지 않았다.
      <div
        style={{
          height: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12,
          background: "#1e1e1e", color: "#e6e6e6",
          fontFamily: "system-ui, sans-serif", padding: 24, textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>An unexpected error occurred</div>
        <div style={{ color: "#9a9aa5", fontSize: 13 }}>
          The error was reported automatically. Restart the app to continue.
        </div>
        <button
          onClick={() => location.reload()}
          style={{
            marginTop: 8, padding: "8px 18px", borderRadius: 6, cursor: "pointer",
            background: "#0a5380", color: "#fff", border: "1px solid #4a9eff", fontSize: 14,
          }}
        >
          Reload
        </button>
      </div>
    }
  >
    <App />
  </Sentry.ErrorBoundary>,
);
