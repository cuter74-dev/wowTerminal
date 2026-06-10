// tmux 세션 선택 모달 (#89). 포커스된 터미널 머신(로컬/SSH)의 tmux 세션 목록을 보여주고,
// 클릭하면 그 터미널에 attach/전환 명령을 입력으로 보낸다. 새 세션 생성도 지원.
// 명령은 tmux 안/밖 모두 동작하도록 `switch-client || attach-session` 형태로 보낸다
// (tmux 안에서는 switch-client가, 밖에서는 attach가 성공).

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TerminalSource, TmuxSessionInfo } from "../types";
import { LangDict, useT } from "../i18n";

const STR: LangDict<{
  title: string;
  loading: string;
  none: string;
  windowsN: (n: number) => string;
  attached: string;
  newPlaceholder: string;
  create: string;
}> = {
  en: { title: "tmux sessions", loading: "Loading…", none: "No tmux sessions (or tmux not installed)", windowsN: (n) => `${n} window${n === 1 ? "" : "s"}`, attached: "attached", newPlaceholder: "New session name", create: "Create & attach" },
  ko: { title: "tmux 세션", loading: "불러오는 중…", none: "tmux 세션 없음 (또는 tmux 미설치)", windowsN: (n) => `윈도우 ${n}개`, attached: "접속 중", newPlaceholder: "새 세션 이름", create: "만들고 attach" },
  es: { title: "Sesiones tmux", loading: "Cargando…", none: "Sin sesiones tmux (o tmux no instalado)", windowsN: (n) => `${n} ventana${n === 1 ? "" : "s"}`, attached: "adjunta", newPlaceholder: "Nombre de nueva sesión", create: "Crear y adjuntar" },
  zh: { title: "tmux 会话", loading: "加载中…", none: "没有 tmux 会话（或未安装 tmux）", windowsN: (n) => `${n} 个窗口`, attached: "已附加", newPlaceholder: "新会话名称", create: "创建并附加" },
  ja: { title: "tmux セッション", loading: "読み込み中…", none: "tmux セッションなし（または tmux 未インストール）", windowsN: (n) => `ウィンドウ ${n} 個`, attached: "接続中", newPlaceholder: "新しいセッション名", create: "作成してアタッチ" },
  ru: { title: "Сессии tmux", loading: "Загрузка…", none: "Нет сессий tmux (или tmux не установлен)", windowsN: (n) => `окон: ${n}`, attached: "подключена", newPlaceholder: "Имя новой сессии", create: "Создать и подключить" },
  fr: { title: "Sessions tmux", loading: "Chargement…", none: "Aucune session tmux (ou tmux non installé)", windowsN: (n) => `${n} fenêtre${n === 1 ? "" : "s"}`, attached: "attachée", newPlaceholder: "Nom de la nouvelle session", create: "Créer et attacher" },
  de: { title: "tmux-Sitzungen", loading: "Laden…", none: "Keine tmux-Sitzungen (oder tmux nicht installiert)", windowsN: (n) => `${n} Fenster`, attached: "verbunden", newPlaceholder: "Name der neuen Sitzung", create: "Erstellen & anhängen" },
  vi: { title: "Phiên tmux", loading: "Đang tải…", none: "Không có phiên tmux (hoặc chưa cài tmux)", windowsN: (n) => `${n} cửa sổ`, attached: "đã gắn", newPlaceholder: "Tên phiên mới", create: "Tạo và gắn" },
  id: { title: "Sesi tmux", loading: "Memuat…", none: "Tidak ada sesi tmux (atau tmux belum terpasang)", windowsN: (n) => `${n} jendela`, attached: "terlampir", newPlaceholder: "Nama sesi baru", create: "Buat & lampirkan" },
  hi: { title: "tmux सत्र", loading: "लोड हो रहा है…", none: "कोई tmux सत्र नहीं (या tmux इंस्टॉल नहीं)", windowsN: (n) => `${n} विंडो`, attached: "जुड़ा", newPlaceholder: "नए सत्र का नाम", create: "बनाएं और जोड़ें" },
};

/** 셸로 전송되므로 tmux 세션 이름에서 안전한 문자만 남긴다. */
function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_@-]/g, "");
}

/** 기존 세션 attach/전환 입력 (tmux 안/밖 공용). \x15 = Ctrl-U(현재 입력 줄 비움).
 *  순서가 중요하다: attach 먼저, 실패 시 switch-client. 반대(switch 먼저)로 하면 tmux 밖에서
 *  switch-client가 "다른 곳에 붙어 있는 클라이언트"를 조용히 전환하고 성공해 버려, 정작 이
 *  터미널에선 아무 일도 일어나지 않는다. attach는 밖에서 성공하고 안에서는 중첩 거부로
 *  실패하므로(stderr 숨김) 그때만 switch-client가 자기 클라이언트를 전환한다. */
export function attachInput(name: string): string {
  const n = sanitize(name);
  return `\x15tmux attach-session -t '${n}' 2>/dev/null || tmux switch-client -t '${n}'\r`;
}

