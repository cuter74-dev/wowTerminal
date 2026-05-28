import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, SshHost, Tag } from "../types";
import { HostForm } from "./HostForm";
import { DeleteHostModal } from "./DeleteHostModal";
import { GroupTagManager } from "./GroupTagManager";

interface Props {
  activeHostId: string | null;
  onSelect: (hostId: string) => void;
  onOpenInNewTab: (hostId: string) => void;
  onSelectLocal: () => void;
  isLocalActive: boolean;
  activeSessionCountForHost: (hostId: string) => number;
  onHostDeleted: (hostId: string) => void;
}

type SortBy = "name" | "host";

export function HostList({
  activeHostId,
  onSelect,
  onOpenInNewTab,
  onSelectLocal,
  isLocalActive,
  activeSessionCountForHost,
  onHostDeleted,
}: Props) {
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [editing, setEditing] = useState<SshHost | "new" | null>(null);
  const [deleting, setDeleting] = useState<SshHost | null>(null);
  const [showManager, setShowManager] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("name");

  const reload = useCallback(async () => {
    try {
      const [hs, gs, ts] = await Promise.all([
        invoke<SshHost[]>("ssh_list_hosts"),
        invoke<Group[]>("ssh_list_groups"),
        invoke<Tag[]>("ssh_list_tags"),
      ]);
      setHosts(hs);
      setGroups(gs);
      setTags(ts);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function performDelete(id: string) {
    try {
      await invoke("ssh_delete_host", { id });
      await reload();
      onHostDeleted(id);
    } catch (e) {
      setError(String(e));
    }
  }

  const tagColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tags) m.set(t.name, t.color);
    return (name: string) => m.get(name) ?? "#666";
  }, [tags]);

  // 검색 → 정렬 → 그룹화
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? hosts.filter((h) => {
          const hay =
            `${h.name} ${h.user}@${h.host}:${h.port} ${h.tags.join(" ")}`.toLowerCase();
          return hay.includes(q);
        })
      : hosts;
    const sorted = [...matched].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return `${a.host}:${a.port}`.localeCompare(`${b.host}:${b.port}`);
    });
    // 그룹 ID별로 묶기. 미분류는 null 키.
    const byGroup = new Map<string | null, SshHost[]>();
    for (const h of sorted) {
      const k = h.group_id ?? null;
      const arr = byGroup.get(k) ?? [];
      arr.push(h);
      byGroup.set(k, arr);
    }
    return byGroup;
  }, [hosts, query, sortBy]);

  const totalShown = useMemo(
    () => Array.from(grouped.values()).reduce((a, b) => a + b.length, 0),
    [grouped],
  );

  return (
    <div
      style={{
        width: 280,
        background: "#252526",
        color: "#cccccc",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid #111",
        fontSize: 13,
      }}
    >
      <button
        onClick={onSelectLocal}
        style={{
          ...rowStyle,
          background: isLocalActive ? "#094771" : "transparent",
          color: isLocalActive ? "#fff" : "#cccccc",
        }}
        title="활성 탭을 로컬 셸로 변경"
      >
        ⌨ Local shell
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
          gap: 6,
        }}
      >
        <span>SSH Hosts ({hosts.length})</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setShowManager(true)}
            style={addBtnStyle}
            title="그룹/태그 관리 (S-017)"
          >
            ⚙
          </button>
          <button
            onClick={() => setEditing("new")}
            style={addBtnStyle}
            title="새 호스트 (S-014)"
          >
            +
          </button>
        </div>
      </div>

      <div style={{ padding: "4px 10px 8px", display: "flex", gap: 6 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 검색..."
          style={{
            flex: 1,
            background: "#1c1c20",
            border: "1px solid #333",
            color: "#ddd",
            borderRadius: 3,
            padding: "4px 8px",
            fontSize: 12,
            minWidth: 0,
          }}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          title="정렬"
          style={{
            background: "#1c1c20",
            border: "1px solid #333",
            color: "#ddd",
            borderRadius: 3,
            padding: "2px 4px",
            fontSize: 11,
          }}
        >
          <option value="name">이름순</option>
          <option value="host">주소순</option>
        </select>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {hosts.length === 0 && <EmptyState onAdd={() => setEditing("new")} />}
        {hosts.length > 0 && totalShown === 0 && (
          <div
            style={{
              padding: 24,
              color: "#666",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            "{query}" 검색 결과 없음
          </div>
        )}
        {hosts.length > 0 &&
          totalShown > 0 &&
          groups.map((g) => {
            const list = grouped.get(g.id);
            if (!list || list.length === 0) return null;
            return (
              <GroupSection
                key={g.id}
                label={g.name}
                hosts={list}
                activeHostId={activeHostId}
                query={query}
                tagColor={tagColor}
                onSelect={onSelect}
                onOpenInNewTab={onOpenInNewTab}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            );
          })}
        {(() => {
          const ungrouped = grouped.get(null);
          if (!ungrouped || ungrouped.length === 0) return null;
          return (
            <GroupSection
              label="(미분류)"
              hosts={ungrouped}
              activeHostId={activeHostId}
              query={query}
              tagColor={tagColor}
              onSelect={onSelect}
              onOpenInNewTab={onOpenInNewTab}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          );
        })()}
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

      {deleting && (
        <DeleteHostModal
          host={deleting}
          activeSessionCount={activeSessionCountForHost(deleting.id)}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const id = deleting.id;
            setDeleting(null);
            await performDelete(id);
          }}
        />
      )}

      {showManager && (
        <GroupTagManager
          onClose={() => setShowManager(false)}
          onChanged={() => void reload()}
        />
      )}
    </div>
  );
}

