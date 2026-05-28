import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BackendInfo } from "../types";

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const PRESETS: Array<{
  label: string;
  id: string;
  displayName: string;
  apiBase: string;
  defaultModel: string;
  needsApiKey: boolean;
}> = [
  {
    label: "OpenAI",
    id: "openai",
    displayName: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    needsApiKey: true,
  },
  {
    label: "Anthropic (Claude) — OpenAI 호환 게이트웨이 필요",
    id: "claude",
    displayName: "Claude",
    apiBase: "",
    defaultModel: "claude-3-5-sonnet-latest",
    needsApiKey: true,
  },
  {
    label: "Ollama (로컬)",
    id: "ollama-local",
    displayName: "Ollama",
    apiBase: "http://localhost:11434/v1",
    defaultModel: "llama3.1:8b",
    needsApiKey: false,
  },
  {
    label: "직접 입력 (vLLM/TGI 등)",
    id: "",
    displayName: "",
    apiBase: "",
    defaultModel: "",
    needsApiKey: true,
  },
];

export function LlmSetupModal({ onClose, onChanged }: Props) {
  const [list, setList] = useState<BackendInfo[]>([]);
  const [editing, setEditing] = useState<BackendInfo | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await invoke<BackendInfo[]>("ai_list_backend_configs");
      setList(r);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function deleteOne(id: string) {
    if (!confirm(`백엔드 '${id}'를 삭제할까요? (Keychain의 API 키도 함께 제거됩니다.)`))
      return;
    try {
      await invoke("ai_delete_backend", { id });
      await reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
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
        }}
        role="dialog"
        aria-modal="true"
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <strong style={{ fontSize: 15 }}>LLM 백엔드 설정</strong>
          <button onClick={onClose} style={iconBtnStyle} title="닫기">
            ×
          </button>
        </header>

        {!editing && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.length === 0 && (
                <div style={{ color: "#789", textAlign: "center", padding: 16 }}>
                  등록된 백엔드 없음
                </div>
              )}
              {list.map((b) => (
                <div
                  key={b.id}
                  style={{
                    border: "1px solid #333",
                    borderRadius: 4,
                    padding: 10,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {b.displayName}{" "}
                      <span style={{ fontSize: 11, color: "#789" }}>({b.id})</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#789" }}>
                      {b.apiBase} · {b.defaultModel}{" "}
                      {b.hasApiKey ? "· 🔑 keychain" : "· 키 없음"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => setEditing(b)}
                      style={iconBtnStyle}
                      title="편집"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => void deleteOne(b.id)}
                      style={iconBtnStyle}
                      title="삭제"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setEditing("new")}
              style={primaryBtnStyle}
            >
              + 백엔드 추가
            </button>
          </>
        )}

        {editing && (
          <BackendForm
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reload();
              onChanged();
            }}
          />
        )}

        {error && (
          <div style={{ color: "#fdd", fontSize: 12 }}>
            {error}{" "}
            <button onClick={() => setError(null)} style={iconBtnStyle}>
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BackendForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: BackendInfo | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [presetIdx, setPresetIdx] = useState(initial ? -1 : 0);
  const [id, setId] = useState(initial?.id ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [apiBase, setApiBase] = useState(initial?.apiBase ?? "");
  const [defaultModel, setDefaultModel] = useState(
    initial?.defaultModel ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(idx: number) {
    setPresetIdx(idx);
    if (idx < 0) return;
    const p = PRESETS[idx];
    if (p.id) setId(p.id);
    if (p.displayName) setDisplayName(p.displayName);
    if (p.apiBase) setApiBase(p.apiBase);
    if (p.defaultModel) setDefaultModel(p.defaultModel);
  }

  async function handleSave() {
    setError(null);
    const finalId = id || slugify(displayName);
    if (!finalId || !displayName || !apiBase || !defaultModel) {
      setError("id / displayName / apiBase / defaultModel은 필수입니다.");
      return;
    }
    try {
      setSaving(true);
      await invoke("ai_save_backend", {
        args: {
          id: finalId,
          displayName,
          apiBase,
          defaultModel,
          apiKey: apiKey || null,
        },
      });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h4 style={{ margin: 0, fontSize: 13 }}>
        {initial ? `백엔드 편집 — ${initial.id}` : "새 백엔드"}
      </h4>

      {!initial && (
        <Field label="프리셋">
          <select
            value={presetIdx}
            onChange={(e) => applyPreset(parseInt(e.target.value, 10))}
            style={inputStyle}
          >
            {PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="ID (URL-safe slug)">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="예: openai, ollama-local"
          disabled={!!initial}
          style={inputStyle}
        />
      </Field>

      <Field label="Display Name">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="예: OpenAI"
          style={inputStyle}
        />
      </Field>

      <Field label="API Base URL">
        <input
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder="https://api.openai.com/v1"
          style={inputStyle}
        />
      </Field>

      <Field label="Default Model">
        <input
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          placeholder="gpt-4o-mini"
          style={inputStyle}
        />
      </Field>

      <Field
        label={
          initial?.hasApiKey
            ? "API Key (비우면 기존 키 유지)"
            : "API Key (선택 — 인증 불필요한 로컬 서버는 비워두기)"
        }
      >
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          style={inputStyle}
        />
      </Field>

      {error && <div style={{ color: "#fdd", fontSize: 12 }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={btnStyle}>
          취소
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={primaryBtnStyle}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "#aaa", fontSize: 11 }}>{label}</span>
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
  fontSize: 14,
  padding: "0 4px",
};
