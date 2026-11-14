// 앱 업데이트 확인·설치 (#188). 전에는 서버 목록이 뜰 때 한 번만 확인해서, 켜 둔 채로는 새 버전을
// 알 수 없었다. 이제 켤 때·켜 둔 동안 4시간마다·절전에서 깨어났을 때 확인하고, 찾으면 안내 줄과
// 서버 목록의 "↑ 버전" 버튼이 같은 상태를 본다. 저절로 재시작하지 않는다 — 사용자가 고른다.
import { useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { markAppTeardown } from "./terminalRegistry";
import { guardUnsaved } from "./fileDocs";

/** 켜 둔 동안 이만큼 지나면 다시 확인한다. */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** 벽시계를 보는 간격 — 절전 중엔 타이머가 멈추므로, 깨어난 뒤 첫 틱에서 4시간이 지났는지 안다. */
const TICK_MS = 5 * 60 * 1000;

export type UpdateState = {
  update: Update | null;
  installing: boolean;
  error: string | null;
  /** "나중에"를 누른 버전 — 그 버전의 안내 줄만 숨긴다. */
  dismissed: string | null;
};

const INITIAL: UpdateState = { update: null, installing: false, error: null, dismissed: null };
let state: UpdateState = INITIAL;
const listeners = new Set<() => void>();
function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getUpdateState(): UpdateState {
  return state;
}
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, getUpdateState);
}

let lastCheck = 0;
let checking = false;

/** 지금 한 번 확인한다. 엔드포인트가 없거나 오프라인이면 조용히 넘어가고 다음 주기에 다시 본다. */
export async function checkForUpdate(): Promise<void> {
  if (checking) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const u = await check();
    if (u && u.version !== state.update?.version) set({ update: u, error: null });
  } catch {
    /* 다음 주기에 다시 */
  } finally {
    checking = false;
  }
}

const dueNow = () => Date.now() - lastCheck >= CHECK_EVERY_MS;

/** 켤 때 한 번 확인하고, 4시간마다·절전 복귀 뒤·창이 다시 앞에 올 때 밀린 확인을 한다.
 *  데스크톱 메인 창에서만 부른다. 반환 함수로 멈춘다. */
export function startUpdateChecks(): () => void {
  void checkForUpdate();
  const iv = window.setInterval(() => {
    if (dueNow()) void checkForUpdate();
  }, TICK_MS);
  const onFocus = () => {
    if (dueNow()) void checkForUpdate();
  };
  window.addEventListener("focus", onFocus);
  return () => {
    clearInterval(iv);
    window.removeEventListener("focus", onFocus);
  };
}

/** "나중에" — 지금 찾은 버전의 안내 줄을 숨긴다(더 새 버전이 나오면 다시 뜬다). */
export function dismissUpdate(): void {
  if (state.update) set({ dismissed: state.update.version, error: null });
}

/** 받아서 설치하고 재시작한다. 저장 안 한 파일 탭이 있으면 먼저 묻는다(#166). */
export async function installUpdate(): Promise<void> {
  const u = state.update;
  if (!u || state.installing) return;
  if (!(await guardUnsaved("update"))) return;
  set({ installing: true, error: null });
  try {
    await u.downloadAndInstall();
    // (#153) 재시작 전에 "앱 종료 중"으로 표시한다 — 이 플래그가 없으면 언마운트 정리에서
    // 세션 kill이 나가 데몬의 세션(돌고 있는 Claude Code/Gemini 등)까지 죽는다.
    // 세션은 데몬에 남고, 새로 뜬 UI가 복원 스냅샷의 세션 id로 다시 attach한다.
    markAppTeardown();
    await relaunch();
  } catch (e) {
    set({ installing: false, error: String(e) });
  }
}

/** 시험용 — 모듈 상태를 처음으로 되돌린다. */
export function resetUpdatesForTest(): void {
  state = INITIAL;
  lastCheck = 0;
  checking = false;
  listeners.forEach((l) => l());
}
