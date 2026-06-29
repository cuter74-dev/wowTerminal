import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LangDict, useT } from "../i18n";
import { BackendInfo } from "../types";

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

type PresetLabelKey =
  | "presetOpenai"
  | "presetClaude"
  | "presetOllama"
  | "presetCustom";

const PRESETS: Array<{
  labelKey: PresetLabelKey;
  id: string;
  displayName: string;
  apiBase: string;
  defaultModel: string;
  needsApiKey: boolean;
}> = [
  {
    labelKey: "presetOpenai",
    id: "openai",
    displayName: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    needsApiKey: true,
  },
  {
    labelKey: "presetClaude",
    id: "claude",
    displayName: "Claude",
    apiBase: "",
    defaultModel: "claude-3-5-sonnet-latest",
    needsApiKey: true,
  },
  {
    labelKey: "presetOllama",
    id: "ollama-local",
    displayName: "Ollama",
    apiBase: "http://localhost:11434/v1",
    defaultModel: "llama3.1:8b",
    needsApiKey: false,
  },
  {
    labelKey: "presetCustom",
    id: "",
    displayName: "",
    apiBase: "",
    defaultModel: "",
    needsApiKey: true,
  },
];

const STR: LangDict<{
    title: string;
    close: string;
    confirmDelete: (id: string) => string;
    noBackends: string;
    keychainKey: string;
    noKey: string;
    edit: string;
    delete: string;
    duplicate: string;
    addBackend: string;
    presetOpenai: string;
    presetClaude: string;
    presetOllama: string;
    presetCustom: string;
    editTitle: (id: string) => string;
    newBackend: string;
    preset: string;
    idLabel: string;
    idPlaceholder: string;
    displayNameLabel: string;
    displayNamePlaceholder: string;
    apiBaseLabel: string;
    defaultModelLabel: string;
    refreshModels: string;
    apiKeyKeep: string;
    apiKeyOptional: string;
    requiredError: string;
    idExistsError: (id: string) => string;
    cancel: string;
    saving: string;
    save: string;
  }