/** 새 세션 생성 후 attach/전환 입력. 이름이 이미 있으면 new -d가 조용히 실패하고 attach만 된다. */
function createInput(name: string): string {
  const n = sanitize(name);
  return `\x15tmux new-session -d -s '${n}' 2>/dev/null; tmux attach-session -t '${n}' 2>/dev/null || tmux switch-client -t '${n}'\r`;
}

interface Props {
  source: TerminalSource;
  /** source가 ssh일 때 백엔드 세션 ID (목록 조회용 exec 채널에 필요). */
  sshSessionId: string | null;
  /** 선택/생성 시 (터미널로 보낼 입력, tmux 세션 이름)을 전달. */
  onPick: (input: string, sessionName: string) => void;
  onClose: () => void;
}

export function TmuxPicker({ source, sshSessionId, onPick, onClose }: Props) {
  const t = useT(STR);
  const [sessions, setSessions] = useState<TmuxSessionInfo[] | null | undefined>(
    undefined, // undefined = 로딩 중, null = 없음/미설치
  );
  const [newName, setNewName] = useState("");
  // 키보드 내비게이션: ↑/↓로 목록 선택, Enter로 attach (새 이름이 비어 있을 때).
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 입력칸에 바로 포커스 — 화살표/Enter가 여기로 들어와 키보드만으로 조작 가능.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list =
          source.kind === "ssh"
            ? sshSessionId
              ? await invoke<TmuxSessionInfo[] | null>("ssh_tmux_sessions", {
                  sessionId: sshSessionId,
                })
              : null
            : await invoke<TmuxSessionInfo[] | null>("local_tmux_sessions");
        if (alive) {
          setSessions(list ?? null);
          setSel(0);
        }
      } catch {
        if (alive) setSessions(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, sshSessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
        zIndex: 1200,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxHeight: "55vh",
          display: "flex",
          flexDirection: "column",
          background: "#16161c",
          border: "1px solid #3a3a44",
          borderRadius: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: "#cdd",
            borderBottom: "1px solid #2a2a30",
          }}
        >
          {t.title}
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {sessions === undefined && (
            <div style={{ padding: 14, fontSize: 12, color: "#789" }}>{t.loading}</div>
          )}
          {sessions === null && (
            <div style={{ padding: 14, fontSize: 12, color: "#789" }}>{t.none}</div>
          )}
          {Array.isArray(sessions) &&
            sessions.map((s, i) => (
              <div
                key={s.name}
                ref={(el) => {
                  if (i === sel && el) el.scrollIntoView({ block: "nearest" });
                }}
                onClick={() => onPick(attachInput(s.name), sanitize(s.name))}
                onMouseEnter={() => setSel(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontSize: 13,
                  color: i === sel ? "#fff" : "#e6e6e6",
                  background: i === sel ? "#094771" : "transparent",
                  fontFamily: "monospace",
                }}
              >
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.name}
                </span>
                <span style={{ fontSize: 11, color: "#789" }}>{t.windowsN(s.windows)}</span>
                {s.attached && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "#7c5",
                      border: "1px solid #3a5a3a",
                      borderRadius: 3,
                      padding: "0 4px",
                    }}
                  >
                    {t.attached}
                  </span>
                )}
              </div>
            ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: 6,
            padding: 10,
            borderTop: "1px solid #2a2a30",
          }}
        >
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(sanitize(e.target.value))}
            onKeyDown={(e) => {
              const n = Array.isArray(sessions) ? sessions.length : 0;
              if (e.key === "ArrowDown" && n > 0) {
                e.preventDefault();
                setSel((v) => Math.min(v + 1, n - 1));
              } else if (e.key === "ArrowUp" && n > 0) {
                e.preventDefault();
                setSel((v) => Math.max(v - 1, 0));
              } else if (e.key === "Enter") {
                if (newName.trim()) {
                  onPick(createInput(newName), sanitize(newName));
                } else if (Array.isArray(sessions) && sessions[sel]) {
                  // 새 이름이 비어 있으면 Enter = 선택된 세션 attach.
                  onPick(attachInput(sessions[sel].name), sanitize(sessions[sel].name));
                }
              }
            }}
            placeholder={t.newPlaceholder}
            style={{
              flex: 1,
              background: "#101015",
              border: "1px solid #2a2a30",
              color: "#fff",
              borderRadius: 4,
              padding: "6px 8px",
              fontSize: 12,
              outline: "none",
            }}
          />
          <button
            onClick={() => newName.trim() && onPick(createInput(newName), sanitize(newName))}
            disabled={!newName.trim()}
            style={{
              background: newName.trim() ? "#0a5380" : "#2a2a35",
              color: "#fff",
              border: "1px solid #4a9eff",
              borderRadius: 4,
              padding: "0 12px",
              fontSize: 12,
              cursor: newName.trim() ? "pointer" : "not-allowed",
            }}
          >
            {t.create}
          </button>
        </div>
      </div>
    </div>
  );
}
