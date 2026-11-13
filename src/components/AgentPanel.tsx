/**
 * 왼쪽 패널의 에이전트 목록 (#187). 모든 탭의 AI 에이전트(Claude Code·Codex·Gemini CLI)와 상태 —
 * 답을 기다림·끝남·일하는 중·쉬는 중 — 를 한눈에 보여 주고, 누르면 그 탭·창으로 간다.
 * 상태는 Terminal이 화면으로 판정해 버스로 알린 것을 App이 모아 넘겨준다(aiActivity.ts).
 */
import { useEffect, useState } from "react";
import { AGENT_COLORS, AGENT_NAMES, type AgentKind, type AgentState } from "../aiActivity";
import { LangDict, useT } from "../i18n";

/** 패널 하나의 에이전트 상태. unseen = 보지 않는 사이에 일을 마침(목록에서 "끝남"). */
export type PaneAgent = { agent: AgentKind; state: AgentState; since: number; unseen: boolean };
export type AgentRow = PaneAgent & {
  paneId: string;
  tabId: string;
  tabLabel: string;
  hostLabel: string | null;
  /** 지금 보고 있는 탭의 포커스 패널. */
  active: boolean;
};

type Shown = "blocked" | "done" | "working" | "idle";
export function shownState(a: PaneAgent): Shown {
  return a.state === "idle" ? (a.unseen ? "done" : "idle") : a.state;
}
const ORDER: Record<Shown, number> = { blocked: 0, done: 1, working: 2, idle: 3 };
/** 기다리는 것 먼저, 같은 상태끼리는 오래된 것 먼저. */
export function sortAgentRows(rows: AgentRow[]): AgentRow[] {
  return [...rows].sort((a, b) => ORDER[shownState(a)] - ORDER[shownState(b)] || a.since - b.since);
}

const STR: LangDict<{
  working: string;
  blocked: string;
  done: string;
  idle: string;
  empty: string;
  emptyHint: string;
  justNow: string;
  minutes: (n: number) => string;
  hours: (n: number) => string;
  jump: string;
}> = {
  en: { working: "Working", blocked: "Waiting for you", done: "Finished", idle: "Idle", empty: "No AI agents running", emptyHint: "Start Claude Code, Codex or Gemini CLI in a terminal tab. It shows up here with its status: working, waiting for you, or finished.", justNow: "now", minutes: (n) => `${n}m`, hours: (n) => `${n}h`, jump: "Go to this pane" },
  ko: { working: "일하는 중", blocked: "답을 기다림", done: "끝남", idle: "쉬는 중", empty: "실행 중인 AI 에이전트가 없습니다", emptyHint: "터미널 탭에서 Claude Code·Codex·Gemini CLI를 실행하면 여기에 상태(일하는 중·답을 기다림·끝남)와 함께 나타납니다.", justNow: "방금", minutes: (n) => `${n}분`, hours: (n) => `${n}시간`, jump: "이 창으로 이동" },
  es: { working: "Trabajando", blocked: "Espera tu respuesta", done: "Terminado", idle: "Inactivo", empty: "No hay agentes de IA en ejecución", emptyHint: "Inicia Claude Code, Codex o Gemini CLI en una pestaña de terminal. Aparecerá aquí con su estado: trabajando, esperando tu respuesta o terminado.", justNow: "ahora", minutes: (n) => `${n} min`, hours: (n) => `${n} h`, jump: "Ir a este panel" },
  zh: { working: "工作中", blocked: "等待你的回答", done: "已完成", idle: "空闲", empty: "没有正在运行的 AI 代理", emptyHint: "在终端标签页中启动 Claude Code、Codex 或 Gemini CLI，它会连同状态（工作中、等待你的回答、已完成）显示在这里。", justNow: "刚刚", minutes: (n) => `${n} 分钟`, hours: (n) => `${n} 小时`, jump: "转到此窗格" },
  ja: { working: "作業中", blocked: "回答待ち", done: "完了", idle: "待機中", empty: "実行中の AI エージェントはありません", emptyHint: "ターミナルタブで Claude Code・Codex・Gemini CLI を起動すると、状態（作業中・回答待ち・完了）と一緒にここに表示されます。", justNow: "たった今", minutes: (n) => `${n}分`, hours: (n) => `${n}時間`, jump: "このペインへ移動" },
  ru: { working: "Работает", blocked: "Ждёт ответа", done: "Готово", idle: "Простаивает", empty: "ИИ-агенты не запущены", emptyHint: "Запустите Claude Code, Codex или Gemini CLI во вкладке терминала — агент появится здесь со статусом: работает, ждёт ответа или готово.", justNow: "только что", minutes: (n) => `${n} мин`, hours: (n) => `${n} ч`, jump: "Перейти к этой панели" },
  fr: { working: "Au travail", blocked: "Attend votre réponse", done: "Terminé", idle: "Inactif", empty: "Aucun agent IA en cours", emptyHint: "Lancez Claude Code, Codex ou Gemini CLI dans un onglet de terminal. Il apparaît ici avec son état : au travail, en attente de votre réponse ou terminé.", justNow: "à l'instant", minutes: (n) => `${n} min`, hours: (n) => `${n} h`, jump: "Aller à ce panneau" },
  de: { working: "Arbeitet", blocked: "Wartet auf dich", done: "Fertig", idle: "Leerlauf", empty: "Keine KI-Agenten aktiv", emptyHint: "Starte Claude Code, Codex oder Gemini CLI in einem Terminal-Tab. Der Agent erscheint hier mit seinem Status: arbeitet, wartet auf dich oder fertig.", justNow: "gerade", minutes: (n) => `${n} Min.`, hours: (n) => `${n} Std.`, jump: "Zu diesem Bereich wechseln" },
  vi: { working: "Đang làm", blocked: "Chờ bạn trả lời", done: "Đã xong", idle: "Rảnh", empty: "Chưa có tác tử AI nào chạy", emptyHint: "Chạy Claude Code, Codex hoặc Gemini CLI trong một tab terminal. Nó sẽ hiện ở đây cùng trạng thái: đang làm, chờ bạn trả lời hoặc đã xong.", justNow: "vừa xong", minutes: (n) => `${n} phút`, hours: (n) => `${n} giờ`, jump: "Chuyển đến khung này" },
  id: { working: "Bekerja", blocked: "Menunggu jawaban Anda", done: "Selesai", idle: "Diam", empty: "Tidak ada agen AI yang berjalan", emptyHint: "Jalankan Claude Code, Codex, atau Gemini CLI di tab terminal. Agen akan muncul di sini beserta statusnya: bekerja, menunggu jawaban Anda, atau selesai.", justNow: "baru saja", minutes: (n) => `${n} mnt`, hours: (n) => `${n} jam`, jump: "Buka panel ini" },
  hi: { working: "काम कर रहा है", blocked: "आपके जवाब की प्रतीक्षा", done: "पूरा हुआ", idle: "खाली", empty: "कोई AI एजेंट नहीं चल रहा", emptyHint: "किसी टर्मिनल टैब में Claude Code, Codex या Gemini CLI चलाएँ। वह यहाँ अपनी स्थिति के साथ दिखेगा: काम कर रहा है, आपके जवाब की प्रतीक्षा, या पूरा हुआ।", justNow: "अभी", minutes: (n) => `${n} मि.`, hours: (n) => `${n} घं.`, jump: "इस पैन पर जाएँ" },
};

