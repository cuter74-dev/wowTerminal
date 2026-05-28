import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { SshConnectError, TerminalSource, isSshConnectError } from "../types";
import { registerTerminal, unregisterTerminal } from "../terminalRegistry";

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
}

export function Terminal({
  source,
  onSshError,
  onSshConnected,
  retryNonce = 0,
  password,
  paneId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const sourceKey =
    source.kind === "local" ? "local" : `ssh:${source.hostId}`;

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontFamily: "Menlo, Consolas, 'Courier New', monospace",
      fontSize: 14,
      cursorBlink: true,
      theme: { background: "#1e1e1e", foreground: "#e6e6e6" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const cmds = commandsFor(source, password);
    let sessionId: string | null = null;
    let unlistenOutput: UnlistenFn | null = null;
    let disposed = false;

    const encoder = new TextEncoder();
    const onDataDisposable = term.onData((data) => {
      if (!sessionId) return;
      void invoke(cmds.writeCmd, {
        sessionId,
        dataB64: bytesToBase64(encoder.encode(data)),
      });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, retryNonce]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#1e1e1e" }}
    />
  );
}
