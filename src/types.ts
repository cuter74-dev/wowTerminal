// Rust 측 SshHost / SshAuthMethod 와 일치.

export type SshAuthMethod =
  | { type: "password"; secret_id: string }
  | { type: "password_prompt" }
  | { type: "private_key"; key_id: string; passphrase_secret_id: string | null }
  | { type: "agent" };

export interface SshHost {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  auth: SshAuthMethod;
  tags: string[];
  group_id?: string | null;
  /** ProxyJump 점프 호스트의 ID (#61). 지정 시 이 호스트를 거쳐 접속. */
  proxy_jump?: string | null;
  /** tmux 자동 attach 세션 이름 (#89). 설정 시 접속 직후 tmux new -A -s <이름> 실행. */
  tmux_session?: string | null;
}

/** tmux 세션 정보 (#89) — Rust TmuxSessionInfo와 일치. */
export interface TmuxSessionInfo {
  name: string;
  windows: number;
  attached: boolean;
}

export interface Group {
  id: string;
  name: string;
  sort_order: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface SshKeyEntry {
  id: string;
  name: string;
  algorithm: string;
  fingerprint: string;
  public_key: string;
  encrypted: boolean;
}

export const TAG_PALETTE = [
  "#4a9eff",
  "#52c41a",
  "#fa8c16",
  "#eb2f96",
  "#722ed1",
  "#13c2c2",
] as const;

// --- AI -------------------------------------------------------------------

export interface BackendInfo {
  id: string;
  displayName: string;
  apiBase: string;
  defaultModel: string;
  hasApiKey: boolean;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number | null;
  max_tokens?: number | null;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}

// --- SFTP / 파일 브라우저 -------------------------------------------------

export interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified?: number | null;
  permissions?: number | null;
}

export interface Listing {
  cwd: string;
  entries: FileEntry[];
}

export interface SearchHit {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
}

export type TerminalSource =
  /** cwd: 세션 복원(#90) 시 spawn 시작 디렉터리(OSC 7로 추적된 이전 cwd). */
  | { kind: "local"; cwd?: string | null }
  | { kind: "ssh"; hostId: string };

/** 분할 트리의 노드. leaf는 하나의 PTY/SSH 세션을, split은 두 자식 패널의 비율을 가진다. */
export type Pane =
  | { kind: "leaf"; id: string; source: TerminalSource }
  | {
      kind: "split";
      direction: "vertical" | "horizontal";
      /** first 자식이 차지하는 비율 (0~1). vertical=좌/우, horizontal=상/하. */
      ratio: number;
      first: Pane;
      second: Pane;
    };

export interface Tab {
  id: string;
  label: string;
  root: Pane;
  /** 분할된 탭에서 키 입력/AI 컨텍스트가 향하는 패널 (leaf id). */
  focusedPaneId: string;
}

/// Rust 측 `SshConnectError` (serde tag "kind", snake_case)와 일치.
export type SshConnectError =
  | {
      kind: "host_key_mismatch";
      host: string;
      port: number;
      algorithm: string;
      stored: string;
      presented: string;
    }
  | {
      kind: "first_contact";
      host: string;
      port: number;
      algorithm: string;
      fingerprint: string;
    }
  | {
      kind: "password_required";
      host: string;
      port: number;
      user: string;
    }
  | { kind: "other"; message: string };

export function isSshConnectError(e: unknown): e is SshConnectError {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as { kind?: unknown };
  return (
    obj.kind === "host_key_mismatch" ||
    obj.kind === "first_contact" ||
    obj.kind === "password_required" ||
    obj.kind === "other"
  );
}

// --- Pane 헬퍼 -------------------------------------------------------------

export function findLeaf(pane: Pane, id: string): Pane | null {
  if (pane.kind === "leaf") return pane.id === id ? pane : null;
  return findLeaf(pane.first, id) ?? findLeaf(pane.second, id);
}

export function collectLeaves(pane: Pane): Extract<Pane, { kind: "leaf" }>[] {
  if (pane.kind === "leaf") return [pane];
  return [...collectLeaves(pane.first), ...collectLeaves(pane.second)];
}

