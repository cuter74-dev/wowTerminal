// 세션 복원 (#90). 메인 창의 탭 레이아웃(분할 트리 포함)을 localStorage에 스냅샷으로
// 저장하고, 다음 실행 시 복원한다. leaf별로 저장하는 것:
//  - source(local/ssh hostId)
//  - 로컬 leaf의 cwd(OSC 7로 추적된 값) — 복원 시 그 디렉터리에서 spawn(`cd` 노출 없음)
//  - 알려진 tmux 세션 이름(자동 attach/선택기로 붙었던 것) — 복원 시 재attach
// 세션 ID 같은 휘발성 값은 저장하지 않는다(프로세스는 어차피 죽었음). tmux가 있으면
// 실제 작업 내용은 tmux 서버가 보존한다.

import { Pane, Tab, TerminalSource } from "./types";

const KEY = "wowterminal.session.v1";

type SavedPane =
  | { k: "l"; src: TerminalSource; cwd?: string | null; tmux?: string | null }
  | { k: "s"; direction: "vertical" | "horizontal"; ratio: number; first: SavedPane; second: SavedPane };

type SavedTab = { label: string; root: SavedPane };

type Snapshot = { v: 1; tabs: SavedTab[]; activeIndex: number };

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 저장 시 leaf의 cwd/tmux를 묻는 콜백 (App이 terminalRegistry/추적 ref로 답한다). */
export interface LeafProbe {
  getCwd: (leafId: string) => string | null;
  getTmux: (leafId: string) => string | null;
}

function serializePane(pane: Pane, probe: LeafProbe): SavedPane {
  if (pane.kind === "leaf") {
    return {
      k: "l",
      src: pane.source,
      cwd: pane.source.kind === "local" ? probe.getCwd(pane.id) : null,
      tmux: probe.getTmux(pane.id),
    };
  }
  return {
    k: "s",
    direction: pane.direction,
    ratio: pane.ratio,
    first: serializePane(pane.first, probe),
    second: serializePane(pane.second, probe),
  };
}

/** 현재 탭 레이아웃을 스냅샷으로 저장. 메인 창에서만 호출할 것. */
export function saveSessionSnapshot(
  tabs: Tab[],
  activeTabId: string | null,
  probe: LeafProbe,
): void {
  try {
    const snap: Snapshot = {
      v: 1,
      tabs: tabs.map((t) => ({ label: t.label, root: serializePane(t.root, probe) })),
      activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeTabId)),
    };
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    // 저장 실패(quota 등)는 치명적이지 않다 — 다음 주기에 재시도.
  }
}

export interface RestoredSession {
  tabs: Tab[];
  activeId: string | null;
  /** leafId → 복원 시 attach할 tmux 세션 이름. onSession 시점에 attach 명령 전송용. */
  initTmux: Record<string, string>;
}

function restorePane(saved: SavedPane, initTmux: Record<string, string>): Pane {
  if (saved.k === "l") {
    const id = newId();
    if (saved.tmux) initTmux[id] = saved.tmux;
    const source: TerminalSource =
      saved.src.kind === "ssh"
        ? { kind: "ssh", hostId: saved.src.hostId }
        : { kind: "local", ...(saved.cwd ? { cwd: saved.cwd } : {}) };
    return { kind: "leaf", id, source };
  }
  return {
    kind: "split",
    direction: saved.direction,
    ratio: saved.ratio,
    first: restorePane(saved.first, initTmux),
    second: restorePane(saved.second, initTmux),
  };
}

function firstLeafIdOf(pane: Pane): string {
  return pane.kind === "leaf" ? pane.id : firstLeafIdOf(pane.first);
}

/** 저장된 스냅샷을 새 leaf ID로 복원. 스냅샷이 없거나 깨졌으면 null. */
export function loadSessionSnapshot(): RestoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    if (snap.v !== 1 || !Array.isArray(snap.tabs) || snap.tabs.length === 0) return null;
    const initTmux: Record<string, string> = {};
    const tabs: Tab[] = snap.tabs.map((st) => {
      const root = restorePane(st.root, initTmux);
      return {
        id: newId(),
        label: st.label,
        root,
        focusedPaneId: firstLeafIdOf(root),
      };
    });
    const active = tabs[Math.min(Math.max(snap.activeIndex, 0), tabs.length - 1)];
    return { tabs, activeId: active?.id ?? tabs[0].id, initTmux };
  } catch {
    return null;
  }
}
