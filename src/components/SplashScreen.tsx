// S-001 스플래시/로딩.

import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { LangDict, useT } from "../i18n";

const STR: LangDict<{ initializing: string }> = {
  en: { initializing: "Initializing…" },
  ko: { initializing: "초기화 중…" },
  es: { initializing: "Inicializando…" },
  zh: { initializing: "正在初始化…" },
  ja: { initializing: "初期化中…" },
  ru: { initializing: "Инициализация…" },
  fr: { initializing: "Initialisation…" },
  de: { initializing: "Initialisierung…" },
  vi: { initializing: "Đang khởi tạo…" },
  id: { initializing: "Menginisialisasi…" },
  hi: { initializing: "आरंभ हो रहा है…" },
};

export function SplashScreen() {
  const t = useT(STR);
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);
  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        background: "#1a1a20",
        color: "#e6e6e6",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        userSelect: "none",
      }}
    >
      <img
        src="/logo.png"
        alt="AI Terminal"
        style={{ width: 96, height: 96, objectFit: "contain" }}
      />
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>AI Terminal</div>
      <div style={{ fontSize: 12, color: "#789" }}>
        {appVersion ? `v${appVersion}` : ""}
      </div>
      <div
        style={{
          width: 180,
          height: 3,
          background: "#2a2a30",
          borderRadius: 2,
          overflow: "hidden",
          marginTop: 8,
        }}
      >
        <div
          style={{
            width: "40%",
            height: "100%",
            background: "#4a9eff",
            borderRadius: 2,
            animation: "wt-splash 1s ease-in-out infinite",
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: "#566" }}>{t.initializing}</div>
      <style>
        {`@keyframes wt-splash { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }`}
      </style>
    </main>
  );
}
