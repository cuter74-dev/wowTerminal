/**
 * 편집 탭으로 연 파일들의 저장소 (#166). 터미널 쪽 singleton(terminalRegistry·aiBus)처럼 모듈
 * 수준에 두어 App·TabBar·FileEditor·HostList(업데이트 전 확인)가 prop drilling 없이 공유한다.
 *
 * - 편집 중인 내용은 CodeMirror 뷰가 갖고, 여기서는 상태(로드·dirty·저장 중·충돌)만 관리한다.
 *   저장할 때는 등록된 편집기 핸들에서 텍스트를 받아 온다.
 * - **편집 내용은 디스크(localStorage 포함)에 남기지 않는다** — 비밀번호·키가 든 설정 파일을
 *   보호하기 위해서다(화면 기획서 SC-05). 탭 복원은 경로만 저장하고, 탭을 열 때 서버에서 다시 읽는다.
 */
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { Eol, toFileEol } from "./eol";

export type Stamp = { size: number; mtime: number | null; hash: string | null };
export type ReadOnlyReason =
  | "too_large"
  | "binary"
  | "not_utf8"
  | "utf16"
  | "mixed_eol"
  | "no_permission"
  | "image_too_large";
/** 백엔드 ssh/files.rs `Opened`. */
export type Opened = {
  real_path: string;
  content: string;
  editable: boolean;
  reason: ReadOnlyReason | null;
  eol: Eol;
  bom: boolean;
  image: string | null;
  stamp: Stamp;
  size: number;
  mode: number | null;
};
export type SaveMethod =
  | "atomic"
  | "swap"
  | "direct_dir_not_writable"
  | "direct_owner"
  | "direct_hardlink";
type SaveOutcome =
  | { kind: "saved"; stamp: Stamp; method: SaveMethod }
  | { kind: "conflict"; current: Stamp | null };

export type FileDoc = {
  id: string;
  /** null = 로컬 파일. */
  hostId: string | null;
  /** 사용자가 연 경로(링크일 수 있음). 저장은 opened.real_path에 한다. */
  path: string;
  name: string;
  state: "unloaded" | "loading" | "ready" | "error";
  error?: string;
  opened?: Opened;
  /** 마지막으로 디스크와 일치한 텍스트(LF로 정규화 — 편집기 문서와 같은 형식). */
  base: string;
  dirty: boolean;
  saving: boolean;
  /** 저장하려는데 서버 파일이 바뀌어 있었다(current null = 사라짐). */
  conflict: null | { current: Stamp | null };
  /** 탭으로 돌아왔더니 바깥에서 바뀌었는데 내 수정도 있어 자동으로 다시 읽지 못함. */
  externalChange: boolean;
  /** 마지막 저장이 직접 쓰기였으면 그 이유(띠로 안내). */
  notice: SaveMethod | null;
  savedAt: number;
  /** 바깥 변경으로 조용히 다시 읽은 시각(짧게 안내). */
  reloadedAt: number;
};

/** 편집기(FileEditor)가 등록하는 핸들. */
export interface EditorHandle {
  getText(): string;
  /** 문서 전체를 바꾼다 — 실행 취소 기록에 남아 ⌘Z로 되돌릴 수 있다. */
  replaceAll(text: string): void;
  focus(): void;
}

const lf = (s: string) => s.replace(/\r\n?/g, "\n");

export function docKey(hostId: string | null, path: string): string {
  return `${hostId ?? "local"}\u0000${path}`;
}

let docs: FileDoc[] = [];
const listeners = new Set<() => void>();
const editors = new Map<string, EditorHandle>();

