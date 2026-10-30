/**
 * 저장 안 한 파일 확인 창 (#166, 화면 기획서 SC-05 ②③). 탭 닫기·창 닫기·종료·업데이트 재시작이
 * 같은 창을 쓴다. "저장 안 함"은 왼쪽 끝에 떨어뜨려 실수로 누르기 어렵게 하고, Enter = 저장,
 * Esc = 취소.
 */
import { useEffect, useRef } from "react";
import { LangDict, useT } from "../i18n";
import { FileDoc, UnsavedChoice, UnsavedReason } from "../fileDocs";

type S = {
  title: Record<UnsavedReason, (n: number, name: string) => string>;
  body: string;
  save: (n: number) => string;
  discard: string;
  cancel: string;
  sessionsKept: string;
  local: string;
};

const STR: LangDict<S> = {
  en: {
    title: {
      close_tab: (_n, name) => `Save changes to ${name}?`,
      close_window: (n) => `${n} file${n === 1 ? " has" : "s have"} unsaved changes. Save before closing?`,
      quit: (n) => `${n} file${n === 1 ? " has" : "s have"} unsaved changes. Save before quitting?`,
      update: (n) => `The update needs a restart, and ${n} file${n === 1 ? " has" : "s have"} unsaved changes.`,
    },
    body: "If you don't save, these changes are lost.",
    save: (n) => (n > 1 ? `Save all (${n})` : "Save"),
    discard: "Don't save",
    cancel: "Cancel",
    sessionsKept: "Terminal sessions keep running in the background (macOS · Linux).",
    local: "Local",
  },
  ko: {
    title: {
      close_tab: (_n, name) => `${name} 변경 사항을 저장할까요?`,
      close_window: (n) => `저장하지 않은 파일이 ${n}개 있습니다. 창을 닫기 전에 저장할까요?`,
      quit: (n) => `저장하지 않은 파일이 ${n}개 있습니다. 종료하기 전에 저장할까요?`,
      update: (n) => `업데이트하려면 재시작해야 하는데, 저장하지 않은 파일이 ${n}개 있습니다.`,
    },
    body: "저장하지 않으면 변경 내용이 사라집니다.",
    save: (n) => (n > 1 ? `모두 저장 (${n})` : "저장"),
    discard: "저장 안 함",
    cancel: "취소",
    sessionsKept: "터미널 세션은 백그라운드에서 유지됩니다(macOS·Linux).",
    local: "로컬",
  },
  es: {
    title: {
      close_tab: (_n, name) => `¿Guardar los cambios de ${name}?`,
      close_window: (n) => `Hay ${n} archivo(s) sin guardar. ¿Guardar antes de cerrar?`,
      quit: (n) => `Hay ${n} archivo(s) sin guardar. ¿Guardar antes de salir?`,
      update: (n) => `La actualización requiere reiniciar y hay ${n} archivo(s) sin guardar.`,
    },
    body: "Si no guardas, se perderán los cambios.",
    save: (n) => (n > 1 ? `Guardar todo (${n})` : "Guardar"),
    discard: "No guardar",
    cancel: "Cancelar",
    sessionsKept: "Las sesiones de terminal siguen en segundo plano (macOS · Linux).",
    local: "Local",
  },
  zh: {
    title: {
      close_tab: (_n, name) => `要保存对 ${name} 的更改吗？`,
      close_window: (n) => `有 ${n} 个文件未保存。关闭前要保存吗？`,
      quit: (n) => `有 ${n} 个文件未保存。退出前要保存吗？`,
      update: (n) => `更新需要重启，而有 ${n} 个文件未保存。`,
    },
    body: "如果不保存，这些更改将丢失。",
    save: (n) => (n > 1 ? `全部保存 (${n})` : "保存"),
    discard: "不保存",
    cancel: "取消",
    sessionsKept: "终端会话会在后台继续运行（macOS · Linux）。",
    local: "本地",
  },
  ja: {
    title: {
      close_tab: (_n, name) => `${name} の変更を保存しますか？`,
      close_window: (n) => `未保存のファイルが ${n} 個あります。閉じる前に保存しますか？`,
      quit: (n) => `未保存のファイルが ${n} 個あります。終了する前に保存しますか？`,
      update: (n) => `アップデートには再起動が必要ですが、未保存のファイルが ${n} 個あります。`,
    },
    body: "保存しないと変更内容は失われます。",
    save: (n) => (n > 1 ? `すべて保存 (${n})` : "保存"),
    discard: "保存しない",
    cancel: "キャンセル",
    sessionsKept: "ターミナルセッションはバックグラウンドで維持されます（macOS・Linux）。",
    local: "ローカル",
  },
  ru: {
    title: {
      close_tab: (_n, name) => `Сохранить изменения в ${name}?`,
      close_window: (n) => `Несохранённых файлов: ${n}. Сохранить перед закрытием?`,
      quit: (n) => `Несохранённых файлов: ${n}. Сохранить перед выходом?`,
      update: (n) => `Для обновления нужен перезапуск, а несохранённых файлов: ${n}.`,
    },
    body: "Если не сохранить, изменения будут потеряны.",
    save: (n) => (n > 1 ? `Сохранить все (${n})` : "Сохранить"),
    discard: "Не сохранять",
    cancel: "Отмена",
    sessionsKept: "Сеансы терминала продолжат работать в фоне (macOS · Linux).",
    local: "Локально",
  },
  fr: {
    title: {
      close_tab: (_n, name) => `Enregistrer les modifications de ${name} ?`,
      close_window: (n) => `${n} fichier(s) non enregistré(s). Enregistrer avant de fermer ?`,
      quit: (n) => `${n} fichier(s) non enregistré(s). Enregistrer avant de quitter ?`,
      update: (n) => `La mise à jour nécessite un redémarrage et ${n} fichier(s) ne sont pas enregistré(s).`,
    },
    body: "Sans enregistrement, ces modifications seront perdues.",
    save: (n) => (n > 1 ? `Tout enregistrer (${n})` : "Enregistrer"),
    discard: "Ne pas enregistrer",
    cancel: "Annuler",
    sessionsKept: "Les sessions de terminal continuent en arrière-plan (macOS · Linux).",
    local: "Local",
  },
  de: {
    title: {
      close_tab: (_n, name) => `Änderungen an ${name} speichern?`,
      close_window: (n) => `${n} Datei(en) nicht gespeichert. Vor dem Schließen speichern?`,
      quit: (n) => `${n} Datei(en) nicht gespeichert. Vor dem Beenden speichern?`,
      update: (n) => `Das Update erfordert einen Neustart, und ${n} Datei(en) sind nicht gespeichert.`,
    },
    body: "Ohne Speichern gehen die Änderungen verloren.",
    save: (n) => (n > 1 ? `Alle speichern (${n})` : "Speichern"),
    discard: "Nicht speichern",
    cancel: "Abbrechen",
    sessionsKept: "Terminal-Sitzungen laufen im Hintergrund weiter (macOS · Linux).",
    local: "Lokal",
  },
  vi: {
    title: {
      close_tab: (_n, name) => `Lưu thay đổi của ${name}?`,
      close_window: (n) => `Có ${n} tệp chưa lưu. Lưu trước khi đóng?`,
      quit: (n) => `Có ${n} tệp chưa lưu. Lưu trước khi thoát?`,
      update: (n) => `Bản cập nhật cần khởi động lại, và có ${n} tệp chưa lưu.`,
    },
    body: "Nếu không lưu, các thay đổi sẽ mất.",
    save: (n) => (n > 1 ? `Lưu tất cả (${n})` : "Lưu"),
    discard: "Không lưu",
    cancel: "Hủy",
    sessionsKept: "Phiên terminal vẫn chạy nền (macOS · Linux).",
    local: "Cục bộ",
  },
  id: {
    title: {
      close_tab: (_n, name) => `Simpan perubahan pada ${name}?`,
      close_window: (n) => `Ada ${n} berkas belum disimpan. Simpan sebelum menutup?`,
      quit: (n) => `Ada ${n} berkas belum disimpan. Simpan sebelum keluar?`,
      update: (n) => `Pembaruan perlu memulai ulang, dan ada ${n} berkas belum disimpan.`,
    },
    body: "Jika tidak disimpan, perubahan akan hilang.",
    save: (n) => (n > 1 ? `Simpan semua (${n})` : "Simpan"),
    discard: "Jangan simpan",
    cancel: "Batal",
    sessionsKept: "Sesi terminal tetap berjalan di latar belakang (macOS · Linux).",
    local: "Lokal",
  },
  hi: {
    title: {
      close_tab: (_n, name) => `${name} के बदलाव सहेजें?`,
      close_window: (n) => `${n} फ़ाइलें सहेजी नहीं गईं। बंद करने से पहले सहेजें?`,
      quit: (n) => `${n} फ़ाइलें सहेजी नहीं गईं। बाहर निकलने से पहले सहेजें?`,
      update: (n) => `अपडेट के लिए पुनः आरंभ ज़रूरी है, और ${n} फ़ाइलें सहेजी नहीं गईं।`,
    },
    body: "न सहेजने पर बदलाव खो जाएँगे।",
    save: (n) => (n > 1 ? `सभी सहेजें (${n})` : "सहेजें"),
    discard: "न सहेजें",
    cancel: "रद्द करें",
    sessionsKept: "टर्मिनल सत्र पृष्ठभूमि में चलते रहते हैं (macOS · Linux)।",
    local: "स्थानीय",
  },
};

