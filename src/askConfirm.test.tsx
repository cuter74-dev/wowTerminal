// 삭제 확인 시험 (#195). dialog 플러그인이 window.confirm을 비동기 함수(없는 명령 호출)로 바꿔 넣어
// `if (!confirm(…))`이 묻지 않고 지나가던 문제 — 실제 화면(그룹 삭제)에서 "아니오"면 지우지 않고
// "예"면 지우는지, 그리고 코드에 맨 confirm(이 다시 들어오지 않았는지 본다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ answer: vi.fn(async () => false) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: h.answer,
  message: async () => {},
  open: async () => null,
  save: async () => null,
}));

import { askConfirm } from "./askConfirm";
import { GroupTagManager } from "./components/GroupTagManager";
import { invokeLog, resetTauriMock, setInvokeHandler } from "./test/tauriMock";

describe("askConfirm", () => {
  it("확인을 누를 때만 true, 창을 못 띄우면 false", async () => {
    h.answer.mockResolvedValueOnce(true);
    await expect(askConfirm("지울까요?")).resolves.toBe(true);
    h.answer.mockResolvedValueOnce(false);
    await expect(askConfirm("지울까요?")).resolves.toBe(false);
    h.answer.mockRejectedValueOnce("Command plugin:dialog|message not allowed by ACL");
    await expect(askConfirm("지울까요?")).resolves.toBe(false);
    expect(h.answer).toHaveBeenLastCalledWith("지울까요?", { kind: "warning" });
  });
});

describe("그룹 삭제", () => {
  let root: Root;
  let container: HTMLDivElement;
  const realConfirm = window.confirm;
  beforeEach(async () => {
    resetTauriMock();
    // 실제 앱처럼 dialog 플러그인 init 스크립트가 바꿔 넣은 window.confirm(늘 거부되는 비동기 함수).
    window.confirm = (async () => {
      throw "Command plugin:dialog|confirm not allowed by ACL";
    }) as unknown as typeof window.confirm;
    setInvokeHandler(async (cmd) => {
      invokeLog.push(cmd);
      if (cmd === "ssh_list_groups") return [{ id: "g1", name: "prod" }];
      if (cmd === "ssh_list_tags") return [];
      return undefined;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<GroupTagManager onClose={() => {}} onChanged={() => {}} />));
    await act(async () => {});
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    setInvokeHandler(null);
    window.confirm = realConfirm;
  });

  const clickDelete = async () => {
    const btn = [...container.querySelectorAll("button")].find((b) => b.title === "Delete")!;
    expect(btn).toBeTruthy();
    await act(async () => btn.click());
    await act(async () => {});
  };

  it("확인 창에서 아니오면 지우지 않는다", async () => {
    h.answer.mockResolvedValueOnce(false);
    await clickDelete();
    expect(h.answer).toHaveBeenCalled();
    expect(invokeLog).not.toContain("ssh_delete_group");
  });

  it("예면 지운다", async () => {
    h.answer.mockResolvedValueOnce(true);
    await clickDelete();
    expect(invokeLog).toContain("ssh_delete_group");
  });
});

it("맨 confirm( / window.confirm을 쓰지 않는다 — askConfirm이나 dialog 플러그인 confirm만", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (n !== "test") walk(p);
      } else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
    }
  };
  walk(join(__dirname));
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const importsPluginConfirm = /import\s*\{[^}]*\bconfirm\b[^}]*\}\s*from\s*"@tauri-apps\/plugin-dialog"/.test(src);
    src.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // 주석
      if (/window\.confirm\s*\(/.test(line) || (/(^|[^.\w])confirm\s*\(/.test(line) && !importsPluginConfirm)) {
        bad.push(`${f}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(bad).toEqual([]);
});
