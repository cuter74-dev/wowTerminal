import { useEffect, useRef } from "react";
import { LangDict, useT } from "../i18n";

const STR: LangDict<{
    rename: string;
    duplicate: string;
    detach: string;
    detachTodo: string;
    moveLeft: string;
    moveRight: string;
    splitVertical: string;
    splitHorizontal: string;
    splitTodo: string;
    closeSelf: string;
    closeOthers: string;
    closeRight: string;
  }
> = {
  en: {
    rename: "Rename",
    duplicate: "Duplicate tab",
    detach: "Detach to new window",
    detachTodo: "Enabled in upcoming S-008/009",
    moveLeft: "Move left",
    moveRight: "Move right",
    splitVertical: "Split (left/right)",
    splitHorizontal: "Split (top/bottom)",
    splitTodo: "Enabled in upcoming S-011",
    closeSelf: "Close this tab",
    closeOthers: "Close other tabs",
    closeRight: "Close tabs to the right",
  },
  ko: {
    rename: "이름 변경",
    duplicate: "탭 복제",
    detach: "새 창으로 분리",
    detachTodo: "후속 S-008/009에서 활성화",
    moveLeft: "왼쪽으로 이동",
    moveRight: "오른쪽으로 이동",
    splitVertical: "화면 분할 (좌우)",
    splitHorizontal: "화면 분할 (상하)",
    splitTodo: "후속 S-011에서 활성화",
    closeSelf: "이 탭 닫기",
    closeOthers: "다른 탭 모두 닫기",
    closeRight: "오른쪽 탭 닫기",
  },
  es: {
    rename: "Renombrar",
    duplicate: "Duplicar pestaña",
    detach: "Separar a nueva ventana",
    detachTodo: "Se habilitará en el próximo S-008/009",
    moveLeft: "Mover a la izquierda",
    moveRight: "Mover a la derecha",
    splitVertical: "Dividir (izquierda/derecha)",
    splitHorizontal: "Dividir (arriba/abajo)",
    splitTodo: "Se habilitará en el próximo S-011",
    closeSelf: "Cerrar esta pestaña",
    closeOthers: "Cerrar otras pestañas",
    closeRight: "Cerrar pestañas a la derecha",
  },
  zh: {
    rename: "重命名",
    duplicate: "复制标签页",
    detach: "分离到新窗口",
    detachTodo: "将在后续 S-008/009 中启用",
    moveLeft: "向左移动",
    moveRight: "向右移动",
    splitVertical: "分屏（左右）",
    splitHorizontal: "分屏（上下）",
    splitTodo: "将在后续 S-011 中启用",
    closeSelf: "关闭此标签页",
    closeOthers: "关闭其他标签页",
    closeRight: "关闭右侧标签页",
  },
  ja: {
    rename: "名前を変更",
    duplicate: "タブを複製",
    detach: "新しいウィンドウに分離",
    detachTodo: "今後の S-008/009 で有効化",
    moveLeft: "左へ移動",
    moveRight: "右へ移動",
    splitVertical: "分割（左右）",
    splitHorizontal: "分割（上下）",
    splitTodo: "今後の S-011 で有効化",
    closeSelf: "このタブを閉じる",
    closeOthers: "他のタブを閉じる",
    closeRight: "右側のタブを閉じる",
  },
  ru: {
    rename: "Переименовать",
    duplicate: "Дублировать вкладку",
    detach: "Отделить в новое окно",
    detachTodo: "Будет доступно в предстоящем S-008/009",
    moveLeft: "Переместить влево",
    moveRight: "Переместить вправо",
    splitVertical: "Разделить (слева/справа)",
    splitHorizontal: "Разделить (сверху/снизу)",
    splitTodo: "Будет доступно в предстоящем S-011",
    closeSelf: "Закрыть эту вкладку",
    closeOthers: "Закрыть другие вкладки",
    closeRight: "Закрыть вкладки справа",
  },
  fr: {
    rename: "Renommer",
    duplicate: "Dupliquer l'onglet",
    detach: "Détacher dans une nouvelle fenêtre",
    detachTodo: "Activé dans le prochain S-008/009",
    moveLeft: "Déplacer à gauche",
    moveRight: "Déplacer à droite",
    splitVertical: "Diviser (gauche/droite)",
    splitHorizontal: "Diviser (haut/bas)",
    splitTodo: "Activé dans le prochain S-011",
    closeSelf: "Fermer cet onglet",
    closeOthers: "Fermer les autres onglets",
    closeRight: "Fermer les onglets à droite",
  },
  de: {
    rename: "Umbenennen",
    duplicate: "Tab duplizieren",
    detach: "In neues Fenster lösen",
    detachTodo: "Wird im kommenden S-008/009 aktiviert",
    moveLeft: "Nach links verschieben",
    moveRight: "Nach rechts verschieben",
    splitVertical: "Teilen (links/rechts)",
    splitHorizontal: "Teilen (oben/unten)",
    splitTodo: "Wird im kommenden S-011 aktiviert",
    closeSelf: "Diesen Tab schließen",
    closeOthers: "Andere Tabs schließen",
    closeRight: "Tabs rechts schließen",
  },
  vi: {
    rename: "Đổi tên",
    duplicate: "Nhân bản tab",
    detach: "Tách ra cửa sổ mới",
    detachTodo: "Sẽ bật trong S-008/009 sắp tới",
    moveLeft: "Di chuyển sang trái",
    moveRight: "Di chuyển sang phải",
    splitVertical: "Chia tách (trái/phải)",
    splitHorizontal: "Chia tách (trên/dưới)",
    splitTodo: "Sẽ bật trong S-011 sắp tới",
    closeSelf: "Đóng tab này",
    closeOthers: "Đóng các tab khác",
    closeRight: "Đóng các tab bên phải",
  },
  id: {
    rename: "Ganti nama",
    duplicate: "Duplikat tab",
    detach: "Lepaskan ke jendela baru",
    detachTodo: "Diaktifkan pada S-008/009 mendatang",
    moveLeft: "Pindah ke kiri",
    moveRight: "Pindah ke kanan",
    splitVertical: "Bagi (kiri/kanan)",
    splitHorizontal: "Bagi (atas/bawah)",
    splitTodo: "Diaktifkan pada S-011 mendatang",
    closeSelf: "Tutup tab ini",
    closeOthers: "Tutup tab lainnya",
    closeRight: "Tutup tab di sebelah kanan",
  },
  hi: {
    rename: "नाम बदलें",
    duplicate: "टैब डुप्लिकेट करें",
    detach: "नई विंडो में अलग करें",
    detachTodo: "आगामी S-008/009 में सक्षम होगा",
    moveLeft: "बाएं ले जाएं",
    moveRight: "दाएं ले जाएं",
    splitVertical: "विभाजित करें (बाएं/दाएं)",
    splitHorizontal: "विभाजित करें (ऊपर/नीचे)",
    splitTodo: "आगामी S-011 में सक्षम होगा",
    closeSelf: "यह टैब बंद करें",
    closeOthers: "अन्य टैब बंद करें",
    closeRight: "दाईं ओर के टैब बंद करें",
  },
};

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
  const t = useT(STR);
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
    // 캡처 단계(true)로 — xterm 등이 mousedown을 stopPropagation해도 바깥 클릭을 잡도록.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onClickOutside, true);
      window.addEventListener("keydown", onKey, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onClickOutside, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [props]);

  const rows: Row[] = [
    {
      kind: "item",
      label: t.rename,
      shortcut: "F2",
      action: props.onRename,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: t.duplicate,
      shortcut: "Ctrl+Shift+D",
      action: props.onDuplicate,
    },
    {
      kind: "item",
      label: t.detach,
      disabled: props.isSoleTab,
      todoTooltip: t.detachTodo,
      action: props.onDetach,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: t.moveLeft,
      shortcut: "Ctrl+Shift+←",
      disabled: !props.canMoveLeft,
      action: props.onMoveLeft,
    },
    {
      kind: "item",
      label: t.moveRight,
      shortcut: "Ctrl+Shift+→",
      disabled: !props.canMoveRight,
      action: props.onMoveRight,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: t.splitVertical,
      todoTooltip: t.splitTodo,
      action: props.onSplitVertical,
    },
    {
      kind: "item",
      label: t.splitHorizontal,
      todoTooltip: t.splitTodo,
      action: props.onSplitHorizontal,
    },
    { kind: "separator" },
    {
      kind: "item",
      label: t.closeSelf,
      shortcut: "Ctrl+W",
      action: props.onCloseSelf,
    },
    {
      kind: "item",
      label: t.closeOthers,
      disabled: props.isSoleTab,
      action: props.onCloseOthers,
    },
    {
      kind: "item",
      label: t.closeRight,
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
