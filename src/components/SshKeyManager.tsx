import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LangDict, useT } from "../i18n";
import { SshKeyEntry } from "../types";

interface Props {
  onClose: () => void;
  onChanged?: () => void;
}

type Mode = "list" | "generate" | "import" | { detail: SshKeyEntry };

const STR: LangDict<{
    title: string;
    close: string;
    newKey: string;
    importBtn: string;
    noKeys: string;
    encrypted: string;
    detail: string;
    delete: string;
    confirmDelete: (name: string) => string;
    generateTitle: string;
    name: string;
    namePlaceholderGen: string;
    algorithm: string;
    ed25519Recommended: string;
    cancel: string;
    generating: string;
    generate: string;
    importTitle: string;
    namePlaceholderImport: string;
    privateKeyPem: string;
    pemPlaceholder: string;
    passphrase: string;
    importing: string;
    publicKeyLabel: string;
    backToList: string;
    copied: string;
    copyPublicKey: string;
  }
> = {
  en: {
    title: "🔑 SSH Key Manager",
    close: "Close",
    newKey: "+ Generate new key",
    importBtn: "Import",
    noKeys: "No keys registered. Generate a new key or import an existing one.",
    encrypted: " 🔒 encrypted",
    detail: "Details",
    delete: "Delete",
    confirmDelete: (name) =>
      `Delete key '${name}'? (The private key in the Keychain will also be removed.)`,
    generateTitle: "Generate new key",
    name: "Name",
    namePlaceholderGen: "e.g. my-laptop",
    algorithm: "Algorithm",
    ed25519Recommended: "ed25519 (recommended)",
    cancel: "Cancel",
    generating: "Generating...",
    generate: "Generate",
    importTitle: "Import key (OpenSSH private key)",
    namePlaceholderImport: "e.g. imported-key",
    privateKeyPem: "Private key PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "Paste the entire private key",
    passphrase: "Passphrase (encrypted keys only)",
    importing: "Importing...",
    publicKeyLabel: "Public key (add to authorized_keys)",
    backToList: "← List",
    copied: "Copied",
    copyPublicKey: "Copy public key",
  },
  ko: {
    title: "🔑 SSH 키 관리",
    close: "닫기",
    newKey: "+ 새 키 생성",
    importBtn: "가져오기",
    noKeys: "등록된 키가 없습니다. 새 키를 생성하거나 기존 키를 가져오세요.",
    encrypted: " 🔒 암호화",
    detail: "상세",
    delete: "삭제",
    confirmDelete: (name) =>
      `키 '${name}'을(를) 삭제할까요? (Keychain의 개인키도 제거됩니다.)`,
    generateTitle: "새 키 생성",
    name: "이름",
    namePlaceholderGen: "예: my-laptop",
    algorithm: "알고리즘",
    ed25519Recommended: "ed25519 (권장)",
    cancel: "취소",
    generating: "생성 중...",
    generate: "생성",
    importTitle: "키 가져오기 (OpenSSH 개인키)",
    namePlaceholderImport: "예: imported-key",
    privateKeyPem: "개인키 PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "개인키 전체를 붙여넣으세요",
    passphrase: "패스프레이즈 (암호화된 키만)",
    importing: "가져오는 중...",
    publicKeyLabel: "공개키 (authorized_keys에 추가)",
    backToList: "← 목록",
    copied: "복사됨",
    copyPublicKey: "공개키 복사",
  },
  es: {
    title: "🔑 Gestor de claves SSH",
    close: "Cerrar",
    newKey: "+ Generar nueva clave",
    importBtn: "Importar",
    noKeys: "No hay claves registradas. Genera una nueva o importa una existente.",
    encrypted: " 🔒 cifrada",
    detail: "Detalles",
    delete: "Eliminar",
    confirmDelete: (name) =>
      `¿Eliminar la clave '${name}'? (La clave privada en el Keychain también se eliminará.)`,
    generateTitle: "Generar nueva clave",
    name: "Nombre",
    namePlaceholderGen: "p. ej. my-laptop",
    algorithm: "Algoritmo",
    ed25519Recommended: "ed25519 (recomendado)",
    cancel: "Cancelar",
    generating: "Generando...",
    generate: "Generar",
    importTitle: "Importar clave (clave privada OpenSSH)",
    namePlaceholderImport: "p. ej. imported-key",
    privateKeyPem: "Clave privada PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "Pega la clave privada completa",
    passphrase: "Frase de contraseña (solo claves cifradas)",
    importing: "Importando...",
    publicKeyLabel: "Clave pública (añadir a authorized_keys)",
    backToList: "← Lista",
    copied: "Copiado",
    copyPublicKey: "Copiar clave pública",
  },
  zh: {
    title: "🔑 SSH 密钥管理",
    close: "关闭",
    newKey: "+ 生成新密钥",
    importBtn: "导入",
    noKeys: "尚未注册密钥。请生成新密钥或导入现有密钥。",
    encrypted: " 🔒 已加密",
    detail: "详情",
    delete: "删除",
    confirmDelete: (name) =>
      `删除密钥 '${name}'？（Keychain 中的私钥也将被移除。）`,
    generateTitle: "生成新密钥",
    name: "名称",
    namePlaceholderGen: "例如 my-laptop",
    algorithm: "算法",
    ed25519Recommended: "ed25519（推荐）",
    cancel: "取消",
    generating: "生成中...",
    generate: "生成",
    importTitle: "导入密钥（OpenSSH 私钥）",
    namePlaceholderImport: "例如 imported-key",
    privateKeyPem: "私钥 PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "粘贴完整的私钥",
    passphrase: "口令（仅加密密钥）",
    importing: "导入中...",
    publicKeyLabel: "公钥（添加到 authorized_keys）",
    backToList: "← 列表",
    copied: "已复制",
    copyPublicKey: "复制公钥",
  },
  ja: {
    title: "🔑 SSH キー管理",
    close: "閉じる",
    newKey: "+ 新しいキーを生成",
    importBtn: "インポート",
    noKeys: "登録済みのキーがありません。新しいキーを生成するか、既存のキーをインポートしてください。",
    encrypted: " 🔒 暗号化",
    detail: "詳細",
    delete: "削除",
    confirmDelete: (name) =>
      `キー '${name}' を削除しますか？（Keychain の秘密鍵も削除されます。）`,
    generateTitle: "新しいキーを生成",
    name: "名前",
    namePlaceholderGen: "例: my-laptop",
    algorithm: "アルゴリズム",
    ed25519Recommended: "ed25519（推奨）",
    cancel: "キャンセル",
    generating: "生成中...",
    generate: "生成",
    importTitle: "キーをインポート（OpenSSH 秘密鍵）",
    namePlaceholderImport: "例: imported-key",
    privateKeyPem: "秘密鍵 PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "秘密鍵全体を貼り付けてください",
    passphrase: "パスフレーズ（暗号化キーのみ）",
    importing: "インポート中...",
    publicKeyLabel: "公開鍵（authorized_keys に追加）",
    backToList: "← 一覧",
    copied: "コピーしました",
    copyPublicKey: "公開鍵をコピー",
  },
  ru: {
    title: "🔑 Менеджер ключей SSH",
    close: "Закрыть",
    newKey: "+ Создать новый ключ",
    importBtn: "Импорт",
    noKeys: "Нет зарегистрированных ключей. Создайте новый ключ или импортируйте существующий.",
    encrypted: " 🔒 зашифрован",
    detail: "Подробности",
    delete: "Удалить",
    confirmDelete: (name) =>
      `Удалить ключ '${name}'? (Приватный ключ в Keychain также будет удалён.)`,
    generateTitle: "Создать новый ключ",
    name: "Имя",
    namePlaceholderGen: "напр. my-laptop",
    algorithm: "Алгоритм",
    ed25519Recommended: "ed25519 (рекомендуется)",
    cancel: "Отмена",
    generating: "Создание...",
    generate: "Создать",
    importTitle: "Импорт ключа (приватный ключ OpenSSH)",
    namePlaceholderImport: "напр. imported-key",
    privateKeyPem: "Приватный ключ PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "Вставьте приватный ключ целиком",
    passphrase: "Парольная фраза (только для зашифрованных ключей)",
    importing: "Импорт...",
    publicKeyLabel: "Публичный ключ (добавить в authorized_keys)",
    backToList: "← Список",
    copied: "Скопировано",
    copyPublicKey: "Копировать публичный ключ",
  },
  fr: {
    title: "🔑 Gestionnaire de clés SSH",
    close: "Fermer",
    newKey: "+ Générer une nouvelle clé",
    importBtn: "Importer",
    noKeys: "Aucune clé enregistrée. Générez une nouvelle clé ou importez-en une existante.",
    encrypted: " 🔒 chiffrée",
    detail: "Détails",
    delete: "Supprimer",
    confirmDelete: (name) =>
      `Supprimer la clé '${name}' ? (La clé privée dans le Keychain sera aussi supprimée.)`,
    generateTitle: "Générer une nouvelle clé",
    name: "Nom",
    namePlaceholderGen: "ex. my-laptop",
    algorithm: "Algorithme",
    ed25519Recommended: "ed25519 (recommandé)",
    cancel: "Annuler",
    generating: "Génération...",
    generate: "Générer",
    importTitle: "Importer une clé (clé privée OpenSSH)",
    namePlaceholderImport: "ex. imported-key",
    privateKeyPem: "Clé privée PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "Collez la clé privée complète",
    passphrase: "Phrase secrète (clés chiffrées uniquement)",
    importing: "Importation...",
    publicKeyLabel: "Clé publique (ajouter à authorized_keys)",
    backToList: "← Liste",
    copied: "Copié",
    copyPublicKey: "Copier la clé publique",
  },
  de: {
    title: "🔑 SSH-Schlüsselverwaltung",
    close: "Schließen",
    newKey: "+ Neuen Schlüssel erzeugen",
    importBtn: "Importieren",
    noKeys: "Keine Schlüssel registriert. Erzeugen Sie einen neuen oder importieren Sie einen vorhandenen.",
    encrypted: " 🔒 verschlüsselt",
    detail: "Details",
    delete: "Löschen",
    confirmDelete: (name) =>
      `Schlüssel '${name}' löschen? (Der private Schlüssel im Keychain wird ebenfalls entfernt.)`,
    generateTitle: "Neuen Schlüssel erzeugen",
    name: "Name",
    namePlaceholderGen: "z. B. my-laptop",
    algorithm: "Algorithmus",
    ed25519Recommended: "ed25519 (empfohlen)",
    cancel: "Abbrechen",
    generating: "Wird erzeugt...",
    generate: "Erzeugen",
    importTitle: "Schlüssel importieren (privater OpenSSH-Schlüssel)",
    namePlaceholderImport: "z. B. imported-key",
    privateKeyPem: "Privater Schlüssel PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "Fügen Sie den gesamten privaten Schlüssel ein",
    passphrase: "Passphrase (nur verschlüsselte Schlüssel)",
    importing: "Wird importiert...",
    publicKeyLabel: "Öffentlicher Schlüssel (zu authorized_keys hinzufügen)",
    backToList: "← Liste",
    copied: "Kopiert",
    copyPublicKey: "Öffentlichen Schlüssel kopieren",
  },
  vi: {
    title: "🔑 Trình quản lý khóa SSH",
    close: "Đóng",
    newKey: "+ Tạo khóa mới",
    importBtn: "Nhập",
    noKeys: "Chưa có khóa nào. Hãy tạo khóa mới hoặc nhập khóa có sẵn.",
    encrypted: " 🔒 đã mã hóa",
    detail: "Chi tiết",
    delete: "Xóa",
    confirmDelete: (name) =>
      `Xóa khóa '${name}'? (Khóa riêng trong Keychain cũng sẽ bị xóa.)`,
    generateTitle: "Tạo khóa mới",
    name: "Tên",
    namePlaceholderGen: "vd. my-laptop",
    algorithm: "Thuật toán",
    ed25519Recommended: "ed25519 (khuyến nghị)",
    cancel: "Hủy",
    generating: "Đang tạo...",
    generate: "Tạo",
    importTitle: "Nhập khóa (khóa riêng OpenSSH)",
    namePlaceholderImport: "vd. imported-key",
    privateKeyPem: "Khóa riêng PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "Dán toàn bộ khóa riêng",
    passphrase: "Cụm mật khẩu (chỉ với khóa đã mã hóa)",
    importing: "Đang nhập...",
    publicKeyLabel: "Khóa công khai (thêm vào authorized_keys)",
    backToList: "← Danh sách",
    copied: "Đã sao chép",
    copyPublicKey: "Sao chép khóa công khai",
  },
  id: {
    title: "🔑 Pengelola Kunci SSH",
    close: "Tutup",
    newKey: "+ Buat kunci baru",
    importBtn: "Impor",
    noKeys: "Belum ada kunci terdaftar. Buat kunci baru atau impor kunci yang ada.",
    encrypted: " 🔒 terenkripsi",
    detail: "Detail",
    delete: "Hapus",
    confirmDelete: (name) =>
      `Hapus kunci '${name}'? (Kunci privat di Keychain juga akan dihapus.)`,
    generateTitle: "Buat kunci baru",
    name: "Nama",
    namePlaceholderGen: "mis. my-laptop",
    algorithm: "Algoritma",
    ed25519Recommended: "ed25519 (disarankan)",
    cancel: "Batal",
    generating: "Membuat...",
    generate: "Buat",
    importTitle: "Impor kunci (kunci privat OpenSSH)",
    namePlaceholderImport: "mis. imported-key",
    privateKeyPem: "Kunci privat PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "Tempel seluruh kunci privat",
    passphrase: "Frasa sandi (hanya kunci terenkripsi)",
    importing: "Mengimpor...",
    publicKeyLabel: "Kunci publik (tambahkan ke authorized_keys)",
    backToList: "← Daftar",
    copied: "Tersalin",
    copyPublicKey: "Salin kunci publik",
  },
  hi: {
    title: "🔑 SSH कुंजी प्रबंधक",
    close: "बंद करें",
    newKey: "+ नई कुंजी बनाएं",
    importBtn: "आयात",
    noKeys: "कोई कुंजी पंजीकृत नहीं है। नई कुंजी बनाएं या मौजूदा कुंजी आयात करें।",
    encrypted: " 🔒 एन्क्रिप्टेड",
    detail: "विवरण",
    delete: "हटाएं",
    confirmDelete: (name) =>
      `कुंजी '${name}' हटाएं? (Keychain की निजी कुंजी भी हटा दी जाएगी।)`,
    generateTitle: "नई कुंजी बनाएं",
    name: "नाम",
    namePlaceholderGen: "जैसे my-laptop",
    algorithm: "एल्गोरिदम",
    ed25519Recommended: "ed25519 (अनुशंसित)",
    cancel: "रद्द करें",
    generating: "बना रहे हैं...",
    generate: "बनाएं",
    importTitle: "कुंजी आयात करें (OpenSSH निजी कुंजी)",
    namePlaceholderImport: "जैसे imported-key",
    privateKeyPem: "निजी कुंजी PEM (-----BEGIN OPENSSH PRIVATE KEY-----)",
    pemPlaceholder: "पूरी निजी कुंजी चिपकाएं",
    passphrase: "पासफ़्रेज़ (केवल एन्क्रिप्टेड कुंजियों के लिए)",
    importing: "आयात हो रहा है...",
    publicKeyLabel: "सार्वजनिक कुंजी (authorized_keys में जोड़ें)",
    backToList: "← सूची",
    copied: "कॉपी किया गया",
    copyPublicKey: "सार्वजनिक कुंजी कॉपी करें",
  },
};

