// 앱 설정 (S-054~059). 시크릿이 아니므로 localStorage에 둔다.

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  theme: "dark" | "light" | "dracula" | "nord" | "solarized" | "monokai";
  scrollback: number;
  /** 대체 화면(less/man/vim 등)에서 마우스 휠을 위/아래 화살표로 변환해 스크롤. */
  altScreenWheelScroll: boolean;
  /** 세션 로깅 — 켜면 터미널 출력(ANSI 제거)을 로그 디렉터리에 파일로 남긴다. */
  logging: boolean;
  /** 로그 저장 디렉터리. 비우면 ~/wowterminal-logs 사용. */
  logDir: string;
  /** 새 로컬 터미널의 시작 디렉터리 (#91). 비우면 홈. `~` 확장은 Rust 쪽에서. */
  startDir: string;
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
  /** UI(호스트 목록·AI 패널 등) 글꼴 — 터미널 폰트와 별개. CSS font-family 스택. */
  uiFont: string;
}

/** UI 글꼴 프리셋. 시스템에 있을 법한 폰트 + 한글 폴백(Apple SD Gothic Neo 등). */
export const UI_FONTS: { label: string; value: string }[] = [
  {
    label: "System",
    value:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  },
  {
    label: "Helvetica Neue",
    value: '"Helvetica Neue", Helvetica, "Apple SD Gothic Neo", Arial, sans-serif',
  },
  {
    label: "Avenir Next",
    value: '"Avenir Next", Avenir, "Apple SD Gothic Neo", sans-serif',
  },
  {
    label: "Apple SD Gothic Neo",
    value: '"Apple SD Gothic Neo", -apple-system, sans-serif',
  },
  {
    label: "Pretendard",
    value: 'Pretendard, "Pretendard Variable", -apple-system, sans-serif',
  },
  {
    label: "Noto Sans KR",
    value: '"Noto Sans KR", -apple-system, sans-serif',
  },
];

/** 터미널(고정폭) 글꼴 프리셋. 값은 CSS font-family 스택(monospace 폴백 포함). */
export const MONO_FONTS: { label: string; value: string }[] = [
  { label: "Menlo", value: "Menlo, Consolas, 'Courier New', monospace" },
  { label: "SF Mono", value: '"SF Mono", "SFMono-Regular", Menlo, monospace' },
  { label: "Monaco", value: "Monaco, Menlo, monospace" },
  { label: "JetBrains Mono", value: '"JetBrains Mono", Menlo, monospace' },
  { label: "Fira Code", value: '"Fira Code", Menlo, monospace' },
  { label: "Source Code Pro", value: '"Source Code Pro", Menlo, monospace' },
  { label: "D2Coding", value: "D2Coding, Menlo, monospace" },
  { label: "Consolas", value: "Consolas, Menlo, monospace" },
];

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
  | "renameTab"
  | "toggleHostPanel"
  | "toggleAiPanel";

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
  toggleHostPanel: { key: "b", mod: true, shift: false, alt: false },
  toggleAiPanel: { key: "j", mod: true, shift: false, alt: false },
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

// xterm ITheme 일부(background/foreground는 필수, 나머지 ANSI 색은 선택).
export interface ThemeColors {
  background: string;
  foreground: string;
  cursor?: string;
  selectionBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export const TERMINAL_THEMES: Record<TerminalSettings["theme"], ThemeColors> = {
  dark: { background: "#1e1e1e", foreground: "#e6e6e6", cursor: "#e6e6e6" },
  light: { background: "#fbfbfb", foreground: "#1e1e1e", cursor: "#1e1e1e" },
  dracula: {
    background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", selectionBackground: "#44475a",
    black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
    brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
  },
  nord: {
    background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selectionBackground: "#434c5e",
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
    brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
  },
  solarized: {
    background: "#002b36", foreground: "#839496", cursor: "#93a1a1", selectionBackground: "#073642",
    black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
    brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
  },
  monokai: {
    background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f0", selectionBackground: "#49483e",
    black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75", blue: "#66d9ef", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
    brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e", brightYellow: "#f4bf75", brightBlue: "#66d9ef", brightMagenta: "#ae81ff", brightCyan: "#a1efe4", brightWhite: "#f9f8f5",
  },
};

/** 설정 드롭다운용 테마 목록(키 + 표시 이름). */
export const TERMINAL_THEME_LIST: { key: TerminalSettings["theme"]; label: string }[] = [
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
  { key: "dracula", label: "Dracula" },
  { key: "nord", label: "Nord" },
  { key: "solarized", label: "Solarized Dark" },
  { key: "monokai", label: "Monokai" },
];

export const DEFAULT_SETTINGS: AppSettings = {
  general: { restoreTabs: false, language: "en", uiFont: UI_FONTS[0].value },
  terminal: {
    fontSize: 14,
    fontFamily: "Menlo, Consolas, 'Courier New', monospace",
    cursorBlink: true,
    theme: "dark",
    scrollback: 1000,
    altScreenWheelScroll: true,
    logging: false,
    logDir: "",
    startDir: "",
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
