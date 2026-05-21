import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { TerminalSource } from "../types";

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

function commandsFor(source: TerminalSource): Commands {
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
      args: { hostId: source.hostId, cols, rows },
    }),
  };
}

export function Terminal({ source }: { source: TerminalSource }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // source가 바뀌면 effect를 재실행해 새 세션을 띄운다.
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

    const cmds = commandsFor(source);
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
      } catch (err) {
        term.writeln(`\r\n[session] failed to start: ${String(err)}`);
      }
    })();

    return () => {
      disposed = true;
      ro.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
      if (sessionId) void invoke(cmds.killCmd, { sessionId }).catch(() => {});
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#1e1e1e" }}
    />
  );
}
