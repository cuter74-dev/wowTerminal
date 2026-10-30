// 편집 탭 저장소(#166) 회귀 테스트 — 백엔드 명령은 목으로 응답하고, 저장·충돌·미저장 확인·
// 바깥 변경 감지·SFTP 재연결이 의도대로 명령을 보내는지 본다.
import { beforeEach, describe, expect, it } from "vitest";
import { invokeLog, setInvokeHandler } from "./test/tauriMock";
import * as fd from "./fileDocs";

type Args = Record<string, unknown> | undefined;
const stamp = { size: 4, mtime: 100, hash: "h1" };
function opened(content: string, extra: Partial<fd.Opened> = {}): fd.Opened {
  return {
    real_path: "/srv/a.conf",
    content,
    editable: true,
    reason: null,
    eol: "lf",
    bom: false,
    image: null,
    stamp,
    size: content.length,
    mode: 0o100644,
    ...extra,
  };
}
/** 편집기 대역: 텍스트를 들고 있고, 바꾸면 dirty를 알린다. */
function fakeEditor(id: string, text: string) {
  let t = text;
  fd.registerEditor(id, { getText: () => t, replaceAll: (x) => (t = x), focus() {} });
  return {
    type(x: string) {
      t = x;
      fd.setDirty(id, true);
    },
    get: () => t,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

async function openReady(content: string, extra: Partial<fd.Opened> = {}) {
  const calls: { cmd: string; args: Args }[] = [];
  let respond = (cmd: string, _args: Args): unknown => {
    if (cmd === "file_open") return opened(content, extra);
    return null;
  };
  setInvokeHandler(async (cmd, args) => {
    calls.push({ cmd, args });
    return respond(cmd, args);
  });
  const id = fd.openDoc("h", "/srv/a.conf");
  await flush();
  return { id, calls, setRespond: (f: typeof respond) => (respond = f) };
}

beforeEach(() => {
  for (const d of fd.getDocs()) fd.closeDoc(d.id);
  setInvokeHandler(null);
  fd.setUnsavedPrompt(null);
  invokeLog.length = 0;
});

describe("saveDoc", () => {
  it("CRLF 파일은 CRLF로, BOM·열 때 Stamp·실제 경로를 함께 보낸다", async () => {
    const { id, calls, setRespond } = await openReady("a\r\nb\r\n", { eol: "crlf", bom: true });
    expect(fd.getDoc(id)?.base).toBe("a\nb\n"); // 편집기와 같은 LF 기준
    const ed = fakeEditor(id, "a\nb\n");
    ed.type("a\nB\n");
    setRespond((cmd) =>
      cmd === "file_save"
        ? { kind: "saved", stamp: { size: 7, mtime: 200, hash: "h2" }, method: "atomic" }
        : null,
    );
    expect(await fd.saveDoc(id)).toBe("saved");
    const save = calls.find((c) => c.cmd === "file_save")!.args!;
    expect(save.content).toBe("a\r\nB\r\n");
    expect(save.bom).toBe(true);
    expect(save.path).toBe("/srv/a.conf");
    expect(save.expect).toEqual(stamp);
    expect(save.force).toBe(false);
    const d = fd.getDoc(id)!;
    expect(d.dirty).toBe(false);
    expect(d.opened?.stamp.hash).toBe("h2");
    expect(d.base).toBe("a\nB\n");
  });

  it("변경이 없으면 저장하지 않는다(⌘S를 습관처럼 눌러도 파일을 다시 쓰지 않음)", async () => {
    const { id, calls } = await openReady("x\n");
    fakeEditor(id, "x\n");
    expect(await fd.saveDoc(id)).toBe("noop");
    expect(calls.some((c) => c.cmd === "file_save")).toBe(false);
  });

  it("충돌이면 쓰지 않고 표시하며, 덮어쓰기는 force로 보낸다", async () => {
    const { id, calls, setRespond } = await openReady("x\n");
    const ed = fakeEditor(id, "x\n");
    ed.type("y\n");
    setRespond((cmd) => (cmd === "file_save" ? { kind: "conflict", current: { ...stamp, hash: "other" } } : null));
    expect(await fd.saveDoc(id)).toBe("conflict");
    expect(fd.getDoc(id)?.conflict?.current?.hash).toBe("other");
    expect(fd.getDoc(id)?.dirty).toBe(true);
    setRespond((cmd) => (cmd === "file_save" ? { kind: "saved", stamp, method: "direct_owner" } : null));
    expect(await fd.saveDoc(id, true)).toBe("saved");
    expect(calls.filter((c) => c.cmd === "file_save").pop()!.args!.force).toBe(true);
    expect(fd.getDoc(id)?.conflict).toBeNull();
    expect(fd.getDoc(id)?.notice).toBe("direct_owner"); // 직접 쓰기는 띠로 알린다
  });

  it("읽기 전용 문서는 저장 명령을 보내지 않는다", async () => {
    const { id, calls } = await openReady("x\n", { editable: false, reason: "no_permission" });
    const ed = fakeEditor(id, "x\n");
    ed.type("y\n");
    expect(await fd.saveDoc(id, true)).toBe("noop");
    expect(calls.some((c) => c.cmd === "file_save")).toBe(false);
  });
});

describe("guardUnsaved", () => {
  it("저장 안 한 문서가 없으면 묻지 않고 통과", async () => {
    let asked = false;
    fd.setUnsavedPrompt(async () => {
      asked = true;
      return "cancel";
    });
    expect(await fd.guardUnsaved("quit")).toBe(true);
    expect(asked).toBe(false);
  });

  it("취소면 멈추고, 저장 안 함이면 통과, 저장이면 모두 저장 후 통과", async () => {
    const { id, setRespond } = await openReady("x\n");
    const ed = fakeEditor(id, "x\n");
    ed.type("y\n");
    let choice: fd.UnsavedChoice = "cancel";
    fd.setUnsavedPrompt(async (docs, reason) => {
      expect(docs.map((d) => d.id)).toEqual([id]);
      expect(reason).toBe("close_window");
      return choice;
    });
    expect(await fd.guardUnsaved("close_window")).toBe(false);
    choice = "discard";
    expect(await fd.guardUnsaved("close_window")).toBe(true);
    choice = "save";
    setRespond((cmd) => (cmd === "file_save" ? { kind: "saved", stamp, method: "atomic" } : null));
    expect(await fd.guardUnsaved("close_window")).toBe(true);
    expect(fd.getDoc(id)?.dirty).toBe(false);
  });

  it("일괄 저장 중 충돌이 나면 멈추고 그 문서를 알린다", async () => {
    const { id, setRespond } = await openReady("x\n");
    fakeEditor(id, "x\n").type("y\n");
    fd.setUnsavedPrompt(async () => "save");
    setRespond((cmd) => (cmd === "file_save" ? { kind: "conflict", current: null } : null));
    let stopped: string | null = null;
    const un = fd.onSaveAllStopped((d) => (stopped = d));
    expect(await fd.guardUnsaved("update")).toBe(false);
    expect(stopped).toBe(id);
    un();
  });
});

describe("checkExternal", () => {
  it("내 수정이 없으면 조용히 다시 읽고, 있으면 ⚠만 표시한다", async () => {
    const { id, setRespond } = await openReady("x\n");
    const ed = fakeEditor(id, "x\n");
    setRespond((cmd) =>
      cmd === "file_stamp" ? { ...stamp, mtime: 999 } : cmd === "file_open" ? opened("server\n") : null,
    );
    await fd.checkExternal(id);
    expect(ed.get()).toBe("server\n");
    expect(fd.getDoc(id)?.reloadedAt).toBeGreaterThan(0);

    ed.type("mine\n");
    setRespond((cmd) => (cmd === "file_stamp" ? { ...stamp, mtime: 1234 } : null));
    await fd.checkExternal(id);
    expect(ed.get()).toBe("mine\n");
    expect(fd.getDoc(id)?.externalChange).toBe(true);
  });
});

describe("withSftp / openDoc", () => {
  it("SFTP 연결이 없으면 한 번 연결하고 다시 시도한다", async () => {
    let first = true;
    const seen: string[] = [];
    setInvokeHandler(async (cmd) => {
      seen.push(cmd);
      if (cmd === "file_open" && first) {
        first = false;
        throw "session not found: h";
      }
      if (cmd === "file_open") return opened("ok\n");
      return null;
    });
    const id = fd.openDoc("h", "/srv/a.conf");
    await flush();
    await flush();
    expect(seen).toEqual(["file_open", "sftp_open", "file_open"]);
    expect(fd.getDoc(id)?.state).toBe("ready");
  });

  it("같은 경로는 같은 탭, 링크로 연 같은 실제 파일은 기존 탭으로 합친다", async () => {
    const { id } = await openReady("x\n");
    expect(fd.openDoc("h", "/srv/a.conf")).toBe(id);
    let redirected: [string, string] | null = null;
    const un = fd.onDocRedirect((from, to) => (redirected = [from, to]));
    const link = fd.openDoc("h", "/srv/link.conf"); // file_open이 같은 real_path를 돌려준다
    await flush();
    expect(redirected).toEqual([link, id]);
    expect(fd.getDoc(link)).toBeUndefined();
    un();
  });
});

describe("표시 도우미", () => {
  it("제어·방향 문자를 보이게 바꾸고, 경로는 필요할 때만 따옴표", () => {
    expect(fd.displayName("a\nb")).toBe("a\\x0ab");
    expect(fd.displayName("evil\u202Etxt.exe")).toBe("evil⟨U+202E⟩txt.exe");
    expect(fd.shellQuote("/etc/nginx/a.conf")).toBe("/etc/nginx/a.conf");
    expect(fd.shellQuote("/tmp/it's here")).toBe(`'/tmp/it'\\''s here'`);
    expect(fd.joinPath("/", "etc")).toBe("/etc");
    expect(fd.joinPath("C:\\Users", "me")).toBe("C:\\Users\\me");
    expect(fd.parentPath("/etc/nginx")).toBe("/etc");
    expect(fd.parentPath("/etc")).toBe("/");
    expect(fd.parentPath("C:\\Users")).toBe("C:\\");
  });
});
