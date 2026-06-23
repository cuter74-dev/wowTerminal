// 모바일(iPad/Android) 온스크린 키바 (#114). 물리 키보드 없이 터미널을 쓰려면 Esc/Ctrl/Tab/
// 방향키와 셸에서 자주 쓰는 특수문자가 필요하다. 포커스된 터미널 세션으로 바이트를 보낸다.
// "Ctrl"은 스티키 토글 — 켜면 다음에 소프트키보드로 친 글자 1개가 Ctrl 조합으로 전송된다
// (Terminal.tsx가 mobileCtrl 플래그를 처리). 나머지는 직접 시퀀스를 쏜다.
import { useEffect, useState } from "react";
import { mobileCtrl } from "../mobileInput";

interface Props {
  /** 포커스된 터미널 세션으로 바이트 전송. */
  onSend: (data: string) => void;
}

// 직접 전송 키 — [라벨, 시퀀스]. 한 줄 가로 스크롤.
const KEYS: Array<[string, string]> = [
  ["Esc", "\x1b"],
  ["Tab", "\t"],
  ["←", "\x1b[D"],
  ["↑", "\x1b[A"],
  ["↓", "\x1b[B"],
  ["→", "\x1b[C"],
  ["⌃C", "\x03"],
  ["⌃D", "\x04"],
  ["⌃Z", "\x1a"],
  ["⌃R", "\x12"],
  ["⌃L", "\x0c"],
  ["|", "|"],
  ["~", "~"],
  ["/", "/"],
  ["-", "-"],
  ["`", "`"],
  [":", ":"],
  ["Home", "\x1b[H"],
  ["End", "\x1b[F"],
  ["PgUp", "\x1b[5~"],
  ["PgDn", "\x1b[6~"],
];

export function MobileKeyBar({ onSend }: Props) {
  const [ctrlOn, setCtrlOn] = useState(mobileCtrl.get());
  useEffect(() => mobileCtrl.subscribe(setCtrlOn), []);

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        padding: "6px 8px",
        background: "#1b1b20",
        borderTop: "1px solid #2a2a30",
        flexShrink: 0,
        // iOS 소프트키보드 위에서도 탭하기 좋게 터치 타깃을 키운다.
        WebkitOverflowScrolling: "touch",
      }}
    >
      <button
        onClick={() => mobileCtrl.toggle()}
        style={{ ...keyStyle, ...(ctrlOn ? activeStyle : null) }}
      >
        Ctrl
      </button>
      {KEYS.map(([label, seq]) => (
        <button
          key={label}
          onClick={() => onSend(seq)}
          style={keyStyle}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const keyStyle: React.CSSProperties = {
  flexShrink: 0,
  minWidth: 40,
  height: 38,
  padding: "0 12px",
  background: "#2c2c34",
  color: "#dde2e8",
  border: "1px solid #3a3a44",
  borderRadius: 7,
  fontSize: 15,
  cursor: "pointer",
  // 탭 시 텍스트 선택/확대 방지.
  userSelect: "none",
  WebkitUserSelect: "none",
  touchAction: "manipulation",
};

const activeStyle: React.CSSProperties = {
  background: "#0a5380",
  borderColor: "#4a9eff",
  color: "#fff",
};
