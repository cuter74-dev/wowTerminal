import { Tab } from "../types";

interface Props {
  activeTab: Tab | null;
  tabCount: number;
}

function subtitleFor(tab: Tab): string {
  if (tab.root.kind === "split") return `${tab.label} (분할)`;
  return tab.root.source.kind === "ssh"
    ? `SSH — ${tab.label}`
    : `로컬 셸 — ${tab.label}`;
}

export function TitleBar({ activeTab, tabCount }: Props) {
  const subtitle = activeTab ? subtitleFor(activeTab) : "준비됨";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "#1f1f23",
        color: "#cccccc",
        borderBottom: "1px solid #111",
        padding: "0 12px",
        height: 32,
        userSelect: "none",
        fontSize: 12,
      }}
    >
      <strong style={{ marginRight: 16, color: "#fff" }}>AI Terminal</strong>
      <span style={{ color: "#9aa", flex: 1 }}>{subtitle}</span>
      <span style={{ color: "#888", marginRight: 12 }}>{tabCount}개 탭</span>
      <button
        style={{
          background: "transparent",
          border: "none",
          color: "#cccccc",
          cursor: "pointer",
          fontSize: 13,
        }}
        title="설정 (미구현)"
      >
        ⚙ 설정
      </button>
    </div>
  );
}
