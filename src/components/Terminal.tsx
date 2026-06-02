import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { SshConnectError, TerminalSource, isSshConnectError } from "../types";
import { registerTerminal, unregisterTerminal } from "../terminalRegistry";
import { TerminalSettings, TERMINAL_THEMES } from "../settings";
import { addHistory, searchHistory, suggest } from "../commandHistory";
import { LangDict, useT } from "../i18n";

const STR: LangDict<{
    sessionHandover: string;
    hostKeyMismatch: (host: string, port: number) => string;
    firstContact: (host: string, port: number) => string;
    passwordRequired: (user: string, host: string, port: number) => string;
    sshError: (msg: string) => string;
    failedToStart: (err: string) => string;
    historyPlaceholder: string;
    noHistoryMatch: string;
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
  },
};

// 우클릭 컨텍스트 메뉴 라벨 (복사/붙여넣기/전체선택/지우기).
const CTX_STR: LangDict<{
  copy: string;
  paste: string;
  selectAll: string;
  clear: string;
}> = {
  en: { copy: "Copy", paste: "Paste", selectAll: "Select all", clear: "Clear" },
  ko: { copy: "복사", paste: "붙여넣기", selectAll: "전체 선택", clear: "지우기" },
  es: { copy: "Copiar", paste: "Pegar", selectAll: "Seleccionar todo", clear: "Limpiar" },
  zh: { copy: "复制", paste: "粘贴", selectAll: "全选", clear: "清屏" },
  ja: { copy: "コピー", paste: "貼り付け", selectAll: "すべて選択", clear: "クリア" },
  ru: { copy: "Копировать", paste: "Вставить", selectAll: "Выделить всё", clear: "Очистить" },
  fr: { copy: "Copier", paste: "Coller", selectAll: "Tout sélectionner", clear: "Effacer" },
  de: { copy: "Kopieren", paste: "Einfügen", selectAll: "Alles auswählen", clear: "Leeren" },
  vi: { copy: "Sao chép", paste: "Dán", selectAll: "Chọn tất cả", clear: "Xóa" },
  id: { copy: "Salin", paste: "Tempel", selectAll: "Pilih semua", clear: "Bersihkan" },
  hi: { copy: "कॉपी", paste: "पेस्ट", selectAll: "सभी चुनें", clear: "साफ़ करें" },
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

function commandsFor(source: TerminalSource, password?: string): Commands {
  if (source.kind === "local") {
    return {
      spawnCmd: "pty_spawn",
      writeCmd: "pty_write",
      resizeCmd: "pty_resize",
      killCmd: "pty_kill",
      outputEvent: "pty:output",
      spawnArgs: (cols, rows) => ({ args: { cols, rows } }),
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
  // 첫 마운트 시점의 설정으로 생성하고, 이후 변경은 아래 별도 effect가 런타임 반영.
  const initialSettings = useRef(termSettings);
  // 대체 화면 휠→화살표 변환 토글 (휠 핸들러가 최신 값을 읽도록 ref로).
  const altWheelRef = useRef(termSettings.altScreenWheelScroll);
  altWheelRef.current = termSettings.altScreenWheelScroll;

  // 명령 히스토리 / 인라인 자동완성 (S-051/053)
  const lineBufRef = useRef("");
  const suggestionRef = useRef<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState(false);
  // 우클릭 컨텍스트 메뉴 (복사/붙여넣기/전체선택/지우기).
  const ctx = useT(CTX_STR);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // 세션에 입력을 보내는 함수 (Ctrl-R 선택 / 제안 수락에서 사용). effect에서 채움.
  const sendToSessionRef = useRef<((text: string) => void) | null>(null);

  const sourceKey =
    source.kind === "local" ? "local" : `ssh:${source.hostId}`;

  useEffect(() => {
    if (!containerRef.current) return;

    const s = initialSettings.current;
    const term = new XTerm({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      cursorBlink: s.cursorBlink,
      scrollback: s.scrollback,
      theme: TERMINAL_THEMES[s.theme],
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);
    term.open(containerRef.current);
    // 컨테이너에 실제 크기가 있을 때만 fit(0 크기면 cols/rows가 최소로 줄어 spawn 크기가 깨짐).
    if (
      containerRef.current.clientWidth >= 8 &&
      containerRef.current.clientHeight >= 8
    ) {
      fit.fit();
    }

    const cmds = commandsFor(source, password);
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
      return false; // 다른 핸들러도 볼 수 있게(특별히 막을 필요 없음)
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

    // 대체화면 TUI(vim/tmux/Claude Code 등)가 마우스 추적 모드를 켠 뒤 끄지 않고 종료하면,
    // 일반 셸 프롬프트에서 클릭/드래그 시 좌표가 텍스트로 찍힌다(`\e[<0;30;5M` 등이 셸로 감).
    // 일반 화면으로 복귀할 때 추적/포커스 리포팅 모드를 끈다(일반 셸은 안 쓰므로 안전).
    const onBufChange = term.buffer.onBufferChange((b) => {
      if (b.type === "normal") {
        term.write(
          "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1015l",
        );
      }
    });
    let disposed = false;

    const encoder = new TextEncoder();
    // 쓰기를 순서대로 직렬화한다. IME 미러는 "ㄱ" 다음 "\x7f가"처럼 연속 전송하는데,
    // await 없이 invoke를 발사하면 PTY 도착 순서가 뒤바뀌어(백스페이스가 먼저 가는 등)
    // 자모가 남는다. 프로미스 체인으로 직전 쓰기 완료 후 다음을 보낸다.
    let writeChain: Promise<unknown> = Promise.resolve();
    const writeToSession = (text: string) => {
      if (!sessionId) return;
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

    const onDataDisposable = term.onData((data) => {
      if (!sessionId) return;
      // IME 미러 세션 중에는 xterm이 비동기로 보내는 (깨진) 데이터를 무시한다.
      // 한글 입력은 아래 textarea input 미러만 PTY로 보낸다.
      if (imeActive) return;
      // 단독 호환 자모(U+3130–U+318F: ㄱ, ㅏ 등)는 정상 입력으로 나올 수 없다.
      // imeActive 설정 직전 타이밍 틈에 xterm이 흘리는 조합 누수이므로 버린다.
      // (완성 음절 가-힣은 위 input 미러가 보내므로 여기로 오지 않는다.)
      if (data.length === 1) {
        const cp = data.charCodeAt(0);
        if (cp >= 0x3130 && cp <= 0x318f) return;
      }
      writeToSession(data);

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
    if (ta) {
      // 캡처 단계로 등록해 xterm의 input 핸들러보다 먼저 실행 → IME 중에는
      // stopImmediatePropagation으로 xterm이 같은 input을 또 보내는 이중 전송을 막는다.
      ta.addEventListener(
        "input",
        (ev) => {
          if (!imeActive) return; // 영어/제어키는 xterm 기존 경로가 담당.
          ev.stopImmediatePropagation();
          const full = ta.value;
          let c = 0;
          while (c < full.length && c < imeSent.length && full[c] === imeSent[c]) {
            c++;
          }
          let out = "";
          for (let i = 0; i < imeSent.length - c; i++) out += "\x7f";
          out += full.slice(c);
          if (out) writeToSession(out);
          imeSent = full;
        },
        true,
      );
    }

    // Ctrl-R(히스토리 검색) / Tab(인라인 제안 수락) 가로채기.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
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
      // IME 조합 키: xterm의 깨진 조합 처리를 막고 위 input 미러가 담당.
      if (e.keyCode === 229) {
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
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Tab은 항상 브라우저 기본 포커스 이동을 막는다(포커스가 AI 패널 등으로 넘어가는 것 방지).
        e.preventDefault();
        if (!e.shiftKey && suggestionRef.current) {
          // 인라인 제안 수락(셸 Tab 완성 대신).
          const rest = suggestionRef.current.slice(lineBufRef.current.length);
          if (rest) {
            writeToSession(rest);
            lineBufRef.current = suggestionRef.current;
            suggestionRef.current = null;
            setSuggestion(null);
          }
          return false;
        }
        // 제안 없음 → 셸로 Tab 전달(Shift+Tab은 역탭 \e[Z).
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

    // 숨김(배경) 탭은 컨테이너가 0 크기가 된다. 이때 fit()하면 cols/rows가 최소값으로
    // 줄고, 그 작은 크기가 PTY/원격으로 전달된다. 여러 탭이 같은 tmux 세션에 attach돼
    // 있으면 tmux가 가장 작은 클라이언트에 맞춰 폭을 1~2칸으로 줄여 화면이 깨진다.
    // 실제 크기가 있을 때만 fit한다.
    const safeFit = () => {
      const el = containerRef.current;
      if (!el || el.clientWidth < 8 || el.clientHeight < 8) return;
      try {
        fit.fit();
      } catch {}
    };
    const ro = new ResizeObserver(safeFit);
    ro.observe(containerRef.current);

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

    (async () => {
      try {
        // attach 모드: listen 필터가 동작하도록 sessionId를 먼저 설정.
        if (attachSessionId) sessionId = attachSessionId;

        unlistenOutput = await listen<OutputPayload>(cmds.outputEvent, (event) => {
          const payload = event.payload;
          // outputEvent(pty:output/ssh:output)는 모든 세션이 공유하는 전역 이벤트다.
          // sessionId가 아직 설정 전(spawn 진행 중)이면 아무것도 쓰지 않는다 — 안 그러면
          // 그 사이 다른 세션(예: 다른 탭에서 실행 중인 셸)의 출력이 이 터미널에 새어 들어와
          // 상단에 엉뚱한 프롬프트/내용이 찍힌다. 설정 후엔 자기 세션 것만 쓴다.
          if (!sessionId || payload.session_id !== sessionId) return;
          term.write(base64ToBytes(payload.data_b64));
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
          sessionId = await invoke<string>(
            cmds.spawnCmd,
            cmds.spawnArgs(term.cols, term.rows),
          );
          if (source.kind === "ssh") {
            onSshConnected?.();
          }
          onSession?.(sessionId);
          // OSC 7 cwd 훅의 런타임 주입은 제거했다. 주입 명령 에코를 지우는 커서 정리가
          // 프롬프트 폭/줄바꿈/tmux 대체화면 등에 취약해 상단 프롬프트 잔상을 반복적으로
          // 만들었다(여러 차례 수정 시도에도). 대신 OSC 7 *수신* 핸들러는 유지하므로,
          // 사용자가 원격 ~/.bashrc에 직접 훅을 넣으면(문서 참고) 깔끔하게 cwd 추적이 된다.
        }
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
    })();

    return () => {
      disposed = true;
      if (paneId) unregisterTerminal(paneId);
      copyTarget.removeEventListener("copy", onCopy);
      onBufChange.dispose();
      ro.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
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
      style={{ position: "relative", width: "100%", height: "100%" }}
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
          background: TERMINAL_THEMES[termSettings.theme].background,
        }}
      />
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
          Tab → {suggestion}
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
