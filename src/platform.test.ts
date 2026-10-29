// macOS 판별 (#161): UA가 아니라 실제 OS. iPadOS는 데스크탑 Mac UA를 보낸다.
import { afterEach, expect, it } from "vitest";
import { isMacOS } from "./platform";
import { osState } from "./test/tauriMock";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const setUA = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });

afterEach(() => {
  osState.platform = "";
});

it("iPad (iOS with a Mac UA) is not macOS", () => {
  setUA(MAC_UA);
  osState.platform = "ios";
  expect(isMacOS()).toBe(false);
});

it("macOS is macOS", () => {
  setUA(MAC_UA);
  osState.platform = "macos";
  expect(isMacOS()).toBe(true);
});

it("outside Tauri (no platform) falls back to the UA", () => {
  setUA(MAC_UA);
  osState.platform = "";
  expect(isMacOS()).toBe(true);
  setUA("Mozilla/5.0 (X11; Linux x86_64)");
  expect(isMacOS()).toBe(false);
});
