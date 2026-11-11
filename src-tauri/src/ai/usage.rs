//! AI 요금제 사용량 (#181) — 하단 상태 표시줄용.
//!
//! 이 컴퓨터의 각 CLI가 이미 해 둔 로그인 정보를 읽어, **그 회사의 사용량 주소에만** 묻는다.
//! - Claude Code: macOS 키체인 `Claude Code-credentials`, 없으면 `~/.claude/.credentials.json`
//!   → `api.anthropic.com/api/oauth/usage` (5시간·주간 한도 %)
//! - Codex: `$CODEX_HOME/auth.json` 또는 `~/.codex/auth.json` → `chatgpt.com/backend-api/wham/usage`
//! - Gemini CLI: `~/.gemini/oauth_creds.json` → `cloudcode-pa.googleapis.com` loadCodeAssist +
//!   retrieveUserQuota (모델별 할당량)
//!
//! 토큰은 그 요청 한 번에만 메모리에서 쓴다 — 저장·기록하지 않고 다른 곳에 보내지 않는다.
//! 다른 앱의 토큰을 갱신(refresh)하지도 않는다(그 앱의 저장된 로그인이 깨질 수 있다). 만료됐으면
//! "그 CLI를 한 번 열면 갱신됩니다" 상태로 알린다. 오류 문구에도 토큰은 절대 넣지 않는다.

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

/// 한도 창 하나(예: 5시간, 주간, 모델별).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// 모델 이름처럼 창을 구분하는 이름(Gemini "Pro", Claude "Opus"). 일반 창이면 None.
    pub name: Option<String>,
    /// 사용률 0~100.
    pub used_percent: f64,
    /// 창 길이(분). 300 = 5시간, 10080 = 7일. 모르면 None.
    pub window_minutes: Option<u32>,
    /// 다시 채워지는 시각(유닉스 ms). 모르면 None.
    pub resets_at_ms: Option<i64>,
}

/// 회사 하나의 사용량.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    /// "claude" | "codex" | "gemini"
    pub provider: &'static str,
    /// "ok" | "expired"(로그인 만료 — CLI를 열면 갱신) | "error"
    pub status: &'static str,
    pub plan: Option<String>,
    pub windows: Vec<UsageWindow>,
    /// 사람이 읽을 짧은 오류(HTTP 코드 등). 토큰은 넣지 않는다.
    pub error: Option<String>,
}

impl ProviderUsage {
    fn failed(provider: &'static str, status: &'static str, error: impl Into<String>) -> Self {
        Self {
            provider,
            status,
            plan: None,
            windows: Vec::new(),
            error: Some(error.into()),
        }
    }
}

fn clamp_pct(v: f64) -> f64 {
    v.clamp(0.0, 100.0)
}

/// RFC 3339 시각 → 유닉스 ms. 해석하지 못하면 None.
pub fn parse_rfc3339_ms(s: &str) -> Option<i64> {
    // "2026-11-12T05:00:00.123456+00:00" / "...Z" — 날짜·시각·오프셋만 직접 읽는다.
    let s = s.trim();
    if s.len() < 19 {
        return None;
    }
    let num = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (
        num(0, 4)?,
        num(5, 7)?,
        num(8, 10)?,
        num(11, 13)?,
        num(14, 16)?,
        num(17, 19)?,
    );
    let mut rest = &s[19..];
    let mut ms = 0i64;
    if let Some(frac) = rest.strip_prefix('.') {
        let digits: String = frac.chars().take_while(|c| c.is_ascii_digit()).collect();
        rest = &frac[digits.len()..];
        let mut f = digits.chars().take(3).collect::<String>();
        while f.len() < 3 {
            f.push('0');
        }
        ms = f.parse().ok()?;
    }
    let offset_min = match rest {
        "" | "Z" | "z" => 0,
        o if (o.starts_with('+') || o.starts_with('-')) && o.len() >= 6 => {
            let sign = if o.starts_with('-') { -1 } else { 1 };
            let oh: i64 = o.get(1..3)?.parse().ok()?;
            let om: i64 = o.get(4..6)?.parse().ok()?;
            sign * (oh * 60 + om)
        }
        _ => return None,
    };
    // 그레고리력 날짜 → 유닉스 일수 (Howard Hinnant의 days_from_civil).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86400 + h * 3600 + mi * 60 + se - offset_min * 60;
    Some(secs * 1000 + ms)
}

// ---------------------------------------------------------------- Claude

