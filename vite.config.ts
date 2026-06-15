import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import pkg from "./package.json";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// 빌드 출처(provenance) 마커. 공식 릴리스는 v* 태그 push로 GitHub Actions(CI)에서만 빌드되고,
// 자체/로컬 빌드(게이트용 등)는 GITHUB_ACTIONS가 없다. 같은 버전 문자열을 쓰는 두 빌드를
// GlitchTip 진단과 UI 푸터에서 구분하기 위함 — 로컬 게이트 실행이 실 사용자 데이터를 오염시키지
// 않도록(#100에서 실측: 게이트 이벤트가 설치본과 같은 release 태그로 섞였다).
// @ts-expect-error process is a nodejs global
const BUILD_CHANNEL = process.env.GITHUB_ACTIONS ? "ci" : "local";
const BUILD_REV = (() => {
  try {
    const rev = execSync("git rev-parse --short HEAD").toString().trim();
    const dirty = execSync("git status --porcelain").toString().trim() ? "+dirty" : "";
    return rev + dirty;
  } catch {
    return "nogit";
  }
})();

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // 빌드 타임에 앱 버전을 주입(Sentry/GlitchTip release 태그용). getVersion()은 async라
  // init 시점에 못 쓰므로 상수로 박는다.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_CHANNEL__: JSON.stringify(BUILD_CHANNEL), // "ci" | "local"
    __BUILD_REV__: JSON.stringify(BUILD_REV),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
