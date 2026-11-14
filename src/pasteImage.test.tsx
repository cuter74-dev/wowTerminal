// SSH 탭 이미지 붙여넣기 시험 (#192). 실제 <Terminal>을 happy-dom에 띄워(Tauri만 목) ⌘V paste
// 이벤트에 이미지만 실어 보내고, 원격에 올리는 명령과 경로 붙여넣기를 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import type { TerminalSource } from "./types";
import { SESSION_ID, invokeLog, ptyWrites, resetTauriMock, setInvokeHandler } from "./test/tauriMock";

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let root: Root;
let container: HTMLDivElement;
let uploads: Record<string, unknown>[] = [];

async function mount(source: TerminalSource) {
  await act(async () => {
    root.render(<Terminal source={source} paneId="paste-pane" termSettings={DEFAULT_SETTINGS.terminal} />);
  });
  const spawn = source.kind === "ssh" ? "ssh_connect" : "pty_spawn";
  for (let i = 0; i < 50 && !invokeLog.includes(spawn); i++) await advance(10);
  await advance(50);
}

/** ⌘V처럼 paste 이벤트를 textarea에 보낸다. */
async function paste(opts: { text?: string; image?: Uint8Array; type?: string }) {
  const ta = container.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea")!;
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  const items = opts.image
    ? [{ kind: "file", type: opts.type ?? "image/png", getAsFile: () => new File([opts.image!], "x", { type: opts.type ?? "image/png" }) }]
    : [];
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (t: string) => (t === "text/plain" ? (opts.text ?? "") : ""), items },
  });
  ptyWrites.length = 0;
  await act(async () => {
    ta.dispatchEvent(ev);
  });
  await advance(50);
  return ev;
}

beforeEach(() => {
  resetTauriMock();
  uploads = [];
  setInvokeHandler(async (cmd, args) => {
    invokeLog.push(cmd);
    if (cmd === "ssh_connect" || cmd === "pty_spawn") return SESSION_ID;
    if (cmd === "ssh_write" || cmd === "pty_write") {
      ptyWrites.push(atob(String(args?.dataB64 ?? "")));
      return undefined;
    }
    if (cmd === "ssh_paste_upload") {
      uploads.push(args ?? {});
      return `/tmp/wowterminal-paste-1000/${String(args?.name)}`;
    }
    if (cmd === "session_history") return "";
    return undefined;
  });
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setInvokeHandler(null);
  vi.useRealTimers();
});

describe("SSH 탭 이미지 붙여넣기 (#192)", () => {
  it("이미지만 있으면 원격에 올리고 그 경로를 붙여넣는다", async () => {
    await mount({ kind: "ssh", hostId: "web-01" });
    const ev = await paste({ image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
    expect(ev.defaultPrevented).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ sessionId: SESSION_ID, hostId: "web-01", dataB64: "iVBORw==" });
    expect(String(uploads[0].name)).toMatch(/^paste-\d{8}-\d{6}-[a-z0-9]{1,4}\.png$/);
    expect(ptyWrites.join("")).toBe(`/tmp/wowterminal-paste-1000/${String(uploads[0].name)} `);
  });

  it("jpeg는 .jpg로", async () => {
    await mount({ kind: "ssh", hostId: "web-01" });
    await paste({ image: new Uint8Array([1, 2, 3]), type: "image/jpeg" });
    expect(String(uploads[0].name)).toMatch(/\.jpg$/);
  });

  it("글이 함께 있으면 글 붙여넣기를 그대로 둔다", async () => {
    await mount({ kind: "ssh", hostId: "web-01" });
    const ev = await paste({ text: "hello", image: new Uint8Array([1]) });
    expect(ev.defaultPrevented).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it("로컬 탭은 건드리지 않는다", async () => {
    await mount({ kind: "local" });
    const ev = await paste({ image: new Uint8Array([1]) });
    expect(ev.defaultPrevented).toBe(false);
    expect(uploads).toHaveLength(0);
  });
});
