/**
 * 화면 구석의 짧은 알림 (#166 — 다운로드 완료 "Finder에서 보기" 등). 파일 패널·편집 탭·App이
 * prop 없이 띄울 수 있게 모듈 수준 버스로 둔다(aiBus·commandBus와 같은 방식).
 */
import { useSyncExternalStore } from "react";

export type Toast = {
  id: number;
  text: string;
  kind: "info" | "ok" | "error";
  action?: { label: string; run: () => void };
};

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(t: Omit<Toast, "id">, ms = 5000): number {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { ...t, id }];
  emit();
  // 실패 알림은 사용자가 닫을 때까지 남긴다(SC-04).
  if (t.kind !== "error") setTimeout(() => dismissToast(id), ms);
  return id;
}
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
const get = () => toasts;
export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get,
    get,
  );
}
