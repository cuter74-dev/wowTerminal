// 공용 id 발급 (#186): Android WebView 90처럼 crypto.randomUUID가 없는 웹뷰에서도 동작해야 한다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./ids";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("newId (#186)", () => {
  it("randomUUID가 있으면 그것을 쓴다", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-from-runtime", getRandomValues: () => new Uint8Array(16) });
    expect(newId()).toBe("uuid-from-runtime");
  });

  it("randomUUID가 없으면 getRandomValues로 UUID v4를 만든다", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it("crypto가 아예 없어도 던지지 않고 id를 준다", () => {
    vi.stubGlobal("crypto", undefined);
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });
});
