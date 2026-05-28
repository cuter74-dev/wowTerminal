import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, Tag, TAG_PALETTE } from "../types";
import { LangDict, useT } from "../i18n";

interface Props {
  onClose: () => void;
  /** 그룹/태그 변경 후 호스트 목록 갱신을 위해 호출. */
  onChanged: () => void;
}

const STR: LangDict<{
    confirmDeleteGroup: string;
    confirmDeleteTag: string;
    title: string;
    close: string;
    groupsHeading: (n: number) => string;
    delete: string;
    noGroups: string;
    newGroupPlaceholder: string;
    add: string;
    tagsHeading: (n: number) => string;
    noTags: string;
    newTagPlaceholder: string;
  }
> = {
  en: {
    confirmDeleteGroup:
      "Deleting this group will unassign its hosts from the group. Continue?",
    confirmDeleteTag:
      "Deleting this tag will also remove it from host tag displays. Continue?",
    title: "Group / Tag Manager",
    close: "Close",
    groupsHeading: (n) => `Groups (${n})`,
    delete: "Delete",
    noGroups: "No groups",
    newGroupPlaceholder: "New group name",
    add: "+ Add",
    tagsHeading: (n) => `Tags (${n})`,
    noTags: "No tags",
    newTagPlaceholder: "New tag name",
  },
  ko: {
    confirmDeleteGroup:
      "이 그룹을 삭제하면 소속 호스트의 그룹 지정이 해제됩니다. 계속할까요?",
    confirmDeleteTag:
      "이 태그를 삭제하면 호스트의 태그 표시에서도 제거됩니다. 계속할까요?",
    title: "그룹 / 태그 관리",
    close: "닫기",
    groupsHeading: (n) => `그룹 (${n})`,
    delete: "삭제",
    noGroups: "그룹 없음",
    newGroupPlaceholder: "새 그룹 이름",
    add: "+ 추가",
    tagsHeading: (n) => `태그 (${n})`,
    noTags: "태그 없음",
    newTagPlaceholder: "새 태그 이름",
  },
  es: {
    confirmDeleteGroup:
      "Al eliminar este grupo, sus hosts dejarán de estar asignados al grupo. ¿Continuar?",
    confirmDeleteTag:
      "Al eliminar esta etiqueta, también se quitará de la visualización de etiquetas de los hosts. ¿Continuar?",
    title: "Gestor de grupos / etiquetas",
    close: "Cerrar",
    groupsHeading: (n) => `Grupos (${n})`,
    delete: "Eliminar",
    noGroups: "Sin grupos",
    newGroupPlaceholder: "Nombre del nuevo grupo",
    add: "+ Agregar",
    tagsHeading: (n) => `Etiquetas (${n})`,
    noTags: "Sin etiquetas",
    newTagPlaceholder: "Nombre de la nueva etiqueta",
  },
  zh: {
    confirmDeleteGroup:
      "删除此分组后，其主机将取消分组归属。是否继续？",
    confirmDeleteTag:
      "删除此标签后，它也将从主机的标签显示中移除。是否继续？",
    title: "分组 / 标签管理器",
    close: "关闭",
    groupsHeading: (n) => `分组 (${n})`,
    delete: "删除",
    noGroups: "没有分组",
    newGroupPlaceholder: "新分组名称",
    add: "+ 添加",
    tagsHeading: (n) => `标签 (${n})`,
    noTags: "没有标签",
    newTagPlaceholder: "新标签名称",
  },
  ja: {
    confirmDeleteGroup:
      "このグループを削除すると、所属ホストのグループ割り当てが解除されます。続行しますか？",
    confirmDeleteTag:
      "このタグを削除すると、ホストのタグ表示からも削除されます。続行しますか？",
    title: "グループ / タグ管理",
    close: "閉じる",
    groupsHeading: (n) => `グループ (${n})`,
    delete: "削除",
    noGroups: "グループなし",
    newGroupPlaceholder: "新しいグループ名",
    add: "+ 追加",
    tagsHeading: (n) => `タグ (${n})`,
    noTags: "タグなし",
    newTagPlaceholder: "新しいタグ名",
  },
  ru: {
    confirmDeleteGroup:
      "При удалении этой группы её хосты будут откреплены от группы. Продолжить?",
    confirmDeleteTag:
      "При удалении этого тега он также будет убран из отображения тегов хостов. Продолжить?",
    title: "Менеджер групп / тегов",
    close: "Закрыть",
    groupsHeading: (n) => `Группы (${n})`,
    delete: "Удалить",
    noGroups: "Нет групп",
    newGroupPlaceholder: "Имя новой группы",
    add: "+ Добавить",
    tagsHeading: (n) => `Теги (${n})`,
    noTags: "Нет тегов",
    newTagPlaceholder: "Имя нового тега",
  },
  fr: {
    confirmDeleteGroup:
      "La suppression de ce groupe dissociera ses hôtes du groupe. Continuer ?",
    confirmDeleteTag:
      "La suppression de cette étiquette la retirera également de l'affichage des étiquettes des hôtes. Continuer ?",
    title: "Gestionnaire de groupes / étiquettes",
    close: "Fermer",
    groupsHeading: (n) => `Groupes (${n})`,
    delete: "Supprimer",
    noGroups: "Aucun groupe",
    newGroupPlaceholder: "Nom du nouveau groupe",
    add: "+ Ajouter",
    tagsHeading: (n) => `Étiquettes (${n})`,
    noTags: "Aucune étiquette",
    newTagPlaceholder: "Nom de la nouvelle étiquette",
  },
  de: {
    confirmDeleteGroup:
      "Beim Löschen dieser Gruppe wird die Gruppenzuordnung ihrer Hosts aufgehoben. Fortfahren?",
    confirmDeleteTag:
      "Beim Löschen dieses Tags wird es auch aus der Tag-Anzeige der Hosts entfernt. Fortfahren?",
    title: "Gruppen-/Tag-Verwaltung",
    close: "Schließen",
    groupsHeading: (n) => `Gruppen (${n})`,
    delete: "Löschen",
    noGroups: "Keine Gruppen",
    newGroupPlaceholder: "Name der neuen Gruppe",
    add: "+ Hinzufügen",
    tagsHeading: (n) => `Tags (${n})`,
    noTags: "Keine Tags",
    newTagPlaceholder: "Name des neuen Tags",
  },
  vi: {
    confirmDeleteGroup:
      "Xóa nhóm này sẽ bỏ gán các host của nó khỏi nhóm. Tiếp tục?",
    confirmDeleteTag:
      "Xóa thẻ này cũng sẽ gỡ nó khỏi phần hiển thị thẻ của host. Tiếp tục?",
    title: "Trình quản lý nhóm / thẻ",
    close: "Đóng",
    groupsHeading: (n) => `Nhóm (${n})`,
    delete: "Xóa",
    noGroups: "Không có nhóm",
    newGroupPlaceholder: "Tên nhóm mới",
    add: "+ Thêm",
    tagsHeading: (n) => `Thẻ (${n})`,
    noTags: "Không có thẻ",
    newTagPlaceholder: "Tên thẻ mới",
  },
  id: {
    confirmDeleteGroup:
      "Menghapus grup ini akan membatalkan penetapan host-nya dari grup. Lanjutkan?",
    confirmDeleteTag:
      "Menghapus tag ini juga akan menghapusnya dari tampilan tag host. Lanjutkan?",
    title: "Pengelola grup / tag",
    close: "Tutup",
    groupsHeading: (n) => `Grup (${n})`,
    delete: "Hapus",
    noGroups: "Tidak ada grup",
    newGroupPlaceholder: "Nama grup baru",
    add: "+ Tambah",
    tagsHeading: (n) => `Tag (${n})`,
    noTags: "Tidak ada tag",
    newTagPlaceholder: "Nama tag baru",
  },
  hi: {
    confirmDeleteGroup:
      "इस समूह को हटाने पर इसके होस्ट की समूह असाइनमेंट हट जाएगी। जारी रखें?",
    confirmDeleteTag:
      "इस टैग को हटाने पर यह होस्ट के टैग प्रदर्शन से भी हट जाएगा। जारी रखें?",
    title: "समूह / टैग प्रबंधक",
    close: "बंद करें",
    groupsHeading: (n) => `समूह (${n})`,
    delete: "हटाएं",
    noGroups: "कोई समूह नहीं",
    newGroupPlaceholder: "नए समूह का नाम",
    add: "+ जोड़ें",
    tagsHeading: (n) => `टैग (${n})`,
    noTags: "कोई टैग नहीं",
    newTagPlaceholder: "नए टैग का नाम",
  },
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function GroupTagManager({ onClose, onChanged }: Props) {
  const tr = useT(STR);
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
    if (!confirm(tr.confirmDeleteGroup)) return;
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
    if (!confirm(tr.confirmDeleteTag)) return;
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
          <strong style={{ fontSize: 15 }}>{tr.title}</strong>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#ccc",
              cursor: "pointer",
              fontSize: 18,
            }}
            title={tr.close}
          >
            ×
          </button>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* 그룹 */}
          <section style={sectionStyle}>
            <h4 style={sectionTitleStyle}>{tr.groupsHeading(groups.length)}</h4>
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
                    title={tr.delete}
                  >
                    ×
                  </button>
                </li>
              ))}
              {groups.length === 0 && (
                <li style={{ ...rowStyle, color: "#666" }}>{tr.noGroups}</li>
              )}
            </ul>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addGroup();
                }}
                placeholder={tr.newGroupPlaceholder}
                style={inputStyle}
              />
              <button onClick={() => void addGroup()} style={addBtnStyle}>
                {tr.add}
              </button>
            </div>
          </section>

          {/* 태그 */}
          <section style={sectionStyle}>
            <h4 style={sectionTitleStyle}>{tr.tagsHeading(tags.length)}</h4>
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
                    title={tr.delete}
                  >
                    ×
                  </button>
                </li>
              ))}
              {tags.length === 0 && (
                <li style={{ ...rowStyle, color: "#666" }}>{tr.noTags}</li>
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
                  placeholder={tr.newTagPlaceholder}
                  style={inputStyle}
                />
                <button onClick={() => void addTag()} style={addBtnStyle}>
                  {tr.add}
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
