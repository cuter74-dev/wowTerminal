import { useEffect, useRef, useState } from "react";
import { LangDict, useT } from "../i18n";

export interface PasswordPromptInfo {
  host: string;
  port: number;
  user: string;
}

interface Props {
  info: PasswordPromptInfo;
  onCancel: () => void;
  onSubmit: (password: string, remember: boolean) => void;
}

const STR: LangDict<{
    title: string;
    connectingLabel: string;
    notStoredNote: string;
    placeholder: string;
    rememberNote: string;
    cancel: string;
    connect: string;
  }
> = {
  en: {
    title: "Enter password",
    connectingLabel: "Connecting:",
    notStoredNote:
      "Used in memory only and not saved. You'll re-enter it on each connection.",
    placeholder: "password",
    rememberNote: "Save to OS Keychain — auto-authenticate on next connection",
    cancel: "Cancel",
    connect: "Connect",
  },
  ko: {
    title: "Password 입력",
    connectingLabel: "접속:",
    notStoredNote:
      "메모리에서만 사용되며 저장되지 않습니다. 매 접속마다 다시 입력합니다.",
    placeholder: "password",
    rememberNote: "OS Keychain에 저장 — 다음 접속부터 자동 인증",
    cancel: "취소",
    connect: "접속",
  },
  es: {
    title: "Introduce la contraseña",
    connectingLabel: "Conectando:",
    notStoredNote:
      "Se usa solo en memoria y no se guarda. La introducirás de nuevo en cada conexión.",
    placeholder: "password",
    rememberNote: "Guardar en el Keychain del SO — autenticación automática en la próxima conexión",
    cancel: "Cancelar",
    connect: "Conectar",
  },
  zh: {
    title: "输入密码",
    connectingLabel: "连接：",
    notStoredNote:
      "仅在内存中使用，不会保存。每次连接都需要重新输入。",
    placeholder: "password",
    rememberNote: "保存到操作系统 Keychain — 下次连接自动认证",
    cancel: "取消",
    connect: "连接",
  },
  ja: {
    title: "パスワードを入力",
    connectingLabel: "接続:",
    notStoredNote:
      "メモリ内でのみ使用され、保存されません。接続ごとに再入力が必要です。",
    placeholder: "password",
    rememberNote: "OS の Keychain に保存 — 次回の接続から自動認証",
    cancel: "キャンセル",
    connect: "接続",
  },
  ru: {
    title: "Введите пароль",
    connectingLabel: "Подключение:",
    notStoredNote:
      "Используется только в памяти и не сохраняется. Его придётся вводить при каждом подключении.",
    placeholder: "password",
    rememberNote: "Сохранить в Keychain ОС — автоматическая аутентификация при следующем подключении",
    cancel: "Отмена",
    connect: "Подключиться",
  },
  fr: {
    title: "Saisissez le mot de passe",
    connectingLabel: "Connexion :",
    notStoredNote:
      "Utilisé uniquement en mémoire et non enregistré. Vous le ressaisirez à chaque connexion.",
    placeholder: "password",
    rememberNote: "Enregistrer dans le Keychain du système — authentification automatique à la prochaine connexion",
    cancel: "Annuler",
    connect: "Connecter",
  },
  de: {
    title: "Passwort eingeben",
    connectingLabel: "Verbinde:",
    notStoredNote:
      "Wird nur im Speicher verwendet und nicht gespeichert. Du gibst es bei jeder Verbindung erneut ein.",
    placeholder: "password",
    rememberNote: "Im Keychain des Betriebssystems speichern — automatische Authentifizierung bei der nächsten Verbindung",
    cancel: "Abbrechen",
    connect: "Verbinden",
  },
  vi: {
    title: "Nhập mật khẩu",
    connectingLabel: "Đang kết nối:",
    notStoredNote:
      "Chỉ dùng trong bộ nhớ và không được lưu. Bạn sẽ nhập lại mỗi lần kết nối.",
    placeholder: "password",
    rememberNote: "Lưu vào Keychain của hệ điều hành — tự động xác thực ở lần kết nối tiếp theo",
    cancel: "Hủy",
    connect: "Kết nối",
  },
  id: {
    title: "Masukkan kata sandi",
    connectingLabel: "Menghubungkan:",
    notStoredNote:
      "Hanya digunakan di memori dan tidak disimpan. Anda akan memasukkannya lagi pada setiap koneksi.",
    placeholder: "password",
    rememberNote: "Simpan ke Keychain OS — autentikasi otomatis pada koneksi berikutnya",
    cancel: "Batal",
    connect: "Hubungkan",
  },
  hi: {
    title: "पासवर्ड दर्ज करें",
    connectingLabel: "कनेक्ट हो रहा है:",
    notStoredNote:
      "केवल मेमोरी में उपयोग होता है और सहेजा नहीं जाता। आपको हर कनेक्शन पर इसे फिर से दर्ज करना होगा।",
    placeholder: "password",
    rememberNote: "OS Keychain में सहेजें — अगले कनेक्शन से स्वतः प्रमाणीकरण",
    cancel: "रद्द करें",
    connect: "कनेक्ट करें",
  },
};

export function PasswordPromptModal({ info, onCancel, onSubmit }: Props) {
  const t = useT(STR);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (password) onSubmit(password, remember);
        }}
        style={{
          width: 420,
          maxWidth: "90vw",
          background: "#262630",
          border: "1px solid #4a9eff",
          borderRadius: 6,
          color: "#e6e6e6",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          padding: 20,
          fontSize: 13,
        }}
        role="dialog"
        aria-modal="true"
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 22 }}>🔐</span>
          <strong style={{ fontSize: 15 }}>{t.title}</strong>
        </header>

        <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
          <span style={{ color: "#9aa" }}>{t.connectingLabel}</span>{" "}
          <code style={{ color: "#fff" }}>
            {info.user}@{info.host}:{info.port}
          </code>
          <div style={{ fontSize: 11, color: "#789", marginTop: 4 }}>
            {t.notStoredNote}
          </div>
        </div>

        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t.placeholder}
          autoComplete="current-password"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#101015",
            border: "1px solid #4a9eff",
            color: "#fff",
            padding: "8px 10px",
            borderRadius: 4,
            fontSize: 13,
            outline: "none",
            marginBottom: 10,
          }}
        />

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 14,
            fontSize: 12,
            color: "#ccc",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>{t.rememberNote}</span>
        </label>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 14px",
              background: "transparent",
              color: "#ccc",
              border: "1px solid #444",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            disabled={!password}
            style={{
              padding: "8px 14px",
              background: password ? "#0a5380" : "#2a2a35",
              color: "#fff",
              border: `1px solid ${password ? "#4a9eff" : "#444"}`,
              borderRadius: 4,
              cursor: password ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {t.connect}
          </button>
        </footer>
      </form>
    </div>
  );
}