export function firstLeafId(pane: Pane): string {
  return pane.kind === "leaf" ? pane.id : firstLeafId(pane.first);
}

/** leaf를 두 자식으로 분할한다. newLeaf는 새 패널, direction은 분할 방향. */
export function splitLeaf(
  root: Pane,
  targetId: string,
  newLeaf: Extract<Pane, { kind: "leaf" }>,
  direction: "vertical" | "horizontal",
): Pane {
  if (root.kind === "leaf") {
    if (root.id !== targetId) return root;
    return {
      kind: "split",
      direction,
      ratio: 0.5,
      first: root,
      second: newLeaf,
    };
  }
  return {
    ...root,
    first: splitLeaf(root.first, targetId, newLeaf, direction),
    second: splitLeaf(root.second, targetId, newLeaf, direction),
  };
}

/** leaf를 트리에서 제거한다. 부모 split은 형제 패널로 대체. root가 단일 leaf면 null 반환. */
export function removeLeaf(root: Pane, targetId: string): Pane | null {
  if (root.kind === "leaf") {
    return root.id === targetId ? null : root;
  }
  if (root.first.kind === "leaf" && root.first.id === targetId) {
    return root.second;
  }
  if (root.second.kind === "leaf" && root.second.id === targetId) {
    return root.first;
  }
  return {
    ...root,
    first: removeLeaf(root.first, targetId) ?? root.first,
    second: removeLeaf(root.second, targetId) ?? root.second,
  };
}

/** 특정 split의 ratio를 변경. id가 split의 그것이 아닐 때만 재귀. */
export function setRatioByPath(root: Pane, path: number[], ratio: number): Pane {
  if (root.kind === "leaf") return root;
  if (path.length === 0) return { ...root, ratio };
  const [head, ...rest] = path;
  if (head === 0) return { ...root, first: setRatioByPath(root.first, rest, ratio) };
  return { ...root, second: setRatioByPath(root.second, rest, ratio) };
}

/**
 * 분할이 있는 트리에서 현재 focus된 leaf의 위치를 기준으로 인접 leaf 찾기.
 * direction에 부합하는 가장 가까운 split 조상을 찾아 다른 자식의 첫/마지막 leaf로 점프.
 */
export function neighborLeafId(
  root: Pane,
  focusedId: string,
  direction: "left" | "right" | "up" | "down",
): string | null {
  // 트리에서 focused leaf까지의 경로를 찾는다.
  const path = pathTo(root, focusedId);
  if (!path) return null;

  const wantedSplit: "vertical" | "horizontal" =
    direction === "left" || direction === "right" ? "vertical" : "horizontal";
  const wantedChild: 0 | 1 =
    direction === "right" || direction === "down" ? 1 : 0;

  // 경로를 거슬러 올라가며 조건에 맞는 split을 찾고 반대편 leaf로.
  let node: Pane = root;
  const nodes: Pane[] = [root];
  for (const step of path) {
    if (node.kind !== "split") break;
    node = step === 0 ? node.first : node.second;
    nodes.push(node);
  }
  // path.length = depth → nodes.length = depth+1 (마지막은 leaf).
  for (let i = path.length - 1; i >= 0; i--) {
    const parent = nodes[i];
    if (parent.kind !== "split" || parent.direction !== wantedSplit) continue;
    const cameFrom = path[i];
    // 다른 자식 쪽으로 가야 동작
    if (cameFrom === wantedChild) continue;
    const target = wantedChild === 0 ? parent.first : parent.second;
    return wantedChild === 0 ? lastLeafId(target) : firstLeafId(target);
  }
  return null;
}

function pathTo(root: Pane, leafId: string, acc: number[] = []): number[] | null {
  if (root.kind === "leaf") return root.id === leafId ? acc : null;
  return (
    pathTo(root.first, leafId, [...acc, 0]) ??
    pathTo(root.second, leafId, [...acc, 1])
  );
}

function lastLeafId(pane: Pane): string {
  return pane.kind === "leaf" ? pane.id : lastLeafId(pane.second);
}
