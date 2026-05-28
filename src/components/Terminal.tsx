import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { SshConnectError, TerminalSource, isSshConnectError } from "../types";
import { registerTerminal, unregisterTerminal } from "../terminalRegistry";
import { TerminalSettings, TERMINAL_THEMES } from "../settings";
import { addHistory, searchHistory, suggest } from "../commandHistory";

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
}

export function Terminal({
  source,
  onSshError,
  onSshConnected,
  retryNonce = 0,
  password,
  paneId,
  termSettings,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // 첫 마운트 시점의 설정으로 생성하고, 이후 변경은 아래 별도 effect가 런타임 반영.
  const initialSettings = useRef(termSettings);

  // 명령 히스토리 / 인라인 자동완성 (S-051/053)
  const lineBufRef = useRef("");
  const suggestionRef = useRef<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState(false);
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
    term.open(containerRef.current);
    fit.fit();

    const cmds = commandsFor(source, password);
    let sessionId: string | null = null;
    let unlistenOutput: UnlistenFn | null = null;
    let disposed = false;

    const encoder = new TextEncoder();
    const writeToSession = (text: string) => {
      if (!sessionId) return;
      void invoke(cmds.writeCmd, {
        sessionId,
        dataB64: bytesToBase64(encoder.encode(text)),
      });
    };
    sendToSessionRef.current = writeToSession;

    const onDataDisposable = term.onData((data) => {
      if (!sessionId) return;
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

    // Ctrl-R(히스토리 검색) / Tab(인라인 제안 수락) 가로채기.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && (e.key === "r" || e.key === "R")) {
        setHistorySearch(true);
        return false; // PTY로 보내지 않음 — 앱이 처리
      }
      if (e.key === "Tab" && suggestionRef.current) {
        const rest = suggestionRef.current.slice(lineBufRef.current.length);
        if (rest) {
          writeToSession(rest);
          lineBufRef.current = suggestionRef.current;
          suggestionRef.current = null;
          setSuggestion(null);
        }
        return false; // 셸 Tab 완성 대신 우리 제안 수락
      }
      return true;
    });

    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      if (!sessionId) return;
      void invoke(cmds.resizeCmd, { sessionId, cols, rows });
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    ro.observe(containerRef.current);

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
      });
    }

    (async () => {
      try {
        unlistenOutput = await listen<OutputPayload>(cmds.outputEvent, (event) => {
          const payload = event.payload;
          if (sessionId && payload.session_id !== sessionId) return;
          term.write(base64ToBytes(payload.data_b64));
        });

        if (disposed) return;
        sessionId = await invoke<string>(
          cmds.spawnCmd,
          cmds.spawnArgs(term.cols, term.rows),
        );
        if (source.kind === "ssh") {
          onSshConnected?.();
        }
      } catch (err) {
        if (source.kind === "ssh" && isSshConnectError(err)) {
          if (err.kind === "host_key_mismatch") {
            term.writeln(
              `\r\n\x1b[31m[ssh] host key mismatch for ${err.host}:${err.port} — see warning dialog\x1b[0m`,
            );
            onSshError?.(err);
            return;
          }
          if (err.kind === "first_contact") {
            term.writeln(
              `\r\n\x1b[33m[ssh] first contact with ${err.host}:${err.port} — verify fingerprint in dialog\x1b[0m`,
            );
            onSshError?.(err);
            return;
          }
          if (err.kind === "password_required") {
            term.writeln(
              `\r\n\x1b[33m[ssh] password required for ${err.user}@${err.host}:${err.port} — enter password in dialog\x1b[0m`,
            );
            onSshError?.(err);
            return;
          }
          term.writeln(`\r\n[ssh] ${err.message}`);
          onSshError?.(err);
          return;
        }
        term.writeln(`\r\n[session] failed to start: ${String(err)}`);
      }
    })();

    return () => {
      disposed = true;
      if (paneId) unregisterTerminal(paneId);
      ro.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
      if (sessionId) void invoke(cmds.killCmd, { sessionId }).catch(() => {});
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
    try {
      fitRef.current?.fit();
    } catch {}
  }, [termSettings]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          background: TERMINAL_THEMES[termSettings.theme].background,
        }}
      />
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

function HistorySearchOverlay({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (cmd: string) => void;
}) {
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
            placeholder="명령 히스토리 검색 (Enter 선택, ESC 취소)"
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
            <div style={{ color: "#789", fontSize: 12, padding: 8 }}>일치하는 히스토리 없음</div>
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
