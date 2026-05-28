import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LangDict, useT } from "../i18n";

export interface FirstContactInfo {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}

interface Props {
  info: FirstContactInfo;
  onCancel: () => void;
  /** 신뢰 저장 후 부모가 재접속을 트리거. */
  onTrusted: () => void;
}

const STR: LangDict<{
    title: string;
    intro1: string;
    introChannel: string;
    intro2: string;
    verifyLabel: string;
    cancel: string;
    busy: string;
    trustConnect: string;
  }
> = {
  en: {
    title: "First contact — verify host key",
    intro1:
      " is a host you are connecting to for the first time. Verify that the fingerprint below matches the value provided by the server administrator through a ",
    introChannel: "separate channel",
    intro2:
      " before trusting it. If it does not match, this could be a MITM attack.",
    verifyLabel: "How to verify (run on the server):",
    cancel: "Cancel",
    busy: "Processing...",
    trustConnect: "Trust and connect",
  },
  ko: {
    title: "첫 접속 — 호스트 키 확인",
    intro1:
      " 은(는) 처음 접속하는 호스트입니다. 아래 fingerprint가 서버 관리자에게서 받은 값과 같은지 ",
    introChannel: "별도 채널",
    intro2: "로 확인한 뒤 신뢰하세요. 일치하지 않으면 MITM 공격일 수 있습니다.",
    verifyLabel: "확인 방법(서버에서 실행):",
    cancel: "취소",
    busy: "처리 중...",
    trustConnect: "신뢰하고 접속",
  },
  es: {
    title: "Primer contacto — verifica la clave de host",
    intro1:
      " es un host al que te conectas por primera vez. Verifica que el fingerprint de abajo coincida con el valor proporcionado por el administrador del servidor a través de un ",
    introChannel: "canal aparte",
    intro2:
      " antes de confiar en él. Si no coincide, podría tratarse de un ataque MITM.",
    verifyLabel: "Cómo verificar (ejecuta en el servidor):",
    cancel: "Cancelar",
    busy: "Procesando...",
    trustConnect: "Confiar y conectar",
  },
  zh: {
    title: "首次接触 — 验证主机密钥",
    intro1:
      " 是你首次连接的主机。在信任之前，请验证下方的 fingerprint 与服务器管理员通过",
    introChannel: "另一渠道",
    intro2:
      "提供的值一致。如果不一致，这可能是 MITM 攻击。",
    verifyLabel: "验证方法（在服务器上运行）：",
    cancel: "取消",
    busy: "处理中...",
    trustConnect: "信任并连接",
  },
  ja: {
    title: "初回接触 — ホストキーを確認",
    intro1:
      " は初めて接続するホストです。信頼する前に、下の fingerprint がサーバー管理者から",
    introChannel: "別の経路",
    intro2:
      "で提供された値と一致することを確認してください。一致しない場合、MITM 攻撃の可能性があります。",
    verifyLabel: "確認方法（サーバーで実行）:",
    cancel: "キャンセル",
    busy: "処理中...",
    trustConnect: "信頼して接続",
  },
  ru: {
    title: "Первый контакт — проверьте ключ хоста",
    intro1:
      " — это хост, к которому вы подключаетесь впервые. Прежде чем доверять ему, убедитесь, что fingerprint ниже совпадает со значением, предоставленным администратором сервера через ",
    introChannel: "отдельный канал",
    intro2:
      ". Если он не совпадает, это может быть атака MITM.",
    verifyLabel: "Как проверить (выполните на сервере):",
    cancel: "Отмена",
    busy: "Обработка...",
    trustConnect: "Доверять и подключиться",
  },
  fr: {
    title: "Premier contact — vérifiez la clé d'hôte",
    intro1:
      " est un hôte auquel vous vous connectez pour la première fois. Vérifiez que le fingerprint ci-dessous correspond à la valeur fournie par l'administrateur du serveur via un ",
    introChannel: "canal distinct",
    intro2:
      " avant de lui faire confiance. S'il ne correspond pas, il pourrait s'agir d'une attaque MITM.",
    verifyLabel: "Comment vérifier (à exécuter sur le serveur) :",
    cancel: "Annuler",
    busy: "Traitement...",
    trustConnect: "Faire confiance et connecter",
  },
  de: {
    title: "Erstkontakt — Host-Schlüssel überprüfen",
    intro1:
      " ist ein Host, mit dem du dich zum ersten Mal verbindest. Überprüfe, dass der fingerprint unten mit dem Wert übereinstimmt, den der Serveradministrator über einen ",
    introChannel: "separaten Kanal",
    intro2:
      " bereitgestellt hat, bevor du ihm vertraust. Stimmt er nicht überein, könnte dies ein MITM-Angriff sein.",
    verifyLabel: "So überprüfst du es (auf dem Server ausführen):",
    cancel: "Abbrechen",
    busy: "Wird verarbeitet...",
    trustConnect: "Vertrauen und verbinden",
  },
  vi: {
    title: "Tiếp xúc đầu tiên — xác minh khóa host",
    intro1:
      " là một host bạn đang kết nối lần đầu. Hãy xác minh rằng fingerprint bên dưới khớp với giá trị do quản trị viên máy chủ cung cấp qua một ",
    introChannel: "kênh riêng",
    intro2:
      " trước khi tin cậy. Nếu không khớp, đây có thể là một cuộc tấn công MITM.",
    verifyLabel: "Cách xác minh (chạy trên máy chủ):",
    cancel: "Hủy",
    busy: "Đang xử lý...",
    trustConnect: "Tin cậy và kết nối",
  },
  id: {
    title: "Kontak pertama — verifikasi kunci host",
    intro1:
      " adalah host yang Anda hubungi untuk pertama kali. Verifikasi bahwa fingerprint di bawah cocok dengan nilai yang diberikan administrator server melalui ",
    introChannel: "kanal terpisah",
    intro2:
      " sebelum mempercayainya. Jika tidak cocok, ini bisa jadi serangan MITM.",
    verifyLabel: "Cara verifikasi (jalankan di server):",
    cancel: "Batal",
    busy: "Memproses...",
    trustConnect: "Percayai dan hubungkan",
  },
  hi: {
    title: "पहला संपर्क — होस्ट की सत्यापित करें",
    intro1:
      " एक ऐसा होस्ट है जिससे आप पहली बार कनेक्ट कर रहे हैं। उस पर भरोसा करने से पहले सत्यापित करें कि नीचे दिया गया fingerprint सर्वर प्रशासक द्वारा किसी ",
    introChannel: "अलग चैनल",
    intro2:
      " से दिए गए मान से मेल खाता है। यदि यह मेल नहीं खाता, तो यह MITM हमला हो सकता है।",
    verifyLabel: "कैसे सत्यापित करें (सर्वर पर चलाएँ):",
    cancel: "रद्द करें",
    busy: "प्रोसेस हो रहा है...",
    trustConnect: "विश्वास करें और कनेक्ट करें",
  },
};

