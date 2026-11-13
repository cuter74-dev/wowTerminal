// 왼쪽 패널 에이전트 목록 시험 (#187). 기다리는 것이 맨 위에 오고, 누르면 그 탭·창으로 가고,
// 없으면 안내를 보이는지, 칸 이름 옆에 수와 기다림 점이 붙는지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentPanel, sortAgentRows, type AgentRow } from "./components/AgentPanel";
import { LeftPanel } from "./components/LeftPanel";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const now = Date.now();
const row = (p: Partial<AgentRow> & Pick<AgentRow, "paneId" | "state">): AgentRow => ({
  agent: "claude",
  since: now - 5 * 60_000,
  unseen: false,
  tabId: `tab-${p.paneId}`,
  tabLabel: `tab ${p.paneId}`,
  hostLabel: null,
  active: false,
  ...p,
});

it("기다림 → 끝남 → 일하는 중 → 쉬는 중 순서, 같은 상태는 오래된 것 먼저", () => {
  const rows = [
    row({ paneId: "idle", state: "idle" }),
    row({ paneId: "work", state: "working" }),
    row({ paneId: "done", state: "idle", unseen: true }),
    row({ paneId: "wait-new", state: "blocked", since: now - 60_000 }),
    row({ paneId: "wait-old", state: "blocked", since: now - 600_000 }),
  ];
  expect(sortAgentRows(rows).map((r) => r.paneId)).toEqual(["wait-old", "wait-new", "done", "work", "idle"]);
});

it("행을 누르면 그 탭·창으로 간다", async () => {
  const onJump = vi.fn();
  const rows = [
    row({ paneId: "p1", state: "working", agent: "codex", hostLabel: "web-01" }),
    row({ paneId: "p2", state: "blocked" }),
  ];
  await act(async () => root.render(<AgentPanel rows={rows} onJump={onJump} />));
  const items = [...container.querySelectorAll<HTMLButtonElement>("[role=listitem]")];
  expect(items.map((b) => b.dataset.agentState)).toEqual(["blocked", "working"]);
  expect(items[1].textContent).toContain("Codex");
  expect(items[1].textContent).toContain("web-01");
  expect(items[1].textContent).toContain("5m");
  await act(async () => items[1].click());
  expect(onJump).toHaveBeenCalledWith("tab-p1", "p1");
});

it("에이전트가 없으면 안내를 보인다", async () => {
  await act(async () => root.render(<AgentPanel rows={[]} onJump={() => {}} />));
  expect(container.querySelector("[data-testid=agent-panel-empty]")).not.toBeNull();
  expect(container.querySelector("[role=listitem]")).toBeNull();
});

it("칸 이름 옆에 에이전트 수, 기다리는 게 있으면 노란 점", async () => {
  const render = (count: number, waiting: number) =>
    act(async () =>
      root.render(
        <LeftPanel mode="servers" onMode={() => {}} servers={null} files={null} agents={null} agentCount={count} agentWaiting={waiting} />,
      ),
    );
  await render(3, 0);
  const tab = () => [...container.querySelectorAll("[role=tab]")][2];
  expect(tab().textContent).toBe("Agents3");
  expect(container.querySelector("[data-testid=agents-waiting-dot]")).toBeNull();
  await render(3, 1);
  expect(container.querySelector("[data-testid=agents-waiting-dot]")).not.toBeNull();
});
