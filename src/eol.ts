/**
 * 편집 텍스트의 줄끝 처리 (#165).
 *
 * 웹뷰 textarea는 값의 CRLF·CR을 모두 LF로 정규화한다. 그대로 저장하면 CRLF 파일이 LF로
 * 바뀌므로, 저장 직전에 파일의 원래 줄끝으로 되돌린다. 줄끝이 섞인 파일은 되돌릴 방법이
 * 없어 백엔드가 아예 읽기 전용으로 연다(textfile::classify의 "mixed_eol").
 */
export type Eol = "lf" | "crlf";

/** 편집기 텍스트를 파일의 줄끝 형식으로 바꾼다. 변경 여부 비교와 저장에 같은 값을 쓴다. */
export function toFileEol(text: string, eol: Eol): string {
  const lf = text.replace(/\r\n?/g, "\n");
  return eol === "crlf" ? lf.replace(/\n/g, "\r\n") : lf;
}
