import { Tab } from "../types";
import { LangDict, useT } from "../i18n";

interface Props {
  activeTab: Tab | null;
  tabCount: number;
  /** 활성 패널이 SSH일 때만 enabled. 클릭 시 SFTP 파일 브라우저 오픈. */
  canOpenFiles: boolean;
  onOpenFiles: () => void;
  onOpenSettings: () => void;
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
  },
};

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
