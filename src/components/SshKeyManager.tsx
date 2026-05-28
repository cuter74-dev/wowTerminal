import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SshKeyEntry } from "../types";

interface Props {
  onClose: () => void;
  onChanged?: () => void;
}

type Mode = "list" | "generate" | "import" | { detail: SshKeyEntry };

export function SshKeyManager({ onClose, onChanged }: Props) {
  const [keys, setKeys] = useState<SshKeyEntry[]>([]);
  const [mode, setMode] = useState<Mode>("list");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setKeys(await invoke<SshKeyEntry[]>("ssh_list_keys"));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function remove(id: string, name: string) {
    if (!confirm(`키 '${name}'을(를) 삭제할까요? (Keychain의 개인키도 제거됩니다.)`)) return;
    try {
      await invoke("ssh_delete_key", { id });
      await reload();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle} role="dialog" aria-modal="true">
        <header style={headerStyle}>
          <strong style={{ fontSize: 15 }}>🔑 SSH 키 관리</strong>
          <button onClick={onClose} style={iconBtnStyle} title="닫기">×</button>
        </header>

        {error && (
          <div style={{ color: "#fdd", fontSize: 12 }}>
            {error} <button onClick={() => setError(null)} style={iconBtnStyle}>×</button>
          </div>
        )}

        {mode === "list" && (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setMode("generate")} style={primaryBtnStyle}>+ 새 키 생성</button>
              <button onClick={() => setMode("import")} style={btnStyle}>가져오기</button>
            </div>
            {keys.length === 0 ? (
              <div style={{ color: "#789", textAlign: "center", padding: 24 }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>🔑</div>
                등록된 키가 없습니다. 새 키를 생성하거나 기존 키를 가져오세요.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
                {keys.map((k) => (
                  <div key={k.id} style={rowCardStyle}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {k.name}{" "}
                        <span style={{ fontSize: 10, color: "#789" }}>{k.algorithm}</span>
                        {k.encrypted && <span style={{ fontSize: 10, color: "#fa8" }}> 🔒 암호화</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "#789", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {k.fingerprint}
                      </div>
                    </div>
                    <button onClick={() => setMode({ detail: k })} style={iconBtnStyle} title="상세">ℹ</button>
                    <button onClick={() => void remove(k.id, k.name)} style={iconBtnStyle} title="삭제">×</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {mode === "generate" && (
          <GenerateForm
            onCancel={() => setMode("list")}
            onDone={async () => {
              setMode("list");
              await reload();
              onChanged?.();
            }}
            onError={setError}
          />
        )}

        {mode === "import" && (
          <ImportForm
            onCancel={() => setMode("list")}
            onDone={async () => {
              setMode("list");
              await reload();
              onChanged?.();
            }}
            onError={setError}
          />
        )}

        {typeof mode === "object" && "detail" in mode && (
          <KeyDetail entry={mode.detail} onBack={() => setMode("list")} />
        )}
      </div>
    </div>
  );
}

function GenerateForm({
  onCancel,
  onDone,
  onError,
}: {
  onCancel: () => void;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState("");
  const [algorithm, setAlgorithm] = useState("ed25519");
  const [busy, setBusy] = useState(false);
  return (
    <div style={formStyle}>
      <h4 style={{ margin: 0, fontSize: 13 }}>새 키 생성</h4>
      <Field label="이름">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: my-laptop" style={inputStyle} />
      </Field>
      <Field label="알고리즘">
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} style={inputStyle}>
          <option value="ed25519">ed25519 (권장)</option>
          <option value="rsa">RSA</option>
        </select>
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={btnStyle}>취소</button>
        <button
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await invoke("ssh_generate_key", { args: { name: name.trim(), algorithm } });
              onDone();
            } catch (e) {
              onError(String(e));
            } finally {
              setBusy(false);
            }
          }}
          style={primaryBtnStyle}
        >
          {busy ? "생성 중..." : "생성"}
        </button>
      </div>
    </div>
  );
}

function ImportForm({
  onCancel,
  onDone,
  onError,
}: {
  onCancel: () => void;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState("");
  const [pem, setPem] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div style={formStyle}>
      <h4 style={{ margin: 0, fontSize: 13 }}>키 가져오기 (OpenSSH 개인키)</h4>
      <Field label="이름">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: imported-key" style={inputStyle} />
      </Field>
      <Field label="개인키 PEM (-----BEGIN OPENSSH PRIVATE KEY-----)">
        <textarea
          value={pem}
          onChange={(e) => setPem(e.target.value)}
          rows={6}
          placeholder="개인키 전체를 붙여넣으세요"
          style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
        />
      </Field>
      <Field label="패스프레이즈 (암호화된 키만)">
        <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} style={inputStyle} />
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={btnStyle}>취소</button>
        <button
          disabled={busy || !name.trim() || !pem.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await invoke("ssh_import_key", {
                args: { name: name.trim(), pem, passphrase: passphrase || null },
              });
              onDone();
            } catch (e) {
              onError(String(e));
            } finally {
              setBusy(false);
            }
          }}
          style={primaryBtnStyle}
        >
          {busy ? "가져오는 중..." : "가져오기"}
        </button>
      </div>
    </div>
  );
}

function KeyDetail({ entry, onBack }: { entry: SshKeyEntry; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={formStyle}>
      <h4 style={{ margin: 0, fontSize: 13 }}>{entry.name}</h4>
      <div style={{ fontSize: 12, color: "#9aa" }}>
        {entry.algorithm} · {entry.fingerprint}
      </div>
      <Field label="공개키 (authorized_keys에 추가)">
        <textarea
          readOnly
          value={entry.public_key}
          rows={4}
          style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
        />
      </Field>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onBack} style={btnStyle}>← 목록</button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(entry.public_key);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          style={primaryBtnStyle}
        >
          {copied ? "복사됨" : "공개키 복사"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "#aaa", fontSize: 11 }}>{label}</span>
      {children}
    </label>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  width: 520,
  maxWidth: "92vw",
  maxHeight: "88vh",
  overflowY: "auto",
  background: "#26262d",
  border: "1px solid #333",
  borderRadius: 6,
  color: "#e6e6e6",
  boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
  padding: 20,
  fontSize: 13,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
const formStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const rowCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #333",
  borderRadius: 4,
  padding: "8px 10px",
};
const inputStyle: React.CSSProperties = {
  background: "#1e1e1e",
  color: "#e6e6e6",
  border: "1px solid #444",
  padding: "6px 8px",
  borderRadius: 3,
  fontSize: 12,
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
  fontSize: 12,
};
const primaryBtnStyle: React.CSSProperties = {
  background: "#0a5380",
  color: "#fff",
  border: "1px solid #4a9eff",
  padding: "6px 14px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 12,
};
const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 15,
  padding: "0 4px",
};
