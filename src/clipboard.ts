// 클립보드 읽기·쓰기 (#186). 웹뷰는 사용자 동작 밖의 쓰기(OSC 52 등)나 권한 없는 접근을
// NotAllowedError로 거부하고, 보안 컨텍스트가 아니면 navigator.clipboard 자체가 없다.
// 맨 navigator.clipboard 호출은 그 거부가 처리 안 된 오류로 남으니 이 함수들을 쓴다.
import { writeText as nativeWriteText } from "@tauri-apps/plugin-clipboard-manager";

/** 클립보드에 쓴다. 웹뷰가 거부하면 네이티브 클립보드(Tauri 플러그인)로 쓴다 — macOS WebKit은
 *  키 입력 밖에서 온 OSC 52(tmux·vim·Claude Code 복사)를 거부해 복사가 실제로 되지 않았다.
 *  둘 다 안 되면 false. 거부를 밖으로 던지지 않는다. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      await nativeWriteText(text);
      return true;
    } catch {
      return false;
    }
  }
}

/** 클립보드 글자를 읽는다. 거부되거나 읽을 수 없으면 빈 문자열.
 *  (읽기는 네이티브로 우회하지 않는다 — 사용자가 WebKit 붙여넣기 확인을 닫은 것을 존중한다.) */
export async function readClipboard(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()) ?? "";
  } catch {
    return "";
  }
}

/** 클립보드의 이미지(#192, SSH 탭 붙여넣기). 없거나 읽을 수 없으면 null. Ctrl+V(Windows·Linux)·
 *  우클릭 붙여넣기처럼 paste 이벤트 없이 읽을 때 쓴다(⌘V는 paste 이벤트로 받는다). */
export async function readClipboardImage(): Promise<Blob | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return await item.getType(type);
    }
  } catch {
    /* 권한 없음·지원 안 함 */
  }
  return null;
}
