// 앱 설정 (S-054~059). 시크릿이 아니므로 localStorage에 둔다.

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  theme: "dark" | "light";
  scrollback: number;
}

export interface GeneralSettings {
  /** 앱 시작 시 마지막 탭 복원 (현재는 표시만 — 복원 로직 후속). */
  restoreTabs: boolean;
}

export interface LayoutSettings {
  /** 좌측 호스트 패널 표시 여부. */
  showHostPanel: boolean;
  /** 우측 AI 패널 표시 여부. */
  showAiPanel: boolean;
  /** 좌측 호스트 패널 폭(px). */
  hostPanelWidth: number;
  /** 우측 AI 패널 폭(px). */
  aiPanelWidth: number;
}

export interface AppSettings {
  general: GeneralSettings;
  terminal: TerminalSettings;
  layout: LayoutSettings;
}

/** 패널 폭 허용 범위(px). */
export const PANEL_MIN_WIDTH = 180;
export const PANEL_MAX_WIDTH = 560;

export const TERMINAL_THEMES: Record<
  TerminalSettings["theme"],
  { background: string; foreground: string }
> = {
  dark: { background: "#1e1e1e", foreground: "#e6e6e6" },
  light: { background: "#fbfbfb", foreground: "#1e1e1e" },
};

export const DEFAULT_SETTINGS: AppSettings = {
  general: { restoreTabs: false },
  terminal: {
    fontSize: 14,
    fontFamily: "Menlo, Consolas, 'Courier New', monospace",
    cursorBlink: true,
    theme: "dark",
    scrollback: 1000,
  },
  layout: {
    showHostPanel: true,
    showAiPanel: true,
    hostPanelWidth: 280,
    aiPanelWidth: 320,
  },
};

const KEY = "wowterminal-settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    // 누락 필드는 기본값으로 메움 (스키마 진화 대비).
    return {
      general: { ...DEFAULT_SETTINGS.general, ...(parsed.general ?? {}) },
      terminal: { ...DEFAULT_SETTINGS.terminal, ...(parsed.terminal ?? {}) },
      layout: { ...DEFAULT_SETTINGS.layout, ...(parsed.layout ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 무시 */
  }
}

/** S-056 단축키 참조표 (현재 하드코딩된 단축키 — v1은 읽기 전용). */
export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "Ctrl/⌘ + T", action: "새 로컬 셸 탭" },
  { keys: "Ctrl/⌘ + W", action: "활성 탭 닫기" },
  { keys: "Ctrl/⌘ + Tab", action: "다음 탭" },
  { keys: "Ctrl/⌘ + Shift + Tab", action: "이전 탭" },
  { keys: "Ctrl/⌘ + 1~9", action: "N번째 탭" },
  { keys: "F2", action: "탭 이름 변경" },
  { keys: "Ctrl/⌘ + Shift + D", action: "탭 복제" },
  { keys: "Ctrl/⌘ + Shift + ← / →", action: "탭 이동 / 패널 포커스" },
  { keys: "Ctrl/⌘ + Shift + L", action: "좌우 분할" },
  { keys: "Ctrl/⌘ + Shift + S", action: "상하 분할" },
];
