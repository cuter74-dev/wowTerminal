import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import { isMacOS, isMobile } from "./platform";
import { markAppTeardown } from "./terminalRegistry";
import { loadSettings } from "./settings";
import { startErrorReporting } from "./telemetry";

// 에러·크래시 추적(GlitchTip) — 설정의 "오류 보고 보내기"가 꺼져 있으면 시작하지 않는다(#178).
const errorReports = loadSettings().general.errorReports;
startErrorReporting(errorReports);

// (#153) 창이 닫히거나 앱이 재시작되면 "앱 종료 중"으로 표시한다. 이 플래그가 서 있으면
// Terminal 언마운트 정리가 세션 kill을 보내지 않아, 세션이 데몬에 남아 다음 실행에서
// 다시 attach된다(업데이트로 relaunch되는 경우는 HostList.applyUpdate에서도 표시한다).
window.addEventListener("beforeunload", () => {
  markAppTeardown();
});

// 모바일(iOS/Android): 내부 스크롤 영역의 스크롤바 상시 표시용 클래스 (#149 — App.css 참고).
if (isMobile) {
  document.body.classList.add("plat-mobile");
}

// 플랫폼별 CSS 분기용 클래스 (예: macOS 전용 IME 미러의 composition-view 숨김 — App.css 참고).
if (isMacOS()) {
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
// Sentry.ErrorBoundary로 감싸 React 렌더 단계의 미처리 에러도 GlitchTip에 보고한다(오류 보고가
// 꺼져 있으면 SDK가 없어 보내지 않는다).
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
          {errorReports
            ? "The error was reported automatically. Restart the app to continue."
            : "Restart the app to continue."}
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
