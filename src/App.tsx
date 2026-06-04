import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { onCommandDone } from "./commandBus";
import { getHistory } from "./commandHistory";
import { loadSnippets } from "./snippets";
import { CommandPalette, PaletteItem } from "./components/CommandPalette";
import { SessionDashboard, DashRow } from "./components/SessionDashboard";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { TabContextMenu } from "./components/TabContextMenu";
import { HostList } from "./components/HostList";
import { AIPanel } from "./components/AIPanel";
import { PaneView } from "./components/PaneView";
import { FileBrowser } from "./components/FileBrowser";
import { SettingsModal } from "./components/SettingsModal";
import { SplashScreen } from "./components/SplashScreen";
import { LangDict, LangProvider, useT } from "./i18n";
import { OnboardingFlow } from "./components/OnboardingFlow";
import {
  AppSettings,
  loadSettings,
  saveSettings,
  matchesBinding,
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
} from "./settings";
import { isOnboarded, setOnboarded } from "./onboarding";
import {
  HostKeyMismatchModal,
  MismatchInfo,
} from "./components/HostKeyMismatchModal";
import {
  FirstContactModal,
  FirstContactInfo,
} from "./components/FirstContactModal";
import {
  PasswordPromptModal,
  PasswordPromptInfo,
} from "./components/PasswordPromptModal";
import { ConnectionErrorModal } from "./components/ConnectionErrorModal";
import { getTerminal, setBroadcastEnabled } from "./terminalRegistry";
import {
  Pane,
  SshConnectError,
  SshHost,
  Tab,
  TerminalSource,
  collectLeaves,
  findLeaf,
  firstLeafId,
  neighborLeafId,
  removeLeaf,
  setRatioByPath,
  splitLeaf,
} from "./types";
import "./App.css";

/** detached 윈도우는 라벨이 "detached-..."로 시작. 동기적으로 알아야 초기 탭을 안 띄울 수 있음. */
const CURRENT_WINDOW_LABEL = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();
const IS_DETACHED_WINDOW = CURRENT_WINDOW_LABEL.startsWith("detached-");

interface DetachedInit {
  source: TerminalSource;
  label: string;
  sessionId?: string | null;
  screen?: string | null;
  aiSessionId?: string | null;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const STR: LangDict<{
    localShell: string;
    localShellN: (n: number) => string;
    dup: (label: string) => string;
    keychainSaveFail: (e: string) => string;
    detachWindowFail: (e: string) => string;
    initDetached: string;
    dropToDetach: string;
    escCancel: string;
    hostExpand: string;
    hostCollapse: string;
    aiExpand: string;
    aiCollapse: string;
    resizeWidth: string;
  }
> = {
  en: {
    localShell: "Local shell",
    localShellN: (n) => `Local shell ${n}`,
    dup: (label) => `${label} (copy)`,
    keychainSaveFail: (e) => `Keychain save failed: ${e}`,
    detachWindowFail: (e) => `Failed to open new window: ${e}`,
    initDetached: "Initializing detached window…",
    dropToDetach: "Drop here to detach into a new window",
    escCancel: "ESC: cancel",
    hostExpand: "Expand host panel",
    hostCollapse: "Collapse host panel",
    aiExpand: "Expand AI panel",
    aiCollapse: "Collapse AI panel",
    resizeWidth: "Drag to resize width",
  },
  ko: {
    localShell: "로컬 셸",
    localShellN: (n) => `로컬 셸 ${n}`,
    dup: (label) => `${label} (복제)`,
    keychainSaveFail: (e) => `Keychain 저장 실패: ${e}`,
    detachWindowFail: (e) => `새 창 생성 실패: ${e}`,
    initDetached: "분리된 창 초기화 중…",
    dropToDetach: "여기서 떼면 새 창으로 분리",
    escCancel: "ESC: 취소",
    hostExpand: "호스트 패널 펴기",
    hostCollapse: "호스트 패널 접기",
    aiExpand: "AI 패널 펴기",
    aiCollapse: "AI 패널 접기",
    resizeWidth: "너비 조절 (드래그)",
  },
  es: {
    localShell: "Shell local",
    localShellN: (n) => `Shell local ${n}`,
    dup: (label) => `${label} (copia)`,
    keychainSaveFail: (e) => `Error al guardar en Keychain: ${e}`,
    detachWindowFail: (e) => `No se pudo abrir la nueva ventana: ${e}`,
    initDetached: "Inicializando ventana separada…",
    dropToDetach: "Suelta aquí para separar en una nueva ventana",
    escCancel: "ESC: cancelar",
    hostExpand: "Expandir panel de hosts",
    hostCollapse: "Contraer panel de hosts",
    aiExpand: "Expandir panel de IA",
    aiCollapse: "Contraer panel de IA",
    resizeWidth: "Arrastra para ajustar el ancho",
  },
  zh: {
    localShell: "本地终端",
    localShellN: (n) => `本地终端 ${n}`,
    dup: (label) => `${label}（副本）`,
    keychainSaveFail: (e) => `Keychain 保存失败：${e}`,
    detachWindowFail: (e) => `无法打开新窗口：${e}`,
    initDetached: "正在初始化分离窗口…",
    dropToDetach: "拖放到此处以分离为新窗口",
    escCancel: "ESC：取消",
    hostExpand: "展开主机面板",
    hostCollapse: "收起主机面板",
    aiExpand: "展开 AI 面板",
    aiCollapse: "收起 AI 面板",
    resizeWidth: "拖动以调整宽度",
  },
  ja: {
    localShell: "ローカルシェル",
    localShellN: (n) => `ローカルシェル ${n}`,
    dup: (label) => `${label}（コピー）`,
    keychainSaveFail: (e) => `Keychain への保存に失敗しました: ${e}`,
    detachWindowFail: (e) => `新しいウィンドウを開けませんでした: ${e}`,
    initDetached: "分離ウィンドウを初期化中…",
    dropToDetach: "ここにドロップして新しいウィンドウに分離",
    escCancel: "ESC: キャンセル",
    hostExpand: "ホストパネルを開く",
    hostCollapse: "ホストパネルを閉じる",
    aiExpand: "AI パネルを開く",
    aiCollapse: "AI パネルを閉じる",
    resizeWidth: "ドラッグして幅を調整",
  },
  ru: {
    localShell: "Локальная оболочка",
    localShellN: (n) => `Локальная оболочка ${n}`,
    dup: (label) => `${label} (копия)`,
    keychainSaveFail: (e) => `Не удалось сохранить в Keychain: ${e}`,
    detachWindowFail: (e) => `Не удалось открыть новое окно: ${e}`,
    initDetached: "Инициализация отдельного окна…",
    dropToDetach: "Отпустите здесь, чтобы открепить в новое окно",
    escCancel: "ESC: отмена",
    hostExpand: "Развернуть панель хостов",
    hostCollapse: "Свернуть панель хостов",
    aiExpand: "Развернуть панель ИИ",
    aiCollapse: "Свернуть панель ИИ",
    resizeWidth: "Перетащите, чтобы изменить ширину",
  },
  fr: {
    localShell: "Shell local",
    localShellN: (n) => `Shell local ${n}`,
    dup: (label) => `${label} (copie)`,
    keychainSaveFail: (e) => `Échec de l'enregistrement dans Keychain : ${e}`,
    detachWindowFail: (e) => `Impossible d'ouvrir la nouvelle fenêtre : ${e}`,
    initDetached: "Initialisation de la fenêtre détachée…",
    dropToDetach: "Déposez ici pour détacher dans une nouvelle fenêtre",
    escCancel: "ESC : annuler",
    hostExpand: "Développer le panneau des hôtes",
    hostCollapse: "Réduire le panneau des hôtes",
    aiExpand: "Développer le panneau IA",
    aiCollapse: "Réduire le panneau IA",
    resizeWidth: "Faites glisser pour ajuster la largeur",
  },
  de: {
    localShell: "Lokale Shell",
    localShellN: (n) => `Lokale Shell ${n}`,
    dup: (label) => `${label} (Kopie)`,
    keychainSaveFail: (e) => `Speichern im Keychain fehlgeschlagen: ${e}`,
    detachWindowFail: (e) => `Neues Fenster konnte nicht geöffnet werden: ${e}`,
    initDetached: "Abgetrenntes Fenster wird initialisiert…",
    dropToDetach: "Hier ablegen, um in ein neues Fenster abzutrennen",
    escCancel: "ESC: abbrechen",
    hostExpand: "Host-Panel ausklappen",
    hostCollapse: "Host-Panel einklappen",
    aiExpand: "KI-Panel ausklappen",
    aiCollapse: "KI-Panel einklappen",
    resizeWidth: "Zum Anpassen der Breite ziehen",
  },
  vi: {
    localShell: "Shell cục bộ",
    localShellN: (n) => `Shell cục bộ ${n}`,
    dup: (label) => `${label} (bản sao)`,
    keychainSaveFail: (e) => `Lưu vào Keychain thất bại: ${e}`,
    detachWindowFail: (e) => `Không thể mở cửa sổ mới: ${e}`,
    initDetached: "Đang khởi tạo cửa sổ tách rời…",
    dropToDetach: "Thả vào đây để tách thành cửa sổ mới",
    escCancel: "ESC: hủy",
    hostExpand: "Mở rộng bảng host",
    hostCollapse: "Thu gọn bảng host",
    aiExpand: "Mở rộng bảng AI",
    aiCollapse: "Thu gọn bảng AI",
    resizeWidth: "Kéo để chỉnh chiều rộng",
  },
  id: {
    localShell: "Shell lokal",
    localShellN: (n) => `Shell lokal ${n}`,
    dup: (label) => `${label} (salinan)`,
    keychainSaveFail: (e) => `Gagal menyimpan ke Keychain: ${e}`,
    detachWindowFail: (e) => `Gagal membuka jendela baru: ${e}`,
    initDetached: "Menginisialisasi jendela terpisah…",
    dropToDetach: "Lepaskan di sini untuk memisahkan ke jendela baru",
    escCancel: "ESC: batal",
    hostExpand: "Perluas panel host",
    hostCollapse: "Ciutkan panel host",
    aiExpand: "Perluas panel AI",
    aiCollapse: "Ciutkan panel AI",
    resizeWidth: "Seret untuk mengubah lebar",
  },
  hi: {
    localShell: "लोकल शेल",
    localShellN: (n) => `लोकल शेल ${n}`,
    dup: (label) => `${label} (प्रतिलिपि)`,
    keychainSaveFail: (e) => `Keychain में सहेजना विफल: ${e}`,
    detachWindowFail: (e) => `नई विंडो खोलने में विफल: ${e}`,
    initDetached: "अलग की गई विंडो प्रारंभ हो रही है…",
    dropToDetach: "नई विंडो में अलग करने के लिए यहाँ छोड़ें",
    escCancel: "ESC: रद्द करें",
    hostExpand: "होस्ट पैनल विस्तृत करें",
    hostCollapse: "होस्ट पैनल संक्षिप्त करें",
    aiExpand: "AI पैनल विस्तृत करें",
    aiCollapse: "AI पैनल संक्षिप्त करें",
    resizeWidth: "चौड़ाई बदलने के लिए खींचें",
  },
};

// 좌/우 패널 너비 조절용 구분선 (#21). 좌우 분할 divider와 동일 룩 + 접기 버튼을 얹는다.
const panelDividerStyle: CSSProperties = {
  position: "relative",
  flex: "0 0 4px",
  background: "#0a0a10",
  cursor: "col-resize",
  userSelect: "none",
};

const dividerToggleStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 16,
  height: 44,
  borderRadius: 8,
  border: "1px solid #2a3a4a",
  background: "#202a38",
  color: "#9cf",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  padding: 0,
  zIndex: 5,
};

