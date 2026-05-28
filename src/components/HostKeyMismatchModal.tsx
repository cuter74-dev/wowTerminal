import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LangDict, useT } from "../i18n";

export interface MismatchInfo {
  host: string;
  port: number;
  algorithm: string;
  stored: string;
  presented: string;
}

interface Props {
  info: MismatchInfo;
  onCancel: () => void;
  /** 신뢰 갱신 + 재시도. 부모가 retry trigger를 발동시킨다. */
  onTrusted: () => void;
}

const STR: LangDict<{
    title: string;
    intro: string;
    mitmLabel: string;
    mitmDesc: string;
    rotatedDesc: string;
    storedLabel: string;
    presentedLabel: string;
    verifyNote1: string;
    verifyNote2: string;
    verifyNote3: string;
    forgetTitle: string;
    forget: string;
    cancel: string;
    busy: string;
    trustRetry: string;
  }
> = {
  en: {
    title: "Host key mismatch — security warning",
    intro:
      "presented a host key that differs from the previously stored one. This could be one of the following:",
    mitmLabel: "Man-in-the-middle (MITM) attack",
    mitmDesc:
      " — someone may be intercepting your traffic and impersonating the server.",
    rotatedDesc:
      "The server was reinstalled/migrated, or its host key was intentionally rotated.",
    storedLabel: "Stored (previous)",
    presentedLabel: "Presented (current)",
    verifyNote1:
      'Only click "Trust and retry" after confirming with the server administrator through a separate channel (e.g. Slack, phone) that the ',
    verifyNote2: "new fingerprint",
    verifyNote3: " is legitimate.",
    forgetTitle:
      "Erase the stored key and treat the next connection as a first contact",
    forget: "Forget stored key",
    cancel: "Cancel",
    busy: "Processing...",
    trustRetry: "Trust and retry",
  },
  ko: {
    title: "호스트 키 불일치 — 보안 경고",
    intro:
      "서버가 제시한 호스트 키가 이전에 저장된 키와 다릅니다. 이는 다음 중 하나일 수 있습니다:",
    mitmLabel: "중간자 공격(MITM)",
    mitmDesc: " — 누군가 트래픽을 가로채 사칭하는 중일 수 있습니다.",
    rotatedDesc:
      "서버를 재설치/이전했거나 호스트 키를 의도적으로 회전했습니다.",
    storedLabel: "Stored (이전)",
    presentedLabel: "Presented (이번)",
    verifyNote1: "서버 관리자에게 별도 채널(예: 슬랙, 전화)로 ",
    verifyNote2: "새 fingerprint",
    verifyNote3: '가 정상인지 확인한 뒤에만 "신뢰하고 재시도"를 누르세요.',
    forgetTitle: "저장된 키를 지우고 다음 접속을 첫 접속으로 처리",
    forget: "저장된 키 잊기",
    cancel: "취소",
    busy: "처리 중...",
    trustRetry: "신뢰하고 재시도",
  },
  es: {
    title: "Discrepancia de clave de host — advertencia de seguridad",
    intro:
      "presentó una clave de host distinta de la almacenada anteriormente. Esto podría ser una de las siguientes:",
    mitmLabel: "Ataque de intermediario (MITM)",
    mitmDesc:
      " — alguien podría estar interceptando tu tráfico y suplantando al servidor.",
    rotatedDesc:
      "El servidor fue reinstalado/migrado, o su clave de host se rotó intencionadamente.",
    storedLabel: "Almacenada (anterior)",
    presentedLabel: "Presentada (actual)",
    verifyNote1:
      'Haz clic en "Confiar y reintentar" solo después de confirmar con el administrador del servidor por un canal aparte (p. ej. Slack, teléfono) que el ',
    verifyNote2: "nuevo fingerprint",
    verifyNote3: " es legítimo.",
    forgetTitle:
      "Borrar la clave almacenada y tratar la próxima conexión como un primer contacto",
    forget: "Olvidar clave almacenada",
    cancel: "Cancelar",
    busy: "Procesando...",
    trustRetry: "Confiar y reintentar",
  },
  zh: {
    title: "主机密钥不匹配 — 安全警告",
    intro:
      "提供的主机密钥与先前存储的不同。这可能是以下情况之一：",
    mitmLabel: "中间人（MITM）攻击",
    mitmDesc: " — 可能有人正在拦截你的流量并冒充服务器。",
    rotatedDesc:
      "服务器被重新安装/迁移，或其主机密钥被有意轮换。",
    storedLabel: "已存储（先前）",
    presentedLabel: "已提供（当前）",
    verifyNote1:
      '只有在通过另一渠道（例如 Slack、电话）向服务器管理员确认',
    verifyNote2: "新 fingerprint",
    verifyNote3: ' 合法后，才点击"信任并重试"。',
    forgetTitle: "删除已存储的密钥，并将下次连接视为首次接触",
    forget: "忘记已存储密钥",
    cancel: "取消",
    busy: "处理中...",
    trustRetry: "信任并重试",
  },
  ja: {
    title: "ホストキーの不一致 — セキュリティ警告",
    intro:
      "が提示したホストキーが、以前に保存されたものと異なります。これは次のいずれかの可能性があります：",
    mitmLabel: "中間者（MITM）攻撃",
    mitmDesc: " — 誰かが通信を傍受し、サーバーになりすましている可能性があります。",
    rotatedDesc:
      "サーバーが再インストール／移行されたか、ホストキーが意図的にローテーションされました。",
    storedLabel: "保存済み（以前）",
    presentedLabel: "提示（今回）",
    verifyNote1:
      "別の経路（例: Slack、電話）でサーバー管理者に",
    verifyNote2: "新しい fingerprint",
    verifyNote3: "が正当であると確認したうえでのみ「信頼して再試行」を押してください。",
    forgetTitle: "保存済みキーを消去し、次回の接続を初回接触として扱う",
    forget: "保存済みキーを忘れる",
    cancel: "キャンセル",
    busy: "処理中...",
    trustRetry: "信頼して再試行",
  },
  ru: {
    title: "Несовпадение ключа хоста — предупреждение безопасности",
    intro:
      "предъявил ключ хоста, отличный от ранее сохранённого. Это может быть одной из следующих ситуаций:",
    mitmLabel: "Атака «человек посередине» (MITM)",
    mitmDesc:
      " — кто-то может перехватывать ваш трафик и выдавать себя за сервер.",
    rotatedDesc:
      "Сервер был переустановлен/перенесён, либо его ключ хоста намеренно сменили.",
    storedLabel: "Сохранённый (прежний)",
    presentedLabel: "Предъявленный (текущий)",
    verifyNote1:
      'Нажимайте «Доверять и повторить» только после того, как через отдельный канал (например, Slack, телефон) подтвердите у администратора сервера, что ',
    verifyNote2: "новый fingerprint",
    verifyNote3: " является подлинным.",
    forgetTitle:
      "Удалить сохранённый ключ и считать следующее подключение первым контактом",
    forget: "Забыть сохранённый ключ",
    cancel: "Отмена",
    busy: "Обработка...",
    trustRetry: "Доверять и повторить",
  },
  fr: {
    title: "Clé d'hôte non concordante — avertissement de sécurité",
    intro:
      "a présenté une clé d'hôte différente de celle précédemment stockée. Cela peut être l'une des situations suivantes :",
    mitmLabel: "Attaque de l'homme du milieu (MITM)",
    mitmDesc:
      " — quelqu'un pourrait intercepter votre trafic et se faire passer pour le serveur.",
    rotatedDesc:
      "Le serveur a été réinstallé/migré, ou sa clé d'hôte a été délibérément renouvelée.",
    storedLabel: "Stockée (précédente)",
    presentedLabel: "Présentée (actuelle)",
    verifyNote1:
      'Ne cliquez sur « Faire confiance et réessayer » qu\'après avoir confirmé auprès de l\'administrateur du serveur, par un canal distinct (p. ex. Slack, téléphone), que le ',
    verifyNote2: "nouveau fingerprint",
    verifyNote3: " est légitime.",
    forgetTitle:
      "Effacer la clé stockée et traiter la prochaine connexion comme un premier contact",
    forget: "Oublier la clé stockée",
    cancel: "Annuler",
    busy: "Traitement...",
    trustRetry: "Faire confiance et réessayer",
  },
  de: {
    title: "Host-Schlüssel stimmt nicht überein — Sicherheitswarnung",
    intro:
      "hat einen Host-Schlüssel präsentiert, der sich vom zuvor gespeicherten unterscheidet. Dies könnte eine der folgenden Ursachen haben:",
    mitmLabel: "Man-in-the-Middle-Angriff (MITM)",
    mitmDesc:
      " — jemand könnte deinen Datenverkehr abfangen und sich als der Server ausgeben.",
    rotatedDesc:
      "Der Server wurde neu installiert/migriert, oder sein Host-Schlüssel wurde absichtlich gewechselt.",
    storedLabel: "Gespeichert (vorher)",
    presentedLabel: "Präsentiert (aktuell)",
    verifyNote1:
      'Klicke erst auf „Vertrauen und erneut versuchen", nachdem du über einen separaten Kanal (z. B. Slack, Telefon) mit dem Serveradministrator bestätigt hast, dass der ',
    verifyNote2: "neue fingerprint",
    verifyNote3: " legitim ist.",
    forgetTitle:
      "Den gespeicherten Schlüssel löschen und die nächste Verbindung als Erstkontakt behandeln",
    forget: "Gespeicherten Schlüssel vergessen",
    cancel: "Abbrechen",
    busy: "Wird verarbeitet...",
    trustRetry: "Vertrauen und erneut versuchen",
  },
  vi: {
    title: "Khóa host không khớp — cảnh báo bảo mật",
    intro:
      "đã trình một khóa host khác với khóa đã lưu trước đó. Đây có thể là một trong các trường hợp sau:",
    mitmLabel: "Tấn công kẻ đứng giữa (MITM)",
    mitmDesc:
      " — ai đó có thể đang chặn lưu lượng của bạn và giả mạo máy chủ.",
    rotatedDesc:
      "Máy chủ đã được cài lại/di chuyển, hoặc khóa host của nó được luân chuyển có chủ đích.",
    storedLabel: "Đã lưu (trước đó)",
    presentedLabel: "Đã trình (hiện tại)",
    verifyNote1:
      'Chỉ nhấn "Tin cậy và thử lại" sau khi đã xác nhận với quản trị viên máy chủ qua một kênh riêng (ví dụ: Slack, điện thoại) rằng ',
    verifyNote2: "fingerprint mới",
    verifyNote3: " là hợp lệ.",
    forgetTitle:
      "Xóa khóa đã lưu và coi lần kết nối tiếp theo là lần tiếp xúc đầu tiên",
    forget: "Quên khóa đã lưu",
    cancel: "Hủy",
    busy: "Đang xử lý...",
    trustRetry: "Tin cậy và thử lại",
  },
  id: {
    title: "Kunci host tidak cocok — peringatan keamanan",
    intro:
      "menyajikan kunci host yang berbeda dari yang sebelumnya disimpan. Ini bisa jadi salah satu dari berikut:",
    mitmLabel: "Serangan man-in-the-middle (MITM)",
    mitmDesc:
      " — seseorang mungkin sedang menyadap lalu lintas Anda dan menyamar sebagai server.",
    rotatedDesc:
      "Server diinstal ulang/dipindahkan, atau kunci host-nya sengaja dirotasi.",
    storedLabel: "Tersimpan (sebelumnya)",
    presentedLabel: "Disajikan (saat ini)",
    verifyNote1:
      'Klik "Percayai dan coba lagi" hanya setelah memastikan kepada administrator server melalui kanal terpisah (mis. Slack, telepon) bahwa ',
    verifyNote2: "fingerprint baru",
    verifyNote3: " sah.",
    forgetTitle:
      "Hapus kunci yang tersimpan dan perlakukan koneksi berikutnya sebagai kontak pertama",
    forget: "Lupakan kunci tersimpan",
    cancel: "Batal",
    busy: "Memproses...",
    trustRetry: "Percayai dan coba lagi",
  },
  hi: {
    title: "होस्ट की बेमेल — सुरक्षा चेतावनी",
    intro:
      "ने पहले संग्रहीत की से भिन्न होस्ट की प्रस्तुत की है। यह निम्न में से कोई एक हो सकता है:",
    mitmLabel: "मैन-इन-द-मिडल (MITM) हमला",
    mitmDesc:
      " — कोई आपके ट्रैफ़िक को रोककर सर्वर का प्रतिरूपण कर रहा हो सकता है।",
    rotatedDesc:
      "सर्वर को फिर से इंस्टॉल/माइग्रेट किया गया, या उसकी होस्ट की जानबूझकर बदली गई।",
    storedLabel: "संग्रहीत (पिछली)",
    presentedLabel: "प्रस्तुत (वर्तमान)",
    verifyNote1:
      'किसी अलग चैनल (जैसे Slack, फ़ोन) के माध्यम से सर्वर प्रशासक से यह पुष्टि करने के बाद ही "विश्वास करें और पुनः प्रयास करें" पर क्लिक करें कि ',
    verifyNote2: "नया fingerprint",
    verifyNote3: " वैध है।",
    forgetTitle:
      "संग्रहीत की को मिटाएँ और अगले कनेक्शन को पहले संपर्क के रूप में मानें",
    forget: "संग्रहीत की भूल जाएँ",
    cancel: "रद्द करें",
    busy: "प्रोसेस हो रहा है...",
    trustRetry: "विश्वास करें और पुनः प्रयास करें",
  },
};

