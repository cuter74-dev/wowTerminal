// 모바일 폴더 선택 시험 (#179). 폴더 선택은 데스크톱 전용이라(모바일 플러그인은 "Folder
// picker is not implemented on mobile"로 실패) 모바일 설정 화면에는 "선택" 버튼이 없어야 한다.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@sentry/react", () => ({ init: vi.fn(), close: vi.fn(async () => true) }));
// resetModules는 목 모듈을 다시 만들지 않으므로 플랫폼 값은 여기서 직접 바꾼다.
const plat = vi.hoisted(() => ({ value: "" }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => plat.value }));

async function chooseButtons(platform: string): Promise<number> {
  plat.value = platform;
  vi.resetModules();
  const { SettingsModal } = await import("./components/SettingsModal");
  const { DEFAULT_SETTINGS } = await import("./settings");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SettingsModal settings={DEFAULT_SETTINGS} onChange={() => {}} onClose={() => {}} />);
  });
  const n = Array.from(container.querySelectorAll("button")).filter(
    (b) => b.textContent?.trim() === "Choose…" || b.textContent?.trim() === "Browse…",
  ).length;
  await act(async () => root.unmount());
  container.remove();
  return n;
}

it("데스크톱에는 폴더 선택 버튼이 있고 모바일에는 없다", async () => {
  expect(await chooseButtons("macos")).toBeGreaterThan(0);
  expect(await chooseButtons("android")).toBe(0);
  expect(await chooseButtons("ios")).toBe(0);
});