const STATE_COLOR: Record<Shown, string> = {
  blocked: "#e3b341",
  done: "#4a9eff",
  working: "#c792ea",
  idle: "#6e7681",
};

function StateIcon({ shown }: { shown: Shown }) {
  if (shown === "blocked") {
    return (
      <span
        className="wt-ai-blocked"
        style={{ width: 14, height: 14, borderRadius: "50%", background: STATE_COLOR.blocked, color: "#1e1e1e", fontSize: 10, fontWeight: 700, lineHeight: "14px", textAlign: "center", flexShrink: 0 }}
      >
        ?
      </span>
    );
  }
  if (shown === "working") {
    return (
      <span className="wt-ai-working" style={{ width: 14, textAlign: "center", color: STATE_COLOR.working, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>
        ✻
      </span>
    );
  }
  return (
    <span style={{ width: 14, textAlign: "center", color: STATE_COLOR[shown], fontSize: 10, lineHeight: 1, flexShrink: 0 }}>
      {shown === "done" ? "●" : "○"}
    </span>
  );
}

function elapsed(ms: number, t: { justNow: string; minutes: (n: number) => string; hours: (n: number) => string }): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return t.justNow;
  if (m < 60) return t.minutes(m);
  return t.hours(Math.floor(m / 60));
}

export function AgentPanel({ rows, onJump }: { rows: AgentRow[]; onJump: (tabId: string, paneId: string) => void }) {
  const t = useT(STR);
  // 경과 시간 글자를 30초마다 새로 그린다.
  const [, tick] = useState(0);
  useEffect(() => {
    if (rows.length === 0) return;
    const iv = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(iv);
  }, [rows.length]);

  if (rows.length === 0) {
    return (
      <div data-testid="agent-panel-empty" style={{ flex: 1, padding: "18px 14px", color: "#7a8290", fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ color: "#cdd3da", fontSize: 13, marginBottom: 6 }}>{t.empty}</div>
        {t.emptyHint}
      </div>
    );
  }
  const now = Date.now();
  return (
    <div role="list" data-testid="agent-panel" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 6px 8px" }}>
      {sortAgentRows(rows).map((r) => {
        const shown = shownState(r);
        const where = r.hostLabel && r.hostLabel !== r.tabLabel ? `${r.tabLabel} · ${r.hostLabel}` : r.tabLabel;
        return (
          <button
            key={r.paneId}
            role="listitem"
            data-agent-state={shown}
            title={t.jump}
            onClick={() => onJump(r.tabId, r.paneId)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              width: "100%",
              padding: "7px 8px",
              marginBottom: 2,
              border: "none",
              borderRadius: 6,
              background: r.active ? "#2a2a33" : "transparent",
              color: "#c9d1d9",
              textAlign: "left",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <span style={{ paddingTop: 1, display: "flex" }}>
              <StateIcon shown={shown} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ color: AGENT_COLORS[r.agent], fontWeight: 600 }}>{AGENT_NAMES[r.agent]}</span>
                <span style={{ marginLeft: "auto", color: "#6e7681", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                  {elapsed(now - r.since, t)}
                </span>
              </span>
              <span style={{ display: "block", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#8b949e", fontSize: 11 }}>
                <span style={{ color: STATE_COLOR[shown] }}>{t[shown]}</span> · {where}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
