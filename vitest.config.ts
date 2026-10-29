import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// 입력(IME) 리플레이 테스트(#158). 실제 Terminal 컴포넌트를 happy-dom에서 렌더하고
// Tauri invoke/listen만 목으로 바꿔, 녹화된 입력 이벤트가 PTY로 보내는 바이트를 검증한다.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_CHANNEL__: JSON.stringify("test"),
    __BUILD_REV__: JSON.stringify("test"),
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
