// 플랫폼 감지 (#114). 모바일(iOS/Android)에서는 로컬 셸(PTY)이 없으므로 로컬 셸 진입점을
// 숨기고 SSH/SFTP/AI 전용으로 동작하며, 터치 UI(온스크린 키바 등)를 켠다.
// plugin-os의 platform()은 동기로 즉시 값을 반환한다(플러그인 로드 시 주입).
import { platform } from "@tauri-apps/plugin-os";

let osPlatform = "";
try {
  osPlatform = platform();
} catch {
  // 비-Tauri 환경(브라우저 dev 서버)에서는 빈 값 — 데스크탑처럼 취급.
}

/** iOS/Android 빌드 여부. 로컬 셸 숨김·터치 UI 분기에 사용. */
export const isMobile = osPlatform === "ios" || osPlatform === "android";
export const isIOS = osPlatform === "ios";

export { osPlatform };

/** 지금 실행 중인 OS(plugin-os). 호출 시점에 읽는다 — 테스트가 트레이스마다 플랫폼을 바꿀 수 있게. */
export function currentPlatform(): string {
  try {
    return platform();
  } catch {
    return "";
  }
}

/** 실제 OS가 macOS인지 (#161). UA로 판별하면 안 된다 — iPadOS WKWebView는 기본으로 데스크탑
 *  Mac UA(`Macintosh; Intel Mac OS X`)를 보내, iPad가 macOS로 잡혀 macOS 전용 IME 미러 경로를
 *  탔다. Tauri 밖(브라우저 dev 서버)에서만 UA로 폴백한다. */
export function isMacOS(): boolean {
  const p = currentPlatform();
  if (p) return p === "macos";
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
}