> = {
  en: {
    title: "LLM Backend Settings",
    close: "Close",
    confirmDelete: (id) =>
      `Delete backend '${id}'? (The API key in the Keychain will also be removed.)`,
    noBackends: "No backends registered",
    keychainKey: "· 🔑 keychain",
    noKey: "· no key",
    edit: "Edit",
    delete: "Delete",
    duplicate: "Duplicate",
    addBackend: "+ Add backend",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — requires OpenAI-compatible gateway",
    presetOllama: "Ollama (local)",
    presetCustom: "Custom (vLLM/TGI, etc.)",
    editTitle: (id) => `Edit backend — ${id}`,
    newBackend: "New backend",
    preset: "Preset",
    idLabel: "ID (URL-safe slug)",
    idPlaceholder: "e.g. openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "e.g. OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "Refresh model list",
    apiKeyKeep: "API Key (leave blank to keep existing key)",
    apiKeyOptional:
      "API Key (optional — leave blank for local servers without auth)",
    requiredError: "id / displayName / apiBase / defaultModel are required.",
    idExistsError: (id) =>
      `ID '${id}' already exists. Enter a different ID (e.g. ${id}-2).`,
    cancel: "Cancel",
    saving: "Saving...",
    save: "Save",
  },
  ko: {
    title: "LLM 백엔드 설정",
    close: "닫기",
    confirmDelete: (id) =>
      `백엔드 '${id}'를 삭제할까요? (Keychain의 API 키도 함께 제거됩니다.)`,
    noBackends: "등록된 백엔드 없음",
    keychainKey: "· 🔑 keychain",
    noKey: "· 키 없음",
    edit: "편집",
    delete: "삭제",
    duplicate: "복제",
    addBackend: "+ 백엔드 추가",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — OpenAI 호환 게이트웨이 필요",
    presetOllama: "Ollama (로컬)",
    presetCustom: "직접 입력 (vLLM/TGI 등)",
    editTitle: (id) => `백엔드 편집 — ${id}`,
    newBackend: "새 백엔드",
    preset: "프리셋",
    idLabel: "ID (URL-safe slug)",
    idPlaceholder: "예: openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "예: OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "모델 목록 새로고침",
    apiKeyKeep: "API Key (비우면 기존 키 유지)",
    apiKeyOptional: "API Key (선택 — 인증 불필요한 로컬 서버는 비워두기)",
    requiredError: "id / displayName / apiBase / defaultModel은 필수입니다.",
    idExistsError: (id) =>
      `ID '${id}'가 이미 존재합니다. 다른 ID를 입력하세요 (예: ${id}-2).`,
    cancel: "취소",
    saving: "저장 중...",
    save: "저장",
  },
  es: {
    title: "Configuración del backend LLM",
    close: "Cerrar",
    confirmDelete: (id) =>
      `¿Eliminar el backend '${id}'? (La clave API en el Keychain también se eliminará.)`,
    noBackends: "No hay backends registrados",
    keychainKey: "· 🔑 keychain",
    noKey: "· sin clave",
    edit: "Editar",
    delete: "Eliminar",
    duplicate: "Duplicar",
    addBackend: "+ Añadir backend",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — requiere una puerta de enlace compatible con OpenAI",
    presetOllama: "Ollama (local)",
    presetCustom: "Personalizado (vLLM/TGI, etc.)",
    editTitle: (id) => `Editar backend — ${id}`,
    newBackend: "Nuevo backend",
    preset: "Preajuste",
    idLabel: "ID (slug seguro para URL)",
    idPlaceholder: "p. ej. openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "p. ej. OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "Actualizar lista de modelos",
    apiKeyKeep: "API Key (dejar en blanco para conservar la clave existente)",
    apiKeyOptional:
      "API Key (opcional — dejar en blanco para servidores locales sin autenticación)",
    requiredError: "id / displayName / apiBase / defaultModel son obligatorios.",
    idExistsError: (id) =>
      `El ID '${id}' ya existe. Introduce un ID diferente (p. ej. ${id}-2).`,
    cancel: "Cancelar",
    saving: "Guardando...",
    save: "Guardar",
  },
  zh: {
    title: "LLM 后端设置",
    close: "关闭",
    confirmDelete: (id) =>
      `删除后端 '${id}'？（Keychain 中的 API 密钥也将被移除。）`,
    noBackends: "尚未注册后端",
    keychainKey: "· 🔑 keychain",
    noKey: "· 无密钥",
    edit: "编辑",
    delete: "删除",
    duplicate: "复制",
    addBackend: "+ 添加后端",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — 需要 OpenAI 兼容网关",
    presetOllama: "Ollama（本地）",
    presetCustom: "自定义（vLLM/TGI 等）",
    editTitle: (id) => `编辑后端 — ${id}`,
    newBackend: "新建后端",
    preset: "预设",
    idLabel: "ID（URL 安全 slug）",
    idPlaceholder: "例如 openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "例如 OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "刷新模型列表",
    apiKeyKeep: "API Key（留空以保留现有密钥）",
    apiKeyOptional:
      "API Key（可选 — 无需认证的本地服务器请留空）",
    requiredError: "id / displayName / apiBase / defaultModel 为必填项。",
    idExistsError: (id) =>
      `ID '${id}' 已存在。请输入其他 ID（例如 ${id}-2）。`,
    cancel: "取消",
    saving: "保存中...",
    save: "保存",
  },
  ja: {
    title: "LLM バックエンド設定",
    close: "閉じる",
    confirmDelete: (id) =>
      `バックエンド '${id}' を削除しますか？（Keychain の API キーも削除されます。）`,
    noBackends: "登録済みのバックエンドがありません",
    keychainKey: "· 🔑 keychain",
    noKey: "· キーなし",
    edit: "編集",
    delete: "削除",
    duplicate: "複製",
    addBackend: "+ バックエンドを追加",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — OpenAI 互換ゲートウェイが必要",
    presetOllama: "Ollama（ローカル）",
    presetCustom: "カスタム（vLLM/TGI など）",
    editTitle: (id) => `バックエンドを編集 — ${id}`,
    newBackend: "新しいバックエンド",
    preset: "プリセット",
    idLabel: "ID（URL セーフな slug）",
    idPlaceholder: "例: openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "例: OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "モデル一覧を更新",
    apiKeyKeep: "API Key（空欄にすると既存のキーを保持）",
    apiKeyOptional:
      "API Key（任意 — 認証不要なローカルサーバーは空欄）",
    requiredError: "id / displayName / apiBase / defaultModel は必須です。",
    idExistsError: (id) =>
      `ID '${id}' は既に存在します。別の ID を入力してください（例: ${id}-2）。`,
    cancel: "キャンセル",
    saving: "保存中...",
    save: "保存",
  },
  ru: {
    title: "Настройки бэкенда LLM",
    close: "Закрыть",
    confirmDelete: (id) =>
      `Удалить бэкенд '${id}'? (Ключ API в Keychain также будет удалён.)`,
    noBackends: "Нет зарегистрированных бэкендов",
    keychainKey: "· 🔑 keychain",
    noKey: "· без ключа",
    edit: "Изменить",
    delete: "Удалить",
    duplicate: "Дублировать",
    addBackend: "+ Добавить бэкенд",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — требуется шлюз, совместимый с OpenAI",
    presetOllama: "Ollama (локально)",
    presetCustom: "Пользовательский (vLLM/TGI и др.)",
    editTitle: (id) => `Изменить бэкенд — ${id}`,
    newBackend: "Новый бэкенд",
    preset: "Пресет",
    idLabel: "ID (URL-безопасный slug)",
    idPlaceholder: "напр. openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "напр. OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "Обновить список моделей",
    apiKeyKeep: "API Key (оставьте пустым, чтобы сохранить текущий ключ)",
    apiKeyOptional:
      "API Key (необязательно — оставьте пустым для локальных серверов без аутентификации)",
    requiredError: "id / displayName / apiBase / defaultModel обязательны.",
    idExistsError: (id) =>
      `ID '${id}' уже существует. Введите другой ID (напр. ${id}-2).`,
    cancel: "Отмена",
    saving: "Сохранение...",
    save: "Сохранить",
  },
  fr: {
    title: "Paramètres du backend LLM",
    close: "Fermer",
    confirmDelete: (id) =>
      `Supprimer le backend '${id}' ? (La clé API dans le Keychain sera aussi supprimée.)`,
    noBackends: "Aucun backend enregistré",
    keychainKey: "· 🔑 keychain",
    noKey: "· sans clé",
    edit: "Modifier",
    delete: "Supprimer",
    duplicate: "Dupliquer",
    addBackend: "+ Ajouter un backend",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — nécessite une passerelle compatible OpenAI",
    presetOllama: "Ollama (local)",
    presetCustom: "Personnalisé (vLLM/TGI, etc.)",
    editTitle: (id) => `Modifier le backend — ${id}`,
    newBackend: "Nouveau backend",
    preset: "Préréglage",
    idLabel: "ID (slug sûr pour URL)",
    idPlaceholder: "ex. openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "ex. OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "Actualiser la liste des modèles",
    apiKeyKeep: "API Key (laisser vide pour conserver la clé existante)",
    apiKeyOptional:
      "API Key (facultatif — laisser vide pour les serveurs locaux sans authentification)",
    requiredError: "id / displayName / apiBase / defaultModel sont obligatoires.",
    idExistsError: (id) =>
      `L'ID '${id}' existe déjà. Saisissez un autre ID (ex. ${id}-2).`,
    cancel: "Annuler",
    saving: "Enregistrement...",
    save: "Enregistrer",
  },
  de: {
    title: "LLM-Backend-Einstellungen",
    close: "Schließen",
    confirmDelete: (id) =>
      `Backend '${id}' löschen? (Der API-Schlüssel im Keychain wird ebenfalls entfernt.)`,
    noBackends: "Keine Backends registriert",
    keychainKey: "· 🔑 keychain",
    noKey: "· kein Schlüssel",
    edit: "Bearbeiten",
    delete: "Löschen",
    duplicate: "Duplizieren",
    addBackend: "+ Backend hinzufügen",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — erfordert ein OpenAI-kompatibles Gateway",
    presetOllama: "Ollama (lokal)",
    presetCustom: "Benutzerdefiniert (vLLM/TGI usw.)",
    editTitle: (id) => `Backend bearbeiten — ${id}`,
    newBackend: "Neues Backend",
    preset: "Voreinstellung",
    idLabel: "ID (URL-sicherer Slug)",
    idPlaceholder: "z. B. openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "z. B. OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "Modellliste aktualisieren",
    apiKeyKeep: "API Key (leer lassen, um den vorhandenen Schlüssel zu behalten)",
    apiKeyOptional:
      "API Key (optional — für lokale Server ohne Authentifizierung leer lassen)",
    requiredError: "id / displayName / apiBase / defaultModel sind erforderlich.",
    idExistsError: (id) =>
      `Die ID '${id}' existiert bereits. Geben Sie eine andere ID ein (z. B. ${id}-2).`,
    cancel: "Abbrechen",
    saving: "Wird gespeichert...",
    save: "Speichern",
  },
  vi: {
    title: "Cài đặt backend LLM",
    close: "Đóng",
    confirmDelete: (id) =>
      `Xóa backend '${id}'? (Khóa API trong Keychain cũng sẽ bị xóa.)`,
    noBackends: "Chưa có backend nào",
    keychainKey: "· 🔑 keychain",
    noKey: "· không có khóa",
    edit: "Sửa",
    delete: "Xóa",
    duplicate: "Nhân bản",
    addBackend: "+ Thêm backend",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — cần cổng tương thích OpenAI",
    presetOllama: "Ollama (cục bộ)",
    presetCustom: "Tùy chỉnh (vLLM/TGI, v.v.)",
    editTitle: (id) => `Sửa backend — ${id}`,
    newBackend: "Backend mới",
    preset: "Cấu hình sẵn",
    idLabel: "ID (slug an toàn cho URL)",
    idPlaceholder: "vd. openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "vd. OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "Làm mới danh sách mô hình",
    apiKeyKeep: "API Key (để trống để giữ khóa hiện có)",
    apiKeyOptional:
      "API Key (tùy chọn — để trống cho máy chủ cục bộ không cần xác thực)",
    requiredError: "id / displayName / apiBase / defaultModel là bắt buộc.",
    idExistsError: (id) =>
      `ID '${id}' đã tồn tại. Hãy nhập ID khác (vd. ${id}-2).`,
    cancel: "Hủy",
    saving: "Đang lưu...",
    save: "Lưu",
  },
  id: {
    title: "Pengaturan Backend LLM",
    close: "Tutup",
    confirmDelete: (id) =>
      `Hapus backend '${id}'? (Kunci API di Keychain juga akan dihapus.)`,
    noBackends: "Belum ada backend terdaftar",
    keychainKey: "· 🔑 keychain",
    noKey: "· tanpa kunci",
    edit: "Ubah",
    delete: "Hapus",
    duplicate: "Duplikat",
    addBackend: "+ Tambah backend",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — memerlukan gateway kompatibel OpenAI",
    presetOllama: "Ollama (lokal)",
    presetCustom: "Kustom (vLLM/TGI, dll.)",
    editTitle: (id) => `Ubah backend — ${id}`,
    newBackend: "Backend baru",
    preset: "Preset",
    idLabel: "ID (slug aman untuk URL)",
    idPlaceholder: "mis. openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "mis. OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "Segarkan daftar model",
    apiKeyKeep: "API Key (kosongkan untuk mempertahankan kunci yang ada)",
    apiKeyOptional:
      "API Key (opsional — kosongkan untuk server lokal tanpa autentikasi)",
    requiredError: "id / displayName / apiBase / defaultModel wajib diisi.",
    idExistsError: (id) =>
      `ID '${id}' sudah ada. Masukkan ID lain (mis. ${id}-2).`,
    cancel: "Batal",
    saving: "Menyimpan...",
    save: "Simpan",
  },
  hi: {
    title: "LLM बैकएंड सेटिंग्स",
    close: "बंद करें",
    confirmDelete: (id) =>
      `बैकएंड '${id}' हटाएं? (Keychain की API कुंजी भी हटा दी जाएगी।)`,
    noBackends: "कोई बैकएंड पंजीकृत नहीं है",
    keychainKey: "· 🔑 keychain",
    noKey: "· कोई कुंजी नहीं",
    edit: "संपादित करें",
    delete: "हटाएं",
    duplicate: "डुप्लिकेट",
    addBackend: "+ बैकएंड जोड़ें",
    presetOpenai: "OpenAI",
    presetClaude: "Anthropic (Claude) — OpenAI-संगत गेटवे आवश्यक",
    presetOllama: "Ollama (लोकल)",
    presetCustom: "कस्टम (vLLM/TGI, आदि)",
    editTitle: (id) => `बैकएंड संपादित करें — ${id}`,
    newBackend: "नया बैकएंड",
    preset: "प्रीसेट",
    idLabel: "ID (URL-सुरक्षित slug)",
    idPlaceholder: "जैसे openai, ollama-local",
    displayNameLabel: "Display Name",
    displayNamePlaceholder: "जैसे OpenAI",
    apiBaseLabel: "API Base URL",
    defaultModelLabel: "Default Model",
    refreshModels: "मॉडल सूची ताज़ा करें",
    apiKeyKeep: "API Key (मौजूदा कुंजी बनाए रखने के लिए खाली छोड़ें)",
    apiKeyOptional:
      "API Key (वैकल्पिक — बिना प्रमाणीकरण वाले लोकल सर्वर के लिए खाली छोड़ें)",
    requiredError: "id / displayName / apiBase / defaultModel आवश्यक हैं।",
    idExistsError: (id) =>
      `ID '${id}' पहले से मौजूद है। कोई अन्य ID दर्ज करें (जैसे ${id}-2)।`,
    cancel: "रद्द करें",
    saving: "सहेज रहे हैं...",
    save: "सहेजें",
  },
};

