// 첫 실행 온보딩 완료 플래그 (S-002~004). 시크릿 아님 → localStorage.

const KEY = "wowterminal-onboarded";

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // 스토리지 불가 환경에선 온보딩 생략
  }
}

export function setOnboarded(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* 무시 */
  }
}