export function UnsavedDialog({
  docs,
  reason,
  hostLabel,
  onChoose,
}: {
  docs: FileDoc[];
  reason: UnsavedReason;
  hostLabel: (hostId: string) => string;
  onChoose: (c: UnsavedChoice) => void;
}) {
  const t = useT(STR);
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => saveRef.current?.focus(), []);
  const n = docs.length;
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") onChoose("cancel");
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}
    >
      <div role="alertdialog" style={{ width: 460, maxWidth: "92vw", background: "#23232a", border: "1px solid #3a3a44", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 10, color: "#e6e6e6" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t.title[reason](n, docs[0]?.name ?? "")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: "flex", gap: 8, fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "#1b1b21" }}>
              <span style={{ color: "#5b8def" }}>●</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.opened?.real_path ?? d.path}>
                {d.name}
              </span>
              <span style={{ color: "#8a93a3" }}>{d.hostId ? hostLabel(d.hostId) : t.local}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#b8c0cc" }}>{t.body}</div>
        {(reason === "quit" || reason === "update") && (
          <div style={{ fontSize: 11, color: "#8a93a3" }}>{t.sessionsKept}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={() => onChoose("discard")} style={btn("danger")}>
            {t.discard}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => onChoose("cancel")} style={btn("plain")}>
            {t.cancel}
          </button>
          <button ref={saveRef} onClick={() => onChoose("save")} style={btn("primary")}>
            {t.save(n)}
          </button>
        </div>
      </div>
    </div>
  );
}

function btn(kind: "danger" | "plain" | "primary"): React.CSSProperties {
  return {
    background: kind === "primary" ? "#2f5fb3" : kind === "danger" ? "#3a1f22" : "#2b2f38",
    color: kind === "danger" ? "#f08080" : "#fff",
    border: `1px solid ${kind === "primary" ? "#3d6fcc" : kind === "danger" ? "#a33" : "#4a505c"}`,
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
  };
}
