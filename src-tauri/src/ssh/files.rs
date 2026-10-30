//! 파일 패널·편집 탭의 파일 연산 (#166). 로컬과 원격(SFTP)을 같은 명령·같은 알고리즘으로 다룬다
//! (`host_id`가 None이면 로컬). 파일시스템 차이는 [`Fs`] 트레이트 뒤로 숨긴다 — 저장 알고리즘을
//! 로컬 임시 폴더에서 단위 테스트하고, 원격은 같은 코드를 SFTP로 돌린다.
//!
//! 저장은 원본이 반쯤 덮인 상태로 남지 않게 한다(화면 기획서 SC-05):
//! 1. 같은 폴더에 숨김 임시 파일(".이름.wt-xxxx.tmp" — 점으로 시작해 `*.conf` 같은 glob에 안 걸림)을
//!    **새로**(배타적 생성) 만들어 내용 전체를 쓴다.
//! 2. 원래 권한을 임시 파일에 적용한다.
//! 3. 원자적 교체: 로컬 rename / 원격 `posix-rename@openssh.com`. 이 확장이 없는 서버는
//!    원본→백업 이름, 임시→원래 이름, 백업 삭제 순(일반 SFTP rename은 대상이 있으면 실패한다).
//!    어느 단계에서 끊겨도 원래 이름에는 온전한 옛 내용이나 온전한 새 내용만 있다.
//!
//! 교체 대신 직접 쓰기(기존 파일을 truncate 후 쓰기)로 하는 경우 — 교체가 오히려 해로울 때:
//! - 폴더에 쓸 수 없어 임시 파일을 못 만듦(파일 자체는 쓸 수 있는 경우).
//! - 원본 소유자가 나와 다름: 교체하면 파일 소유자가 나로 바뀐다.
//! - 하드 링크(로컬): 교체하면 다른 이름과의 연결이 끊긴다.
//!
//! 충돌 감지: 열 때의 크기·수정 시각(1MB 이하면 내용 해시까지)을 [`Stamp`]로 돌려주고, 저장 직전에
//! 다시 계산해 다르면 저장하지 않고 [`SaveOutcome::Conflict`]를 돌려준다(수정 시각은 초 단위라
//! 같은 초 안의 수정은 해시로 잡는다).

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use super::commands::SshState;
use super::textfile::{self, EDITOR_MAX_BYTES, HEAD_BYTES};

/// 이 크기 이하 파일은 충돌 감지에 내용 해시도 쓴다.
pub const HASH_MAX: u64 = 1024 * 1024;
/// 이미지 미리보기 상한 (기존 sftp_read_bytes와 같은 8MB).
pub const IMAGE_MAX: u64 = 8 * 1024 * 1024;
/// 재귀 삭제·개수 세기에서 훑는 항목 상한(악성·거대 트리 방어, 다운로드 #136과 같은 값).
const WALK_MAX_ENTRIES: u64 = 200_000;
const WALK_MAX_DEPTH: usize = 64;

#[derive(Debug, Clone, Default)]
pub struct Stat {
    pub size: u64,
    pub mtime: Option<i64>,
    pub mode: Option<u32>,
    pub uid: Option<u32>,
    pub is_dir: bool,
    pub is_symlink: bool,
    /// 하드 링크 수(로컬만 알 수 있다).
    pub nlink: Option<u64>,
}

pub enum CreateErr {
    /// 폴더에 쓸 권한이 없다 — 직접 쓰기로 대체할 수 있는 유일한 실패.
    Denied,
    Other(String),
}

