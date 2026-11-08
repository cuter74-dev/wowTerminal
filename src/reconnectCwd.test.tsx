// SSH 재접속 폴더 복귀 시험 (#173). 실제 <Terminal>을 happy-dom에 띄워(Tauri만 목) 끊김 → Enter
// 재접속을 재현하고, 원격으로 간 바이트를 본다. 복귀 cd는 셸에만 가야 한다 — tmux로 다시
// 들어가면 그 줄이 tmux 창 안 프로그램(예: Claude Code 입력창)에 입력되어 전송됐다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./components/Terminal";
import { DEFAULT_SETTINGS } from "./settings";
import { SESSION_ID, emitEvent, invokeLog, ptyWrites, resetTauriMock } from "./test/tauriMock";

const CD = "cd '/workspace/newsj'\r";
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function remoteOutput(text: string) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  await act(async () => emitEvent("ssh:output", { session_id: SESSION_ID, data_b64: b64 }));
  await advance(20);
}

let root: Root;
let container: HTMLDivElement;
let ta: HTMLTextAreaElement;

/** 접속 → 원격이 OSC 7로 폴더를 알림 → 끊김 → Enter 재접속. 재접속 후 원격으로 간 바이트. */
async function reconnect(onSshConnected: () => boolean, afterSpawn?: () => Promise<void>) {
  await act(async () => {
    root.render(
      <Terminal
        source={{ kind: "ssh", hostId: "web-01" }}
        paneId="reconnect-cwd"
        termSettings={DEFAULT_SETTINGS.terminal}
        onSshConnected={onSshConnected}
      />,
    );
  });
  for (let i = 0; i < 50 && !invokeLog.includes("ssh_connect"); i++) await advance(10);
  await advance(50);
  ta = container.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea")!;
  await remoteOutput("\x1b]7;file://web-01/workspace/newsj\x07demo@web-01:/workspace/newsj$ ");
  await act(async () => emitEvent("session:closed", { session_id: SESSION_ID }));
  await advance(20);

  ptyWrites.length = 0;
  invokeLog.length = 0;
  ta.focus();
  await act(async () => {
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  });
  for (let i = 0; i < 50 && !invokeLog.includes("ssh_connect"); i++) await advance(10);
  if (afterSpawn) await afterSpawn();
  await advance(1000);
  return ptyWrites.join("");
}

beforeEach(() => {
  resetTauriMock();
  localStorage.clear();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("SSH 재접속 폴더 복귀 (#173)", () => {
  it("일반 셸로 다시 접속하면 마지막 폴더로 돌아간다", async () => {
    expect(await reconnect(() => false)).toContain(CD);
  });

  it("tmux로 다시 들어가면 cd를 보내지 않는다", async () => {
    expect(await reconnect(() => true)).not.toContain("cd ");
  });

  it("그 사이 전체 화면 프로그램이 뜨면(원격 rc가 띄운 tmux 등) 보내지 않는다", async () => {
    const sent = await reconnect(
      () => false,
      () => remoteOutput("\x1b[?1049h\x1b[H\x1b[2J"),
    );
    expect(sent).not.toContain("cd ");
  });
});
