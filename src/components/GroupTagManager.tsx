import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, Tag, TAG_PALETTE } from "../types";

interface Props {
  onClose: () => void;
  /** 그룹/태그 변경 후 호스트 목록 갱신을 위해 호출. */
  onChanged: () => void;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function GroupTagManager({ onClose, onChanged }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>(TAG_PALETTE[0]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [g, t] = await Promise.all([
        invoke<Group[]>("ssh_list_groups"),
        invoke<Tag[]>("ssh_list_tags"),
      ]);
      setGroups(g);
      setTags(t);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await invoke("ssh_save_group", {
        group: {
          id: newId(),
          name,
          sort_order: groups.length,
        },
      });
      setNewGroupName("");
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function renameGroup(g: Group, name: string) {
    if (!name.trim()) return;
    try {
      await invoke("ssh_save_group", { group: { ...g, name } });
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteGroup(id: string) {
    if (!confirm("이 그룹을 삭제하면 소속 호스트의 그룹 지정이 해제됩니다. 계속할까요?"))
      return;
    try {
      await invoke("ssh_delete_group", { id });
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function addTag() {
    const name = newTagName.trim();
    if (!name) return;
    try {
      await invoke("ssh_save_tag", {
        tag: { id: newId(), name, color: newTagColor },
      });
      setNewTagName("");
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function updateTag(t: Tag, patch: Partial<Tag>) {
    try {
      await invoke("ssh_save_tag", { tag: { ...t, ...patch } });
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteTag(id: string) {
    if (!confirm("이 태그를 삭제하면 호스트의 태그 표시에서도 제거됩니다. 계속할까요?"))
      return;
    try {
      await invoke("ssh_delete_tag", { id });
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
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
          gap: 16,
        }}
        role="dialog"
        aria-modal="true"
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>그룹 / 태그 관리</strong>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#ccc",
              cursor: "pointer",
              fontSize: 18,
            }}
            title="닫기"
          >
            ×
          </button>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* 그룹 */}
          <section style={sectionStyle}>
            <h4 style={sectionTitleStyle}>그룹 ({groups.length})</h4>
            <ul style={listStyle}>
              {groups.map((g) => (
                <li key={g.id} style={rowStyle}>
                  <input
                    defaultValue={g.name}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== g.name) void renameGroup(g, v);
                    }}
                    style={inlineInputStyle}
                  />
                  <button
                    onClick={() => void deleteGroup(g.id)}
                    style={iconBtnStyle}
                    title="삭제"
                  >
                    ×
                  </button>
                </li>
              ))}
              {groups.length === 0 && (
                <li style={{ ...rowStyle, color: "#666" }}>그룹 없음</li>
              )}
            </ul>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addGroup();
                }}
                placeholder="새 그룹 이름"
                style={inputStyle}
              />
              <button onClick={() => void addGroup()} style={addBtnStyle}>
                + 추가
              </button>
            </div>
          </section>

          {/* 태그 */}
          <section style={sectionStyle}>
            <h4 style={sectionTitleStyle}>태그 ({tags.length})</h4>
            <ul style={listStyle}>
              {tags.map((t) => (
                <li key={t.id} style={rowStyle}>
                  <ColorPicker
                    color={t.color}
                    onChange={(c) => void updateTag(t, { color: c })}
                  />
                  <input
                    defaultValue={t.name}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== t.name) void updateTag(t, { name: v });
                    }}
                    style={inlineInputStyle}
                  />
                  <button
                    onClick={() => void deleteTag(t.id)}
                    style={iconBtnStyle}
                    title="삭제"
                  >
                    ×
                  </button>
                </li>
              ))}
              {tags.length === 0 && (
                <li style={{ ...rowStyle, color: "#666" }}>태그 없음</li>
              )}
            </ul>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addTag();
                  }}
                  placeholder="새 태그 이름"
                  style={inputStyle}
                />
                <button onClick={() => void addTag()} style={addBtnStyle}>
                  + 추가
                </button>
              </div>
              <ColorPicker color={newTagColor} onChange={setNewTagColor} />
            </div>
          </section>
        </div>

        {error && (
          <div style={{ color: "#fdd", fontSize: 12 }}>
            {error}{" "}
            <button onClick={() => setError(null)} style={iconBtnStyle}>
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {TAG_PALETTE.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          aria-label={`color ${c}`}
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: c,
            border: c === color ? "2px solid #fff" : "1px solid #444",
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  background: "#1d1d24",
  border: "1px solid #333",
  borderRadius: 4,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 12,
  color: "#aaa",
  textTransform: "uppercase",
  letterSpacing: 1,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  maxHeight: 240,
  overflowY: "auto",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 0",
  fontSize: 12,
};

const inlineInputStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "1px solid transparent",
  color: "#e6e6e6",
  padding: "3px 6px",
  borderRadius: 3,
  fontSize: 12,
  outline: "none",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "#101015",
  border: "1px solid #333",
  color: "#e6e6e6",
  padding: "5px 8px",
  borderRadius: 3,
  fontSize: 12,
  outline: "none",
  minWidth: 0,
};

const addBtnStyle: React.CSSProperties = {
  background: "#0a5380",
  color: "#fff",
  border: "none",
  borderRadius: 3,
  padding: "5px 10px",
  cursor: "pointer",
  fontSize: 12,
};

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 14,
  padding: "0 4px",
};
