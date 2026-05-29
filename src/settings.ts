// 앱 설정 (S-054~059). 시크릿이 아니므로 localStorage에 둔다.

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  theme: "dark" | "light";
  scrollback: number;
}

export type Lang =
  | "en"
  | "ko"
  | "es"
  | "zh"
  | "ja"
  | "ru"
  | "fr"
  | "de"
  | "vi"
  | "id"
  | "hi";

/** 지원 언어 목록 + 자국어 표기 (설정 드롭다운용). */
export const LANGS: ReadonlyArray<{ code: Lang; label: string }> = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ru", label: "Русский" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "hi", label: "हिन्दी" },
];

/** 저장된 언어가 없을 때 OS 로케일로 추정. 미지원이면 en. */
export function detectLang(): Lang {
  const raw =
    typeof navigator !== "undefined" ? navigator.language ?? "en" : "en";
  const code = raw.toLowerCase().split("-")[0];
  const supported = LANGS.map((l) => l.code as string);
  return supported.includes(code) ? (code as Lang) : "en";
}

export interface GeneralSettings {
  /** 앱 시작 시 마지막 탭 복원 (현재는 표시만 — 복원 로직 후속). */
  restoreTabs: boolean;
  /** UI 언어 (#22). */
  language: Lang;
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

// ---- 사용자 정의 단축키 (#32) ----

/** 단일 키 조합. mod = Ctrl(Win/Linux) 또는 ⌘(macOS) — 둘을 같은 주 수정자로 취급. */
export interface KeyBinding {
  key: string; // 예: "t", "Tab", "F2"
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

/** 재지정 가능한 액션. (Ctrl+숫자=탭 이동, Ctrl+Shift+화살표=패널/탭 이동은 다중키라 고정) */
export type ShortcutAction =
  | "newTab"
  | "closeTab"
  | "nextTab"
  | "prevTab"
  | "splitVertical"
  | "splitHorizontal"
  | "duplicateTab"
  | "renameTab";

export type Keybindings = Record<ShortcutAction, KeyBinding>;

export const DEFAULT_KEYBINDINGS: Keybindings = {
  newTab: { key: "t", mod: true, shift: false, alt: false },
  closeTab: { key: "w", mod: true, shift: false, alt: false },
  nextTab: { key: "Tab", mod: true, shift: false, alt: false },
  prevTab: { key: "Tab", mod: true, shift: true, alt: false },
  splitVertical: { key: "l", mod: true, shift: true, alt: false },
  splitHorizontal: { key: "s", mod: true, shift: true, alt: false },
  duplicateTab: { key: "d", mod: true, shift: true, alt: false },
  renameTab: { key: "F2", mod: false, shift: false, alt: false },
};

/** 키보드 이벤트가 바인딩과 일치하는지. Ctrl/⌘는 동일하게 본다. */
export function matchesBinding(e: KeyboardEvent, b: KeyBinding): boolean {
  const mod = e.ctrlKey || e.metaKey;
  return (
    mod === b.mod &&
    e.shiftKey === b.shift &&
    e.altKey === b.alt &&
    e.key.toLowerCase() === b.key.toLowerCase()
  );
}

/** 표시용 문자열 (예: "Ctrl/⌘ + Shift + L"). */
export function formatBinding(b: KeyBinding): string {
  const parts: string[] = [];
  if (b.mod) parts.push("Ctrl/⌘");
  if (b.shift) parts.push("Shift");
  if (b.alt) parts.push("Alt");
  parts.push(b.key.length === 1 ? b.key.toUpperCase() : b.key);
  return parts.join(" + ");
}

export interface AppSettings {
  general: GeneralSettings;
  terminal: TerminalSettings;
  layout: LayoutSettings;
  keybindings: Keybindings;
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
  general: { restoreTabs: false, language: "en" },
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
  keybindings: DEFAULT_KEYBINDINGS,
};

const KEY = "wowterminal-settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return {
        ...DEFAULT_SETTINGS,
        general: { ...DEFAULT_SETTINGS.general, language: detectLang() },
      };
    }
    const parsed = JSON.parse(raw);
    // 누락 필드는 기본값으로 메움 (스키마 진화 대비).
    const general = { ...DEFAULT_SETTINGS.general, ...(parsed.general ?? {}) };
    // 저장된 언어가 없으면 OS 로케일로 추정.
    if (!parsed.general?.language) general.language = detectLang();
    return {
      general,
      terminal: { ...DEFAULT_SETTINGS.terminal, ...(parsed.terminal ?? {}) },
      layout: { ...DEFAULT_SETTINGS.layout, ...(parsed.layout ?? {}) },
      keybindings: { ...DEFAULT_KEYBINDINGS, ...(parsed.keybindings ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, language: detectLang() } };
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
