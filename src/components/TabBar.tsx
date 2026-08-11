import { useEffect, useRef } from "react";
import { Tab } from "../types";
import { LangDict, useT } from "../i18n";
import { isMobile } from "../platform";

const STR: LangDict<{
    closeTab: string;
    newTab: string;
  }
> = {
  en: {
    closeTab: "Close tab (Ctrl+W)",
    newTab: "New local shell tab (Ctrl+T)",
  },
  ko: {
    closeTab: "탭 닫기 (Ctrl+W)",
    newTab: "새 로컬 셸 탭 (Ctrl+T)",
  },
  es: {
    closeTab: "Cerrar pestaña (Ctrl+W)",
    newTab: "Nueva pestaña de shell local (Ctrl+T)",
  },
  zh: {
    closeTab: "关闭标签页 (Ctrl+W)",
    newTab: "新建本地 shell 标签页 (Ctrl+T)",
  },
  ja: {
    closeTab: "タブを閉じる (Ctrl+W)",
    newTab: "新しいローカルシェルタブ (Ctrl+T)",
  },
  ru: {
    closeTab: "Закрыть вкладку (Ctrl+W)",
    newTab: "Новая вкладка локального shell (Ctrl+T)",
  },
  fr: {
    closeTab: "Fermer l'onglet (Ctrl+W)",
    newTab: "Nouvel onglet shell local (Ctrl+T)",
  },
  de: {
    closeTab: "Tab schließen (Ctrl+W)",
    newTab: "Neuer lokaler Shell-Tab (Ctrl+T)",
  },
  vi: {
    closeTab: "Đóng tab (Ctrl+W)",
    newTab: "Tab shell cục bộ mới (Ctrl+T)",
  },
  id: {
    closeTab: "Tutup tab (Ctrl+W)",
    newTab: "Tab shell lokal baru (Ctrl+T)",
  },
  hi: {
    closeTab: "टैब बंद करें (Ctrl+W)",
    newTab: "नया लोकल shell टैब (Ctrl+T)",
  },
};