const collapsedHandleStyle: CSSProperties = {
  flexShrink: 0,
  width: 14,
  border: "none",
  background: "#202028",
  color: "#9aa",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  padding: 0,
};

/**
 * 패널과 터미널 사이의 경계 (#21).
 * - 펴진 상태: 너비 조절 구분선 + 중앙에 접기 화살표 버튼.
 * - 접힌 상태: 화면 가장자리의 얇은 펴기 핸들(화살표).
 * 화살표는 패널이 움직이는 방향을 가리킨다(host 접기=‹, ai 접기=›).
 */
function PanelEdge({
  side,
  collapsed,
  onToggle,
  onResizeStart,
}: {
  side: "host" | "ai";
  collapsed: boolean;
  onToggle: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const t = useT(STR);
  const arrow = collapsed
    ? side === "host"
      ? "›"
      : "‹"
    : side === "host"
      ? "‹"
      : "›";
  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        title={side === "host" ? t.hostExpand : t.aiExpand}
        style={{
          ...collapsedHandleStyle,
          [side === "host" ? "borderRight" : "borderLeft"]: "1px solid #111",
        }}
      >
        {arrow}
      </button>
    );
  }
  return (
    <div
      onMouseDown={onResizeStart}
      style={panelDividerStyle}
      title={t.resizeWidth}
    >
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggle}
        title={side === "host" ? t.hostCollapse : t.aiCollapse}
        style={dividerToggleStyle}
      >
        {arrow}
      </button>
    </div>
  );
}

function makeLocalTab(label: string): Tab {
  const leafId = newId();
  return {
    id: newId(),
    label,
    root: { kind: "leaf", id: leafId, source: { kind: "local" } },
    focusedPaneId: leafId,
  };
}

function makeSshTab(hostId: string, label: string): Tab {
  const leafId = newId();
  return {
    id: newId(),
    label,
    root: { kind: "leaf", id: leafId, source: { kind: "ssh", hostId } },
    focusedPaneId: leafId,
  };
}

/** root의 모든 leaf id를 재발급해 복제. PTY/SSH 세션이 새로 spawn되도록. */
function cloneRootWithNewIds(root: Pane): Pane {
  if (root.kind === "leaf") {
    return { kind: "leaf", id: newId(), source: root.source };
  }
  return {
    ...root,
    first: cloneRootWithNewIds(root.first),
    second: cloneRootWithNewIds(root.second),
  };
}