#[async_trait]
pub trait Fs: Send + Sync {
    /// 링크를 따라간 stat. 없으면 None.
    async fn stat(&self, path: &str) -> Result<Option<Stat>, String>;
    /// 링크를 따라가지 않는 stat. 없으면 None.
    async fn lstat(&self, path: &str) -> Result<Option<Stat>, String>;
    async fn realpath(&self, path: &str) -> Result<String, String>;
    async fn read(&self, path: &str, max: u64) -> Result<Vec<u8>, String>;
    /// 쓰기 가능 추정. 틀려도 저장이 실패할 뿐 내용은 잃지 않는다.
    async fn writable(&self, path: &str, st: &Stat) -> bool;
    /// 배타적 생성 후 전체 쓰기. 이미 있으면 실패.
    async fn create_new(&self, path: &str, data: &[u8]) -> Result<(), CreateErr>;
    /// 있는 파일을 truncate 후 쓴다(같은 inode — 소유자·링크 유지).
    async fn write_truncate(&self, path: &str, data: &[u8]) -> Result<(), String>;
    async fn set_mode(&self, path: &str, mode: u32) -> Result<(), String>;
    /// 대상이 있어도 원자적으로 바꾼다. 지원하지 않으면 Ok(false).
    async fn replace(&self, from: &str, to: &str) -> Result<bool, String>;
    /// 대상이 있으면 실패하는 이름 바꾸기.
    async fn rename(&self, from: &str, to: &str) -> Result<(), String>;
    async fn remove_file(&self, path: &str) -> Result<(), String>;
    async fn mkdir(&self, path: &str) -> Result<(), String>;
    /// 재귀 삭제(링크는 따라가지 않고 링크 자체만 지운다). (파일 수, 폴더 수).
    async fn remove_tree(&self, path: &str) -> Result<(u64, u64), String>;
    /// 재귀 개수(삭제 확인용). (파일 수, 폴더 수, 상한에 걸려 잘렸는지).
    async fn count_tree(&self, path: &str) -> Result<(u64, u64, bool), String>;
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Stamp {
    pub size: u64,
    pub mtime: Option<i64>,
    pub hash: Option<String>,
}

pub fn hash(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// 열 때 기록한 것과 지금이 다른가. 해시는 양쪽 다 있을 때만 비교한다.
pub fn changed(expect: &Stamp, cur: &Stamp) -> bool {
    expect.size != cur.size
        || expect.mtime != cur.mtime
        || matches!((&expect.hash, &cur.hash), (Some(a), Some(b)) if a != b)
}

pub async fn current_stamp(fs: &dyn Fs, path: &str, st: &Stat) -> Result<Stamp, String> {
    let hash = if st.size <= HASH_MAX {
        Some(hash(&fs.read(path, HASH_MAX).await?))
    } else {
        None
    };
    Ok(Stamp {
        size: st.size,
        mtime: st.mtime,
        hash,
    })
}

/// `path`와 같은 폴더의 형제 경로. 원격은 '/', 로컬 Windows는 '\\'도 구분자다.
fn sibling(path: &str, name: &str) -> String {
    match path.rfind(['/', '\\']) {
        Some(i) => format!("{}{}", &path[..=i], name),
        None => name.to_string(),
    }
}

fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn random_tag() -> String {
    use rand::Rng;
    format!("{:08x}", rand::thread_rng().gen::<u32>())
}

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum SaveMethod {
    /// 임시 파일 + 원자적 교체.
    Atomic,
    /// 임시 파일 + 백업 이름을 거친 교체(posix-rename 없는 서버).
    Swap,
    DirectDirNotWritable,
    DirectOwner,
    DirectHardlink,
}

/// 원본을 반쯤 덮은 상태가 남지 않게 `data`로 바꾼다. 모듈 문서 참고.
pub async fn write_safely(
    fs: &dyn Fs,
    path: &str,
    data: &[u8],
    orig: &Stat,
) -> Result<SaveMethod, String> {
    if orig.nlink.unwrap_or(1) > 1 {
        fs.write_truncate(path, data).await?;
        return Ok(SaveMethod::DirectHardlink);
    }
    let name = base_name(path);
    let tag = random_tag();
    let tmp = sibling(path, &format!(".{name}.wt-{tag}.tmp"));
    match fs.create_new(&tmp, data).await {
        Ok(()) => {}
        Err(CreateErr::Denied) => {
            fs.write_truncate(path, data).await?;
            return Ok(SaveMethod::DirectDirNotWritable);
        }
        Err(CreateErr::Other(e)) => {
            let _ = fs.remove_file(&tmp).await;
            return Err(e);
        }
    }
    if let Some(mode) = orig.mode {
        if let Err(e) = fs.set_mode(&tmp, mode & 0o7777).await {
            let _ = fs.remove_file(&tmp).await;
            return Err(e);
        }
    }
    if let Some(owner) = orig.uid {
        let mine = fs.lstat(&tmp).await.ok().flatten().and_then(|s| s.uid);
        if mine.is_some_and(|m| m != owner) {
            let _ = fs.remove_file(&tmp).await;
            fs.write_truncate(path, data).await?;
            return Ok(SaveMethod::DirectOwner);
        }
    }
    match fs.replace(&tmp, path).await {
        Ok(true) => Ok(SaveMethod::Atomic),
        Ok(false) => {
            let bak = sibling(path, &format!(".{name}.wt-{tag}.bak"));
            if let Err(e) = fs.rename(path, &bak).await {
                let _ = fs.remove_file(&tmp).await;
                return Err(e);
            }
            if let Err(e) = fs.rename(&tmp, path).await {
                // 원본을 제자리로 되돌린다.
                let _ = fs.rename(&bak, path).await;
                let _ = fs.remove_file(&tmp).await;
                return Err(e);
            }
            let _ = fs.remove_file(&bak).await;
            Ok(SaveMethod::Swap)
        }
        Err(e) => {
            let _ = fs.remove_file(&tmp).await;
            Err(e)
        }
    }
}

#[derive(Serialize, Debug)]
pub struct Opened {
    /// 링크를 푼 실제 경로 — 저장도 여기에 한다(링크가 일반 파일로 바뀌지 않게).
    pub real_path: String,
    pub content: String,
    pub editable: bool,
    /// "too_large" | "binary" | "not_utf8" | "utf16" | "mixed_eol" | "no_permission" | "image_too_large"
    pub reason: Option<&'static str>,
    pub eol: &'static str,
    pub bom: bool,
    /// 이미지면 data URL(img 요소로만 표시한다 — SVG 속 스크립트가 실행되지 않게).
    pub image: Option<String>,
    pub stamp: Stamp,
    pub size: u64,
    pub mode: Option<u32>,
}

fn image_mime(path: &str) -> Option<&'static str> {
    let ext = base_name(path).rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// 편집 탭으로 열기. 판정 순서는 화면 기획서 SC-06(쓰기 → 크기 → BOM → NUL → UTF-8 → 줄끝).
pub async fn open(fs: &dyn Fs, path: &str) -> Result<Opened, String> {
    let real = fs.realpath(path).await?;
    let st = fs
        .stat(&real)
        .await?
        .ok_or_else(|| format!("{path}: no such file"))?;
    if st.is_dir {
        return Err(format!("{path}: is a directory"));
    }
    let base = |content: String, reason: Option<&'static str>, image: Option<String>| Opened {
        real_path: real.clone(),
        content,
        editable: false,
        reason,
        eol: "lf",
        bom: false,
        image,
        stamp: Stamp {
            size: st.size,
            mtime: st.mtime,
            hash: None,
        },
        size: st.size,
        mode: st.mode,
    };
    if let Some(mime) = image_mime(&real) {
        if st.size > IMAGE_MAX {
            return Ok(base(String::new(), Some("image_too_large"), None));
        }
        let data = fs.read(&real, IMAGE_MAX).await?;
        let url = format!("data:{mime};base64,{}", B64.encode(&data));
        return Ok(base(String::new(), None, Some(url)));
    }
    let truncated = st.size > EDITOR_MAX_BYTES;
    let buf = fs
        .read(
            &real,
            if truncated {
                HEAD_BYTES
            } else {
                EDITOR_MAX_BYTES
            },
        )
        .await?;
    let stamp_hash = (!truncated && st.size <= HASH_MAX).then(|| hash(&buf));
    let writable = fs.writable(&real, &st).await;
    let ins = textfile::inspect(buf, truncated);
    let (editable, reason) = if ins.editable && !writable {
        (false, Some("no_permission"))
    } else {
        (ins.editable, ins.reason)
    };
    Ok(Opened {
        real_path: real.clone(),
        content: ins.content,
        editable,
        reason,
        eol: ins.eol,
        bom: ins.bom,
        image: None,
        stamp: Stamp {
            size: st.size,
            mtime: st.mtime,
            hash: stamp_hash,
        },
        size: st.size,
        mode: st.mode,
    })
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SaveOutcome {
    Saved {
        stamp: Stamp,
        method: SaveMethod,
    },
    /// 열 때와 서버 파일이 다르다(None = 파일이 사라짐). 저장하지 않았다.
    Conflict {
        current: Option<Stamp>,
    },
}

/// `real_path`(open이 돌려준 실제 경로)에 저장. `force`가 아니면 먼저 충돌을 검사한다.
pub async fn save(
    fs: &dyn Fs,
    real_path: &str,
    content: &str,
    bom: bool,
    expect: &Stamp,
    force: bool,
) -> Result<SaveOutcome, String> {
    let mut data = Vec::with_capacity(content.len() + 3);
    if bom {
        data.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    data.extend_from_slice(content.as_bytes());

    let orig = fs.stat(real_path).await?;
    if !force {
        let cur = match &orig {
            Some(st) => Some(current_stamp(fs, real_path, st).await?),
            None => None,
        };
        match &cur {
            Some(c) if !changed(expect, c) => {}
            _ => return Ok(SaveOutcome::Conflict { current: cur }),
        }
    }
    let method = match &orig {
        Some(st) => write_safely(fs, real_path, &data, st).await?,
        // 사라진 파일을 "다시 만들기"로 강제 저장 — 새로 만든다.
        None => match fs.create_new(real_path, &data).await {
            Ok(()) => SaveMethod::Atomic,
            Err(CreateErr::Denied) => return Err(format!("{real_path}: permission denied")),
            Err(CreateErr::Other(e)) => return Err(e),
        },
    };
    let after = fs
        .stat(real_path)
        .await?
        .ok_or_else(|| format!("{real_path}: missing after save"))?;
    if after.size != data.len() as u64 {
        return Err(format!(
            "{real_path}: size after save is {} (expected {})",
            after.size,
            data.len()
        ));
    }
    let stamp = Stamp {
        size: after.size,
        mtime: after.mtime,
        hash: (after.size <= HASH_MAX).then(|| hash(&data)),
    };
    Ok(SaveOutcome::Saved { stamp, method })
}

// ---- 로컬 구현 ------------------------------------------------------------

pub struct LocalFs;

fn local_stat(m: &std::fs::Metadata) -> Stat {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    let mtime = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    Stat {
        size: m.len(),
        mtime,
        #[cfg(unix)]
        mode: Some(m.mode()),
        #[cfg(not(unix))]
        mode: None,
        #[cfg(unix)]
        uid: Some(m.uid()),
        #[cfg(not(unix))]
        uid: None,
        is_dir: m.is_dir(),
        is_symlink: m.file_type().is_symlink(),
        #[cfg(unix)]
        nlink: Some(m.nlink()),
        #[cfg(not(unix))]
        nlink: None,
    }
}

fn missing_ok(r: std::io::Result<std::fs::Metadata>) -> Result<Option<Stat>, String> {
    match r {
        Ok(m) => Ok(Some(local_stat(&m))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn walk_local(path: &std::path::Path, depth: usize, acc: &mut (u64, u64, bool)) {
    if acc.0 + acc.1 >= WALK_MAX_ENTRIES || depth > WALK_MAX_DEPTH {
        acc.2 = true;
        return;
    }
    let Ok(m) = std::fs::symlink_metadata(path) else {
        return;
    };
    if m.is_dir() {
        acc.1 += 1;
        if let Ok(rd) = std::fs::read_dir(path) {
            for e in rd.flatten() {
                walk_local(&e.path(), depth + 1, acc);
            }
        }
    } else {
        acc.0 += 1;
    }
}

#[async_trait]
impl Fs for LocalFs {
    async fn stat(&self, path: &str) -> Result<Option<Stat>, String> {
        missing_ok(std::fs::metadata(path))
    }
    async fn lstat(&self, path: &str) -> Result<Option<Stat>, String> {
        missing_ok(std::fs::symlink_metadata(path))
    }
    async fn realpath(&self, path: &str) -> Result<String, String> {
        std::fs::canonicalize(path)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| format!("{path}: {e}"))
    }
    async fn read(&self, path: &str, max: u64) -> Result<Vec<u8>, String> {
        use std::io::Read;
        let f = std::fs::File::open(path).map_err(|e| format!("{path}: {e}"))?;
        let mut buf = Vec::new();
        f.take(max)
            .read_to_end(&mut buf)
            .map_err(|e| format!("{path}: {e}"))?;
        Ok(buf)
    }
    async fn writable(&self, path: &str, _st: &Stat) -> bool {
        #[cfg(unix)]
        {
            // access(W_OK)는 실제 권한(그룹·root 포함)을 부작용 없이 알려 준다.
            let Ok(c) = std::ffi::CString::new(path) else {
                return false;
            };
            unsafe { libc::access(c.as_ptr(), libc::W_OK) == 0 }
        }
        #[cfg(not(unix))]
        {
            std::fs::metadata(path)
                .map(|m| !m.permissions().readonly())
                .unwrap_or(false)
        }
    }
    async fn create_new(&self, path: &str, data: &[u8]) -> Result<(), CreateErr> {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::PermissionDenied => CreateErr::Denied,
                _ => CreateErr::Other(format!("{path}: {e}")),
            })?;
        f.write_all(data)
            .and_then(|_| f.sync_all())
            .map_err(|e| CreateErr::Other(format!("{path}: {e}")))
    }
    async fn write_truncate(&self, path: &str, data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(path)
            .map_err(|e| format!("{path}: {e}"))?;
        f.write_all(data)
            .and_then(|_| f.sync_all())
            .map_err(|e| format!("{path}: {e}"))
    }
    async fn set_mode(&self, path: &str, mode: u32) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
                .map_err(|e| format!("{path}: {e}"))
        }
        #[cfg(not(unix))]
        {
            let _ = (path, mode);
            Ok(())
        }
    }
    async fn replace(&self, from: &str, to: &str) -> Result<bool, String> {
        // Unix rename(2)와 Windows MoveFileEx(REPLACE_EXISTING) 모두 대상을 원자적으로 바꾼다.
        std::fs::rename(from, to)
            .map(|_| true)
            .map_err(|e| format!("{to}: {e}"))
    }
    async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        if std::fs::symlink_metadata(to).is_ok() {
            return Err(format!("{to}: already exists"));
        }
        std::fs::rename(from, to).map_err(|e| format!("{to}: {e}"))
    }
    async fn remove_file(&self, path: &str) -> Result<(), String> {
        std::fs::remove_file(path).map_err(|e| format!("{path}: {e}"))
    }
    async fn mkdir(&self, path: &str) -> Result<(), String> {
        std::fs::create_dir(path).map_err(|e| format!("{path}: {e}"))
    }
    async fn remove_tree(&self, path: &str) -> Result<(u64, u64), String> {
        let (files, dirs, _) = self.count_tree(path).await?;
        let m = std::fs::symlink_metadata(path).map_err(|e| format!("{path}: {e}"))?;
        // remove_dir_all은 링크를 따라가지 않는다(링크 자체만 지움).
        if m.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        }
        .map_err(|e| format!("{path}: {e}"))?;
        Ok((files, dirs))
    }
    async fn count_tree(&self, path: &str) -> Result<(u64, u64, bool), String> {
        let mut acc = (0, 0, false);
        walk_local(std::path::Path::new(path), 0, &mut acc);
        Ok(acc)
    }
}

