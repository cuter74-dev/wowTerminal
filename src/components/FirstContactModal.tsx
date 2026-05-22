import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FirstContactInfo {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}

interface Props {
  info: FirstContactInfo;
  onCancel: () => void;
  /** 신뢰 저장 후 부모가 재접속을 트리거. */
  onTrusted: () => void;
}

export function FirstContactModal({ info, onCancel, onTrusted }: Props) {
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
        fingerprint: info.fingerprint,
      });
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
          border: "2px solid #b89642",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🔐</span>
          <h3 style={{ margin: 0, fontSize: 16, color: "#ffd07a" }}>
            첫 접속 — 호스트 키 확인
          </h3>
        </div>

        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          <b>
            {info.host}:{info.port}
          </b>{" "}
          은(는) 처음 접속하는 호스트입니다. 아래 fingerprint가 서버 관리자에게서
          받은 값과 같은지 <b style={{ color: "#ffd07a" }}>별도 채널</b>로 확인한 뒤
          신뢰하세요. 일치하지 않으면 MITM 공격일 수 있습니다.
        </p>

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
            label="Fingerprint"
            value={info.fingerprint}
            valueColor="#ffd07a"
          />
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "#aaa" }}>
          확인 방법(서버에서 실행):{" "}
          <code style={codeStyle}>
            ssh-keygen -lf /etc/ssh/ssh_host_{info.algorithm.replace(
              "ssh-",
              "",
            )}_key.pub
          </code>
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
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button onClick={onCancel} disabled={busy} style={btnStyle}>
            취소
          </button>
          <button
            onClick={handleTrust}
            disabled={busy}
            style={{
              ...btnStyle,
              background: "#b89642",
              color: "#1e1e1e",
              borderColor: "#d9b25c",
              fontWeight: 600,
            }}
          >
            {busy ? "처리 중..." : "신뢰하고 접속"}
          </button>
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

const codeStyle: React.CSSProperties = {
  background: "#1e1e1e",
  padding: "1px 6px",
  borderRadius: 3,
  fontSize: 11,
  fontFamily: "Menlo, Consolas, monospace",
  color: "#9ad4ff",
};
