import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Group, SshAuthMethod, SshHost, SshKeyEntry, Tag } from "../types";

interface Props {
  initial: SshHost | null;
  onCancel: () => void;
  onSaved: () => void;
}

type AuthKind = "agent" | "password" | "password_prompt" | "private_key";

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
  const [groupId, setGroupId] = useState<string | null>(initial?.group_id ?? null);
  const [hostTags, setHostTags] = useState<string[]>(initial?.tags ?? []);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sshKeys, setSshKeys] = useState<SshKeyEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [g, t, k] = await Promise.all([
          invoke<Group[]>("ssh_list_groups"),
          invoke<Tag[]>("ssh_list_tags"),
          invoke<SshKeyEntry[]>("ssh_list_keys"),
        ]);
        setGroups(g);
        setTags(t);
        setSshKeys(k);
      } catch (e) {
        // 비치명적
        console.error("load groups/tags failed", e);
      }
    })();
  }, []);

  function toggleTag(name: string) {
    setHostTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  async function handleSave() {
    setError(null);
    if (!name || !host || !user) {
      setError("name / host / user는 필수입니다.");
      return;
    }
    let auth: SshAuthMethod;
    if (authKind === "agent") {
      auth = { type: "agent" };
    } else if (authKind === "password_prompt") {
      auth = { type: "password_prompt" };
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
      tags: hostTags,
      group_id: groupId,
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
          width: 420,
          maxHeight: "92vh",
          overflowY: "auto",
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
            <option value="password_prompt">Password (접속 시 입력)</option>
            <option value="password">Password (Secret Store)</option>
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
            <Field label="Private Key (🔑 키 관리에서 등록)">
              {sshKeys.length > 0 ? (
                <select
                  value={secretId}
                  onChange={(e) => setSecretId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">키 선택...</option>
                  {sshKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.algorithm})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={secretId}
                  onChange={(e) => setSecretId(e.target.value)}
                  style={inputStyle}
                  placeholder="등록된 키 없음 — 키 ID 직접 입력 또는 🔑에서 생성"
                />
              )}
            </Field>
            <Field label="Passphrase Secret ID (optional)">
              <input
                value={passphraseSecretId}
                onChange={(e) => setPassphraseSecretId(e.target.value)}
                style={inputStyle}
                placeholder="암호화된 키의 패스프레이즈 secret_id"
              />
            </Field>
          </>
        )}

        <Field label="Group">
          <select
            value={groupId ?? ""}
            onChange={(e) =>
              setGroupId(e.target.value === "" ? null : e.target.value)
            }
            style={inputStyle}
          >
            <option value="">(미분류)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Tags">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tags.length === 0 && (
              <span style={{ color: "#666", fontSize: 11 }}>
                등록된 태그 없음 — 사이드바의 그룹/태그 관리로 추가
              </span>
            )}
            {tags.map((t) => {
              const active = hostTags.includes(t.name);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.name)}
                  style={{
                    background: active ? t.color : "transparent",
                    color: active ? "#fff" : t.color,
                    border: `1px solid ${t.color}`,
                    borderRadius: 12,
                    padding: "2px 10px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  #{t.name}
                </button>
              );
            })}
          </div>
        </Field>

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
