import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, SshAuthMethod, SshHost, SshKeyEntry, Tag } from "../types";
import { LangDict, useT } from "../i18n";

interface Props {
  initial: SshHost | null;
  onCancel: () => void;
  onSaved: () => void;
}

type AuthKind = "agent" | "password" | "password_prompt" | "private_key";

const STR: LangDict<{
    requiredFields: string;
    passwordSecretRequired: string;
    keyIdRequired: string;
    editHost: string;
    newHost: string;
    hostPlaceholder: string;
    authAgent: string;
    authPasswordPrompt: string;
    authPasswordStore: string;
    authPrivateKey: string;
    passwordSecretPlaceholder: string;
    privateKeyLabel: string;
    selectKey: string;
    noKeyPlaceholder: string;
    passphrasePlaceholder: string;
    ungrouped: string;
    proxyJump: string;
    proxyDirect: string;
    noTags: string;
    cancel: string;
    saving: string;
    save: string;
  }
> = {
  en: {
    requiredFields: "name / host / user are required.",
    passwordSecretRequired: "password secret id is required.",
    keyIdRequired: "key id is required.",
    editHost: "Edit Host",
    newHost: "New Host",
    hostPlaceholder: "192.168.1.10 or example.com",
    authAgent: "SSH Agent (delegated)",
    authPasswordPrompt: "Password (prompt on connect)",
    authPasswordStore: "Password (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "ID registered in secret store",
    privateKeyLabel: "Private Key (register in 🔑 Key Manager)",
    selectKey: "Select a key...",
    noKeyPlaceholder: "No registered keys — enter a key ID or create one in 🔑",
    passphrasePlaceholder: "passphrase secret_id for the encrypted key",
    ungrouped: "(Ungrouped)",
    proxyJump: "Jump host (ProxyJump)",
    proxyDirect: "(Direct — no jump)",
    noTags: "No tags registered — add them via Group/Tag Manager in the sidebar",
    cancel: "Cancel",
    saving: "Saving...",
    save: "Save",
  },
  ko: {
    requiredFields: "name / host / user는 필수입니다.",
    passwordSecretRequired: "password secret id가 필요합니다.",
    keyIdRequired: "key id가 필요합니다.",
    editHost: "호스트 편집",
    newHost: "새 호스트",
    hostPlaceholder: "192.168.1.10 또는 example.com",
    authAgent: "SSH Agent (위임)",
    authPasswordPrompt: "Password (접속 시 입력)",
    authPasswordStore: "Password (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "secret store에 등록된 ID",
    privateKeyLabel: "Private Key (🔑 키 관리에서 등록)",
    selectKey: "키 선택...",
    noKeyPlaceholder: "등록된 키 없음 — 키 ID 직접 입력 또는 🔑에서 생성",
    passphrasePlaceholder: "암호화된 키의 패스프레이즈 secret_id",
    ungrouped: "(미분류)",
    proxyJump: "점프 호스트 (ProxyJump)",
    proxyDirect: "(직접 — 점프 없음)",
    noTags: "등록된 태그 없음 — 사이드바의 그룹/태그 관리로 추가",
    cancel: "취소",
    saving: "저장 중...",
    save: "저장",
  },
  es: {
    requiredFields: "name / host / user son obligatorios.",
    passwordSecretRequired: "Se requiere el id del secreto de contraseña.",
    keyIdRequired: "Se requiere el id de la clave.",
    editHost: "Editar host",
    newHost: "Nuevo host",
    hostPlaceholder: "192.168.1.10 o example.com",
    authAgent: "SSH Agent (delegado)",
    authPasswordPrompt: "Contraseña (solicitar al conectar)",
    authPasswordStore: "Contraseña (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "ID registrado en el secret store",
    privateKeyLabel: "Private Key (regístrala en 🔑 Gestor de claves)",
    selectKey: "Selecciona una clave...",
    noKeyPlaceholder: "Sin claves registradas — ingresa un ID de clave o crea una en 🔑",
    passphrasePlaceholder: "secret_id de la passphrase para la clave cifrada",
    ungrouped: "(Sin grupo)",
    proxyJump: "Host de salto (ProxyJump)",
    proxyDirect: "(Directo — sin salto)",
    noTags: "No hay etiquetas registradas — agrégalas con el Gestor de grupos/etiquetas en la barra lateral",
    cancel: "Cancelar",
    saving: "Guardando...",
    save: "Guardar",
  },
  zh: {
    requiredFields: "name / host / user 为必填项。",
    passwordSecretRequired: "需要密码 secret id。",
    keyIdRequired: "需要 key id。",
    editHost: "编辑主机",
    newHost: "新建主机",
    hostPlaceholder: "192.168.1.10 或 example.com",
    authAgent: "SSH Agent (委托)",
    authPasswordPrompt: "密码 (连接时输入)",
    authPasswordStore: "密码 (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "在 secret store 中注册的 ID",
    privateKeyLabel: "Private Key (在 🔑 密钥管理器中注册)",
    selectKey: "选择一个密钥...",
    noKeyPlaceholder: "没有已注册的密钥 — 直接输入 key ID 或在 🔑 中创建",
    passphrasePlaceholder: "加密密钥的 passphrase secret_id",
    ungrouped: "(未分组)",
    proxyJump: "跳板主机 (ProxyJump)",
    proxyDirect: "(直连 — 无跳板)",
    noTags: "没有已注册的标签 — 通过侧边栏的分组/标签管理器添加",
    cancel: "取消",
    saving: "保存中...",
    save: "保存",
  },
  ja: {
    requiredFields: "name / host / user は必須です。",
    passwordSecretRequired: "password secret id が必要です。",
    keyIdRequired: "key id が必要です。",
    editHost: "ホストを編集",
    newHost: "新規ホスト",
    hostPlaceholder: "192.168.1.10 または example.com",
    authAgent: "SSH Agent (委任)",
    authPasswordPrompt: "パスワード (接続時に入力)",
    authPasswordStore: "パスワード (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "secret store に登録された ID",
    privateKeyLabel: "Private Key (🔑 キー管理で登録)",
    selectKey: "キーを選択...",
    noKeyPlaceholder: "登録済みのキーなし — key ID を直接入力するか 🔑 で作成",
    passphrasePlaceholder: "暗号化キーの passphrase secret_id",
    ungrouped: "(未分類)",
    proxyJump: "踏み台ホスト (ProxyJump)",
    proxyDirect: "(直接 — 踏み台なし)",
    noTags: "登録済みのタグなし — サイドバーのグループ/タグ管理から追加",
    cancel: "キャンセル",
    saving: "保存中...",
    save: "保存",
  },
  ru: {
    requiredFields: "Поля name / host / user обязательны.",
    passwordSecretRequired: "Требуется id секрета пароля.",
    keyIdRequired: "Требуется id ключа.",
    editHost: "Изменить хост",
    newHost: "Новый хост",
    hostPlaceholder: "192.168.1.10 или example.com",
    authAgent: "SSH Agent (делегирование)",
    authPasswordPrompt: "Пароль (запрос при подключении)",
    authPasswordStore: "Пароль (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "ID, зарегистрированный в secret store",
    privateKeyLabel: "Private Key (зарегистрируйте в 🔑 Менеджере ключей)",
    selectKey: "Выберите ключ...",
    noKeyPlaceholder: "Нет зарегистрированных ключей — введите ID ключа или создайте его в 🔑",
    passphrasePlaceholder: "secret_id парольной фразы для зашифрованного ключа",
    ungrouped: "(Без группы)",
    proxyJump: "Прыжковый хост (ProxyJump)",
    proxyDirect: "(Прямое — без прыжка)",
    noTags: "Нет зарегистрированных тегов — добавьте их в Менеджере групп/тегов на боковой панели",
    cancel: "Отмена",
    saving: "Сохранение...",
    save: "Сохранить",
  },
  fr: {
    requiredFields: "name / host / user sont obligatoires.",
    passwordSecretRequired: "L'id du secret de mot de passe est requis.",
    keyIdRequired: "L'id de la clé est requis.",
    editHost: "Modifier l'hôte",
    newHost: "Nouvel hôte",
    hostPlaceholder: "192.168.1.10 ou example.com",
    authAgent: "SSH Agent (délégué)",
    authPasswordPrompt: "Mot de passe (demandé à la connexion)",
    authPasswordStore: "Mot de passe (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "ID enregistré dans le secret store",
    privateKeyLabel: "Private Key (enregistrez-la dans le 🔑 Gestionnaire de clés)",
    selectKey: "Sélectionnez une clé...",
    noKeyPlaceholder: "Aucune clé enregistrée — saisissez un ID de clé ou créez-en une dans 🔑",
    passphrasePlaceholder: "secret_id de la passphrase pour la clé chiffrée",
    ungrouped: "(Sans groupe)",
    proxyJump: "Hôte de rebond (ProxyJump)",
    proxyDirect: "(Direct — sans rebond)",
    noTags: "Aucune étiquette enregistrée — ajoutez-les via le Gestionnaire de groupes/étiquettes dans la barre latérale",
    cancel: "Annuler",
    saving: "Enregistrement...",
    save: "Enregistrer",
  },
  de: {
    requiredFields: "name / host / user sind erforderlich.",
    passwordSecretRequired: "Die Passwort-Secret-ID ist erforderlich.",
    keyIdRequired: "Die Schlüssel-ID ist erforderlich.",
    editHost: "Host bearbeiten",
    newHost: "Neuer Host",
    hostPlaceholder: "192.168.1.10 oder example.com",
    authAgent: "SSH Agent (delegiert)",
    authPasswordPrompt: "Passwort (Abfrage beim Verbinden)",
    authPasswordStore: "Passwort (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "Im Secret Store registrierte ID",
    privateKeyLabel: "Private Key (im 🔑 Schlüsselverwaltung registrieren)",
    selectKey: "Schlüssel auswählen...",
    noKeyPlaceholder: "Keine registrierten Schlüssel — Schlüssel-ID eingeben oder in 🔑 erstellen",
    passphrasePlaceholder: "passphrase secret_id für den verschlüsselten Schlüssel",
    ungrouped: "(Ohne Gruppe)",
    proxyJump: "Sprung-Host (ProxyJump)",
    proxyDirect: "(Direkt — kein Sprung)",
    noTags: "Keine Tags registriert — füge sie über die Gruppen-/Tag-Verwaltung in der Seitenleiste hinzu",
    cancel: "Abbrechen",
    saving: "Wird gespeichert...",
    save: "Speichern",
  },
  vi: {
    requiredFields: "name / host / user là bắt buộc.",
    passwordSecretRequired: "Cần có id secret mật khẩu.",
    keyIdRequired: "Cần có key id.",
    editHost: "Chỉnh sửa host",
    newHost: "Host mới",
    hostPlaceholder: "192.168.1.10 hoặc example.com",
    authAgent: "SSH Agent (ủy quyền)",
    authPasswordPrompt: "Mật khẩu (nhập khi kết nối)",
    authPasswordStore: "Mật khẩu (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "ID đã đăng ký trong secret store",
    privateKeyLabel: "Private Key (đăng ký trong 🔑 Trình quản lý khóa)",
    selectKey: "Chọn một khóa...",
    noKeyPlaceholder: "Không có khóa đã đăng ký — nhập ID khóa hoặc tạo một khóa trong 🔑",
    passphrasePlaceholder: "secret_id của passphrase cho khóa đã mã hóa",
    ungrouped: "(Chưa phân nhóm)",
    proxyJump: "Máy chủ nhảy (ProxyJump)",
    proxyDirect: "(Trực tiếp — không nhảy)",
    noTags: "Không có thẻ nào được đăng ký — thêm chúng qua Trình quản lý nhóm/thẻ ở thanh bên",
    cancel: "Hủy",
    saving: "Đang lưu...",
    save: "Lưu",
  },
  id: {
    requiredFields: "name / host / user wajib diisi.",
    passwordSecretRequired: "ID secret kata sandi wajib diisi.",
    keyIdRequired: "ID kunci wajib diisi.",
    editHost: "Edit host",
    newHost: "Host baru",
    hostPlaceholder: "192.168.1.10 atau example.com",
    authAgent: "SSH Agent (didelegasikan)",
    authPasswordPrompt: "Kata sandi (minta saat menyambung)",
    authPasswordStore: "Kata sandi (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "ID yang terdaftar di secret store",
    privateKeyLabel: "Private Key (daftarkan di 🔑 Pengelola kunci)",
    selectKey: "Pilih kunci...",
    noKeyPlaceholder: "Tidak ada kunci terdaftar — masukkan ID kunci atau buat di 🔑",
    passphrasePlaceholder: "secret_id passphrase untuk kunci terenkripsi",
    ungrouped: "(Tanpa grup)",
    proxyJump: "Host lompat (ProxyJump)",
    proxyDirect: "(Langsung — tanpa lompat)",
    noTags: "Tidak ada tag terdaftar — tambahkan melalui Pengelola grup/tag di bilah sisi",
    cancel: "Batal",
    saving: "Menyimpan...",
    save: "Simpan",
  },
  hi: {
    requiredFields: "name / host / user आवश्यक हैं।",
    passwordSecretRequired: "पासवर्ड secret id आवश्यक है।",
    keyIdRequired: "key id आवश्यक है।",
    editHost: "होस्ट संपादित करें",
    newHost: "नया होस्ट",
    hostPlaceholder: "192.168.1.10 या example.com",
    authAgent: "SSH Agent (सौंपा गया)",
    authPasswordPrompt: "पासवर्ड (कनेक्ट करते समय पूछें)",
    authPasswordStore: "पासवर्ड (Secret Store)",
    authPrivateKey: "Private Key",
    passwordSecretPlaceholder: "secret store में पंजीकृत ID",
    privateKeyLabel: "Private Key (🔑 कुंजी प्रबंधक में पंजीकृत करें)",
    selectKey: "एक कुंजी चुनें...",
    noKeyPlaceholder: "कोई पंजीकृत कुंजी नहीं — key ID दर्ज करें या 🔑 में एक बनाएं",
    passphrasePlaceholder: "एन्क्रिप्टेड कुंजी के लिए passphrase secret_id",
    ungrouped: "(समूह रहित)",
    proxyJump: "जंप होस्ट (ProxyJump)",
    proxyDirect: "(सीधा — कोई जंप नहीं)",
    noTags: "कोई टैग पंजीकृत नहीं — साइडबार में समूह/टैग प्रबंधक के माध्यम से जोड़ें",
    cancel: "रद्द करें",
    saving: "सहेजा जा रहा है...",
    save: "सहेजें",
  },
};

