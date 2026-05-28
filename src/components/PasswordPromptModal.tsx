import { useEffect, useRef, useState } from "react";

export interface PasswordPromptInfo {
  host: string;
  port: number;
  user: string;
}

interface Props {
  info: PasswordPromptInfo;
  onCancel: () => void;
  onSubmit: (password: string, remember: boolean) => void;
}

export function PasswordPromptModal({ info, onCancel, onSubmit }: Props) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (password) onSubmit(password, remember);
        }}
        style={{
          width: 420,
          maxWidth: "90vw",
          background: "#262630",
          border: "1px solid #4a9eff",
          borderRadius: 6,
          color: "#e6e6e6",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          padding: 20,
          fontSize: 13,
        }}
        role="dialog"
        aria-modal="true"
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 22 }}>🔐</span>
          <strong style={{ fontSize: 15 }}>Password 입력</strong>
        </header>

        <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
          <span style={{ color: "#9aa" }}>접속:</span>{" "}
          <code style={{ color: "#fff" }}>
            {info.user}@{info.host}:{info.port}
          </code>
          <div style={{ fontSize: 11, color: "#789", marginTop: 4 }}>
            메모리에서만 사용되며 저장되지 않습니다. 매 접속마다 다시 입력합니다.
          </div>
        </div>

        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          autoComplete="current-password"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#101015",
            border: "1px solid #4a9eff",
            color: "#fff",
            padding: "8px 10px",
            borderRadius: 4,
            fontSize: 13,
            outline: "none",
            marginBottom: 10,
          }}
        />

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 14,
            fontSize: 12,
            color: "#ccc",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>
            OS Keychain에 저장 — 다음 접속부터 자동 인증
          </span>
        </label>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 14px",
              background: "transparent",
              color: "#ccc",
              border: "1px solid #444",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!password}
            style={{
              padding: "8px 14px",
              background: password ? "#0a5380" : "#2a2a35",
              color: "#fff",
              border: `1px solid ${password ? "#4a9eff" : "#444"}`,
              borderRadius: 4,
              cursor: password ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            접속
          </button>
        </footer>
      </form>
    </div>
  );
}
