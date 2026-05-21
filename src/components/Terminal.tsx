import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

type PtyOutputPayload = {
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

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);

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

    let sessionId: string | null = null;
    let unlistenOutput: UnlistenFn | null = null;
    let disposed = false;

    const encoder = new TextEncoder();
    const onDataDisposable = term.onData((data) => {
      if (!sessionId) return;
      void invoke("pty_write", {
        sessionId,
        dataB64: bytesToBase64(encoder.encode(data)),
      });
    });

    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      if (!sessionId) return;
      void invoke("pty_resize", { sessionId, cols, rows });
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    ro.observe(containerRef.current);

    (async () => {
      try {
        unlistenOutput = await listen<PtyOutputPayload>("pty:output", (event) => {
          const payload = event.payload;
          if (sessionId && payload.session_id !== sessionId) return;
          const bytes = base64ToBytes(payload.data_b64);
          term.write(bytes);
        });

        if (disposed) return;
        sessionId = await invoke<string>("pty_spawn", {
          args: { cols: term.cols, rows: term.rows },
        });
      } catch (err) {
        term.writeln(`\r\n[pty] failed to start: ${String(err)}`);
      }
    })();

    return () => {
      disposed = true;
      ro.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
      if (sessionId) void invoke("pty_kill", { sessionId }).catch(() => {});
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#1e1e1e" }}
    />
  );
}
