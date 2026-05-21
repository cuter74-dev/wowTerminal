# SSH 매니저 설계 (v0.1 draft)

## 목적
SSH 호스트와 키를 한 곳에서 관리하고, UI에서 한 번 클릭으로 새 터미널 세션을 띄울 수 있게 한다.

핵심 사용자 시나리오:
1. 새 호스트 추가 (이름, host, port, user, 키파일 선택/생성)
2. 호스트 목록에서 클릭 → 곧바로 PTY 세션 열림
3. 키는 절대 평문으로 디스크에 남지 않는다.

## 데이터 모델

```rust
struct SshHost {
    id: String,           // UUID
    name: String,         // 사용자 표시 이름
    host: String,
    port: u16,            // 기본 22
    user: String,
    auth: SshAuthMethod,
    tags: Vec<String>,    // ex: ["prod", "k8s-node"]
}

enum SshAuthMethod {
    Password { secret_id: String },
    PrivateKey {
        key_id: String,
        passphrase_secret_id: Option<String>,
    },
    Agent,                // ssh-agent에 위임
}
```

## 저장 위치

| 종류 | 위치 | 형식 |
|---|---|---|
| 호스트 프로필 (메타데이터) | `~/.config/wowterminal/hosts.toml` | TOML |
| 시크릿 (비밀번호, 패스프레이즈, 개인키 원문) | OS 키링 또는 `~/.local/share/wowterminal/secrets.bin` (AES-256-GCM) | 키링 항목 또는 암호화된 KV |

호스트 프로필에는 시크릿 자체가 아니라 **`secret_id` / `key_id` 참조**만 들어간다.

## 키 저장 방식

### 1순위: OS 키링
- `keyring` crate 사용
- Linux: Secret Service (libsecret) / KWallet
- macOS: Keychain
- Windows: Credential Manager

### 2순위: 패스프레이즈 암호화 파일
- 키링이 비활성/미설치인 환경(헤드리스 Linux, SSH-only 환경) 대응
- 사용자가 앱 시작 시 마스터 패스프레이즈 1회 입력 → Argon2id로 KEK 유도 → AES-256-GCM으로 시크릿 복호화
- 메모리에 평문 보유 시간은 가능한 짧게, `zeroize`로 명시적 wiping

### 3순위: ssh-agent 위임
- 키 관리 자체를 사용자가 외부 agent에게 맡기는 경우
- wowTerminal은 단순히 agent socket을 통해 인증 위임 (별도 키 저장 X)

## 새 키 생성 흐름 (UI)
1. "키 추가" 클릭 → 모달
2. 옵션 A: 기존 키 파일 import (path 선택 → 패스프레이즈 입력)
3. 옵션 B: 새 키 생성 (ed25519 기본, 사용자가 RSA 4096도 선택 가능)
   - 생성 즉시 keystore에 암호화 저장
   - 공개키를 클립보드/파일로 export 가능
4. 가져온/생성한 키 원본 파일은 옵션 B에서는 디스크에 남기지 않는다. 옵션 A에서 가져온 외부 파일은 사용자에게 삭제 의사 확인.

## 접속 흐름 (런타임)
1. UI에서 호스트 클릭 → Tauri command `ssh_connect(host_id)`
2. 백엔드에서 `SshHost` 로드 → `secret_id`/`key_id`로 keystore 조회 → 평문 시크릿 메모리 적재
3. `russh` (또는 `thrussh`) 클라이언트로 SSH 연결, PTY 채널 요청
4. 채널의 양방향 바이트 스트림을 프론트엔드 xterm.js와 연결 (Tauri event 기반)
5. 세션 종료 시 메모리에서 시크릿 zeroize

## 모듈 구조

```
src-tauri/src/ssh/
├── mod.rs            # 공개 API
├── types.rs          # SshHost, SshAuthMethod
├── store.rs          # hosts.toml 로드/저장 (TODO)
├── keystore.rs       # keyring + 암호화 fallback (TODO)
└── session.rs        # russh 기반 접속/PTY 채널 (TODO)
```

## 보안 체크리스트
- [ ] 평문 키 파일 디스크에 두지 않음 (사용자 import 옵션 A 외)
- [ ] 메모리 평문 시크릿은 사용 직후 zeroize
- [ ] 호스트 키 검증 (known_hosts 유사 메커니즘) — TOFU + UI에서 변경 시 경고
- [ ] 잘못된 패스프레이즈 시 적절한 backoff (brute force 방지)
- [ ] 외부에서 호스트 프로필을 export할 때 시크릿은 절대 함께 export되지 않음

## 열린 질문
- 마스터 패스프레이즈 변경 시 모든 시크릿 재암호화 — UX 어떻게 노출할지.
- 키링과 패스프레이즈 파일 중 사용자가 자유롭게 골라야 할지 자동 감지로 충분할지.
- known_hosts를 OS의 `~/.ssh/known_hosts`와 공유할지 별도로 관리할지.

## 다음 단계 (TODO)
- [ ] `store.rs`, `keystore.rs` 구현
- [ ] `russh` 기반 SSH 클라이언트 + PTY 채널 (`session.rs`)
- [ ] 프론트엔드 호스트 목록 UI
- [ ] 키 생성 / import 모달
