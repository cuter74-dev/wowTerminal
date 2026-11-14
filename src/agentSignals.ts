// 에이전트·프로그램이 터미널로 보내는 표준 신호 해석 (#189). 화면 글자 판정(aiActivity.ts)을 보완한다.
// - OSC 7501 Program Status: Claude Code 2.1.295부터. `state=working|blocked|done|idle|error|clear`
//   `:app=claude-code[:id=…][:kind=permission|question|auth][:progress=N][:title=b64][:msg=b64]`.
//   터미널이 `OSC 7501 ; ?` 질의에 `?`로 시작하는 답을 해야 보내기 시작한다. tmux 안에서는 tmux에게
//   물어 보내지 않으므로(공식 문서) 그때는 화면 판정이 계속 쓰인다.
// - OSC 9: 숫자;로 시작하면 ConEmu 명령(9;4 = 진행률), 아니면 iTerm2식 알림 글.
// - OSC 777: `notify;제목;본문`(rxvt·Ghostty·foot).
// - OSC 99: kitty 알림 — `메타;내용`, 메타의 p=title|body, d=0이면 이어지는 조각, e=1이면 base64.
import type { AgentKind, AgentScan } from "./aiActivity";

export type ProgramStatus = {
  app: string;
  id?: string;
  state: "working" | "blocked" | "done" | "idle" | "error" | "clear";
  kind?: string;
  progress?: number;
};

const STATES = new Set(["working", "blocked", "done", "idle", "error", "clear"]);

/** OSC 7501 내용. 지원 여부 질의면 "probe". 모르는 꼴이면 null. */
export function parseProgramStatus(payload: string): ProgramStatus | "probe" | null {
  if (payload.startsWith("?")) return "probe";
  const f: Record<string, string> = {};
  for (const part of payload.split(":")) {
    const eq = part.indexOf("=");
    if (eq > 0) f[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (!STATES.has(f.state)) return null;
  const progress = f.progress !== undefined ? Number(f.progress) : undefined;
  return {
    app: f.app ?? "",
    ...(f.id ? { id: f.id } : {}),
    state: f.state as ProgramStatus["state"],
    ...(f.kind ? { kind: f.kind } : {}),
    ...(progress !== undefined && Number.isFinite(progress) ? { progress: Math.max(0, Math.min(100, progress)) } : {}),
  };
}

const APP_AGENT: Record<string, AgentKind> = {
  "claude-code": "claude",
  claude: "claude",
  codex: "codex",
  "gemini-cli": "gemini",
  gemini: "gemini",
};

/** 상태 보고를 에이전트 목록 상태로. `clear`(끝남)이거나 모르는 앱이면 null. done·error는 쉬는 중 —
 *  일하는 중 다음에 오면 App이 "끝남"으로 보인다. */
export function programStatusToScan(s: ProgramStatus): AgentScan | null {
  const agent = APP_AGENT[s.app];
  if (!agent || s.state === "clear") return null;
  if (s.state === "working") return { agent, state: "working" };
  if (s.state === "blocked") return { agent, state: "blocked" };
  return { agent, state: "idle" };
}

export type Notice = { title?: string; body: string };
export type Progress = { state: number; value: number | null };

/** OSC 9. ConEmu 진행률(9;4;상태;값)이면 progress, 다른 ConEmu 명령(9;9 cwd 등)은 null, 그 밖은 알림 글. */
export function parseOsc9(payload: string): { progress: Progress } | { notice: Notice } | null {
  const m = /^(\d+);(.*)$/s.exec(payload);
  if (m) {
    if (m[1] !== "4") return null;
    const [st, val] = m[2].split(";");
    const state = Number(st);
    if (!Number.isInteger(state)) return null;
    const v = val !== undefined && val !== "" ? Number(val) : NaN;
    return { progress: { state, value: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null } };
  }
  const body = payload.trim();
  return body ? { notice: { body } } : null;
}

/** OSC 777 `notify;제목;본문`. 다른 777 하위 명령은 null. */
export function parseOsc777(payload: string): Notice | null {
  const [cmd, title, ...rest] = payload.split(";");
  if (cmd !== "notify") return null;
  const body = rest.join(";").trim();
  const t = (title ?? "").trim();
  if (!body && !t) return null;
  return body ? { ...(t ? { title: t } : {}), body } : { body: t };
}

function b64utf8(s: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

/** OSC 99(kitty) 조각을 모아 알림 하나로. 알림이 완성되면 돌려준다. */
export class Osc99Collector {
  private parts = new Map<string, { title: string; body: string }>();
  feed(payload: string): Notice | null {
    const semi = payload.indexOf(";");
    const meta = semi >= 0 ? payload.slice(0, semi) : "";
    let text = semi >= 0 ? payload.slice(semi + 1) : payload;
    const m: Record<string, string> = {};
    for (const kv of meta.split(":")) {
      const eq = kv.indexOf("=");
      if (eq > 0) m[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    if (m.p && m.p !== "title" && m.p !== "body") return null; // 아이콘·버튼 등은 무시
    if (m.e === "1") text = b64utf8(text);
    const id = m.i ?? "";
    const cur = this.parts.get(id) ?? { title: "", body: "" };
    if (m.p === "body") cur.body += text;
    else cur.title += text; // p가 없으면 제목(kitty 규약)
    if (m.d === "0") {
      this.parts.set(id, cur);
      return null;
    }
    this.parts.delete(id);
    const title = cur.title.trim();
    const body = cur.body.trim();
    if (!title && !body) return null;
    return body ? { ...(title ? { title } : {}), body } : { body: title };
  }
}
