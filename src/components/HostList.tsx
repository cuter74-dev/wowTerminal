import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SshHost, TerminalSource } from "../types";
import { HostForm } from "./HostForm";

interface Props {
  source: TerminalSource;
  onSelect: (source: TerminalSource) => void;
}

export function HostList({ source, onSelect }: Props) {
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [editing, setEditing] = useState<SshHost | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const list = await invoke<SshHost[]>("ssh_list_hosts");
      setHosts(list);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("이 호스트를 삭제할까요?")) return;
    try {
      await invoke("ssh_delete_host", { id });
      if (source.kind === "ssh" && source.hostId === id) {
        onSelect({ kind: "local" });
      }
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  const isLocal = source.kind === "local";

  return (
    <div
      style={{
        width: 240,
        background: "#252526",
        color: "#cccccc",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid #1e1e1e",
      }}
    >
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #333" }}>
        <strong style={{ fontSize: 13 }}>wowTerminal</strong>
      </div>

      <button
        onClick={() => onSelect({ kind: "local" })}
        style={{
          ...rowStyle,
          background: isLocal ? "#094771" : "transparent",
          color: isLocal ? "#fff" : "#cccccc",
        }}
      >
        Local shell
      </button>

      <div
        style={{
          padding: "10px 12px 4px",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "#888",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>SSH Hosts</span>
        <button
          onClick={() => setEditing("new")}
          style={addBtnStyle}
          title="새 호스트"
        >
          +
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {hosts.map((h) => {
          const selected =
            source.kind === "ssh" && source.hostId === h.id;
          return (
            <div
              key={h.id}
              onClick={() => onSelect({ kind: "ssh", hostId: h.id })}
              style={{
                ...rowStyle,
                background: selected ? "#094771" : "transparent",
                color: selected ? "#fff" : "#cccccc",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 13 }}>{h.name}</span>
                <span style={{ fontSize: 11, color: "#888" }}>
                  {h.user}@{h.host}:{h.port}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(h);
                  }}
                  style={iconBtnStyle}
                  title="편집"
                >
                  ✎
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(h.id);
                  }}
                  style={iconBtnStyle}
                  title="삭제"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
        {hosts.length === 0 && (
          <div
            style={{
              padding: "12px",
              color: "#666",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            등록된 호스트 없음
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 8,
            background: "#5a1d1d",
            color: "#fdd",
            fontSize: 11,
            borderTop: "1px solid #800",
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            style={{ float: "right", ...iconBtnStyle }}
          >
            ×
          </button>
        </div>
      )}

      {editing && (
        <HostForm
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  border: "none",
  background: "transparent",
  color: "#cccccc",
  cursor: "pointer",
  fontSize: 13,
};

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "inherit",
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  padding: "0 4px",
};

const addBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#cccccc",
  border: "1px solid #555",
  borderRadius: 3,
  width: 20,
  height: 20,
  cursor: "pointer",
  fontSize: 14,
  lineHeight: "16px",
  padding: 0,
};