// 명령 팔레트(⌘K) 라벨.
const PAL_STR: LangDict<{
  placeholder: string;
  noResults: string;
  newLocalTab: string;
  settings: string;
  openFiles: string;
  connect: string;
  run: string;
  snippet: string;
  dashboard: string;
}> = {
  en: { placeholder: "Type a command, host, or recent command…", noResults: "No results", newLocalTab: "New local tab", settings: "Settings", openFiles: "Open file browser", connect: "Connect", run: "run", snippet: "snippet", dashboard: "Session dashboard" },
  ko: { placeholder: "명령·호스트·최근 명령 입력…", noResults: "결과 없음", newLocalTab: "새 로컬 탭", settings: "설정", openFiles: "파일 브라우저 열기", connect: "접속", run: "실행", snippet: "스니펫", dashboard: "세션 대시보드" },
  es: { placeholder: "Escribe un comando, host o comando reciente…", noResults: "Sin resultados", newLocalTab: "Nueva pestaña local", settings: "Configuración", openFiles: "Abrir explorador de archivos", connect: "Conectar", run: "ejecutar", snippet: "fragmento", dashboard: "Panel de sesiones" },
  zh: { placeholder: "输入命令、主机或最近命令…", noResults: "无结果", newLocalTab: "新建本地标签页", settings: "设置", openFiles: "打开文件浏览器", connect: "连接", run: "运行", snippet: "片段", dashboard: "会话仪表板" },
  ja: { placeholder: "コマンド・ホスト・最近のコマンドを入力…", noResults: "結果なし", newLocalTab: "新しいローカルタブ", settings: "設定", openFiles: "ファイルブラウザを開く", connect: "接続", run: "実行", snippet: "スニペット", dashboard: "セッションダッシュボード" },
  ru: { placeholder: "Введите команду, хост или недавнюю команду…", noResults: "Нет результатов", newLocalTab: "Новая локальная вкладка", settings: "Настройки", openFiles: "Открыть файловый браузер", connect: "Подключиться", run: "выполнить", snippet: "сниппет", dashboard: "Панель сессий" },
  fr: { placeholder: "Tapez une commande, un hôte ou une commande récente…", noResults: "Aucun résultat", newLocalTab: "Nouvel onglet local", settings: "Paramètres", openFiles: "Ouvrir l'explorateur de fichiers", connect: "Se connecter", run: "exécuter", snippet: "extrait", dashboard: "Tableau de bord des sessions" },
  de: { placeholder: "Befehl, Host oder letzten Befehl eingeben…", noResults: "Keine Ergebnisse", newLocalTab: "Neuer lokaler Tab", settings: "Einstellungen", openFiles: "Dateibrowser öffnen", connect: "Verbinden", run: "ausführen", snippet: "Snippet", dashboard: "Sitzungs-Dashboard" },
  vi: { placeholder: "Nhập lệnh, máy chủ hoặc lệnh gần đây…", noResults: "Không có kết quả", newLocalTab: "Tab cục bộ mới", settings: "Cài đặt", openFiles: "Mở trình duyệt tệp", connect: "Kết nối", run: "chạy", snippet: "đoạn mã", dashboard: "Bảng điều khiển phiên" },
  id: { placeholder: "Ketik perintah, host, atau perintah terbaru…", noResults: "Tidak ada hasil", newLocalTab: "Tab lokal baru", settings: "Pengaturan", openFiles: "Buka penjelajah berkas", connect: "Hubungkan", run: "jalankan", snippet: "cuplikan", dashboard: "Dasbor sesi" },
  hi: { placeholder: "कमांड, होस्ट या हाल की कमांड टाइप करें…", noResults: "कोई परिणाम नहीं", newLocalTab: "नया लोकल टैब", settings: "सेटिंग्स", openFiles: "फ़ाइल ब्राउज़र खोलें", connect: "कनेक्ट करें", run: "चलाएं", snippet: "स्निपेट", dashboard: "सत्र डैशबोर्ड" },
};

