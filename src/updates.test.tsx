// 켜 둔 채 업데이트 확인 시험 (#188). 확인 시점(켤 때·4시간마다·절전 복귀 뒤·창이 앞에 올 때),
// 버전별 안내 줄 표시·숨김, 설치 경로(저장 안 한 파일 확인 → 받기 → 앱 종료 표시 → 재시작)를 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(async () => {}),
  guardUnsaved: vi.fn(async () => true),
  markAppTeardown: vi.fn(),
  calls: [] as string[],
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: h.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: h.relaunch }));
vi.mock("./fileDocs", () => ({ guardUnsaved: h.guardUnsaved }));
vi.mock("./terminalRegistry", () => ({ markAppTeardown: h.markAppTeardown }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => false,
  sendNotification: () => {},
}));

import {
  CHECK_EVERY_MS,
  checkForUpdate,
  dismissUpdate,
  getUpdateState,
  installUpdate,
  resetUpdatesForTest,
  startUpdateChecks,
} from "./updates";
import { UpdateBanner } from "./components/UpdateBanner";

const fakeUpdate = (version: string) => ({
  version,
  downloadAndInstall: vi.fn(async () => {
    h.calls.push("download");
  }),
});

const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T09:00:00Z"));
  resetUpdatesForTest();
  h.check.mockReset().mockResolvedValue(null);
  h.calls.length = 0;
  h.guardUnsaved.mockReset().mockImplementation(async () => {
    h.calls.push("guard");
    return true;
  });
  h.markAppTeardown.mockReset().mockImplementation(() => {
    h.calls.push("teardown");
  });
  h.relaunch.mockReset().mockImplementation(async () => {
    h.calls.push("relaunch");
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("확인 시점", () => {
  it("켤 때 한 번, 그 뒤로는 4시간마다", async () => {
    const stop = startUpdateChecks();
    await flush();
    expect(h.check).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 6 * 60_000));
    expect(h.check).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(h.check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("절전에서 깨어나면(벽시계가 4시간 넘게 뛰면) 다음 틱에 바로 확인", async () => {
    const stop = startUpdateChecks();
    await flush();
    // 절전 동안 타이머는 멈추고 시계만 간다.
    vi.setSystemTime(Date.now() + 5 * 60 * 60_000);
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(h.check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("창이 다시 앞에 오면 밀린 확인만 한다", async () => {
    const stop = startUpdateChecks();
    await flush();
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(h.check).toHaveBeenCalledTimes(1); // 방금 확인했으니 건너뜀
    vi.setSystemTime(Date.now() + CHECK_EVERY_MS + 1);
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(h.check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("멈추면 더 확인하지 않는다", async () => {
    const stop = startUpdateChecks();
    await flush();
    stop();
    await act(async () => vi.advanceTimersByTimeAsync(2 * CHECK_EVERY_MS));
    expect(h.check).toHaveBeenCalledTimes(1);
  });

  it("확인이 실패해도(오프라인) 조용히 넘어간다", async () => {
    h.check.mockRejectedValue(new Error("offline"));
    await checkForUpdate();
    expect(getUpdateState().update).toBeNull();
    expect(getUpdateState().error).toBeNull();
  });
});

describe("설치", () => {
  it("저장 안 한 파일 확인 → 받기 → 앱 종료 표시 → 재시작 순서", async () => {
    h.check.mockResolvedValue(fakeUpdate("0.22.1"));
    await checkForUpdate();
    await installUpdate();
    expect(h.calls).toEqual(["guard", "download", "teardown", "relaunch"]);
  });

  it("저장 안 한 파일에서 취소하면 받지도 재시작하지도 않는다", async () => {
    h.check.mockResolvedValue(fakeUpdate("0.22.1"));
    await checkForUpdate();
    h.guardUnsaved.mockResolvedValue(false);
    await installUpdate();
    expect(h.calls).toEqual([]);
    expect(getUpdateState().installing).toBe(false);
  });

  it("받기에 실패하면 오류를 보이고 재시작하지 않는다", async () => {
    const u = fakeUpdate("0.22.1");
    u.downloadAndInstall.mockRejectedValue(new Error("network down"));
    h.check.mockResolvedValue(u);
    await checkForUpdate();
    await installUpdate();
    expect(h.relaunch).not.toHaveBeenCalled();
    expect(getUpdateState()).toMatchObject({ installing: false, error: "Error: network down" });
  });
});

describe("안내 줄", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<UpdateBanner />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const banner = () => container.querySelector("[data-testid=update-banner]");

  it("새 버전이 없으면 보이지 않는다", () => {
    expect(banner()).toBeNull();
  });

  it("찾으면 보이고, 나중에를 누르면 그 버전만 숨긴다", async () => {
    h.check.mockResolvedValue(fakeUpdate("0.22.1"));
    await act(async () => checkForUpdate());
    expect(banner()?.textContent).toContain("0.22.1");
    expect(banner()?.textContent).toContain("Restart to update");

    const later = [...container.querySelectorAll("button")].find((b) => b.textContent === "Later")!;
    await act(async () => later.click());
    expect(banner()).toBeNull();

    // 같은 버전을 다시 찾아도 숨긴 채로, 더 새 버전이 나오면 다시 뜬다.
    await act(async () => checkForUpdate());
    expect(banner()).toBeNull();
    h.check.mockResolvedValue(fakeUpdate("0.22.2"));
    await act(async () => checkForUpdate());
    expect(banner()?.textContent).toContain("0.22.2");
  });

  it("재시작 버튼은 설치 경로를 탄다", async () => {
    h.check.mockResolvedValue(fakeUpdate("0.22.1"));
    await act(async () => checkForUpdate());
    const restart = [...container.querySelectorAll("button")].find((b) => b.textContent === "Restart to update")!;
    await act(async () => restart.click());
    expect(h.calls).toEqual(["guard", "download", "teardown", "relaunch"]);
  });

  it("나중에는 실패 표시도 지운다", async () => {
    const u = fakeUpdate("0.22.1");
    u.downloadAndInstall.mockRejectedValue(new Error("network down"));
    h.check.mockResolvedValue(u);
    await act(async () => checkForUpdate());
    await act(async () => installUpdate());
    expect(banner()?.textContent).toContain("network down");
    await act(async () => dismissUpdate());
    expect(banner()).toBeNull();
  });
});
