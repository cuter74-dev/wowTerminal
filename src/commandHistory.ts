// 앱 레벨 명령 히스토리 (S-051/053). PTY가 raw 모드라 셸 히스토리와 별개로,
// 터미널에 입력된 라인을 단순 추적해 수집한다 (타이핑/백스페이스/엔터 기준 — 화살표 등
// 복잡한 편집은 부정확할 수 있음). localStorage에 전역 저장.

const KEY = "wowterminal-cmd-history";
const CAP = 500;

// 기본 제안 시드 — 히스토리에 없어도 인라인 자동완성으로 제안할 자주 쓰는 명령들.
// 히스토리 매칭이 우선이고, 없을 때만 폴백으로 제안한다(→/End로 수락).
const SEED_COMMANDS: string[] = [
  "claude --dangerously-skip-permissions",
];

// 내장 플래그/서브명령 사전 (#122) — `명령 ... 마지막토큰`을 완성한다. 명령을 실제로
// 실행하지 않으므로 빠르고 안전하며(원격 SSH에서도 동일), 자주 쓰는 명령만 커버한다.
// 각 항목은 startsWith로 매칭하고 가장 먼저 맞는 걸 제안한다(긴 형태/자주 쓰는 것 우선 정렬).
const COMMAND_FLAGS: Record<string, string[]> = {
  claude: [
    "--dangerously-skip-permissions",
    "--model",
    "--continue",
    "--resume",
    "--print",
    "--permission-mode",
    "--help",
    "--version",
  ],
  git: [
    "status",
    "commit",
    "checkout",
    "branch",
    "push",
    "pull",
    "fetch",
    "merge",
    "rebase",
    "stash",
    "log",
    "diff",
    "restore",
    "switch",
    "remote",
    "clone",
    "--version",
    "--help",
  ],
  docker: [
    "ps",
    "images",
    "run",
    "build",
    "exec",
    "logs",
    "pull",
    "push",
    "compose",
    "stop",
    "start",
    "restart",
    "rm",
    "rmi",
    "--version",
    "--help",
  ],
  kubectl: [
    "get",
    "describe",
    "apply",
    "delete",
    "logs",
    "exec",
    "rollout",
    "scale",
    "port-forward",
    "--namespace",
    "--help",
  ],
  npm: [
    "install",
    "run",
    "start",
    "test",
    "build",
    "ci",
    "update",
    "uninstall",
    "--version",
    "--help",
  ],
  systemctl: [
    "status",
    "start",
    "stop",
    "restart",
    "enable",
    "disable",
    "reload",
    "--help",
  ],
  ssh: ["-p", "-i", "-L", "-R", "-D", "-N", "-T", "-v", "-o", "-J"],
  apt: ["install", "remove", "update", "upgrade", "search", "show", "list"],
  cargo: [
    "build",
    "run",
    "test",
    "check",
    "update",
    "add",
    "fmt",
    "clippy",
    "--release",
    "--version",
  ],
};

/** `명령 ... 마지막토큰`을 내장 사전으로 완성한다. prefix 전체를 보존하고 마지막 토큰만 치환. */
function suggestFromFlags(prefix: string): string | null {
  // 마지막 글자가 공백이면 완성할 부분 토큰이 없다.
  if (/\s$/.test(prefix)) return null;
  const tokens = prefix.split(/\s+/);
  if (tokens.length < 2) return null; // 최소 `명령 + 부분토큰`
  const flags = COMMAND_FLAGS[tokens[0]];
  if (!flags) return null;
  const last = tokens[tokens.length - 1];
  if (!last) return null;
  const match = flags.find((f) => f.startsWith(last) && f !== last);
  if (!match) return null;
  // prefix의 마지막 토큰만 match로 치환(앞쪽 공백/인자 보존).
  return prefix.slice(0, prefix.length - last.length) + match;
}

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
  // 히스토리에 없으면 내장 플래그 사전으로 마지막 토큰을 완성(#122).
  const flagSug = suggestFromFlags(prefix);
  if (flagSug) return flagSug;
  // 그래도 없으면 시드에서 제안.
  for (const s of SEED_COMMANDS) {
    if (s.startsWith(prefix) && s !== prefix) return s;
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
