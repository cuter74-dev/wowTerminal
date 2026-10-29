// 입력 트레이스 리플레이 하니스 (#158). 실제 <Terminal>을 happy-dom에 렌더하고(Tauri만 목),
// 트레이스의 이벤트를 숨은 textarea에 녹화 간격 그대로(가짜 타이머) 재생한 뒤 PTY로 간
// 바이트를 돌려준다. 프로덕션 코드는 건드리지 않는다 — 테스트 대상이 실제 입력 경로 그 자체다.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { Terminal } from "../components/Terminal";
import { DEFAULT_SETTINGS } from "../settings";
import { fromTraceEvent, type ImeTrace } from "../imeTrace";
import { invokeLog, osState, ptyWrites, resetTauriMock } from "./tauriMock";

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** 트레이스를 재생하고 PTY로 보내진 문자열(이어붙인 것)을 반환한다. */
export async function replayTrace(trace: ImeTrace): Promise<string> {
  resetTauriMock();
  localStorage.clear();
  // UA는 환경 지문(wt.ime.cmp.fp)과 녹화 정보용으로 그대로 재현한다.
  Object.defineProperty(navigator, "userAgent", {
    value: trace.userAgent,
    configurable: true,
  });
  // 미러 경로는 실제 OS로 정해진다(#161). platform이 없는 옛 트레이스는 UA에서 추정.
  osState.platform =
    trace.platform ??
    (/Mac/.test(trace.userAgent) ? "macos" : /Windows/.test(trace.userAgent) ? "windows" : "linux");
  if (trace.cmpLatched) {
    // 래치는 환경 지문이 맞아야 신뢰된다(#136) — 녹화 당시 "이미 B형으로 판정된" 상태 재현.
    localStorage.setItem("wt.ime.cmp", "1");
    localStorage.setItem("wt.ime.cmp.fp", `${__APP_VERSION__}|${trace.userAgent}`);
  }

  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <Terminal
          source={{ kind: "local" }}
          paneId="ime-replay"
          termSettings={DEFAULT_SETTINGS.terminal}
        />,
      );
    });
    // 스폰(invoke pty_spawn → sessionId 설정)이 끝나야 입력이 PTY로 나간다.
    for (let i = 0; i < 50 && !invokeLog.includes("pty_spawn"); i++) await advance(10);
    if (!invokeLog.includes("pty_spawn")) throw new Error("pty_spawn was never invoked");
    await advance(50);
    ptyWrites.length = 0; // 스폰 직후의 부수 전송은 재생 대상이 아니다.

    const ta = container.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
    if (!ta) throw new Error("xterm helper textarea not found");
    ta.focus();

    let prevT = trace.events[0]?.t ?? 0;
    for (const r of trace.events) {
      const dt = Math.max(0, r.t - prevT);
      prevT = r.t;
      if (dt > 0) await advance(dt);
      // 핸들러가 textarea.value를 읽으므로 디스패치 **전에** 녹화 당시 값을 적용한다.
      ta.value = r.value;
      const end = r.value.length;
      ta.setSelectionRange(r.selStart ?? end, r.selEnd ?? end);
      await act(async () => {
        ta.dispatchEvent(fromTraceEvent(r));
      });
    }
    // 지연 전송(setTimeout 0~80ms, writeChain 프로미스)이 모두 끝나도록 충분히 흘린다.
    await advance(1000);
    return ptyWrites.join("");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
}

/** 셸 라인 에디터를 아주 단순하게 흉내 내 "실행될 줄"들로 환원한다(사람이 읽는 기대값용).
 *  DEL(0x7f)=앞 글자 삭제, CR=줄 확정, Ctrl-U=줄 비우기, ESC 시퀀스·브래킷 페이스트 표식은 무시. */
export function resolveLines(pty: string): string[] {
  const lines: string[] = [];
  let cur: string[] = [];
  const s = pty.replace(/\x1b\[20[01]~/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "");
  for (const ch of s) {
    if (ch === "\x7f" || ch === "\b") cur.pop();
    else if (ch === "\r" || ch === "\n") {
      lines.push(cur.join(""));
      cur = [];
    } else if (ch === "\x15") cur = [];
    else if (ch >= " " || ch === "\t") cur.push(ch);
  }
  if (cur.length) lines.push(cur.join(""));
  return lines;
}
