// 오류 추적 개인정보 걷어내기 시험 (#177).
import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { dropBreadcrumb, scrubEvent, scrubText } from "./telemetry";

describe("scrubText", () => {
  it.each([
    ["open /Users/alice/clients/acme/secret.txt failed", "open <path> failed"],
    ["read ~/projects/shop-web/.env: denied", "read <path>: denied"],
    ["cannot cd to /home/demo/app", "cannot cd to <path>"],
    ["C:\\Users\\bob\\Documents\\keys.txt missing", "<path> missing"],
    ["ssh deploy@web-01 refused", "ssh <user>@<host> refused"],
    ["ssh deploy@db.internal.corp refused", "ssh <email> refused"],
    ["connect 10.20.30.40:2222 timed out", "connect <ip> timed out"],
    ["mail alice.kim@example.com", "mail <email>"],
    ["POST https://llm.corp.local/v1/chat?key=abc 401", "POST https://<url> 401"],
  ])("%s", (input, want) => {
    expect(scrubText(input)).toBe(want);
  });

  it("평범한 메시지는 그대로 둔다", () => {
    expect(scrubText("session not found")).toBe("session not found");
    expect(scrubText("a / b and 3/4")).toBe("a / b and 3/4");
  });

  it("긴 글자는 자른다", () => {
    expect(scrubText("x".repeat(1000)).length).toBe(301);
  });
});

describe("scrubEvent", () => {
  it("breadcrumb·extra·사용자·서버 이름·요청 정보를 지우고 메시지를 가린다", () => {
    const ev = {
      type: undefined,
      message: "ssh demo@10.0.0.5 failed",
      server_name: "Alices-MacBook",
      user: { ip_address: "1.2.3.4" },
      extra: { lines: ["$ sudo -v", "Password: hunter2"] },
      breadcrumbs: [{ category: "console", message: "Password: hunter2" }],
      request: { url: "tauri://localhost/?q=1", headers: { "User-Agent": "UA", Cookie: "c" } },
      contexts: { os: { name: "macOS" }, state: { input: "hunter2" } },
      exception: { values: [{ type: "Error", value: "ENOENT /Users/alice/x/y" }] },
    } as unknown as ErrorEvent;
    const out = JSON.stringify(scrubEvent(ev));
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("Alices-MacBook");
    expect(out).not.toContain("10.0.0.5");
    expect(out).not.toContain("alice");
    expect(out).not.toContain("Cookie");
    expect(out).toContain('"os"');
    expect(out).toContain("<user>@<host> failed");
    expect(out).toContain("ENOENT <path>");
  });

  it("breadcrumb은 하나도 남기지 않는다", () => {
    expect(dropBreadcrumb({ category: "ui.click", message: "div.host-row" })).toBeNull();
  });
});