function emit() {
  persist();
  for (const l of listeners) l();
}
function patch(id: string, p: Partial<FileDoc>) {
  docs = docs.map((d) => (d.id === id ? { ...d, ...p } : d));
  emit();
}
export function getDoc(id: string): FileDoc | undefined {
  return docs.find((d) => d.id === id);
}
export function getDocs(): FileDoc[] {
  return docs;
}
export function subscribeDocs(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useFileDocs(): FileDoc[] {
  return useSyncExternalStore(subscribeDocs, getDocs, getDocs);
}

export function registerEditor(id: string, h: EditorHandle): () => void {
  editors.set(id, h);
  return () => {
    if (editors.get(id) === h) editors.delete(id);
  };
}
export function focusEditor(id: string) {
  editors.get(id)?.focus();
}

export function setDirty(id: string, dirty: boolean) {
  const d = getDoc(id);
  if (d && d.dirty !== dirty) patch(id, { dirty });
}

export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// ---- 원격 연결 ------------------------------------------------------------

/**
 * 원격 명령을 실행하되, SFTP 연결이 없으면(앱 재시작 뒤, 또는 "양쪽 보기"를 닫으며 연결이
 * 끊긴 뒤) 한 번 연결하고 다시 시도한다.
 */
export async function withSftp<T>(hostId: string | null, run: () => Promise<T>): Promise<T> {
  if (!hostId) return run();
  try {
    return await run();
  } catch (e) {
    if (!/session not found/i.test(String(e))) throw e;
    await invoke("sftp_open", { hostId, path: null });
    return run();
  }
}

// ---- 열기·다시 읽기 --------------------------------------------------------

/**
 * 편집 탭으로 연다. 이미 열려 있으면 그 탭 id를 돌려준다(링크로 연 같은 실제 파일 포함).
 * `lazy`면 목록에만 올리고 읽지 않는다(세션 복원 — 탭을 열 때 읽는다).
 */
export function openDoc(hostId: string | null, path: string, lazy = false): string {
  const id = docKey(hostId, path);
  const same = docs.find(
    (d) => d.id === id || (d.hostId === hostId && d.opened?.real_path === path),
  );
  if (same) return same.id;
  docs = [
    ...docs,
    {
      id,
      hostId,
      path,
      name: baseName(path),
      state: "unloaded",
      base: "",
      dirty: false,
      saving: false,
      conflict: null,
      externalChange: false,
      notice: null,
      savedAt: 0,
      reloadedAt: 0,
    },
  ];
  emit();
  if (!lazy) void loadDoc(id);
  return id;
}

/** 아직 안 읽었거나(복원된 탭) 읽기에 실패한 문서를 읽는다. */
export async function loadDoc(id: string): Promise<void> {
  const d = getDoc(id);
  if (!d || d.state === "loading") return;
  patch(id, { state: "loading", error: undefined });
  try {
    const o = await withSftp(d.hostId, () =>
      invoke<Opened>("file_open", { hostId: d.hostId, path: d.path }),
    );
    // 링크로 열었는데 실제 파일이 이미 다른 탭에 열려 있으면 그 탭을 쓴다.
    const dup = docs.find(
      (x) => x.id !== id && x.hostId === d.hostId && x.opened?.real_path === o.real_path,
    );
    if (dup) {
      closeDoc(id);
      dupRedirect.forEach((f) => f(id, dup.id));
      return;
    }
    patch(id, {
      state: "ready",
      opened: o,
      base: lf(o.content),
      dirty: false,
      conflict: null,
      externalChange: false,
    });
  } catch (e) {
    patch(id, { state: "error", error: String(e) });
  }
}

/** 링크로 연 탭이 기존 탭과 같은 파일로 밝혀졌을 때(App이 활성 탭을 옮긴다). */
const dupRedirect = new Set<(from: string, to: string) => void>();
export function onDocRedirect(f: (from: string, to: string) => void): () => void {
  dupRedirect.add(f);
  return () => dupRedirect.delete(f);
}

/**
 * 서버(디스크)에서 다시 읽어 편집기 내용을 바꾼다. 바꾸기는 실행 취소 기록에 남는다 —
 * "서버 것 다시 불러오기"를 골라도 ⌘Z로 내 수정을 되살릴 수 있다(SC-05 ①).
 */
export async function reloadDoc(id: string): Promise<void> {
  const d = getDoc(id);
  if (!d) return;
  try {
    const o = await withSftp(d.hostId, () =>
      invoke<Opened>("file_open", { hostId: d.hostId, path: d.path }),
    );
    const text = lf(o.content);
    patch(id, {
      opened: o,
      base: text,
      conflict: null,
      externalChange: false,
      state: "ready",
      error: undefined,
    });
    editors.get(id)?.replaceAll(text);
    patch(id, { dirty: false });
  } catch (e) {
    patch(id, { error: String(e) });
  }
}

/**
 * 탭으로 돌아올 때 바깥 변경 확인(SC-05 "바깥에서 바뀜 감지"). 내 수정이 없으면 조용히 다시
 * 읽고(커서는 편집기가 최대한 유지), 있으면 ⚠만 표시한다.
 */
export async function checkExternal(id: string): Promise<void> {
  const d = getDoc(id);
  if (!d || d.state !== "ready" || !d.opened || d.saving || d.opened.image) return;
  let cur: Stamp | null;
  try {
    cur = await withSftp(d.hostId, () =>
      invoke<Stamp | null>("file_stamp", { hostId: d.hostId, path: d.opened!.real_path }),
    );
  } catch {
    return; // 연결이 끊긴 경우 등 — 저장할 때 다시 확인된다.
  }
  const s = d.opened.stamp;
  const changed =
    !cur ||
    cur.size !== s.size ||
    cur.mtime !== s.mtime ||
    (cur.hash !== null && s.hash !== null && cur.hash !== s.hash);
  if (!changed) return;
  const now = getDoc(id);
  if (!now) return;
  if (!now.dirty && cur) {
    await reloadDoc(id);
    patch(id, { reloadedAt: Date.now() });
  } else {
    patch(id, { externalChange: true });
  }
}

// ---- 저장 ----------------------------------------------------------------

export type SaveResult = "saved" | "conflict" | "error" | "noop";

/** 저장. 충돌이면 저장하지 않고 doc.conflict를 채운다(편집기가 선택 창을 띄운다). */
export async function saveDoc(id: string, force = false): Promise<SaveResult> {
  const d = getDoc(id);
  const ed = editors.get(id);
  if (!d || !ed || !d.opened || !d.opened.editable || d.saving) return "noop";
  if (!d.dirty && !force) return "noop";
  const text = ed.getText();
  patch(id, { saving: true, error: undefined });
  try {
    const out = await withSftp(d.hostId, () =>
      invoke<SaveOutcome>("file_save", {
        hostId: d.hostId,
        path: d.opened!.real_path,
        content: toFileEol(text, d.opened!.eol),
        bom: d.opened!.bom,
        expect: d.opened!.stamp,
        force,
      }),
    );
    if (out.kind === "conflict") {
      patch(id, { saving: false, conflict: { current: out.current } });
      return "conflict";
    }
    const cur = getDoc(id);
    patch(id, {
      saving: false,
      opened: cur?.opened ? { ...cur.opened, stamp: out.stamp, size: out.stamp.size } : undefined,
      base: text,
      // 저장하는 동안 더 입력했으면 여전히 수정됨.
      dirty: ed.getText() !== text,
      conflict: null,
      externalChange: false,
      notice: out.method === "atomic" || out.method === "swap" ? null : out.method,
      savedAt: Date.now(),
    });
    return "saved";
  } catch (e) {
    patch(id, { saving: false, error: String(e) });
    return "error";
  }
}

export function dismissConflict(id: string) {
  patch(id, { conflict: null });
}
export function dismissNotice(id: string) {
  patch(id, { notice: null });
}

// ---- 닫기·미저장 확인 ------------------------------------------------------

export function closeDoc(id: string) {
  docs = docs.filter((d) => d.id !== id);
  editors.delete(id);
  emit();
}

export function dirtyDocs(): FileDoc[] {
  return docs.filter((d) => d.dirty);
}

export type UnsavedChoice = "save" | "discard" | "cancel";
export type UnsavedReason = "close_tab" | "close_window" | "quit" | "update";
type UnsavedAsk = (docs: FileDoc[], reason: UnsavedReason) => Promise<UnsavedChoice>;
let askUnsaved: UnsavedAsk | null = null;
/** App이 확인 창을 띄우는 함수를 등록한다. */
export function setUnsavedPrompt(f: UnsavedAsk | null) {
  askUnsaved = f;
}

/**
 * 미저장 문서가 있으면 묻고, 계속해도 되면 true. "저장"을 고르면 모두 저장하고, 하나라도
 * 충돌·실패하면 멈춘다(false) — 그 탭에 선택 창·오류가 표시된다.
 */
export async function guardUnsaved(
  reason: UnsavedReason,
  only?: string[],
): Promise<boolean> {
  const dirty = dirtyDocs().filter((d) => !only || only.includes(d.id));
  if (dirty.length === 0) return true;
  if (!askUnsaved) return false;
  const choice = await askUnsaved(dirty, reason);
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  for (const d of dirty) {
    if ((await saveDoc(d.id)) !== "saved") {
      firstFailure.forEach((f) => f(d.id));
      return false;
    }
  }
  return true;
}
const firstFailure = new Set<(id: string) => void>();
/** 일괄 저장이 멈춘 문서(App이 그 탭을 연다). */
export function onSaveAllStopped(f: (id: string) => void): () => void {
  firstFailure.add(f);
  return () => firstFailure.delete(f);
}

// ---- 탭 복원(경로만) --------------------------------------------------------

const KEY = "wowterminal.fileTabs.v1";
let persistEnabled = false;
type Saved = { tabs: { h: string | null; p: string }[] };

function persist() {
  if (!persistEnabled) return;
  try {
    const s: Saved = { tabs: docs.map((d) => ({ h: d.hostId, p: d.path })) };
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 저장 실패는 치명적이지 않다.
  }
}

/** 메인 창에서만 호출: 지난번 탭 경로를 읽지 않은 상태로 복원하고, 이후 변경을 저장한다. */
export function restoreDocTabs(): string[] {
  persistEnabled = true;
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    if (!s || !Array.isArray(s.tabs)) return [];
    return s.tabs
      .filter((t) => typeof t.p === "string" && t.p)
      .map((t) => openDoc(t.h ?? null, t.p, true));
  } catch {
    return [];
  }
}

