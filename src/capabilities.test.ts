// 권한(capabilities) 회귀 가드 (#169). 프런트가 Tauri API를 쓰는데 그 API의 권한이
// src-tauri/capabilities/default.json에 없으면, 호출이 ACL에서 조용히 거부된다 — 0.21.0에서
// onCloseRequested를 넣고 destroy 권한을 빠뜨려 창 닫기(X)가 아예 동작하지 않았다.
// (JS close-requested 리스너가 있으면 Tauri가 기본 닫기를 막고, 래퍼가 window.destroy()로 닫는다.)
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const caps: string[] = JSON.parse(
  readFileSync(join(root, "src-tauri/capabilities/default.json"), "utf8"),
).permissions;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [readFileSync(p, "utf8")] : [];
  });
}
const code = sources(join(root, "src")).join("\n");
const has = (...perms: string[]) => perms.some((p) => caps.includes(p));

/** [코드에서 찾을 패턴, 필요한 권한(하나라도 있으면 됨), 설명] */
const RULES: [RegExp, string[], string][] = [
  [/onCloseRequested\(/, ["core:window:allow-destroy"], "onCloseRequested는 닫을 때 window.destroy()를 부른다"],
  [/\bme\.destroy\(|getCurrentWindow\(\)\.destroy\(/, ["core:window:allow-destroy"], "창 destroy"],
  [/getCurrentWindow\(\)\.close\(/, ["core:window:allow-close"], "창 close"],
  [/\.setFocus\(/, ["core:window:allow-set-focus"], "창 setFocus"],
  [/from "@tauri-apps\/plugin-process"/, ["process:default", "process:allow-exit"], "앱 종료·재시작"],
];

describe("capabilities (#169)", () => {
  for (const [pattern, perms, why] of RULES) {
    it(`${why} → ${perms.join(" | ")}`, () => {
      if (!pattern.test(code)) return; // 쓰지 않으면 권한도 필요 없다
      expect(has(...perms), `${why}: capabilities에 ${perms.join(" 또는 ")} 필요`).toBe(true);
    });
  }
});
