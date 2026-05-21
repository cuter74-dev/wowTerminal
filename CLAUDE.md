# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 따라야 하는 규칙을 정의합니다.

## 작업 흐름 (Required)

모든 작업은 다음 순서를 따릅니다:

1. **GitHub Issue 생성**
   - 작업 시작 전 `gh issue create`로 이슈를 만든다
   - 제목은 한국어 또는 영어 모두 OK, 본문에 목적/범위/완료 조건 작성
2. **작업 로그 파일 생성**
   - `docs/work-log/YYYY-MM-DD.md` 파일에 그 날의 작업을 누적 기록
   - 파일이 없으면 새로 만들고, 있으면 이어서 작성
   - 이슈 번호를 머리에 명시 (예: `## #12 — AI 백엔드 인터페이스 설계`)
3. **개발**
   - 작은 단위로 커밋, 커밋 메시지에 `(#이슈번호)` 포함
4. **문서화 & 이슈 마무리**
   - work-log에 "무엇을 / 왜 / 어떻게" 정리
   - 이슈에 결과 코멘트 (`gh issue comment`) 후 `gh issue close`

## 핵심 디렉토리

- `src/` — React + TypeScript 프론트엔드
- `src-tauri/src/` — Rust 백엔드
  - `ai/` — AI 백엔드 추상 (외부/로컬/자체)
  - `ssh/` — SSH 매니저 (호스트/키)
  - `pty/` — PTY 터미널 코어
- `docs/design/` — 설계 문서 (인터페이스, 데이터 모델 등)
- `docs/work-log/` — 일자별 작업 로그

## 보안 규칙

- API 키, SSH 개인키, 비밀번호는 절대 평문으로 저장하지 않는다
- 키 저장은 OS 키링(keyring) 또는 사용자 패스프레이즈 기반 암호화 사용
- `.env`, `*.pem`, `*.key`, `secrets/`는 `.gitignore`에 포함되어 있다

## 빌드/실행

```bash
npm install
npm run tauri dev    # 개발 모드
npm run tauri build  # 프로덕션 빌드
```
