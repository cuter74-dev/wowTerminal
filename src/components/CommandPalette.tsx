import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  action: () => void;
}

/** 부분 문자열이 아니라 순서대로 등장하면 매치(퍼지). 빈 쿼리는 모두 통과. */
function fuzzy(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  let i = 0;
  for (let c = 0; c < t.length && i < s.length; c++) {
    if (t[c] === s[i]) i++;
  }
  return i === s.length;
}

export function CommandPalette({
  items,
  placeholder,
  emptyText,
  onClose,
}: {
  items: PaletteItem[];
  placeholder: string;
  emptyText: string;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      items
        .filter((it) => fuzzy(q, `${it.label} ${it.hint ?? ""}`))
        .slice(0, 60),
    [items, q],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setSel(0);
  }, [q]);
  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (it?: PaletteItem) => {
    if (!it) return;
    onClose();
    it.action();
  };

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 2000,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 580,
          maxWidth: "90vw",
          background: "#1b1b22",
          border: "1px solid #3a3a46",
          borderRadius: 10,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(filtered[sel]);
            }
          }}
          placeholder={placeholder}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#11111a",
            border: "none",
            borderBottom: "1px solid #2a2a34",
            color: "#fff",
            fontSize: 15,
            padding: "14px 16px",
            outline: "none",
          }}
        />
        <div ref={listRef} style={{ maxHeight: 360, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: 14, color: "#789", fontSize: 13 }}>
              {emptyText}
            </div>
          )}
          {filtered.map((it, i) => (
            <div
              key={it.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(it)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "9px 16px",
                cursor: "pointer",
                background: i === sel ? "#2a3550" : "transparent",
                color: i === sel ? "#fff" : "#cdd",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {it.label}
              </span>
              {it.hint && (
                <span style={{ fontSize: 11, color: "#7a8aa0", flexShrink: 0 }}>
                  {it.hint}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
