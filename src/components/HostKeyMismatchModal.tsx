import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface MismatchInfo {
  host: string;
  port: number;
  algorithm: string;
  stored: string;
  presented: string;
}

interface Props {
  info: MismatchInfo;
  onCancel: () => void;
  /** 신뢰 갱신 + 재시도. 부모가 retry trigger를 발동시킨다. */
  onTrusted: () => void;
}

export function HostKeyMismatchModal({ info, onCancel, onTrusted }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleTrust() {
    setErr(null);
    setBusy(true);
    try {
      await invoke("ssh_trust_known_host", {
        host: info.host,
        port: info.port,
        algorithm: info.algorithm,
        fingerprint: info.presented,
      });
      onTrusted();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleForget() {
    setErr(null);
    setBusy(true);
    try {
      await invoke("ssh_forget_known_host", {
        host: info.host,
        port: info.port,
      });
      // forget만 한 경우, 다음 connect에서 FirstContact로 처리됨 → 자동 재시도해도 안전.
      onTrusted();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 200,
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: "90vw",
          background: "#2d2d30",
          color: "#cccccc",
          padding: 22,
          borderRadius: 6,
          border: "2px solid #b13a3a",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <h3 style={{ margin: 0, fontSize: 16, color: "#ff8a8a" }}>
            호스트 키 불일치 — 보안 경고
          </h3>
        </div>

        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          <b>
            {info.host}:{info.port}
          </b>{" "}
          서버가 제시한 호스트 키가 이전에 저장된 키와 다릅니다. 이는 다음 중 하나일 수
          있습니다:
        </p>
        <ul style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, paddingLeft: 18 }}>
          <li>
            <b style={{ color: "#ff8a8a" }}>중간자 공격(MITM)</b> — 누군가 트래픽을
            가로채 사칭하는 중일 수 있습니다.
          </li>
          <li>
            서버를 재설치/이전했거나 호스트 키를 의도적으로 회전했습니다.
          </li>
        </ul>

        <div
          style={{
            background: "#1e1e1e",
            border: "1px solid #444",
            borderRadius: 4,
            padding: 12,
            fontFamily: "Menlo, Consolas, monospace",
            fontSize: 11.5,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <Row label="Algorithm" value={info.algorithm} />
          <Row
            label="Stored (이전)"
            value={info.stored}
            valueColor="#9ad4ff"
          />
          <Row
            label="Presented (이번)"
            value={info.presented}
            valueColor="#ffb86c"
          />
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "#aaa" }}>
          서버 관리자에게 별도 채널(예: 슬랙, 전화)로{" "}
          <b style={{ color: "#ffb86c" }}>새 fingerprint</b>가 정상인지 확인한 뒤에만
          "신뢰하고 재시도"를 누르세요.
        </p>

        {err && (
          <div
            style={{
              padding: 8,
              background: "#5a1d1d",
              color: "#fdd",
              fontSize: 12,
              borderRadius: 3,
            }}
          >
            {err}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            onClick={handleForget}
            disabled={busy}
            style={{ ...btnStyle, background: "#3a3a3a" }}
            title="저장된 키를 지우고 다음 접속을 첫 접속으로 처리"
          >
            저장된 키 잊기
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel} disabled={busy} style={btnStyle}>
              취소
            </button>
            <button
              onClick={handleTrust}
              disabled={busy}
              style={{
                ...btnStyle,
                background: "#b13a3a",
                color: "#fff",
                borderColor: "#d65555",
              }}
            >
              {busy ? "처리 중..." : "신뢰하고 재시도"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <span style={{ width: 130, color: "#888" }}>{label}</span>
      <span style={{ color: valueColor ?? "#e6e6e6", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  color: "#cccccc",
  border: "1px solid #555",
  padding: "6px 14px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 13,
};
