// 하단 AI 사용량 표시줄 시험 (#181). 백엔드 응답(실측 모양)을 그대로 그리는지, 로그인된 곳이
// 없거나 꺼져 있으면 줄을 그리지 않는지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { UsageBar, usageColor, windowLabel, type ProviderUsage } from "./components/UsageBar";
import { invokeLog, resetTauriMock, setInvokeHandler } from "./test/tauriMock";

let root: Root;
let container: HTMLDivElement;
let reply: ProviderUsage[] = [];

beforeEach(() => {
  resetTauriMock();
  setInvokeHandler(async (cmd) => {
    invokeLog.push(cmd);
    return cmd === "ai_usage" ? reply : undefined;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setInvokeHandler(null);
});

async function render(enabled: boolean) {
  await act(async () => root.render(<UsageBar enabled={enabled} />));
  await act(async () => {});
}

it("로그인된 회사의 사용률을 보여 준다", async () => {
  reply = [
    { provider: "claude", status: "ok", plan: "max", error: null, windows: [
      { name: null, usedPercent: 29, windowMinutes: 10080, resetsAtMs: 1794459600000 },
    ] },
    { provider: "codex", status: "ok", plan: "plus", error: null, windows: [
      { name: null, usedPercent: 0, windowMinutes: 300, resetsAtMs: 1794397141000 },
      { name: null, usedPercent: 91, windowMinutes: 10080, resetsAtMs: 1794467004000 },
    ] },
    { provider: "gemini", status: "expired", plan: null, windows: [], error: "login expired" },
  ];
  await render(true);
  const bar = container.querySelector('[data-testid="usage-bar"]');
  expect(bar?.textContent).toContain("Claude7d29%");
  expect(bar?.textContent).toContain("Codex5h0%7d91%");
  expect(bar?.textContent).toContain("Gemini —");
  const hot = Array.from(bar!.querySelectorAll("b")).find((b) => b.textContent === "91%") as HTMLElement;
  expect(hot.style.color).toMatch(/#f85149|rgb\(248, 81, 73\)/);
  // 막대 게이지(#184): 한도마다 하나, 사용률만큼 차고 단계 색을 쓴다.
  const meters = Array.from(bar!.querySelectorAll<HTMLElement>('[role="meter"]'));
  expect(meters.map((m) => m.getAttribute("aria-valuenow"))).toEqual(["29", "0", "91"]);
  const fill = (m: HTMLElement) => m.querySelector<HTMLElement>("[data-fill]")!.style;
  expect(fill(meters[0]).width).toBe("29%");
  expect(fill(meters[1]).width).toBe("0%");
  expect(fill(meters[2]).background).toMatch(/#f85149|rgb\(248, 81, 73\)/);
});

it("로그인된 곳이 없으면 줄을 그리지 않고, 꺼져 있으면 묻지도 않는다", async () => {
  reply = [];
  await render(true);
  expect(container.querySelector('[data-testid="usage-bar"]')).toBeNull();
  invokeLog.length = 0;
  await render(false);
  expect(invokeLog).not.toContain("ai_usage");
});

it("창 이름과 색", () => {
  const t = { fiveHour: "5h", week: "7d" };
  expect(windowLabel({ name: null, usedPercent: 1, windowMinutes: 300, resetsAtMs: null }, t)).toBe("5h");
  expect(windowLabel({ name: "2.5 Pro", usedPercent: 1, windowMinutes: null, resetsAtMs: null }, t)).toBe("2.5 Pro");
  expect(usageColor(10)).toBe("#3fb950");
  expect(usageColor(70)).toBe("#e3b341");
  expect(usageColor(90)).toBe("#f85149");
});
