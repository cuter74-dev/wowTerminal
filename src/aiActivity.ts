// AI 에이전트 상태를 화면으로 판정한다 (#180, #187).
// hook·프로세스 조회 없이 보이는 화면 글자만 보므로 tmux 안과 SSH에서도 된다.
//
// 일하는 중 — 에이전트는 일하는 동안 상태 줄을 띄운다.
// - Claude Code(2.1.x 실측): `· Meandering…`, `✳ Wrangling… (2s · ↓ 229 tokens · …)` — 회전 글리프
//   ·✢✳✶✻✽(유니코드가 없으면 *) + 문구 + "…". 끝나면 `✻ Baked for 1s · done 3:44 PM`처럼 "…"가 없다.
// - Codex(0.167 실측): `• Working (2s • esc to interrupt)`.
// - Gemini CLI: `⠋ … (esc to cancel, 3s)`.
// 평범한 글(대화 내용에 같은 낱말이 나오는 경우)에 걸리지 않게 상태 줄 모양 그대로만 본다.
//
// 입력 기다림(#187) — 권한 확인·질문은 화면 맨 아래의 번호 메뉴와 키 안내로 알아본다.
// - Claude Code: `❯ 1. Yes` … `Esc to cancel · Tab to amend` / `Enter to select · … · Esc to cancel`
// - Codex: `› 1. Yes, proceed (y)` … `Press enter to confirm or esc to cancel`
// - Gemini CLI(소스 기준): `│ ● 1. Allow once` … `3. No, suggest changes (esc)`
//
// 살아 있음(#187) — 에이전트가 끝나도 마지막 화면 일부(회전 상태 줄 등)가 남는다. 그래서 일하는
// 중·쉬는 중은 그 에이전트의 입력란이 화면 맨 아래에 있을 때만 인정한다.
// - Claude Code: `────` / `❯ …` / `────` 입력 상자 아래에 안내 몇 줄. 끝나면 셸 프롬프트가 아래
//   테두리를 덮어 상자가 깨진다.
// - Codex: `› …` 입력 줄 아래에 모델·안내 몇 줄. 끝날 때 화면을 지운다.
// - Gemini CLI: 입력란 안내문(`Type your message or @path/to/file`)이나 `> ` 입력 줄 + 사용량 꼬리말.
// 기준 화면은 src/test/fixtures/agents/에 있다(Claude·Codex 실측, Gemini는 소스로 만든 것).

export type AgentKind = "claude" | "codex" | "gemini";
export type AgentState = "working" | "blocked" | "idle";
export type AgentScan = { agent: AgentKind; state: AgentState };

/** 에이전트 표시 이름과 대표색(사용량 막대와 같은 색, #185). */
export const AGENT_NAMES: Record<AgentKind, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
export const AGENT_COLORS: Record<AgentKind, string> = {
  claude: "#d97757",
  codex: "#10a37f",
  gemini: "#8ab4f8",
};

const CLAUDE_RE = /^\s*[·✢✳✶✻✽*]\s+\S.*…(?:\s*\([^()]*\))?\s*$/u;
const CODEX_WORK_RE = /\besc to interrupt(?:\s*[·•][^()]*)?\)\s*$/i;
const GEMINI_WORK_RE = /\(esc to cancel,\s*[0-9hms ]+\)\s*$/i;

/** 화면 줄 하나가 에이전트의 "일하는 중" 상태 줄인지. */
export function isWorkingLine(line: string): boolean {
  return CLAUDE_RE.test(line) || CODEX_WORK_RE.test(line) || GEMINI_WORK_RE.test(line);
}

/** 화면 줄들 중 일하는 중 상태 줄이 있는지. */
export function looksWorking(lines: string[]): boolean {
  return lines.some(isWorkingLine);
}

// 선택된 메뉴 항목 — 줄 앞의 상자 테두리(│)는 건너뛴다(Gemini는 확인 창을 상자 안에 그린다).
const MENU_RE = /^\s*(?:│\s*)?([❯›●])\s*\d+\.\s+\S/u;
const HINT_RE = /\b(?:esc to (?:cancel|exit|skip)|enter to (?:select|confirm)|esc skip)\b|\(esc\)/i;
const RULE_RE = /^─{10,}\s*$/;
const CLAUDE_INPUT_RE = /^❯(?:\s|$)/;
const CODEX_INPUT_RE = /^›\s(?!\s*\d+\.\s)/;
const GEMINI_INPUT_RE = /Type your message or @path\/to\/file|^\s*(?:│\s*)?>\s/;
const GEMINI_FOOTER_RE = /\(\d+% (?:used|context left)\)/;