export function LlmSetupModal({ onClose, onChanged }: Props) {
  const t = useT(STR);
  const [list, setList] = useState<BackendInfo[]>([]);
  const [editing, setEditing] = useState<BackendInfo | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await invoke<BackendInfo[]>("ai_list_backend_configs");
      setList(r);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function deleteOne(id: string) {
    if (!confirm(t.confirmDelete(id)))
      return;
    try {
      await invoke("ai_delete_backend", { id });
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  async function duplicateOne(b: BackendInfo) {
    // 설정만 복제 — 충돌 없는 새 id를 만든다. API 키는 keyring에 id 기준 저장되므로
    // 복제본은 키 없이 생성되고 첫 사용 전 키를 다시 입력하면 된다.
    const base = `${b.id}-copy`;
    let id = base;
    let n = 2;
    while (list.some((x) => x.id === id)) id = `${base}-${n++}`;
    try {
      await invoke("ai_save_backend", {
        args: {
          id,
          displayName: `${b.displayName} (copy)`,
          apiBase: b.apiBase,
          defaultModel: b.defaultModel,
          reasoningEffort: b.reasoningEffort,
          apiKey: null,
        },
      });
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
          width: 520,
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
          gap: 14,
        }}
        role="dialog"
        aria-modal="true"
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <strong style={{ fontSize: 15 }}>{t.title}</strong>
          <button onClick={onClose} style={iconBtnStyle} title={t.close}>
            ×
          </button>
        </header>

        {!editing && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.length === 0 && (
                <div style={{ color: "#789", textAlign: "center", padding: 16 }}>
                  {t.noBackends}
                </div>
              )}
              {list.map((b) => (
                <div
                  key={b.id}
                  style={{
                    border: "1px solid #333",
                    borderRadius: 4,
                    padding: 10,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {b.displayName}{" "}
                      <span style={{ fontSize: 11, color: "#789" }}>({b.id})</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#789" }}>
                      {b.apiBase} · {b.defaultModel}{" "}
                      {b.hasApiKey ? t.keychainKey : t.noKey}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => void duplicateOne(b)}
                      style={iconBtnStyle}
                      title={t.duplicate}
                    >
                      ⧉
                    </button>
                    <button
                      onClick={() => setEditing(b)}
                      style={iconBtnStyle}
                      title={t.edit}
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => void deleteOne(b.id)}
                      style={iconBtnStyle}
                      title={t.delete}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setEditing("new")}
              style={primaryBtnStyle}
            >
              {t.addBackend}
            </button>
          </>
        )}

        {editing && (
          <BackendForm
            initial={editing === "new" ? null : editing}
            existingIds={list.map((b) => b.id)}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reload();
              onChanged();
            }}
          />
        )}

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

// 사고력 강도 라벨 (#123) — 큰 STR을 안 건드리도록 별도 미니 사전(en 필수, 나머지 en 폴백).
const RE_STR: LangDict<{ label: string; none: string; hint: string }> = {
  en: {
    label: "Reasoning effort",
    none: "None (default)",
    hint: "Only for reasoning models (o1 / o3 / gpt-5). Leave None for regular models.",
  },
  ko: {
    label: "사고력 강도",
    none: "없음 (기본)",
    hint: "추론 모델(o1 / o3 / gpt-5)에만 적용됩니다. 일반 모델은 ‘없음’으로 두세요.",
  },
};

function BackendForm({
  initial,
  existingIds,
  onCancel,
  onSaved,
}: {
  initial: BackendInfo | null;
  existingIds: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT(STR);
  const re = useT(RE_STR);
  const [presetIdx, setPresetIdx] = useState(initial ? -1 : 0);
  const [id, setId] = useState(initial?.id ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [apiBase, setApiBase] = useState(initial?.apiBase ?? "");
  const [defaultModel, setDefaultModel] = useState(
    initial?.defaultModel ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  // 사고력 강도(#123): "" = 미설정, 또는 low/medium/high.
  const [reasoningEffort, setReasoningEffort] = useState(
    initial?.reasoningEffort ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ollama 등 OpenAI 호환 서버의 설치된 모델 목록을 받아 모델 선택을 드롭다운으로 보인다.
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  // Ollama로 보이는 apiBase면(로컬 11434 또는 ollama 포함) 모델 목록을 자동 조회.
  const isOllama = /11434/.test(apiBase) || /ollama/i.test(apiBase);

  async function refreshModels() {
    if (!apiBase.trim()) return;
    setModelsErr(null);
    setModelsBusy(true);
    try {
      const list = await invoke<string[]>("ai_list_models", {
        apiBase: apiBase.trim(),
        apiKey: apiKey || null,
      });
      setModels(list);
    } catch (e) {
      setModels([]);
      setModelsErr(String(e));
    } finally {
      setModelsBusy(false);
    }
  }

  // Ollama면 apiBase가 정해질 때 자동으로 모델 목록을 가져온다.
  useEffect(() => {
    if (isOllama && apiBase.trim()) void refreshModels();
    else {
      setModels([]);
      setModelsErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, isOllama]);

  function applyPreset(idx: number) {
    setPresetIdx(idx);
    if (idx < 0) return;
    const p = PRESETS[idx];
    if (p.id) {
      // 같은 프리셋으로 여러 개 등록할 수 있도록 충돌 시 -2, -3 … 자동 부여.
      let candidate = p.id;
      let n = 2;
      while (existingIds.includes(candidate)) candidate = `${p.id}-${n++}`;
      setId(candidate);
    }
    if (p.displayName) setDisplayName(p.displayName);
    if (p.apiBase) setApiBase(p.apiBase);
    if (p.defaultModel) setDefaultModel(p.defaultModel);
  }

  async function handleSave() {
    setError(null);
    const finalId = id || slugify(displayName);
    if (!finalId || !displayName || !apiBase || !defaultModel) {
      setError(t.requiredError);
      return;
    }
    // 새 백엔드인데 ID가 기존과 겹치면 덮어쓰기가 되므로 거부.
    if (!initial && existingIds.includes(finalId)) {
      setError(t.idExistsError(finalId));
      return;
    }
    try {
      setSaving(true);
      await invoke("ai_save_backend", {
        args: {
          id: finalId,
          displayName: displayName.trim(),
          apiBase: apiBase.trim(),
          defaultModel: defaultModel.trim(),
          reasoningEffort: reasoningEffort || null,
          apiKey: apiKey || null,
        },
      });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h4 style={{ margin: 0, fontSize: 13 }}>
        {initial ? t.editTitle(initial.id) : t.newBackend}
      </h4>

      {!initial && (
        <Field label={t.preset}>
          <select
            value={presetIdx}
            onChange={(e) => applyPreset(parseInt(e.target.value, 10))}
            style={inputStyle}
          >
            {PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {t[p.labelKey]}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={t.idLabel}>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t.idPlaceholder}
          disabled={!!initial}
          style={inputStyle}
        />
      </Field>

      <Field label={t.displayNameLabel}>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t.displayNamePlaceholder}
          style={inputStyle}
        />
      </Field>

      <Field label={t.apiBaseLabel}>
        <input
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder="https://api.openai.com/v1"
          style={inputStyle}
        />
      </Field>

      <Field label={t.defaultModelLabel}>
        <div style={{ display: "flex", gap: 6 }}>
          {isOllama && models.length > 0 ? (
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            >
              {defaultModel && !models.includes(defaultModel) && (
                <option value={defaultModel}>{defaultModel}</option>
              )}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="gpt-4o-mini"
              list={models.length ? "llm-model-list" : undefined}
              style={{ ...inputStyle, flex: 1 }}
            />
          )}
          <button
            type="button"
            onClick={() => void refreshModels()}
            disabled={!apiBase.trim() || modelsBusy}
            title={t.refreshModels}
            style={{
              background: "#2a2a32",
              color: "#ccc",
              border: "1px solid #3a3a44",
              borderRadius: 4,
              padding: "0 10px",
              cursor: apiBase.trim() && !modelsBusy ? "pointer" : "default",
              fontSize: 14,
            }}
          >
            {modelsBusy ? "…" : "↻"}
          </button>
          <datalist id="llm-model-list">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        {modelsErr && (
          <div style={{ color: "#e88", fontSize: 11, marginTop: 4 }}>
            {modelsErr}
          </div>
        )}
      </Field>

      <Field label={re.label}>
        <select
          value={reasoningEffort}
          onChange={(e) => setReasoningEffort(e.target.value)}
          style={{ ...inputStyle, width: "100%" }}
        >
          <option value="">{re.none}</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
        <div style={{ color: "#888", fontSize: 11, marginTop: 4 }}>
          {re.hint}
        </div>
      </Field>

      <Field
        label={
          initial?.hasApiKey
            ? t.apiKeyKeep
            : t.apiKeyOptional
        }
      >
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      {error && <div style={{ color: "#fdd", fontSize: 12 }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={btnStyle}>
          {t.cancel}
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={primaryBtnStyle}
        >
          {saving ? t.saving : t.save}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "#aaa", fontSize: 11 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#1e1e1e",
  color: "#e6e6e6",
  border: "1px solid #444",
  padding: "6px 8px",
  borderRadius: 3,
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  color: "#cccccc",
  border: "1px solid #555",
  padding: "6px 14px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 12,
};

const primaryBtnStyle: React.CSSProperties = {
  background: "#0a5380",
  color: "#fff",
  border: "1px solid #4a9eff",
  padding: "6px 14px",
  borderRadius: 3,
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