// ---- Tauri 명령 -----------------------------------------------------------

async fn get_fs(state: &SshState, host_id: Option<String>) -> Result<Box<dyn Fs>, String> {
    match host_id {
        None => Ok(Box::new(LocalFs)),
        Some(h) => Ok(Box::new(
            state.sftp.fs(&h).await.map_err(|e| e.to_string())?,
        )),
    }
}

#[tauri::command]
pub async fn file_open(
    host_id: Option<String>,
    path: String,
    state: State<'_, SshState>,
) -> Result<Opened, String> {
    let fs = get_fs(&state, host_id).await?;
    open(fs.as_ref(), &path).await
}

#[tauri::command]
pub async fn file_save(
    host_id: Option<String>,
    path: String,
    content: String,
    bom: bool,
    expect: Stamp,
    force: bool,
    state: State<'_, SshState>,
) -> Result<SaveOutcome, String> {
    let fs = get_fs(&state, host_id).await?;
    save(fs.as_ref(), &path, &content, bom, &expect, force).await
}

/// 지금 파일의 Stamp(없으면 None) — 탭으로 돌아올 때 바깥 변경 감지용.
#[tauri::command]
pub async fn file_stamp(
    host_id: Option<String>,
    path: String,
    state: State<'_, SshState>,
) -> Result<Option<Stamp>, String> {
    let fs = get_fs(&state, host_id).await?;
    match fs.stat(&path).await? {
        Some(st) => Ok(Some(current_stamp(fs.as_ref(), &path, &st).await?)),
        None => Ok(None),
    }
}

