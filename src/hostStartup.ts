// SSH 접속 직후 셸에 보낼 입력 (#89 tmux 자동 attach + #191 접속 후 시작 명령).

/** POSIX 셸 작은따옴표 인용. 작은따옴표는 '\'' 로 바꾼다. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 호스트의 tmux 세션 이름(이미 안전한 글자로 거른 것)과 시작 명령으로 접속 직후 입력을 만든다.
 * 보낼 것이 없으면 null.
 * - tmux만: `tmux new-session -A -s 이름`(있으면 붙고, 없으면 만든다).
 * - tmux + 시작 명령: 세션이 **새로 생길 때만** 그 안의 셸에 시작 명령을 입력하고 붙는다 —
 *   이미 있던 세션(돌고 있는 Claude Code 등)에는 아무것도 입력하지 않는다. send-keys -l로 글자
 *   그대로 보내 대화형 셸(rc가 읽힌 PATH)에서 실행되게 한다.
 * - 시작 명령만: 셸에 그대로 입력한다.
 */
export function connectInput(tmuxName: string, startup: string): string | null {
  const cmd = startup.replace(/[\r\n]+/g, " ").trim();
  if (tmuxName) {
    const t = `'${tmuxName}'`;
    if (!cmd) return `tmux new-session -A -s ${t}\r`;
    const exact = `'=${tmuxName}'`;
    const pane = `'=${tmuxName}:'`;
    return (
      `tmux has-session -t ${exact} 2>/dev/null || { tmux new-session -d -s ${t} && ` +
      `tmux send-keys -t ${pane} -l ${shQuote(cmd)} && tmux send-keys -t ${pane} Enter; }; ` +
      `tmux attach-session -t ${exact}\r`
    );
  }
  return cmd ? `${cmd}\r` : null;
}
