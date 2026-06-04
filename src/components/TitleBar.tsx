import { Tab } from "../types";
import { LangDict, useT } from "../i18n";

interface Props {
  activeTab: Tab | null;
  tabCount: number;
  /** 활성 패널이 SSH일 때만 enabled. 클릭 시 SFTP 파일 브라우저 오픈. */
  canOpenFiles: boolean;
  onOpenFiles: () => void;
  onOpenSettings: () => void;
  /** 입력 브로드캐스트(#59) 켜짐 여부 + 토글. */
  broadcast: boolean;
  onToggleBroadcast: () => void;
  /** 세션 대시보드(#62) 열기. */
  onOpenDashboard: () => void;
}

type Strings = {
  ready: string;
  split: (label: string) => string;
  ssh: (label: string) => string;
  localShell: (label: string) => string;
  tabCount: (n: number) => string;
  filesTitleEnabled: string;
  filesTitleDisabled: string;
  files: string;
  settingsTitle: string;
  settings: string;
  broadcast: string;
  dashboard: string;
};

const STR: LangDict<Strings> = {
  en: {
    ready: "Ready",
    split: (label) => `${label} (split)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `Local shell — ${label}`,
    tabCount: (n) => `${n} tabs`,
    filesTitleEnabled: "SFTP file browser (S-025)",
    filesTitleDisabled: "Available when an SSH panel is active",
    files: "📁 Files",
    settingsTitle: "Settings (S-054)",
    settings: "⚙ Settings",
    broadcast: "Broadcast input to all panes",
    dashboard: "Session dashboard",
  },
  ko: {
    ready: "준비됨",
    split: (label) => `${label} (분할)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `로컬 셸 — ${label}`,
    tabCount: (n) => `${n}개 탭`,
    filesTitleEnabled: "SFTP 파일 브라우저 (S-025)",
    filesTitleDisabled: "SSH 패널이 활성일 때 사용 가능",
    files: "📁 파일",
    settingsTitle: "설정 (S-054)",
    settings: "⚙ 설정",
    broadcast: "모든 패널에 입력 브로드캐스트",
    dashboard: "세션 대시보드",
  },
  es: {
    ready: "Listo",
    split: (label) => `${label} (dividido)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `Shell local — ${label}`,
    tabCount: (n) => `${n} pestañas`,
    filesTitleEnabled: "Explorador de archivos SFTP (S-025)",
    filesTitleDisabled: "Disponible cuando un panel SSH está activo",
    files: "📁 Archivos",
    settingsTitle: "Configuración (S-054)",
    settings: "⚙ Configuración",
    broadcast: "Difundir entrada a todos los paneles",
    dashboard: "Panel de sesiones",
  },
  zh: {
    ready: "就绪",
    split: (label) => `${label}（分屏）`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `本地 shell — ${label}`,
    tabCount: (n) => `${n} 个标签页`,
    filesTitleEnabled: "SFTP 文件浏览器 (S-025)",
    filesTitleDisabled: "在 SSH 面板处于活动状态时可用",
    files: "📁 文件",
    settingsTitle: "设置 (S-054)",
    settings: "⚙ 设置",
    broadcast: "向所有面板广播输入",
    dashboard: "会话仪表板",
  },
  ja: {
    ready: "準備完了",
    split: (label) => `${label} (分割)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `ローカルシェル — ${label}`,
    tabCount: (n) => `${n} タブ`,
    filesTitleEnabled: "SFTP ファイルブラウザ (S-025)",
    filesTitleDisabled: "SSH パネルがアクティブなときに使用可能",
    files: "📁 ファイル",
    settingsTitle: "設定 (S-054)",
    settings: "⚙ 設定",
    broadcast: "すべてのペインに入力をブロードキャスト",
    dashboard: "セッションダッシュボード",
  },
  ru: {
    ready: "Готово",
    split: (label) => `${label} (разделение)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `Локальный shell — ${label}`,
    tabCount: (n) => `Вкладок: ${n}`,
    filesTitleEnabled: "Файловый браузер SFTP (S-025)",
    filesTitleDisabled: "Доступно, когда активна панель SSH",
    files: "📁 Файлы",
    settingsTitle: "Настройки (S-054)",
    settings: "⚙ Настройки",
    broadcast: "Транслировать ввод во все панели",
    dashboard: "Панель сессий",
  },
  fr: {
    ready: "Prêt",
    split: (label) => `${label} (divisé)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `Shell local — ${label}`,
    tabCount: (n) => `${n} onglets`,
    filesTitleEnabled: "Explorateur de fichiers SFTP (S-025)",
    filesTitleDisabled: "Disponible lorsqu'un panneau SSH est actif",
    files: "📁 Fichiers",
    settingsTitle: "Paramètres (S-054)",
    settings: "⚙ Paramètres",
    broadcast: "Diffuser la saisie à tous les volets",
    dashboard: "Tableau de bord des sessions",
  },
  de: {
    ready: "Bereit",
    split: (label) => `${label} (geteilt)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `Lokale Shell — ${label}`,
    tabCount: (n) => `${n} Tabs`,
    filesTitleEnabled: "SFTP-Dateibrowser (S-025)",
    filesTitleDisabled: "Verfügbar, wenn ein SSH-Bereich aktiv ist",
    files: "📁 Dateien",
    settingsTitle: "Einstellungen (S-054)",
    settings: "⚙ Einstellungen",
    broadcast: "Eingabe an alle Bereiche senden",
    dashboard: "Sitzungs-Dashboard",
  },
  vi: {
    ready: "Sẵn sàng",
    split: (label) => `${label} (chia tách)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `Shell cục bộ — ${label}`,
    tabCount: (n) => `${n} tab`,
    filesTitleEnabled: "Trình duyệt tệp SFTP (S-025)",
    filesTitleDisabled: "Khả dụng khi một panel SSH đang hoạt động",
    files: "📁 Tệp",
    settingsTitle: "Cài đặt (S-054)",
    settings: "⚙ Cài đặt",
    broadcast: "Phát đầu vào tới tất cả khung",
    dashboard: "Bảng điều khiển phiên",
  },
  id: {
    ready: "Siap",
    split: (label) => `${label} (terbagi)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `Shell lokal — ${label}`,
    tabCount: (n) => `${n} tab`,
    filesTitleEnabled: "Penjelajah berkas SFTP (S-025)",
    filesTitleDisabled: "Tersedia saat panel SSH aktif",
    files: "📁 Berkas",
    settingsTitle: "Pengaturan (S-054)",
    settings: "⚙ Pengaturan",
    broadcast: "Siarkan input ke semua panel",
    dashboard: "Dasbor sesi",
  },
  hi: {
    ready: "तैयार",
    split: (label) => `${label} (विभाजित)`,
    ssh: (label) => `SSH — ${label}`,
    localShell: (label) => `लोकल shell — ${label}`,
    tabCount: (n) => `${n} टैब`,
    filesTitleEnabled: "SFTP फ़ाइल ब्राउज़र (S-025)",
    filesTitleDisabled: "जब कोई SSH पैनल सक्रिय हो तब उपलब्ध",
    files: "📁 फ़ाइलें",
    settingsTitle: "सेटिंग्स (S-054)",
    settings: "⚙ सेटिंग्स",
    broadcast: "सभी पैनल में इनपुट प्रसारित करें",
    dashboard: "सत्र डैशबोर्ड",
  },
};

/** 세션 대시보드 아이콘 (레이아웃/패널 개요). Feather 'layout' 스타일. */
function DashboardIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

/** 입력 브로드캐스트 아이콘 (전파 발신). Feather 'radio' 스타일. */
function BroadcastIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
    </svg>
  );
}

function subtitleFor(tab: Tab, t: Strings): string {
  if (tab.root.kind === "split") return t.split(tab.label);
  return tab.root.source.kind === "ssh"
    ? t.ssh(tab.label)
    : t.localShell(tab.label);
}

export function TitleBar({
  activeTab,
  tabCount,
  canOpenFiles,
  onOpenFiles,
  onOpenSettings,
  broadcast,
  onToggleBroadcast,
  onOpenDashboard,
}: Props) {
  const t = useT(STR);
  const subtitle = activeTab ? subtitleFor(activeTab, t) : t.ready;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "#1f1f23",
        color: "#cccccc",
        borderBottom: "1px solid #111",
        padding: "0 12px",
        height: 32,
        userSelect: "none",
        fontSize: 12,
      }}
    >
      <strong style={{ marginRight: 16, color: "#fff" }}>AI Terminal</strong>
      <span style={{ color: "#9aa", flex: 1 }}>{subtitle}</span>
      <span style={{ color: "#888", marginRight: 12 }}>{t.tabCount(tabCount)}</span>
      <button
        onClick={onOpenDashboard}
        title={t.dashboard}
        style={{
          display: "flex",
          alignItems: "center",
          background: "transparent",
          border: "1px solid transparent",
          color: "#cccccc",
          cursor: "pointer",
          borderRadius: 4,
          padding: "3px 6px",
          marginRight: 6,
        }}
      >
        <DashboardIcon />
      </button>
      <button
        onClick={onToggleBroadcast}
        title={t.broadcast}
        style={{
          display: "flex",
          alignItems: "center",
          background: broadcast ? "#7a1f1f" : "transparent",
          border: broadcast ? "1px solid #c0504d" : "1px solid transparent",
          color: broadcast ? "#ffd0d0" : "#cccccc",
          cursor: "pointer",
          borderRadius: 4,
          padding: "3px 6px",
          marginRight: 6,
        }}
      >
        <BroadcastIcon />
      </button>
      <button
        onClick={onOpenFiles}
        disabled={!canOpenFiles}
        style={{
          background: "transparent",
          border: "none",
          color: canOpenFiles ? "#cccccc" : "#555",
          cursor: canOpenFiles ? "pointer" : "not-allowed",
          fontSize: 13,
          marginRight: 8,
        }}
        title={
          canOpenFiles ? t.filesTitleEnabled : t.filesTitleDisabled
        }
      >
        {t.files}
      </button>
      <button
        onClick={onOpenSettings}
        style={{
          background: "transparent",
          border: "none",
          color: "#cccccc",
          cursor: "pointer",
          fontSize: 13,
        }}
        title={t.settingsTitle}
      >
        {t.settings}
      </button>
    </div>
  );
}
