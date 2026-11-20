// 삭제 같은 되돌릴 수 없는 일 앞의 확인 창 (#195).
// window.confirm은 쓰지 않는다 — dialog 플러그인(2.7.1)이 Android를 뺀 모든 플랫폼에서 window.confirm을
// 이제 없는 명령(plugin:dialog|confirm)을 부르는 비동기 함수로 바꿔 넣는다. 그래서 `if (!confirm(…))`은
// Promise(참)를 받아 묻지 않고 지나갔고, 거부는 처리 안 된 오류로 남았다. 플러그인의 confirm()은 허용된
// message 명령으로 네이티브 확인 창을 띄운다.
import { confirm } from "@tauri-apps/plugin-dialog";

/** 확인 창을 띄워 "확인"을 눌렀을 때만 true. 창을 띄우지 못하면 false — 묻지 못했으면 하지 않는다. */
export async function askConfirm(message: string): Promise<boolean> {
  try {
    return await confirm(message, { kind: "warning" });
  } catch {
    return false;
  }
}