/// 빈 파일을 새로 만든다. 이미 있으면 실패(기존 sftp_touch는 있으면 비워 버린다).
#[tauri::command]
pub async fn file_create(
    host_id: Option<String>,
    path: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let fs = get_fs(&state, host_id).await?;
    fs.create_new(&path, &[]).await.map_err(|e| match e {
        CreateErr::Denied => format!("{path}: permission denied"),
        CreateErr::Other(m) => m,
    })
}

#[tauri::command]
pub async fn file_mkdir(
    host_id: Option<String>,
    path: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    get_fs(&state, host_id).await?.mkdir(&path).await
}

/// 이름 바꾸기. 대상이 있으면 실패한다(덮어쓰지 않음).
#[tauri::command]
pub async fn file_rename(
    host_id: Option<String>,
    from: String,
    to: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let fs = get_fs(&state, host_id).await?;
    if fs.lstat(&to).await?.is_some() {
        return Err(format!("{to}: already exists"));
    }
    fs.rename(&from, &to).await
}

#[derive(Serialize)]
pub struct TreeCount {
    pub files: u64,
    pub dirs: u64,
    /// 항목이 너무 많아 세다 멈췄다(실제는 더 많음).
    pub truncated: bool,
}

#[tauri::command]
pub async fn file_count(
    host_id: Option<String>,
    path: String,
    state: State<'_, SshState>,
) -> Result<TreeCount, String> {
    let (files, dirs, truncated) = get_fs(&state, host_id).await?.count_tree(&path).await?;
    Ok(TreeCount {
        files,
        dirs,
        truncated,
    })
}

