import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry, Listing } from "../types";

interface Props {
  hostId: string;
  hostLabel: string;
  onClose: () => void;
}

/** posix 경로 결합 (원격용). */
function joinPosix(cwd: string, name: string): string {
  if (name === "..") {
    const idx = cwd.replace(/\/+$/, "").lastIndexOf("/");
    return idx <= 0 ? "/" : cwd.slice(0, idx);
  }
  return `${cwd.replace(/\/+$/, "")}/${name}`;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fmtDate(epoch?: number | null): string {
  if (!epoch) return "";
  return new Date(epoch * 1000).toLocaleString();
}

export function FileBrowser({ hostId, hostLabel, onClose }: Props) {
  const [local, setLocal] = useState<Listing | null>(null);
  const [remote, setRemote] = useState<Listing | null>(null);
  const [localSel, setLocalSel] = useState<FileEntry | null>(null);
  const [remoteSel, setRemoteSel] = useState<FileEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(true);
  const [transfer, setTransfer] = useState<string | null>(null);

  const loadLocal = useCallback(async (path?: string) => {
    try {
      const l = await invoke<Listing>("local_list_dir", { path: path ?? null });
      setLocal(l);
    } catch (e) {
      setError(`로컬: ${String(e)}`);
    }
  }, []);

  const loadRemote = useCallback(
    async (path?: string) => {
      setRemoteBusy(true);
      try {
        const cmd = path ? "sftp_list" : "sftp_open";
        const args = path ? { hostId, path } : { hostId, path: null };
        const r = await invoke<Listing>(cmd, args);
        setRemote(r);
        setError(null);
      } catch (e) {
        setError(`원격: ${String(e)}`);
      } finally {
        setRemoteBusy(false);
      }
    },
    [hostId],
  );

  useEffect(() => {
    void loadLocal();
    void loadRemote();
    return () => {
      void invoke("sftp_disconnect", { hostId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download() {
    if (!remoteSel || remoteSel.is_dir || !remote || !local) return;
    setTransfer(`↓ ${remoteSel.name}`);
    setError(null);
    try {
      await invoke("sftp_download", {
        hostId,
        remotePath: joinPosix(remote.cwd, remoteSel.name),
        localDir: local.cwd,
      });
      await loadLocal(local.cwd);
    } catch (e) {
      setError(`다운로드: ${String(e)}`);
    } finally {
      setTransfer(null);
    }
  }

  async function upload() {
    if (!localSel || localSel.is_dir || !local || !remote) return;
    setTransfer(`↑ ${localSel.name}`);
    setError(null);
    try {
      await invoke("sftp_upload", {
        hostId,
        localPath: joinPosix(local.cwd, localSel.name),
        remoteDir: remote.cwd,
      });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(`업로드: ${String(e)}`);
    } finally {
      setTransfer(null);
    }
  }

  async function removeRemote() {
    if (!remoteSel || !remote) return;
    if (!confirm(`원격 '${remoteSel.name}'을(를) 삭제할까요?`)) return;
    try {
      await invoke("sftp_remove", {
        hostId,
        path: joinPosix(remote.cwd, remoteSel.name),
        isDir: remoteSel.is_dir,
      });
      setRemoteSel(null);
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(`삭제: ${String(e)}`);
    }
  }

  async function mkdirRemote() {
    if (!remote) return;
    const name = prompt("새 원격 폴더 이름:");
    if (!name) return;
    try {
      await invoke("sftp_mkdir", { hostId, path: joinPosix(remote.cwd, name) });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(`새 폴더: ${String(e)}`);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90vw",
          height: "85vh",
          background: "#1e1e24",
          border: "1px solid #333",
          borderRadius: 8,
          color: "#e6e6e6",
          display: "flex",
          flexDirection: "column",
          fontSize: 12,
          overflow: "hidden",
        }}
        role="dialog"
        aria-modal="true"
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: "1px solid #2a2a30",
            background: "#23232a",
          }}
        >
          <strong style={{ fontSize: 14 }}>📁 파일 브라우저</strong>
          <span style={{ color: "#789" }}>로컬 ↔ {hostLabel}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button onClick={() => void mkdirRemote()} style={toolBtnStyle} title="원격 새 폴더">
              + 폴더(원격)
            </button>
            <button
              onClick={() => void removeRemote()}
              disabled={!remoteSel}
              style={{ ...toolBtnStyle, opacity: remoteSel ? 1 : 0.5 }}
              title="원격 선택 삭제"
            >
              🗑 삭제(원격)
            </button>
            <button
              onClick={() => {
                void loadLocal(local?.cwd);
                void loadRemote(remote?.cwd);
              }}
              style={toolBtnStyle}
              title="새로고침"
            >
              ↺ 새로고침
            </button>
            <button onClick={onClose} style={toolBtnStyle}>
              닫기
            </button>
          </div>
        </header>

        {error && (
          <div style={{ padding: "6px 14px", background: "#3a1d1d", color: "#fdd" }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <Panel
            title="로컬"
            listing={local}
            selected={localSel}
            onSelect={setLocalSel}
            onNavigate={(p) => {
              setLocalSel(null);
              void loadLocal(p);
            }}
            joinPath={(cwd, name) => joinPosix(cwd, name)}
          />
          <div
            style={{
              width: 64,
              background: "#16161c",
              borderLeft: "1px solid #2a2a30",
              borderRight: "1px solid #2a2a30",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              color: "#789",
            }}
          >
            <button
              onClick={() => void download()}
              disabled={!remoteSel || remoteSel.is_dir || !!transfer}
              title="원격 → 로컬 다운로드"
              style={arrowBtnStyle(!!remoteSel && !remoteSel.is_dir && !transfer)}
            >
              ←
            </button>
            <button
              onClick={() => void upload()}
              disabled={!localSel || localSel.is_dir || !!transfer}
              title="로컬 → 원격 업로드"
              style={arrowBtnStyle(!!localSel && !localSel.is_dir && !transfer)}
            >
              →
            </button>
            {transfer && (
              <div style={{ fontSize: 9, textAlign: "center", color: "#4a9eff" }}>
                {transfer}
              </div>
            )}
          </div>
          <Panel
            title={`원격 — ${hostLabel}`}
            listing={remote}
            busy={remoteBusy}
            selected={remoteSel}
            onSelect={setRemoteSel}
            onNavigate={(p) => {
              setRemoteSel(null);
              void loadRemote(p);
            }}
            joinPath={(cwd, name) => joinPosix(cwd, name)}
          />
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  listing,
  busy,
  selected,
  onSelect,
  onNavigate,
  joinPath,
}: {
  title: string;
  listing: Listing | null;
  busy?: boolean;
  selected: FileEntry | null;
  onSelect: (e: FileEntry) => void;
  onNavigate: (path: string) => void;
  joinPath: (cwd: string, name: string) => string;
}) {
  const entries = listing
    ? [...listing.entries].sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid #2a2a30",
          color: "#9aa",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 600, color: "#ddd", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <span
          style={{
            flex: 1,
            color: "#789",
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={listing?.cwd}
        >
          {listing?.cwd ?? "…"}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {busy && <div style={{ padding: 16, color: "#789" }}>불러오는 중…</div>}
        {listing && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#789", fontSize: 11 }}>
                <th style={thStyle}>이름</th>
                <th style={{ ...thStyle, width: 80, textAlign: "right" }}>크기</th>
                <th style={{ ...thStyle, width: 150 }}>수정</th>
              </tr>
            </thead>
            <tbody>
              <tr
                onDoubleClick={() => onNavigate(joinPath(listing.cwd, ".."))}
                style={{ cursor: "pointer" }}
              >
                <td style={tdStyle}>📁 ..</td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
              </tr>
              {entries.map((e: FileEntry) => {
                const sel = selected?.name === e.name;
                return (
                  <tr
                    key={e.name}
                    onClick={() => onSelect(e)}
                    onDoubleClick={() =>
                      e.is_dir && onNavigate(joinPath(listing.cwd, e.name))
                    }
                    style={{
                      cursor: e.is_dir ? "pointer" : "default",
                      background: sel ? "#094771" : "transparent",
                      color: sel ? "#fff" : "#e6e6e6",
                    }}
                    onMouseEnter={(ev) => {
                      if (!sel)
                        (ev.currentTarget as HTMLTableRowElement).style.background =
                          "#26262e";
                    }}
                    onMouseLeave={(ev) => {
                      if (!sel)
                        (ev.currentTarget as HTMLTableRowElement).style.background =
                          "transparent";
                    }}
                  >
                    <td style={tdStyle}>
                      {e.is_dir ? "📁" : "📄"} {e.name}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: sel ? "#cde" : "#9aa" }}>
                      {e.is_dir ? "" : fmtSize(e.size)}
                    </td>
                    <td style={{ ...tdStyle, color: sel ? "#cde" : "#789" }}>
                      {fmtDate(e.modified)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const toolBtnStyle: React.CSSProperties = {
  background: "#2a2a35",
  color: "#ddd",
  border: "1px solid #444",
  borderRadius: 4,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 12,
};

function arrowBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    width: 38,
    height: 38,
    borderRadius: 6,
    border: `1px solid ${enabled ? "#4a9eff" : "#333"}`,
    background: enabled ? "#0a5380" : "#20202a",
    color: enabled ? "#fff" : "#555",
    fontSize: 18,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "4px 10px",
  position: "sticky",
  top: 0,
  background: "#1e1e24",
  borderBottom: "1px solid #2a2a30",
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: "4px 10px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 0,
};
