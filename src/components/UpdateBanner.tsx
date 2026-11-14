// 새 버전 안내 줄 (#188). 탭 줄 아래에 얇게 띄워, 켜 둔 채로도 새 버전을 알 수 있게 한다.
// 재시작은 사용자가 고른다 — 안내 문구에 재시작해도 이어지는 것(macOS·Linux는 세션 데몬이 터미널·
// SSH 셸을 이어 줌)과 닫히는 것(Windows)을 적는다. 앱이 뒤에 있으면 버전마다 데스크톱 알림 한 번.
import { useEffect, useRef } from "react";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { LangDict, useT } from "../i18n";
import { osPlatform } from "../platform";
import { dismissUpdate, installUpdate, useUpdateState } from "../updates";

const STR: LangDict<{
  available: (v: string) => string;
  keeps: string;
  closes: string;
  restart: string;
  later: string;
  installing: string;
  failed: (why: string) => string;
  retry: string;
  notify: (v: string) => string;
}> = {
  en: { available: (v) => `wowTerminal ${v} is available.`, keeps: "Your terminals and SSH sessions carry on after the restart.", closes: "Restarting closes open terminals and SSH sessions.", restart: "Restart to update", later: "Later", installing: "Downloading the update…", failed: (w) => `Couldn't update: ${w}`, retry: "Try again", notify: (v) => `wowTerminal ${v} is available — restart when you're ready.` },
  ko: { available: (v) => `새 버전 wowTerminal ${v}이 나왔습니다.`, keeps: "켜 둔 터미널과 SSH 세션은 재시작 뒤에도 이어집니다.", closes: "재시작하면 열린 터미널과 SSH 세션이 닫힙니다.", restart: "재시작해서 업데이트", later: "나중에", installing: "업데이트를 받는 중…", failed: (w) => `업데이트하지 못했습니다: ${w}`, retry: "다시 시도", notify: (v) => `새 버전 wowTerminal ${v}이 나왔습니다 — 편할 때 재시작하세요.` },
  es: { available: (v) => `wowTerminal ${v} está disponible.`, keeps: "Tus terminales y sesiones SSH siguen tras el reinicio.", closes: "Al reiniciar se cierran las terminales y sesiones SSH abiertas.", restart: "Reiniciar para actualizar", later: "Más tarde", installing: "Descargando la actualización…", failed: (w) => `No se pudo actualizar: ${w}`, retry: "Reintentar", notify: (v) => `wowTerminal ${v} está disponible: reinicia cuando quieras.` },
  zh: { available: (v) => `wowTerminal ${v} 已发布。`, keeps: "重启后，打开的终端和 SSH 会话会继续。", closes: "重启会关闭打开的终端和 SSH 会话。", restart: "重启以更新", later: "稍后", installing: "正在下载更新…", failed: (w) => `更新失败：${w}`, retry: "重试", notify: (v) => `wowTerminal ${v} 已发布 — 方便时重启即可。` },
  ja: { available: (v) => `wowTerminal ${v} が利用できます。`, keeps: "開いているターミナルと SSH セッションは再起動後も続きます。", closes: "再起動すると開いているターミナルと SSH セッションが閉じます。", restart: "再起動して更新", later: "後で", installing: "アップデートをダウンロード中…", failed: (w) => `更新できませんでした: ${w}`, retry: "再試行", notify: (v) => `wowTerminal ${v} が利用できます — 都合のよいときに再起動してください。` },
  ru: { available: (v) => `Доступна wowTerminal ${v}.`, keeps: "Терминалы и SSH-сеансы продолжат работу после перезапуска.", closes: "Перезапуск закроет открытые терминалы и SSH-сеансы.", restart: "Перезапустить и обновить", later: "Позже", installing: "Загрузка обновления…", failed: (w) => `Не удалось обновить: ${w}`, retry: "Повторить", notify: (v) => `Доступна wowTerminal ${v} — перезапустите, когда будет удобно.` },
  fr: { available: (v) => `wowTerminal ${v} est disponible.`, keeps: "Vos terminaux et sessions SSH continuent après le redémarrage.", closes: "Le redémarrage ferme les terminaux et sessions SSH ouverts.", restart: "Redémarrer pour mettre à jour", later: "Plus tard", installing: "Téléchargement de la mise à jour…", failed: (w) => `Mise à jour impossible : ${w}`, retry: "Réessayer", notify: (v) => `wowTerminal ${v} est disponible — redémarrez quand vous voulez.` },
  de: { available: (v) => `wowTerminal ${v} ist verfügbar.`, keeps: "Deine Terminals und SSH-Sitzungen laufen nach dem Neustart weiter.", closes: "Ein Neustart schließt offene Terminals und SSH-Sitzungen.", restart: "Neu starten und aktualisieren", later: "Später", installing: "Update wird geladen…", failed: (w) => `Update fehlgeschlagen: ${w}`, retry: "Erneut versuchen", notify: (v) => `wowTerminal ${v} ist verfügbar — starte neu, wann es dir passt.` },
  vi: { available: (v) => `Đã có wowTerminal ${v}.`, keeps: "Terminal và phiên SSH đang mở sẽ tiếp tục sau khi khởi động lại.", closes: "Khởi động lại sẽ đóng terminal và phiên SSH đang mở.", restart: "Khởi động lại để cập nhật", later: "Để sau", installing: "Đang tải bản cập nhật…", failed: (w) => `Không cập nhật được: ${w}`, retry: "Thử lại", notify: (v) => `Đã có wowTerminal ${v} — hãy khởi động lại khi tiện.` },
  id: { available: (v) => `wowTerminal ${v} tersedia.`, keeps: "Terminal dan sesi SSH Anda tetap berjalan setelah dimulai ulang.", closes: "Memulai ulang akan menutup terminal dan sesi SSH yang terbuka.", restart: "Mulai ulang untuk memperbarui", later: "Nanti", installing: "Mengunduh pembaruan…", failed: (w) => `Gagal memperbarui: ${w}`, retry: "Coba lagi", notify: (v) => `wowTerminal ${v} tersedia — mulai ulang kapan saja.` },
  hi: { available: (v) => `wowTerminal ${v} उपलब्ध है।`, keeps: "रीस्टार्ट के बाद भी आपके टर्मिनल और SSH सेशन चलते रहेंगे।", closes: "रीस्टार्ट करने से खुले टर्मिनल और SSH सेशन बंद हो जाएँगे।", restart: "अपडेट के लिए रीस्टार्ट करें", later: "बाद में", installing: "अपडेट डाउनलोड हो रहा है…", failed: (w) => `अपडेट नहीं हो सका: ${w}`, retry: "फिर कोशिश करें", notify: (v) => `wowTerminal ${v} उपलब्ध है — सुविधा अनुसार रीस्टार्ट करें।` },
};

