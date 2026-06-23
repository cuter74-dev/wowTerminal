// 모바일(iPad/Android) 슬라이드오버 시트 (#114). 데스크탑은 호스트/AI 패널을 좌·우 고정
// 컬럼으로 두지만, 좁은 모바일 화면에선 터미널을 가리지 않도록 평소엔 숨기고 버튼을 탭하면
// 화면 위로 미끄러져 나오는 오버레이로 띄운다. 뒤 배경(backdrop)을 탭하면 닫힌다.
import type { ReactNode } from "react";

interface Props {
  side: "left" | "right";
  /** 시트 폭(px). 화면이 좁으면 화면폭의 88%로 제한. */
  width?: number;
  onClose: () => void;
  children: ReactNode;
}

export function MobileSheet({ side, width = 320, onClose, children }: Props) {
  return (
    <div
      // 레이아웃 행 전체를 덮는 오버레이. position:absolute 기준은 부모(레이아웃 행).
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        display: "flex",
        flexDirection: side === "left" ? "row" : "row-reverse",
      }}
    >
      <div
        // 패널 본체 — 좌/우에서 붙어 나온다.
        style={{
          width: `min(${width}px, 88%)`,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#1b1b20",
          [side === "left" ? "borderRight" : "borderLeft"]:
            "1px solid #2a2a30",
          boxShadow:
            side === "left"
              ? "6px 0 24px rgba(0,0,0,0.5)"
              : "-6px 0 24px rgba(0,0,0,0.5)",
          minHeight: 0,
        }}
      >
        {children}
      </div>
      <div
        // backdrop — 탭하면 닫기.
        onClick={onClose}
        style={{ flex: 1, background: "rgba(0,0,0,0.4)" }}
      />
    </div>
  );
}
