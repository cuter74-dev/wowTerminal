// 클립보드 함수 (#186): 웹뷰가 거부해도 처리 안 된 거부를 남기지 않고, 쓰기는 네이티브로 대신한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeWrite = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>());
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: nativeWrite }));

import { copyText, readClipboard } from "./clipboard";

const denied = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));

function stubClipboard(c: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, "clipboard", { value: c, configurable: true });
}

beforeEach(() => {
  nativeWrite.mockReset().mockResolvedValue(undefined);
});
afterEach(() => stubClipboard(undefined));

describe("copyText (#186)", () => {
  it("웹 클립보드가 되면 그것만 쓴다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    await expect(copyText("abc")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(nativeWrite).not.toHaveBeenCalled();
  });

  it("웹뷰가 거부하면(OSC 52 등) 네이티브 클립보드로 쓴다", async () => {
    stubClipboard({ writeText: vi.fn(denied) });
    await expect(copyText("from tmux")).resolves.toBe(true);
    expect(nativeWrite).toHaveBeenCalledWith("from tmux");
  });

  it("navigator.clipboard가 없어도 네이티브로 쓴다", async () => {
    stubClipboard(undefined);
    await expect(copyText("x")).resolves.toBe(true);
    expect(nativeWrite).toHaveBeenCalledWith("x");
  });

  it("둘 다 안 되면 false — 던지지 않는다", async () => {
    stubClipboard({ writeText: vi.fn(denied) });
    nativeWrite.mockRejectedValue("not allowed");
    await expect(copyText("x")).resolves.toBe(false);
  });
});

describe("readClipboard (#186)", () => {
  it("읽은 글자를 준다", async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue("pasted") });
    await expect(readClipboard()).resolves.toBe("pasted");
  });

  it("거부되거나 없으면 빈 문자열", async () => {
    stubClipboard({ readText: vi.fn(denied) });
    await expect(readClipboard()).resolves.toBe("");
    stubClipboard(undefined);
    await expect(readClipboard()).resolves.toBe("");
  });
});