export function SshKeyManager({ onClose, onChanged }: Props) {
  const t = useT(STR);
  const [keys, setKeys] = useState<SshKeyEntry[]>([]);
  const [mode, setMode] = useState<Mode>("list");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setKeys(await invoke<SshKeyEntry[]>("ssh_list_keys"));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function remove(id: string, name: string) {
    if (!confirm(t.confirmDelete(name))) return;
    try {
      await invoke("ssh_delete_key", { id });
      await reload();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle} role="dialog" aria-modal="true">
        <header style={headerStyle}>
          <strong style={{ fontSize: 15 }}>{t.title}</strong>
          <button onClick={onClose} style={iconBtnStyle} title={t.close}>×</button>
        </header>

        {error && (
          <div style={{ color: "#fdd", fontSize: 12 }}>
            {error} <button onClick={() => setError(null)} style={iconBtnStyle}>×</button>
          </div>
        )}

        {mode === "list" && (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setMode("generate")} style={primaryBtnStyle}>{t.newKey}</button>
              <button onClick={() => setMode("import")} style={btnStyle}>{t.importBtn}</button>
            </div>
            {keys.length === 0 ? (
              <div style={{ color: "#789", textAlign: "center", padding: 24 }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>🔑</div>
                {t.noKeys}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
                {keys.map((k) => (
                  <div key={k.id} style={rowCardStyle}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {k.name}{" "}
                        <span style={{ fontSize: 10, color: "#789" }}>{k.algorithm}</span>
                        {k.encrypted && <span style={{ fontSize: 10, color: "#fa8" }}>{t.encrypted}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "#789", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {k.fingerprint}
                      </div>
                    </div>
                    <button onClick={() => setMode({ detail: k })} style={iconBtnStyle} title={t.detail}>ℹ</button>
                    <button onClick={() => void remove(k.id, k.name)} style={iconBtnStyle} title={t.delete}>×</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {mode === "generate" && (
          <GenerateForm
            onCancel={() => setMode("list")}
            onDone={async () => {
              setMode("list");
              await reload();
              onChanged?.();
            }}
            onError={setError}
          />
        )}

        {mode === "import" && (
          <ImportForm
            onCancel={() => setMode("list")}
            onDone={async () => {
              setMode("list");
              await reload();
              onChanged?.();
            }}
            onError={setError}
          />
        )}

        {typeof mode === "object" && "detail" in mode && (
          <KeyDetail entry={mode.detail} onBack={() => setMode("list")} />
        )}
      </div>
    </div>
  );
}

function GenerateForm({
  onCancel,
  onDone,
  onError,
}: {
  onCancel: () => void;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const t = useT(STR);
  const [name, setName] = useState("");
  const [algorithm, setAlgorithm] = useState("ed25519");
  const [busy, setBusy] = useState(false);
  return (
    <div style={formStyle}>
      <h4 style={{ margin: 0, fontSize: 13 }}>{t.generateTitle}</h4>
      <Field label={t.name}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholderGen} style={inputStyle} />
      </Field>
      <Field label={t.algorithm}>
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} style={inputStyle}>
          <option value="ed25519">{t.ed25519Recommended}</option>
          <option value="rsa">RSA</option>
        </select>
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={btnStyle}>{t.cancel}</button>
        <button
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await invoke("ssh_generate_key", { args: { name: name.trim(), algorithm } });
              onDone();
            } catch (e) {
              onError(String(e));
            } finally {
              setBusy(false);
            }
          }}
          style={primaryBtnStyle}
        >
          {busy ? t.generating : t.generate}
        </button>
      </div>
    </div>
  );
}

function ImportForm({
  onCancel,
  onDone,
  onError,
}: {
  onCancel: () => void;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const t = useT(STR);
  const [name, setName] = useState("");
  const [pem, setPem] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div style={formStyle}>
      <h4 style={{ margin: 0, fontSize: 13 }}>{t.importTitle}</h4>
      <Field label={t.name}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholderImport} style={inputStyle} />
      </Field>
      <Field label={t.privateKeyPem}>
        <textarea
          value={pem}
          onChange={(e) => setPem(e.target.value)}
          rows={6}
          placeholder={t.pemPlaceholder}
          style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
        />
      </Field>
      <Field label={t.passphrase}>
        <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} style={inputStyle} />
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={btnStyle}>{t.cancel}</button>
        <button
          disabled={busy || !name.trim() || !pem.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await invoke("ssh_import_key", {
                args: { name: name.trim(), pem, passphrase: passphrase || null },
              });
              onDone();
            } catch (e) {
              onError(String(e));
            } finally {
              setBusy(false);
            }
          }}
          style={primaryBtnStyle}
        >
          {busy ? t.importing : t.importBtn}
        </button>
      </div>
    </div>
  );
}

function KeyDetail({ entry, onBack }: { entry: SshKeyEntry; onBack: () => void }) {
  const t = useT(STR);
  const [copied, setCopied] = useState(false);
  return (
    <div style={formStyle}>
      <h4 style={{ margin: 0, fontSize: 13 }}>{entry.name}</h4>
      <div style={{ fontSize: 12, color: "#9aa" }}>
        {entry.algorithm} · {entry.fingerprint}
      </div>
      <Field label={t.publicKeyLabel}>
        <textarea
          readOnly
          value={entry.public_key}
          rows={4}
          style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
        />
      </Field>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onBack} style={btnStyle}>{t.backToList}</button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(entry.public_key);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          style={primaryBtnStyle}
        >
          {copied ? t.copied : t.copyPublicKey}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "#aaa", fontSize: 11 }}>{label}</span>
      {children}
    </label>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
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
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
const formStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const rowCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #333",
  borderRadius: 4,
  padding: "8px 10px",
};
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
  fontSize: 15,
  padding: "0 4px",
};
