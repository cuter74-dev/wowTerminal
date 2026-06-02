import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
    duplicate: string;
    connect: string;
    openInNewTab: string;
    updateAvailable: string;
    updating: string;
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
    rowHint: "Click: select / ▶: connect / Double-click: new tab",
    edit: "Edit (S-015)",
    delete: "Delete (S-016)",
    duplicate: "Duplicate",
    connect: "Connect (current tab)",
    openInNewTab: "Connect in new tab",
    updateAvailable: "Update available — click to install",
    updating: "Updating…",
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
    rowHint: "클릭: 선택 / ▶: 연결 / 더블클릭: 새 탭",
    edit: "편집 (S-015)",
    delete: "삭제 (S-016)",
    duplicate: "복제",
    connect: "연결 (현재 탭)",
    openInNewTab: "새 탭에서 연결",
    updateAvailable: "업데이트 있음 — 클릭해 설치",
    updating: "업데이트 중…",
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
    rowHint: "Clic: seleccionar / ▶: conectar / Doble clic: pestaña nueva",
    edit: "Editar (S-015)",
    delete: "Eliminar (S-016)",
    duplicate: "Duplicar",
    connect: "Conectar (pestaña actual)",
    openInNewTab: "Conectar en pestaña nueva",
    updateAvailable: "Actualización disponible — clic para instalar",
    updating: "Actualizando…",
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
    rowHint: "单击：选择 / ▶：连接 / 双击：新建标签页",
    edit: "编辑 (S-015)",
    delete: "删除 (S-016)",
    duplicate: "复制",
    connect: "连接（当前标签页）",
    openInNewTab: "在新标签页中连接",
    updateAvailable: "有可用更新 — 点击安装",
    updating: "正在更新…",
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
    rowHint: "クリック: 選択 / ▶: 接続 / ダブルクリック: 新規タブ",
    edit: "編集 (S-015)",
    delete: "削除 (S-016)",
    duplicate: "複製",
    connect: "接続（現在のタブ）",
    openInNewTab: "新しいタブで接続",
    updateAvailable: "更新があります — クリックしてインストール",
    updating: "更新中…",
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
    rowHint: "Клик: выбрать / ▶: подключить / Двойной клик: новая вкладка",
    edit: "Изменить (S-015)",
    delete: "Удалить (S-016)",
    duplicate: "Дублировать",
    connect: "Подключить (текущая вкладка)",
    openInNewTab: "Подключить в новой вкладке",
    updateAvailable: "Доступно обновление — нажмите для установки",
    updating: "Обновление…",
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
    rowHint: "Clic : sélectionner / ▶ : connecter / Double-clic : nouvel onglet",
    edit: "Modifier (S-015)",
    delete: "Supprimer (S-016)",
    duplicate: "Dupliquer",
    connect: "Connecter (onglet actuel)",
    openInNewTab: "Connecter dans un nouvel onglet",
    updateAvailable: "Mise à jour disponible — cliquez pour installer",
    updating: "Mise à jour…",
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
    rowHint: "Klick: auswählen / ▶: verbinden / Doppelklick: neuer Tab",
    edit: "Bearbeiten (S-015)",
    delete: "Löschen (S-016)",
    duplicate: "Duplizieren",
    connect: "Verbinden (aktueller Tab)",
    openInNewTab: "In neuem Tab verbinden",
    updateAvailable: "Update verfügbar — zum Installieren klicken",
    updating: "Wird aktualisiert…",
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
    rowHint: "Nhấp: chọn / ▶: kết nối / Nhấp đúp: tab mới",
    edit: "Chỉnh sửa (S-015)",
    delete: "Xóa (S-016)",
    duplicate: "Nhân bản",
    connect: "Kết nối (tab hiện tại)",
    openInNewTab: "Kết nối trong tab mới",
    updateAvailable: "Có bản cập nhật — nhấp để cài đặt",
    updating: "Đang cập nhật…",
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
    rowHint: "Klik: pilih / ▶: sambungkan / Klik dua kali: tab baru",
    edit: "Edit (S-015)",
    delete: "Hapus (S-016)",
    duplicate: "Duplikat",
    connect: "Sambungkan (tab saat ini)",
    openInNewTab: "Sambungkan di tab baru",
    updateAvailable: "Pembaruan tersedia — klik untuk memasang",
    updating: "Memperbarui…",
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
    rowHint: "क्लिक: चुनें / ▶: कनेक्ट / डबल-क्लिक: नया टैब",
    edit: "संपादित करें (S-015)",
    delete: "हटाएं (S-016)",
    duplicate: "डुप्लिकेट",
    connect: "कनेक्ट करें (वर्तमान टैब)",
    openInNewTab: "नए टैब में कनेक्ट करें",
    updateAvailable: "अपडेट उपलब्ध — इंस्टॉल करने के लिए क्लिक करें",
    updating: "अपडेट हो रहा है…",
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
  const [appVersion, setAppVersion] = useState("");
  // 행 클릭은 "선택"만(연결 X). 연결은 더블클릭/연결 버튼/우클릭 메뉴로.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    host: SshHost;
    x: number;
    y: number;
  } | null>(null);

  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
    // 시작 시 업데이트 확인 (endpoint에 latest.json이 없으면 조용히 무시).
    check()
      .then((u) => {
        if (u) setUpdate(u);
      })
      .catch(() => {});
  }, []);

  async function applyUpdate() {
    if (!update || updating) return;
    setUpdating(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setError(String(e));
      setUpdating(false);
    }
  }

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

  async function duplicateHost(h: SshHost) {
    // 설정만 복제 — 새 id를 발급한다. 시크릿(비밀번호/키)은 호스트 id 기준 Keychain에
    // 저장되므로 복제본은 첫 접속 시 다시 인증한다.
    const copy: SshHost = {
      ...h,
      id: crypto.randomUUID(),
      name: `${h.name} (copy)`,
    };
    try {
      await invoke("ssh_save_host", { host: copy });
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  // 선택된 호스트를 키보드로 복사(cmd/ctrl+C) → 붙여넣기(cmd/ctrl+V)로 복제, 삭제(cmd/ctrl+Delete).
  // 입력창/터미널(textarea)에 포커스가 있으면 텍스트 복붙을 방해하지 않도록 무시한다.
  const copiedHostRef = useRef<SshHost | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) return;
      const targetId = selectedId ?? activeHostId;
      const k = e.key.toLowerCase();
      if (k === "c") {
        const h = hosts.find((x) => x.id === targetId);
        if (h) copiedHostRef.current = h;
      } else if (k === "v") {
        if (copiedHostRef.current) {
          e.preventDefault();
          void duplicateHost(copiedHostRef.current);
        }
      } else if (e.key === "Backspace" || e.key === "Delete") {
        const h = hosts.find((x) => x.id === targetId);
        if (h) {
          e.preventDefault();
          setDeleting(h);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts, activeHostId, selectedId]);

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
        userSelect: "none", // 호스트 목록은 UI 영역이라 드래그 텍스트 선택 비활성.
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
                selectedId={selectedId}
                query={query}
                tagColor={tagColor}
                onConnect={onSelect}
                onSelectRow={setSelectedId}
                onOpenInNewTab={onOpenInNewTab}
                onEdit={setEditing}
                onDelete={setDeleting}
                onDuplicate={duplicateHost}
                onContextMenu={(h, x, y) => setCtxMenu({ host: h, x, y })}
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
              selectedId={selectedId}
              query={query}
              tagColor={tagColor}
              onConnect={onSelect}
              onSelectRow={setSelectedId}
              onOpenInNewTab={onOpenInNewTab}
              onEdit={setEditing}
              onDelete={setDeleting}
              onDuplicate={duplicateHost}
              onContextMenu={(h, x, y) => setCtxMenu({ host: h, x, y })}
            />
          );
        })()}
      </div>

      <div
        style={{
          padding: "6px 12px",
          fontSize: 10,
          color: "#666",
          borderTop: "1px solid #1a1a1e",
          textAlign: "center",
          userSelect: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <span>wowTerminal{appVersion ? ` v${appVersion}` : ""}</span>
        {update && (
          <button
            onClick={() => void applyUpdate()}
            disabled={updating}
            title={t.updateAvailable}
            style={{
              background: "#0a5380",
              color: "#fff",
              border: "1px solid #4a9eff",
              borderRadius: 4,
              padding: "1px 7px",
              fontSize: 10,
              cursor: updating ? "default" : "pointer",
            }}
          >
            {updating ? t.updating : `↑ ${update.version}`}
          </button>
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

      {ctxMenu && (
        <HostContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onConnect={() => {
            onSelect(ctxMenu.host.id);
            setCtxMenu(null);
          }}
          onConnectNewTab={() => {
            onOpenInNewTab(ctxMenu.host.id);
            setCtxMenu(null);
          }}
          onEdit={() => {
            setEditing(ctxMenu.host);
            setCtxMenu(null);
          }}
          onDuplicate={() => {
            void duplicateHost(ctxMenu.host);
            setCtxMenu(null);
          }}
          onDelete={() => {
            setDeleting(ctxMenu.host);
            setCtxMenu(null);
          }}
        />
      )}
    </div>
  );
}

function HostContextMenu({
  x,
  y,
  onClose,
  onConnect,
  onConnectNewTab,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onConnect: () => void;
  onConnectNewTab: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useT(STR);
  useEffect(() => {
    const close = () => onClose();
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const item = (label: string, onClick: () => void, danger?: boolean) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        background: "transparent",
        border: "none",
        color: danger ? "#f88" : "#ddd",
        textAlign: "left",
        padding: "6px 12px",
        fontSize: 12,
        cursor: "pointer",
        whiteSpace: "nowrap",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#094771")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        top: y,
        left: x,
        zIndex: 2000,
        background: "#26262d",
        border: "1px solid #444",
        borderRadius: 6,
        padding: 4,
        minWidth: 180,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {item(t.connect, onConnect)}
      {item(t.openInNewTab, onConnectNewTab)}
      <div style={{ height: 1, background: "#3a3a42", margin: "4px 0" }} />
      {/* edit/delete 라벨의 spec 코드 "(S-0xx)"는 메뉴 표시에선 떼어낸다. */}
      {item(t.edit.replace(/\s*\(S-\d+\)/, ""), onEdit)}
      {item(t.duplicate, onDuplicate)}
      <div style={{ height: 1, background: "#3a3a42", margin: "4px 0" }} />
      {item(t.delete.replace(/\s*\(S-\d+\)/, ""), onDelete, true)}
    </div>
  );
}

function GroupSection({
  label,
  hosts,
  activeHostId,
  selectedId,
  query,
  tagColor,
  onConnect,
  onSelectRow,
  onOpenInNewTab,
  onEdit,
  onDelete,
  onDuplicate,
  onContextMenu,
}: {
  label: string;
  hosts: SshHost[];
  activeHostId: string | null;
  selectedId: string | null;
  query: string;
  tagColor: (name: string) => string;
  onConnect: (id: string) => void;
  onSelectRow: (id: string) => void;
  onOpenInNewTab: (id: string) => void;
  onEdit: (h: SshHost) => void;
  onDelete: (h: SshHost) => void;
  onDuplicate: (h: SshHost) => void;
  onContextMenu: (h: SshHost, x: number, y: number) => void;
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
        const selected = selectedId === h.id || activeHostId === h.id;
        return (
          <div
            key={h.id}
            onClick={() => onSelectRow(h.id)}
            onDoubleClick={() => onOpenInNewTab(h.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelectRow(h.id);
              onContextMenu(h, e.clientX, e.clientY);
            }}
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
                  onConnect(h.id);
                }}
                style={iconBtnStyle}
                title={tr.connect}
              >
                ▶
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(h);
                }}
                style={iconBtnStyle}
                title={tr.duplicate}
              >
                ⧉
              </button>
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