// ---- 호스트 색 ------------------------------------------------------------

/** 서버별 색 점(SC-02). 같은 서버의 터미널 탭·파일 탭·파일 패널 배지에 같은 색. */
const PALETTE = ["#14b8a6", "#a78bfa", "#f59e0b", "#f472b6", "#60a5fa", "#84cc16", "#22d3ee", "#fb7185"];
export function hostColor(hostId: string | null): string | null {
  if (!hostId) return null;
  let h = 0;
  for (let i = 0; i < hostId.length; i++) h = (h * 31 + hostId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ---- 경로·이름 표시 --------------------------------------------------------

/** 원격은 '/', 로컬 Windows 경로('\'만 쓰는)는 '\'로 잇는다. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export function parentPath(p: string): string {
  const sep = p.includes("\\") && !p.includes("/") ? "\\" : "/";
  const trimmed = p.length > 1 && p.endsWith(sep) ? p.slice(0, -1) : p;
  const i = trimmed.lastIndexOf(sep);
  if (i < 0) return p;
  if (i === 0) return sep;
  const head = trimmed.slice(0, i);
  // "C:" → "C:\"
  return /^[A-Za-z]:$/.test(head) ? head + sep : head;
}

/**
 * 파일 이름을 화면에 보일 때 줄바꿈·제어 문자·방향 제어 문자(RLO 등)를 보이는 기호로 바꾼다 —
 * "txt.exe"처럼 보이게 하는 이름 속임을 막는다(SC-08).
 */
export function displayName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, (c) => {
    const code = c.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return `\\x${code.toString(16).padStart(2, "0")}`;
    return `\u27e8U+${code.toString(16).toUpperCase()}\u27e9`;
  });
}

/** 터미널에 붙여 넣어도 안전하게 따옴표 처리한 경로. */
export function shellQuote(p: string): string {
  if (/^[A-Za-z0-9_./~+@%:,=-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}