export function FirstContactModal({ info, onCancel, onTrusted }: Props) {
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
        fingerprint: info.fingerprint,
      });
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
          border: "2px solid #b89642",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🔐</span>
          <h3 style={{ margin: 0, fontSize: 16, color: "#ffd07a" }}>
            {t.title}
          </h3>
        </div>

        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          <b>
            {info.host}:{info.port}
          </b>
          {t.intro1}
          <b style={{ color: "#ffd07a" }}>{t.introChannel}</b>
          {t.intro2}
        </p>

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
            label="Fingerprint"
            value={info.fingerprint}
            valueColor="#ffd07a"
          />
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "#aaa" }}>
          {t.verifyLabel}{" "}
          <code style={codeStyle}>
            ssh-keygen -lf /etc/ssh/ssh_host_{info.algorithm.replace(
              "ssh-",
              "",
            )}_key.pub
          </code>
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
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button onClick={onCancel} disabled={busy} style={btnStyle}>
            {t.cancel}
          </button>
          <button
            onClick={handleTrust}
            disabled={busy}
            style={{
              ...btnStyle,
              background: "#b89642",
              color: "#1e1e1e",
              borderColor: "#d9b25c",
              fontWeight: 600,
            }}
          >
            {busy ? t.busy : t.trustConnect}
          </button>
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

const codeStyle: React.CSSProperties = {
  background: "#1e1e1e",
  padding: "1px 6px",
  borderRadius: 3,
  fontSize: 11,
  fontFamily: "Menlo, Consolas, monospace",
  color: "#9ad4ff",
};