export function HostForm({ initial, onCancel, onSaved }: Props) {
  const t = useT(STR);
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? 22);
  const [user, setUser] = useState(initial?.user ?? "");
  const [authKind, setAuthKind] = useState<AuthKind>(
    initial ? initial.auth.type : "agent",
  );
  const [secretId, setSecretId] = useState(
    initial?.auth.type === "password"
      ? initial.auth.secret_id
      : initial?.auth.type === "private_key"
        ? initial.auth.key_id
        : "",
  );
  const [passphraseSecretId, setPassphraseSecretId] = useState(
    initial?.auth.type === "private_key"
      ? (initial.auth.passphrase_secret_id ?? "")
      : "",
  );
  const [groupId, setGroupId] = useState<string | null>(initial?.group_id ?? null);
  const [proxyJump, setProxyJump] = useState<string | null>(
    initial?.proxy_jump ?? null,
  );
  const [hostTags, setHostTags] = useState<string[]>(initial?.tags ?? []);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [allHosts, setAllHosts] = useState<SshHost[]>([]);
  const [sshKeys, setSshKeys] = useState<SshKeyEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [g, t, k, h] = await Promise.all([
          invoke<Group[]>("ssh_list_groups"),
          invoke<Tag[]>("ssh_list_tags"),
          invoke<SshKeyEntry[]>("ssh_list_keys"),
          invoke<SshHost[]>("ssh_list_hosts"),
        ]);
        setGroups(g);
        setTags(t);
        setSshKeys(k);
        setAllHosts(h);
      } catch (e) {
        // 비치명적
        console.error("load groups/tags failed", e);
      }
    })();
  }, []);

  function toggleTag(name: string) {
    setHostTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  async function handleSave() {
    setError(null);
    if (!name || !host || !user) {
      setError(t.requiredFields);
      return;
    }
    let auth: SshAuthMethod;
    if (authKind === "agent") {
      auth = { type: "agent" };
    } else if (authKind === "password_prompt") {
      auth = { type: "password_prompt" };
    } else if (authKind === "password") {
      if (!secretId) {
        setError(t.passwordSecretRequired);
        return;
      }
      auth = { type: "password", secret_id: secretId };
    } else {
      if (!secretId) {
        setError(t.keyIdRequired);
        return;
      }
      auth = {
        type: "private_key",
        key_id: secretId,
        passphrase_secret_id: passphraseSecretId || null,
      };
    }

    const id = initial?.id ?? crypto.randomUUID();
    const payload: SshHost = {
      id,
      name,
      host,
      port,
      user,
      auth,
      tags: hostTags,
      group_id: groupId,
      proxy_jump: proxyJump,
    };

    try {
      setSaving(true);
      await invoke("ssh_save_host", { host: payload });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 100,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxHeight: "92vh",
          overflowY: "auto",
          background: "#2d2d30",
          color: "#cccccc",
          padding: 20,
          borderRadius: 6,
          border: "1px solid #444",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>
          {initial ? t.editHost : t.newHost}
        </h3>

        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            placeholder="prod-web-1"
          />
        </Field>

        <Field label="Host">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            style={inputStyle}
            placeholder={t.hostPlaceholder}
          />
        </Field>

        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Port" flex={1}>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value || "22", 10))}
              style={inputStyle}
            />
          </Field>
          <Field label="User" flex={2}>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              style={inputStyle}
              placeholder="root"
            />
          </Field>
        </div>

        <Field label="Auth">
          <select
            value={authKind}
            onChange={(e) => setAuthKind(e.target.value as AuthKind)}
            style={inputStyle}
          >
            <option value="agent">{t.authAgent}</option>
            <option value="password_prompt">{t.authPasswordPrompt}</option>
            <option value="password">{t.authPasswordStore}</option>
            <option value="private_key">{t.authPrivateKey}</option>
          </select>
        </Field>

        {authKind === "password" && (
          <Field label="Password Secret ID">
            <input
              value={secretId}
              onChange={(e) => setSecretId(e.target.value)}
              style={inputStyle}
              placeholder={t.passwordSecretPlaceholder}
            />
          </Field>
        )}

        {authKind === "private_key" && (
          <>
            <Field label={t.privateKeyLabel}>
              {sshKeys.length > 0 ? (
                <select
                  value={secretId}
                  onChange={(e) => setSecretId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">{t.selectKey}</option>
                  {sshKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.algorithm})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={secretId}
                  onChange={(e) => setSecretId(e.target.value)}
                  style={inputStyle}
                  placeholder={t.noKeyPlaceholder}
                />
              )}
            </Field>
            <Field label="Passphrase Secret ID (optional)">
              <input
                value={passphraseSecretId}
                onChange={(e) => setPassphraseSecretId(e.target.value)}
                style={inputStyle}
                placeholder={t.passphrasePlaceholder}
              />
            </Field>
          </>
        )}

        <Field label="Group">
          <select
            value={groupId ?? ""}
            onChange={(e) =>
              setGroupId(e.target.value === "" ? null : e.target.value)
            }
            style={inputStyle}
          >
            <option value="">{t.ungrouped}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t.proxyJump}>
          <select
            value={proxyJump ?? ""}
            onChange={(e) =>
              setProxyJump(e.target.value === "" ? null : e.target.value)
            }
            style={inputStyle}
          >
            <option value="">{t.proxyDirect}</option>
            {allHosts
              .filter((h) => h.id !== initial?.id)
              .map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.user}@{h.host})
                </option>
              ))}
          </select>
        </Field>

        <Field label="Tags">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tags.length === 0 && (
              <span style={{ color: "#666", fontSize: 11 }}>
                {t.noTags}
              </span>
            )}
            {tags.map((t) => {
              const active = hostTags.includes(t.name);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.name)}
                  style={{
                    background: active ? t.color : "transparent",
                    color: active ? "#fff" : t.color,
                    border: `1px solid ${t.color}`,
                    borderRadius: 12,
                    padding: "2px 10px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  #{t.name}
                </button>
              );
            })}
          </div>
        </Field>

        {error && (
          <div style={{ color: "#fdd", fontSize: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={btnStyle}>
            {t.cancel}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            style={{ ...btnStyle, background: "#094771", color: "#fff" }}
          >
            {saving ? t.saving : t.save}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  flex,
}: {
  label: string;
  children: React.ReactNode;
  flex?: number;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 12,
        flex,
      }}
    >
      <span style={{ color: "#aaa" }}>{label}</span>
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
  fontSize: 13,
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
  fontSize: 13,
};
