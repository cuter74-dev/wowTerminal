import { describe, expect, it } from "vitest";
import { toFileEol } from "./eol";

describe("toFileEol (#165)", () => {
  it("CRLF 파일: textarea가 LF로 바꾼 텍스트를 CRLF로 되돌린다", () => {
    expect(toFileEol("a\nb\n", "crlf")).toBe("a\r\nb\r\n");
  });
  it("CRLF 파일: 이미 CRLF인 텍스트는 그대로(CR이 두 번 붙지 않음)", () => {
    expect(toFileEol("a\r\nb", "crlf")).toBe("a\r\nb");
  });
  it("LF 파일: 그대로", () => {
    expect(toFileEol("a\nb\n", "lf")).toBe("a\nb\n");
  });
  it("수정 후 원래대로 되돌리면 원본과 같아 변경 없음으로 본다", () => {
    const original = "x\r\ny\r\n";
    const editedBack = "x\ny\n"; // textarea 값
    expect(toFileEol(editedBack, "crlf")).toBe(original);
  });
});
