// AI 대화 세션 영속화 (S-049). localStorage 기반 — 대화는 시크릿이 아니고 윈도우 간
// 공유할 필요도 적어 가볍게 브라우저 스토리지에 둔다.

import { ChatMessage } from "./types";

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  backendId: string | null;
  updatedAt: number;
}

const KEY = "wowterminal-chat-sessions";

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ChatSession[];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    /* 용량 초과 등 — 무시 */
  }
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 첫 user 메시지로 세션 제목 생성 (최대 30자). */
export function titleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "새 대화";
  const t = firstUser.content.trim().replace(/\s+/g, " ");
  return t.length > 30 ? t.slice(0, 30) + "…" : t || "새 대화";
}
