// 하단 AI 사용량 표시줄 (#181) — Claude·OpenAI(Codex)·Gemini 요금제 한도 사용률.
// 백엔드 `ai_usage`가 이 컴퓨터의 각 CLI 로그인으로 그 회사 서버에서 받아 온다(토큰은 저장·전송
// 하지 않는다). 로그인된 회사만 보이고, 하나도 없으면 줄 자체를 그리지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LangDict, useT } from "../i18n";
import { AGENT_COLORS, AGENT_NAMES } from "../aiActivity";

export type UsageWindow = {
  name: string | null;
  usedPercent: number;
  windowMinutes: number | null;
  resetsAtMs: number | null;
};
export type ProviderUsage = {
  provider: "claude" | "codex" | "gemini";
  status: "ok" | "expired" | "error";
  plan: string | null;
  windows: UsageWindow[];
  error: string | null;
};

const REFRESH_MS = 5 * 60 * 1000;
const FOCUS_MIN_GAP_MS = 60 * 1000;

// 회사 이름과 대표색(#184) — 에이전트 목록(#187)과 같은 값을 쓴다.
const NAMES = AGENT_NAMES;
const BRAND = AGENT_COLORS;

const STR: LangDict<{
  fiveHour: string;
  week: string;
  resets: (when: string) => string;
  expired: string;
  failed: (why: string) => string;
  refreshHint: string;
}> = {
  en: { fiveHour: "5h", week: "7d", resets: (w) => `resets ${w}`, expired: "login expired — open the CLI once to refresh", failed: (w) => `couldn't load (${w})`, refreshHint: "Click to refresh" },
  ko: { fiveHour: "5시간", week: "주간", resets: (w) => `${w}에 다시 채워짐`, expired: "로그인 만료 — CLI를 한 번 열면 갱신됩니다", failed: (w) => `불러오지 못함 (${w})`, refreshHint: "누르면 새로 고침" },
  es: { fiveHour: "5 h", week: "7 d", resets: (w) => `se restablece ${w}`, expired: "sesión caducada — abre la CLI una vez para renovarla", failed: (w) => `no se pudo cargar (${w})`, refreshHint: "Haz clic para actualizar" },
  zh: { fiveHour: "5小时", week: "每周", resets: (w) => `${w} 重置`, expired: "登录已过期 — 打开一次 CLI 即可刷新", failed: (w) => `加载失败（${w}）`, refreshHint: "点击刷新" },
  ja: { fiveHour: "5時間", week: "週間", resets: (w) => `${w} にリセット`, expired: "ログイン期限切れ — CLI を一度開くと更新されます", failed: (w) => `読み込めません（${w}）`, refreshHint: "クリックで更新" },
  ru: { fiveHour: "5 ч", week: "неделя", resets: (w) => `сброс ${w}`, expired: "вход истёк — откройте CLI один раз, чтобы обновить", failed: (w) => `не удалось загрузить (${w})`, refreshHint: "Нажмите, чтобы обновить" },
  fr: { fiveHour: "5 h", week: "7 j", resets: (w) => `réinitialisé ${w}`, expired: "connexion expirée — ouvrez la CLI une fois pour la renouveler", failed: (w) => `chargement impossible (${w})`, refreshHint: "Cliquez pour actualiser" },
  de: { fiveHour: "5 Std.", week: "7 T.", resets: (w) => `zurückgesetzt ${w}`, expired: "Anmeldung abgelaufen — CLI einmal öffnen zum Erneuern", failed: (w) => `nicht geladen (${w})`, refreshHint: "Klicken zum Aktualisieren" },
  vi: { fiveHour: "5 giờ", week: "tuần", resets: (w) => `đặt lại lúc ${w}`, expired: "đăng nhập hết hạn — mở CLI một lần để làm mới", failed: (w) => `không tải được (${w})`, refreshHint: "Bấm để làm mới" },
  id: { fiveHour: "5 jam", week: "mingguan", resets: (w) => `direset ${w}`, expired: "login kedaluwarsa — buka CLI sekali untuk memperbarui", failed: (w) => `gagal memuat (${w})`, refreshHint: "Klik untuk memuat ulang" },
  hi: { fiveHour: "5 घं.", week: "साप्ताहिक", resets: (w) => `${w} पर रीसेट`, expired: "लॉगिन समाप्त — ताज़ा करने के लिए CLI एक बार खोलें", failed: (w) => `लोड नहीं हुआ (${w})`, refreshHint: "ताज़ा करने के लिए क्लिक करें" },
};

