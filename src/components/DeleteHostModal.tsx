import { SshHost } from "../types";

interface Props {
  host: SshHost;
  /** 이 호스트로 연결된 현재 활성 탭/패널 수. 0이면 "연결된 세션 없음". */
  activeSessionCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteHostModal({
  host,
  activeSessionCount,
  onCancel,
  onConfirm,
}: Props) {
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
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "90vw",
          background: "#262630",
          border: "1px solid #5a1d1d",
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
          <span
            style={{
              fontSize: 22,
              color: "#ff6b6b",
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "2px solid #ff6b6b",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            !
          </span>
          <strong style={{ fontSize: 15 }}>SSH 호스트 삭제</strong>
        </header>

        <div style={{ lineHeight: 1.5 }}>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: "#ff8c8c" }}>{host.name}</strong> 호스트를 영구
            삭제합니다.
          </div>
          <div style={{ color: "#9aa", fontSize: 12, marginBottom: 8 }}>
            {host.user}@{host.host}:{host.port}
          </div>

          {activeSessionCount > 0 ? (
            <div
              style={{
                background: "#3a1d1d",
                border: "1px solid #6a2828",
                borderRadius: 4,
                padding: "8px 10px",
                marginBottom: 10,
                color: "#fdd",
              }}
            >
              현재 이 호스트를 사용 중인 활성 세션/패널이{" "}
              <strong>{activeSessionCount}개</strong> 있습니다. 삭제 후 즉시 종료됩니다.
            </div>
          ) : (
            <div style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>
              연결된 세션 없음.
            </div>
          )}

          <div style={{ color: "#bbb", fontSize: 12, marginBottom: 16 }}>
            삭제는 되돌릴 수 없습니다. (저장된 시크릿은 별도로 SSH 키 매니저에서 관리됩니다.)
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
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
            autoFocus
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 14px",
              background: "#a02020",
              color: "#fff",
              border: "1px solid #c83838",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            삭제
          </button>
        </footer>
      </div>
    </div>
  );
}
