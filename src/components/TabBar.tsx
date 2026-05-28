import { useEffect, useRef } from "react";
import { Tab } from "../types";

function tabIcon(t: Tab): string {
  if (t.root.kind === "split") return "⊟";
  return t.root.source.kind === "ssh" ? "🖥" : "⌨";
}

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  /** 인라인 편집 중인 탭 (이름 변경). null이면 편집 중 아님. */
  editingTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onRenameCommit: (id: string, label: string) => void;
  onRenameCancel: () => void;
  /** 탭에서 pointer down — 드래그 분리 후보 시작 (WKWebView는 HTML5 DnD 불안정 → pointer 기반). */
  onTabPointerDown: (id: string, clientX: number, clientY: number) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  editingTabId,
  onActivate,
  onClose,
  onNew,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onTabPointerDown,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "#181820",
        borderBottom: "1px solid #111",
        height: 34,
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        const editing = t.id === editingTabId;
        const icon = tabIcon(t);
        return (
          <div
            key={t.id}
            onMouseDown={(e) => {
              if (e.button === 0 && !editing) {
                onTabPointerDown(t.id, e.clientX, e.clientY);
              }
            }}
            onClick={() => onActivate(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onActivate(t.id);
              onContextMenu(t.id, e.clientX, e.clientY);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px 0 12px",
              cursor: editing ? "text" : "pointer",
              borderRight: "1px solid #111",
              background: active ? "#1e1e1e" : "transparent",
              color: active ? "#fff" : "#aaa",
              borderTop: active ? "2px solid #4a9eff" : "2px solid transparent",
              minWidth: 120,
              maxWidth: 220,
              fontSize: 12,
              userSelect: "none",
            }}
            title={t.label}
          >
            <span style={{ fontSize: 12 }}>{icon}</span>
            {editing ? (
              <RenameInput
                initial={t.label}
                onCommit={(label) => onRenameCommit(t.id, label)}
                onCancel={onRenameCancel}
              />
            ) : (
              <span
                style={{
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t.label}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: active ? "#ccc" : "#666",
                cursor: "pointer",
                fontSize: 14,
                padding: "0 2px",
                lineHeight: 1,
              }}
              title="탭 닫기 (Ctrl+W)"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={onNew}
        style={{
          background: "transparent",
          border: "none",
          color: "#ccc",
          cursor: "pointer",
          fontSize: 18,
          padding: "0 14px",
          lineHeight: 1,
        }}
        title="새 로컬 셸 탭 (Ctrl+T)"
      >
        +
      </button>
    </div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (label: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (v) onCommit(v);
        else onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const v = (e.currentTarget as HTMLInputElement).value.trim();
          if (v) onCommit(v);
          else onCancel();
        } else if (e.key === "Escape") {
          onCancel();
        }
        e.stopPropagation();
      }}
      style={{
        flex: 1,
        background: "#101015",
        border: "1px solid #4a9eff",
        color: "#fff",
        fontSize: 12,
        padding: "2px 4px",
        minWidth: 0,
        outline: "none",
        borderRadius: 2,
      }}
    />
  );
}
