// 고유 id 발급 (#186). crypto.randomUUID는 보안 컨텍스트·최신 엔진에만 있어서, 없는 웹뷰에서
// 바로 부르면 "crypto.randomUUID is not a function"으로 호스트 저장 같은 동작이 실패했다.
// getRandomValues(어디서나 있음)로 UUID v4를 만들고, 그것도 없으면 Math.random으로 만든다.

function uuidFromBytes(b: Uint8Array): string {
  b[6] = (b[6] & 0x0f) | 0x40; // 버전 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 변형
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function newId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") return uuidFromBytes(c.getRandomValues(new Uint8Array(16)));
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
