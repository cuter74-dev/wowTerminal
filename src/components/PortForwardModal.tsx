// 포트 포워딩 관리 (#60). 로컬(-L)/다이내믹(-D SOCKS5) 터널을 만들고 중지한다.
// 원격(-R)은 후속. 인증은 ssh-agent/키체인 저장 호스트 기준(비밀번호 프롬프트는 후속).

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SshHost } from "../types";
import { LangDict, useT } from "../i18n";

export interface TunnelInfo {
  id: string;
  host_id: string;
  kind: string; // "local" | "dynamic"
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
}

interface Props {
  hosts: SshHost[];
  onClose: () => void;
}

const STR: LangDict<{
  title: string;
  active: string;
  none: string;
  add: string;
  host: string;
  kind: string;
  local: string;
  dynamic: string;
  remote: string;
  localPort: string;
  remoteHost: string;
  remotePort: string;
  bindPort: string;
  targetHost: string;
  targetPort: string;
  start: string;
  stop: string;
  starting: string;
  close: string;
  hint: string;
  errHost: string;
}> = {
  en: {
    title: "Port forwarding",
    active: "Active tunnels",
    none: "No active tunnels.",
    add: "New tunnel",
    host: "Host",
    kind: "Type",
    local: "Local (-L)",
    dynamic: "Dynamic SOCKS (-D)",
    remote: "Remote (-R)",
    localPort: "Local port",
    remoteHost: "Remote host",
    remotePort: "Remote port",
    bindPort: "Remote bind port",
    targetHost: "Local target host",
    targetPort: "Local target port",
    start: "Start",
    stop: "Stop",
    starting: "Starting…",
    close: "Close",
    hint: "Auth uses ssh-agent or saved credentials.",
    errHost: "Pick a host",
  },
  ko: {
    title: "포트 포워딩",
    active: "활성 터널",
    none: "활성 터널이 없습니다.",
    add: "새 터널",
    host: "호스트",
    kind: "종류",
    local: "로컬 (-L)",
    dynamic: "다이내믹 SOCKS (-D)",
    remote: "원격 (-R)",
    localPort: "로컬 포트",
    remoteHost: "원격 호스트",
    remotePort: "원격 포트",
    bindPort: "원격 바인드 포트",
    targetHost: "로컬 대상 호스트",
    targetPort: "로컬 대상 포트",
    start: "시작",
    stop: "중지",
    starting: "시작 중…",
    close: "닫기",
    hint: "인증은 ssh-agent 또는 저장된 자격 증명 사용.",
    errHost: "호스트를 선택하세요",
  },
};

