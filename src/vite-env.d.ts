/// <reference types="vite/client" />

// vite.config.ts의 define으로 빌드 타임에 주입되는 앱 버전(Sentry release 태그용).
declare const __APP_VERSION__: string;
