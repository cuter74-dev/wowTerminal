import { LangDict, useT } from "../i18n";

export interface ConnErrorInfo {
  label: string;
  message: string;
}

interface Props {
  info: ConnErrorInfo;
  onRetry: () => void;
  onClose: () => void;
}

const STR: LangDict<{
    hintDefault: string;
    hintNetwork: string;
    hintAuth: string;
    hintTimeout: string;
    hintRefused: string;
    hintLocked: string;
    failed: (label: string) => string;
    close: string;
    retry: string;
  }
> = {
  en: {
    hintDefault: "Check the host address, port, and network connection.",
    hintNetwork:
      "The network is unreachable. Check your VPN/firewall and the host address/port.",
    hintAuth:
      "Authentication failed. Check the username/password/key or your ssh-agent registration.",
    hintTimeout:
      "The connection timed out. Make sure the host is up and the port is open.",
    hintRefused:
      "The connection was refused. Make sure the SSH service is running on that port.",
    hintLocked:
      "The secret store is locked. Retry with a Keychain-stored host or change the authentication method.",
    failed: (label) => `Connection failed — ${label}`,
    close: "Close",
    retry: "Retry",
  },
  ko: {
    hintDefault: "호스트 주소·포트·네트워크 연결을 확인하세요.",
    hintNetwork:
      "네트워크에 도달할 수 없습니다. VPN/방화벽, 호스트 주소·포트를 확인하세요.",
    hintAuth:
      "인증에 실패했습니다. 사용자명/비밀번호/키 또는 ssh-agent 등록을 확인하세요.",
    hintTimeout:
      "연결 시간이 초과됐습니다. 호스트가 켜져 있고 포트가 열려 있는지 확인하세요.",
    hintRefused:
      "연결이 거부됐습니다. 해당 포트에서 SSH 서비스가 동작 중인지 확인하세요.",
    hintLocked:
      "시크릿 저장소가 잠겨 있습니다. Keychain 저장 호스트로 다시 시도하거나 인증 방식을 바꾸세요.",
    failed: (label) => `연결 실패 — ${label}`,
    close: "닫기",
    retry: "다시 시도",
  },
  es: {
    hintDefault: "Comprueba la dirección del host, el puerto y la conexión de red.",
    hintNetwork:
      "No se puede alcanzar la red. Revisa tu VPN/firewall y la dirección/puerto del host.",
    hintAuth:
      "Falló la autenticación. Revisa el usuario/contraseña/clave o el registro en tu ssh-agent.",
    hintTimeout:
      "Se agotó el tiempo de conexión. Asegúrate de que el host esté activo y el puerto abierto.",
    hintRefused:
      "Se rechazó la conexión. Asegúrate de que el servicio SSH esté en ejecución en ese puerto.",
    hintLocked:
      "El almacén de secretos está bloqueado. Reintenta con un host guardado en Keychain o cambia el método de autenticación.",
    failed: (label) => `Conexión fallida — ${label}`,
    close: "Cerrar",
    retry: "Reintentar",
  },
  zh: {
    hintDefault: "请检查主机地址、端口和网络连接。",
    hintNetwork:
      "无法访问网络。请检查你的 VPN/防火墙以及主机地址/端口。",
    hintAuth:
      "认证失败。请检查用户名/密码/密钥或你的 ssh-agent 注册。",
    hintTimeout:
      "连接超时。请确认主机已开机且端口已开放。",
    hintRefused:
      "连接被拒绝。请确认该端口上的 SSH 服务正在运行。",
    hintLocked:
      "密钥存储已锁定。请使用存储于 Keychain 的主机重试，或更改认证方式。",
    failed: (label) => `连接失败 — ${label}`,
    close: "关闭",
    retry: "重试",
  },
  ja: {
    hintDefault: "ホストアドレス・ポート・ネットワーク接続を確認してください。",
    hintNetwork:
      "ネットワークに到達できません。VPN／ファイアウォール、ホストアドレス／ポートを確認してください。",
    hintAuth:
      "認証に失敗しました。ユーザー名／パスワード／キー、または ssh-agent への登録を確認してください。",
    hintTimeout:
      "接続がタイムアウトしました。ホストが起動しており、ポートが開いているか確認してください。",
    hintRefused:
      "接続が拒否されました。そのポートで SSH サービスが動作しているか確認してください。",
    hintLocked:
      "シークレットストアがロックされています。Keychain に保存されたホストで再試行するか、認証方式を変更してください。",
    failed: (label) => `接続失敗 — ${label}`,
    close: "閉じる",
    retry: "再試行",
  },
  ru: {
    hintDefault: "Проверьте адрес хоста, порт и сетевое подключение.",
    hintNetwork:
      "Сеть недоступна. Проверьте VPN/брандмауэр и адрес/порт хоста.",
    hintAuth:
      "Не удалось пройти аутентификацию. Проверьте имя пользователя/пароль/ключ или регистрацию в ssh-agent.",
    hintTimeout:
      "Истекло время ожидания подключения. Убедитесь, что хост включён, а порт открыт.",
    hintRefused:
      "Подключение отклонено. Убедитесь, что служба SSH работает на этом порту.",
    hintLocked:
      "Хранилище секретов заблокировано. Повторите с хостом, сохранённым в Keychain, или измените способ аутентификации.",
    failed: (label) => `Сбой подключения — ${label}`,
    close: "Закрыть",
    retry: "Повторить",
  },
  fr: {
    hintDefault: "Vérifiez l'adresse de l'hôte, le port et la connexion réseau.",
    hintNetwork:
      "Le réseau est inaccessible. Vérifiez votre VPN/pare-feu et l'adresse/le port de l'hôte.",
    hintAuth:
      "Échec de l'authentification. Vérifiez le nom d'utilisateur/mot de passe/clé ou votre enregistrement ssh-agent.",
    hintTimeout:
      "La connexion a expiré. Assurez-vous que l'hôte est actif et que le port est ouvert.",
    hintRefused:
      "La connexion a été refusée. Assurez-vous que le service SSH est en cours d'exécution sur ce port.",
    hintLocked:
      "Le coffre de secrets est verrouillé. Réessayez avec un hôte enregistré dans Keychain ou changez de méthode d'authentification.",
    failed: (label) => `Échec de la connexion — ${label}`,
    close: "Fermer",
    retry: "Réessayer",
  },
  de: {
    hintDefault: "Überprüfe die Host-Adresse, den Port und die Netzwerkverbindung.",
    hintNetwork:
      "Das Netzwerk ist nicht erreichbar. Überprüfe dein VPN/deine Firewall sowie Host-Adresse/Port.",
    hintAuth:
      "Authentifizierung fehlgeschlagen. Überprüfe Benutzername/Passwort/Schlüssel oder deine ssh-agent-Registrierung.",
    hintTimeout:
      "Zeitüberschreitung bei der Verbindung. Stelle sicher, dass der Host läuft und der Port offen ist.",
    hintRefused:
      "Die Verbindung wurde abgelehnt. Stelle sicher, dass der SSH-Dienst auf diesem Port läuft.",
    hintLocked:
      "Der Secret-Store ist gesperrt. Versuche es mit einem in Keychain gespeicherten Host erneut oder ändere die Authentifizierungsmethode.",
    failed: (label) => `Verbindung fehlgeschlagen — ${label}`,
    close: "Schließen",
    retry: "Erneut versuchen",
  },
  vi: {
    hintDefault: "Kiểm tra địa chỉ host, cổng và kết nối mạng.",
    hintNetwork:
      "Không thể truy cập mạng. Kiểm tra VPN/tường lửa và địa chỉ/cổng của host.",
    hintAuth:
      "Xác thực thất bại. Kiểm tra tên người dùng/mật khẩu/khóa hoặc việc đăng ký ssh-agent của bạn.",
    hintTimeout:
      "Kết nối đã hết thời gian chờ. Hãy chắc chắn host đang bật và cổng đang mở.",
    hintRefused:
      "Kết nối bị từ chối. Hãy chắc chắn dịch vụ SSH đang chạy trên cổng đó.",
    hintLocked:
      "Kho lưu trữ bí mật đang bị khóa. Thử lại với một host đã lưu trong Keychain hoặc thay đổi phương thức xác thực.",
    failed: (label) => `Kết nối thất bại — ${label}`,
    close: "Đóng",
    retry: "Thử lại",
  },
  id: {
    hintDefault: "Periksa alamat host, port, dan koneksi jaringan.",
    hintNetwork:
      "Jaringan tidak dapat dijangkau. Periksa VPN/firewall serta alamat/port host Anda.",
    hintAuth:
      "Autentikasi gagal. Periksa nama pengguna/kata sandi/kunci atau pendaftaran ssh-agent Anda.",
    hintTimeout:
      "Koneksi habis waktu. Pastikan host menyala dan port terbuka.",
    hintRefused:
      "Koneksi ditolak. Pastikan layanan SSH berjalan pada port tersebut.",
    hintLocked:
      "Penyimpanan rahasia terkunci. Coba lagi dengan host yang tersimpan di Keychain atau ubah metode autentikasi.",
    failed: (label) => `Koneksi gagal — ${label}`,
    close: "Tutup",
    retry: "Coba lagi",
  },
  hi: {
    hintDefault: "होस्ट पता, पोर्ट और नेटवर्क कनेक्शन जाँचें।",
    hintNetwork:
      "नेटवर्क तक नहीं पहुँचा जा सका। अपना VPN/फ़ायरवॉल और होस्ट पता/पोर्ट जाँचें।",
    hintAuth:
      "प्रमाणीकरण विफल रहा। उपयोगकर्ता नाम/पासवर्ड/की या अपना ssh-agent पंजीकरण जाँचें।",
    hintTimeout:
      "कनेक्शन का समय समाप्त हो गया। सुनिश्चित करें कि होस्ट चालू है और पोर्ट खुला है।",
    hintRefused:
      "कनेक्शन अस्वीकृत कर दिया गया। सुनिश्चित करें कि उस पोर्ट पर SSH सेवा चल रही है।",
    hintLocked:
      "सीक्रेट स्टोर लॉक है। Keychain में संग्रहीत होस्ट के साथ पुनः प्रयास करें या प्रमाणीकरण विधि बदलें।",
    failed: (label) => `कनेक्शन विफल — ${label}`,
    close: "बंद करें",
    retry: "पुनः प्रयास करें",
  },
};

