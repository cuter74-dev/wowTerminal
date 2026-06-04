// 터미널 커맨드 블록 → AI 패널로 텍스트를 보내는 단순 단일 리스너 버스.
// (Terminal과 AIPanel은 형제 컴포넌트라 직접 prop 연결이 번거로워 모듈 버스로 연결.)

type AskListener = (block: string) => void;

let listener: AskListener | null = null;

/** AIPanel이 마운트 시 등록. 이전 리스너는 교체된다. */
export function setAskAIListener(cb: AskListener | null): void {
  listener = cb;
}

/** 터미널 블록(명령+출력)을 AI 패널로 보낸다. 리스너(AIPanel)가 없으면 무시. */
export function askAI(block: string): void {
  listener?.(block);
}
