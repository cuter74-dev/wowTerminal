import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBar } from "./components/TitleBar";
import { TabBar, TAB_DRAG_MIME } from "./components/TabBar";
import { TabContextMenu } from "./components/TabContextMenu";
import { HostList } from "./components/HostList";
import { AIPanel } from "./components/AIPanel";
import { PaneView } from "./components/PaneView";
import { FileBrowser } from "./components/FileBrowser";
import { SettingsModal } from "./components/SettingsModal";
import { SplashScreen } from "./components/SplashScreen";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { AppSettings, loadSettings, saveSettings } from "./settings";
import { isOnboarded, setOnboarded } from "./onboarding";
import {
  HostKeyMismatchModal,
  MismatchInfo,
} from "./components/HostKeyMismatchModal";
import {
  FirstContactModal,
  FirstContactInfo,
} from "./components/FirstContactModal";
import {
  PasswordPromptModal,
  PasswordPromptInfo,
} from "./components/PasswordPromptModal";
import { ConnectionErrorModal } from "./components/ConnectionErrorModal";
import {
  Pane,
  SshConnectError,
  SshHost,
  Tab,
  TerminalSource,
  collectLeaves,
  findLeaf,
  firstLeafId,
  neighborLeafId,
  removeLeaf,
  setRatioByPath,
  splitLeaf,
} from "./types";
import "./App.css";

/** detached 윈도우는 라벨이 "detached-..."로 시작. 동기적으로 알아야 초기 탭을 안 띄울 수 있음. */
const CURRENT_WINDOW_LABEL = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();
const IS_DETACHED_WINDOW = CURRENT_WINDOW_LABEL.startsWith("detached-");