const btn: React.CSSProperties = {
  border: "1px solid #4a9eff",
  borderRadius: 4,
  padding: "2px 10px",
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export function UpdateBanner() {
  const t = useT(STR);
  const { update, installing, error, dismissed } = useUpdateState();
  const version = update?.version ?? null;

  // 앱이 뒤에 있을 때 새 버전을 찾으면 데스크톱 알림을 버전마다 한 번 보낸다.
  const notified = useRef<string | null>(null);
  const notifyText = useRef(t.notify);
  notifyText.current = t.notify;
  useEffect(() => {
    if (!version || notified.current === version) return;
    notified.current = version;
    if (document.hasFocus()) return;
    void (async () => {
      if (!(await isPermissionGranted())) return;
      sendNotification({ title: "wowTerminal", body: notifyText.current(version) });
    })();
  }, [version]);

  if (!version || (dismissed === version && !installing && !error)) return null;
  // Windows는 세션 데몬이 없어(in-process) 재시작하면 세션이 닫힌다.
  const sessionNote = osPlatform === "windows" ? t.closes : t.keeps;
  return (
    <div
      role="status"
      data-testid="update-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 12px",
        background: "#0f2a44",
        borderBottom: "1px solid #1f4a73",
        color: "#cfe3ff",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 600 }}>⬆</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {error ? t.failed(error) : installing ? t.installing : `${t.available(version)} ${sessionNote}`}
      </span>
      {!installing && (
        <>
          <button onClick={() => void installUpdate()} style={{ ...btn, background: "#0a5380", color: "#fff" }}>
            {error ? t.retry : t.restart}
          </button>
          <button onClick={dismissUpdate} style={{ ...btn, background: "transparent", color: "#cfe3ff", borderColor: "#3a5f86" }}>
            {t.later}
          </button>
        </>
      )}
    </div>
  );
}