/// 파일·폴더 삭제(폴더는 재귀, 링크는 따라가지 않음). 서버에는 휴지통이 없다 — UI가 먼저 확인한다.
#[tauri::command]
pub async fn file_delete(
    host_id: Option<String>,
    path: String,
    state: State<'_, SshState>,
) -> Result<TreeCount, String> {
    let (files, dirs) = get_fs(&state, host_id).await?.remove_tree(&path).await?;
    Ok(TreeCount {
        files,
        dirs,
        truncated: false,
    })
}

/// 로컬 파일을 OS 파일 관리자에서 보여 준다(Finder에서 보기).
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn();
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = {
        let dir = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        std::process::Command::new("xdg-open").arg(dir).spawn()
    };
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }
    fn p(d: &tempfile::TempDir, n: &str) -> String {
        d.path().join(n).to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn save_round_trip_and_conflict() {
        let d = dir();
        let f = p(&d, "a.conf");
        std::fs::write(&f, "one\n").unwrap();
        let o = open(&LocalFs, &f).await.unwrap();
        assert!(o.editable, "{:?}", o.reason);
        // 같은 내용이면 저장되고 Stamp가 갱신된다.
        let SaveOutcome::Saved { stamp, method } =
            save(&LocalFs, &o.real_path, "two\n", false, &o.stamp, false)
                .await
                .unwrap()
        else {
            panic!("expected saved")
        };
        assert_eq!(method, SaveMethod::Atomic);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "two\n");
        // 바깥에서 같은 크기로 바꾸면(수정 시각이 같은 초여도) 해시로 충돌을 잡는다.
        std::fs::write(&f, "TWO\n").unwrap();
        let r = save(&LocalFs, &o.real_path, "three\n", false, &stamp, false)
            .await
            .unwrap();
        assert!(
            matches!(r, SaveOutcome::Conflict { current: Some(_) }),
            "{r:?}"
        );
        assert_eq!(
            std::fs::read_to_string(&f).unwrap(),
            "TWO\n",
            "conflict must not write"
        );
        // force면 덮어쓴다.
        save(&LocalFs, &o.real_path, "three\n", false, &stamp, true)
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "three\n");
        // 임시 파일이 남지 않는다.
        let left: Vec<_> = std::fs::read_dir(d.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, vec!["a.conf".to_string()]);
    }

    #[tokio::test]
    async fn save_reports_missing_file_as_conflict() {
        let d = dir();
        let f = p(&d, "gone.txt");
        std::fs::write(&f, "x").unwrap();
        let o = open(&LocalFs, &f).await.unwrap();
        std::fs::remove_file(&f).unwrap();
        let r = save(&LocalFs, &o.real_path, "y", false, &o.stamp, false)
            .await
            .unwrap();
        assert!(matches!(r, SaveOutcome::Conflict { current: None }));
        assert!(!std::path::Path::new(&f).exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn save_keeps_mode_bom_and_symlink() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir();
        let real = p(&d, "secret.env");
        std::fs::write(&real, b"\xEF\xBB\xBFK=1\r\n").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
        let link = p(&d, "link.env");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let o = open(&LocalFs, &link).await.unwrap();
        assert_eq!(
            o.real_path,
            std::fs::canonicalize(&real).unwrap().to_string_lossy()
        );
        assert!(o.bom);
        assert_eq!(o.eol, "crlf");
        assert_eq!(o.content, "K=1\r\n");
        save(&LocalFs, &o.real_path, "K=2\r\n", o.bom, &o.stamp, false)
            .await
            .unwrap();
        assert_eq!(std::fs::read(&real).unwrap(), b"\xEF\xBB\xBFK=2\r\n");
        let mode = std::fs::metadata(&real).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "mode must be preserved");
        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink(),
            "link must stay a link"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn hardlinked_file_is_written_in_place() {
        let d = dir();
        let a = p(&d, "a");
        let b = p(&d, "b");
        std::fs::write(&a, "1").unwrap();
        std::fs::hard_link(&a, &b).unwrap();
        let o = open(&LocalFs, &a).await.unwrap();
        let SaveOutcome::Saved { method, .. } =
            save(&LocalFs, &o.real_path, "2", false, &o.stamp, false)
                .await
                .unwrap()
        else {
            panic!()
        };
        assert_eq!(method, SaveMethod::DirectHardlink);
        assert_eq!(
            std::fs::read_to_string(&b).unwrap(),
            "2",
            "link partner sees the change"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_only_dir_falls_back_to_direct_write() {
        use std::os::unix::fs::PermissionsExt;
        if unsafe { libc::geteuid() } == 0 {
            return; // root는 권한을 무시한다
        }
        let d = dir();
        let sub = d.path().join("ro");
        std::fs::create_dir(&sub).unwrap();
        let f = sub.join("x.txt").to_string_lossy().into_owned();
        std::fs::write(&f, "1").unwrap();
        std::fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o555)).unwrap();
        let o = open(&LocalFs, &f).await.unwrap();
        let r = save(&LocalFs, &o.real_path, "22", false, &o.stamp, false).await;
        std::fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o755)).unwrap();
        let SaveOutcome::Saved { method, .. } = r.unwrap() else {
            panic!()
        };
        assert_eq!(method, SaveMethod::DirectDirNotWritable);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "22");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unwritable_file_opens_read_only() {
        use std::os::unix::fs::PermissionsExt;
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let d = dir();
        let f = p(&d, "ro.txt");
        std::fs::write(&f, "1").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o444)).unwrap();
        let o = open(&LocalFs, &f).await.unwrap();
        assert!(!o.editable);
        assert_eq!(o.reason, Some("no_permission"));
    }

    #[tokio::test]
    async fn large_file_shows_head_read_only() {
        let d = dir();
        let f = p(&d, "big.log");
        std::fs::write(&f, vec![b'a'; (EDITOR_MAX_BYTES + 1) as usize]).unwrap();
        let o = open(&LocalFs, &f).await.unwrap();
        assert_eq!(o.reason, Some("too_large"));
        assert_eq!(o.content.len() as u64, HEAD_BYTES);
    }

    #[tokio::test]
    async fn rename_never_overwrites_and_tree_ops() {
        let d = dir();
        std::fs::write(p(&d, "x"), "x").unwrap();
        std::fs::write(p(&d, "y"), "y").unwrap();
        assert!(LocalFs.rename(&p(&d, "x"), &p(&d, "y")).await.is_err());
        assert_eq!(std::fs::read_to_string(p(&d, "y")).unwrap(), "y");
        std::fs::create_dir_all(d.path().join("t/u")).unwrap();
        std::fs::write(d.path().join("t/u/f"), "f").unwrap();
        std::fs::write(d.path().join("t/g"), "g").unwrap();
        let (files, dirs, trunc) = LocalFs.count_tree(&p(&d, "t")).await.unwrap();
        assert_eq!((files, dirs, trunc), (2, 2, false));
        assert_eq!(LocalFs.remove_tree(&p(&d, "t")).await.unwrap(), (2, 2));
        assert!(!d.path().join("t").exists());
    }

    #[test]
    fn sibling_and_changed() {
        assert_eq!(sibling("/etc/nginx/a.conf", ".a.tmp"), "/etc/nginx/.a.tmp");
        assert_eq!(sibling("C:\\x\\a.txt", ".a.tmp"), "C:\\x\\.a.tmp");
        let a = Stamp {
            size: 1,
            mtime: Some(5),
            hash: Some("h".into()),
        };
        assert!(!changed(&a, &a.clone()));
        assert!(changed(
            &a,
            &Stamp {
                hash: Some("z".into()),
                ..a.clone()
            }
        ));
        assert!(changed(
            &a,
            &Stamp {
                mtime: Some(6),
                ..a.clone()
            }
        ));
        assert!(!changed(
            &a,
            &Stamp {
                hash: None,
                ..a.clone()
            }
        ));
    }
}
