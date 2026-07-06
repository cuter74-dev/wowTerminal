import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { SshConnectError, TerminalSource, isSshConnectError } from "../types";
import {
  registerTerminal,
  unregisterTerminal,
  broadcastInput,
} from "../terminalRegistry";
import { emitCommandDone, emitTitleChange } from "../commandBus";
import * as Sentry from "@sentry/react";
import { SessionLogger } from "../sessionLog";
import { TerminalSettings, TERMINAL_THEMES } from "../settings";
import { addHistory, searchHistory, suggest } from "../commandHistory";
import { mobileCtrl, ctrlSeq } from "../mobileInput";
import { LangDict, useT } from "../i18n";

// [진단 #83 — M5 영문 잔상] writingsuggestions=false로도 안 잡혀 재계측. 구조 카운터만
// (타이핑 내용 없음) 입력 유휴 시 GlitchTip 전송. macOS 한정, 세션당 최대 4회. 해결 후 제거.
let imeDiagSends = 0;

// 비밀번호 프롬프트 감지 (#118) — 명령 히스토리/자동완성에 비밀번호가 새지 않게 한다.
// 출력의 마지막 줄이 "...password:", "[sudo] password for user:", "Enter passphrase ...:",
// "...암호:" 등이면 다음 입력 라인은 비밀번호로 보고 기록/제안에서 제외한다.
const PWD_PROMPT_RE = /(password|passphrase|암호|비밀번호|mot de passe|contraseña|passwort)[^\n]{0,80}:\s*$/i;
// 출력에서 ANSI 이스케이프/제어문자를 걷어내 프롬프트 텍스트만 본다(색상 코드 등 무시).
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "") // OSC
    .replace(/\x1b[[\]()#;?]*[0-9;]*[A-Za-z]/g, "") // CSI/기타 이스케이프
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // 기타 제어문자(개행 \n\r은 유지)
}

const STR: LangDict<{
    sessionHandover: string;
    hostKeyMismatch: (host: string, port: number) => string;
    firstContact: (host: string, port: number) => string;
    passwordRequired: (user: string, host: string, port: number) => string;
    sshError: (msg: string) => string;
    failedToStart: (err: string) => string;
    historyPlaceholder: string;
    noHistoryMatch: string;
    sessionClosed: string;
    reconnecting: string;
  }
> = {
  en: {
    sessionHandover: "\r\n\x1b[36m[session handed over — continue in the new window]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — see warning dialog\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — verify fingerprint in dialog\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — enter password in dialog\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "Search command history (Enter to select, ESC to cancel)",
    noHistoryMatch: "No matching history",
    sessionClosed: "\r\n\x1b[33m[disconnected — press Enter to reconnect]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[reconnecting…]\x1b[0m",
  },
  ko: {
    sessionHandover: "\r\n\x1b[36m[세션 인계됨 — 새 창에서 계속]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — 경고 대화상자를 확인하세요\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — 대화상자에서 지문을 확인하세요\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — 대화상자에 비밀번호를 입력하세요\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "명령 히스토리 검색 (Enter 선택, ESC 취소)",
    noHistoryMatch: "일치하는 히스토리 없음",
    sessionClosed: "\r\n\x1b[33m[연결이 끊어졌습니다 — Enter 키로 다시 연결]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[다시 연결하는 중…]\x1b[0m",
  },
  es: {
    sessionHandover: "\r\n\x1b[36m[sesión transferida — continúa en la nueva ventana]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — consulta el diálogo de advertencia\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — verifica la huella en el diálogo\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — introduce la contraseña en el diálogo\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "Buscar en el historial de comandos (Enter para seleccionar, ESC para cancelar)",
    noHistoryMatch: "No hay coincidencias en el historial",
    sessionClosed: "\r\n\x1b[33m[desconectado — pulsa Enter para reconectar]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[reconectando…]\x1b[0m",
  },
  zh: {
    sessionHandover: "\r\n\x1b[36m[会话已交接 — 在新窗口中继续]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — 请查看警告对话框\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — 请在对话框中验证指纹\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — 请在对话框中输入密码\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "搜索命令历史（Enter 选择，ESC 取消）",
    noHistoryMatch: "没有匹配的历史记录",
    sessionClosed: "\r\n\x1b[33m[连接已断开 — 按 Enter 重新连接]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[正在重新连接…]\x1b[0m",
  },
  ja: {
    sessionHandover: "\r\n\x1b[36m[セッションを引き継ぎました — 新しいウィンドウで続行]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — 警告ダイアログを確認してください\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — ダイアログでフィンガープリントを確認してください\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — ダイアログにパスワードを入力してください\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "コマンド履歴を検索（Enter で選択、ESC でキャンセル）",
    noHistoryMatch: "一致する履歴がありません",
    sessionClosed: "\r\n\x1b[33m[切断されました — Enter キーで再接続]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[再接続中…]\x1b[0m",
  },
  ru: {
    sessionHandover: "\r\n\x1b[36m[сессия передана — продолжите в новом окне]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — см. диалог предупреждения\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — проверьте отпечаток в диалоге\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — введите пароль в диалоге\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "Поиск по истории команд (Enter — выбрать, ESC — отменить)",
    noHistoryMatch: "Нет совпадений в истории",
    sessionClosed: "\r\n\x1b[33m[соединение разорвано — нажмите Enter для переподключения]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[переподключение…]\x1b[0m",
  },
  fr: {
    sessionHandover: "\r\n\x1b[36m[session transférée — continuez dans la nouvelle fenêtre]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — voir la boîte de dialogue d'avertissement\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — vérifiez l'empreinte dans la boîte de dialogue\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — saisissez le mot de passe dans la boîte de dialogue\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "Rechercher dans l'historique des commandes (Entrée pour sélectionner, ESC pour annuler)",
    noHistoryMatch: "Aucune correspondance dans l'historique",
    sessionClosed: "\r\n\x1b[33m[déconnecté — appuyez sur Entrée pour reconnecter]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[reconnexion…]\x1b[0m",
  },
  de: {
    sessionHandover: "\r\n\x1b[36m[Sitzung übergeben — im neuen Fenster fortfahren]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — siehe Warndialog\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — Fingerabdruck im Dialog überprüfen\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — Passwort im Dialog eingeben\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "Befehlsverlauf durchsuchen (Enter zum Auswählen, ESC zum Abbrechen)",
    noHistoryMatch: "Keine passenden Verlaufseinträge",
    sessionClosed: "\r\n\x1b[33m[getrennt — Enter zum erneuten Verbinden]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[verbinde erneut…]\x1b[0m",
  },
  vi: {
    sessionHandover: "\r\n\x1b[36m[phiên đã được bàn giao — tiếp tục trong cửa sổ mới]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — xem hộp thoại cảnh báo\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — xác minh dấu vân tay trong hộp thoại\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — nhập mật khẩu trong hộp thoại\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "Tìm trong lịch sử lệnh (Enter để chọn, ESC để hủy)",
    noHistoryMatch: "Không có lịch sử khớp",
    sessionClosed: "\r\n\x1b[33m[mất kết nối — nhấn Enter để kết nối lại]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[đang kết nối lại…]\x1b[0m",
  },
  id: {
    sessionHandover: "\r\n\x1b[36m[sesi diserahkan — lanjutkan di jendela baru]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — lihat dialog peringatan\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — verifikasi sidik jari di dialog\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — masukkan kata sandi di dialog\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "Cari riwayat perintah (Enter untuk memilih, ESC untuk membatalkan)",
    noHistoryMatch: "Tidak ada riwayat yang cocok",
    sessionClosed: "\r\n\x1b[33m[terputus — tekan Enter untuk menyambung ulang]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[menyambung ulang…]\x1b[0m",
  },
  hi: {
    sessionHandover: "\r\n\x1b[36m[सत्र सौंप दिया गया — नई विंडो में जारी रखें]\x1b[0m",
    hostKeyMismatch: (host, port) =>
      `\r\n\x1b[31m[ssh] host key mismatch for ${host}:${port} — चेतावनी संवाद देखें\x1b[0m`,
    firstContact: (host, port) =>
      `\r\n\x1b[33m[ssh] first contact with ${host}:${port} — संवाद में फ़िंगरप्रिंट सत्यापित करें\x1b[0m`,
    passwordRequired: (user, host, port) =>
      `\r\n\x1b[33m[ssh] password required for ${user}@${host}:${port} — संवाद में पासवर्ड दर्ज करें\x1b[0m`,
    sshError: (msg) => `\r\n[ssh] ${msg}`,
    failedToStart: (err) => `\r\n[session] failed to start: ${err}`,
    historyPlaceholder: "कमांड इतिहास खोजें (चुनने के लिए Enter, रद्द करने के लिए ESC)",
    noHistoryMatch: "कोई मेल खाता इतिहास नहीं",
    sessionClosed: "\r\n\x1b[33m[कनेक्शन टूट गया — पुनः जोड़ने के लिए Enter दबाएं]\x1b[0m",
    reconnecting: "\r\n\x1b[36m[पुनः जोड़ रहा है…]\x1b[0m",
  },
};

// 우클릭 컨텍스트 메뉴 + 검색 라벨.
const CTX_STR: LangDict<{
  copy: string;
  paste: string;
  selectAll: string;
  clear: string;
  searchPlaceholder: string;
}> = {
  en: { copy: "Copy", paste: "Paste", selectAll: "Select all", clear: "Clear", searchPlaceholder: "Find in terminal" },
  ko: { copy: "복사", paste: "붙여넣기", selectAll: "전체 선택", clear: "지우기", searchPlaceholder: "터미널에서 찾기" },
  es: { copy: "Copiar", paste: "Pegar", selectAll: "Seleccionar todo", clear: "Limpiar", searchPlaceholder: "Buscar en el terminal" },
  zh: { copy: "复制", paste: "粘贴", selectAll: "全选", clear: "清屏", searchPlaceholder: "在终端中查找" },
  ja: { copy: "コピー", paste: "貼り付け", selectAll: "すべて選択", clear: "クリア", searchPlaceholder: "ターミナル内を検索" },
  ru: { copy: "Копировать", paste: "Вставить", selectAll: "Выделить всё", clear: "Очистить", searchPlaceholder: "Поиск в терминале" },
  fr: { copy: "Copier", paste: "Coller", selectAll: "Tout sélectionner", clear: "Effacer", searchPlaceholder: "Rechercher dans le terminal" },
  de: { copy: "Kopieren", paste: "Einfügen", selectAll: "Alles auswählen", clear: "Leeren", searchPlaceholder: "Im Terminal suchen" },
  vi: { copy: "Sao chép", paste: "Dán", selectAll: "Chọn tất cả", clear: "Xóa", searchPlaceholder: "Tìm trong terminal" },
  id: { copy: "Salin", paste: "Tempel", selectAll: "Pilih semua", clear: "Bersihkan", searchPlaceholder: "Cari di terminal" },
  hi: { copy: "कॉपी", paste: "पेस्ट", selectAll: "सभी चुनें", clear: "साफ़ करें", searchPlaceholder: "टर्मिनल में खोजें" },
};

type OutputPayload = {
  session_id: string;
  data_b64: string;
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// OSC 133 커맨드 블록 배지를 해당 명령 줄에 decoration으로 단다.
// 상태 배지(✓/✗+시간) 클릭 = 블록 출력 복사, ✨ 클릭 = 그 블록을 AI에 질문.
type Commands = {
  spawnCmd: string;
  writeCmd: string;
  resizeCmd: string;
  killCmd: string;
  outputEvent: string;
  spawnArgs: (cols: number, rows: number) => Record<string, unknown>;
};

// 파일 브라우저 cwd 동기화를 원하는 사용자가 원격 ~/.bashrc(zsh는 ~/.zshrc)에 직접 넣을 수
// 있는 OSC 7 훅. 우리는 더 이상 런타임 주입하지 않고(프롬프트 잔상 유발), 수신 핸들러만 둔다.
//   __wt7(){ printf '\033]7;file://%s\007' "$PWD"; }
//   if [ -n "$ZSH_VERSION" ]; then precmd_functions+=(__wt7); else PROMPT_COMMAND="__wt7;$PROMPT_COMMAND"; fi

function commandsFor(
  source: TerminalSource,
  password?: string,
  defaultCwd?: string,
): Commands {
  if (source.kind === "local") {
    return {
      spawnCmd: "pty_spawn",
      writeCmd: "pty_write",
      resizeCmd: "pty_resize",
      killCmd: "pty_kill",
      outputEvent: "pty:output",
      // 세션 복원(#90)의 저장 cwd가 우선, 없으면 설정의 기본 시작 폴더(#91), 없으면 홈.
      spawnArgs: (cols, rows) => ({
        args: { cols, rows, cwd: source.cwd ?? (defaultCwd || null) },
      }),
    };
  }
  return {
    spawnCmd: "ssh_connect",
    writeCmd: "ssh_write",
    resizeCmd: "ssh_resize",
    killCmd: "ssh_kill",
    outputEvent: "ssh:output",
    spawnArgs: (cols, rows) => ({
      args: {
        hostId: source.hostId,
        cols,
        rows,
        ...(password !== undefined ? { password } : {}),
      },
    }),
  };
}

interface Props {
  source: TerminalSource;
  /** SSH spawn에서 구조화된 에러를 받으면 호출. 모달 띄우는 용도. */
  onSshError?: (err: SshConnectError) => void;
  /** SSH 연결 성공 시 한 번 호출. App이 password 저장 여부 결정 등에 사용. */
  onSshConnected?: () => void;
  /** 재시도 트리거. 값이 바뀌면 effect가 다시 실행되어 새로 spawn. */
  retryNonce?: number;
  /** PasswordPrompt 인증의 즉석 password. 모달 입력 후 retryNonce와 함께 전달. */
  password?: string;
  /** 이 터미널이 속한 pane(leaf) id. terminalRegistry 등록 키로 사용. */
  paneId?: string;
  /** 터미널 폰트/테마 설정. 변경 시 런타임으로 반영. */
  termSettings: TerminalSettings;
  /** spawn 성공 시 sessionId 보고 (세션 인계용 — App이 leafId→sessionId 보관). */
  onSession?: (sessionId: string) => void;
  /** 세션 인계: 있으면 새 spawn 대신 이 기존 sessionId에 attach (listen + write/resize). */
  attachSessionId?: string;
  /** 세션 인계: 분리 직전 원본 화면 스냅샷(ANSI). attach 시 먼저 복원해 이전 화면을 보존. */
  attachScreen?: string;
}

export function Terminal({
  source,
  onSshError,
  onSshConnected,
  retryNonce = 0,
  password,
  paneId,
  termSettings,
  onSession,
  attachSessionId,
  attachScreen,
}: Props) {
  const t = useT(STR);
  // effect 의존성을 바꾸지 않도록 현재 언어 문자열을 ref로 들고 다닌다.
  const tRef = useRef(t);
  tRef.current = t;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  // 터미널 검색(⌘F) 오버레이 표시 여부.
  const [searchOpen, setSearchOpen] = useState(false);
  // 첫 마운트 시점의 설정으로 생성하고, 이후 변경은 아래 별도 effect가 런타임 반영.
  const initialSettings = useRef(termSettings);
  // 대체 화면 휠→화살표 변환 토글 (휠 핸들러가 최신 값을 읽도록 ref로).
  const altWheelRef = useRef(termSettings.altScreenWheelScroll);
  altWheelRef.current = termSettings.altScreenWheelScroll;

  // 명령 히스토리 / 인라인 자동완성 (S-051/053)
  const lineBufRef = useRef("");
  // 비밀번호 프롬프트 감지 (#118): sudo/ssh 등의 비밀번호·passphrase 입력은 에코가 꺼져
  // 화면엔 안 보이지만, 입력 추적은 키 기준이라 그대로 히스토리/자동완성에 들어가 누출된다.
  // 출력 끝이 비밀번호 프롬프트면 이 플래그를 켜고, 그 라인은 기록/제안에서 제외한다.
  const passwordModeRef = useRef(false);
  const outTailRef = useRef("");
  const suggestionRef = useRef<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState(false);
  // 우클릭 컨텍스트 메뉴 (복사/붙여넣기/전체선택/지우기).
  const ctx = useT(CTX_STR);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // 세션에 입력을 보내는 함수 (Ctrl-R 선택 / 제안 수락에서 사용). effect에서 채움.
  const sendToSessionRef = useRef<((text: string) => void) | null>(null);
  // 세션 로깅 (#65). 설정 토글에 따라 생성/해제, 출력 핸들러가 ref로 참조.
  const loggerRef = useRef<SessionLogger | null>(null);

  const sourceKey =
    source.kind === "local" ? "local" : `ssh:${source.hostId}`;

  // 로깅 on/off 런타임 반영. 켜져 있으면 세션별 로거 생성, 꺼지면 flush 후 해제.
  useEffect(() => {
    if (termSettings.logging) {
      if (!loggerRef.current) {
        const label = source.kind === "local" ? "local" : `ssh-${source.hostId}`;
        loggerRef.current = new SessionLogger(termSettings.logDir, label);
      }
    } else if (loggerRef.current) {
      loggerRef.current.dispose();
      loggerRef.current = null;
    }
  }, [termSettings.logging, termSettings.logDir, source]);

  // 언마운트 시 남은 버퍼를 flush.
  useEffect(
    () => () => {
      loggerRef.current?.dispose();
      loggerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const s = initialSettings.current;
    const term = new XTerm({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      cursorBlink: s.cursorBlink,
      scrollback: s.scrollback,
      theme: TERMINAL_THEMES[s.theme],
      // 명령 배지(OSC 133)가 쓰는 registerDecoration/registerMarker는 xterm의 proposed API라
      // 이 옵션이 없으면 호출 시 예외가 발생해 출력 파서가 멈춘다(명령 실행 직후 화면이 멈추는
      // 현상). @xterm/xterm 6.0.0이 이를 enforce한다.
      allowProposedApi: true,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);
    // 스크롤백 검색(⌘F).
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchRef.current = searchAddon;
    // 출력의 URL을 클릭하면 기본 브라우저로 연다(Tauri opener).
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void openUrl(uri).catch(() => {});
      }),
    );
    term.open(containerRef.current);
    // 최신 macOS WKWebView의 인라인 예측 텍스트(작성 제안)를 끈다. 켜져 있으면 **영어 입력도**
    // IME 처리(keyCode 229, composition 이벤트는 없음)로 흘러 커스텀 미러가 개입하고, 예측
    // 텍스트가 textarea 값을 고쳐 쓰면서 미러 diff가 백스페이스+재전송 폭풍이 된다(M5에서
    // `df -h` 5타에 15글자+백스페이스 10개 전송 — GlitchTip 트레이스). 그 churn이 oh-my-zsh
    // 라인 재그리기와 얽혀 프롬프트에 실제 잔상 글자를 남긴다(#83 — net은 맞아 명령은 정상
    // 실행). xterm은 autocorrect/autocapitalize/spellcheck만 끄고 이 속성은 모른다.
    term.textarea?.setAttribute("writingsuggestions", "false");
    // WebGL 렌더러(GPU 가속). 컨텍스트 손실/실패 시 dispose하면 xterm이 자동으로 DOM
    // 렌더러로 폴백한다. (#83 잔상 수정 시도로 도입했으나 원인은 렌더러가 아니라 위
    // writingsuggestions였다 — 성능 이점이 있어 유지.)
    // [진단 #83] 렌더러 상태 — M5 잔상은 입력 경로 결백으로 판명(0.14.7 실측: `df -h`가
    // onData 6자뿐, 미러 미개입). 남은 용의자(렌더러 vs 에코/파싱)를 가리기 위해 수집.
    const rendDiag = { webgl: false, ctxLost: 0 };
    // 윈도우 디스플레이 배율 125%/150%/175%처럼 devicePixelRatio가 소수면 WebGL 렌더러가
    // 셀 높이를 정수 픽셀로 반올림하며 커서 레이어와 글자 레이어가 세로로 어긋나, 커서가
    // 글자 위/아래에 그려진다(150%에서 제보). 소수 DPR에선 GPU 가속을 포기하고 기본 DOM
    // 렌더러(CSS 기반 → 커서가 글자와 정렬)로 둔다. 정수 DPR(맥 Retina=2·일반=1, 윈도우
    // 100%/200%)에선 WebGL 유지. (정수가 아니면 isInteger=false → DOM.)
    const dprIntegral = Number.isInteger(window.devicePixelRatio || 1);
    if (dprIntegral) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          rendDiag.ctxLost++;
          rendDiag.webgl = false;
          webgl.dispose();
        });
        term.loadAddon(webgl);
        rendDiag.webgl = true;
      } catch {
        // WebGL 미지원 환경 — 기본 DOM 렌더러 유지.
      }
    }
    // 컨테이너에 실제 크기가 있을 때만 fit(0 크기면 cols/rows가 최소로 줄어 spawn 크기가 깨짐).
    if (
      containerRef.current.clientWidth >= 8 &&
      containerRef.current.clientHeight >= 8
    ) {
      fit.fit();
    }

    const cmds = commandsFor(source, password, initialSettings.current.startDir);
    let sessionId: string | null = null;
    let unlistenOutput: UnlistenFn | null = null;
    // OSC 7로 추적하는 셸 현재 작업 디렉토리 (파일 브라우저 시작 위치용).
    let currentCwd: string | null = null;
    // 셸이 디렉토리 변경 시 `\e]7;file://host/path\a`를 출력하면 여기서 잡는다.
    term.parser.registerOscHandler(7, (payload) => {
      // payload 예: "file:///home/user" 또는 "file://host/home/user"
      const m = /^file:\/\/[^/]*(\/.*)$/.exec(payload);
      if (m) {
        try {
          currentCwd = decodeURIComponent(m[1]);
        } catch {
          currentCwd = m[1];
        }
      }
      return true; // 처리 완료(false면 xterm 파서가 잔여 처리로 다음 출력을 삼킬 수 있음)
    });

    // OSC 52: 앱이 클립보드에 복사(`\e]52;c;<base64>\a`). tmux(set-clipboard on)/vim 등이
    // copy 시 이 시퀀스를 보내면 시스템 클립보드에 반영한다. 보안상 쓰기만 허용하고
    // 읽기 요청("?")은 무시한다(원격이 클립보드를 읽지 못하게).
    term.parser.registerOscHandler(52, (payload) => {
      const semi = payload.indexOf(";");
      if (semi < 0) return true;
      const data = payload.slice(semi + 1); // 셀렉션(c/p/...) 다음의 base64
      if (data === "" || data === "?") return true; // 읽기 요청 — 응답 안 함
      try {
        const text = new TextDecoder().decode(base64ToBytes(data));
        if (text) void navigator.clipboard.writeText(text);
      } catch {
        // 잘못된 base64 등은 무시.
      }
      return true; // 처리 완료
    });

    // OSC 133 셸 시맨틱 통합: 명령 시작(C)·종료(D;exit)를 받아 명령별 종료코드·실행시간 배지.
    // (로컬 zsh는 spawn 시 ZDOTDIR로 훅 주입됨. SSH/기타 셸은 사용자가 rc에 넣으면 동작.)
    let cmdStart = 0;
    let cMarker: IMarker | undefined;
    const cmdMarkers: IMarker[] = []; // ⌘↑/↓ 명령 점프용.
    term.parser.registerOscHandler(133, (payload) => {
      // 배지/마커는 proposed API라 예외가 날 수 있다 — 한 번의 실패가 xterm 출력 파서를
      // 멈춰 이후 모든 출력이 안 그려지는 일이 없도록 핸들러 전체를 가드한다.
      try {
      const kind = payload[0];
      if (kind === "C") {
        cmdStart = Date.now();
        cMarker = term.registerMarker(0);
      } else if (kind === "D") {
        const exit = parseInt(payload.split(";")[1] ?? "", 10);
        if (cmdStart) {
          emitCommandDone({
            paneId: paneId ?? "",
            durationMs: Date.now() - cmdStart,
            exit: isNaN(exit) ? 0 : exit,
          });
        }
        // 명령 배지(✓/✗·시간) 표시는 비활성화됨(사용자 요청). 마커만 남겨 ⌘↑/↓ 명령 점프에 쓴다.
        if (cMarker) cmdMarkers.push(cMarker);
        cmdStart = 0;
        cMarker = undefined;
      }
      } catch {
        // 배지 실패는 무시 — 출력 표시가 멈추지 않게 한다.
      }
      return true;
    });

    // 대체화면 TUI(vim/tmux/Claude Code 등)가 마우스 추적 모드를 켠 뒤 끄지 않고 종료하면,
    // 일반 셸 프롬프트에서 클릭/드래그 시 좌표가 텍스트로 찍힌다(`\e[<0;30;5M` 등이 셸로 감).
    // 일반 화면으로 복귀할 때 추적/포커스 리포팅 모드를 끈다(일반 셸은 안 쓰므로 안전).
    const onBufChange = term.buffer.onBufferChange((b) => {
      if (b.type === "normal") {
        term.write(
          "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1015l",
        );
      } else {
        // 대체 화면(vim/Claude Code 등) 진입 시 잔여 인라인 제안을 즉시 비운다 (#110).
        lineBufRef.current = "";
        suggestionRef.current = null;
        setSuggestion(null);
      }
    });
    let disposed = false;

    const encoder = new TextEncoder();
    // [진단 #100 임시] PTY로 실제 보낸 입력 바이트 링 + 특수키 keydown 링. "백스페이스가
    // 스페이스처럼 동작" 류 버그에서 백스페이스가 무슨 바이트(\x7f? \x20? 없음?)를 보내는지,
    // 그 keydown이 어떤 key/keyCode/isComposing/imeActive였는지 본다. composition 머신은
    // 로컬(미서명=229-only)에서 재현 불가라 서명 빌드로 실측한다. #100 종결 시 제거.
    const escCtl = (s: string) =>
      s.replace(
        /[\x00-\x1f\x7f]/g,
        (c) => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0"),
      );
    const inputRing: string[] = [];
    const kdRing: string[] = [];
    // 쓰기를 순서대로 직렬화한다. IME 미러는 "ㄱ" 다음 "\x7f가"처럼 연속 전송하는데,
    // await 없이 invoke를 발사하면 PTY 도착 순서가 뒤바뀌어(백스페이스가 먼저 가는 등)
    // 자모가 남는다. 프로미스 체인으로 직전 쓰기 완료 후 다음을 보낸다.
    let writeChain: Promise<unknown> = Promise.resolve();
    const writeToSession = (text: string) => {
      if (!sessionId) return;
      // [진단 #100] 보낸 바이트 기록(macOS 한정, 최근 30건).
      if (isMacWebView) {
        if (inputRing.length >= 30) inputRing.shift();
        inputRing.push(escCtl(text));
      }
      const dataB64 = bytesToBase64(encoder.encode(text));
      const sid = sessionId;
      writeChain = writeChain.then(() =>
        invoke(cmds.writeCmd, { sessionId: sid, dataB64 }).catch(() => {}),
      );
    };
    sendToSessionRef.current = writeToSession;

    // 한글/CJK IME 미러 상태 (자세한 설명은 아래 input 핸들러 참고).
    let imeActive = false;
    let imeSent = "";
    // 최신 WKWebView(예: macOS M-시리즈 최신판)는 표준 composition 이벤트를 정상 발생시킨다.
    // 그런 환경에선 xterm 네이티브 IME가 입력을 처리하므로 커스텀 미러를 꺼야 한다(둘 다
    // 입력을 보내 글자가 중복되는 버그 방지 — 최신 macOS는 영어 입력도 인라인 예측 텍스트로
    // composition을 거친다). compositionstart가 한 번이라도 관찰되면 true로 고정된다.
    // **macOS 한정**: Windows(WebView2)·Linux(WebKitGTK)는 원래부터 composition 이벤트를
    // 발생시키지만 거기선 커스텀 미러가 한글 입력을 담당한다. 네이티브로 넘기면 Windows에서
    // 한글이 전혀 입력되지 않으므로(#83 회귀), 이 바이패스는 macOS에서만 적용한다.
    // 커스텀 IME 미러는 **macOS(229-only WKWebView) 전용**이다(아래 input 핸들러 설명 참고).
    // Windows(WebView2)·Linux(WebKitGTK)는 표준 composition 이벤트로 xterm이 네이티브 IME를
    // 직접 처리하므로 미러를 끈다(#88). nativeComposition은 **조합이 진행 중인 동안만** true:
    // 영구 latch로 두면 악센트 길게 누르기/받아쓰기 같은 단발 composition 한 번에 미러가
    // 영영 꺼져, 229-only 맥에서 그 순간부터 한글이 깨진다(재시작 전까지 — #83에서 실측).
    const isMacWebView = navigator.userAgent.includes("Mac");
    let nativeComposition = false;
    // 조합이 실제 진행 중인 동안(compositionstart~compositionend)만 true. nativeComposition은
    // composition 머신에서 영구 true로 고정되므로 "지금 조합 중"을 별도로 추적한다(#100 중복).
    let composing = false;
    // 일부 macOS(특히 최신 M-시리즈 설치본)는 한글을 **표준 composition 이벤트로** 처리한다
    // — 이런 머신에선 xterm 네이티브 IME가 조합을 완벽히 다루므로 커스텀 미러는 순수 방해다
    // (미러가 음절 첫 229에서 잠깐 켜져 stray를 보내고, imeActive가 영어 전환 후까지 남아
    // Backspace를 삼킨다 — 실측 진단 nCS:15/n229:19/mirror:4, "한글 깨짐 + 삭제 안 됨").
    // compositionMachine이 true면 229는 항상 네이티브로 넘기고 미러를 절대 켜지 않는다.
    // 판별 신호: **한글을 커밋하는 composition**(compositionupdate/end의 data에 한글).
    // 229-only 머신(미러 필수)은 이 신호를 절대 만들지 않고(composition 자체가 없음),
    // 악센트 길게 누르기/받아쓰기 같은 단발 composition은 라틴 문자라 오검출되지 않는다 —
    // v0.14.3의 "단발 composition이 미러를 영영 꺼버림" 회귀를 피하는 핵심 구분점이다.
    const CMP_KEY = "wt.ime.cmp";
    const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
    let compositionMachine = false;
    try {
      compositionMachine = localStorage.getItem(CMP_KEY) === "1";
    } catch {
      /* 무시 */
    }
    const markCompositionMachine = (data: string | null) => {
      if (compositionMachine || !data || !HANGUL.test(data)) return;
      compositionMachine = true;
      // 미러가 마침 켜져 있었다면(음절 첫 229) 즉시 꺼서 stray 전송을 멈춘다.
      if (imeActive) resetIme();
      // composition-view 숨김 해제 — 조합 중 음절이 커서에 가려 안 보이지 않게(#100).
      try {
        document.body.classList.add("wt-native-ime");
      } catch {
        /* 무시 */
      }
      try {
        localStorage.setItem(CMP_KEY, "1");
      } catch {
        /* 무시 */
      }
    };

    // [진단 #83] IME 경로 카운터(구조만). 3초 입력 유휴 시 1회 전송 후 리셋.
    const imeDiag = {
      n229: 0,
      nCS: 0,
      nCU: 0,
      nCE: 0,
      onDataChars: 0,
      mirrorBs: 0,
      mirrorChars: 0,
      bsSuppressed: 0, // ASCII 다중 백스페이스 재작성 억제량 (이번 수정의 효과 지표)
    };
    // [진단 #83] 최근 미러 전이 내용 링버퍼(최대 14건). 카운터만으로는 "textarea 조합
    // 자체가 깨지는" 부류(자모+공백 유입)를 판별할 수 없어 내용을 본다 — 제보 머신의
    // 한글 자모·공백 잔상 진단용. 전송 후 비움.
    const imeRing: { s: string; f: string }[] = [];
    const ringPush = (sent: string, full: string) => {
      if (imeRing.length >= 14) imeRing.shift();
      imeRing.push({ s: sent, f: full });
    };
    // [진단 #83] 최근 PTY 에코 청크 링(최대 10건, 청크당 160자, 이스케이프 표기) — zsh
    // 구문강조 재그리기가 실제로 무슨 시퀀스를 그리는지 본다. 입력 결백이 확정된 M5 잔상의
    // 남은 분기: 에코가 잔상 글자를 포함(셸/파싱 쪽)하는지, 버퍼는 깨끗한데 화면만
    // 더러운지(렌더러 쪽). #83 종결 시 제거.
    const echoRing: string[] = [];
    const echoDecoder = new TextDecoder();
    const echoPush = (bytes: Uint8Array) => {
      if (!isMacWebView) return;
      let s: string;
      try {
        s = echoDecoder.decode(bytes);
      } catch {
        return;
      }
      if (s.length > 160) s = s.slice(0, 160) + `…(+${s.length - 160})`;
      if (echoRing.length >= 10) echoRing.shift();
      echoRing.push(JSON.stringify(s));
    };
    let imeDiagTimer = 0;
    const scheduleImeDiag = () => {
      if (!isMacWebView) return;
      clearTimeout(imeDiagTimer);
      imeDiagTimer = window.setTimeout(() => {
        const any =
          imeDiag.n229 +
          imeDiag.nCS +
          imeDiag.nCU +
          imeDiag.nCE +
          imeDiag.onDataChars +
          imeDiag.mirrorChars +
          imeDiag.bsSuppressed;
        if (any === 0) return;
        // 로컬 누적 덤프 — 전송 한도와 무관하게 localStorage에 합산(로컬 디버깅용).
        try {
          const k = "wt.ime.local-diag";
          const prev = JSON.parse(localStorage.getItem(k) ?? "{}") as Record<
            string,
            number
          >;
          const merged: Record<string, number> = { ...prev };
          for (const [key, v] of Object.entries(imeDiag)) {
            merged[key] = (merged[key] ?? 0) + v;
          }
          merged.at = Date.now();
          localStorage.setItem(k, JSON.stringify(merged));
        } catch {}
        if (imeDiagSends < 4) {
          imeDiagSends++;
          // [진단 #83] 전송 시점의 커서 줄 + 위 3줄의 **버퍼 텍스트**. 화면의 잔상이
          // 버퍼에 실재하면(파싱/에코 쪽) 여기 그대로 찍히고, 버퍼가 깨끗하면 렌더러가
          // 못 지운 것이다 — M5 잔상의 결정적 분기점.
          const bufTail = (): string[] => {
            try {
              const b = term.buffer.active;
              const end = b.baseY + b.cursorY;
              const out: string[] = [];
              for (let i = Math.max(0, end - 3); i <= end; i++) {
                out.push(b.getLine(i)?.translateToString(true) ?? "");
              }
              return out;
            } catch {
              return [];
            }
          };
          try {
            Sentry.captureMessage("wt-ime-diag2", {
              level: "info",
              extra: {
                ua: navigator.userAgent,
                ws: term.textarea?.getAttribute("writingsuggestions") ?? null,
                ...imeDiag,
                ring: imeRing.slice(),
                rend: { ...rendDiag, cols: term.cols, rows: term.rows },
                echo: echoRing.slice(),
                lines: bufTail(),
                input: inputRing.slice(), // [진단 #100] PTY로 보낸 바이트
                kd: kdRing.slice(), // [진단 #100] 특수키 keydown
                lang: navigator.language,
              },
            });
          } catch {}
        }
        imeDiag.n229 = imeDiag.nCS = imeDiag.nCU = imeDiag.nCE = 0;
        imeDiag.onDataChars = 0;
        imeDiag.mirrorBs = imeDiag.mirrorChars = imeDiag.bsSuppressed = 0;
        imeRing.length = 0;
        echoRing.length = 0;
        inputRing.length = 0;
        kdRing.length = 0;
      }, 3000);
    };

    const onDataDisposable = term.onData((rawData) => {
      if (!sessionId) return;
      // IME 미러 세션 중에는 xterm이 비동기로 보내는 (깨진) 데이터를 무시한다.
      // 한글 입력은 아래 textarea input 미러만 PTY로 보낸다.
      if (imeActive) return;
      // composition 머신: 조합 진행 중(Cs~Ce)의 onData는 정상 타이핑에선 발생하지 않는다
      // (xterm은 조합 중 onData를 보류하고 compositionend에서 한 번만 보낸다). 그런데 한/영
      // 전환 키(오른쪽 Cmd)를 조합 중에 누르면 그 음절이 조합 중 1회 + compositionend 1회로
      // 두 번 전송돼 중복된다(#100, seq 실측: ⌨Meta/93/c → →가 → Ce:가 → →가). 조합 진행
      // 중 전송은 버리고 compositionend 전송만 남겨 정확히 1회가 되게 한다.
      if (compositionMachine && composing) return;
      // macOS 인라인 예측 텍스트가 스페이스를 non-breaking space(U+00A0)로 커밋하는 문제(#100):
      // 셸(zsh ZLE)은 nbsp를 일반 칸으로 취급하지 않아 커서 열 계산이 터미널과 어긋나고,
      // 그 상태에서 Backspace를 누르면 지움이 엉뚱한 칸에 빈칸으로 떨어진다("백스페이스가
      // 스페이스처럼 동작"). 사용자가 스페이스를 친 것이므로 일반 스페이스로 정규화한다.
      const data = isMacWebView ? rawData.replace(/\u00a0/g, " ") : rawData;
      // (macOS **미러 경로 한정**) 단독 호환 자모(U+3130–U+318F: ㄱ, ㅏ 등)는 imeActive
      // 설정 직전 타이밍 틈에 xterm이 흘리는 조합 누수이므로 버린다. 단, composition 머신
      // (네이티브 IME)에서는 사용자가 진짜로 친 단독 자모(ㅇ, ㅏ)도 onData로 정상 커밋되므로
      // 버리면 안 된다 — 버리면 "ㅇㅇ/ㅏㅏ 같은 단독 자모가 안 써짐"(#100). Windows/Linux도 동일.
      if (isMacWebView && !compositionMachine && data.length === 1) {
        const cp = data.charCodeAt(0);
        if (cp >= 0x3130 && cp <= 0x318f) return;
      }
      writeToSession(data);
      broadcastInput(paneId ?? "", data); // 브로드캐스트 ON이면 다른 패널에도.
      imeDiag.onDataChars += data.length; // [진단 #83]
      scheduleImeDiag();

      // 대체 화면 TUI(vim/Claude Code/less 등)에서는 줄 추적·인라인 제안을 끈다 — 키 입력이
      // 셸 명령줄이 아니라 그 앱으로 가므로 제안이 무의미하고, →/End로 수락되면 앱의 키 동작을
      // 가로챈다. 일반 화면일 때만 추적/제안한다.
      if (term.buffer.active.type === "alternate") {
        lineBufRef.current = "";
        if (suggestionRef.current) {
          suggestionRef.current = null;
          setSuggestion(null);
        }
        return;
      }
      // 비밀번호 프롬프트 입력 라인은 히스토리/제안에서 제외(#118) — 에코가 꺼져 화면엔 안
      // 보이지만 키 입력 추적엔 잡히므로 여기서 막는다. Enter로 비밀번호 모드를 해제한다.
      if (passwordModeRef.current) {
        if (data.includes("\r") || data.includes("\n")) passwordModeRef.current = false;
        lineBufRef.current = "";
        if (suggestionRef.current) {
          suggestionRef.current = null;
          setSuggestion(null);
        }
        return;
      }
      // 입력 라인 추적 (단순): 타이핑/백스페이스/엔터만 정확. 화살표 등은 라인 리셋.
      for (const ch of data) {
        if (ch === "\r" || ch === "\n") {
          const cmd = lineBufRef.current.trim();
          if (cmd) addHistory(cmd);
          lineBufRef.current = "";
        } else if (ch === "\x7f" || ch === "\b") {
          lineBufRef.current = lineBufRef.current.slice(0, -1);
        } else if (ch >= " " && ch !== "\x7f") {
          lineBufRef.current += ch;
        } else {
          // 기타 제어문자(화살표/Ctrl-C 등) → 추적 신뢰 불가, 리셋.
          lineBufRef.current = "";
        }
      }
      const buf = lineBufRef.current;
      const sug = buf ? suggest(buf) : null;
      suggestionRef.current = sug;
      setSuggestion(sug);
    });

    // 한글/CJK IME 처리.
    // WKWebView(macOS)는 이 textarea에 compositionstart/end 이벤트를 보내지 않고
    // 조합 키에 keyCode 229만 준다. 그래서 xterm의 조합 처리기가 음절 경계를 못 잡고
    // 깨진 자모/음절을 onData로 흘린다. 대신 조합 키를 xterm이 처리하지 못하게 막고,
    // textarea.value(항상 올바른 전체 텍스트)를 PTY에 직접 미러링한다.
    // imeSent: 현재 IME 입력 중 이미 PTY로 보낸 부분. 값이 바뀌면 공통 접두 이후를
    // 백스페이스(\x7f)로 지우고 새 꼬리를 보내 셸 라인이 textarea와 일치하도록 한다.
    const ta = term.textarea;
    const resetIme = () => {
      imeActive = false;
      imeSent = "";
      if (ta) ta.value = "";
    };
    // textarea.value(항상 올바른 전체 텍스트)와 이미 보낸 부분(imeSent)의 차이를 계산해,
    // 공통 접두 이후를 백스페이스로 지우고 새 꼬리를 PTY로 보낸다. 셸 라인을 textarea와
    // 일치시킨다. input 이벤트와 compositionend 양쪽에서 호출(둘 다 idempotent).
    const flushMirror = () => {
      if (!ta) return;
      const full = ta.value;
      let c = 0;
      while (c < full.length && c < imeSent.length && full[c] === imeSent[c]) {
        c++;
      }
      const bs = imeSent.length - c;
      // 순수 ASCII 값에서 2글자 이상을 되감는 재작성은 사용자가 친 키가 아니라 macOS
      // 예측 텍스트류가 textarea를 고쳐 쓴 것이다(#83 M5: `df -h` 5타에 백스페이스 10개
      // 폭풍 → zsh 재그리기와 얽혀 프롬프트 잔상; writingsuggestions=false로도 안 막힘).
      // 터미널은 raw 키 입력을 원하므로 그런 재작성은 PTY로 보내지 않고 추적값만 동기화
      // 한다(이후 append는 정상 전송). 한글/CJK가 섞인 값은 진짜 조합 되감기이므로 종전대로
      // 전부 미러링. (백스페이스 1개는 실제 Backspace 키/단일 교정이라 허용.)
      ringPush(imeSent, full); // [진단 #83]
      const asciiOnly =
        /^[\x20-\x7e]*$/.test(full) && /^[\x20-\x7e]*$/.test(imeSent);
      if (asciiOnly && bs > 1) {
        imeDiag.bsSuppressed += bs; // [진단 #83]
        imeSent = full;
        return;
      }
      imeDiag.mirrorBs += bs; // [진단 #83]
      imeDiag.mirrorChars += full.length - c; // [진단 #83]
      let out = "";
      for (let i = 0; i < bs; i++) out += "\x7f";
      // non-breaking space(U+00A0) → 일반 스페이스 정규화 (#100, onData 경로와 동일 이유).
      out += full.slice(c).replace(/\u00a0/g, " ");
      if (out) {
        writeToSession(out);
        broadcastInput(paneId ?? "", out);
      }
      imeSent = full;
    };
    // ⌘V 붙여넣기 잔류 정리 (#97): xterm paste 핸들러는 텍스트를 PTY로 보낸 뒤
    // preventDefault를 하지 않아, 기본 동작이 같은 텍스트를 textarea에 삽입해 남긴다.
    // 다음 틱에 비워 미러가 잔류를 재전송하지 못하게 한다(조합 중이면 건드리지 않음).
    if (ta) {
      ta.addEventListener("paste", () => {
        setTimeout(() => {
          if (!imeActive && ta.value) ta.value = "";
        }, 0);
      });
    }
    // 미러는 macOS에서만 켠다. Windows/Linux는 xterm 네이티브 IME가 한글/CJK를 직접 처리하므로
    // 미러 리스너를 등록하지 않는다(미러가 첫 음절 후 stuck되어 입력을 막던 #88을 근본 차단).
    if (ta && isMacWebView) {
      // 캡처 단계로 등록해 xterm의 input 핸들러보다 먼저 실행 → IME 중에는
      // stopImmediatePropagation으로 xterm이 같은 input을 또 보내는 이중 전송을 막는다.
      ta.addEventListener(
        "input",
        (ev) => {
          if (!imeActive) return; // 영어/제어키는 xterm 기존 경로가 담당.
          ev.stopImmediatePropagation();
          flushMirror();
          scheduleImeDiag(); // [진단 #83]
        },
        true,
      );
      // 최신 WKWebView에서 표준 composition 이벤트가 발생하면 그 사실을 기억해 커스텀 미러를
      // 끈다(한 번이라도 관찰되면 이후 전부 xterm 네이티브 IME에 맡긴다 — 구형은 미러 유지).
      ta.addEventListener("compositionstart", () => {
        imeDiag.nCS++; // [진단 #83]
        scheduleImeDiag();
        composing = true;
        nativeComposition = true;
        // 조합 머신에선 textarea를 건드리지 않는다 — 네이티브 composition이 소유하므로
        // ta.value를 비우면 조합 중인 음절이 깨진다("한글이 제대로 안 써짐"의 직접 원인).
        if (!compositionMachine) resetIme();
      });
      ta.addEventListener("compositionupdate", (e) => {
        imeDiag.nCU++;
        scheduleImeDiag();
        // 조합 중 한글이 보이면 이 머신은 네이티브 composition으로 한글을 처리한다 — 미러 영구 OFF.
        markCompositionMachine((e as CompositionEvent).data);
      });
      ta.addEventListener("compositionend", (e) => {
        imeDiag.nCE++;
        scheduleImeDiag();
        composing = false;
        markCompositionMachine((e as CompositionEvent).data);
        // 조합 머신으로 확정됐으면 영구히 네이티브 유지(미러로 절대 복귀하지 않음).
        if (compositionMachine) return;
        // (미확정/229-only) 조합이 끝나면 잠깐 뒤 미러 모드로 복귀한다(직후 따라오는 229
        // keydown까지는 네이티브로 통과). 영구 latch의 미러 박탈만 없앤다(v0.14.3).
        window.setTimeout(() => {
          nativeComposition = false;
        }, 80);
      });
    }

    // Ctrl-R(히스토리 검색) / Tab(인라인 제안 수락) 가로채기.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      // 모바일 온스크린 키바의 Ctrl 스티키 (#114): 켜져 있으면 다음 글자 1개를 Ctrl 조합으로
      // 보내고 끈다. 소프트 키보드로 친 영문자가 ⌃C/⌃D 등으로 전송된다.
      if (mobileCtrl.get() && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const seq = ctrlSeq(e.key);
        if (seq) {
          e.preventDefault();
          mobileCtrl.clear();
          sendToSessionRef.current?.(seq);
          return false;
        }
      }
      // [진단 #100] 특수키(Backspace/Enter/Space/방향키 등) keydown 기록 — 백스페이스가
      // 어떤 key/keyCode/isComposing/imeActive로 들어오는지(스페이스로 둔갑하는지) 본다.
      if (isMacWebView && (e.key.length !== 1 || e.key === " ")) {
        const tag = `${e.key}/${e.keyCode}${e.isComposing ? "/c" : ""}${imeActive ? "/A" : ""}`;
        if (kdRing.length >= 30) kdRing.shift();
        kdRing.push(tag);
        scheduleImeDiag();
      }
      // 세션이 죽었으면(절전 후 SSH 단절·셸 종료) Enter로 제자리 재접속 (#96).
      // 재접속 시 onSshConnected가 다시 발화하므로 호스트 tmux 자동 attach도 복원된다.
      if (sessionDead && e.key === "Enter") {
        sessionDead = false;
        // spawnFresh의 첫 동작이 잔존 모드 해제(대체 화면 탈출 포함)라, 메시지는 그 뒤에
        // 써야 normal 버퍼에 보인다 — TUI(대체 화면) 사용 중 끊긴 경우(#99).
        void spawnFresh();
        term.writeln(tRef.current.reconnecting);
        return false;
      }
      // ⌘F: 터미널 스크롤백 검색 오버레이 열기.
      if (e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen(true);
        return false;
      }
      // ⌘↑ / ⌘↓: 이전/다음 명령(OSC 133 마크)으로 점프.
      if (
        e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        const lines = cmdMarkers
          .filter((m) => m && !m.isDisposed && m.line >= 0)
          .map((m) => m.line)
          .sort((a, b) => a - b);
        if (lines.length) {
          e.preventDefault();
          const top = term.buffer.active.viewportY;
          const target =
            e.key === "ArrowUp"
              ? [...lines].reverse().find((l) => l < top)
              : lines.find((l) => l > top + 1);
          if (target !== undefined) term.scrollToLine(Math.max(0, target - 1));
          return false;
        }
      }
      // ⌘C 복사: xterm 선택은 DOM 선택이 아니라 자체 모델이라 OS 기본 복사가 빈 내용을
      // 복사한다. 선택이 있으면 직접 가로채 term.getSelection()을 클립보드에 쓴다.
      // (선택이 없으면 통과 — Ctrl-C는 SIGINT라 metaKey 조건으로만 가로챈다.)
      if (e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "c" || e.key === "C")) {
        if (term.hasSelection()) {
          e.preventDefault();
          const sel = term.getSelection();
          if (sel) void navigator.clipboard.writeText(sel);
          return false;
        }
        return true;
      }
      // 단어 단위 삭제 — Option+Delete(⌥⌫) / Alt+Backspace. readline의 backward-kill-word를
      // 부르는 ESC+DEL(`\e\x7f`)을 보낸다(zsh/bash 기본 바인딩). 전 플랫폼 공통(Alt). (#112)
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.key === "Backspace") {
        e.preventDefault();
        writeToSession("\x1b\x7f");
        return false;
      }
      // 줄 전체 삭제 — Cmd+Delete(⌘⌫). 줄 시작까지 지우는 Ctrl-U(`\x15`)를 보낸다
      // (zsh kill-whole-line / bash unix-line-discard). (#112)
      if (e.metaKey && !e.ctrlKey && !e.altKey && e.key === "Backspace") {
        e.preventDefault();
        writeToSession("\x15");
        return false;
      }
      // Windows/Linux 복사/붙여넣기 단축키 (#101). macOS는 위 ⌘ 경로를 쓰므로 제외.
      // Ctrl+C: 선택이 있으면 복사, 없으면 SIGINT로 통과(Windows Terminal/VS Code 방식).
      // Ctrl+Shift+C: 항상 복사(SIGINT 충돌 없음). Ctrl+V / Ctrl+Shift+V: 붙여넣기.
      if (!isMacWebView && e.ctrlKey && !e.altKey && (e.key === "c" || e.key === "C")) {
        if (term.hasSelection()) {
          e.preventDefault();
          const sel = term.getSelection();
          if (sel) void navigator.clipboard.writeText(sel);
          return false; // 복사
        }
        // 선택 없음: Ctrl+Shift+C는 무동작(소비), Ctrl+C는 SIGINT로 통과.
        return !e.shiftKey;
      }
      if (!isMacWebView && e.ctrlKey && !e.altKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        void navigator.clipboard
          .readText()
          .then((t) => {
            if (t) term.paste(t); // bracketed-paste 모드를 존중해 PTY로 전달.
          })
          .catch(() => {});
        return false;
      }
      // IME 조합 키(keyCode 229). 미러는 구형 macOS WKWebView 전용이다. macOS가 아니거나
      // (Windows/Linux) 최신 WKWebView(nativeComposition)면 xterm 네이티브 IME가 처리하도록
      // 그대로 통과시킨다. 구형 macOS WKWebView(composition 이벤트 없음)만 미러로 처리한다.
      if (e.keyCode === 229) {
        imeDiag.n229++; // [진단 #83]
        scheduleImeDiag();
        // 조합 머신(네이티브 IME가 한글 처리)·진행 중 composition·비-macOS는 네이티브로 넘긴다.
        // 미러는 composition 이벤트가 전혀 없는 229-only macOS에서만 켠다.
        if (!isMacWebView || nativeComposition || compositionMachine) return true;
        if (!imeActive) {
          // 미러 시작 시 textarea의 기존 내용(예: ⌘V 잔류 — xterm paste 핸들러는
          // preventDefault하지 않아 전송 후 기본 동작이 같은 텍스트를 textarea에
          // 남긴다)을 기준선으로 잡는다. 빈 기준선으로 시작하면 그 잔류가 통째로
          // 다시 전송돼 "붙여넣기가 또 되는" 중복이 생긴다(#97).
          imeSent = ta?.value ?? "";
        }
        imeActive = true;
        return false;
      }
      // 한글 미러 세션이 시작된 뒤에는 그 줄 전체(공백·영어 포함)를 textarea 미러로
      // 처리한다. xterm과 textarea를 번갈아 만지면 추적이 어긋나 자모가 새기 때문.
      if (imeActive) {
        // 수정자 단독 키(Shift 등)는 조합 중 함께 눌린다(쌍자음 ㅆ=Shift+ㅅ, 대문자 등).
        // reset하면 조합과 미러 상태가 깨지므로 그대로 통과시키고 미러 세션을 유지한다.
        if (
          e.key === "Shift" ||
          e.key === "Control" ||
          e.key === "Alt" ||
          e.key === "Meta" ||
          e.key === "CapsLock"
        ) {
          return true;
        }
        const printable =
          e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
        // 일반 문자/스페이스/백스페이스는 textarea가 받아 미러가 보낸다(xterm 차단).
        if (printable || e.key === "Backspace") {
          return false;
        }
        // Enter/화살표/Ctrl/Cmd/Esc/Tab 등 → 미러 종료 후 xterm 정상 처리로 넘긴다.
        // (Enter는 xterm이 \r 한 번만 보내고 textarea 줄바꿈도 preventDefault로 막는다.)
        resetIme();
      }
      if (e.ctrlKey && (e.key === "r" || e.key === "R")) {
        setHistorySearch(true);
        return false; // PTY로 보내지 않음 — 앱이 처리
      }
      // 인라인 제안 수락 = Tab (#127). 종전엔 →/End였으나 순수 커서 이동과 겹쳐서 Tab으로 변경.
      // 제안이 떠 있으면(제안은 커서가 줄 끝일 때만 존재) Tab으로 수락하고, 제안이 없으면 평소대로
      // 셸 자동완성(파일/디렉터리/명령)으로 통과한다. →/End는 이제 순수 커서 이동(가로채지 않음).
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (
          !e.shiftKey &&
          suggestionRef.current &&
          // 대체 화면 TUI(vim/tmux/less 등)에선 제안이 없고 Tab은 앱/셸 완성으로 넘긴다.
          term.buffer.active.type !== "alternate"
        ) {
          const rest = suggestionRef.current.slice(lineBufRef.current.length);
          if (rest) {
            e.preventDefault();
            writeToSession(rest);
            lineBufRef.current = suggestionRef.current;
            suggestionRef.current = null;
            setSuggestion(null);
            return false;
          }
        }
        // 제안 없음 → 셸 완성으로 통과. Shift+Tab은 역탭 \e[Z.
        e.preventDefault();
        writeToSession(e.shiftKey ? "\x1b[Z" : "\t");
        return false;
      }
      return true;
    });

    // 대체 화면(less/man/vim 등)은 출력이 xterm 스크롤백에 안 쌓여 휠이 동작하지 않는다.
    // 대체 화면 + 앱이 마우스 리포팅을 안 켠 경우, 휠을 위/아래 화살표로 변환해 PTY로 보낸다.
    // (마우스 모드를 켠 앱(tmux mouse on 등)은 그대로 두어 마우스 이벤트가 전달되게 한다.)
    term.attachCustomWheelEventHandler((e) => {
      if (!altWheelRef.current) return true;
      if (term.buffer.active.type !== "alternate") return true;
      if (term.modes.mouseTrackingMode !== "none") return true;
      const root = containerRef.current;
      const cell = root && term.rows ? root.clientHeight / term.rows : 0;
      let lines = cell > 0 ? Math.round(Math.abs(e.deltaY) / cell) : 0;
      if (lines < 1) lines = 1;
      lines = Math.min(lines, term.rows);
      const appCursor = term.modes.applicationCursorKeysMode;
      const key = e.deltaY < 0 ? (appCursor ? "\x1bOA" : "\x1b[A") : appCursor ? "\x1bOB" : "\x1b[B";
      writeToSession(key.repeat(lines));
      return false; // 기본(빈 스크롤백) 동작 취소
    });

    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      if (!sessionId) return;
      void invoke(cmds.resizeCmd, { sessionId, cols, rows });
    });

    // 셸/tmux가 설정한 터미널 제목(OSC 0/2)을 App에 알려 탭 라벨에 반영한다 (#89).
    const onTitleDisposable = term.onTitleChange((title) => {
      emitTitleChange({ paneId: paneId ?? "", title });
    });

    // 숨김(배경) 탭은 컨테이너가 0 크기가 된다. 이때 fit()하면 cols/rows가 최소값으로
    // 줄고, 그 작은 크기가 PTY/원격으로 전달된다. 여러 탭이 같은 tmux 세션에 attach돼
    // 있으면 tmux가 가장 작은 클라이언트에 맞춰 폭을 1~2칸으로 줄여 화면이 깨진다.
    // 실제 크기가 있을 때만 fit한다.
    // 창을 아주 작게 줄이면 fit이 폭을 ~2칸까지 줄여, 그 폭에서 셸이 프롬프트를 세로로 쪼개
    // 그린 줄들이 스크롤백에 남는다(창을 키워도 잔상으로 남음). cols/rows에 최소값을 둬서
    // 터미널이 그 밑으로는 안 줄어들게 한다(컨테이너가 더 좁으면 내용이 잘릴 뿐, 깨지지 않음).
    const MIN_COLS = 20;
    const MIN_ROWS = 4;
    const safeFit = () => {
      const el = containerRef.current;
      if (!el || el.clientWidth < 8 || el.clientHeight < 8) return;
      try {
        const dims = fit.proposeDimensions();
        if (!dims || !isFinite(dims.cols) || !isFinite(dims.rows)) return;
        const cols = Math.max(MIN_COLS, dims.cols);
        const rows = Math.max(MIN_ROWS, dims.rows);
        if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
      } catch {}
    };
    // RO 콜백 안에서 fit()이 동기로 크기를 바꾸면 "ResizeObserver loop" 경고가 나고,
    // 일부 환경에선 이후 알림이 끊겨 재fit이 멈춘다(창을 키워도 안 늘어남). RAF로 미뤄 방지.
    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(roRaf);
      roRaf = requestAnimationFrame(safeFit);
    });
    ro.observe(containerRef.current);
    // ResizeObserver만으로는 일부 상황(스플래시/온보딩 직후 작은 창에서 시작, 창 확대)에서
    // 재fit이 누락돼 터미널이 작은 행/열에 멈춘다. 윈도우 resize 이벤트로도 직접 refit하고,
    // 마운트 직후 레이아웃이 정착된 뒤 몇 번 더 fit해 초기 크기를 바로잡는다.
    const onWinResize = () => safeFit();
    window.addEventListener("resize", onWinResize);
    const raf = requestAnimationFrame(safeFit);
    const fitT1 = setTimeout(safeFit, 80);
    const fitT2 = setTimeout(safeFit, 300);

    // Edit 메뉴 / 우클릭 Copy 등 keydown 없이 발생하는 복사도 가로채 xterm 선택을 넣는다.
    // (컨테이너 스코프라 다른 입력 필드 복사엔 영향 없음.)
    const copyTarget = containerRef.current;
    const onCopy = (ev: ClipboardEvent) => {
      if (!term.hasSelection()) return;
      const sel = term.getSelection();
      if (!sel) return;
      ev.clipboardData?.setData("text/plain", sel);
      ev.preventDefault();
    };
    copyTarget.addEventListener("copy", onCopy);

    // AIPanel이 이 패널의 출력을 컨텍스트로 가져가거나 명령을 주입할 수 있도록 등록.
    if (paneId) {
      registerTerminal(paneId, {
        getRecentText: (maxLines = 50) => {
          const buf = term.buffer.active;
          const lines: string[] = [];
          const start = Math.max(0, buf.length - maxLines);
          for (let i = start; i < buf.length; i++) {
            const line = buf.getLine(i);
            if (line) lines.push(line.translateToString(true));
          }
          return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        },
        sendInput: (text) => {
          if (!sessionId) return;
          void invoke(cmds.writeCmd, {
            sessionId,
            dataB64: bytesToBase64(encoder.encode(text)),
          });
        },
        fit: safeFit,
        focus: () => term.focus(),
        serialize: () => {
          try {
            return serializeAddon.serialize();
          } catch {
            return "";
          }
        },
        getCwd: () => currentCwd,
      });
    }

    // 세션이 죽었을 때(절전 후 SSH 단절, 셸 종료 등) Enter로 제자리 재접속 (#96).
    let sessionDead = false;
    let unlistenClosed: UnlistenFn | null = null;

    const spawnFresh = async () => {
      // 죽은 세션의 프로그램(tmux/TUI)이 켜둔 DEC 프라이빗 모드는 xterm 인스턴스에 그대로
      // 남는다 — 마우스 트래킹이 잔존하면 새 셸에서 클릭이 "0;90;14M" 같은 시퀀스로
      // 타이핑된다(#99). 버퍼는 지우지 않고 모드만 로컬 해제: 마우스(1000/1002/1003/
      // 1005/1006/1015), 브래킷 페이스트(2004), 앱 커서(1), 대체 화면(1049), 커서 표시.
      term.write(
        "\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l\x1b[?1005l\x1b[?1015l\x1b[?2004l\x1b[?1l\x1b[?1049l\x1b[?25h",
      );
      // 재접속 시 이전 화면 잔상 위에 새 세션이 겹쳐 찍히는 문제(#126): 버퍼를 비워 깨끗한
      // 화면에서 시작한다. tmux는 attach가 전체를 다시 그리므로 영향 없다.
      term.clear();
      try {
        sessionId = await invoke<string>(
          cmds.spawnCmd,
          cmds.spawnArgs(term.cols, term.rows),
        );
        if (source.kind === "ssh") {
          onSshConnected?.();
        }
        // spawn이 진행되는 동안 발생한 리사이즈(레이아웃 정착 refit 등)는 onResize에서
        // sessionId가 아직 없어 버려진다. 그 사이 xterm 크기가 바뀌었으면 PTY는 스폰 시점
        // 크기로 남아 셸이 옛 폭에서 줄을 꺾는다(특히 Windows ConPTY+cmd 입력 에코 — #88
        // 한글 입력 중 조기 줄바꿈). 스폰 직후 현재 크기를 한 번 동기화한다.
        // onSession보다 먼저 — App이 onSession에서 tmux attach를 보내므로(#90 복원),
        // attach가 최종 크기에서 일어나야 TUI가 옛 폭으로 그려지지 않는다.
        void invoke(cmds.resizeCmd, {
          sessionId,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => {});
        onSession?.(sessionId);
      } catch (err) {
        if (source.kind === "ssh" && isSshConnectError(err)) {
          if (err.kind === "host_key_mismatch") {
            term.writeln(tRef.current.hostKeyMismatch(err.host, err.port));
            onSshError?.(err);
            return;
          }
          if (err.kind === "first_contact") {
            term.writeln(tRef.current.firstContact(err.host, err.port));
            onSshError?.(err);
            return;
          }
          if (err.kind === "password_required") {
            term.writeln(
              tRef.current.passwordRequired(err.user, err.host, err.port),
            );
            onSshError?.(err);
            return;
          }
          term.writeln(tRef.current.sshError(err.message));
          onSshError?.(err);
          return;
        }
        term.writeln(tRef.current.failedToStart(String(err)));
      }
    };

    (async () => {
      try {
        // attach 모드: listen 필터가 동작하도록 sessionId를 먼저 설정.
        if (attachSessionId) sessionId = attachSessionId;

        // 세션 스트림 종료(절전 중 SSH 단절·셸 exit 등) 알림 (#96). 죽은 세션으로의
        // 입력을 멈추고(아래에서 sessionId를 비움) 재접속 안내를 표시한다.
        unlistenClosed = await listen<{ session_id: string }>(
          "session:closed",
          (event) => {
            if (!sessionId || event.payload.session_id !== sessionId) return;
            sessionDead = true;
            sessionId = null;
            term.writeln(tRef.current.sessionClosed);
          },
        );

        unlistenOutput = await listen<OutputPayload>(cmds.outputEvent, (event) => {
          const payload = event.payload;
          // outputEvent(pty:output/ssh:output)는 모든 세션이 공유하는 전역 이벤트다.
          // sessionId가 아직 설정 전(spawn 진행 중)이면 아무것도 쓰지 않는다 — 안 그러면
          // 그 사이 다른 세션(예: 다른 탭에서 실행 중인 셸)의 출력이 이 터미널에 새어 들어와
          // 상단에 엉뚱한 프롬프트/내용이 찍힌다. 설정 후엔 자기 세션 것만 쓴다.
          if (!sessionId || payload.session_id !== sessionId) return;
          const bytes = base64ToBytes(payload.data_b64);
          term.write(bytes);
          echoPush(bytes);
          loggerRef.current?.append(bytes);
          // 비밀번호 프롬프트 감지(#118): 출력 꼬리를 유지하며 마지막 줄이 비밀번호 프롬프트면
          // 다음 입력 라인을 비밀번호로 보고 히스토리/제안에서 제외한다.
          try {
            const txt = stripAnsi(new TextDecoder().decode(bytes));
            outTailRef.current = (outTailRef.current + txt).slice(-256);
            const lastLine = outTailRef.current.split(/[\r\n]/).pop() ?? "";
            if (PWD_PROMPT_RE.test(lastLine)) passwordModeRef.current = true;
          } catch {
            /* 디코딩 실패 무시 */
          }
        });

        if (disposed) return;

        if (attachSessionId) {
          // 기존 세션 인계 — spawn하지 않는다. 이 창도 세션을 "소유"하므로 sessionId를 보고해
          // sessionByLeaf를 채운다(이 창에서 또 분리/병합할 때 세션을 찾을 수 있게).
          onSession?.(attachSessionId);
          // 백엔드 출력 ring buffer(이전 스크롤백 포함)를 받아 재생해 이전 출력 전체를 복원한다.
          // 실패/빈 값이면 화면 스냅샷으로 폴백.
          let replayed = false;
          try {
            const b64 = await invoke<string>("session_history", {
              sessionId: attachSessionId,
            });
            if (b64) {
              term.write(base64ToBytes(b64));
              replayed = true;
            }
          } catch {}
          if (!replayed) {
            if (attachScreen) term.write(attachScreen);
            else term.writeln(tRef.current.sessionHandover);
          }
          const finishAttach = () => {
            if (disposed) return;
            const el = containerRef.current;
            if (!el || el.clientWidth < 8 || el.clientHeight < 8) return;
            safeFit();
            void invoke(cmds.resizeCmd, {
              sessionId: attachSessionId,
              cols: term.cols,
              rows: term.rows,
            });
            // 재생/스냅샷이 모두 없을 때만 Ctrl-L로 셸이 프롬프트를 다시 그리게 한다.
            if (!replayed && !attachScreen) writeToSession("\x0c");
          };
          setTimeout(finishAttach, 250);
        } else {
          // 스폰/에러 처리는 spawnFresh로 일원화 — 끊김 후 Enter 재접속(#96)도 같은
          // 경로를 다시 호출한다. (OSC 7 cwd 훅의 런타임 주입은 제거됨 — 수신만 유지.)
          await spawnFresh();
        }
      } catch (err) {
        term.writeln(tRef.current.failedToStart(String(err)));
      }
    })();

    return () => {
      disposed = true;
      if (paneId) unregisterTerminal(paneId);
      copyTarget.removeEventListener("copy", onCopy);
      onBufChange.dispose();
      window.removeEventListener("resize", onWinResize);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(roRaf);
      clearTimeout(fitT1);
      clearTimeout(fitT2);
      clearTimeout(imeDiagTimer); // [진단 #83]
      ro.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onTitleDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
      if (unlistenClosed) unlistenClosed();
      // kill은 항상 보내되, 인계된 세션은 백엔드 detach_guard가 첫 kill을 무시한다.
      if (sessionId) {
        void invoke(cmds.killCmd, { sessionId }).catch(() => {});
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sendToSessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, retryNonce]);

  // 설정 변경 시 런타임 반영 (세션 재시작 없이).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = termSettings.fontSize;
    term.options.fontFamily = termSettings.fontFamily;
    term.options.cursorBlink = termSettings.cursorBlink;
    term.options.scrollback = termSettings.scrollback;
    term.options.theme = TERMINAL_THEMES[termSettings.theme];
    // 숨김 탭(0 크기)에서 fit하면 작은 크기가 원격에 전달돼 tmux가 쪼그라든다. 보일 때만.
    const el = containerRef.current;
    if (el && el.clientWidth >= 8 && el.clientHeight >= 8) {
      try {
        fitRef.current?.fit();
      } catch {}
    }
  }, [termSettings]);

  const ctxAction = (fn: () => void) => {
    fn();
    setCtxMenu(null);
    termRef.current?.focus();
  };
  const doCopy = () =>
    ctxAction(() => {
      const sel = termRef.current?.getSelection();
      if (sel) void navigator.clipboard.writeText(sel);
    });
  const doPaste = () =>
    ctxAction(() => {
      void navigator.clipboard.readText().then((txt) => {
        if (txt) sendToSessionRef.current?.(txt);
      });
    });
  const doSelectAll = () => ctxAction(() => termRef.current?.selectAll());
  const doClear = () => ctxAction(() => termRef.current?.clear());

  return (
    <div
      // overflow:hidden — 컨테이너가 최소 cols(20)보다 좁아지면 터미널이 더 넓게 렌더되는데,
      // 이를 클리핑하지 않으면 옆 AI 패널/프롬프트와 글자가 겹친다.
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
      onContextMenu={(e) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: TERMINAL_THEMES[termSettings.theme].background,
        }}
      />
      {searchOpen && (
        <TerminalSearchOverlay
          labels={ctx}
          onFind={(q, dir) => {
            const opts = {
              decorations: {
                matchBackground: "#5a4a00",
                activeMatchBackground: "#b58900",
                matchOverviewRuler: "#b58900",
                activeMatchColorOverviewRuler: "#ffd75f",
              },
            };
            if (!q) {
              searchRef.current?.clearDecorations();
              return;
            }
            if (dir === "prev") searchRef.current?.findPrevious(q, opts);
            else searchRef.current?.findNext(q, opts);
          }}
          onClose={() => {
            searchRef.current?.clearDecorations();
            setSearchOpen(false);
            termRef.current?.focus();
          }}
        />
      )}
      {ctxMenu && (
        <TerminalContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          hasSelection={!!termRef.current?.hasSelection()}
          labels={ctx}
          onClose={() => setCtxMenu(null)}
          onCopy={doCopy}
          onPaste={doPaste}
          onSelectAll={doSelectAll}
          onClear={doClear}
        />
      )}
      {suggestion && !historySearch && (
        <div
          style={{
            position: "absolute",
            bottom: 4,
            right: 8,
            background: "rgba(10,16,32,0.85)",
            border: "1px solid #2a3a4a",
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 11,
            color: "#9cf",
            fontFamily: "monospace",
            maxWidth: "70%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          → {suggestion}
        </div>
      )}
      {historySearch && (
        <HistorySearchOverlay
          onClose={() => setHistorySearch(false)}
          onPick={(cmd) => {
            // 현재 입력 라인을 Ctrl-U로 비우고 선택 명령 입력 (Enter는 사용자가).
            sendToSessionRef.current?.("\x15" + cmd);
            lineBufRef.current = cmd;
            suggestionRef.current = null;
            setSuggestion(null);
            setHistorySearch(false);
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function TerminalSearchOverlay({
  labels,
  onFind,
  onClose,
}: {
  labels: { searchPlaceholder: string };
  onFind: (query: string, dir: "next" | "prev") => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const btnStyle: React.CSSProperties = {
    background: "#2a2a32",
    color: "#ccc",
    border: "1px solid #3a3a44",
    borderRadius: 4,
    padding: "0 8px",
    height: 26,
    cursor: "pointer",
    fontSize: 14,
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 12,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#16161c",
        border: "1px solid #3a3a44",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        padding: 4,
      }}
    >
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onFind(e.target.value, "next");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "Enter") {
            e.preventDefault();
            onFind(q, e.shiftKey ? "prev" : "next");
          }
        }}
        placeholder={labels.searchPlaceholder}
        style={{
          width: 200,
          background: "#101015",
          border: "1px solid #444",
          color: "#fff",
          borderRadius: 4,
          padding: "4px 8px",
          fontSize: 13,
          height: 26,
          boxSizing: "border-box",
        }}
      />
      <button style={btnStyle} title="Previous (⇧Enter)" onClick={() => onFind(q, "prev")}>
        ↑
      </button>
      <button style={btnStyle} title="Next (Enter)" onClick={() => onFind(q, "next")}>
        ↓
      </button>
      <button style={btnStyle} title="Close (Esc)" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

function TerminalContextMenu({
  x,
  y,
  hasSelection,
  labels,
  onClose,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
}: {
  x: number;
  y: number;
  hasSelection: boolean;
  labels: { copy: string; paste: string; selectAll: string; clear: string };
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // window 레벨로 바깥 클릭/우클릭/ESC를 잡는다(오버레이 div는 stacking context에 따라
    // AI 패널·탭바를 못 덮어 안 닫히는 문제가 있어 window 리스너로 처리).
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 메뉴를 띄운 그 우클릭이 즉시 닫지 않도록 다음 tick에 바인딩.
    // 캡처 단계(true)로 — xterm이 mousedown을 가로채도 바깥 클릭을 먼저 잡아 닫는다.
    const tid = setTimeout(() => {
      window.addEventListener("mousedown", onDown, true);
      window.addEventListener("keydown", onKey, true);
    }, 0);
    return () => {
      clearTimeout(tid);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items: { label: string; onClick: () => void; disabled?: boolean }[] = [
    { label: labels.copy, onClick: onCopy, disabled: !hasSelection },
    { label: labels.paste, onClick: onPaste },
    { label: labels.selectAll, onClick: onSelectAll },
    { label: labels.clear, onClick: onClear },
  ];

  // 화면 밖으로 넘치지 않게 대략 보정.
  const left = Math.min(x, window.innerWidth - 180);
  const top = Math.min(y, window.innerHeight - 160);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1501,
        minWidth: 160,
        background: "#23232a",
        border: "1px solid #3a3a44",
        borderRadius: 6,
        boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
        padding: 4,
        fontSize: 13,
        userSelect: "none",
      }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          onClick={() => {
            if (!it.disabled) it.onClick();
          }}
          style={{
            padding: "6px 12px",
            borderRadius: 4,
            color: it.disabled ? "#666" : "#e6e6e6",
            cursor: it.disabled ? "default" : "pointer",
          }}
          onMouseEnter={(e) => {
            if (!it.disabled)
              (e.currentTarget as HTMLDivElement).style.background = "#34343e";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = "transparent";
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  );
}

function HistorySearchOverlay({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (cmd: string) => void;
}) {
  const t = useT(STR);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const results = searchHistory(q);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setSel(0);
  }, [q]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          background: "#16161c",
          borderTop: "1px solid #4a9eff",
          padding: 8,
          maxHeight: "60%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#9cf" }}>(reverse-i-search)</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "Enter") {
                if (results[sel]) onPick(results[sel]);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              }
            }}
            placeholder={t.historyPlaceholder}
            style={{
              flex: 1,
              background: "#101015",
              border: "1px solid #444",
              color: "#fff",
              borderRadius: 4,
              padding: "5px 8px",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          />
        </div>
        <div style={{ overflowY: "auto" }}>
          {results.length === 0 && (
            <div style={{ color: "#789", fontSize: 12, padding: 8 }}>{t.noHistoryMatch}</div>
          )}
          {results.map((cmd, i) => (
            <div
              key={i}
              onClick={() => onPick(cmd)}
              style={{
                padding: "4px 8px",
                fontFamily: "monospace",
                fontSize: 12,
                color: i === sel ? "#fff" : "#cdd",
                background: i === sel ? "#094771" : "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {cmd}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
