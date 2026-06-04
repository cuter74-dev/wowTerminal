// 세션 로깅 (#65). 터미널 출력에서 ANSI/제어 시퀀스를 제거해 로그 파일에 누적한다.
// 실제 파일 쓰기는 Rust `session_log_append`가 담당(append 모드, 디렉터리 자동 생성).
// 정규식은 RegExp 생성자 + \x 이스케이프로 작성해 소스에 raw 제어문자가 들어가지 않게 한다.

import { invoke } from "@tauri-apps/api/core";

// OSC 시퀀스: ESC ] ... 종료는 BEL(\x07) 또는 ST(ESC \).
const OSC = new RegExp("\x1b\\][\\s\\S]*?(?:\x07|\x1b\\\\)", "g");
// CSI 시퀀스: ESC [ 파라미터 중간문자 final.
const CSI = new RegExp("\x1b\\[[0-9;?]*[ -/]*[@-~]", "g");
// 그 외 이스케이프: ESC + 중간문자 + 한 글자(charset 지정/키패드 모드 등).
const ESC_OTHER = new RegExp("\x1b[ -/]*[0-9A-Za-z=><]", "g");
// 개행(LF)·탭(HT)을 제외한 C0 제어문자 + DEL. ESC/CR/BEL 잔여분도 함께 제거.
const CTRL = new RegExp("[\x00-\x08\x0b-\x1f\x7f]", "g");

/** ANSI 이스케이프·OSC·기타 제어문자를 제거하되 개행/탭은 보존. */
export function stripAnsi(s: string): string {
  return s
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(ESC_OTHER, "")
    .replace(CTRL, "");
}

export class SessionLogger {
  private buf = "";
  private filename: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private decoder = new TextDecoder();
  private disposed = false;

  constructor(
    private dir: string,
    label: string,
  ) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
      d.getHours(),
    )}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const safe = label.replace(/[^A-Za-z0-9._-]/g, "-");
    this.filename = `${safe}-${ts}.log`;
  }

  append(bytes: Uint8Array): void {
    if (this.disposed) return;
    this.buf += stripAnsi(this.decoder.decode(bytes, { stream: true }));
    // 16KB 넘으면 즉시, 아니면 1.5초 디바운스로 묶어서 기록.
    if (this.buf.length > 16384) void this.flush();
    else this.schedule();
  }

  private schedule(): void {
    if (this.timer != null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 1500);
  }

  async flush(): Promise<void> {
    if (!this.buf) return;
    const content = this.buf;
    this.buf = "";
    try {
      await invoke("session_log_append", {
        dir: this.dir,
        name: this.filename,
        content,
      });
    } catch {
      // 로깅 실패는 조용히 무시(터미널 동작에 영향 주지 않음).
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.flush();
  }
}