/** 퍼센트 숫자 색 — 넉넉함(무채색)·주의(노랑, 60% 이상)·임박(빨강, 85% 이상). */
export function usageColor(pct: number): string {
  if (pct >= 85) return "#f85149";
  if (pct >= 60) return "#e3b341";
  return "#c9d1d9";
}

/** 막대 색 — 회사 대표색, 거의 다 썼으면(85% 이상) 빨강(#185). */
export function meterColor(pct: number, brand: string): string {
  return pct >= 85 ? "#f85149" : brand;
}

/** 작은 막대 게이지(#184). 조금이라도 썼으면 최소 2px은 보이게 채운다. */
function Meter({ pct, label, color }: { pct: number; label: string; color: string }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      style={{
        display: "inline-block",
        position: "relative",
        width: 46,
        height: 6,
        borderRadius: 3,
        background: "#2d333b",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <span
        data-fill
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${v}%`,
          minWidth: v > 0 ? 2 : 0,
          borderRadius: 3,
          background: meterColor(v, color),
          transition: "width 0.4s ease",
        }}
      />
    </span>
  );
}

/** 창 이름: 모델 이름이 있으면 그것, 아니면 5시간·주간. */
export function windowLabel(w: UsageWindow, t: { fiveHour: string; week: string }): string {
  if (w.name) return w.name;
  if (w.windowMinutes === 300) return t.fiveHour;
  if (w.windowMinutes === 10080) return t.week;
  if (w.windowMinutes) return w.windowMinutes % 60 === 0 ? `${w.windowMinutes / 60}h` : `${w.windowMinutes}m`;
  return "";
}

function fmtWhen(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function UsageBar({ enabled }: { enabled: boolean }) {
  const t = useT(STR);
  const [items, setItems] = useState<ProviderUsage[]>([]);
  const lastRef = useRef(0);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const r = await invoke<ProviderUsage[]>("ai_usage");
      setItems(Array.isArray(r) ? r : []);
      lastRef.current = Date.now();
    } catch {
      /* 다음 주기에 다시 */
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    void refresh();
    const iv = window.setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => {
      if (Date.now() - lastRef.current > FOCUS_MIN_GAP_MS) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  if (!enabled || items.length === 0) return null;
  return (
    <div
      data-testid="usage-bar"
      onClick={() => void refresh()}
      title={t.refreshHint}
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 18,
        height: 22,
        padding: "0 10px",
        borderTop: "1px solid #2a2a30",
        background: "#18181c",
        fontSize: 11,
        color: "#8b949e",
        cursor: "pointer",
        userSelect: "none",
        flexShrink: 0,
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {items.map((p) => {
        const name = NAMES[p.provider];
        if (p.status !== "ok") {
          const why = p.status === "expired" ? t.expired : t.failed(p.error ?? "?");
          return (
            <span key={p.provider} title={`${name}: ${why}`} style={{ opacity: 0.6 }}>
              {name} —
            </span>
          );
        }
        // Gemini처럼 모델별 창이 여럿이면 가장 많이 쓴 것 하나만 보이고 나머지는 툴팁에.
        const shown = p.provider === "gemini" ? p.windows.slice(0, 1) : p.windows.slice(0, 3);
        const tip = [
          `${name}${p.plan ? ` (${p.plan})` : ""}`,
          ...p.windows.map(
            (w) =>
              `${windowLabel(w, t)} ${Math.round(w.usedPercent)}%` +
              (w.resetsAtMs ? ` — ${t.resets(fmtWhen(w.resetsAtMs))}` : ""),
          ),
        ].join("\n");
        return (
          <span key={p.provider} title={tip} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: BRAND[p.provider], fontWeight: 600 }}>{name}</span>
            {shown.map((w, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span>{windowLabel(w, t)}</span>
                <Meter
                  pct={w.usedPercent}
                  label={`${name} ${windowLabel(w, t)}`}
                  color={BRAND[p.provider]}
                />
                <b
                  style={{
                    color: usageColor(w.usedPercent),
                    fontWeight: 600,
                    minWidth: 28,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round(w.usedPercent)}%
                </b>
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}
