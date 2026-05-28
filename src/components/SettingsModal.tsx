import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, SHORTCUTS } from "../settings";
import { Group, SshHost, Tag } from "../types";

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  onClose: () => void;
}

type TabId = "general" | "terminal" | "shortcuts" | "backup";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "general", label: "일반" },
  { id: "terminal", label: "터미널/테마" },
  { id: "shortcuts", label: "단축키" },
  { id: "backup", label: "가져오기/내보내기" },
];

export function SettingsModal({ settings, onChange, onClose }: Props) {
  const [tab, setTab] = useState<TabId>("general");

  function patchTerminal(p: Partial<AppSettings["terminal"]>) {
    onChange({ ...settings, terminal: { ...settings.terminal, ...p } });
  }
  function patchGeneral(p: Partial<AppSettings["general"]>) {
    onChange({ ...settings, general: { ...settings.general, ...p } });
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle} role="dialog" aria-modal="true">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>⚙ 설정</strong>
          <button onClick={onClose} style={iconBtnStyle}>×</button>
        </header>

        <div style={{ display: "flex", gap: 6, borderBottom: "1px solid #2a2a30", paddingBottom: 8 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: tab === t.id ? "#094771" : "transparent",
                color: tab === t.id ? "#fff" : "#aaa",
                border: "none",
                borderRadius: 4,
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ minHeight: 280 }}>
          {tab === "general" && (
            <Section>
              <Row label="앱 시작 시 마지막 탭 복원 (후속)">
                <input
                  type="checkbox"
                  checked={settings.general.restoreTabs}
                  onChange={(e) => patchGeneral({ restoreTabs: e.target.checked })}
                />
              </Row>
              <div style={{ color: "#789", fontSize: 11, marginTop: 8 }}>
                wowTerminal v0.1.0 · 기획서 기반 구현
              </div>
            </Section>
          )}

          {tab === "terminal" && (
            <Section>
              <Row label="폰트 크기">
                <input
                  type="number"
                  min={8}
                  max={32}
                  value={settings.terminal.fontSize}
                  onChange={(e) =>
                    patchTerminal({ fontSize: parseInt(e.target.value || "14", 10) })
                  }
                  style={inputStyle}
                />
              </Row>
              <Row label="폰트 패밀리">
                <input
                  value={settings.terminal.fontFamily}
                  onChange={(e) => patchTerminal({ fontFamily: e.target.value })}
                  style={{ ...inputStyle, width: 240 }}
                />
              </Row>
              <Row label="테마">
                <select
                  value={settings.terminal.theme}
                  onChange={(e) =>
                    patchTerminal({ theme: e.target.value as "dark" | "light" })
                  }
                  style={inputStyle}
                >
                  <option value="dark">다크</option>
                  <option value="light">라이트</option>
                </select>
              </Row>
              <Row label="커서 깜빡임">
                <input
                  type="checkbox"
                  checked={settings.terminal.cursorBlink}
                  onChange={(e) => patchTerminal({ cursorBlink: e.target.checked })}
                />
              </Row>
              <Row label="스크롤백 (줄)">
                <input
                  type="number"
                  min={100}
                  max={100000}
                  step={100}
                  value={settings.terminal.scrollback}
                  onChange={(e) =>
                    patchTerminal({ scrollback: parseInt(e.target.value || "1000", 10) })
                  }
                  style={inputStyle}
                />
              </Row>
              <div style={{ color: "#789", fontSize: 11, marginTop: 6 }}>
                변경 즉시 모든 터미널에 적용됩니다.
              </div>
            </Section>
          )}

          {tab === "shortcuts" && (
            <Section>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {SHORTCUTS.map((s) => (
                    <tr key={s.keys}>
                      <td style={{ padding: "5px 8px", color: "#9aa", whiteSpace: "nowrap" }}>
                        <kbd style={kbdStyle}>{s.keys}</kbd>
                      </td>
                      <td style={{ padding: "5px 8px" }}>{s.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ color: "#789", fontSize: 11, marginTop: 8 }}>
                v1은 읽기 전용입니다. 사용자 정의 키 바인딩은 후속.
              </div>
            </Section>
          )}

          {tab === "backup" && <BackupTab />}
        </div>
      </div>
    </div>
  );
}

function BackupTab() {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function doExport() {
    setMsg(null);
    try {
      const [hosts, groups, tags] = await Promise.all([
        invoke<SshHost[]>("ssh_list_hosts"),
        invoke<Group[]>("ssh_list_groups"),
        invoke<Tag[]>("ssh_list_tags"),
      ]);
      const payload = { version: 1, hosts, groups, tags };
      setText(JSON.stringify(payload, null, 2));
      setMsg("내보내기 완료 — 아래 JSON을 복사해 보관하세요. (시크릿은 포함되지 않습니다)");
    } catch (e) {
      setMsg(`내보내기 실패: ${String(e)}`);
    }
  }

  async function doImport() {
    setMsg(null);
    try {
      const parsed = JSON.parse(text);
      const groups: Group[] = parsed.groups ?? [];
      const tags: Tag[] = parsed.tags ?? [];
      const hosts: SshHost[] = parsed.hosts ?? [];
      for (const g of groups) await invoke("ssh_save_group", { group: g });
      for (const t of tags) await invoke("ssh_save_tag", { tag: t });
      for (const h of hosts) await invoke("ssh_save_host", { host: h });
      setMsg(
        `가져오기 완료: 호스트 ${hosts.length} / 그룹 ${groups.length} / 태그 ${tags.length}`,
      );
    } catch (e) {
      setMsg(`가져오기 실패: ${String(e)}`);
    }
  }

  return (
    <Section>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => void doExport()} style={primaryBtnStyle}>
          내보내기 (호스트/그룹/태그)
        </button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text);
          }}
          disabled={!text}
          style={btnStyle}
        >
          복사
        </button>
        <button onClick={() => void doImport()} disabled={!text.trim()} style={btnStyle}>
          가져오기
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder="내보낸 JSON이 여기 표시됩니다. 가져오려면 JSON을 붙여넣고 [가져오기]."
        style={{
          ...inputStyle,
          width: "100%",
          fontFamily: "monospace",
          fontSize: 11,
          resize: "vertical",
          marginTop: 8,
        }}
      />
      {msg && <div style={{ color: "#9cf", fontSize: 11, marginTop: 6 }}>{msg}</div>}
      <div style={{ color: "#789", fontSize: 11, marginTop: 4 }}>
        시크릿(비밀번호/키)은 Keychain에 남고 export에 포함되지 않습니다.
      </div>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>{children}</div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 12, color: "#ccc" }}>{label}</span>
      {children}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  width: 560,
  maxWidth: "92vw",
  maxHeight: "88vh",
  overflowY: "auto",
  background: "#26262d",
  border: "1px solid #333",
  borderRadius: 6,
  color: "#e6e6e6",
  boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
  padding: 20,
  fontSize: 13,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};
const inputStyle: React.CSSProperties = {
  background: "#1e1e1e",
  color: "#e6e6e6",
  border: "1px solid #444",
  padding: "5px 8px",
  borderRadius: 3,
  fontSize: 12,
  outline: "none",
};
const btnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  color: "#cccccc",
  border: "1px solid #555",
  padding: "6px 12px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 12,
};
const primaryBtnStyle: React.CSSProperties = {
  background: "#0a5380",
  color: "#fff",
  border: "1px solid #4a9eff",
  padding: "6px 12px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 12,
};
const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 15,
  padding: "0 4px",
};
const kbdStyle: React.CSSProperties = {
  background: "#1a1a20",
  border: "1px solid #444",
  borderRadius: 3,
  padding: "2px 6px",
  fontFamily: "monospace",
  fontSize: 11,
};
