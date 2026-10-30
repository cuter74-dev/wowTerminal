//! 편집용 텍스트 읽기 판정 (#165).
//!
//! 빠른 편집 팝업은 읽은 내용을 그대로 다시 써서 저장하므로, **읽은 내용이 파일 전체를
//! 바이트 그대로 담고 있을 때만** 편집을 허용해야 한다. 그렇지 않으면 저장이 곧 파일 손상이다:
//! - 상한보다 크면 앞부분만 읽었으므로 저장 시 뒤가 잘린다.
//! - NUL이 있거나(바이너리) UTF-8이 아니면 lossy 변환으로 바이트가 U+FFFD로 바뀐다.
//! - 줄끝이 섞여 있으면 웹뷰 textarea가 모두 LF로 정규화해 되돌릴 수 없다.
//!   (CRLF로만 된 파일은 프런트가 저장 시 CRLF로 되돌린다 — `eol`로 알려 준다.)

use serde::Serialize;

/// 편집 팝업이 읽는 상한. 이보다 크면 읽기 전용 미리보기.
pub const EDIT_LIMIT: usize = 256 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct TextRead {
    /// 표시할 내용(편집 불가인 경우 lossy 변환·앞부분만일 수 있음).
    pub content: String,
    /// 저장해도 파일이 바이트 그대로 보존되는지.
    pub editable: bool,
    /// 편집 불가 이유: "too_large" | "binary" | "not_utf8" | "mixed_eol".
    pub reason: Option<&'static str>,
    /// 줄끝 형식: "lf" | "crlf". 편집 가능일 때만 의미가 있다.
    pub eol: &'static str,
}

/// 읽은 바이트를 판정한다. `buf`는 **최대 `limit + 1`바이트**를 읽은 것이어야 한다
/// (`limit`을 넘었는지로 잘림 여부를 안다).
pub fn classify(mut buf: Vec<u8>, limit: usize) -> TextRead {
    let lossy = |b: &[u8]| String::from_utf8_lossy(b).into_owned();
    if buf.len() > limit {
        buf.truncate(limit);
        return read_only(lossy(&buf), "too_large");
    }
    if buf.contains(&0) {
        return read_only(lossy(&buf), "binary");
    }
    let content = match String::from_utf8(buf) {
        Ok(s) => s,
        Err(e) => return read_only(lossy(e.as_bytes()), "not_utf8"),
    };
    let cr = content.bytes().filter(|&b| b == b'\r').count();
    if cr == 0 {
        return TextRead {
            content,
            editable: true,
            reason: None,
            eol: "lf",
        };
    }
    let lf = content.bytes().filter(|&b| b == b'\n').count();
    let crlf = content.matches("\r\n").count();
    if crlf == cr && crlf == lf {
        TextRead {
            content,
            editable: true,
            reason: None,
            eol: "crlf",
        }
    } else {
        read_only(content, "mixed_eol")
    }
}

fn read_only(content: String, reason: &'static str) -> TextRead {
    TextRead {
        content,
        editable: false,
        reason: Some(reason),
        eol: "lf",
    }
}

/// 충돌을 피한 이름: `numbered_name("report.txt", 1)` → "report (1).txt".
/// 선행 점 파일(".bashrc")은 확장자가 없는 것으로 본다 → ".bashrc (1)".
/// 프런트 FileBrowser의 `uniqueName`과 같은 규칙이다.
pub fn numbered_name(name: &str, n: u32) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({n}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({n})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_utf8_lf_is_editable() {
        let r = classify("한글 a\nb\n".as_bytes().to_vec(), 100);
        assert!(r.editable);
        assert_eq!(r.eol, "lf");
        assert_eq!(r.content, "한글 a\nb\n");
    }

    #[test]
    fn pure_crlf_is_editable_with_crlf_eol() {
        let r = classify(b"a\r\nb\r\n".to_vec(), 100);
        assert!(r.editable);
        assert_eq!(r.eol, "crlf");
    }

    #[test]
    fn mixed_or_lone_cr_is_read_only() {
        assert_eq!(
            classify(b"a\r\nb\n".to_vec(), 100).reason,
            Some("mixed_eol")
        );
        assert_eq!(classify(b"a\rb".to_vec(), 100).reason, Some("mixed_eol"));
    }

    #[test]
    fn over_limit_is_read_only_and_truncated() {
        let r = classify(vec![b'x'; 11], 10);
        assert!(!r.editable);
        assert_eq!(r.reason, Some("too_large"));
        assert_eq!(r.content.len(), 10);
        // 정확히 상한이면 전부 읽은 것 — 편집 가능.
        assert!(classify(vec![b'x'; 10], 10).editable);
    }

    #[test]
    fn nul_is_binary_and_invalid_utf8_is_not_utf8() {
        assert_eq!(classify(b"ab\0cd".to_vec(), 100).reason, Some("binary"));
        // EUC-KR "한" = B0 A1 (UTF-8 아님)
        let r = classify(vec![0xB0, 0xA1, b'\n'], 100);
        assert_eq!(r.reason, Some("not_utf8"));
        assert!(!r.editable);
    }

    #[test]
    fn numbered_name_matches_frontend_rule() {
        assert_eq!(numbered_name("report.txt", 1), "report (1).txt");
        assert_eq!(numbered_name("a.tar.gz", 2), "a.tar (2).gz");
        assert_eq!(numbered_name(".bashrc", 1), ".bashrc (1)");
        assert_eq!(numbered_name("Makefile", 3), "Makefile (3)");
    }
}