interface DetachedInit {
  source: TerminalSource;
  label: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeLocalTab(label: string): Tab {
  const leafId = newId();
  return {
    id: newId(),
    label,
    root: { kind: "leaf", id: leafId, source: { kind: "local" } },
    focusedPaneId: leafId,
  };
}

function makeSshTab(hostId: string, label: string): Tab {
  const leafId = newId();
  return {
    id: newId(),
    label,
    root: { kind: "leaf", id: leafId, source: { kind: "ssh", hostId } },
    focusedPaneId: leafId,
  };
}

/** root의 모든 leaf id를 재발급해 복제. PTY/SSH 세션이 새로 spawn되도록. */
function cloneRootWithNewIds(root: Pane): Pane {
  if (root.kind === "leaf") {
    return { kind: "leaf", id: newId(), source: root.source };
  }
  return {
    ...root,
    first: cloneRootWithNewIds(root.first),
    second: cloneRootWithNewIds(root.second),
  };
}

function App() {
  // detached 윈도우는 백엔드 registry에서 source를 받기 전까지 빈 상태로 시작 — 메인은 즉시 로컬셸.
  const [tabs, setTabs] = useState<Tab[]>(() =>
    IS_DETACHED_WINDOW ? [] : [makeLocalTab("로컬 셸 1")],
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(() =>
    IS_DETACHED_WINDOW ? null : tabs[0].id,
  );
  const [bootstrapped, setBootstrapped] = useState<boolean>(!IS_DETACHED_WINDOW);
  // 메인 윈도우 시작 흐름: 스플래시 → (첫 실행이면) 온보딩 → 준비. detached는 바로 준비.
  const [phase, setPhase] = useState<"splash" | "onboarding" | "ready">(() =>
    IS_DETACHED_WINDOW ? "ready" : "splash",
  );
  useEffect(() => {
    if (phase !== "splash") return;
    const t = setTimeout(() => {
      setPhase(isOnboarded() ? "ready" : "onboarding");
    }, 900);
    return () => clearTimeout(t);
  }, [phase]);
  const [retryByLeaf, setRetryByLeaf] = useState<Record<string, number>>({});
  const [passwordByLeaf, setPasswordByLeaf] = useState<Record<string, string>>({});
  /** leaf id → 사용자가 모달에서 "Keychain에 저장"을 체크했는지. 접속 성공 후 처리. */
  const [rememberByLeaf, setRememberByLeaf] = useState<Record<string, boolean>>({});
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [fileBrowser, setFileBrowser] = useState<{
    hostId: string;
    hostLabel: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  function updateSettings(s: AppSettings) {
    setSettings(s);
    saveSettings(s);
  }

  const [hosts, setHosts] = useState<SshHost[]>([]);
  const reloadHosts = useCallback(async () => {
    try {
      const list = await invoke<SshHost[]>("ssh_list_hosts");
      setHosts(list);
    } catch {
      /* HostList가 별도로 에러 표시 */
    }
  }, []);
  useEffect(() => {
    void reloadHosts();
  }, [reloadHosts]);

  // detached 윈도우 부트스트랩: 백엔드 registry에서 source를 받아 첫 탭 구성.
  useEffect(() => {
    if (!IS_DETACHED_WINDOW) return;
    (async () => {
      try {
        const init = await invoke<DetachedInit | null>("detached_init");
        if (init) {
          const tab =
            init.source.kind === "local"
              ? makeLocalTab(init.label)
              : makeSshTab(init.source.hostId, init.label);
          setTabs([tab]);
          setActiveTabId(tab.id);
        } else {
          // 라벨이 detached-*인데 registry 항목이 없는 비정상 케이스 — 기본 로컬셸로 폴백.
          const fallback = makeLocalTab("로컬 셸 1");
          setTabs([fallback]);
          setActiveTabId(fallback.id);
        }
      } catch (e) {
        console.error("detached_init failed", e);
        const fallback = makeLocalTab("로컬 셸 1");
        setTabs([fallback]);
        setActiveTabId(fallback.id);
      }
      setBootstrapped(true);
    })();
  }, []);

  const localSeq = useRef(1);

  const labelForHost = useCallback(
    (hostId: string): string => {
      const h = hosts.find((x) => x.id === hostId);
      return h ? h.name : "SSH";
    },
    [hosts],
  );

  const labelForSource = useCallback(
    (source: TerminalSource): string =>
      source.kind === "local" ? "로컬 셸" : labelForHost(source.hostId),
    [labelForHost],
  );

  // hosts가 늦게 도착하면 SSH 탭 라벨 갱신.
  useEffect(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.root.kind !== "leaf") return t;
        if (t.root.source.kind !== "ssh") return t;
        return { ...t, label: labelForHost(t.root.source.hostId) };
      }),
    );
  }, [labelForHost]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );
  const focusedLeaf = useMemo(() => {
    if (!activeTab) return null;
    const leaf = findLeaf(activeTab.root, activeTab.focusedPaneId);
    return leaf && leaf.kind === "leaf" ? leaf : null;
  }, [activeTab]);
  const focusedSource: TerminalSource | null = focusedLeaf
    ? focusedLeaf.source
    : null;
  const activeHostId =
    focusedSource && focusedSource.kind === "ssh" ? focusedSource.hostId : null;
  const isLocalActive = focusedSource?.kind === "local";

  const [mismatch, setMismatch] = useState<
    (MismatchInfo & { tabId: string; leafId: string }) | null
  >(null);
  const [firstContact, setFirstContact] = useState<
    (FirstContactInfo & { tabId: string; leafId: string }) | null
  >(null);
  const [passwordPrompt, setPasswordPrompt] = useState<
    (PasswordPromptInfo & { tabId: string; leafId: string }) | null
  >(null);
  const [connError, setConnError] = useState<
    { tabId: string; leafId: string; label: string; message: string } | null
  >(null);

  const showMismatch =
    mismatch && mismatch.tabId === activeTabId ? mismatch : null;
  const showFirstContact =
    firstContact && firstContact.tabId === activeTabId ? firstContact : null;
  const showPasswordPrompt =
    passwordPrompt && passwordPrompt.tabId === activeTabId
      ? passwordPrompt
      : null;
  const showConnError =
    connError && connError.tabId === activeTabId ? connError : null;

  function handleSshError(tabId: string, leafId: string, err: SshConnectError) {
    if (err.kind === "host_key_mismatch") {
      setMismatch({
        tabId,
        leafId,
        host: err.host,
        port: err.port,
        algorithm: err.algorithm,
        stored: err.stored,
        presented: err.presented,
      });
    } else if (err.kind === "first_contact") {
      setFirstContact({
        tabId,
        leafId,
        host: err.host,
        port: err.port,
        algorithm: err.algorithm,
        fingerprint: err.fingerprint,
      });
    } else if (err.kind === "password_required") {
      setPasswordPrompt({
        tabId,
        leafId,
        host: err.host,
        port: err.port,
        user: err.user,
      });
    } else if (err.kind === "other") {
      const tab = tabs.find((t) => t.id === tabId);
      setConnError({
        tabId,
        leafId,
        label: tab?.label ?? "SSH",
        message: err.message,
      });
    }
  }

  function bumpRetry(leafId: string) {
    setRetryByLeaf((prev) => ({ ...prev, [leafId]: (prev[leafId] ?? 0) + 1 }));
  }

  /** SSH 접속 성공 시: 사용자가 keychain 저장을 요청했으면 백엔드에 위임. 어느 경우든
   *  메모리에 남은 password와 remember 플래그는 즉시 비운다 (보안). */
  async function handleSshConnected(tabId: string, leafId: string) {
    const pw = passwordByLeaf[leafId];
    const remember = rememberByLeaf[leafId];
    // 항상 클리어 — 한 번 invoke로 전달됐고 더 이상 필요 없음.
    setPasswordByLeaf((prev) => {
      if (!(leafId in prev)) return prev;
      const next = { ...prev };
      delete next[leafId];
      return next;
    });
    setRememberByLeaf((prev) => {
      if (!(leafId in prev)) return prev;
      const next = { ...prev };
      delete next[leafId];
      return next;
    });
    if (!pw || !remember) return;

    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const leaf = findLeaf(tab.root, leafId);
    if (!leaf || leaf.kind !== "leaf" || leaf.source.kind !== "ssh") return;
    const hostId = leaf.source.hostId;

    try {
      await invoke("ssh_remember_password", { args: { hostId, password: pw } });
      await reloadHosts();
    } catch (e) {
      console.error("ssh_remember_password failed", e);
      alert(`Keychain 저장 실패: ${e}`);
    }
  }

  function newLocalTab() {
    const n = ++localSeq.current;
    const tab = makeLocalTab(`로컬 셸 ${n}`);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function newSshTab(hostId: string) {
    const tab = makeSshTab(hostId, labelForHost(hostId));
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const n = ++localSeq.current;
        const fresh = makeLocalTab(`로컬 셸 ${n}`);
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (id === activeTabId) {
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTabId(newActive.id);
      }
      return next;
    });
    if (mismatch?.tabId === id) setMismatch(null);
    if (firstContact?.tabId === id) setFirstContact(null);
  }

  function renameTab(id: string, label: string) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)));
  }

  function duplicateTab(id: string) {
    const orig = tabs.find((t) => t.id === id);
    if (!orig) return;
    const root = cloneRootWithNewIds(orig.root);
    const dup: Tab = {
      id: newId(),
      label: `${orig.label} (복제)`,
      root,
      focusedPaneId: firstLeafId(root),
    };
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, dup);
      return next;
    });
    setActiveTabId(dup.id);
  }

  function moveTab(id: string, dir: -1 | 1) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });
  }

  function closeOthers(id: string) {
    const toCloseIds = tabs.filter((t) => t.id !== id).map((t) => t.id);
    setTabs((prev) => prev.filter((t) => t.id === id));
    setActiveTabId(id);
    if (mismatch && toCloseIds.includes(mismatch.tabId)) setMismatch(null);
    if (firstContact && toCloseIds.includes(firstContact.tabId))
      setFirstContact(null);
  }

  async function detachLeafToNewWindow(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const leaf = findLeaf(tab.root, tab.focusedPaneId);
    if (!leaf || leaf.kind !== "leaf") return;
    const source = leaf.source;
    const sourceArg =
      source.kind === "local"
        ? { kind: "local" }
        : { kind: "ssh", hostId: source.hostId };
    try {
      await invoke<string>("open_detached_window", {
        source: sourceArg,
        labelHint: tab.label,
      });
      // 성공 시 원본 leaf/탭 제거. v1은 세션 인계가 아니라 새 윈도우에서 새 세션 spawn.
      if (tab.root.kind === "leaf") {
        closeTab(tab.id);
      } else {
        closePane(tab.id, leaf.id);
      }
    } catch (e) {
      alert(`새 창 생성 실패: ${e}`);
    }
  }

  /** 특정 호스트로 향하는 모든 leaf를 로컬셸로 swap (호스트 삭제 직후 호출). */
  function detachHostFromAllTabs(hostId: string) {
    setTabs((prev) =>
      prev.map((t) => {
        const newRoot = swapHostLeavesToLocal(t.root, hostId);
        if (newRoot === t.root) return t;
        // 단일 leaf 탭이 변경된 경우 라벨도 갱신
        if (newRoot.kind === "leaf" && t.root.kind === "leaf") {
          const n = ++localSeq.current;
          return { ...t, root: newRoot, label: `로컬 셸 ${n}` };
        }
        return { ...t, root: newRoot };
      }),
    );
  }

  /** 활성 탭/패널 중 hostId를 가진 leaf의 수. */
  const activeSessionCountForHost = useCallback(
    (hostId: string): number => {
      return tabs.reduce((acc, tab) => {
        return (
          acc +
          collectLeaves(tab.root).filter(
            (l) => l.source.kind === "ssh" && l.source.hostId === hostId,
          ).length
        );
      }, 0);
    },
    [tabs],
  );

  function closeRight(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const keep = prev.slice(0, idx + 1);
      if (!keep.find((t) => t.id === activeTabId)) {
        setActiveTabId(id);
      }
      return keep;
    });
  }

  // --- 단일 클릭/로컬 클릭: 활성 탭의 focused leaf source 변경 -------------

  function selectLocalForActive() {
    if (!activeTab || !focusedLeaf) return;
    if (focusedLeaf.source.kind === "local") return;
    const leafId = focusedLeaf.id;
    const n = ++localSeq.current;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        return {
          ...t,
          root: replaceLeafSource(t.root, leafId, { kind: "local" }),
          // 단일 leaf인 경우엔 탭 라벨도 자동 갱신
          label: t.root.kind === "leaf" ? `로컬 셸 ${n}` : t.label,
        };
      }),
    );
    if (mismatch?.leafId === leafId) setMismatch(null);
    if (firstContact?.leafId === leafId) setFirstContact(null);
  }

  function selectHostForActive(hostId: string) {
    if (!activeTab || !focusedLeaf) return;
    if (
      focusedLeaf.source.kind === "ssh" &&
      focusedLeaf.source.hostId === hostId
    ) {
      return;
    }
    const leafId = focusedLeaf.id;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        return {
          ...t,
          root: replaceLeafSource(t.root, leafId, { kind: "ssh", hostId }),
          label: t.root.kind === "leaf" ? labelForHost(hostId) : t.label,
        };
      }),
    );
    if (mismatch?.leafId === leafId) setMismatch(null);
    if (firstContact?.leafId === leafId) setFirstContact(null);
  }

  // --- 분할 / 패널 액션 ----------------------------------------------------

  function splitActivePane(direction: "vertical" | "horizontal") {
    if (!activeTab || !focusedLeaf) return;
    const newLeafId = newId();
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        const root = splitLeaf(
          t.root,
          focusedLeaf.id,
          { kind: "leaf", id: newLeafId, source: focusedLeaf.source },
          direction,
        );
        return { ...t, root, focusedPaneId: newLeafId };
      }),
    );
  }

  function closePane(tabId: string, leafId: string) {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const root = removeLeaf(t.root, leafId);
        if (!root) {
          // root가 단일 leaf였음 → 탭 자체를 닫아야 함. 우선 placeholder로 두고
          // 외부에서 closeTab(tabId)로 처리.
          return t;
        }
        const nextFocus =
          t.focusedPaneId === leafId ? firstLeafId(root) : t.focusedPaneId;
        return { ...t, root, focusedPaneId: nextFocus };
      }),
    );
    // 분할이 아닌 경우 (single leaf) → 탭 닫기로 위임
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.root.kind === "leaf" && tab.root.id === leafId) {
      closeTab(tabId);
    }
    if (mismatch?.leafId === leafId) setMismatch(null);
    if (firstContact?.leafId === leafId) setFirstContact(null);
  }

  function focusPane(tabId: string, leafId: string) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, focusedPaneId: leafId } : t,
      ),
    );
  }

  function setPaneRatio(tabId: string, path: number[], ratio: number) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, root: setRatioByPath(t.root, path, ratio) } : t,
      ),
    );
  }

  function focusNeighborOrSwitchTab(
    arrow: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  ) {
    if (!activeTab) return;
    // 분할이 있는 경우 — 같은 탭 내에서 인접 leaf로 focus 이동
    if (activeTab.root.kind === "split") {
      const dirMap = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      } as const;
      const target = neighborLeafId(
        activeTab.root,
        activeTab.focusedPaneId,
        dirMap[arrow],
      );
      if (target) {
        focusPane(activeTab.id, target);
        return;
      }
    }
    // 분할이 없거나 인접 패널이 없으면 탭 좌/우 이동으로 사용
    if (arrow === "ArrowLeft") {
      moveTab(activeTab.id, -1);
    } else if (arrow === "ArrowRight") {
      moveTab(activeTab.id, 1);
    }
  }

  // 키보드 단축키
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingTabId) return;

      if (
        e.key === "F2" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        if (activeTabId) {
          e.preventDefault();
          setEditingTabId(activeTabId);
        }
        return;
      }

      if (!e.ctrlKey && !e.metaKey) return;

      // Ctrl+Shift+L — 좌우 분할 (vertical)
      if ((e.key === "l" || e.key === "L") && e.shiftKey) {
        e.preventDefault();
        splitActivePane("vertical");
        return;
      }
      // Ctrl+Shift+S — 상하 분할 (horizontal)
      // 와이어프레임은 Ctrl+Shift+D 였으나 '탭 복제'와 충돌해 S로 이전. 메뉴 텍스트만 일관 유지.
      if ((e.key === "s" || e.key === "S") && e.shiftKey) {
        e.preventDefault();
        splitActivePane("horizontal");
        return;
      }
      // Ctrl+Shift+D — 탭 복제
      if ((e.key === "d" || e.key === "D") && e.shiftKey) {
        e.preventDefault();
        if (activeTabId) duplicateTab(activeTabId);
        return;
      }
      // Ctrl+Shift+방향키 — 분할이 있으면 패널 포커스 이동, 아니면 탭 좌/우 이동
      if (
        e.shiftKey &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown")
      ) {
        e.preventDefault();
        focusNeighborOrSwitchTab(e.key);
        return;
      }
      // Ctrl+T — 새 로컬 셸 탭
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        newLocalTab();
        return;
      }
      // Ctrl+W — 활성 탭 닫기
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
        return;
      }
      // Ctrl+Tab / Ctrl+Shift+Tab — 다음/이전 탭
      if (e.key === "Tab") {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx < 0) return;
        const step = e.shiftKey ? -1 : 1;
        const nextIdx = (idx + step + tabs.length) % tabs.length;
        setActiveTabId(tabs[nextIdx].id);
        return;
      }
      // Ctrl+숫자 — N번째 탭
      if (e.key.length === 1 && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < tabs.length) {
          e.preventDefault();
          setActiveTabId(tabs[idx].id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeTabId, editingTabId, activeTab, focusedLeaf]);

  if (!bootstrapped) {
    return (
      <main
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e1e1e",
          color: "#9aa",
          fontSize: 13,
        }}
      >
        분리된 창 초기화 중…
      </main>
    );
  }

  if (phase === "splash") return <SplashScreen />;
  if (phase === "onboarding") {
    return (
      <OnboardingFlow
        onComplete={() => {
          setOnboarded();
          setPhase("ready");
        }}
      />
    );
  }

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
        color: "#e6e6e6",
      }}
    >
      <TitleBar
        activeTab={activeTab}
        tabCount={tabs.length}
        canOpenFiles={!!activeHostId}
        onOpenFiles={() => {
          if (activeHostId) {
            setFileBrowser({
              hostId: activeHostId,
              hostLabel: labelForHost(activeHostId),
            });
          }
        }}
        onOpenSettings={() => setShowSettings(true)}
      />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        editingTabId={editingTabId}
        onActivate={setActiveTabId}
        onClose={closeTab}
        onNew={newLocalTab}
        onContextMenu={(tabId, x, y) => setContextMenu({ tabId, x, y })}
        onRenameCommit={(id, label) => {
          renameTab(id, label);
          setEditingTabId(null);
        }}
        onRenameCancel={() => setEditingTabId(null)}
        onDragStart={(id) => setDraggingTabId(id)}
        onDragEnd={() => setDraggingTabId(null)}
      />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <HostList
          activeHostId={activeHostId}
          isLocalActive={!!isLocalActive}
          onSelect={selectHostForActive}
          onOpenInNewTab={(id) => {
            void reloadHosts();
            newSshTab(id);
          }}
          onSelectLocal={selectLocalForActive}
          activeSessionCountForHost={activeSessionCountForHost}
          onHostDeleted={(id) => {
            detachHostFromAllTabs(id);
            void reloadHosts();
          }}
        />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{
                display: tab.id === activeTabId ? "flex" : "none",
                flex: 1,
                minHeight: 0,
              }}
            >
              <PaneView
                pane={tab.root}
                focusedPaneId={tab.focusedPaneId}
                showHeaders={tab.root.kind === "split"}
                onFocus={(leafId) => focusPane(tab.id, leafId)}
                onClosePane={(leafId) => closePane(tab.id, leafId)}
                onRatioChange={(path, ratio) =>
                  setPaneRatio(tab.id, path, ratio)
                }
                onSshError={(leafId, err) =>
                  handleSshError(tab.id, leafId, err)
                }
                onSshConnected={(leafId) => handleSshConnected(tab.id, leafId)}
                retryByLeaf={retryByLeaf}
                passwordByLeaf={passwordByLeaf}
                labelForSource={labelForSource}
                termSettings={settings.terminal}
              />
            </div>
          ))}
        </div>

        <AIPanel
          activeTab={activeTab}
          focusedSource={focusedSource}
          focusedPaneId={activeTab?.focusedPaneId ?? null}
          paneCount={activeTab ? collectLeaves(activeTab.root).length : 0}
          contextLabel={
            focusedSource && focusedSource.kind === "ssh"
              ? labelForHost(focusedSource.hostId)
              : undefined
          }
        />
      </div>

      {fileBrowser && (
        <FileBrowser
          hostId={fileBrowser.hostId}
          hostLabel={fileBrowser.hostLabel}
          onClose={() => setFileBrowser(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {draggingTabId && (
        <DropZoneOverlay
          onDrop={(id) => {
            setDraggingTabId(null);
            void detachLeafToNewWindow(id);
          }}
          onCancel={() => setDraggingTabId(null)}
        />
      )}

      {contextMenu &&
        (() => {
          const target = tabs.find((t) => t.id === contextMenu.tabId);
          if (!target) return null;
          const idx = tabs.findIndex((t) => t.id === contextMenu.tabId);
          return (
            <TabContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              tabLabel={target.label}
              isSoleTab={tabs.length === 1}
              hasRightTabs={idx < tabs.length - 1}
              canMoveLeft={idx > 0}
              canMoveRight={idx < tabs.length - 1}
              onDismiss={() => setContextMenu(null)}
              onRename={() => setEditingTabId(contextMenu.tabId)}
              onDuplicate={() => duplicateTab(contextMenu.tabId)}
              onDetach={() => {
                void detachLeafToNewWindow(contextMenu.tabId);
              }}
              onMoveLeft={() => moveTab(contextMenu.tabId, -1)}
              onMoveRight={() => moveTab(contextMenu.tabId, 1)}
              onSplitVertical={() => {
                setActiveTabId(contextMenu.tabId);
                splitActivePane("vertical");
              }}
              onSplitHorizontal={() => {
                setActiveTabId(contextMenu.tabId);
                splitActivePane("horizontal");
              }}
              onCloseSelf={() => closeTab(contextMenu.tabId)}
              onCloseOthers={() => closeOthers(contextMenu.tabId)}
              onCloseRight={() => closeRight(contextMenu.tabId)}
            />
          );
        })()}

      {showFirstContact && (
        <FirstContactModal
          info={{
            host: showFirstContact.host,
            port: showFirstContact.port,
            algorithm: showFirstContact.algorithm,
            fingerprint: showFirstContact.fingerprint,
          }}
          onCancel={() => setFirstContact(null)}
          onTrusted={() => {
            const leafId = showFirstContact.leafId;
            setFirstContact(null);
            bumpRetry(leafId);
          }}
        />
      )}
      {showConnError && (
        <ConnectionErrorModal
          info={{ label: showConnError.label, message: showConnError.message }}
          onClose={() => setConnError(null)}
          onRetry={() => {
            const leafId = showConnError.leafId;
            setConnError(null);
            bumpRetry(leafId);
          }}
        />
      )}

      {showPasswordPrompt && (
        <PasswordPromptModal
          info={{
            host: showPasswordPrompt.host,
            port: showPasswordPrompt.port,
            user: showPasswordPrompt.user,
          }}
          onCancel={() => setPasswordPrompt(null)}
          onSubmit={(pw, remember) => {
            const leafId = showPasswordPrompt.leafId;
            setPasswordByLeaf((prev) => ({ ...prev, [leafId]: pw }));
            setRememberByLeaf((prev) => ({ ...prev, [leafId]: remember }));
            setPasswordPrompt(null);
            bumpRetry(leafId);
          }}
        />
      )}

      {showMismatch && (
        <HostKeyMismatchModal
          info={{
            host: showMismatch.host,
            port: showMismatch.port,
            algorithm: showMismatch.algorithm,
            stored: showMismatch.stored,
            presented: showMismatch.presented,
          }}
          onCancel={() => setMismatch(null)}
          onTrusted={() => {
            const leafId = showMismatch.leafId;
            setMismatch(null);
            bumpRetry(leafId);
          }}
        />
      )}
    </main>
  );
}

/** 드래그 분리(S-008) 드롭존: 탭바 아래 영역 전체를 덮는 반투명 오버레이. */
function DropZoneOverlay({
  onDrop,
  onCancel,
}: {
  onDrop: (tabId: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData(TAB_DRAG_MIME);
        if (id) onDrop(id);
        else onCancel();
      }}
      style={{
        position: "fixed",
        inset: "66px 0 0 0", // 타이틀바(32) + 탭바(34) 아래 — 탭바로 다시 드래그하면 dragend로 취소
        background: "rgba(10, 16, 32, 0.55)",
        border: "2px dashed #4a9eff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        zIndex: 900,
        color: "#fff",
        textAlign: "center",
        userSelect: "none",
        pointerEvents: "all",
      }}
    >
      <div style={{ fontSize: 32 }}>🔲</div>
      <div style={{ fontSize: 16 }}>새 창으로 분리</div>
      <div style={{ fontSize: 12, color: "#bcd" }}>
        여기에 드롭하면 이 탭이 새 창으로 열립니다. ESC: 취소
      </div>
    </div>
  );
}

/** root 트리에서 hostId 매칭 leaf를 모두 로컬셸로 swap. 변경이 없으면 동일 참조 반환. */
function swapHostLeavesToLocal(root: Pane, hostId: string): Pane {
  if (root.kind === "leaf") {
    if (root.source.kind === "ssh" && root.source.hostId === hostId) {
      return { ...root, source: { kind: "local" } };
    }
    return root;
  }
  const f = swapHostLeavesToLocal(root.first, hostId);
  const s = swapHostLeavesToLocal(root.second, hostId);
  if (f === root.first && s === root.second) return root;
  return { ...root, first: f, second: s };
}

/** root 트리에서 특정 leaf의 source만 교체. */
function replaceLeafSource(
  root: Pane,
  leafId: string,
  source: TerminalSource,
): Pane {
  if (root.kind === "leaf") {
    return root.id === leafId ? { ...root, source } : root;
  }
  return {
    ...root,
    first: replaceLeafSource(root.first, leafId, source),
    second: replaceLeafSource(root.second, leafId, source),
  };
}

export default App;
