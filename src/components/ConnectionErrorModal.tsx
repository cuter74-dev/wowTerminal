export interface ConnErrorInfo {
  label: string;
  message: string;
}

interface Props {
  info: ConnErrorInfo;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * S-062/063/064 — SSH 연결/네트워크/인증 실패 안내.
 * 메시지 내용으로 흔한 원인을 추정해 힌트를 덧붙인다.
 */
export function ConnectionErrorModal({ info, onRetry, onClose }: Props) {
  const m = info.message.toLowerCase();
  let hint = "호스트 주소·포트·네트워크 연결을 확인하세요.";
  if (m.includes("unreachable") || m.includes("network")) {
    hint = "네트워크에 도달할 수 없습니다. VPN/방화벽, 호스트 주소·포트를 확인하세요.";
  } else if (m.includes("auth") || m.includes("rejected") || m.includes("password")) {
    hint = "인증에 실패했습니다. 사용자명/비밀번호/키 또는 ssh-agent 등록을 확인하세요.";
  } else if (m.includes("timed out") || m.includes("timeout")) {
    hint = "연결 시간이 초과됐습니다. 호스트가 켜져 있고 포트가 열려 있는지 확인하세요.";
  } else if (m.includes("refused")) {
    hint = "연결이 거부됐습니다. 해당 포트에서 SSH 서비스가 동작 중인지 확인하세요.";
  } else if (m.includes("not unlocked") || m.includes("secret store")) {
    hint = "시크릿 저장소가 잠겨 있습니다. Keychain 저장 호스트로 다시 시도하거나 인증 방식을 바꾸세요.";
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal} role="dialog" aria-modal="true">
        <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span
            style={{
              fontSize: 20,
              color: "#ff8c5a",
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: "2px solid #ff8c5a",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            !
          </span>
          <strong style={{ fontSize: 15 }}>연결 실패 — {info.label}</strong>
        </header>

        <div style={{ color: "#ddd", marginBottom: 8, lineHeight: 1.5 }}>{hint}</div>
        <pre
          style={{
            background: "#16161c",
            border: "1px solid #2a2a30",
            borderRadius: 4,
            padding: "8px 10px",
            fontSize: 11,
            color: "#fbb",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: "0 0 16px",
            maxHeight: 120,
            overflow: "auto",
          }}
        >
          {info.message}
        </pre>

        <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btn}>
            닫기
          </button>
          <button onClick={onRetry} style={primary}>
            다시 시도
          </button>
        </footer>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};
const modal: React.CSSProperties = {
  width: 460,
  maxWidth: "90vw",
  background: "#262630",
  border: "1px solid #5a3a1d",
  borderRadius: 6,
  color: "#e6e6e6",
  boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
  padding: 20,
  fontSize: 13,
};
const btn: React.CSSProperties = {
  padding: "8px 14px",
  background: "transparent",
  color: "#ccc",
  border: "1px solid #444",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
};
const primary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#0a5380",
  color: "#fff",
  border: "1px solid #4a9eff",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
