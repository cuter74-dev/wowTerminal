// 세션 대시보드 (#62). 열려 있는 모든 탭/패널을 한눈에 — 소스(로컬/SSH 호스트),
// 세션 활성 여부, 마지막 명령 종료코드·소요시간·명령 수. 행 클릭으로 해당 탭으로 점프.

import { LangDict, useT } from "../i18n";

export interface DashRow {
  tabId: string;
  tabLabel: string;
  paneId: string;
  kind: "local" | "ssh";
  hostLabel?: string;
  /** 세션이 살아 있는지(sessionId 보유). */
  active: boolean;
  isActiveTab: boolean;
  count: number;
  lastExit?: number;
  lastDurationMs?: number;
  lastAt?: number;
}

interface Props {
  rows: DashRow[];
  onJump: (tabId: string) => void;
  onClose: () => void;
}

const STR: LangDict<{
  title: string;
  empty: string;
  colSession: string;
  colSource: string;
  colStatus: string;
  colCommands: string;
  colLast: string;
  active: string;
  idle: string;
  local: string;
  totals: (tabs: number, ssh: number, local: number) => string;
  never: string;
  close: string;
}> = {
  en: {
    title: "Session dashboard",
    empty: "No open sessions.",
    colSession: "Session",
    colSource: "Source",
    colStatus: "Status",
    colCommands: "Commands",
    colLast: "Last command",
    active: "active",
    idle: "ended",
    local: "Local shell",
    totals: (tabs, ssh, local) =>
      `${tabs} tabs · ${ssh} SSH · ${local} local`,
    never: "—",
    close: "Close",
  },
  ko: {
    title: "세션 대시보드",
    empty: "열린 세션이 없습니다.",
    colSession: "세션",
    colSource: "소스",
    colStatus: "상태",
    colCommands: "명령 수",
    colLast: "마지막 명령",
    active: "활성",
    idle: "종료됨",
    local: "로컬 셸",
    totals: (tabs, ssh, local) =>
      `탭 ${tabs}개 · SSH ${ssh} · 로컬 ${local}`,
    never: "—",
    close: "닫기",
  },
};

function fmtDur(ms?: number): string {
  if (ms == null) return "";
  if (ms >= 10000) return `${Math.round(ms / 1000)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtAgo(at: number | undefined, never: string): string {
  if (!at) return never;
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

export function SessionDashboard({ rows, onJump, onClose }: Props) {
  const t = useT(STR);
  const sshCount = rows.filter((r) => r.kind === "ssh").length;
  const localCount = rows.filter((r) => r.kind === "local").length;
  const tabCount = new Set(rows.map((r) => r.tabId)).size;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 60,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(760px, 92vw)",
          maxHeight: "80vh",
          background: "#1e1e22",
          border: "1px solid #333",
          borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          color: "#ddd",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid #2c2c30",
          }}
        >
          <strong style={{ fontSize: 14 }}>📊 {t.title}</strong>
          <span style={{ color: "#889", fontSize: 12 }}>
            {t.totals(tabCount, sshCount, localCount)}
          </span>
        </div>

        <div style={{ overflow: "auto" }}>
          {rows.length === 0 ? (
            <div style={{ padding: 24, color: "#889", textAlign: "center" }}>
              {t.empty}
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12.5,
              }}
            >
              <thead>
                <tr style={{ color: "#889", textAlign: "left" }}>
                  <th style={th}>{t.colSession}</th>
                  <th style={th}>{t.colSource}</th>
                  <th style={th}>{t.colStatus}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t.colCommands}</th>
                  <th style={th}>{t.colLast}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.paneId}
                    onClick={() => {
                      onJump(r.tabId);
                      onClose();
                    }}
                    style={{
                      cursor: "pointer",
                      background: r.isActiveTab ? "#26323a" : "transparent",
                      borderTop: "1px solid #2a2a2e",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#2a2f36")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = r.isActiveTab
                        ? "#26323a"
                        : "transparent")
                    }
                  >
                    <td style={td}>{r.tabLabel || "—"}</td>
                    <td style={td}>
                      {r.kind === "ssh" ? (
                        <span>🔗 {r.hostLabel}</span>
                      ) : (
                        <span style={{ color: "#9aa" }}>▸ {t.local}</span>
                      )}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          color: r.active ? "#7ed98a" : "#a88",
                          fontWeight: 600,
                        }}
                      >
                        ● {r.active ? t.active : t.idle}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{r.count}</td>
                    <td style={td}>
                      {r.lastExit != null ? (
                        <span>
                          <span
                            style={{ color: r.lastExit === 0 ? "#7ed98a" : "#e06c6c" }}
                          >
                            {r.lastExit === 0 ? "✓" : "✗"}
                          </span>{" "}
                          {fmtDur(r.lastDurationMs)}{" "}
                          <span style={{ color: "#778" }}>
                            · {fmtAgo(r.lastAt, t.never)}
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: "#667" }}>{t.never}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid #2c2c30",
            textAlign: "right",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "#2a2a2e",
              border: "1px solid #444",
              color: "#ddd",
              borderRadius: 4,
              padding: "5px 14px",
              cursor: "pointer",
            }}
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "8px 12px",
  fontWeight: 600,
  position: "sticky",
  top: 0,
  background: "#1e1e22",
};
const td: React.CSSProperties = { padding: "8px 12px" };