function App() {
  const tr = useT(STR);
  const pal = useT(PAL_STR);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  // #62 세션 대시보드: 열림 여부 + 패널별 명령 통계.
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [sessionStats, setSessionStats] = useState<
    Record<
      string,
      { count: number; lastExit: number; lastDurationMs: number; lastAt: number }
    >
  >({});
  // #59 입력 브로드캐스트: 켜면 한 패널 입력이 모든 패널로. 모듈 레지스트리에 동기화.
  const [broadcast, setBroadcast] = useState(false);
  useEffect(() => {
    setBroadcastEnabled(broadcast);
  }, [broadcast]);
  // detached 윈도우는 백엔드 registry에서 source를 받기 전까지 빈 상태로 시작 — 메인은 즉시 로컬셸.
  const [tabs, setTabs] = useState<Tab[]>(() =>
    IS_DETACHED_WINDOW ? [] : [makeLocalTab(tr.localShellN(1))],
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(() =>
    IS_DETACHED_WINDOW ? null : tabs[0].id,
  );
  const [bootstrapped, setBootstrapped] = useState<boolean>(!IS_DETACHED_WINDOW);
  // 백그라운드 탭에서 오래 걸린 명령이 끝나면 알림 + 탭 배지 (#55, OSC 133 D).
  const [tabAlerts, setTabAlerts] = useState<Set<string>>(() => new Set());
  // 메인 윈도우 시작 흐름: 스플래시 → (첫 실행이면) 온보딩 → 준비. detached는 바로 준비.
  const [phase, setPhase] = useState<"splash" | "onboarding" | "ready">(() =>
    IS_DETACHED_WINDOW ? "ready" : "splash",
  );
  useEffect(() => {
    if (phase !== "splash") return;
    const t = setTimeout(() => {
      setPhase(isOnboarded() ? "ready" : "onboarding");
    }, 900);
    return () => clearTimeout(t);
  }, [phase]);
  const [retryByLeaf, setRetryByLeaf] = useState<Record<string, number>>({});
  const [passwordByLeaf, setPasswordByLeaf] = useState<Record<string, string>>({});
  /** leaf id → 사용자가 모달에서 "Keychain에 저장"을 체크했는지. 접속 성공 후 처리. */
  const [rememberByLeaf, setRememberByLeaf] = useState<Record<string, boolean>>({});
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  // 탭 드래그 분리 (pointer 기반 — WKWebView HTML5 DnD 불안정).
  const [drag, setDrag] = useState<{ tabId: string; active: boolean } | null>(null);
  // leaf id → spawn된 sessionId (세션 인계 시 조회).
  const sessionByLeaf = useRef<Record<string, string>>({});
  // leaf id → attach할 기존 sessionId (분리 윈도우 부트스트랩).
  const [attachSessionByLeaf, setAttachSessionByLeaf] = useState<Record<string, string>>({});
  const [attachScreenByLeaf, setAttachScreenByLeaf] = useState<Record<string, string>>({});
  // 탭별 활성 AI 대화 세션 id (분리 시 새 창에 인계). AIPanel.onActiveSession이 채움.
  const aiSessionByTab = useRef<Record<string, string | null>>({});
  const [attachAiByTab, setAttachAiByTab] = useState<Record<string, string>>({});
  const [fileBrowser, setFileBrowser] = useState<{
    hostId: string;
    hostLabel: string;
    initialRemotePath?: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  function updateSettings(s: AppSettings) {
    setSettings(s);
    saveSettings(s);
  }

  const lang = settings.general.language;
  // UI 글꼴(호스트 목록·AI 패널 등)을 body에 적용 — 모든 UI가 상속. 터미널은 xterm 자체 폰트 사용.
  useEffect(() => {
    document.body.style.fontFamily = settings.general.uiFont;
  }, [settings.general.uiFont]);
  // 좌/우 패널 토글 + 너비 리사이즈 (#21). 상태는 settings.layout에 영속화.
  const layout = settings.layout;
  const layoutRowRef = useRef<HTMLDivElement>(null);
  function toggleHostPanel() {
    updateSettings({
      ...settings,
      layout: { ...layout, showHostPanel: !layout.showHostPanel },
    });
  }
  function toggleAiPanel() {
    updateSettings({
      ...settings,
      layout: { ...layout, showAiPanel: !layout.showAiPanel },
    });
  }
  function startPanelResize(side: "host" | "ai", e: React.MouseEvent) {
    e.preventDefault();
    const rect = layoutRowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clamp = (w: number) =>
      Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, w));
    const onMove = (ev: MouseEvent) => {
      const w =
        side === "host"
          ? clamp(ev.clientX - rect.left)
          : clamp(rect.right - ev.clientX);
      setSettings((prev) => ({
        ...prev,
        layout: {
          ...prev.layout,
          [side === "host" ? "hostPanelWidth" : "aiPanelWidth"]: w,
        },
      }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // 드래그 종료 시 최신 상태를 localStorage에 영속화.
      setSettings((prev) => {
        saveSettings(prev);
        return prev;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const [hosts, setHosts] = useState<SshHost[]>([]);
  const reloadHosts = useCallback(async () => {
    try {
      const list = await invoke<SshHost[]>("ssh_list_hosts");
      setHosts(list);
    } catch {
      /* HostList가 별도로 에러 표시 */
    }
  }, []);
  useEffect(() => {
    void reloadHosts();
  }, [reloadHosts]);

  // detached 윈도우 부트스트랩: 백엔드 registry에서 source를 받아 첫 탭 구성.
  // StrictMode(dev)는 effect를 두 번 실행하는데, detached_init은 registry에서 항목을
  // 꺼내며 제거하므로 두 번째 호출은 None을 받아 새 세션으로 fallback된다 → 1회 가드.
  const detachedInitRan = useRef(false);
  useEffect(() => {
    if (!IS_DETACHED_WINDOW || detachedInitRan.current) return;
    detachedInitRan.current = true;
    (async () => {
      try {
        const init = await invoke<DetachedInit | null>("detached_init");
        if (init) {
          const tab =
            init.source.kind === "local"
              ? makeLocalTab(init.label)
              : makeSshTab(init.source.hostId, init.label);
          setTabs([tab]);
          setActiveTabId(tab.id);
          // 세션 인계: 받은 sessionId를 첫 leaf에 attach.
          if (init.sessionId && tab.root.kind === "leaf") {
            setAttachSessionByLeaf({ [tab.root.id]: init.sessionId });
            if (init.screen) {
              setAttachScreenByLeaf({ [tab.root.id]: init.screen });
            }
          }
          // AI 대화 인계: 받은 aiSessionId를 이 탭의 AIPanel에 복원시킨다.
          if (init.aiSessionId) {
            setAttachAiByTab({ [tab.id]: init.aiSessionId });
          }
        } else {
          // 라벨이 detached-*인데 registry 항목이 없는 비정상 케이스 — 기본 로컬셸로 폴백.
          const fallback = makeLocalTab(tr.localShellN(1));
          setTabs([fallback]);
          setActiveTabId(fallback.id);
        }
      } catch (e) {
        console.error("detached_init failed", e);
        const fallback = makeLocalTab(tr.localShellN(1));
        setTabs([fallback]);
        setActiveTabId(fallback.id);
      }
      setBootstrapped(true);
    })();
  }, []);

  // 창 합치기 수신: 다른 창이 이 창(targetLabel)으로 탭을 보내면 그 세션을 attach하는 탭 추가.
  useEffect(() => {
    let un: (() => void) | undefined;
    const myLabel = CURRENT_WINDOW_LABEL;
    void listen<{
      targetLabel: string;
      source: TerminalSource;
      label: string;
      sessionId?: string | null;
      aiSessionId?: string | null;
    }>("wt://merge", (event) => {
      const p = event.payload;
      if (p.targetLabel !== myLabel) return;
      const tab =
        p.source.kind === "local"
          ? makeLocalTab(p.label)
          : makeSshTab(p.source.hostId, p.label);
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      if (p.sessionId && tab.root.kind === "leaf") {
        const leafId = tab.root.id;
        setAttachSessionByLeaf((prev) => ({ ...prev, [leafId]: p.sessionId! }));
      }
      if (p.aiSessionId) {
        setAttachAiByTab((prev) => ({ ...prev, [tab.id]: p.aiSessionId! }));
      }
      setMergeHover(false);
      void getCurrentWindow().setFocus();
    }).then((f) => {
      un = f;
    });
    return () => un?.();
  }, []);

  // 다른 창이 이 창 위로 드래그되는 중이면 드롭 안내 오버레이를 띄운다.
  const [mergeHover, setMergeHover] = useState(false);
  useEffect(() => {
    let un: (() => void) | undefined;
    const me = getCurrentWindow();
    void listen<{ label: string; cx: number; cy: number }>(
      "wt://winpos",
      async (event) => {
        const p = event.payload;
        if (p.label === CURRENT_WINDOW_LABEL) return;
        try {
          const pos = await me.outerPosition();
          const size = await me.outerSize();
          const inside =
            p.cx >= pos.x &&
            p.cx <= pos.x + size.width &&
            p.cy >= pos.y &&
            p.cy <= pos.y + size.height;
          setMergeHover(inside);
        } catch {}
      },
    ).then((f) => {
      un = f;
    });
    return () => un?.();
  }, []);

  // 창 합치기 소스: 어떤 창이든(메인/분리 구분 없음) 이 창을 다른 창 위로 드래그(OS 이동)해
  // 놓으면 그 창에 합쳐진다. onMoved로 이동 감지 → 위치를 다른 창에 알려 드롭 오버레이 표시
  // → 멈추면(release) 타이틀바 지점이 다른 창 영역 안이면 그 창으로 합치고 이 창을 닫는다.
  // (단, 탭이 1개뿐일 때만 창이 닫히고, 여러 개면 활성 탭만 이동.)
  useEffect(() => {
    const me = getCurrentWindow();
    const openedAt = Date.now();
    let settle: ReturnType<typeof setTimeout> | undefined;
    let lastEmit = 0;
    let un: (() => void) | undefined;

    async function titlebarPoint(payload: { x: number; y: number }) {
      const size = await me.outerSize();
      return { cx: payload.x + size.width / 2, cy: payload.y + 16 };
    }

    async function trySettle(cx: number, cy: number) {
      try {
        const wins = await getAllWebviewWindows();
        for (const w of wins) {
          if (w.label === CURRENT_WINDOW_LABEL) continue;
          const pos = await w.outerPosition();
          const size = await w.outerSize();
          if (
            cx >= pos.x &&
            cx <= pos.x + size.width &&
            cy >= pos.y &&
            cy <= pos.y + size.height
          ) {
            await mergeActiveTabInto(w.label);
            return;
          }
        }
      } catch {}
      // 대상 없음 → 다른 창의 오버레이 제거.
      void emit("wt://winpos", {
        label: CURRENT_WINDOW_LABEL,
        cx: -1e9,
        cy: -1e9,
      });
    }

    void me
      .onMoved(async ({ payload }) => {
        if (Date.now() - openedAt < 800) return; // 생성 직후 위치잡기 무시
        const { cx, cy } = await titlebarPoint(payload);
        const now = Date.now();
        if (now - lastEmit > 70) {
          void emit("wt://winpos", { label: CURRENT_WINDOW_LABEL, cx, cy });
          lastEmit = now;
        }
        if (settle) clearTimeout(settle);
        settle = setTimeout(() => void trySettle(cx, cy), 300);
      })
      .then((f) => {
        un = f;
      });
    return () => {
      un?.();
      if (settle) clearTimeout(settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeTabId]);

  const localSeq = useRef(1);

  const labelForHost = useCallback(
    (hostId: string): string => {
      const h = hosts.find((x) => x.id === hostId);
      return h ? h.name : "SSH";
    },
    [hosts],
  );

  const labelForSource = useCallback(
    (source: TerminalSource): string =>
      source.kind === "local" ? tr.localShell : labelForHost(source.hostId),
    [labelForHost],
  );

  // hosts가 늦게 도착하면 SSH 탭 라벨 갱신.
  useEffect(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.root.kind !== "leaf") return t;
        if (t.root.source.kind !== "ssh") return t;
        return { ...t, label: labelForHost(t.root.source.hostId) };
      }),
    );
  }, [labelForHost]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  // #55 긴 명령 완료 알림: 버스(commandBus)로 OSC 133 D를 받아, 백그라운드 탭에서 임계값
  // 이상 걸린 명령이면 데스크톱 알림 + 탭 배지. 최신 tabs/activeTabId는 ref로 읽는다.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  useEffect(() => {
    if (IS_DETACHED_WINDOW) return;
    void requestPermission();
    const off = onCommandDone(({ paneId, durationMs, exit }) => {
      if (!paneId) return;
      // 세션 대시보드용 통계는 모든 명령에 대해 누적(#62).
      setSessionStats((prev) => {
        const cur = prev[paneId];
        return {
          ...prev,
          [paneId]: {
            count: (cur?.count ?? 0) + 1,
            lastExit: exit,
            lastDurationMs: durationMs,
            lastAt: Date.now(),
          },
        };
      });
      if (durationMs < 8000) return; // 알림은 8초 이상만(짧은 명령 무시).
      const tab = tabsRef.current.find((t) => findLeaf(t.root, paneId));
      if (!tab) return;
      const foreground = tab.id === activeTabIdRef.current && document.hasFocus();
      if (foreground) return; // 보고 있는 탭이면 알림 안 함.
      setTabAlerts((prev) => new Set(prev).add(tab.id));
      void (async () => {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (!granted) return;
        const secs =
          durationMs >= 10000
            ? `${Math.round(durationMs / 1000)}s`
            : `${(durationMs / 1000).toFixed(1)}s`;
        sendNotification({
          title: tab.label || "wowTerminal",
          body: `${exit === 0 ? "✓" : "✗"} ${secs}`,
        });
      })();
    });
    return off;
  }, []);

  // 탭이 활성화되면 그 탭의 알림 배지를 지운다.
  useEffect(() => {
    if (!activeTabId) return;
    setTabAlerts((prev) => {
      if (!prev.has(activeTabId)) return prev;
      const n = new Set(prev);
      n.delete(activeTabId);
      return n;
    });
  }, [activeTabId]);

  // #62 세션 대시보드 행: 모든 탭의 모든 패널을 평탄화 + 세션/통계 결합.
  const dashRows: DashRow[] = useMemo(() => {
    const rows: DashRow[] = [];
    for (const tab of tabs) {
      for (const leaf of collectLeaves(tab.root)) {
        const src = leaf.source;
        const stat = sessionStats[leaf.id];
        rows.push({
          tabId: tab.id,
          tabLabel: tab.label,
          paneId: leaf.id,
          kind: src.kind === "ssh" ? "ssh" : "local",
          hostLabel: src.kind === "ssh" ? labelForHost(src.hostId) : undefined,
          active: !!sessionByLeaf.current[leaf.id],
          isActiveTab: tab.id === activeTabId,
          count: stat?.count ?? 0,
          lastExit: stat?.lastExit,
          lastDurationMs: stat?.lastDurationMs,
          lastAt: stat?.lastAt,
        });
      }
    }
    return rows;
  }, [tabs, sessionStats, activeTabId, labelForHost]);

  // #57 명령 팔레트 아이템: 액션 + 호스트 접속 + 최근 명령(활성 터미널에 입력).
  const paletteItems: PaletteItem[] = useMemo(() => {
    const out: PaletteItem[] = [
      { id: "act-newlocal", label: pal.newLocalTab, action: newLocalTab },
      { id: "act-dashboard", label: pal.dashboard, action: () => setDashboardOpen(true) },
      { id: "act-settings", label: pal.settings, action: () => setShowSettings(true) },
    ];
    for (const h of hosts) {
      out.push({
        id: `host-${h.id}`,
        label: `${pal.connect}: ${h.name}`,
        hint: `${h.user}@${h.host}:${h.port}`,
        action: () => newSshTab(h.id),
      });
    }
    const focused = activeTab?.focusedPaneId;
    if (focused) {
      for (const sn of loadSnippets()) {
        out.push({
          id: `snip-${sn.id}`,
          label: `${pal.snippet}: ${sn.name}`,
          hint: sn.command,
          action: () => getTerminal(focused)?.sendInput(sn.command),
        });
      }
      const recent = [...getHistory()].reverse().slice(0, 30);
      for (let i = 0; i < recent.length; i++) {
        const cmd = recent[i];
        out.push({
          id: `cmd-${i}`,
          label: cmd,
          hint: pal.run,
          action: () => getTerminal(focused)?.sendInput(cmd),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts, pal, activeTab, cmdPaletteOpen]);

  // 탭 활성화/전환 시 활성 탭의 모든 leaf를 다시 fit (xterm은 display:none에서 0 크기라
  // 표시될 때 재계산이 필요). 등록 직후 동작하도록 rAF로 지연.
  useEffect(() => {
    if (!activeTab) return;
    const ids = collectLeaves(activeTab.root).map((l) => l.id);
    const raf = requestAnimationFrame(() => {
      ids.forEach((id) => getTerminal(id)?.fit());
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTabId, activeTab]);
  const focusedLeaf = useMemo(() => {
    if (!activeTab) return null;
    const leaf = findLeaf(activeTab.root, activeTab.focusedPaneId);
    return leaf && leaf.kind === "leaf" ? leaf : null;
  }, [activeTab]);
  const focusedSource: TerminalSource | null = focusedLeaf
    ? focusedLeaf.source
    : null;
  const activeHostId =
    focusedSource && focusedSource.kind === "ssh" ? focusedSource.hostId : null;
  const isLocalActive = focusedSource?.kind === "local";

  const [mismatch, setMismatch] = useState<
    (MismatchInfo & { tabId: string; leafId: string }) | null
  >(null);
  const [firstContact, setFirstContact] = useState<
    (FirstContactInfo & { tabId: string; leafId: string }) | null
  >(null);
  const [passwordPrompt, setPasswordPrompt] = useState<
    (PasswordPromptInfo & { tabId: string; leafId: string }) | null
  >(null);
  const [connError, setConnError] = useState<
    { tabId: string; leafId: string; label: string; message: string } | null
  >(null);

  const showMismatch =
    mismatch && mismatch.tabId === activeTabId ? mismatch : null;
  const showFirstContact =
    firstContact && firstContact.tabId === activeTabId ? firstContact : null;
  const showPasswordPrompt =
    passwordPrompt && passwordPrompt.tabId === activeTabId
      ? passwordPrompt
      : null;
  const showConnError =
    connError && connError.tabId === activeTabId ? connError : null;

  function handleSshError(tabId: string, leafId: string, err: SshConnectError) {
    if (err.kind === "host_key_mismatch") {
      setMismatch({
        tabId,
        leafId,
        host: err.host,
        port: err.port,
        algorithm: err.algorithm,
        stored: err.stored,
        presented: err.presented,
      });
    } else if (err.kind === "first_contact") {
      setFirstContact({
        tabId,
        leafId,
        host: err.host,
        port: err.port,
        algorithm: err.algorithm,
        fingerprint: err.fingerprint,
      });
    } else if (err.kind === "password_required") {
      setPasswordPrompt({
        tabId,
        leafId,
        host: err.host,
        port: err.port,
        user: err.user,
      });
    } else if (err.kind === "other") {
      const tab = tabs.find((t) => t.id === tabId);
      setConnError({
        tabId,
        leafId,
        label: tab?.label ?? "SSH",
        message: err.message,
      });
    }
  }

  function bumpRetry(leafId: string) {
    setRetryByLeaf((prev) => ({ ...prev, [leafId]: (prev[leafId] ?? 0) + 1 }));
  }

  /** SSH 접속 성공 시: 사용자가 keychain 저장을 요청했으면 백엔드에 위임. 어느 경우든
   *  메모리에 남은 password와 remember 플래그는 즉시 비운다 (보안). */
  async function handleSshConnected(tabId: string, leafId: string) {
    const pw = passwordByLeaf[leafId];
    const remember = rememberByLeaf[leafId];
    // 항상 클리어 — 한 번 invoke로 전달됐고 더 이상 필요 없음.
    setPasswordByLeaf((prev) => {
      if (!(leafId in prev)) return prev;
      const next = { ...prev };
      delete next[leafId];
      return next;
    });
    setRememberByLeaf((prev) => {
      if (!(leafId in prev)) return prev;
      const next = { ...prev };
      delete next[leafId];
      return next;
    });
    if (!pw || !remember) return;

    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const leaf = findLeaf(tab.root, leafId);
    if (!leaf || leaf.kind !== "leaf" || leaf.source.kind !== "ssh") return;
    const hostId = leaf.source.hostId;

    try {
      await invoke("ssh_remember_password", { args: { hostId, password: pw } });
      await reloadHosts();
    } catch (e) {
      console.error("ssh_remember_password failed", e);
      alert(tr.keychainSaveFail(String(e)));
    }
  }

  function newLocalTab() {
    const n = ++localSeq.current;
    const tab = makeLocalTab(tr.localShellN(n));
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function newSshTab(hostId: string) {
    const tab = makeSshTab(hostId, labelForHost(hostId));
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const n = ++localSeq.current;
        const fresh = makeLocalTab(tr.localShellN(n));
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (id === activeTabId) {
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTabId(newActive.id);
      }
      return next;
    });
    if (mismatch?.tabId === id) setMismatch(null);
    if (firstContact?.tabId === id) setFirstContact(null);
  }

  function renameTab(id: string, label: string) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)));
  }

  function duplicateTab(id: string) {
    const orig = tabs.find((t) => t.id === id);
    if (!orig) return;
    const root = cloneRootWithNewIds(orig.root);
    const dup: Tab = {
      id: newId(),
      label: tr.dup(orig.label),
      root,
      focusedPaneId: firstLeafId(root),
    };
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, dup);
      return next;
    });
    setActiveTabId(dup.id);
  }

  function moveTab(id: string, dir: -1 | 1) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });
  }

  function closeOthers(id: string) {
    const toCloseIds = tabs.filter((t) => t.id !== id).map((t) => t.id);
    setTabs((prev) => prev.filter((t) => t.id === id));
    setActiveTabId(id);
    if (mismatch && toCloseIds.includes(mismatch.tabId)) setMismatch(null);
    if (firstContact && toCloseIds.includes(firstContact.tabId))
      setFirstContact(null);
  }

  async function detachLeafToNewWindow(
    tabId: string,
    pos?: { x: number; y: number },
  ) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const leaf = findLeaf(tab.root, tab.focusedPaneId);
    if (!leaf || leaf.kind !== "leaf") return;
    const source = leaf.source;
    const sourceArg =
      source.kind === "local"
        ? { kind: "local" }
        : { kind: "ssh", hostId: source.hostId };
    // 살아있는 세션이 있으면 인계 — 백엔드가 open_detached_window에서 보호 등록한다.
    const sessionId = sessionByLeaf.current[leaf.id];
    // 분리 직전 화면 스냅샷을 캡처해 새 창에서 복원 (이전 작업 화면 보존).
    const screen = sessionId ? getTerminal(leaf.id)?.serialize() ?? null : null;
    // 이 탭의 AI 대화 세션도 함께 인계 (새 창 AIPanel이 localStorage에서 복원).
    const aiSessionId = aiSessionByTab.current[tab.id] ?? null;
    try {
      await invoke<string>("open_detached_window", {
        source: sourceArg,
        labelHint: tab.label,
        sessionId: sessionId ?? null,
        screen,
        aiSessionId,
        x: pos?.x ?? null,
        y: pos?.y ?? null,
      });
      // 원본 leaf/탭 제거. markSessionDetached 덕분에 cleanup이 kill하지 않음.
      if (tab.root.kind === "leaf") {
        closeTab(tab.id);
      } else {
        closePane(tab.id, leaf.id);
      }
    } catch (e) {
      alert(tr.detachWindowFail(String(e)));
    }
  }

  // 창 합치기: 이 (분리)창의 활성 탭 세션을 targetLabel 창으로 보낸다. 글로벌 이벤트로
  // 세션 정보를 넘기고, 이 창은 탭/창을 닫는다.
  async function mergeActiveTabInto(targetLabel: string) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const leaf = findLeaf(tab.root, tab.focusedPaneId);
    if (!leaf || leaf.kind !== "leaf") return;
    const source = leaf.source;
    const sessionId = sessionByLeaf.current[leaf.id];
    const aiSessionId = aiSessionByTab.current[tab.id] ?? null;
    try {
      if (sessionId) {
        // 대상 창이 attach할 동안 이 창의 cleanup kill이 세션을 죽이지 않도록 보호 등록.
        await invoke("mark_session_detached", { sessionId, kind: source.kind });
      }
      await emit("wt://merge", {
        targetLabel,
        source:
          source.kind === "local"
            ? { kind: "local" }
            : { kind: "ssh", hostId: source.hostId },
        label: tab.label,
        sessionId: sessionId ?? null,
        aiSessionId,
      });
      if (tabs.length <= 1) {
        await getCurrentWindow().close();
      } else {
        closeTab(tab.id);
      }
    } catch (e) {
      alert(tr.detachWindowFail(String(e)));
    }
  }

  /** 특정 호스트로 향하는 모든 leaf를 로컬셸로 swap (호스트 삭제 직후 호출). */
  function detachHostFromAllTabs(hostId: string) {
    setTabs((prev) =>
      prev.map((t) => {
        const newRoot = swapHostLeavesToLocal(t.root, hostId);
        if (newRoot === t.root) return t;
        // 단일 leaf 탭이 변경된 경우 라벨도 갱신
        if (newRoot.kind === "leaf" && t.root.kind === "leaf") {
          const n = ++localSeq.current;
          return { ...t, root: newRoot, label: tr.localShellN(n) };
        }
        return { ...t, root: newRoot };
      }),
    );
  }

  /** 활성 탭/패널 중 hostId를 가진 leaf의 수. */
  const activeSessionCountForHost = useCallback(
    (hostId: string): number => {
      return tabs.reduce((acc, tab) => {
        return (
          acc +
          collectLeaves(tab.root).filter(
            (l) => l.source.kind === "ssh" && l.source.hostId === hostId,
          ).length
        );
      }, 0);
    },
    [tabs],
  );

  function closeRight(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const keep = prev.slice(0, idx + 1);
      if (!keep.find((t) => t.id === activeTabId)) {
        setActiveTabId(id);
      }
      return keep;
    });
  }

  // --- 단일 클릭/로컬 클릭: 활성 탭의 focused leaf source 변경 -------------

  function selectLocalForActive() {
    if (!activeTab || !focusedLeaf) return;
    if (focusedLeaf.source.kind === "local") return;
    const leafId = focusedLeaf.id;
    const n = ++localSeq.current;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        return {
          ...t,
          root: replaceLeafSource(t.root, leafId, { kind: "local" }),
          // 단일 leaf인 경우엔 탭 라벨도 자동 갱신
          label: t.root.kind === "leaf" ? tr.localShellN(n) : t.label,
        };
      }),
    );
    if (mismatch?.leafId === leafId) setMismatch(null);
    if (firstContact?.leafId === leafId) setFirstContact(null);
  }

  function selectHostForActive(hostId: string) {
    if (!activeTab || !focusedLeaf) return;
    if (
      focusedLeaf.source.kind === "ssh" &&
      focusedLeaf.source.hostId === hostId
    ) {
      return;
    }
    const leafId = focusedLeaf.id;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        return {
          ...t,
          root: replaceLeafSource(t.root, leafId, { kind: "ssh", hostId }),
          label: t.root.kind === "leaf" ? labelForHost(hostId) : t.label,
        };
      }),
    );
    if (mismatch?.leafId === leafId) setMismatch(null);
    if (firstContact?.leafId === leafId) setFirstContact(null);
  }

  // --- 분할 / 패널 액션 ----------------------------------------------------

  function splitActivePane(direction: "vertical" | "horizontal") {
    if (!activeTab || !focusedLeaf) return;
    const newLeafId = newId();
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        const root = splitLeaf(
          t.root,
          focusedLeaf.id,
          { kind: "leaf", id: newLeafId, source: focusedLeaf.source },
          direction,
        );
        return { ...t, root, focusedPaneId: newLeafId };
      }),
    );
  }

  function closePane(tabId: string, leafId: string) {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const root = removeLeaf(t.root, leafId);
        if (!root) {
          // root가 단일 leaf였음 → 탭 자체를 닫아야 함. 우선 placeholder로 두고
          // 외부에서 closeTab(tabId)로 처리.
          return t;
        }
        const nextFocus =
          t.focusedPaneId === leafId ? firstLeafId(root) : t.focusedPaneId;
        return { ...t, root, focusedPaneId: nextFocus };
      }),
    );
    // 분할이 아닌 경우 (single leaf) → 탭 닫기로 위임
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.root.kind === "leaf" && tab.root.id === leafId) {
      closeTab(tabId);
    }
    if (mismatch?.leafId === leafId) setMismatch(null);
    if (firstContact?.leafId === leafId) setFirstContact(null);
  }

  function focusPane(tabId: string, leafId: string) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, focusedPaneId: leafId } : t,
      ),
    );
  }

  function setPaneRatio(tabId: string, path: number[], ratio: number) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, root: setRatioByPath(t.root, path, ratio) } : t,
      ),
    );
  }

  function focusNeighborOrSwitchTab(
    arrow: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  ) {
    if (!activeTab) return;
    // 분할이 있는 경우 — 같은 탭 내에서 인접 leaf로 focus 이동
    if (activeTab.root.kind === "split") {
      const dirMap = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      } as const;
      const target = neighborLeafId(
        activeTab.root,
        activeTab.focusedPaneId,
        dirMap[arrow],
      );
      if (target) {
        focusPane(activeTab.id, target);
        return;
      }
    }
    // 분할이 없거나 인접 패널이 없으면 탭 좌/우 이동으로 사용
    if (arrow === "ArrowLeft") {
      moveTab(activeTab.id, -1);
    } else if (arrow === "ArrowRight") {
      moveTab(activeTab.id, 1);
    }
  }

  // 키보드 단축키
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ⌘K / Ctrl-K: 명령 팔레트 (편집 중이어도 동작).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
        return;
      }
      if (editingTabId) return;
      const kb = settings.keybindings;

      // 사용자 정의 단축키 매칭 (각 바인딩이 수정자까지 self-describe).
      if (matchesBinding(e, kb.renameTab)) {
        if (activeTabId) {
          e.preventDefault();
          setEditingTabId(activeTabId);
        }
        return;
      }
      if (matchesBinding(e, kb.newTab)) {
        e.preventDefault();
        newLocalTab();
        return;
      }
      if (matchesBinding(e, kb.closeTab)) {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
        return;
      }
      if (matchesBinding(e, kb.splitVertical)) {
        e.preventDefault();
        splitActivePane("vertical");
        return;
      }
      if (matchesBinding(e, kb.splitHorizontal)) {
        e.preventDefault();
        splitActivePane("horizontal");
        return;
      }
      if (matchesBinding(e, kb.duplicateTab)) {
        e.preventDefault();
        if (activeTabId) duplicateTab(activeTabId);
        return;
      }
      if (matchesBinding(e, kb.nextTab) || matchesBinding(e, kb.prevTab)) {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx < 0) return;
        const step = matchesBinding(e, kb.prevTab) ? -1 : 1;
        const nextIdx = (idx + step + tabs.length) % tabs.length;
        setActiveTabId(tabs[nextIdx].id);
        return;
      }

      // 고정 단축키(다중키라 재지정 불가): Ctrl/⌘ 필요.
      if (!e.ctrlKey && !e.metaKey) return;
      // Ctrl+Shift+방향키 — 분할이 있으면 패널 포커스 이동, 아니면 탭 좌/우 이동
      if (
        e.shiftKey &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown")
      ) {
        e.preventDefault();
        focusNeighborOrSwitchTab(e.key);
        return;
      }
      // Ctrl+숫자 — N번째 탭
      if (e.key.length === 1 && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < tabs.length) {
          e.preventDefault();
          setActiveTabId(tabs[idx].id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeTabId, editingTabId, activeTab, focusedLeaf, settings.keybindings]);

  // 탭 드래그 분리: 탭을 창 밖으로 끌어내 떼면 그 위치에 새 창. (창 경계 밖 또는 탭바
  // 아래로 충분히 내려가면 active.) 떼는 지점의 화면 좌표를 새 창 위치로 쓴다.
  useEffect(() => {
    if (!drag) return;
    const THRESHOLD_Y = 110; // 탭바 아래로 충분히
    const isOutside = (e: MouseEvent) =>
      e.clientX < 0 ||
      e.clientY < 0 ||
      e.clientX > window.innerWidth ||
      e.clientY > window.innerHeight;
    function move(e: MouseEvent) {
      if (isOutside(e) || e.clientY > THRESHOLD_Y) {
        setDrag((d) => (d && !d.active ? { ...d, active: true } : d));
      }
    }
    function up(e: MouseEvent) {
      const tabId = drag!.tabId;
      const detach = drag!.active && (isOutside(e) || e.clientY > THRESHOLD_Y);
      setDrag(null);
      // 떼는 지점(스크린 좌표)에 새 창을 띄운다. 화면 밖으로 약간 벗어나도 보이도록 보정.
      if (detach) {
        void detachLeafToNewWindow(tabId, {
          x: Math.max(0, e.screenX - 40),
          y: Math.max(0, e.screenY - 20),
        });
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrag(null);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  if (!bootstrapped) {
    return (
      <LangProvider lang={lang}>
        <main
          style={{
            width: "100vw",
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1e1e1e",
            color: "#9aa",
            fontSize: 13,
          }}
        >
          {tr.initDetached}
        </main>
      </LangProvider>
    );
  }

  if (phase === "splash")
    return (
      <LangProvider lang={lang}>
        <SplashScreen />
      </LangProvider>
    );
  if (phase === "onboarding") {
    return (
      <LangProvider lang={lang}>
        <OnboardingFlow
          onComplete={() => {
            setOnboarded();
            setPhase("ready");
          }}
        />
      </LangProvider>
    );
  }

  return (
    <LangProvider lang={lang}>
    <main
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
        color: "#e6e6e6",
      }}
    >
      <TitleBar
        activeTab={activeTab}
        tabCount={tabs.length}
        canOpenFiles={!!activeHostId}
        onOpenFiles={() => {
          if (activeHostId) {
            // 포커스된 패널의 셸 cwd(OSC 7로 추적)를 파일 브라우저 원격 시작 위치로.
            const cwd = activeTab
              ? getTerminal(activeTab.focusedPaneId)?.getCwd() ?? undefined
              : undefined;
            setFileBrowser({
              hostId: activeHostId,
              hostLabel: labelForHost(activeHostId),
              initialRemotePath: cwd,
            });
          }
        }}
        onOpenSettings={() => setShowSettings(true)}
        broadcast={broadcast}
        onToggleBroadcast={() => setBroadcast((v) => !v)}
        onOpenDashboard={() => setDashboardOpen(true)}
      />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        alertedTabIds={tabAlerts}
        editingTabId={editingTabId}
        onActivate={setActiveTabId}
        onClose={closeTab}
        onNew={newLocalTab}
        onContextMenu={(tabId, x, y) => setContextMenu({ tabId, x, y })}
        onRenameCommit={(id, label) => {
          renameTab(id, label);
          setEditingTabId(null);
        }}
        onRenameCancel={() => setEditingTabId(null)}
        onStartRename={(id) => setEditingTabId(id)}
        onTabPointerDown={(id) => {
          if (tabs.length > 0) setDrag({ tabId: id, active: false });
        }}
      />

      <div
        ref={layoutRowRef}
        style={{ flex: 1, display: "flex", minHeight: 0 }}
      >
        {layout.showHostPanel && (
          <>
            <div
              style={{
                width: layout.hostPanelWidth,
                flexShrink: 0,
                minWidth: 0,
                display: "flex",
              }}
            >
              <HostList
                activeHostId={activeHostId}
                isLocalActive={!!isLocalActive}
                onSelect={selectHostForActive}
                onOpenInNewTab={(id) => {
                  void reloadHosts();
                  newSshTab(id);
                }}
                onSelectLocal={selectLocalForActive}
                activeSessionCountForHost={activeSessionCountForHost}
                onHostDeleted={(id) => {
                  detachHostFromAllTabs(id);
                  void reloadHosts();
                }}
              />
            </div>
            <PanelEdge
              side="host"
              collapsed={false}
              onToggle={toggleHostPanel}
              onResizeStart={(e) => startPanelResize("host", e)}
            />
          </>
        )}
        {!layout.showHostPanel && (
          <PanelEdge
            side="host"
            collapsed
            onToggle={toggleHostPanel}
            onResizeStart={() => {}}
          />
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{
                display: tab.id === activeTabId ? "flex" : "none",
                flex: 1,
                minHeight: 0,
              }}
            >
              <PaneView
                pane={tab.root}
                focusedPaneId={tab.focusedPaneId}
                showHeaders={tab.root.kind === "split"}
                onFocus={(leafId) => focusPane(tab.id, leafId)}
                onClosePane={(leafId) => closePane(tab.id, leafId)}
                onRatioChange={(path, ratio) =>
                  setPaneRatio(tab.id, path, ratio)
                }
                onSshError={(leafId, err) =>
                  handleSshError(tab.id, leafId, err)
                }
                onSshConnected={(leafId) => handleSshConnected(tab.id, leafId)}
                retryByLeaf={retryByLeaf}
                passwordByLeaf={passwordByLeaf}
                labelForSource={labelForSource}
                termSettings={settings.terminal}
                onSession={(leafId, sid) => {
                  sessionByLeaf.current[leafId] = sid;
                }}
                attachSessionByLeaf={attachSessionByLeaf}
                attachScreenByLeaf={attachScreenByLeaf}
              />
            </div>
          ))}
        </div>

        {/* 우측 AI 패널 — 탭별로 mount(display 토글)하고 고정폭 컨테이너로 감싼다. */}
        {!layout.showAiPanel && (
          <PanelEdge
            side="ai"
            collapsed
            onToggle={toggleAiPanel}
            onResizeStart={() => {}}
          />
        )}
        {layout.showAiPanel && (
          <>
            <PanelEdge
              side="ai"
              collapsed={false}
              onToggle={toggleAiPanel}
              onResizeStart={(e) => startPanelResize("ai", e)}
            />
            <div
              style={{
                width: layout.aiPanelWidth,
                flexShrink: 0,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {tabs.map((tab) => {
                const fLeaf = findLeaf(tab.root, tab.focusedPaneId);
                const fSource =
                  fLeaf && fLeaf.kind === "leaf" ? fLeaf.source : null;
                return (
                  <div
                    key={tab.id}
                    style={{
                      display: tab.id === activeTabId ? "flex" : "none",
                      flex: 1,
                      minHeight: 0,
                    }}
                  >
                    <AIPanel
                      activeTab={tab}
                      focusedSource={fSource}
                      focusedPaneId={tab.focusedPaneId}
                      paneCount={collectLeaves(tab.root).length}
                      contextLabel={
                        fSource && fSource.kind === "ssh"
                          ? labelForHost(fSource.hostId)
                          : undefined
                      }
                      onActiveSession={(sid) => {
                        aiSessionByTab.current[tab.id] = sid;
                      }}
                      initialSessionId={attachAiByTab[tab.id]}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {fileBrowser && (
        <FileBrowser
          hostId={fileBrowser.hostId}
          hostLabel={fileBrowser.hostLabel}
          initialRemotePath={fileBrowser.initialRemotePath}
          onClose={() => setFileBrowser(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {cmdPaletteOpen && (
        <CommandPalette
          items={paletteItems}
          placeholder={pal.placeholder}
          emptyText={pal.noResults}
          onClose={() => setCmdPaletteOpen(false)}
        />
      )}

      {dashboardOpen && (
        <SessionDashboard
          rows={dashRows}
          onJump={(tabId) => setActiveTabId(tabId)}
          onClose={() => setDashboardOpen(false)}
        />
      )}

      {drag?.active && <DropZoneOverlay />}

      {mergeHover && (
        <MergeDropOverlay
          label={lang === "ko" ? "여기에 놓으면 합쳐집니다" : "Drop here to merge"}
        />
      )}

      {contextMenu &&
        (() => {
          const target = tabs.find((t) => t.id === contextMenu.tabId);
          if (!target) return null;
          const idx = tabs.findIndex((t) => t.id === contextMenu.tabId);
          return (
            <TabContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              tabLabel={target.label}
              isSoleTab={tabs.length === 1}
              hasRightTabs={idx < tabs.length - 1}
              canMoveLeft={idx > 0}
              canMoveRight={idx < tabs.length - 1}
              onDismiss={() => setContextMenu(null)}
              onRename={() => setEditingTabId(contextMenu.tabId)}
              onDuplicate={() => duplicateTab(contextMenu.tabId)}
              onDetach={() => {
                void detachLeafToNewWindow(contextMenu.tabId);
              }}
              onMoveLeft={() => moveTab(contextMenu.tabId, -1)}
              onMoveRight={() => moveTab(contextMenu.tabId, 1)}
              onSplitVertical={() => {
                setActiveTabId(contextMenu.tabId);
                splitActivePane("vertical");
              }}
              onSplitHorizontal={() => {
                setActiveTabId(contextMenu.tabId);
                splitActivePane("horizontal");
              }}
              onCloseSelf={() => closeTab(contextMenu.tabId)}
              onCloseOthers={() => closeOthers(contextMenu.tabId)}
              onCloseRight={() => closeRight(contextMenu.tabId)}
            />
          );
        })()}

      {showFirstContact && (
        <FirstContactModal
          info={{
            host: showFirstContact.host,
            port: showFirstContact.port,
            algorithm: showFirstContact.algorithm,
            fingerprint: showFirstContact.fingerprint,
          }}
          onCancel={() => setFirstContact(null)}
          onTrusted={() => {
            const leafId = showFirstContact.leafId;
            setFirstContact(null);
            bumpRetry(leafId);
          }}
        />
      )}
      {showConnError && (
        <ConnectionErrorModal
          info={{ label: showConnError.label, message: showConnError.message }}
          onClose={() => setConnError(null)}
          onRetry={() => {
            const leafId = showConnError.leafId;
            setConnError(null);
            bumpRetry(leafId);
          }}
        />
      )}

      {showPasswordPrompt && (
        <PasswordPromptModal
          info={{
            host: showPasswordPrompt.host,
            port: showPasswordPrompt.port,
            user: showPasswordPrompt.user,
          }}
          onCancel={() => setPasswordPrompt(null)}
          onSubmit={(pw, remember) => {
            const leafId = showPasswordPrompt.leafId;
            setPasswordByLeaf((prev) => ({ ...prev, [leafId]: pw }));
            setRememberByLeaf((prev) => ({ ...prev, [leafId]: remember }));
            setPasswordPrompt(null);
            bumpRetry(leafId);
          }}
        />
      )}

      {showMismatch && (
        <HostKeyMismatchModal
          info={{
            host: showMismatch.host,
            port: showMismatch.port,
            algorithm: showMismatch.algorithm,
            stored: showMismatch.stored,
            presented: showMismatch.presented,
          }}
          onCancel={() => setMismatch(null)}
          onTrusted={() => {
            const leafId = showMismatch.leafId;
            setMismatch(null);
            bumpRetry(leafId);
          }}
        />
      )}
    </main>
    </LangProvider>
  );
}

/** 드래그 분리 드롭존: 탭바 아래 영역을 덮는 안내 오버레이. mouseup은 App이 window에서 처리. */
function DropZoneOverlay() {
  const t = useT(STR);
  return (
    <div
      style={{
        position: "fixed",
        inset: "66px 0 0 0",
        background: "rgba(10, 16, 32, 0.55)",
        border: "2px dashed #4a9eff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        zIndex: 900,
        color: "#fff",
        textAlign: "center",
        userSelect: "none",
        pointerEvents: "none", // mouseup이 통과하도록 — 분리 판정은 window 리스너에서
      }}
    >
      <div style={{ fontSize: 32 }}>🔲</div>
      <div style={{ fontSize: 16 }}>{t.dropToDetach}</div>
      <div style={{ fontSize: 12, color: "#bcd" }}>{t.escCancel}</div>
    </div>
  );
}

/** 창 합치기 안내: 다른 창이 이 창 위로 드래그되는 동안 표시. */
function MergeDropOverlay({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 16, 32, 0.5)",
        border: "3px dashed #4a9eff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        zIndex: 950,
        color: "#fff",
        textAlign: "center",
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <div style={{ fontSize: 40 }}>⊕</div>
      <div style={{ fontSize: 18 }}>{label}</div>
    </div>
  );
}

/** root 트리에서 hostId 매칭 leaf를 모두 로컬셸로 swap. 변경이 없으면 동일 참조 반환. */
function swapHostLeavesToLocal(root: Pane, hostId: string): Pane {
  if (root.kind === "leaf") {
    if (root.source.kind === "ssh" && root.source.hostId === hostId) {
      return { ...root, source: { kind: "local" } };
    }
    return root;
  }
  const f = swapHostLeavesToLocal(root.first, hostId);
  const s = swapHostLeavesToLocal(root.second, hostId);
  if (f === root.first && s === root.second) return root;
  return { ...root, first: f, second: s };
}

/** root 트리에서 특정 leaf의 source만 교체. */
function replaceLeafSource(
  root: Pane,
  leafId: string,
  source: TerminalSource,
): Pane {
  if (root.kind === "leaf") {
    return root.id === leafId ? { ...root, source } : root;
  }
  return {
    ...root,
    first: replaceLeafSource(root.first, leafId, source),
    second: replaceLeafSource(root.second, leafId, source),
  };
}

export default App;
