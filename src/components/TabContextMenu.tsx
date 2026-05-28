import { useEffect, useRef } from "react";

export interface TabContextMenuProps {
  x: number;
  y: number;
  tabLabel: string;
  /** 단독 탭 여부 — "다른 탭 모두 닫기", "오른쪽 탭 닫기", "새 창으로 분리" 비활성 결정. */
  isSoleTab: boolean;
  hasRightTabs: boolean;

  onRename: () => void;
  onDuplicate: () => void;
  onDetach: () => void; // 후속 S-008/009
  onMoveLeft: () => void;
  onMoveRight: () => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onSplitVertical: () => void; // 후속 S-011
  onSplitHorizontal: () => void; // 후속 S-011
  onCloseSelf: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onDismiss: () => void;
}

interface Row {
  kind: "item" | "separator";
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  todoTooltip?: string;
  action?: () => void;
}

export function TabContextMenu(props: TabContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        props.onDismiss();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onDismiss();
    }
    // 다음 tick에 바인딩 — 메뉴를 띄운 그 우클릭 이벤트가 즉시 닫게 만들지 않도록.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onClickOutside);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [props]);

  const rows: Row[] = [
    {
      kind: "item",
      label: "이름 변경",
      shortcut: "F2",
      action: props.onRename,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "탭 복제",
      shortcut: "Ctrl+Shift+D",
      action: props.onDuplicate,
    },
    {
      kind: "item",
      label: "새 창으로 분리",
      disabled: props.isSoleTab,
      todoTooltip: "후속 S-008/009에서 활성화",
      action: props.onDetach,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "왼쪽으로 이동",
      shortcut: "Ctrl+Shift+←",
      disabled: !props.canMoveLeft,
      action: props.onMoveLeft,
    },
    {
      kind: "item",
      label: "오른쪽으로 이동",
      shortcut: "Ctrl+Shift+→",
      disabled: !props.canMoveRight,
      action: props.onMoveRight,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "화면 분할 (좌우)",
      todoTooltip: "후속 S-011에서 활성화",
      action: props.onSplitVertical,
    },
    {
      kind: "item",
      label: "화면 분할 (상하)",
      todoTooltip: "후속 S-011에서 활성화",
      action: props.onSplitHorizontal,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "이 탭 닫기",
      shortcut: "Ctrl+W",
      action: props.onCloseSelf,
    },
    {
      kind: "item",
      label: "다른 탭 모두 닫기",
      disabled: props.isSoleTab,
      action: props.onCloseOthers,
    },
    {
      kind: "item",
      label: "오른쪽 탭 닫기",
      disabled: !props.hasRightTabs,
      action: props.onCloseRight,
    },
  ];

  // 화면 우측/하단을 넘으면 메뉴 위치 보정.
  const menuW = 240;
  const menuH = 360;
  const x = Math.min(props.x, window.innerWidth - menuW - 8);
  const y = Math.min(props.y, window.innerHeight - menuH - 8);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        left: x,
        top: y,
        width: menuW,
        background: "#26262d",
        border: "1px solid #111",
        boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
        borderRadius: 4,
        padding: "4px 0",
        zIndex: 1000,
        color: "#dcdcdc",
        fontSize: 12,
        userSelect: "none",
      }}
    >
      <div
        style={{
          padding: "4px 12px 6px",
          color: "#8aa",
          fontSize: 11,
          borderBottom: "1px solid #333",
          marginBottom: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {props.tabLabel}
      </div>
      {rows.map((r, i) =>
        r.kind === "separator" ? (
          <div
            key={i}
            style={{
              height: 1,
              margin: "4px 6px",
              background: "#333",
            }}
          />
        ) : (
          <button
            key={i}
            disabled={r.disabled}
            title={r.todoTooltip ?? ""}
            onClick={() => {
              if (r.disabled) return;
              r.action?.();
              props.onDismiss();
            }}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              padding: "6px 12px",
              background: "transparent",
              border: "none",
              color: r.disabled ? "#666" : "#dcdcdc",
              cursor: r.disabled ? "not-allowed" : "pointer",
              fontSize: 12,
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              if (!r.disabled)
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#094771";
            }}
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "transparent")
            }
          >
            <span>{r.label}</span>
            {r.shortcut && (
              <span style={{ color: "#888", fontSize: 11, marginLeft: 12 }}>
                {r.shortcut}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
