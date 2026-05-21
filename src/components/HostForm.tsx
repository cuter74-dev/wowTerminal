import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SshAuthMethod, SshHost } from "../types";

interface Props {
  initial: SshHost | null;
  onCancel: () => void;
  onSaved: () => void;
}

type AuthKind = "agent" | "password" | "private_key";

export function HostForm({ initial, onCancel, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? 22);
  const [user, setUser] = useState(initial?.user ?? "");
  const [authKind, setAuthKind] = useState<AuthKind>(
    initial ? initial.auth.type : "agent",
  );
  const [secretId, setSecretId] = useState(
    initial?.auth.type === "password"
      ? initial.auth.secret_id
      : initial?.auth.type === "private_key"
        ? initial.auth.key_id
        : "",
  );
  const [passphraseSecretId, setPassphraseSecretId] = useState(
    initial?.auth.type === "private_key"
      ? (initial.auth.passphrase_secret_id ?? "")
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    if (!name || !host || !user) {
      setError("name / host / user는 필수입니다.");
      return;
    }
    let auth: SshAuthMethod;
    if (authKind === "agent") {
      auth = { type: "agent" };
    } else if (authKind === "password") {
      if (!secretId) {
        setError("password secret id가 필요합니다.");
        return;
      }
      auth = { type: "password", secret_id: secretId };
    } else {
      if (!secretId) {
        setError("key id가 필요합니다.");
        return;
      }
      auth = {
        type: "private_key",
        key_id: secretId,
        passphrase_secret_id: passphraseSecretId || null,
      };
    }

    const id = initial?.id ?? crypto.randomUUID();
    const payload: SshHost = {
      id,
      name,
      host,
      port,
      user,
      auth,
      tags: initial?.tags ?? [],
    };

    try {
      setSaving(true);
      await invoke("ssh_save_host", { host: payload });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 100,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          background: "#2d2d30",
          color: "#cccccc",
          padding: 20,
          borderRadius: 6,
          border: "1px solid #444",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>
          {initial ? "호스트 편집" : "새 호스트"}
        </h3>

        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            placeholder="prod-web-1"
          />
        </Field>

        <Field label="Host">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            style={inputStyle}
            placeholder="192.168.1.10 또는 example.com"
          />
        </Field>

        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Port" flex={1}>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value || "22", 10))}
              style={inputStyle}
            />
          </Field>
          <Field label="User" flex={2}>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              style={inputStyle}
              placeholder="root"
            />
          </Field>
        </div>

        <Field label="Auth">
          <select
            value={authKind}
            onChange={(e) => setAuthKind(e.target.value as AuthKind)}
            style={inputStyle}
          >
            <option value="agent">SSH Agent (위임)</option>
            <option value="password">Password</option>
            <option value="private_key">Private Key</option>
          </select>
        </Field>

        {authKind === "password" && (
          <Field label="Password Secret ID">
            <input
              value={secretId}
              onChange={(e) => setSecretId(e.target.value)}
              style={inputStyle}
              placeholder="secret store에 등록된 ID"
            />
          </Field>
        )}

        {authKind === "private_key" && (
          <>
            <Field label="Private Key Secret ID">
              <input
                value={secretId}
                onChange={(e) => setSecretId(e.target.value)}
                style={inputStyle}
                placeholder="secret store에 등록된 키 ID"
              />
            </Field>
            <Field label="Passphrase Secret ID (optional)">
              <input
                value={passphraseSecretId}
                onChange={(e) => setPassphraseSecretId(e.target.value)}
                style={inputStyle}
                placeholder="패스프레이즈가 있다면"
              />
            </Field>
          </>
        )}

        {error && (
          <div style={{ color: "#fdd", fontSize: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={btnStyle}>
            취소
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            style={{ ...btnStyle, background: "#094771", color: "#fff" }}
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  flex,
}: {
  label: string;
  children: React.ReactNode;
  flex?: number;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 12,
        flex,
      }}
    >
      <span style={{ color: "#aaa" }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#1e1e1e",
  color: "#e6e6e6",
  border: "1px solid #444",
  padding: "6px 8px",
  borderRadius: 3,
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  color: "#cccccc",
  border: "1px solid #555",
  padding: "6px 14px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 13,
};
