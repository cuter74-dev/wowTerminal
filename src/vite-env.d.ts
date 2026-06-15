/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 타임에 주입되는 앱 버전(Sentry release 태그용).
declare const __APP_VERSION__: string;
// 빌드 출처 마커: "ci"(공식 릴리스) | "local"(자체/게이트 빌드)와 git short rev.
declare const __BUILD_CHANNEL__: string;
declare const __BUILD_REV__: string;
