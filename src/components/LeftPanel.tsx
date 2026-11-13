/**
 * 왼쪽 패널 상단의 [서버 | 파일 | 에이전트] 전환 (#166, 화면 기획서 SC-01 ①; 에이전트는 #187).
 * 3단 구조를 유지한 채 같은 자리를 서버 목록·파일 트리·에이전트 목록이 나눠 쓴다. 모두 마운트를
 * 유지하고(display 토글) 서버 목록의 상태(업데이트 확인 등)와 파일 트리의 펼침 상태가 전환해도
 * 사라지지 않게 한다.
 */
import { LangDict, useT } from "../i18n";

export type LeftMode = "servers" | "files" | "agents";
const KEY = "wowterminal.leftPanel";

export function loadLeftMode(): LeftMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "files" || v === "agents" ? v : "servers";
  } catch {
    return "servers";
  }
}
export function saveLeftMode(m: LeftMode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // 기억하지 못해도 동작에는 지장 없다.
  }
}

const STR: LangDict<{ servers: string; files: string; filesTip: string; agents: string; agentsTip: string }> = {
  en: { servers: "Servers", files: "Files", filesTip: "Files of the active tab's server (⌘⇧O)", agents: "Agents", agentsTip: "AI agents in your terminals" },
  ko: { servers: "서버", files: "파일", filesTip: "활성 탭 서버의 파일 (⌘⇧O)", agents: "에이전트", agentsTip: "터미널의 AI 에이전트" },
  es: { servers: "Servidores", files: "Archivos", filesTip: "Archivos del servidor de la pestaña activa (⌘⇧O)", agents: "Agentes", agentsTip: "Agentes de IA en tus terminales" },
  zh: { servers: "服务器", files: "文件", filesTip: "当前标签页服务器的文件 (⌘⇧O)", agents: "代理", agentsTip: "终端中的 AI 代理" },
  ja: { servers: "サーバー", files: "ファイル", filesTip: "アクティブなタブのサーバーのファイル (⌘⇧O)", agents: "エージェント", agentsTip: "ターミナルの AI エージェント" },
  ru: { servers: "Серверы", files: "Файлы", filesTip: "Файлы сервера активной вкладки (⌘⇧O)", agents: "Агенты", agentsTip: "ИИ-агенты в ваших терминалах" },
  fr: { servers: "Serveurs", files: "Fichiers", filesTip: "Fichiers du serveur de l'onglet actif (⌘⇧O)", agents: "Agents", agentsTip: "Agents IA dans vos terminaux" },
  de: { servers: "Server", files: "Dateien", filesTip: "Dateien des Servers im aktiven Tab (⌘⇧O)", agents: "Agenten", agentsTip: "KI-Agenten in deinen Terminals" },
  vi: { servers: "Máy chủ", files: "Tệp", filesTip: "Tệp của máy chủ ở tab đang mở (⌘⇧O)", agents: "Tác tử", agentsTip: "Tác tử AI trong terminal của bạn" },
  id: { servers: "Server", files: "Berkas", filesTip: "Berkas server pada tab aktif (⌘⇧O)", agents: "Agen", agentsTip: "Agen AI di terminal Anda" },
  hi: { servers: "सर्वर", files: "फ़ाइलें", filesTip: "सक्रिय टैब के सर्वर की फ़ाइलें (⌘⇧O)", agents: "एजेंट", agentsTip: "आपके टर्मिनल में AI एजेंट" },
};

export function LeftPanel({
  mode,
  onMode,
  servers,
  files,
  agents,
  agentCount,
  agentWaiting,
}: {
  mode: LeftMode;
  onMode: (m: LeftMode) => void;
  servers: React.ReactNode;
  files: React.ReactNode;
  agents: React.ReactNode;
  /** 에이전트 수와 그중 답을 기다리는 수 — 칸 이름 옆 숫자·노란 점(#187). */
  agentCount: number;
  agentWaiting: number;
}) {
  const t = useT(STR);
  const seg = (m: LeftMode, label: React.ReactNode, title?: string) => {
    const on = mode === m;
    return (
      <button
        role="tab"
        aria-selected={on}
        title={title}
        onClick={() => onMode(m)}
        style={{
          flex: 1,
          height: 26,
          border: "none",
          borderRadius: 5,
          fontSize: 12,
          cursor: "pointer",
          background: on ? (m === "files" ? "#2f5fb3" : "#3a3a44") : "transparent",
          color: on ? "#fff" : "#9aa3b0",
          fontWeight: on ? 600 : 400,
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "#17171b" }}>
      <div role="tablist" style={{ display: "flex", gap: 2, margin: "6px 8px", padding: 2, borderRadius: 7, background: "#202027", border: "1px solid #2c2c34", flexShrink: 0 }}>
        {seg("servers", t.servers)}
        {seg("files", t.files, t.filesTip)}
        {seg(
          "agents",
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {t.agents}
            {agentCount > 0 && <span style={{ fontSize: 10, opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>{agentCount}</span>}
            {agentWaiting > 0 && (
              <span
                data-testid="agents-waiting-dot"
                className="wt-ai-blocked"
                style={{ width: 6, height: 6, borderRadius: "50%", background: "#e3b341" }}
              />
            )}
          </span>,
          t.agentsTip,
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: mode === "servers" ? "flex" : "none" }}>{servers}</div>
      <div style={{ flex: 1, minHeight: 0, display: mode === "files" ? "flex" : "none", flexDirection: "column" }}>{files}</div>
      <div style={{ flex: 1, minHeight: 0, display: mode === "agents" ? "flex" : "none", flexDirection: "column" }}>{agents}</div>
    </div>
  );
}
