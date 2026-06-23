// 모바일 온스크린 키바(#114)용 Ctrl 스티키 모디파이어. 키바의 "Ctrl"을 누르면 켜지고,
// 다음에 소프트 키보드로 친 글자 1개가 Ctrl 조합으로 전송된 뒤 자동으로 꺼진다.
// Terminal.tsx의 keydown 핸들러가 이 플래그를 확인한다.

let ctrlPending = false;
const listeners = new Set<(v: boolean) => void>();

export const mobileCtrl = {
  get: () => ctrlPending,
  toggle() {
    ctrlPending = !ctrlPending;
    listeners.forEach((l) => l(ctrlPending));
  },
  clear() {
    if (ctrlPending) {
      ctrlPending = false;
      listeners.forEach((l) => l(false));
    }
  },
  subscribe(l: (v: boolean) => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** 영문자/일부 기호를 Ctrl 제어문자로 변환. 변환 불가면 null. */
export function ctrlSeq(key: string): string | null {
  if (key.length !== 1) return null;
  const c = key.toUpperCase().charCodeAt(0);
  if (c >= 64 && c <= 95) return String.fromCharCode(c - 64); // @A-Z[\]^_ → 0x00–0x1f
  if (key >= "a" && key <= "z") return String.fromCharCode(key.charCodeAt(0) - 96);
  return null;
}
