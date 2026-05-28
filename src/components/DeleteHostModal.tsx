import { SshHost } from "../types";
import { LangDict, useT } from "../i18n";

interface Props {
  host: SshHost;
  /** 이 호스트로 연결된 현재 활성 탭/패널 수. 0이면 "연결된 세션 없음". */
  activeSessionCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

const STR: LangDict<{
    title: string;
    permaDeleteBefore: string;
    permaDeleteAfter: string;
    activeSessions1: string;
    activeSessions2: string;
    noSessions: string;
    irreversibleNote: string;
    cancel: string;
    delete: string;
  }
> = {
  en: {
    title: "Delete SSH host",
    permaDeleteBefore: "Permanently deleting the ",
    permaDeleteAfter: " host.",
    activeSessions1: "There are currently ",
    activeSessions2:
      " active session(s)/pane(s) using this host. They will be closed immediately after deletion.",
    noSessions: "No connected sessions.",
    irreversibleNote:
      "Deletion cannot be undone. (Stored secrets are managed separately in the SSH key manager.)",
    cancel: "Cancel",
    delete: "Delete",
  },
  ko: {
    title: "SSH 호스트 삭제",
    permaDeleteBefore: "",
    permaDeleteAfter: " 호스트를 영구 삭제합니다.",
    activeSessions1: "현재 이 호스트를 사용 중인 활성 세션/패널이 ",
    activeSessions2: "개 있습니다. 삭제 후 즉시 종료됩니다.",
    noSessions: "연결된 세션 없음.",
    irreversibleNote:
      "삭제는 되돌릴 수 없습니다. (저장된 시크릿은 별도로 SSH 키 매니저에서 관리됩니다.)",
    cancel: "취소",
    delete: "삭제",
  },
  es: {
    title: "Eliminar host SSH",
    permaDeleteBefore: "Eliminando permanentemente el host ",
    permaDeleteAfter: ".",
    activeSessions1: "Actualmente hay ",
    activeSessions2:
      " sesión(es)/panel(es) activos que usan este host. Se cerrarán de inmediato tras la eliminación.",
    noSessions: "No hay sesiones conectadas.",
    irreversibleNote:
      "La eliminación no se puede deshacer. (Los secretos almacenados se gestionan por separado en el gestor de claves SSH.)",
    cancel: "Cancelar",
    delete: "Eliminar",
  },
  zh: {
    title: "删除 SSH 主机",
    permaDeleteBefore: "正在永久删除主机 ",
    permaDeleteAfter: "。",
    activeSessions1: "当前有 ",
    activeSessions2:
      " 个使用此主机的活动会话/窗格。删除后将立即关闭。",
    noSessions: "无已连接的会话。",
    irreversibleNote:
      "删除无法撤销。（存储的密钥在 SSH 密钥管理器中单独管理。）",
    cancel: "取消",
    delete: "删除",
  },
  ja: {
    title: "SSH ホストを削除",
    permaDeleteBefore: "ホスト ",
    permaDeleteAfter: " を完全に削除します。",
    activeSessions1: "現在このホストを使用中のアクティブなセッション／ペインが ",
    activeSessions2: " 個あります。削除後すぐに閉じられます。",
    noSessions: "接続中のセッションはありません。",
    irreversibleNote:
      "削除は元に戻せません。（保存されたシークレットは SSH キーマネージャーで別途管理されます。）",
    cancel: "キャンセル",
    delete: "削除",
  },
  ru: {
    title: "Удалить SSH-хост",
    permaDeleteBefore: "Безвозвратное удаление хоста ",
    permaDeleteAfter: ".",
    activeSessions1: "Сейчас есть ",
    activeSessions2:
      " активных сеансов/панелей, использующих этот хост. Они будут немедленно закрыты после удаления.",
    noSessions: "Нет подключённых сеансов.",
    irreversibleNote:
      "Удаление нельзя отменить. (Сохранённые секреты управляются отдельно в менеджере SSH-ключей.)",
    cancel: "Отмена",
    delete: "Удалить",
  },
  fr: {
    title: "Supprimer l'hôte SSH",
    permaDeleteBefore: "Suppression définitive de l'hôte ",
    permaDeleteAfter: ".",
    activeSessions1: "Il y a actuellement ",
    activeSessions2:
      " session(s)/volet(s) actifs utilisant cet hôte. Ils seront fermés immédiatement après la suppression.",
    noSessions: "Aucune session connectée.",
    irreversibleNote:
      "La suppression est irréversible. (Les secrets stockés sont gérés séparément dans le gestionnaire de clés SSH.)",
    cancel: "Annuler",
    delete: "Supprimer",
  },
  de: {
    title: "SSH-Host löschen",
    permaDeleteBefore: "Der Host ",
    permaDeleteAfter: " wird dauerhaft gelöscht.",
    activeSessions1: "Es gibt derzeit ",
    activeSessions2:
      " aktive Sitzung(en)/Bereich(e), die diesen Host nutzen. Sie werden unmittelbar nach dem Löschen geschlossen.",
    noSessions: "Keine verbundenen Sitzungen.",
    irreversibleNote:
      "Das Löschen kann nicht rückgängig gemacht werden. (Gespeicherte Secrets werden separat im SSH-Schlüsselmanager verwaltet.)",
    cancel: "Abbrechen",
    delete: "Löschen",
  },
  vi: {
    title: "Xóa host SSH",
    permaDeleteBefore: "Đang xóa vĩnh viễn host ",
    permaDeleteAfter: ".",
    activeSessions1: "Hiện có ",
    activeSessions2:
      " phiên/khung đang hoạt động sử dụng host này. Chúng sẽ bị đóng ngay sau khi xóa.",
    noSessions: "Không có phiên nào được kết nối.",
    irreversibleNote:
      "Việc xóa không thể hoàn tác. (Các bí mật đã lưu được quản lý riêng trong trình quản lý khóa SSH.)",
    cancel: "Hủy",
    delete: "Xóa",
  },
  id: {
    title: "Hapus host SSH",
    permaDeleteBefore: "Menghapus host ",
    permaDeleteAfter: " secara permanen.",
    activeSessions1: "Saat ini ada ",
    activeSessions2:
      " sesi/panel aktif yang menggunakan host ini. Semuanya akan ditutup segera setelah dihapus.",
    noSessions: "Tidak ada sesi yang terhubung.",
    irreversibleNote:
      "Penghapusan tidak dapat dibatalkan. (Rahasia yang tersimpan dikelola secara terpisah di pengelola kunci SSH.)",
    cancel: "Batal",
    delete: "Hapus",
  },
  hi: {
    title: "SSH होस्ट हटाएँ",
    permaDeleteBefore: "होस्ट ",
    permaDeleteAfter: " को स्थायी रूप से हटाया जा रहा है।",
    activeSessions1: "इस समय इस होस्ट का उपयोग करने वाले ",
    activeSessions2:
      " सक्रिय सत्र/पैन हैं। हटाने के तुरंत बाद वे बंद हो जाएँगे।",
    noSessions: "कोई कनेक्टेड सत्र नहीं।",
    irreversibleNote:
      "हटाने को पूर्ववत नहीं किया जा सकता। (संग्रहीत सीक्रेट SSH की मैनेजर में अलग से प्रबंधित किए जाते हैं।)",
    cancel: "रद्द करें",
    delete: "हटाएँ",
  },
};

export function DeleteHostModal({
  host,
  activeSessionCount,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT(STR);
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
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "90vw",
          background: "#262630",
          border: "1px solid #5a1d1d",
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
          <span
            style={{
              fontSize: 22,
              color: "#ff6b6b",
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "2px solid #ff6b6b",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            !
          </span>
          <strong style={{ fontSize: 15 }}>{t.title}</strong>
        </header>

        <div style={{ lineHeight: 1.5 }}>
          <div style={{ marginBottom: 8 }}>
            {t.permaDeleteBefore}
            <strong style={{ color: "#ff8c8c" }}>{host.name}</strong>
            {t.permaDeleteAfter}
          </div>
          <div style={{ color: "#9aa", fontSize: 12, marginBottom: 8 }}>
            {host.user}@{host.host}:{host.port}
          </div>

          {activeSessionCount > 0 ? (
            <div
              style={{
                background: "#3a1d1d",
                border: "1px solid #6a2828",
                borderRadius: 4,
                padding: "8px 10px",
                marginBottom: 10,
                color: "#fdd",
              }}
            >
              {t.activeSessions1}
              <strong>{activeSessionCount}</strong>
              {t.activeSessions2}
            </div>
          ) : (
            <div style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>
              {t.noSessions}
            </div>
          )}

          <div style={{ color: "#bbb", fontSize: 12, marginBottom: 16 }}>
            {t.irreversibleNote}
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
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
            autoFocus
          >
            {t.cancel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 14px",
              background: "#a02020",
              color: "#fff",
              border: "1px solid #c83838",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {t.delete}
          </button>
        </footer>
      </div>
    </div>
  );
}
