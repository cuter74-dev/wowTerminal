// 설정의 "오류 보고 보내기" 시험 (#178). 끄면 프런트 SDK를 띄우지 않고(오류·세션 신호 없음)
// 백엔드에도 같은 선택을 알리며, 실행 중 끄면 곧바로 SDK를 닫는다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  close: vi.fn(async () => true),
}));
vi.mock("@sentry/react", () => sentry);

const backend: boolean[] = [];

beforeEach(async () => {
  vi.resetModules();
  sentry.init.mockClear();
  sentry.close.mockClear();
  backend.length = 0;
  // resetModules 뒤에 다시 import해야 telemetry가 쓰는 목과 같은 인스턴스다.
  const { setInvokeHandler } = await import("./test/tauriMock");
  setInvokeHandler(async (cmd, args) => {
    if (cmd === "set_error_reporting") backend.push(Boolean(args?.enabled));
    return undefined;
  });
});

describe("오류 보고 끄기 (#178)", () => {
  it("꺼진 채 시작하면 SDK를 띄우지 않고 백엔드에도 끔을 알린다", async () => {
    const { startErrorReporting } = await import("./telemetry");
    startErrorReporting(false);
    await Promise.resolve();
    expect(sentry.init).not.toHaveBeenCalled();
    expect(backend).toEqual([false]);
  });

  it("켜진 채 시작하면 한 번만 띄우고, 실행 중 끄면 닫고 다시 켜면 다시 띄운다", async () => {
    const { startErrorReporting, setErrorReporting } = await import("./telemetry");
    startErrorReporting(true);
    startErrorReporting(true);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const opts = sentry.init.mock.calls[0][0];
    expect(opts.maxBreadcrumbs).toBe(0);
    expect(opts.sendDefaultPii).toBe(false);
    expect(typeof opts.beforeSend).toBe("function");

    setErrorReporting(false);
    expect(sentry.close).toHaveBeenCalledTimes(1);
    setErrorReporting(true);
    expect(sentry.init).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(backend).toEqual([true, true, false, true]);
  });

  it("예전 설정에는 없던 값이라 기본은 켜짐이다", async () => {
    localStorage.setItem("wowterminal-settings", JSON.stringify({ general: { language: "ko" } }));
    const { loadSettings } = await import("./settings");
    expect(loadSettings().general.errorReports).toBe(true);
    localStorage.clear();
  });
});
