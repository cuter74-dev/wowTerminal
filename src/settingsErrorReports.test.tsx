// 설정 화면의 "오류 보고 보내기" 스위치 시험 (#178). 실제 SettingsModal을 띄워 끄면 설정이
// 바뀌고 백엔드에도 곧바로 끔이 전달되는지 본다.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsModal } from "./components/SettingsModal";
import { DEFAULT_SETTINGS, type AppSettings } from "./settings";
import { setInvokeHandler } from "./test/tauriMock";

vi.mock("@sentry/react", () => ({ init: vi.fn(), close: vi.fn(async () => true) }));

it("스위치를 끄면 설정이 바뀌고 백엔드에 끔이 간다", async () => {
  const backend: boolean[] = [];
  setInvokeHandler(async (cmd, args) => {
    if (cmd === "set_error_reporting") backend.push(Boolean(args?.enabled));
    return undefined;
  });
  const changes: AppSettings[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SettingsModal
        settings={DEFAULT_SETTINGS}
        onChange={(s) => changes.push(s)}
        onClose={() => {}}
      />,
    );
  });
  // Row = <div><span>{label}</span>{control}</div>
  const label = Array.from(container.querySelectorAll("span")).find(
    (el) => el.textContent?.trim() === "Send error reports",
  );
  expect(label, "설정 화면에 스위치가 있다").toBeTruthy();
  const box = label!.parentElement!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(box.checked).toBe(true);
  expect(container.textContent).toContain("It never sends what you type");
  await act(async () => box.click());
  await act(async () => {});
  expect(changes[changes.length - 1]?.general.errorReports).toBe(false);
  expect(backend).toContain(false);
  await act(async () => root.unmount());
  container.remove();
  setInvokeHandler(null);
});