/// Claude 사용량 응답 해석. 5시간·7일 창과, 있으면 모델별 7일 창.
pub fn parse_claude(v: &Value) -> Vec<UsageWindow> {
    let win = |key: &str, name: Option<&str>, minutes: u32| -> Option<UsageWindow> {
        let w = v.get(key)?;
        let used = w.get("utilization")?.as_f64()?;
        Some(UsageWindow {
            name: name.map(str::to_string),
            used_percent: clamp_pct(used),
            window_minutes: Some(minutes),
            resets_at_ms: w
                .get("resets_at")
                .and_then(Value::as_str)
                .and_then(parse_rfc3339_ms),
        })
    };
    [
        win("five_hour", None, 300),
        win("seven_day", None, 10080),
        win("seven_day_opus", Some("Opus"), 10080),
        win("seven_day_sonnet", Some("Sonnet"), 10080),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// Claude Code 로그인: (액세스 토큰, 만료 ms, 요금제).
fn claude_credentials() -> Option<(String, Option<i64>, Option<String>)> {
    let parse = |raw: &str| -> Option<(String, Option<i64>, Option<String>)> {
        let v: Value = serde_json::from_str(raw).ok()?;
        let o = v.get("claudeAiOauth")?;
        Some((
            o.get("accessToken")?.as_str()?.to_string(),
            o.get("expiresAt").and_then(Value::as_i64),
            o.get("subscriptionType")
                .and_then(Value::as_str)
                .map(str::to_string),
        ))
    };
    #[cfg(target_os = "macos")]
    {
        // Claude Code가 `security` 도구로 넣은 항목이라 `security`로는 묻지 않고 읽힌다.
        if let Ok(out) = std::process::Command::new("/usr/bin/security")
            .args([
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
        {
            if out.status.success() {
                if let Some(c) = parse(&String::from_utf8_lossy(&out.stdout)) {
                    return Some(c);
                }
            }
        }
    }
    let dir = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".claude")))?;
    let raw = std::fs::read_to_string(dir.join(".credentials.json")).ok()?;
    parse(&raw)
}

async fn claude_usage(http: &reqwest::Client) -> Option<ProviderUsage> {
    let (token, expires, plan) = claude_credentials()?;
    if expires.is_some_and(|e| e <= now_ms()) {
        return Some(ProviderUsage::failed("claude", "expired", "login expired"));
    }
    let res = http
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(&token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await;
    drop(token);
    Some(match res {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => ProviderUsage {
                provider: "claude",
                status: "ok",
                plan,
                windows: parse_claude(&v),
                error: None,
            },
            Err(_) => ProviderUsage::failed("claude", "error", "bad response"),
        },
        Ok(r) if r.status().as_u16() == 401 => {
            ProviderUsage::failed("claude", "expired", "login expired")
        }
        Ok(r) => ProviderUsage::failed("claude", "error", format!("HTTP {}", r.status().as_u16())),
        Err(_) => ProviderUsage::failed("claude", "error", "network"),
    })
}

// ---------------------------------------------------------------- Codex

/// Codex 사용량 응답 해석: (요금제, 창들).
pub fn parse_codex(v: &Value) -> (Option<String>, Vec<UsageWindow>) {
    let plan = v
        .get("plan_type")
        .and_then(Value::as_str)
        .map(str::to_string);
    let win = |w: Option<&Value>| -> Option<UsageWindow> {
        let w = w?;
        Some(UsageWindow {
            name: None,
            used_percent: clamp_pct(w.get("used_percent")?.as_f64()?),
            window_minutes: w
                .get("limit_window_seconds")
                .and_then(Value::as_u64)
                .map(|s| s.div_ceil(60) as u32),
            resets_at_ms: w.get("reset_at").and_then(Value::as_i64).map(|s| s * 1000),
        })
    };
    let rl = v.get("rate_limit");
    let windows = [
        win(rl.and_then(|r| r.get("primary_window"))),
        win(rl.and_then(|r| r.get("secondary_window"))),
    ]
    .into_iter()
    .flatten()
    .collect();
    (plan, windows)
}

/// JWT의 만료 시각(ms) — 서명은 확인하지 않고 페이로드의 `exp`만 본다(만료 표시용).
fn jwt_exp_ms(token: &str) -> Option<i64> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v.get("exp")?.as_i64().map(|s| s * 1000)
}

