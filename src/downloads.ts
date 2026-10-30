/**
 * 원격 파일·폴더를 기본 다운로드 폴더로 받는다 (#166 — 파일 패널·편집 탭 공용).
 * 저장 위치는 설정의 "기본 다운로드 폴더"(#148, 비우면 OS 다운로드 폴더). 같은 이름이 있으면
 * 덮어쓰지 않고 "이름 (1).확장자"로 저장한다(SC-04 — 로컬은 조용히 안전하게).
 */
import { invoke } from "@tauri-apps/api/core";
import { downloadDir as osDownloadDir, homeDir as osHomeDir } from "@tauri-apps/api/path";
import { loadSettings } from "./settings";
import { Listing } from "./types";

export async function resolveDownloadDir(): Promise<string> {
  const configured = loadSettings().general.downloadDir.trim();
  if (!configured) return await osDownloadDir();
  if (configured === "~" || configured.startsWith("~/")) {
    const home = (await osHomeDir()).replace(/[/\\]+$/, "");
    return configured === "~" ? home : home + "/" + configured.slice(2);
  }
  return configured;
}

/** `taken`에 없는 이름: "report.txt" → "report (1).txt" (FileBrowser·백엔드와 같은 규칙). */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const cand = `${base} (${i})${ext}`;
    if (!taken.has(cand)) return cand;
  }
  return `${base} (${taken.size + 1})${ext}`;
}

let seq = 0;
export function newTransferId(): string {
  return `wt-files-${Date.now()}-${++seq}`;
}

/**
 * 원격 경로 하나를 받는다. 받은 로컬 경로를 돌려준다. 진행은 "sftp:progress" 이벤트로
 * transferId별로 온다(onStart로 id를 알려 준다).
 */
export async function downloadRemote(
  hostId: string,
  remotePath: string,
  name: string,
  onStart?: (transferId: string) => void,
): Promise<string> {
  const dir = await resolveDownloadDir();
  let taken = new Set<string>();
  try {
    const l = await invoke<Listing>("local_list_dir", { path: dir });
    taken = new Set(l.entries.map((e) => e.name));
  } catch {
    // 폴더를 못 읽으면 백엔드가 만들다 실패하며 알려 준다.
  }
  const transferId = newTransferId();
  onStart?.(transferId);
  return invoke<string>("sftp_download", {
    hostId,
    remotePath,
    localDir: dir,
    transferId,
    destName: uniqueName(name, taken),
  });
}