const MARK_AGENT: Record<string, AgentKind> = { "❯": "claude", "›": "codex", "●": "gemini" };

/** 맨 아래의 번호 메뉴 + 키 안내 → 입력 기다림. 어느 에이전트인지는 선택 표시로 안다. */
function blockedAgent(rows: string[]): AgentKind | null {
  const n = rows.length;
  for (let i = n - 1; i >= Math.max(0, n - 16); i--) {
    const m = MENU_RE.exec(rows[i]);
    if (!m) continue;
    // 안내 줄은 메뉴와 같거나 아래, 그리고 화면 맨 아래 가까이(꼬리말 몇 줄만 허용).
    for (let j = i; j < n; j++) {
      if (HINT_RE.test(rows[j]) && n - 1 - j <= 5) return MARK_AGENT[m[1]];
    }
    return null;
  }
  return null;
}

/** Claude 입력 상자(테두리 / ❯ / 테두리)가 맨 아래에 있는지. */
function claudePresent(rows: string[]): boolean {
  const n = rows.length;
  for (let b = n - 1; b >= Math.max(0, n - 8); b--) {
    if (!RULE_RE.test(rows[b])) continue;
    // 아래 테두리 위로 입력 줄(여러 줄 입력 허용)과 위 테두리.
    for (let t = b - 2; t >= Math.max(0, b - 14); t--) {
      if (RULE_RE.test(rows[t])) return CLAUDE_INPUT_RE.test(rows[t + 1]);
    }
    return false;
  }
  return false;
}

/** Codex 입력 줄(› …)이 맨 아래 가까이에 있는지. */
function codexPresent(rows: string[]): boolean {
  const n = rows.length;
  for (let i = n - 1; i >= Math.max(0, n - 6); i--) {
    if (CODEX_INPUT_RE.test(rows[i])) return true;
  }
  return false;
}

/** Gemini 입력란이나 사용량 꼬리말이 맨 아래 가까이에 있는지. */
function geminiPresent(rows: string[]): boolean {
  const n = rows.length;
  const near = rows.slice(Math.max(0, n - 5));
  return near.some((l) => GEMINI_FOOTER_RE.test(l)) || near.some((l) => GEMINI_INPUT_RE.test(l) && /Type your message/.test(l));
}

/** 보이는 화면에서 에이전트와 그 상태를 읽는다. 에이전트가 없으면 null.
 *  우선순위: 입력 기다림 > 일하는 중 > 쉬는 중. */
export function scanAgent(lines: string[]): AgentScan | null {
  // 빈 줄은 빼고 본다 — 화면 높이·여백과 상관없이 "맨 아래에서 몇 줄"로 판정한다.
  const rows = lines.map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  if (rows.length === 0) return null;

  const blocked = blockedAgent(rows);
  if (blocked) return { agent: blocked, state: "blocked" };

  const last = (k: number) => rows.slice(Math.max(0, rows.length - k));
  // Claude는 상태 줄 아래에 할 일 목록이 길게 붙을 수 있어 화면 전체를 본다(입력 상자가 있을 때만).
  const claude = claudePresent(rows);
  if (claude && rows.some((l) => CLAUDE_RE.test(l))) return { agent: "claude", state: "working" };
  // 예전 Claude 상태 줄(`✻ Thinking… (… esc to interrupt)`)도 Codex 꼴로 끝나니 걸러 낸다.
  const codex = codexPresent(rows);
  if (codex && last(12).some((l) => CODEX_WORK_RE.test(l) && !CLAUDE_RE.test(l))) {
    return { agent: "codex", state: "working" };
  }
  if (last(8).some((l) => GEMINI_WORK_RE.test(l))) return { agent: "gemini", state: "working" };

  if (claude) return { agent: "claude", state: "idle" };
  if (codex) return { agent: "codex", state: "idle" };
  if (geminiPresent(rows)) return { agent: "gemini", state: "idle" };
  return null;
}
