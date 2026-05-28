// 앱 레벨 명령 히스토리 (S-051/053). PTY가 raw 모드라 셸 히스토리와 별개로,
// 터미널에 입력된 라인을 단순 추적해 수집한다 (타이핑/백스페이스/엔터 기준 — 화살표 등
// 복잡한 편집은 부정확할 수 있음). localStorage에 전역 저장.

const KEY = "wowterminal-cmd-history";
const CAP = 500;

let cache: string[] | null = null;

function load(): string[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function getHistory(): string[] {
  return [...load()];
}

export function addHistory(cmd: string): void {
  const c = cmd.trim();
  if (!c) return;
  const list = load();
  // 직전과 동일하면 무시, 중복은 최신으로 끌어올림.
  const existing = list.indexOf(c);
  if (existing !== -1) list.splice(existing, 1);
  list.push(c);
  if (list.length > CAP) list.splice(0, list.length - CAP);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 무시 */
  }
}

/** prefix로 시작하는 가장 최근 명령 1개 (인라인 자동완성용). */
export function suggest(prefix: string): string | null {
  if (!prefix) return null;
  const list = load();
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].startsWith(prefix) && list[i] !== prefix) return list[i];
  }
  return null;
}

/** query를 포함하는 명령 목록 (최신순, Ctrl-R 검색용). */
export function searchHistory(query: string): string[] {
  const list = load();
  const q = query.toLowerCase();
  const out: string[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (!q || list[i].toLowerCase().includes(q)) out.push(list[i]);
    if (out.length >= 50) break;
  }
  return out;
}
