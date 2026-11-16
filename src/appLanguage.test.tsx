// App 자체 문구의 언어 시험 (#193). App은 LangProvider를 자기가 그려서 예전엔 useT가 늘 영어를 골랐다
// (데스크톱 알림·첫 탭 이름). 설정 언어가 한국어면 App이 만드는 탭 이름과 "끝남" 알림이 한국어인지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sent: [] as { title?: string; body?: string }[], panes: [] as string[] }));
// 패널 id를 알아내려고 등록만 엿본다.
vi.mock("./terminalRegistry", async (orig) => {
  const m = await orig<typeof import("./terminalRegistry")>();
  return {
    ...m,
    registerTerminal: (id: string, handle: Parameters<typeof m.registerTerminal>[1]) => {
      h.panes.push(id);
      m.registerTerminal(id, handle);
    },
  };
});
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => "granted",
  sendNotification: (n: { title?: string; body?: string }) => h.sent.push(n),
}));
// 창·웹뷰 API는 어느 메서드든 "구독 해제 함수를 돌려주는 빈 비동기 함수"로 둔다.
const anyApi = (extra: Record<string, unknown> = {}) =>
  new Proxy(extra, { get: (t, k) => (k in t ? t[k as string] : async () => () => {}) });
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => anyApi({ label: "main" }) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => anyApi({ label: "main" }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getAllWebviewWindows: async () => [] }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: async () => {} }));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: async () => {}, relaunch: async () => {} }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: async () => null }));

import { DEFAULT_SETTINGS } from "./settings";
import { SESSION_ID, resetTauriMock, setInvokeHandler } from "./test/tauriMock";
import { emitAgentStatus } from "./commandBus";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  resetTauriMock();
  h.sent.length = 0;
  h.panes.length = 0;
  vi.useFakeTimers();
  // 목록 조회는 빈 목록, 세션은 고정 id. 그 밖은 undefined.
  setInvokeHandler(async (cmd) => {
    if (cmd === "pty_spawn" || cmd === "ssh_connect") return SESSION_ID;
    if (/(^|_)list(_|$)/.test(cmd)) return [];
    return undefined;
  });
  localStorage.clear();
  localStorage.setItem("wowterminal-onboarded", "1");
  localStorage.setItem(
    "wowterminal-settings",
    JSON.stringify({ ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, language: "ko" } }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setInvokeHandler(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("설정이 한국어면 App이 만드는 탭 이름과 알림이 한국어 (#193)", async () => {
  const { default: App } = await import("./App");
  await act(async () => root.render(<App />));
  await act(async () => vi.advanceTimersByTimeAsync(1200)); // 시작 화면이 지나갈 때까지
  expect(container.textContent).toContain("로컬 셸 1");

  // 보고 있지 않을 때(창이 뒤에 있음) 에이전트가 일을 마치면 한국어로 알린다.
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const paneId = h.panes[0];
  expect(paneId).toBeTruthy();
  await act(async () => emitAgentStatus({ paneId, agent: "claude", state: "working" }));
  await act(async () => emitAgentStatus({ paneId, agent: "claude", state: "idle" }));
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(h.sent.map((n) => n.body)).toEqual(["AI 작업이 끝났습니다 — 확인해 주세요"]);
});
