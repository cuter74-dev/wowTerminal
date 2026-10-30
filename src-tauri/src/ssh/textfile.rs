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

/// 편집 탭(#166)이 여는 상한: 이보다 큰 파일은 앞 `HEAD_BYTES`만 읽기 전용으로 보여 준다(결정 D2).
pub const EDITOR_MAX_BYTES: u64 = 5 * 1024 * 1024;
pub const HEAD_BYTES: u64 = 1024 * 1024;

/// 편집 탭용 판정 결과 (#166). 순서: BOM → NUL(바이너리) → UTF-8 → 줄끝 혼합.
/// 쓰기 권한·크기 판정은 호출하는 쪽(files.rs)이 stat으로 먼저 한다.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Inspect {
    pub content: String,
    pub editable: bool,
    /// "too_large" | "binary" | "not_utf8" | "utf16" | "mixed_eol"
    pub reason: Option<&'static str>,
    pub eol: &'static str,
    /// UTF-8 BOM이 있었는지 — content에서는 빼고, 저장할 때 다시 붙인다.
    pub bom: bool,
}

/// `buf`는 파일 전체(또는 `truncated`면 앞부분)의 바이트.
pub fn inspect(buf: Vec<u8>, truncated: bool) -> Inspect {
    let ro = |content: String, reason: &'static str| Inspect {
        content,
        editable: false,
        reason: Some(reason),
        eol: "lf",
        bom: false,
    };
    // UTF-16은 NUL 바이트가 많아 BOM을 먼저 봐야 바이너리로 오판하지 않는다.
    if buf.starts_with(&[0xFF, 0xFE]) || buf.starts_with(&[0xFE, 0xFF]) {
        let le = buf[0] == 0xFF;
        let units: Vec<u16> = buf[2..]
            .chunks_exact(2)
            .map(|c| {
                if le {
                    u16::from_le_bytes([c[0], c[1]])
                } else {
                    u16::from_be_bytes([c[0], c[1]])
                }
            })
            .collect();
        return ro(String::from_utf16_lossy(&units), "utf16");
    }
    let bom = buf.starts_with(&[0xEF, 0xBB, 0xBF]);
    let body = if bom { buf[3..].to_vec() } else { buf };
    if truncated {
        return ro(String::from_utf8_lossy(&body).into_owned(), "too_large");
    }
    // classify와 같은 판정(상한 없음)을 쓰고 BOM 정보만 더한다.
    let t = classify(body, usize::MAX);
    Inspect {
        content: t.content,
        editable: t.editable,
        reason: t.reason,
        eol: t.eol,
        bom,
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
    fn inspect_strips_utf8_bom_and_keeps_it_editable() {
        let r = inspect(b"\xEF\xBB\xBFa\r\nb\r\n".to_vec(), false);
        assert!(r.editable);
        assert!(r.bom);
        assert_eq!(r.eol, "crlf");
        assert_eq!(r.content, "a\r\nb\r\n");
    }

    #[test]
    fn inspect_reads_utf16_as_text_not_binary() {
        // "hi" UTF-16LE + BOM — NUL이 있지만 바이너리가 아니다.
        let r = inspect(vec![0xFF, 0xFE, b'h', 0, b'i', 0], false);
        assert_eq!(r.reason, Some("utf16"));
        assert_eq!(r.content, "hi");
        let be = inspect(vec![0xFE, 0xFF, 0, b'h', 0, b'i'], false);
        assert_eq!(be.content, "hi");
    }

    #[test]
    fn inspect_truncated_is_read_only() {
        let r = inspect(b"abc".to_vec(), true);
        assert_eq!(r.reason, Some("too_large"));
        assert!(!r.editable);
        assert_eq!(inspect(b"a\0b".to_vec(), false).reason, Some("binary"));
    }

    #[test]
    fn numbered_name_matches_frontend_rule() {
        assert_eq!(numbered_name("report.txt", 1), "report (1).txt");
        assert_eq!(numbered_name("a.tar.gz", 2), "a.tar (2).gz");
        assert_eq!(numbered_name(".bashrc", 1), ".bashrc (1)");
        assert_eq!(numbered_name("Makefile", 3), "Makefile (3)");
    }
}