fn codex_credentials() -> Option<(String, Option<String>)> {
    let dir = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))?;
    let v: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("auth.json")).ok()?).ok()?;
    let t = v.get("tokens")?;
    Some((
        t.get("access_token")?.as_str()?.to_string(),
        t.get("account_id")
            .and_then(Value::as_str)
            .map(str::to_string),
    ))
}

async fn codex_usage(http: &reqwest::Client) -> Option<ProviderUsage> {
    let (token, account) = codex_credentials()?;
    if jwt_exp_ms(&token).is_some_and(|e| e <= now_ms()) {
        return Some(ProviderUsage::failed("codex", "expired", "login expired"));
    }
    let mut req = http
        .get("https://chatgpt.com/backend-api/wham/usage")
        .bearer_auth(&token)
        .header("Accept", "application/json");
    if let Some(a) = account.as_deref() {
        req = req.header("chatgpt-account-id", a);
    }
    let res = req.send().await;
    drop(token);
    Some(match res {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => {
                let (plan, windows) = parse_codex(&v);
                ProviderUsage {
                    provider: "codex",
                    status: "ok",
                    plan,
                    windows,
                    error: None,
                }
            }
            Err(_) => ProviderUsage::failed("codex", "error", "bad response"),
        },
        Ok(r) if r.status().as_u16() == 401 => {
            ProviderUsage::failed("codex", "expired", "login expired")
        }
        Ok(r) => ProviderUsage::failed("codex", "error", format!("HTTP {}", r.status().as_u16())),
        Err(_) => ProviderUsage::failed("codex", "error", "network"),
    })
}

// ---------------------------------------------------------------- Gemini