function GroupSection({
  label,
  hosts,
  activeHostId,
  query,
  tagColor,
  onSelect,
  onOpenInNewTab,
  onEdit,
  onDelete,
}: {
  label: string;
  hosts: SshHost[];
  activeHostId: string | null;
  query: string;
  tagColor: (name: string) => string;
  onSelect: (id: string) => void;
  onOpenInNewTab: (id: string) => void;
  onEdit: (h: SshHost) => void;
  onDelete: (h: SshHost) => void;
}) {
  return (
    <div>
      <div
        style={{
          padding: "6px 12px 2px",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "#699",
        }}
      >
        ▾ {label} ({hosts.length})
      </div>
      {hosts.map((h) => {
        const selected = activeHostId === h.id;
        return (
          <div
            key={h.id}
            onClick={() => onSelect(h.id)}
            onDoubleClick={() => onOpenInNewTab(h.id)}
            style={{
              ...rowStyle,
              background: selected ? "#094771" : "transparent",
              color: selected ? "#fff" : "#cccccc",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingLeft: 18,
            }}
            title="클릭: 현재 탭 연결 / 더블클릭: 새 탭"
          >
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13 }}>
                <Highlight text={`🖥 ${h.name}`} query={query} />
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "#888",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <Highlight text={`${h.user}@${h.host}:${h.port}`} query={query} />
              </span>
              {h.tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 2 }}>
                  {h.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 10,
                        color: "#fff",
                        background: tagColor(t),
                        padding: "0 5px",
                        borderRadius: 8,
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(h);
                }}
                style={iconBtnStyle}
                title="편집 (S-015)"
              >
                ✎
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(h);
                }}
                style={iconBtnStyle}
                title="삭제 (S-016)"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      style={{
        padding: "32px 20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        color: "#9aa",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 36 }}>🖥️</div>
      <div style={{ fontSize: 13, color: "#ddd" }}>등록된 호스트가 없어요</div>
      <div style={{ fontSize: 11, color: "#789", lineHeight: 1.5 }}>
        첫 SSH 호스트를 추가하면
        <br />
        클릭 한 번으로 연결할 수 있습니다.
      </div>
      <button
        onClick={onAdd}
        style={{
          marginTop: 4,
          padding: "8px 14px",
          background: "#0a5380",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        + 첫 호스트 추가하기
      </button>
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const i = lower.indexOf(ql);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark
        style={{
          background: "#564b00",
          color: "#fff",
          padding: 0,
          borderRadius: 2,
        }}
      >
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
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
  width: 22,
  height: 20,
  cursor: "pointer",
  fontSize: 12,
  lineHeight: "16px",
  padding: 0,
};
