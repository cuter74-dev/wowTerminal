// 자주 쓰는 명령 스니펫 (#58). localStorage에 저장, 명령 팔레트·설정에서 사용.

export interface Snippet {
  id: string;
  name: string;
  command: string;
}

const KEY = "wt.snippets";

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Snippet[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveSnippets(list: Snippet[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}