export function PortForwardModal({ hosts, onClose }: Props) {
  const t = useT(STR);
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [hostId, setHostId] = useState(hosts[0]?.id ?? "");
  const [kind, setKind] = useState<"local" | "dynamic" | "remote">("local");
  const [localPort, setLocalPort] = useState("8080");
  const [remoteHost, setRemoteHost] = useState("localhost");
  const [remotePort, setRemotePort] = useState("80");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      setTunnels(await invoke<TunnelInfo[]>("tunnel_list"));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? id;

  async function start() {
    if (!hostId) {
      setErr(t.errHost);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      if (kind === "local") {
        await invoke("tunnel_start_local", {
          hostId,
          localHost: "127.0.0.1",
          localPort: parseInt(localPort || "0", 10),
          remoteHost,
          remotePort: parseInt(remotePort || "0", 10),
        });
      } else if (kind === "remote") {
        // localPort 필드=서버 바인드 포트, remoteHost/remotePort=클라이언트 측 대상.
        await invoke("tunnel_start_remote", {
          hostId,
          bindHost: "127.0.0.1",
          bindPort: parseInt(localPort || "0", 10),
          localHost: remoteHost,
          localPort: parseInt(remotePort || "0", 10),
        });
      } else {
        await invoke("tunnel_start_dynamic", {
          hostId,
          localHost: "127.0.0.1",
          localPort: parseInt(localPort || "0", 10),
        });
      }
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop(id: string) {
    try {
      await invoke("tunnel_stop", { id });
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 60,
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "82vh",
          background: "#1e1e22",
          border: "1px solid #333",
          borderRadius: 8,
          color: "#ddd",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #2c2c30",
            fontWeight: 600,
          }}
        >
          🔀 {t.title}
        </div>

        <div style={{ padding: 16, overflow: "auto" }}>
          {/* 활성 터널 */}
          <div style={{ color: "#9aa", fontSize: 12, marginBottom: 6 }}>{t.active}</div>
          {tunnels.length === 0 ? (
            <div style={{ color: "#778", fontSize: 12, marginBottom: 16 }}>{t.none}</div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {tunnels.map((tn) => (
                <div
                  key={tn.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    background: "#26262b",
                    borderRadius: 4,
                    marginBottom: 4,
                    fontSize: 12.5,
                  }}
                >
                  <span>
                    <span style={{ color: "#7ed98a" }}>●</span>{" "}
                    {tn.kind === "remote" ? (
                      // -R: 서버 바인드 → 클라이언트 측 대상
                      <>
                        R · {tn.remote_host}:{tn.remote_port}
                        <span style={{ color: "#9aa" }}>
                          {" "}
                          → {tn.local_host}:{tn.local_port}
                        </span>
                      </>
                    ) : (
                      <>
                        {tn.kind === "local" ? "L" : "D"} · 127.0.0.1:{tn.local_port}
                        {tn.kind === "local" && (
                          <span style={{ color: "#9aa" }}>
                            {" "}
                            → {tn.remote_host}:{tn.remote_port}
                          </span>
                        )}
                      </>
                    )}{" "}
                    <span style={{ color: "#778" }}>({hostName(tn.host_id)})</span>
                  </span>
                  <button
                    onClick={() => void stop(tn.id)}
                    style={{
                      background: "#5a2020",
                      border: "1px solid #8a3a3a",
                      color: "#f0caca",
                      borderRadius: 4,
                      padding: "2px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    {t.stop}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 새 터널 폼 */}
          <div style={{ color: "#9aa", fontSize: 12, marginBottom: 6 }}>{t.add}</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "center" }}>
            <label style={lbl}>{t.host}</label>
            <select value={hostId} onChange={(e) => setHostId(e.target.value)} style={inp}>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.user}@{h.host})
                </option>
              ))}
            </select>

            <label style={lbl}>{t.kind}</label>
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as "local" | "dynamic" | "remote")
              }
              style={inp}
            >
              <option value="local">{t.local}</option>
              <option value="remote">{t.remote}</option>
              <option value="dynamic">{t.dynamic}</option>
            </select>

            <label style={lbl}>{kind === "remote" ? t.bindPort : t.localPort}</label>
            <input value={localPort} onChange={(e) => setLocalPort(e.target.value)} style={inp} />

            {(kind === "local" || kind === "remote") && (
              <>
                <label style={lbl}>
                  {kind === "remote" ? t.targetHost : t.remoteHost}
                </label>
                <input
                  value={remoteHost}
                  onChange={(e) => setRemoteHost(e.target.value)}
                  style={inp}
                />
                <label style={lbl}>
                  {kind === "remote" ? t.targetPort : t.remotePort}
                </label>
                <input
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                  style={inp}
                />
              </>
            )}
          </div>

          {err && <div style={{ color: "#e06c6c", fontSize: 12, marginTop: 10 }}>{err}</div>}
          <div style={{ color: "#667", fontSize: 11, marginTop: 10 }}>{t.hint}</div>

          <div style={{ marginTop: 14, textAlign: "right" }}>
            <button
              onClick={() => void start()}
              disabled={busy}
              style={{
                background: "#2e6aa3",
                border: "1px solid #3a7ec0",
                color: "#fff",
                borderRadius: 4,
                padding: "6px 16px",
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy ? t.starting : t.start}
            </button>
          </div>
        </div>

        <div style={{ padding: "10px 16px", borderTop: "1px solid #2c2c30", textAlign: "right" }}>
          <button
            onClick={onClose}
            style={{
              background: "#2a2a2e",
              border: "1px solid #444",
              color: "#ddd",
              borderRadius: 4,
              padding: "5px 14px",
              cursor: "pointer",
            }}
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { color: "#9aa", fontSize: 12.5 };
const inp: React.CSSProperties = {
  background: "#15151a",
  border: "1px solid #3a3a42",
  color: "#ddd",
  borderRadius: 4,
  padding: "5px 8px",
  fontSize: 12.5,
};
