# wowTerminal

AI 기반 터미널 — 외부 AI 서비스, 로컬 AI, 자체 AI 서버를 모두 활용할 수 있고, SSH 접속 정보/키를 관리해 원격 서버에 간편하게 접속할 수 있는 데스크탑 터미널 앱.

## 주요 기능 (예정)

- **멀티 AI 백엔드**
  - 외부 API: OpenAI, Anthropic, Google Gemini 등
  - 로컬: Ollama, llama.cpp 등 로컬 추론 엔진
  - 자체 호스팅: OpenAI 호환 엔드포인트 (vLLM, TGI 등)
- **SSH 매니저**: 호스트 프로필 + 키 안전 저장, 원클릭 접속
- **터미널 코어**: PTY 기반 풀 셸, xterm.js 렌더링
- **컨텍스트 인지 AI**: 현재 셸 상태/출력을 AI에 전달해 명령 추천·설명·디버깅

## 기술 스택

- **백엔드**: Rust (Tauri 2)
- **프론트엔드**: React 19 + TypeScript + Vite
- **터미널 렌더링**: xterm.js (예정)
- **PTY**: portable-pty (Rust, 예정)
- **SSH**: russh (Rust, 예정)

## 개발 시작

> 사전 요구사항: Rust stable, Node.js 20+, 시스템 의존성 (Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev` 등)

```bash
npm install
npm run tauri dev
```

## 작업 방식

- 모든 작업은 GitHub Issue로 트래킹
- `docs/work-log/YYYY-MM-DD.md`에 일자별 작업 내용 기록
- 개발 → 문서화 → 이슈 코멘트 → 이슈 클로즈 순으로 진행

## 디렉토리 구조

```
.
├── src/                  # React 프론트엔드
├── src-tauri/            # Rust 백엔드 (Tauri)
│   ├── src/
│   │   ├── ai/           # AI 백엔드 (외부/로컬/자체)
│   │   ├── ssh/          # SSH 매니저
│   │   └── pty/          # PTY (터미널 코어)
│   └── tauri.conf.json
├── docs/
│   ├── design/           # 설계 문서
│   └── work-log/         # 일자별 작업 로그
└── README.md
```

## 라이선스

[MIT](LICENSE) © CW JUNG
