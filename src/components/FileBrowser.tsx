import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { FileEntry, Listing, SearchHit } from "../types";

function newTransferId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

interface TransferItem {
  id: string;
  label: string;
  direction: "up" | "down";
  transferred: number;
  total: number;
  status: "active" | "done" | "error";
  error?: string;
}

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

function nameExists(listing: Listing | null, name: string): boolean {
  return !!listing?.entries.some((e) => e.name === name);
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
  const [transfers, setTransfers] = useState<TransferItem[]>([]);

  function updateTransfer(id: string, patch: Partial<TransferItem>) {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  const [menu, setMenu] = useState<{
    entry: FileEntry;
    x: number;
    y: number;
    side: "local" | "remote";
  } | null>(null);
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(
    null,
  );
  const [permEdit, setPermEdit] = useState<FileEntry | null>(null);
  const [showSearch, setShowSearch] = useState(false);

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

  // 전송 진행 이벤트 구독.
  useEffect(() => {
    let un: UnlistenFn | undefined;
    void listen<{ transferId: string; transferred: number; total: number }>(
      "sftp:progress",
      (e) => {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === e.payload.transferId
              ? { ...t, transferred: e.payload.transferred, total: e.payload.total }
              : t,
          ),
        );
      },
    ).then((f) => {
      un = f;
    });
    return () => un?.();
  }, []);

  // 다운로드/업로드를 큐에 넣고 비동기 진행 (동시 여러 전송 가능).
  function doDownload(entry: FileEntry) {
    if (entry.is_dir || !remote || !local) return;
    if (
      nameExists(local, entry.name) &&
      !confirm(`로컬에 '${entry.name}'이(가) 이미 있습니다. 덮어쓸까요?`)
    )
      return;
    const id = newTransferId();
    const localCwd = local.cwd;
    const remotePath = joinPosix(remote.cwd, entry.name);
    setTransfers((prev) => [
      ...prev,
      { id, label: `↓ ${entry.name}`, direction: "down", transferred: 0, total: entry.size, status: "active" },
    ]);
    void invoke("sftp_download", { hostId, remotePath, localDir: localCwd, transferId: id })
      .then(() => {
        updateTransfer(id, { status: "done", transferred: entry.size });
        void loadLocal(localCwd);
      })
      .catch((e) => updateTransfer(id, { status: "error", error: String(e) }));
  }

  function doUpload(entry: FileEntry) {
    if (entry.is_dir || !local || !remote) return;
    if (
      nameExists(remote, entry.name) &&
      !confirm(`원격에 '${entry.name}'이(가) 이미 있습니다. 덮어쓸까요?`)
    )
      return;
    const id = newTransferId();
    const remoteCwd = remote.cwd;
    const localPath = joinPosix(local.cwd, entry.name);
    setTransfers((prev) => [
      ...prev,
      { id, label: `↑ ${entry.name}`, direction: "up", transferred: 0, total: entry.size, status: "active" },
    ]);
    void invoke("sftp_upload", { hostId, localPath, remoteDir: remoteCwd, transferId: id })
      .then(() => {
        updateTransfer(id, { status: "done", transferred: entry.size });
        void loadRemote(remoteCwd);
      })
      .catch((e) => updateTransfer(id, { status: "error", error: String(e) }));
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

  async function applyChmod(entry: FileEntry, mode: number) {
    if (!remote) return;
    try {
      await invoke("sftp_chmod", {
        hostId,
        path: joinPosix(remote.cwd, entry.name),
        mode,
      });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(`권한 변경: ${String(e)}`);
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
              onClick={() => setShowSearch(true)}
              disabled={!remote}
              style={toolBtnStyle}
              title="원격 검색 (S-031)"
            >
              🔍 검색(원격)
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
              onClick={() => remoteSel && doDownload(remoteSel)}
              disabled={!remoteSel || remoteSel.is_dir}
              title="원격 → 로컬 다운로드"
              style={arrowBtnStyle(!!remoteSel && !remoteSel.is_dir)}
            >
              ←
            </button>
            <button
              onClick={() => localSel && doUpload(localSel)}
              disabled={!localSel || localSel.is_dir}
              title="로컬 → 원격 업로드"
              style={arrowBtnStyle(!!localSel && !localSel.is_dir)}
            >
              →
            </button>
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

        {transfers.length > 0 && (
          <TransferQueue
            transfers={transfers}
            onClear={() =>
              setTransfers((prev) => prev.filter((t) => t.status === "active"))
            }
          />
        )}

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            side={menu.side}
            entry={menu.entry}
            onDismiss={() => setMenu(null)}
            onPreview={() => void previewRemote(menu.entry)}
            onDownload={() => doDownload(menu.entry)}
            onUpload={() => doUpload(menu.entry)}
            onRename={() => void renameRemote(menu.entry)}
            onDelete={() => void deleteRemoteEntry(menu.entry)}
            onProps={() => setPermEdit(menu.entry)}
          />
        )}

        {permEdit && (
          <PermissionsModal
            entry={permEdit}
            onClose={() => setPermEdit(null)}
            onApply={(mode) => {
              void applyChmod(permEdit, mode);
              setPermEdit(null);
            }}
          />
        )}

        {showSearch && remote && (
          <SearchModal
            hostId={hostId}
            root={remote.cwd}
            onClose={() => setShowSearch(false)}
            onNavigate={(path, isDir) => {
              const target = isDir ? path : joinPosix(path, "..");
              setRemoteSel(null);
              void loadRemote(target);
              setShowSearch(false);
            }}
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
  onProps,
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
  onProps: () => void;
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
    items.push({ label: "속성/권한", action: onProps });
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

function PermissionsModal({
  entry,
  onClose,
  onApply,
}: {
  entry: FileEntry;
  onClose: () => void;
  onApply: (mode: number) => void;
}) {
  const init = ((entry.permissions ?? 0o644) & 0o777) >>> 0;
  const [mode, setMode] = useState(init);
  const groups: Array<{ label: string; shift: number }> = [
    { label: "소유자", shift: 6 },
    { label: "그룹", shift: 3 },
    { label: "기타", shift: 0 },
  ];
  const bits: Array<{ label: string; bit: number }> = [
    { label: "읽기 (r)", bit: 4 },
    { label: "쓰기 (w)", bit: 2 },
    { label: "실행 (x)", bit: 1 },
  ];
  const has = (shift: number, bit: number) => (mode & (bit << shift)) !== 0;
  const toggle = (shift: number, bit: number) => setMode((m) => m ^ (bit << shift));
  const octal = (mode & 0o777).toString(8).padStart(3, "0");

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
          width: 360,
          background: "#26262d",
          border: "1px solid #333",
          borderRadius: 6,
          color: "#e6e6e6",
          padding: 18,
          fontSize: 13,
        }}
      >
        <strong style={{ fontSize: 14 }}>속성 / 권한 — {entry.name}</strong>
        <div style={{ fontSize: 11, color: "#789", margin: "6px 0 14px" }}>
          {entry.is_dir ? "디렉토리" : `${fmtSize(entry.size)}`} · 8진수{" "}
          <code style={{ color: "#9cf" }}>{octal}</code>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#9aa", fontSize: 11 }}>
              <th style={{ textAlign: "left", padding: 4 }} />
              {bits.map((b) => (
                <th key={b.bit} style={{ padding: 4 }}>{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.shift}>
                <td style={{ padding: 4, color: "#ccc" }}>{g.label}</td>
                {bits.map((b) => (
                  <td key={b.bit} style={{ textAlign: "center", padding: 4 }}>
                    <input
                      type="checkbox"
                      checked={has(g.shift, b.bit)}
                      onChange={() => toggle(g.shift, b.bit)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={toolBtnStyle}>취소</button>
          <button
            onClick={() => onApply(mode & 0o777)}
            style={{ ...toolBtnStyle, background: "#0a5380", borderColor: "#4a9eff", color: "#fff" }}
          >
            적용 (chmod {octal})
          </button>
        </div>
      </div>
    </div>
  );
}

function TransferQueue({
  transfers,
  onClear,
}: {
  transfers: TransferItem[];
  onClear: () => void;
}) {
  const active = transfers.filter((t) => t.status === "active").length;
  const finished = transfers.length - active;
  return (
    <div
      style={{
        borderTop: "1px solid #2a2a30",
        background: "#181820",
        maxHeight: 160,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 12px",
          fontSize: 11,
          color: "#9aa",
        }}
      >
        <span>
          전송 큐 · 진행 {active} / 완료·실패 {finished}
        </span>
        {finished > 0 && (
          <button
            onClick={onClear}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid #444",
              color: "#bbb",
              borderRadius: 3,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            완료 항목 비우기
          </button>
        )}
      </div>
      <div style={{ overflowY: "auto", padding: "0 12px 8px" }}>
        {transfers.map((t) => {
          const pct = t.total > 0 ? Math.round((t.transferred / t.total) * 100) : 0;
          return (
            <div key={t.id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", fontSize: 11, color: "#ccc", gap: 8 }}>
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.label}
                </span>
                <span
                  style={{
                    color:
                      t.status === "done"
                        ? "#5ad27a"
                        : t.status === "error"
                          ? "#ff8c8c"
                          : "#789",
                  }}
                >
                  {t.status === "done"
                    ? "✓ 완료"
                    : t.status === "error"
                      ? "✗ 실패"
                      : `${pct}%`}
                </span>
              </div>
              {t.status === "active" && (
                <div
                  style={{
                    height: 3,
                    background: "#2a2a30",
                    borderRadius: 2,
                    overflow: "hidden",
                    marginTop: 2,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: "#4a9eff",
                      transition: "width 0.1s",
                    }}
                  />
                </div>
              )}
              {t.status === "error" && t.error && (
                <div style={{ fontSize: 10, color: "#c88" }}>{t.error}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SearchModal({
  hostId,
  root,
  onClose,
  onNavigate,
}: {
  hostId: string;
  root: string;
  onClose: () => void;
  onNavigate: (path: string, isDir: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await invoke<SearchHit[]>("sftp_search", {
        hostId,
        root,
        query: query.trim(),
        recursive,
      });
      setHits(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

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
          width: "60vw",
          height: "70vh",
          background: "#1e1e24",
          border: "1px solid #333",
          borderRadius: 8,
          color: "#e6e6e6",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header style={{ padding: "10px 14px", borderBottom: "1px solid #2a2a30", background: "#23232a" }}>
          <strong style={{ fontSize: 13 }}>🔍 원격 검색</strong>
          <span style={{ fontSize: 11, color: "#789", marginLeft: 8 }}>{root} 이하</span>
        </header>
        <div style={{ display: "flex", gap: 6, padding: 10, alignItems: "center" }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
            placeholder="파일 이름 (대소문자 무시)"
            style={{
              flex: 1,
              background: "#101015",
              border: "1px solid #444",
              color: "#fff",
              borderRadius: 4,
              padding: "6px 8px",
              fontSize: 12,
            }}
          />
          <label style={{ fontSize: 11, color: "#9aa", display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
            />
            하위 포함
          </label>
          <button onClick={() => void run()} disabled={busy || !query.trim()} style={toolBtnStyle}>
            {busy ? "검색 중..." : "검색"}
          </button>
        </div>
        {err && <div style={{ padding: "0 14px 6px", color: "#fdd", fontSize: 11 }}>{err}</div>}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
          {hits === null && (
            <div style={{ color: "#789", textAlign: "center", padding: 24, fontSize: 12 }}>
              검색어를 입력하고 Enter를 누르세요.
            </div>
          )}
          {hits !== null && hits.length === 0 && (
            <div style={{ color: "#789", textAlign: "center", padding: 24, fontSize: 12 }}>
              결과 없음
            </div>
          )}
          {hits?.map((h) => (
            <div
              key={h.path}
              onDoubleClick={() => onNavigate(h.path, h.is_dir)}
              title={`더블클릭: 위치 열기\n${h.path}`}
              style={{
                display: "flex",
                gap: 8,
                padding: "5px 10px",
                cursor: "pointer",
                borderRadius: 3,
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLDivElement).style.background = "#26262e")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLDivElement).style.background = "transparent")
              }
            >
              <span>{h.is_dir ? "📁" : "📄"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12 }}>{h.name}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#789",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.path}
                </div>
              </span>
            </div>
          ))}
        </div>
        {hits !== null && hits.length >= 500 && (
          <div style={{ padding: "4px 14px", fontSize: 10, color: "#fa8", borderTop: "1px solid #2a2a30" }}>
            결과가 500개로 잘렸습니다. 검색어를 더 구체적으로.
          </div>
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
