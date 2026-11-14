// 설정의 "업데이트 확인" 버튼 시험 (#188). 전에는 확인 없이 늘 "최신 버전" 경고창을 띄웠다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: h.check }));

import { SettingsModal } from "./components/SettingsModal";
import { DEFAULT_SETTINGS } from "./settings";
import { resetUpdatesForTest } from "./updates";
import { resetTauriMock } from "./test/tauriMock";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  resetTauriMock();
  resetUpdatesForTest();
  h.check.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<SettingsModal settings={DEFAULT_SETTINGS} onChange={() => {}} onClose={() => {}} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function clickCheck() {
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Check for updates")!;
  const alertSpy = vi.fn();
  vi.stubGlobal("alert", alertSpy);
  await act(async () => btn.click());
  await act(async () => {});
  expect(alertSpy).not.toHaveBeenCalled(); // 경고창 대신 버튼 옆 글
  vi.unstubAllGlobals();
  return container.querySelector("[data-testid=update-check-result]")?.textContent ?? "";
}

it("새 버전이 있으면 그렇게 알린다", async () => {
  h.check.mockResolvedValue({ version: "0.22.1", downloadAndInstall: vi.fn() });
  expect(await clickCheck()).toContain("0.22.1");
});

it("최신이면 최신이라고, 확인을 못 하면 못 했다고", async () => {
  h.check.mockResolvedValue(null);
  expect(await clickCheck()).toBe("You're on the latest version.");
  h.check.mockRejectedValue(new Error("offline"));
  expect(await clickCheck()).toMatch(/Couldn't check/);
});