export function HostKeyMismatchModal({ info, onCancel, onTrusted }: Props) {
  const t = useT(STR);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleTrust() {
    setErr(null);
    setBusy(true);
    try {
      await invoke("ssh_trust_known_host", {
        host: info.host,
        port: info.port,
        algorithm: info.algorithm,
        fingerprint: info.presented,
      });
      onTrusted();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleForget() {
    setErr(null);
    setBusy(true);
    try {
      await invoke("ssh_forget_known_host", {
        host: info.host,
        port: info.port,
      });
      // forget만 한 경우, 다음 connect에서 FirstContact로 처리됨 → 자동 재시도해도 안전.
      onTrusted();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 200,
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: "90vw",
          background: "#2d2d30",
          color: "#cccccc",
          padding: 22,
          borderRadius: 6,
          border: "2px solid #b13a3a",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <h3 style={{ margin: 0, fontSize: 16, color: "#ff8a8a" }}>
            {t.title}
          </h3>
        </div>

        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          <b>
            {info.host}:{info.port}
          </b>{" "}
          {t.intro}
        </p>
        <ul style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, paddingLeft: 18 }}>
          <li>
            <b style={{ color: "#ff8a8a" }}>{t.mitmLabel}</b>
            {t.mitmDesc}
          </li>
          <li>
            {t.rotatedDesc}
          </li>
        </ul>

        <div
          style={{
            background: "#1e1e1e",
            border: "1px solid #444",
            borderRadius: 4,
            padding: 12,
            fontFamily: "Menlo, Consolas, monospace",
            fontSize: 11.5,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <Row label="Algorithm" value={info.algorithm} />
          <Row
            label={t.storedLabel}
            value={info.stored}
            valueColor="#9ad4ff"
          />
          <Row
            label={t.presentedLabel}
            value={info.presented}
            valueColor="#ffb86c"
          />
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "#aaa" }}>
          {t.verifyNote1}
          <b style={{ color: "#ffb86c" }}>{t.verifyNote2}</b>
          {t.verifyNote3}
        </p>

        {err && (
          <div
            style={{
              padding: 8,
              background: "#5a1d1d",
              color: "#fdd",
              fontSize: 12,
              borderRadius: 3,
            }}
          >
            {err}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            onClick={handleForget}
            disabled={busy}
            style={{ ...btnStyle, background: "#3a3a3a" }}
            title={t.forgetTitle}
          >
            {t.forget}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel} disabled={busy} style={btnStyle}>
              {t.cancel}
            </button>
            <button
              onClick={handleTrust}
              disabled={busy}
              style={{
                ...btnStyle,
                background: "#b13a3a",
                color: "#fff",
                borderColor: "#d65555",
              }}
            >
              {busy ? t.busy : t.trustRetry}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <span style={{ width: 130, color: "#888" }}>{label}</span>
      <span style={{ color: valueColor ?? "#e6e6e6", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  color: "#cccccc",
  border: "1px solid #555",
  padding: "6px 14px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 13,
};
