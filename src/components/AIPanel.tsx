import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BackendInfo,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Tab,
  TerminalSource,
} from "../types";
import { LlmSetupModal } from "./LlmSetupModal";
import { getTerminal } from "../terminalRegistry";
import {
  ChatSession,
  loadSessions,
  newSessionId,
  saveSessions,
  titleFromMessages,
} from "../chatSessions";

interface Props {
  activeTab: Tab | null;
  focusedSource: TerminalSource | null;
  /** 포커스된 패널(leaf) id — 컨텍스트 추출/명령 주입 대상. */
  focusedPaneId: string | null;
  paneCount: number;
  /** 사이드바에서 호스트명 → 라벨 매핑이 가능하면 컨텍스트 표시에 사용. */
  contextLabel?: string;
  /** 활성 대화 세션 id가 바뀔 때 보고 (App이 탭별 보관 → 분리 시 새 창에 인계). */
  onActiveSession?: (sessionId: string | null) => void;
  /** 세션 인계: 있으면 mount 시 이 대화를 localStorage에서 복원 (분리된 새 창). */
  initialSessionId?: string;
}

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```(?:[a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = m[1].replace(/\n+$/, "");
    if (code.trim()) blocks.push(code);
  }
  return blocks;
}

/**
 * S-046/050 AI 채팅 패널.
 *
 * 다음 증분에서 추가될 것:
 * - 세션 컨텍스트 자동 첨부 (S-048)
 * - 응답에서 명령어 추출 → 카드 + "실행" 버튼 (S-047)
 * - 대화 이력/세션 전환 (S-049)
 * - 스트리밍 응답
 */
export function AIPanel({
  activeTab,
  focusedSource,
  focusedPaneId,
  paneCount,
  contextLabel,
  onActiveSession,
  initialSessionId,
}: Props) {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  function persistSession(sid: string, msgs: ChatMessage[]) {
    setSessions((prev) => {
      const sess: ChatSession = {
        id: sid,
        title: titleFromMessages(msgs),
        messages: msgs,
        backendId: currentId,
        updatedAt: Date.now(),
      };
      const next = prev.find((s) => s.id === sid)
        ? prev.map((s) => (s.id === sid ? sess : s))
        : [sess, ...prev];
      saveSessions(next);
      return next;
    });
  }

  function selectSession(id: string) {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    setActiveSessionId(id);
    setMessages(s.messages);
    if (s.backendId && backends.find((b) => b.id === s.backendId)) {
      setCurrentId(s.backendId);
    }
    setShowHistory(false);
  }

  function deleteSession(id: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSessions(next);
      return next;
    });
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }

  async function reload() {
    try {
      const list = await invoke<BackendInfo[]>("ai_list_backend_configs");
      setBackends(list);
      // 현재 선택이 사라졌으면 첫 번째로.
      if (list.length === 0) {
        setCurrentId(null);
      } else if (!list.find((b) => b.id === currentId)) {
        setCurrentId(list[0].id);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void reload();
    // 세션 인계: 분리된 새 창은 받은 sessionId로 대화를 localStorage에서 복원.
    if (initialSessionId) {
      const s = loadSessions().find((x) => x.id === initialSessionId);
      if (s) {
        setActiveSessionId(s.id);
        setMessages(s.messages);
        if (s.backendId) setCurrentId(s.backendId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 활성 대화 세션 id를 부모에 보고 → App이 탭별로 보관(분리 시 인계용).
  useEffect(() => {
    onActiveSession?.(activeSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  const current = useMemo(
    () => backends.find((b) => b.id === currentId) ?? null,
    [backends, currentId],
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || !current || busy) return;
    setError(null);
    setInput("");
    let sid = activeSessionId;
    if (!sid) {
      sid = newSessionId();
      setActiveSessionId(sid);
    }
    const userMsg: ChatMessage = { role: "user", content: text };
    // 화면에 표시할 메시지에는 컨텍스트를 넣지 않고, API 요청에만 system 메시지로 첨부.
    const display = [...messages, userMsg];
    setMessages(display);
    persistSession(sid, display);
    setBusy(true);

    const reqMessages: ChatMessage[] = [];
    if (includeContext) {
      const ctx = getTerminal(focusedPaneId)?.getRecentText(60);
      if (ctx) {
        const where = focusedSource
          ? focusedSource.kind === "ssh"
            ? `SSH 호스트: ${contextLabel ?? "원격"}`
            : "로컬 셸"
          : "터미널";
        reqMessages.push({
          role: "system",
          content:
            `너는 터미널 작업을 돕는 어시스턴트다. 사용자의 현재 ${where} 화면 출력은 다음과 같다. ` +
            `명령을 제안할 땐 \`\`\`로 감싼 코드블록으로 제시하라.\n\n--- 터미널 출력 ---\n${ctx}\n--- 끝 ---`,
        });
      }
    }
    reqMessages.push(...display);

    try {
      const req: ChatRequest = {
        model: current.defaultModel,
        messages: reqMessages,
      };
      const resp = await invoke<ChatResponse>("ai_complete", {
        backendId: current.id,
        request: req,
      });
      const final = [
        ...display,
        { role: "assistant" as const, content: resp.content },
      ];
      setMessages(final);
      persistSession(sid, final);
    } catch (e) {
      setError(String(e));
      const final = [
        ...display,
        { role: "assistant" as const, content: `[에러] ${String(e)}` },
      ];
      setMessages(final);
      persistSession(sid, final);
    } finally {
      setBusy(false);
    }
  }

  function runInTerminal(code: string) {
    const handle = getTerminal(focusedPaneId);
    if (!handle) {
      setError("입력할 터미널 패널이 없습니다.");
      return;
    }
    // 개행 없이 입력만 — 사용자가 직접 Enter로 실행하도록 (안전).
    handle.sendInput(code);
  }

  function newChat() {
    setMessages([]);
    setActiveSessionId(null);
    setError(null);
    setShowHistory(false);
  }

  const sourceCtx = activeTab
    ? focusedSource
      ? focusedSource.kind === "ssh"
        ? `SSH — ${contextLabel ?? activeTab.label}`
        : "로컬 셸"
      : activeTab.label
    : "활성 탭 없음";

  return (
    <aside
      style={{
        width: "100%",
        height: "100%",
        background: "#1a1a20",
        color: "#cccccc",
        borderLeft: "1px solid #111",
        display: "flex",
        flexDirection: "column",
        fontSize: 13,
        minWidth: 0,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #2a2a30",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <strong style={{ color: "#fff", marginRight: "auto" }}>AI 어시스턴트</strong>
        {backends.length > 0 ? (
          <select
            value={currentId ?? ""}
            onChange={(e) => setCurrentId(e.target.value)}
            style={{
              background: "#101015",
              color: "#ddd",
              border: "1px solid #333",
              borderRadius: 3,
              padding: "2px 4px",
              fontSize: 11,
              maxWidth: 140,
            }}
          >
            {backends.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName} ({b.defaultModel})
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: "#789", fontSize: 11 }}>백엔드 없음</span>
        )}
        <button
          onClick={() => setShowSetup(true)}
          style={iconBtnStyle}
          title="LLM 백엔드 설정 (S-038)"
        >
          ⚙
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          style={{ ...iconBtnStyle, color: showHistory ? "#4a9eff" : "#888" }}
          title="대화 이력 (S-049)"
        >
          🕘
        </button>
        <button onClick={newChat} style={iconBtnStyle} title="새 대화">
          ＋
        </button>
      </header>

      <div
        style={{
          padding: "6px 12px",
          fontSize: 11,
          color: "#789",
          borderBottom: "1px solid #2a2a30",
        }}
      >
        📍 {sourceCtx}
        {paneCount > 1 && ` · 분할 ${paneCount}패널`}
      </div>

      {showHistory ? (
        <HistoryDrawer
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={selectSession}
          onDelete={deleteSession}
          onNew={newChat}
        />
      ) : (
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minHeight: 0,
        }}
      >
        {!current && <EmptyState onSetup={() => setShowSetup(true)} />}
        {current && messages.length === 0 && !busy && (
          <div style={{ color: "#789", textAlign: "center", marginTop: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
            <div style={{ fontSize: 12 }}>
              {current.displayName}에 무엇이든 물어보세요.
            </div>
            <div style={{ fontSize: 10, marginTop: 6 }}>
              컨텍스트 자동 첨부는 후속 (S-048).
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            role={m.role}
            content={m.content}
            onRun={runInTerminal}
          />
        ))}
        {busy && (
          <div style={{ color: "#789", fontSize: 12, fontStyle: "italic" }}>
            응답 생성 중…
          </div>
        )}
      </div>
      )}

      {error && (
        <div style={{ padding: 8, background: "#3a1d1d", color: "#fdd", fontSize: 11 }}>
          {error}
          <button onClick={() => setError(null)} style={{ ...iconBtnStyle, float: "right" }}>
            ×
          </button>
        </div>
      )}

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px 0",
          fontSize: 11,
          color: "#9aa",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={includeContext}
          onChange={(e) => setIncludeContext(e.target.checked)}
        />
        <span>활성 패널 출력을 컨텍스트로 포함 (S-048)</span>
      </label>

      <div
        style={{
          borderTop: "1px solid #2a2a30",
          padding: 10,
          display: "flex",
          gap: 6,
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={
            current
              ? "Enter로 전송, Shift+Enter 줄바꿈"
              : "백엔드를 먼저 설정해주세요"
          }
          disabled={!current || busy}
          rows={2}
          style={{
            flex: 1,
            background: "#101015",
            color: current ? "#fff" : "#666",
            border: "1px solid #2a2a30",
            borderRadius: 4,
            padding: "6px 8px",
            fontSize: 12,
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={() => void send()}
          disabled={!current || busy || !input.trim()}
          style={{
            background: current && input.trim() ? "#0a5380" : "#2a2a35",
            color: "#fff",
            border: "1px solid #4a9eff",
            borderRadius: 4,
            padding: "0 12px",
            fontSize: 12,
            cursor: current && input.trim() ? "pointer" : "not-allowed",
          }}
        >
          전송
        </button>
      </div>

      {showSetup && (
        <LlmSetupModal
          onClose={() => setShowSetup(false)}
          onChanged={() => void reload()}
        />
      )}
    </aside>
  );
}

function MessageBubble({
  role,
  content,
  onRun,
}: {
  role: string;
  content: string;
  onRun: (code: string) => void;
}) {
  const isUser = role === "user";
  const codeBlocks = isUser ? [] : extractCodeBlocks(content);
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "92%",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          background: isUser ? "#0a5380" : "#26262d",
          border: "1px solid #333",
          padding: "8px 10px",
          borderRadius: 6,
          color: "#e6e6e6",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: 1.5,
        }}
      >
        {content}
      </div>
      {codeBlocks.map((code, i) => (
        <CommandCard key={i} code={code} onRun={onRun} />
      ))}
    </div>
  );
}

