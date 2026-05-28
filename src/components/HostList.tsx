import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, SshHost, Tag } from "../types";
import { HostForm } from "./HostForm";
import { DeleteHostModal } from "./DeleteHostModal";
import { GroupTagManager } from "./GroupTagManager";
import { SshKeyManager } from "./SshKeyManager";
import { LangDict, useT } from "../i18n";

const STR: LangDict<{
    switchToLocal: string;
    keyManager: string;
    groupTagManager: string;
    newHost: string;
    searchPlaceholder: string;
    sort: string;
    sortByName: string;
    sortByHost: string;
    noResults: (query: string) => string;
    ungrouped: string;
    rowHint: string;
    edit: string;
    delete: string;
    emptyTitle: string;
    emptyLine1: string;
    emptyLine2: string;
    addFirstHost: string;
  }
> = {
  en: {
    switchToLocal: "Switch active tab to local shell",
    keyManager: "SSH key manager (S-019)",
    groupTagManager: "Group/tag manager (S-017)",
    newHost: "New host (S-014)",
    searchPlaceholder: "🔍 Search...",
    sort: "Sort",
    sortByName: "By name",
    sortByHost: "By address",
    noResults: (query) => `No results for "${query}"`,
    ungrouped: "(Ungrouped)",
    rowHint: "Click: connect in current tab / Double-click: new tab",
    edit: "Edit (S-015)",
    delete: "Delete (S-016)",
    emptyTitle: "No hosts registered yet",
    emptyLine1: "Once you add your first SSH host,",
    emptyLine2: "you can connect with a single click.",
    addFirstHost: "+ Add your first host",
  },
  ko: {
    switchToLocal: "활성 탭을 로컬 셸로 변경",
    keyManager: "SSH 키 관리 (S-019)",
    groupTagManager: "그룹/태그 관리 (S-017)",
    newHost: "새 호스트 (S-014)",
    searchPlaceholder: "🔍 검색...",
    sort: "정렬",
    sortByName: "이름순",
    sortByHost: "주소순",
    noResults: (query) => `"${query}" 검색 결과 없음`,
    ungrouped: "(미분류)",
    rowHint: "클릭: 현재 탭 연결 / 더블클릭: 새 탭",
    edit: "편집 (S-015)",
    delete: "삭제 (S-016)",
    emptyTitle: "등록된 호스트가 없어요",
    emptyLine1: "첫 SSH 호스트를 추가하면",
    emptyLine2: "클릭 한 번으로 연결할 수 있습니다.",
    addFirstHost: "+ 첫 호스트 추가하기",
  },
  es: {
    switchToLocal: "Cambiar la pestaña activa al shell local",
    keyManager: "Gestor de claves SSH (S-019)",
    groupTagManager: "Gestor de grupos/etiquetas (S-017)",
    newHost: "Nuevo host (S-014)",
    searchPlaceholder: "🔍 Buscar...",
    sort: "Ordenar",
    sortByName: "Por nombre",
    sortByHost: "Por dirección",
    noResults: (query) => `Sin resultados para "${query}"`,
    ungrouped: "(Sin grupo)",
    rowHint: "Clic: conectar en la pestaña actual / Doble clic: nueva pestaña",
    edit: "Editar (S-015)",
    delete: "Eliminar (S-016)",
    emptyTitle: "Aún no hay hosts registrados",
    emptyLine1: "Cuando agregues tu primer host SSH,",
    emptyLine2: "podrás conectarte con un solo clic.",
    addFirstHost: "+ Agregar tu primer host",
  },
  zh: {
    switchToLocal: "将活动标签页切换到本地 shell",
    keyManager: "SSH 密钥管理器 (S-019)",
    groupTagManager: "分组/标签管理器 (S-017)",
    newHost: "新建主机 (S-014)",
    searchPlaceholder: "🔍 搜索...",
    sort: "排序",
    sortByName: "按名称",
    sortByHost: "按地址",
    noResults: (query) => `没有“${query}”的结果`,
    ungrouped: "(未分组)",
    rowHint: "单击：在当前标签页连接 / 双击：新建标签页",
    edit: "编辑 (S-015)",
    delete: "删除 (S-016)",
    emptyTitle: "尚未注册任何主机",
    emptyLine1: "添加第一个 SSH 主机后，",
    emptyLine2: "只需单击一次即可连接。",
    addFirstHost: "+ 添加第一个主机",
  },
  ja: {
    switchToLocal: "アクティブなタブをローカルシェルに切り替え",
    keyManager: "SSH キー管理 (S-019)",
    groupTagManager: "グループ/タグ管理 (S-017)",
    newHost: "新規ホスト (S-014)",
    searchPlaceholder: "🔍 検索...",
    sort: "並び替え",
    sortByName: "名前順",
    sortByHost: "アドレス順",
    noResults: (query) => `「${query}」の結果はありません`,
    ungrouped: "(未分類)",
    rowHint: "クリック: 現在のタブで接続 / ダブルクリック: 新規タブ",
    edit: "編集 (S-015)",
    delete: "削除 (S-016)",
    emptyTitle: "登録済みのホストがありません",
    emptyLine1: "最初の SSH ホストを追加すると、",
    emptyLine2: "ワンクリックで接続できます。",
    addFirstHost: "+ 最初のホストを追加",
  },
  ru: {
    switchToLocal: "Переключить активную вкладку на локальную оболочку",
    keyManager: "Менеджер ключей SSH (S-019)",
    groupTagManager: "Менеджер групп/тегов (S-017)",
    newHost: "Новый хост (S-014)",
    searchPlaceholder: "🔍 Поиск...",
    sort: "Сортировка",
    sortByName: "По имени",
    sortByHost: "По адресу",
    noResults: (query) => `Нет результатов по запросу "${query}"`,
    ungrouped: "(Без группы)",
    rowHint: "Клик: подключиться в текущей вкладке / Двойной клик: новая вкладка",
    edit: "Изменить (S-015)",
    delete: "Удалить (S-016)",
    emptyTitle: "Пока нет зарегистрированных хостов",
    emptyLine1: "После добавления первого хоста SSH",
    emptyLine2: "вы сможете подключаться одним кликом.",
    addFirstHost: "+ Добавить первый хост",
  },
  fr: {
    switchToLocal: "Basculer l'onglet actif vers le shell local",
    keyManager: "Gestionnaire de clés SSH (S-019)",
    groupTagManager: "Gestionnaire de groupes/étiquettes (S-017)",
    newHost: "Nouvel hôte (S-014)",
    searchPlaceholder: "🔍 Rechercher...",
    sort: "Trier",
    sortByName: "Par nom",
    sortByHost: "Par adresse",
    noResults: (query) => `Aucun résultat pour "${query}"`,
    ungrouped: "(Sans groupe)",
    rowHint: "Clic : connexion dans l'onglet actuel / Double-clic : nouvel onglet",
    edit: "Modifier (S-015)",
    delete: "Supprimer (S-016)",
    emptyTitle: "Aucun hôte enregistré pour le moment",
    emptyLine1: "Une fois votre premier hôte SSH ajouté,",
    emptyLine2: "vous pourrez vous connecter en un seul clic.",
    addFirstHost: "+ Ajouter votre premier hôte",
  },
  de: {
    switchToLocal: "Aktiven Tab zur lokalen Shell wechseln",
    keyManager: "SSH-Schlüsselverwaltung (S-019)",
    groupTagManager: "Gruppen-/Tag-Verwaltung (S-017)",
    newHost: "Neuer Host (S-014)",
    searchPlaceholder: "🔍 Suchen...",
    sort: "Sortieren",
    sortByName: "Nach Name",
    sortByHost: "Nach Adresse",
    noResults: (query) => `Keine Ergebnisse für "${query}"`,
    ungrouped: "(Ohne Gruppe)",
    rowHint: "Klick: im aktuellen Tab verbinden / Doppelklick: neuer Tab",
    edit: "Bearbeiten (S-015)",
    delete: "Löschen (S-016)",
    emptyTitle: "Noch keine Hosts registriert",
    emptyLine1: "Sobald du deinen ersten SSH-Host hinzufügst,",
    emptyLine2: "kannst du dich mit einem Klick verbinden.",
    addFirstHost: "+ Ersten Host hinzufügen",
  },
  vi: {
    switchToLocal: "Chuyển tab đang hoạt động sang shell cục bộ",
    keyManager: "Trình quản lý khóa SSH (S-019)",
    groupTagManager: "Trình quản lý nhóm/thẻ (S-017)",
    newHost: "Host mới (S-014)",
    searchPlaceholder: "🔍 Tìm kiếm...",
    sort: "Sắp xếp",
    sortByName: "Theo tên",
    sortByHost: "Theo địa chỉ",
    noResults: (query) => `Không có kết quả cho "${query}"`,
    ungrouped: "(Chưa phân nhóm)",
    rowHint: "Nhấp: kết nối trong tab hiện tại / Nhấp đúp: tab mới",
    edit: "Chỉnh sửa (S-015)",
    delete: "Xóa (S-016)",
    emptyTitle: "Chưa có host nào được đăng ký",
    emptyLine1: "Khi bạn thêm host SSH đầu tiên,",
    emptyLine2: "bạn có thể kết nối chỉ bằng một cú nhấp.",
    addFirstHost: "+ Thêm host đầu tiên của bạn",
  },
  id: {
    switchToLocal: "Alihkan tab aktif ke shell lokal",
    keyManager: "Pengelola kunci SSH (S-019)",
    groupTagManager: "Pengelola grup/tag (S-017)",
    newHost: "Host baru (S-014)",
    searchPlaceholder: "🔍 Cari...",
    sort: "Urutkan",
    sortByName: "Berdasarkan nama",
    sortByHost: "Berdasarkan alamat",
    noResults: (query) => `Tidak ada hasil untuk "${query}"`,
    ungrouped: "(Tanpa grup)",
    rowHint: "Klik: sambungkan di tab saat ini / Klik dua kali: tab baru",
    edit: "Edit (S-015)",
    delete: "Hapus (S-016)",
    emptyTitle: "Belum ada host yang terdaftar",
    emptyLine1: "Setelah Anda menambahkan host SSH pertama,",
    emptyLine2: "Anda dapat menyambung hanya dengan satu klik.",
    addFirstHost: "+ Tambahkan host pertama Anda",
  },
  hi: {
    switchToLocal: "सक्रिय टैब को लोकल शेल पर बदलें",
    keyManager: "SSH कुंजी प्रबंधक (S-019)",
    groupTagManager: "समूह/टैग प्रबंधक (S-017)",
    newHost: "नया होस्ट (S-014)",
    searchPlaceholder: "🔍 खोजें...",
    sort: "क्रमबद्ध करें",
    sortByName: "नाम से",
    sortByHost: "पते से",
    noResults: (query) => `"${query}" के लिए कोई परिणाम नहीं`,
    ungrouped: "(समूह रहित)",
    rowHint: "क्लिक: वर्तमान टैब में कनेक्ट करें / डबल-क्लिक: नया टैब",
    edit: "संपादित करें (S-015)",
    delete: "हटाएं (S-016)",
    emptyTitle: "अभी तक कोई होस्ट पंजीकृत नहीं है",
    emptyLine1: "जैसे ही आप अपना पहला SSH होस्ट जोड़ेंगे,",
    emptyLine2: "आप एक ही क्लिक से कनेक्ट कर सकते हैं।",
    addFirstHost: "+ अपना पहला होस्ट जोड़ें",
  },
};

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
  const t = useT(STR);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [editing, setEditing] = useState<SshHost | "new" | null>(null);
  const [deleting, setDeleting] = useState<SshHost | null>(null);
  const [showManager, setShowManager] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
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
        width: "100%",
        height: "100%",
        background: "#252526",
        color: "#cccccc",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid #111",
        fontSize: 13,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onSelectLocal}
        style={{
          ...rowStyle,
          background: isLocalActive ? "#094771" : "transparent",
          color: isLocalActive ? "#fff" : "#cccccc",
        }}
        title={t.switchToLocal}
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
            onClick={() => setShowKeys(true)}
            style={addBtnStyle}
            title={t.keyManager}
          >
            🔑
          </button>
          <button
            onClick={() => setShowManager(true)}
            style={addBtnStyle}
            title={t.groupTagManager}
          >
            ⚙
          </button>
          <button
            onClick={() => setEditing("new")}
            style={addBtnStyle}
            title={t.newHost}
          >
            +
          </button>
        </div>
      </div>

      <div style={{ padding: "4px 10px 8px", display: "flex", gap: 6 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchPlaceholder}
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
          title={t.sort}
          style={{
            background: "#1c1c20",
            border: "1px solid #333",
            color: "#ddd",
            borderRadius: 3,
            padding: "2px 4px",
            fontSize: 11,
          }}
        >
          <option value="name">{t.sortByName}</option>
          <option value="host">{t.sortByHost}</option>
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
            {t.noResults(query)}
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
              label={t.ungrouped}
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

      {showKeys && <SshKeyManager onClose={() => setShowKeys(false)} />}
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
  const tr = useT(STR);
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
            title={tr.rowHint}
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
                title={tr.edit}
              >
                ✎
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(h);
                }}
                style={iconBtnStyle}
                title={tr.delete}
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
  const t = useT(STR);
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
      <div style={{ fontSize: 13, color: "#ddd" }}>{t.emptyTitle}</div>
      <div style={{ fontSize: 11, color: "#789", lineHeight: 1.5 }}>
        {t.emptyLine1}
        <br />
        {t.emptyLine2}
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
        {t.addFirstHost}
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