/// Gemini 모델 id → 짧은 이름("gemini-2.5-pro" → "2.5 Pro").
fn gemini_model_name(id: &str) -> String {
    id.trim_start_matches("gemini-")
        .split('-')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Gemini 할당량 응답 해석 — 모델별 창(사용률 높은 순).
pub fn parse_gemini_quota(v: &Value) -> Vec<UsageWindow> {
    let buckets = v
        .get("buckets")
        .and_then(Value::as_array)
        .or_else(|| v.as_array());
    let mut out: Vec<UsageWindow> = buckets
        .into_iter()
        .flatten()
        .filter_map(|b| {
            let frac = b.get("remainingFraction")?.as_f64()?;
            let id = b.get("modelId")?.as_str()?;
            Some(UsageWindow {
                name: Some(gemini_model_name(id)),
                used_percent: clamp_pct(((1.0 - frac) * 100.0).round()),
                window_minutes: None,
                resets_at_ms: b
                    .get("resetTime")
                    .and_then(Value::as_str)
                    .and_then(parse_rfc3339_ms),
            })
        })
        .collect();
    out.sort_by(|a, b| b.used_percent.total_cmp(&a.used_percent));
    out.dedup_by(|a, b| a.name == b.name);
    out
}

fn gemini_credentials() -> Option<(String, Option<i64>)> {
    let p = dirs::home_dir()?.join(".gemini").join("oauth_creds.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()?;
    Some((
        v.get("access_token")?.as_str()?.to_string(),
        v.get("expiry_date").and_then(Value::as_i64),
    ))
}

async fn gemini_usage(http: &reqwest::Client) -> Option<ProviderUsage> {
    let (token, expires) = gemini_credentials()?;
    if expires.is_some_and(|e| e <= now_ms()) {
        return Some(ProviderUsage::failed("gemini", "expired", "login expired"));
    }
    const BASE: &str = "https://cloudcode-pa.googleapis.com/v1internal";
    let load = http
        .post(format!("{BASE}:loadCodeAssist"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "metadata": { "ideType": "IDE_UNSPECIFIED", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI" }
        }))
        .send()
        .await;
    let project = match load {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.ok().and_then(|v| {
            v.get("cloudaicompanionProject")
                .and_then(Value::as_str)
                .map(str::to_string)
        }),
        Ok(r) if r.status().as_u16() == 401 => {
            return Some(ProviderUsage::failed("gemini", "expired", "login expired"))
        }
        Ok(r) => {
            return Some(ProviderUsage::failed(
                "gemini",
                "error",
                format!("HTTP {}", r.status().as_u16()),
            ))
        }
        Err(_) => return Some(ProviderUsage::failed("gemini", "error", "network")),
    };
    let Some(project) = project else {
        return Some(ProviderUsage::failed("gemini", "error", "no project"));
    };
    let res = http
        .post(format!("{BASE}:retrieveUserQuota"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "project": project }))
        .send()
        .await;
    drop(token);
    Some(match res {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => ProviderUsage {
                provider: "gemini",
                status: "ok",
                plan: None,
                windows: parse_gemini_quota(&v),
                error: None,
            },
            Err(_) => ProviderUsage::failed("gemini", "error", "bad response"),
        },
        Ok(r) => ProviderUsage::failed("gemini", "error", format!("HTTP {}", r.status().as_u16())),
        Err(_) => ProviderUsage::failed("gemini", "error", "network"),
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 로그인된 CLI들의 사용량. 로그인 정보가 없는 회사는 빠진다.
#[tauri::command]
pub async fn ai_usage() -> Result<Vec<ProviderUsage>, String> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("wowterminal/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let (c, x, g) = tokio::join!(claude_usage(&http), codex_usage(&http), gemini_usage(&http));
    Ok([c, x, g].into_iter().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rfc3339_to_ms() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339_ms("2026-11-12T05:00:00.123456+00:00"),
            Some(1_794_459_600_123)
        );
        assert_eq!(
            parse_rfc3339_ms("2026-11-12T14:00:00+09:00"),
            parse_rfc3339_ms("2026-11-12T05:00:00Z")
        );
        assert_eq!(parse_rfc3339_ms("nope"), None);
    }

    #[test]
    fn claude_windows() {
        // 실측 응답 모양(2026-11-11): five_hour가 null일 수 있다.
        let v = json!({
            "five_hour": null,
            "seven_day": { "utilization": 28.0, "resets_at": "2026-11-12T05:00:00+00:00" },
            "seven_day_opus": { "utilization": 101.0, "resets_at": null },
            "seven_day_sonnet": null,
            "extra_usage": { "is_enabled": false }
        });
        let w = parse_claude(&v);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].window_minutes, Some(10080));
        assert_eq!(w[0].used_percent, 28.0);
        assert_eq!(w[0].resets_at_ms, Some(1_794_459_600_000));
        assert_eq!(w[1].name.as_deref(), Some("Opus"));
        assert_eq!(w[1].used_percent, 100.0, "0~100으로 자른다");
    }

    #[test]
    fn codex_windows() {
        // 실측 응답 모양(2026-11-11).
        let v = json!({
            "plan_type": "pro",
            "rate_limit": {
                "primary_window": { "used_percent": 0, "limit_window_seconds": 18000, "reset_at": 1794397141 },
                "secondary_window": { "used_percent": 1, "limit_window_seconds": 604800, "reset_at": 1794467004 }
            }
        });
        let (plan, w) = parse_codex(&v);
        assert_eq!(plan.as_deref(), Some("pro"));
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].window_minutes, Some(300));
        assert_eq!(w[1].window_minutes, Some(10080));
        assert_eq!(w[1].used_percent, 1.0);
        assert_eq!(w[0].resets_at_ms, Some(1_794_397_141_000));
    }

    #[test]
    fn gemini_buckets() {
        let v = json!({ "buckets": [
            { "modelId": "gemini-2.5-flash", "remainingFraction": 0.9, "resetTime": "2026-11-12T00:00:00Z" },
            { "modelId": "gemini-2.5-pro", "remainingFraction": 0.25, "resetTime": "2026-11-12T00:00:00Z" },
            { "modelId": "bad" }
        ]});
        let w = parse_gemini_quota(&v);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].name.as_deref(), Some("2.5 Pro"));
        assert_eq!(w[0].used_percent, 75.0);
        assert_eq!(w[1].used_percent, 10.0);
    }

    /// 실제 로그인으로 사용량을 받아 본다(네트워크·이 기기 로그인 필요): 상태와 %만 출력한다.
    /// `cargo test --lib live_usage -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_usage() {
        for p in ai_usage().await.unwrap() {
            let w: Vec<String> = p
                .windows
                .iter()
                .map(|w| format!("{:?}/{:?}m {}%", w.name, w.window_minutes, w.used_percent))
                .collect();
            println!(
                "{} {} plan={:?} {:?} err={:?}",
                p.provider, p.status, p.plan, w, p.error
            );
        }
    }

    #[test]
    fn jwt_expiry() {
        use base64::Engine;
        let enc = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
        let t = format!("{}.{}.sig", enc("{}"), enc(r#"{"exp":1794397141}"#));
        assert_eq!(jwt_exp_ms(&t), Some(1_794_397_141_000));
        assert_eq!(jwt_exp_ms("not-a-jwt"), None);
    }
}
