//! 데몬 ↔ UI 프로토콜과 프레이밍 (#153).
//!
//! 프레임 = 4바이트 LE 길이 + JSON 본문. 한 연결에 **요청/응답**(id로 매칭)과
//! **서버 푸시 이벤트**(출력/종료)를 멀티플렉스한다. 터미널 바이트는 앱의 기존 관행대로
//! base64(`data_b64`)로 실어 비-UTF8도 JSON에 안전하게 담는다.
//!
//! 버전 스큐 주의: 앱이 업데이트돼도 **구버전 데몬이 살아있는 채로** 새 UI가 붙는 것이
//! 이 기능의 핵심이다. 따라서 프로토콜은 append-only로만 확장하고(새 variant/필드 추가),
//! 모르는 필드는 무시한다(serde 기본). 기존 variant의 의미/형태는 바꾸지 않는다.

use std::io;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// 프레임 최대 길이 (16MB). 스크롤백 히스토리 응답이 가장 크다.
const MAX_FRAME: usize = 16 * 1024 * 1024;

/// 클라이언트 → 데몬 요청. `op` 태그로 구분.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Req {
    /// 첫 프레임. 프로토콜 호환 확인용.
    Hello { protocol: u32 },
    PtySpawn {
        program: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
        cwd: Option<String>,
        /// 재attach 힌트 (#153): 이 세션이 데몬에 **아직 살아있으면** 새로 스폰하지 않고
        /// 그 세션 id를 그대로 돌려준다. UI 재시작 후 복원 스냅샷이 들고 있던 세션에
        /// 경합 없이 다시 붙기 위한 것 — 죽었으면 평소처럼 새로 스폰한다.
        #[serde(default)]
        attach: Option<String>,
    },
    PtyWrite { session_id: String, data_b64: String },
    PtyResize { session_id: String, cols: u16, rows: u16 },
    PtyKill { session_id: String },
    /// 세션 누적 출력(스크롤백) base64 — 재attach 시 재생용.
    SessionHistory { session_id: String },
    /// 살아있는 세션 id 목록 — UI 재시작 후 재attach 대상 판별.
    ListSessions,
}

/// 데몬 → 클라이언트 메시지. `t` 태그로 응답/이벤트 구분.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Msg {
    /// 요청 id에 대한 응답.
    Reply { id: u64, result: ReplyResult },
    /// 비요청 푸시 이벤트.
    Event { ev: Event },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "r", rename_all = "snake_case")]
pub enum ReplyResult {
    Ok { value: serde_json::Value },
    Err { message: String },
}

impl ReplyResult {
    pub fn ok<T: Serialize>(v: T) -> Self {
        match serde_json::to_value(v) {
            Ok(value) => ReplyResult::Ok { value },
            Err(e) => ReplyResult::Err { message: e.to_string() },
        }
    }
    pub fn into_result(self) -> Result<serde_json::Value, String> {
        match self {
            ReplyResult::Ok { value } => Ok(value),
            ReplyResult::Err { message } => Err(message),
        }
    }
}

/// 데몬이 푸시하는 세션 이벤트. UI는 이걸 받아 기존과 **동일한 이름의 Tauri 이벤트**로
/// 다시 emit한다(`pty:output` / `session:closed`) — 프론트 계약 불변.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "ev", rename_all = "snake_case")]
pub enum Event {
    PtyOutput { session_id: String, data_b64: String },
    SessionClosed { session_id: String },
}

/// 요청 봉투 — id로 응답을 매칭한다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub id: u64,
    #[serde(flatten)]
    pub req: Req,
}

pub async fn write_frame<W: AsyncWrite + Unpin>(w: &mut W, bytes: &[u8]) -> io::Result<()> {
    if bytes.len() > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }
    w.write_all(&(bytes.len() as u32).to_le_bytes()).await?;
    w.write_all(bytes).await?;
    w.flush().await
}

/// 한 프레임 읽기. 상대가 정상 종료했으면 `Ok(None)`.
pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_le_bytes(len) as usize;
    if n > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf).await?;
    Ok(Some(buf))
}

pub async fn write_json<W: AsyncWrite + Unpin, T: Serialize>(w: &mut W, v: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec(v).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    write_frame(w, &bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frame_roundtrip_preserves_payload() {
        let mut buf: Vec<u8> = Vec::new();
        let msg = Msg::Event {
            ev: Event::PtyOutput {
                session_id: "s1".into(),
                data_b64: "aGVsbG8=".into(),
            },
        };
        write_json(&mut buf, &msg).await.unwrap();
        let mut cur = std::io::Cursor::new(buf);
        let frame = read_frame(&mut cur).await.unwrap().expect("frame");
        let back: Msg = serde_json::from_slice(&frame).unwrap();
        match back {
            Msg::Event { ev: Event::PtyOutput { session_id, data_b64 } } => {
                assert_eq!(session_id, "s1");
                assert_eq!(data_b64, "aGVsbG8=");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[tokio::test]
    async fn read_frame_returns_none_on_clean_eof() {
        let mut cur = std::io::Cursor::new(Vec::new());
        assert!(read_frame(&mut cur).await.unwrap().is_none());
    }

    #[test]
    fn envelope_flattens_request_fields() {
        let env = Envelope { id: 7, req: Req::PtyKill { session_id: "abc".into() } };
        let v = serde_json::to_value(&env).unwrap();
        assert_eq!(v["id"], 7);
        assert_eq!(v["op"], "pty_kill");
        assert_eq!(v["session_id"], "abc");
        // 라운드트립도 동일해야 한다.
        let back: Envelope = serde_json::from_value(v).unwrap();
        assert!(matches!(back.req, Req::PtyKill { .. }));
    }

    /// 미래 버전 데몬/UI가 보낸 **모르는 필드**는 무시돼야 한다(전방호환 — 버전 스큐).
    #[test]
    fn unknown_fields_are_ignored() {
        let v = serde_json::json!({
            "id": 1, "op": "pty_resize", "session_id": "s", "cols": 80, "rows": 24,
            "future_field": {"x": 1}
        });
        let back: Envelope = serde_json::from_value(v).expect("must tolerate unknown fields");
        assert!(matches!(back.req, Req::PtyResize { cols: 80, rows: 24, .. }));
    }
}
