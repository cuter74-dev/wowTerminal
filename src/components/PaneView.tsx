import { useRef } from "react";
import { Pane, SshConnectError, TerminalSource } from "../types";
import { Terminal } from "./Terminal";
import { TerminalSettings } from "../settings";

interface Props {
  pane: Pane;
  focusedPaneId: string;
  /** 분할된 경우 leaf 위에 헤더(라벨+닫기 버튼) 노출. */
  showHeaders: boolean;
  paneIndex?: number; // 헤더 라벨에 표시할 "패널 N"의 N (재귀 카운터, App에서 사용)
  onFocus: (leafId: string) => void;
  onClosePane: (leafId: string) => void;
  onRatioChange: (path: number[], ratio: number) => void;
  onSshError: (leafId: string, err: SshConnectError) => void;
  onSshConnected: (leafId: string) => void;
  retryByLeaf: Record<string, number>;
  /** PasswordPrompt 모달 입력. leaf id → 그 leaf용 password. */
  passwordByLeaf: Record<string, string>;
  /** 표시용 라벨 헬퍼 (source → "로컬 셸" / 호스트명). */
  labelForSource: (source: TerminalSource) => string;
  termSettings: TerminalSettings;
  /** spawn된 leaf의 sessionId 보고 (세션 인계용). */
  onSession: (leafId: string, sessionId: string) => void;
  /** leaf id → attach할 기존 sessionId (분리된 윈도우의 인계). */
  attachSessionByLeaf: Record<string, string>;
  path?: number[];
}

export function PaneView(props: Props) {
  const path = props.path ?? [];
  if (props.pane.kind === "leaf") {
    return <LeafPane {...props} pane={props.pane} />;
  }
  return <SplitPane {...props} pane={props.pane} path={path} />;
}

function LeafPane(
  props: Omit<Props, "pane"> & { pane: Extract<Pane, { kind: "leaf" }> },
) {
  const { pane, focusedPaneId, showHeaders } = props;
  const isFocused = pane.id === focusedPaneId;
  return (
    <div
      onMouseDownCapture={() => props.onFocus(pane.id)}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
        outline: showHeaders && isFocused ? "1px solid #4a9eff" : "none",
        outlineOffset: -1,
      }}
    >
      {showHeaders && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            padding: "4px 8px",
            fontSize: 11,
            background: isFocused ? "#283040" : "#202028",
            color: isFocused ? "#fff" : "#9aa",
            borderBottom: "1px solid #111",
            height: 22,
            userSelect: "none",
          }}
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isFocused ? "● " : ""}
            {props.labelForSource(pane.source)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onClosePane(pane.id);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: 13,
              lineHeight: 1,
              padding: "0 2px",
            }}
            title="패널 닫기"
          >
            ×
          </button>
        </header>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Terminal
          source={pane.source}
          paneId={pane.id}
          retryNonce={props.retryByLeaf[pane.id] ?? 0}
          password={props.passwordByLeaf[pane.id]}
          termSettings={props.termSettings}
          onSshError={(err) => props.onSshError(pane.id, err)}
          onSshConnected={() => props.onSshConnected(pane.id)}
          onSession={(sid) => props.onSession(pane.id, sid)}
          attachSessionId={props.attachSessionByLeaf[pane.id]}
        />
      </div>
    </div>
  );
}

function SplitPane(
  props: Omit<Props, "pane"> & { pane: Extract<Pane, { kind: "split" }> },
) {
  const { pane, path = [] } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const isVertical = pane.direction === "vertical"; // 좌우 분할

  function onDividerDown(e: React.MouseEvent) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const total = isVertical ? rect.width : rect.height;
    const start = isVertical ? rect.left : rect.top;
    const min = 120 / Math.max(total, 1);
    const max = 1 - min;

    function onMove(ev: MouseEvent) {
      const pos = isVertical ? ev.clientX : ev.clientY;
      let ratio = (pos - start) / total;
      ratio = Math.max(min, Math.min(max, ratio));
      props.onRatioChange(path, ratio);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: isVertical ? "row" : "column",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: `${pane.ratio} 0 0`,
          display: "flex",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <PaneView {...props} pane={pane.first} path={[...path, 0]} />
      </div>
      <div
        onMouseDown={onDividerDown}
        style={{
          background: "#0a0a10",
          flex: "0 0 4px",
          cursor: isVertical ? "col-resize" : "row-resize",
          userSelect: "none",
        }}
        title={isVertical ? "좌우 분할 구분선 드래그" : "상하 분할 구분선 드래그"}
      />
      <div
        style={{
          flex: `${1 - pane.ratio} 0 0`,
          display: "flex",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <PaneView {...props} pane={pane.second} path={[...path, 1]} />
      </div>
    </div>
  );
}
