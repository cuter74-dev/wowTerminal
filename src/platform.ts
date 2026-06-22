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
