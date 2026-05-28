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
  const [menu, setMenu] = useState<{
    entry: FileEntry;
    x: number;
    y: number;
    side: "local" | "remote";
  } | null>(null);
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(
    null,
  );

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

  async function touchRemote() {
    if (!remote) return;
    const name = prompt("새 원격 파일 이름:");
    if (!name) return;
    try {
      await invoke("sftp_touch", { hostId, path: joinPosix(remote.cwd, name) });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(`새 파일: ${String(e)}`);
    }
  }

  async function renameRemote(entry: FileEntry) {
    if (!remote) return;
    const next = prompt("새 이름:", entry.name);
    if (!next || next === entry.name) return;
    try {
      await invoke("sftp_rename", {
        hostId,
        from: joinPosix(remote.cwd, entry.name),
        to: joinPosix(remote.cwd, next),
      });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(`이름 변경: ${String(e)}`);
    }
  }

  async function previewRemote(entry: FileEntry) {
    if (!remote || entry.is_dir) return;
    try {
      const content = await invoke<string>("sftp_read_text", {
        hostId,
        path: joinPosix(remote.cwd, entry.name),
      });
      setPreview({ name: entry.name, content });
    } catch (e) {
      setError(`미리보기: ${String(e)}`);
    }
  }

  async function deleteRemoteEntry(entry: FileEntry) {
    if (!remote) return;
    if (!confirm(`원격 '${entry.name}'을(를) 삭제할까요?`)) return;
    try {
      await invoke("sftp_remove", {
        hostId,
        path: joinPosix(remote.cwd, entry.name),
        isDir: entry.is_dir,
      });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(`삭제: ${String(e)}`);
    }
  }

  async function uploadEntry(entry: FileEntry) {
    if (entry.is_dir || !local || !remote) return;
    setTransfer(`↑ ${entry.name}`);
    try {
      await invoke("sftp_upload", {
        hostId,
        localPath: joinPosix(local.cwd, entry.name),
        remoteDir: remote.cwd,
      });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(`업로드: ${String(e)}`);
    } finally {
      setTransfer(null);
    }
  }

  async function downloadEntry(entry: FileEntry) {
    if (entry.is_dir || !local || !remote) return;
    setTransfer(`↓ ${entry.name}`);
    try {
      await invoke("sftp_download", {
        hostId,
        remotePath: joinPosix(remote.cwd, entry.name),
        localDir: local.cwd,
      });
      await loadLocal(local.cwd);
    } catch (e) {
      setError(`다운로드: ${String(e)}`);
    } finally {
      setTransfer(null);
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
            <button onClick={() => void touchRemote()} style={toolBtnStyle} title="원격 새 파일">
              + 파일(원격)
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
            onContextMenu={(entry, x, y) => setMenu({ entry, x, y, side: "local" })}
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
            onContextMenu={(entry, x, y) => setMenu({ entry, x, y, side: "remote" })}
            joinPath={(cwd, name) => joinPosix(cwd, name)}
          />
        </div>

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            side={menu.side}
            entry={menu.entry}
            onDismiss={() => setMenu(null)}
            onPreview={() => void previewRemote(menu.entry)}
            onDownload={() => void downloadEntry(menu.entry)}
            onUpload={() => void uploadEntry(menu.entry)}
            onRename={() => void renameRemote(menu.entry)}
            onDelete={() => void deleteRemoteEntry(menu.entry)}
          />
        )}

        {preview && (
          <PreviewModal
            name={preview.name}
            content={preview.content}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </div>
  );
}

function ContextMenu({
  x,
  y,
  side,
  entry,
  onDismiss,
  onPreview,
  onDownload,
  onUpload,
  onRename,
  onDelete,
}: {
  x: number;
  y: number;
  side: "local" | "remote";
  entry: FileEntry;
  onDismiss: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onUpload: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const close = () => onDismiss();
    const t = setTimeout(() => {
      window.addEventListener("mousedown", close);
      window.addEventListener("keydown", close);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onDismiss]);

  const items: Array<{ label: string; action: () => void; disabled?: boolean }> = [];
  if (side === "remote") {
    items.push({ label: "미리보기", action: onPreview, disabled: entry.is_dir });
    items.push({ label: "← 다운로드", action: onDownload, disabled: entry.is_dir });
    items.push({ label: "이름 변경", action: onRename });
    items.push({ label: "삭제", action: onDelete });
  } else {
    items.push({ label: "→ 업로드", action: onUpload, disabled: entry.is_dir });
  }

  const mx = Math.min(x, window.innerWidth - 180);
  const my = Math.min(y, window.innerHeight - 160);
  return (
    <div
      style={{
        position: "fixed",
        left: mx,
        top: my,
        width: 160,
        background: "#26262d",
        border: "1px solid #111",
        borderRadius: 4,
        boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
        padding: "4px 0",
        zIndex: 1100,
        fontSize: 12,
      }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          disabled={it.disabled}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (!it.disabled) {
              it.action();
              onDismiss();
            }
          }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "6px 12px",
            background: "transparent",
            border: "none",
            color: it.disabled ? "#666" : "#dcdcdc",
            cursor: it.disabled ? "not-allowed" : "pointer",
            fontSize: 12,
          }}
          onMouseEnter={(e) => {
            if (!it.disabled)
              (e.currentTarget as HTMLButtonElement).style.background = "#094771";
          }}
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
          }
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function PreviewModal({
  name,
  content,
  onClose,
}: {
  name: string;
  content: string;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "70vw",
          height: "75vh",
          background: "#1e1e24",
          border: "1px solid #333",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 14px",
            borderBottom: "1px solid #2a2a30",
            background: "#23232a",
            color: "#e6e6e6",
          }}
        >
          <strong style={{ fontSize: 13 }}>📄 {name}</strong>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#ccc", cursor: "pointer", fontSize: 15 }}
          >
            ×
          </button>
        </header>
        <pre
          style={{
            flex: 1,
            margin: 0,
            padding: 14,
            overflow: "auto",
            fontFamily: "Menlo, Consolas, monospace",
            fontSize: 12,
            color: "#dcdcdc",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {content || "(빈 파일)"}
        </pre>
        <div style={{ padding: "4px 14px", fontSize: 10, color: "#789", borderTop: "1px solid #2a2a30" }}>
          최대 256KB 미리보기 · 바이너리는 깨져 보일 수 있음
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
  onContextMenu,
  joinPath,
}: {
  title: string;
  listing: Listing | null;
  busy?: boolean;
  selected: FileEntry | null;
  onSelect: (e: FileEntry) => void;
  onNavigate: (path: string) => void;
  onContextMenu: (e: FileEntry, x: number, y: number) => void;
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
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      onSelect(e);
                      onContextMenu(e, ev.clientX, ev.clientY);
                    }}
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
