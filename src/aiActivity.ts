// AI 에이전트가 일하는 중인지 화면으로 판정한다 (#180).
// 에이전트는 일하는 동안 상태 줄을 띄운다. 보이는 화면에 그 줄이 있으면 일하는 중이다 —
// hook·프로세스 조회 없이 tmux 안과 SSH에서도 된다.
// - Claude Code(2.1.x 실측): `· Meandering…`, `✳ Wrangling… (2s · ↓ 229 tokens · …)` — 회전 글리프
//   ·✢✳✶✻✽(유니코드가 없으면 *) + 문구 + "…". 끝나면 `✻ Baked for 1s · done 3:44 PM`처럼 "…"가 없다.
// - Codex(0.167 실측): `• Working (2s • esc to interrupt)`.
// - Gemini CLI: `⠋ … (esc to cancel, 3s)`.
// 평범한 글(대화 내용에 같은 낱말이 나오는 경우)에 걸리지 않게 상태 줄 모양 그대로만 본다.
const CLAUDE_RE = /^\s*[·✢✳✶✻✽*]\s+\S.*…(?:\s*\([^()]*\))?\s*$/u;
const ESC_RE = /(?:\besc to interrupt(?:\s*[·•][^()]*)?\)|\(esc to cancel,\s*[0-9hms ]+\))\s*$/i;

/** 화면 줄 하나가 에이전트의 "일하는 중" 상태 줄인지. */
export function isWorkingLine(line: string): boolean {
  return CLAUDE_RE.test(line) || ESC_RE.test(line);
}

/** 화면 줄들 중 일하는 중 상태 줄이 있는지. */
export function looksWorking(lines: string[]): boolean {
  return lines.some(isWorkingLine);
}