/**
 * S-062/063/064 — SSH 연결/네트워크/인증 실패 안내.
 * 메시지 내용으로 흔한 원인을 추정해 힌트를 덧붙인다.
 */
export function ConnectionErrorModal({ info, onRetry, onClose }: Props) {
  const t = useT(STR);
  const m = info.message.toLowerCase();
  let hint = t.hintDefault;
  if (m.includes("unreachable") || m.includes("network")) {
    hint = t.hintNetwork;
  } else if (m.includes("auth") || m.includes("rejected") || m.includes("password")) {
    hint = t.hintAuth;
  } else if (m.includes("timed out") || m.includes("timeout")) {
    hint = t.hintTimeout;
  } else if (m.includes("refused")) {
    hint = t.hintRefused;
  } else if (m.includes("not unlocked") || m.includes("secret store")) {
    hint = t.hintLocked;
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} role="dialog" aria-modal="true">
        <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span
            style={{
              fontSize: 20,
              color: "#ff8c5a",
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "2px solid #ff8c5a",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            !
          </span>
          <strong style={{ fontSize: 15 }}>{t.failed(info.label)}</strong>
        </header>

        <div style={{ color: "#ddd", marginBottom: 8, lineHeight: 1.5 }}>{hint}</div>
        <pre
          style={{
            background: "#16161c",
            border: "1px solid #2a2a30",
            borderRadius: 4,
            padding: "8px 10px",
            fontSize: 11,
            color: "#fbb",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: "0 0 16px",
            maxHeight: 120,
            overflow: "auto",
          }}
        >
          {info.message}
        </pre>

        <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btn}>
            {t.close}
          </button>
          <button onClick={onRetry} style={primary}>
            {t.retry}
          </button>
        </footer>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};
const modal: React.CSSProperties = {
  width: 460,
  maxWidth: "90vw",
  background: "#262630",
  border: "1px solid #5a3a1d",
  borderRadius: 6,
  color: "#e6e6e6",
  boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
  padding: 20,
  fontSize: 13,
};
const btn: React.CSSProperties = {
  padding: "8px 14px",
  background: "transparent",
  color: "#ccc",
  border: "1px solid #444",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
};
const primary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#0a5380",
  color: "#fff",
  border: "1px solid #4a9eff",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
