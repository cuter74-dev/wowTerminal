// 합성 트레이스 빌더 (#158). 기존 인앱 self-test(src/inputSelfTest.ts)의 헬퍼가 보내던 이벤트
// 시퀀스를 **같은 순서·같은 간격**으로 TraceEvent 배열로 만든다. 실기기 녹화가 아니므로
// 이 트레이스들은 source: "synthetic"이다 — 우리가 가정한 순서만 검증한다.
import type { TraceEvent } from "../imeTrace";

export const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

export class TraceBuilder {
  readonly events: TraceEvent[] = [];
  private t = 0;
  /** 다음 이벤트가 관측될 textarea 값(직전 핸들러/기본 동작 이후 상태). */
  private value = "";

  private push(e: Omit<TraceEvent, "t" | "value"> & { value?: string }): void {
    this.events.push({ t: this.t, value: e.value ?? this.value, ...e } as TraceEvent);
  }

  sleep(ms: number): this {
    this.t += ms;
    return this;
  }

  /** typePlain: 통짜 insertText input 후 textarea를 비운다. */
  plain(text: string): this {
    this.push({ type: "input", data: text, inputType: "insertText", value: text });
    this.value = "";
    return this.sleep(60);
  }

  /** pressKey / pressCtrl. */
  key(key: string, keyCode: number, mods: { ctrl?: boolean } = {}): this {
    this.push({ type: "keydown", key, keyCode, ...mods });
    return this.sleep(40);
  }

  /** typeMirror: 값마다 keyCode 229 keydown(이전 값) → input(새 값). */
  mirror(values: string[]): this {
    for (const v of values) {
      this.push({ type: "keydown", key: "Process", keyCode: 229 });
      this.value = v;
      this.push({ type: "input" });
      this.sleep(20);
    }
    return this;
  }

  /** composeHangul: CS → CU → input(insertCompositionText) → CE, 이후 textarea 비움. */
  compose(syllable: string): this {
    this.push({ type: "compositionstart", data: "" });
    this.value = syllable;
    this.push({ type: "compositionupdate", data: syllable });
    this.push({ type: "input", data: syllable, inputType: "insertCompositionText" });
    this.push({ type: "compositionend", data: syllable });
    this.value = "";
    return this.sleep(80);
  }

  /** paste 이벤트. WebKit은 기본 동작으로 텍스트를 textarea에 남긴다(#97 잔류). */
  paste(text: string, residue: boolean): this {
    this.push({ type: "paste", clipboard: text });
    if (residue) this.value = text;
    return this.sleep(150);
  }

  /** 임의 이벤트(세밀한 시퀀스용). value를 주면 이후 관측 값도 그 값이 된다. */
  raw(e: Omit<TraceEvent, "t" | "value"> & { value?: string }): this {
    if (e.value !== undefined) this.value = e.value;
    this.push(e);
    return this;
  }

  setValue(v: string): this {
    this.value = v;
    return this;
  }

  get current(): string {
    return this.value;
  }
}