function CommandCard({
  code,
  onRun,
}: {
  code: string;
  onRun: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        background: "#0d0d12",
        border: "1px solid #2a3a4a",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          fontSize: 11,
          fontFamily: "Menlo, Consolas, monospace",
          color: "#cfe",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 160,
          overflowY: "auto",
        }}
      >
        {code}
      </pre>
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "6px 8px",
          borderTop: "1px solid #1d2530",
          background: "#10141a",
        }}
      >
        <button
          onClick={() => onRun(code)}
          style={cardBtnStyle}
          title="활성 터미널 패널에 입력 (Enter는 직접)"
        >
          ▶ 터미널에 입력
        </button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          style={cardBtnStyle}
        >
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </div>
  );
}

const cardBtnStyle: React.CSSProperties = {
  background: "#1a2a3a",
  color: "#cfe",
  border: "1px solid #2a3a4a",
  borderRadius: 3,
  padding: "3px 10px",
  fontSize: 11,
  cursor: "pointer",
};

function EmptyState({ onSetup }: { onSetup: () => void }) {
  return (
    <div
      style={{
        textAlign: "center",
        marginTop: 32,
        color: "#789",
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
      <div style={{ marginBottom: 8 }}>LLM 백엔드가 아직 설정되지 않았습니다.</div>
      <button
        onClick={onSetup}
        style={{
          background: "#0a5380",
          color: "#fff",
          border: "1px solid #4a9eff",
          borderRadius: 4,
          padding: "6px 14px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        + LLM 백엔드 추가
      </button>
      <div style={{ fontSize: 10, marginTop: 10, lineHeight: 1.5 }}>
        OpenAI / Ollama / 호환 엔드포인트 지원
      </div>
    </div>
  );
}

function HistoryDrawer({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onNew,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 8, minHeight: 0 }}>
      <button
        onClick={onNew}
        style={{
          width: "100%",
          background: "#0a5380",
          color: "#fff",
          border: "1px solid #4a9eff",
          borderRadius: 4,
          padding: "6px 10px",
          cursor: "pointer",
          fontSize: 12,
          marginBottom: 8,
        }}
      >
        ＋ 새 대화
      </button>
      {sorted.length === 0 && (
        <div style={{ color: "#789", textAlign: "center", padding: 16, fontSize: 12 }}>
          저장된 대화 없음
        </div>
      )}
      {sorted.map((s) => {
        const active = s.id === activeSessionId;
        return (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 10px",
              borderRadius: 4,
              cursor: "pointer",
              background: active ? "#094771" : "transparent",
              marginBottom: 2,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: active ? "#fff" : "#ddd",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.title}
              </div>
              <div style={{ fontSize: 10, color: "#789" }}>
                {s.messages.length}개 메시지 ·{" "}
                {new Date(s.updatedAt).toLocaleString()}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
              style={iconBtnStyle}
              title="삭제"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 14,
  padding: "0 4px",
};
