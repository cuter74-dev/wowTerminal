import { useState } from "react";
import { SshKeyManager } from "./SshKeyManager";
import { LlmSetupModal } from "./LlmSetupModal";

interface Props {
  onComplete: () => void;
}

const FEATURES = [
  { icon: "🤖", title: "AI 어시스턴트", desc: "Claude · GPT · Gemini · Ollama · 자체 서버를 하나의 인터페이스로" },
  { icon: "🖥️", title: "SSH 관리", desc: "호스트·키 저장, 빠른 접속, 멀티 탭, 세션 컨텍스트 AI 인식" },
  { icon: "📁", title: "파일 전송 (SFTP)", desc: "원격 파일 브라우저, 업/다운로드, 권한 편집, 검색" },
];

export function OnboardingFlow({ onComplete }: Props) {
  const [step, setStep] = useState(0); // 0,1,2
  const [showKeys, setShowKeys] = useState(false);
  const [showLlm, setShowLlm] = useState(false);

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        background: "#1a1a20",
        color: "#e6e6e6",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: 560, maxWidth: "92vw" }}>
        {/* 단계 표시기 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: i === step ? 24 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: i === step ? "#4a9eff" : "#33343c",
                  transition: "all 0.2s",
                }}
              />
            ))}
          </div>
          <button onClick={onComplete} style={skipBtnStyle}>
            건너뛰기
          </button>
        </div>

        {step === 0 && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <img
                src="/logo.png"
                alt="AI Terminal"
                style={{ width: 72, height: 72, objectFit: "contain" }}
              />
              <h1 style={{ fontSize: 22, margin: "10px 0 4px", color: "#fff" }}>
                AI 터미널에 오신 것을 환영합니다
              </h1>
              <p style={{ color: "#9aa", fontSize: 13, margin: 0 }}>
                컨텍스트를 아는 AI 터미널 — LLM × SSH × 파일 전송을 하나로
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {FEATURES.map((f) => (
                <div key={f.title} style={cardStyle}>
                  <span style={{ fontSize: 24 }}>{f.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{f.title}</div>
                    <div style={{ color: "#9aa", fontSize: 12 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <StepCard
            icon="🔑"
            title="SSH 키 준비 (선택)"
            desc="키 기반 인증을 쓰려면 지금 키를 생성하거나 가져올 수 있어요. 비밀번호 인증만 쓸 거면 건너뛰어도 됩니다."
          >
            <button onClick={() => setShowKeys(true)} style={primaryBtnStyle}>
              🔑 SSH 키 관리 열기
            </button>
          </StepCard>
        )}

        {step === 2 && (
          <StepCard
            icon="🤖"
            title="LLM 백엔드 연결 (선택)"
            desc="OpenAI · Ollama · 호환 엔드포인트를 등록하면 AI 어시스턴트를 바로 쓸 수 있어요. 나중에 ⚙ 설정에서도 추가할 수 있습니다."
          >
            <button onClick={() => setShowLlm(true)} style={primaryBtnStyle}>
              🤖 LLM 백엔드 추가
            </button>
          </StepCard>
        )}

        {/* 내비게이션 */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{ ...navBtnStyle, visibility: step === 0 ? "hidden" : "visible" }}
          >
            ← 이전
          </button>
          {step < 2 ? (
            <button onClick={() => setStep((s) => s + 1)} style={primaryBtnStyle}>
              다음 →
            </button>
          ) : (
            <button onClick={onComplete} style={primaryBtnStyle}>
              시작하기
            </button>
          )}
        </div>
      </div>

      {showKeys && <SshKeyManager onClose={() => setShowKeys(false)} />}
      {showLlm && (
        <LlmSetupModal onClose={() => setShowLlm(false)} onChanged={() => {}} />
      )}
    </main>
  );
}

function StepCard({
  icon,
  title,
  desc,
  children,
}: {
  icon: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 44 }}>{icon}</div>
      <h2 style={{ fontSize: 18, margin: "12px 0 6px", color: "#fff" }}>{title}</h2>
      <p style={{ color: "#9aa", fontSize: 13, margin: "0 auto 18px", maxWidth: 420, lineHeight: 1.6 }}>
        {desc}
      </p>
      {children}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "#23232a",
  border: "1px solid #2f2f37",
  borderRadius: 8,
  padding: "12px 14px",
};
const primaryBtnStyle: React.CSSProperties = {
  background: "#0a5380",
  color: "#fff",
  border: "1px solid #4a9eff",
  borderRadius: 6,
  padding: "8px 18px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const navBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#ccc",
  border: "1px solid #444",
  borderRadius: 6,
  padding: "8px 16px",
  cursor: "pointer",
  fontSize: 13,
};
const skipBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#789",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
};