function tabIcon(t: Tab): string {
  if (t.root.kind === "split") return "⊟";
  return t.root.source.kind === "ssh" ? "🖥" : "⌨";
}

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  /** 백그라운드에서 긴 명령이 끝나 알림 배지를 표시할 탭 id들 (#55). */
  alertedTabIds?: Set<string>;
  /** 인라인 편집 중인 탭 (이름 변경). null이면 편집 중 아님. */
  editingTabId: string | null;
  onActivate: (id: string) => void;
  /** 화살표 키로 전환할 때 호출 — 포커스를 터미널로 옮기지 않고 탭에 유지한다(#125). */
  onActivateByKey?: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onRenameCommit: (id: string, label: string) => void;
  onRenameCancel: () => void;
  /** 탭 더블클릭 → 인라인 이름 편집 시작. */
  onStartRename: (id: string) => void;
  /** 탭에서 pointer down — 드래그 분리 후보 시작 (WKWebView는 HTML5 DnD 불안정 → pointer 기반). */
  onTabPointerDown: (id: string, clientX: number, clientY: number) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  alertedTabIds,
  editingTabId,
  onActivate,
  onActivateByKey,
  onClose,
  onNew,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onStartRename,
  onTabPointerDown,
}: Props) {
  const tr = useT(STR);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const targetScrollRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  // 화살표 키로 탭을 전환했을 때만 새 활성 탭으로 포커스를 옮긴다(#125) — 클릭/단축키 전환 시엔
  // 터미널 포커스를 유지한다.
  const navByKeyRef = useRef(false);

  // 활성 탭이 바뀌면 보이도록 자동 스크롤(#124) + 화살표 네비 중이면 새 탭으로 포커스 이동(#125).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
    if (navByKeyRef.current) {
      activeRef.current?.focus();
      navByKeyRef.current = false;
    }
  }, [activeTabId, tabs.length]);

  // (#144) 모바일: + 버튼이 없어(로컬 셸 없음 — 탭은 호스트 접속으로만 생긴다) 탭이
  // 0개면 빈 띠만 남는다. 인셋 수정으로 이 띠가 드러나 보여, 탭이 없으면 숨긴다.
  if (isMobile && tabs.length === 0) return null;

  // 언마운트 시 진행 중인 관성 애니메이션 정리.
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // 세로 휠을 가로 스크롤로 변환(macOS 오버레이 스크롤바가 숨겨져도 휠로 이동) — 목표값으로
  // requestAnimationFrame 보간해 휠 한 칸의 큰 delta가 뚝뚝 끊기지 않고 부드럽게 흐르게 한다(#124).
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    let delta = e.deltaY;
    if (delta === 0) return;
    if (e.deltaMode === 1) delta *= 16; // 라인 단위 → 픽셀
    else if (e.deltaMode === 2) delta *= el.clientWidth; // 페이지 단위
    const max = el.scrollWidth - el.clientWidth;
    const base = targetScrollRef.current ?? el.scrollLeft;
    targetScrollRef.current = Math.max(0, Math.min(max, base + delta));
    if (!rafRef.current) {
      const step = () => {
        const e2 = scrollRef.current;
        const target = targetScrollRef.current;
        if (!e2 || target === null) {
          rafRef.current = 0;
          return;
        }
        const diff = target - e2.scrollLeft;
        if (Math.abs(diff) < 0.5) {
          e2.scrollLeft = target;
          targetScrollRef.current = null;
          rafRef.current = 0;
          return;
        }
        e2.scrollLeft += diff * 0.25; // ease-out 보간
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    }
  }

  return (
    <div
      ref={scrollRef}
      onWheel={onWheel}
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "#181820",
        borderBottom: "1px solid #111",
        height: 34,
        overflowX: "auto",
        overflowY: "hidden",
        // 스크롤/클릭 중 탭 라벨이 선택되어 하이라이트되지 않게(#124). WKWebView는 Webkit 접두사 필요.
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        const editing = t.id === editingTabId;
        const alerted = !!alertedTabIds?.has(t.id);
        const icon = tabIcon(t);
        return (
          <div
            key={t.id}
            ref={active ? activeRef : undefined}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onMouseDown={(e) => {
              if (e.button === 0 && !editing) {
                onTabPointerDown(t.id, e.clientX, e.clientY);
              }
            }}
            onClick={(e) => {
              onActivate(t.id);
              // 클릭한 탭에 포커스를 둬서 곧바로 ←/→로 탭 이동할 수 있게 한다(#125).
              if (!editing) e.currentTarget.focus();
            }}
            onKeyDown={(e) => {
              if (editing) return;
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const idx = tabs.findIndex((x) => x.id === t.id);
                if (idx < 0) return;
                const ni =
                  (idx + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                  tabs.length;
                navByKeyRef.current = true;
                (onActivateByKey ?? onActivate)(tabs[ni].id);
              }
            }}
            onDoubleClick={() => {
              if (!editing) onStartRename(t.id);
            }}
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
              // 탭이 많으면 적당히 줄어들되 너무 좁아지지 않게(라벨 일부 유지) — 그 이상은 스크롤(#124).
              flex: "0 1 auto",
              minWidth: 88,
              maxWidth: 220,
              fontSize: 12,
              userSelect: "none",
              outline: "none", // 포커스는 활성 탭의 파란 상단 보더로 표시(#125).
            }}
            title={t.label}
          >
            <span style={{ fontSize: 12 }}>{icon}</span>
            {alerted && (
              <span
                title="command finished"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#ffae00",
                  flexShrink: 0,
                }}
              />
            )}
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
              title={tr.closeTab}
            >
              ×
            </button>
          </div>
        );
      })}
      {/* 새 로컬 셸 탭은 데스크탑 전용 — 모바일은 로컬 셸이 없어 호스트 탭으로 연다(#114). */}
      {!isMobile && (
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
            flexShrink: 0,
          }}
          title={tr.newTab}
        >
          +
        </button>
      )}
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
        // 탭바 컨테이너의 user-select:none을 무시하고 이름 편집 시 선택 가능하게.
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    />
  );
}
