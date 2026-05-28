import { useState } from "react";
import { SshKeyManager } from "./SshKeyManager";
import { LlmSetupModal } from "./LlmSetupModal";
import { LangDict, useT } from "../i18n";

interface Props {
  onComplete: () => void;
}

interface Feature {
  icon: string;
  title: string;
  desc: string;
}

const STR: LangDict<{
    skip: string;
    welcomeTitle: string;
    welcomeSubtitle: string;
    features: Feature[];
    sshStepTitle: string;
    sshStepDesc: string;
    sshStepBtn: string;
    llmStepTitle: string;
    llmStepDesc: string;
    llmStepBtn: string;
    prev: string;
    next: string;
    start: string;
  }
> = {
  en: {
    skip: "Skip",
    welcomeTitle: "Welcome to AI Terminal",
    welcomeSubtitle: "A context-aware AI terminal — LLM × SSH × file transfer in one",
    features: [
      { icon: "🤖", title: "AI Assistant", desc: "Claude · GPT · Gemini · Ollama · your own server in one interface" },
      { icon: "🖥️", title: "SSH Management", desc: "Save hosts and keys, quick connect, multi-tab, session-context AI awareness" },
      { icon: "📁", title: "File Transfer (SFTP)", desc: "Remote file browser, up/download, permission editing, search" },
    ],
    sshStepTitle: "Prepare SSH keys (optional)",
    sshStepDesc:
      "If you want key-based authentication, you can create or import a key now. If you'll only use password authentication, feel free to skip.",
    sshStepBtn: "🔑 Open SSH key manager",
    llmStepTitle: "Connect an LLM backend (optional)",
    llmStepDesc:
      "Register OpenAI · Ollama · a compatible endpoint to start using the AI assistant right away. You can also add one later in ⚙ Settings.",
    llmStepBtn: "🤖 Add LLM backend",
    prev: "← Previous",
    next: "Next →",
    start: "Get started",
  },
  ko: {
    skip: "건너뛰기",
    welcomeTitle: "AI 터미널에 오신 것을 환영합니다",
    welcomeSubtitle: "컨텍스트를 아는 AI 터미널 — LLM × SSH × 파일 전송을 하나로",
    features: [
      { icon: "🤖", title: "AI 어시스턴트", desc: "Claude · GPT · Gemini · Ollama · 자체 서버를 하나의 인터페이스로" },
      { icon: "🖥️", title: "SSH 관리", desc: "호스트·키 저장, 빠른 접속, 멀티 탭, 세션 컨텍스트 AI 인식" },
      { icon: "📁", title: "파일 전송 (SFTP)", desc: "원격 파일 브라우저, 업/다운로드, 권한 편집, 검색" },
    ],
    sshStepTitle: "SSH 키 준비 (선택)",
    sshStepDesc:
      "키 기반 인증을 쓰려면 지금 키를 생성하거나 가져올 수 있어요. 비밀번호 인증만 쓸 거면 건너뛰어도 됩니다.",
    sshStepBtn: "🔑 SSH 키 관리 열기",
    llmStepTitle: "LLM 백엔드 연결 (선택)",
    llmStepDesc:
      "OpenAI · Ollama · 호환 엔드포인트를 등록하면 AI 어시스턴트를 바로 쓸 수 있어요. 나중에 ⚙ 설정에서도 추가할 수 있습니다.",
    llmStepBtn: "🤖 LLM 백엔드 추가",
    prev: "← 이전",
    next: "다음 →",
    start: "시작하기",
  },
  es: {
    skip: "Omitir",
    welcomeTitle: "Bienvenido a AI Terminal",
    welcomeSubtitle: "Un terminal de IA con conciencia de contexto — LLM × SSH × transferencia de archivos en uno",
    features: [
      { icon: "🤖", title: "Asistente de IA", desc: "Claude · GPT · Gemini · Ollama · tu propio servidor en una sola interfaz" },
      { icon: "🖥️", title: "Gestión de SSH", desc: "Guarda hosts y claves, conexión rápida, multipestaña, IA consciente del contexto de sesión" },
      { icon: "📁", title: "Transferencia de archivos (SFTP)", desc: "Explorador de archivos remoto, subida/descarga, edición de permisos, búsqueda" },
    ],
    sshStepTitle: "Preparar claves SSH (opcional)",
    sshStepDesc:
      "Si quieres autenticación basada en claves, puedes crear o importar una clave ahora. Si solo usarás autenticación por contraseña, puedes omitir esto.",
    sshStepBtn: "🔑 Abrir gestor de claves SSH",
    llmStepTitle: "Conectar un backend LLM (opcional)",
    llmStepDesc:
      "Registra OpenAI · Ollama · un endpoint compatible para empezar a usar el asistente de IA de inmediato. También puedes añadir uno más tarde en ⚙ Configuración.",
    llmStepBtn: "🤖 Añadir backend LLM",
    prev: "← Anterior",
    next: "Siguiente →",
    start: "Comenzar",
  },
  zh: {
    skip: "跳过",
    welcomeTitle: "欢迎使用 AI Terminal",
    welcomeSubtitle: "情境感知的 AI 终端 — LLM × SSH × 文件传输，三合一",
    features: [
      { icon: "🤖", title: "AI 助手", desc: "Claude · GPT · Gemini · Ollama · 你自己的服务器，统一界面" },
      { icon: "🖥️", title: "SSH 管理", desc: "保存主机和密钥、快速连接、多标签页、会话情境 AI 感知" },
      { icon: "📁", title: "文件传输 (SFTP)", desc: "远程文件浏览器、上传/下载、权限编辑、搜索" },
    ],
    sshStepTitle: "准备 SSH 密钥（可选）",
    sshStepDesc:
      "如果你想使用基于密钥的身份验证，现在可以创建或导入密钥。如果你只使用密码身份验证，可以跳过。",
    sshStepBtn: "🔑 打开 SSH 密钥管理器",
    llmStepTitle: "连接 LLM 后端（可选）",
    llmStepDesc:
      "注册 OpenAI · Ollama · 兼容端点即可立即开始使用 AI 助手。你也可以稍后在 ⚙ 设置中添加。",
    llmStepBtn: "🤖 添加 LLM 后端",
    prev: "← 上一步",
    next: "下一步 →",
    start: "开始使用",
  },
  ja: {
    skip: "スキップ",
    welcomeTitle: "AI Terminal へようこそ",
    welcomeSubtitle: "コンテキストを理解する AI ターミナル — LLM × SSH × ファイル転送を一つに",
    features: [
      { icon: "🤖", title: "AI アシスタント", desc: "Claude · GPT · Gemini · Ollama · 自前のサーバーを一つのインターフェースで" },
      { icon: "🖥️", title: "SSH 管理", desc: "ホスト・キーの保存、クイック接続、マルチタブ、セッションコンテキストの AI 認識" },
      { icon: "📁", title: "ファイル転送 (SFTP)", desc: "リモートファイルブラウザ、アップ/ダウンロード、権限編集、検索" },
    ],
    sshStepTitle: "SSH キーの準備（任意）",
    sshStepDesc:
      "キーベースの認証を使いたい場合は、今キーを作成またはインポートできます。パスワード認証のみを使う場合はスキップして構いません。",
    sshStepBtn: "🔑 SSH キー管理を開く",
    llmStepTitle: "LLM バックエンドを接続（任意）",
    llmStepDesc:
      "OpenAI · Ollama · 互換エンドポイントを登録すると、すぐに AI アシスタントを使い始められます。後から ⚙ 設定で追加することもできます。",
    llmStepBtn: "🤖 LLM バックエンドを追加",
    prev: "← 前へ",
    next: "次へ →",
    start: "始める",
  },
  ru: {
    skip: "Пропустить",
    welcomeTitle: "Добро пожаловать в AI Terminal",
    welcomeSubtitle: "Контекстно-осведомлённый AI-терминал — LLM × SSH × передача файлов в одном",
    features: [
      { icon: "🤖", title: "AI-ассистент", desc: "Claude · GPT · Gemini · Ollama · ваш собственный сервер в одном интерфейсе" },
      { icon: "🖥️", title: "Управление SSH", desc: "Сохранение хостов и ключей, быстрое подключение, мультивкладки, AI с учётом контекста сессии" },
      { icon: "📁", title: "Передача файлов (SFTP)", desc: "Браузер удалённых файлов, загрузка/выгрузка, редактирование прав, поиск" },
    ],
    sshStepTitle: "Подготовить SSH-ключи (необязательно)",
    sshStepDesc:
      "Если вы хотите аутентификацию по ключам, можно создать или импортировать ключ сейчас. Если вы будете использовать только аутентификацию по паролю, этот шаг можно пропустить.",
    sshStepBtn: "🔑 Открыть менеджер SSH-ключей",
    llmStepTitle: "Подключить LLM-бэкенд (необязательно)",
    llmStepDesc:
      "Зарегистрируйте OpenAI · Ollama · совместимый endpoint, чтобы сразу начать использовать AI-ассистента. Также можно добавить его позже в ⚙ Настройках.",
    llmStepBtn: "🤖 Добавить LLM-бэкенд",
    prev: "← Назад",
    next: "Далее →",
    start: "Начать",
  },
  fr: {
    skip: "Passer",
    welcomeTitle: "Bienvenue dans AI Terminal",
    welcomeSubtitle: "Un terminal IA conscient du contexte — LLM × SSH × transfert de fichiers en un",
    features: [
      { icon: "🤖", title: "Assistant IA", desc: "Claude · GPT · Gemini · Ollama · votre propre serveur dans une seule interface" },
      { icon: "🖥️", title: "Gestion SSH", desc: "Enregistrez hôtes et clés, connexion rapide, multi-onglets, IA consciente du contexte de session" },
      { icon: "📁", title: "Transfert de fichiers (SFTP)", desc: "Explorateur de fichiers distant, envoi/téléchargement, édition des permissions, recherche" },
    ],
    sshStepTitle: "Préparer les clés SSH (facultatif)",
    sshStepDesc:
      "Si vous souhaitez une authentification par clé, vous pouvez créer ou importer une clé maintenant. Si vous n'utilisez que l'authentification par mot de passe, vous pouvez passer cette étape.",
    sshStepBtn: "🔑 Ouvrir le gestionnaire de clés SSH",
    llmStepTitle: "Connecter un backend LLM (facultatif)",
    llmStepDesc:
      "Enregistrez OpenAI · Ollama · un endpoint compatible pour commencer à utiliser l'assistant IA tout de suite. Vous pouvez aussi en ajouter un plus tard dans ⚙ Paramètres.",
    llmStepBtn: "🤖 Ajouter un backend LLM",
    prev: "← Précédent",
    next: "Suivant →",
    start: "Commencer",
  },
  de: {
    skip: "Überspringen",
    welcomeTitle: "Willkommen bei AI Terminal",
    welcomeSubtitle: "Ein kontextbewusstes KI-Terminal — LLM × SSH × Dateiübertragung in einem",
    features: [
      { icon: "🤖", title: "KI-Assistent", desc: "Claude · GPT · Gemini · Ollama · dein eigener Server in einer Oberfläche" },
      { icon: "🖥️", title: "SSH-Verwaltung", desc: "Hosts und Schlüssel speichern, Schnellverbindung, Multi-Tab, sitzungskontextbewusste KI" },
      { icon: "📁", title: "Dateiübertragung (SFTP)", desc: "Remote-Dateibrowser, Hoch-/Herunterladen, Berechtigungsbearbeitung, Suche" },
    ],
    sshStepTitle: "SSH-Schlüssel vorbereiten (optional)",
    sshStepDesc:
      "Wenn du schlüsselbasierte Authentifizierung möchtest, kannst du jetzt einen Schlüssel erstellen oder importieren. Wenn du nur Passwort-Authentifizierung verwendest, kannst du diesen Schritt überspringen.",
    sshStepBtn: "🔑 SSH-Schlüsselverwaltung öffnen",
    llmStepTitle: "Ein LLM-Backend verbinden (optional)",
    llmStepDesc:
      "Registriere OpenAI · Ollama · einen kompatiblen Endpunkt, um den KI-Assistenten sofort zu nutzen. Du kannst auch später eines in ⚙ Einstellungen hinzufügen.",
    llmStepBtn: "🤖 LLM-Backend hinzufügen",
    prev: "← Zurück",
    next: "Weiter →",
    start: "Loslegen",
  },
  vi: {
    skip: "Bỏ qua",
    welcomeTitle: "Chào mừng đến với AI Terminal",
    welcomeSubtitle: "Terminal AI nhận biết ngữ cảnh — LLM × SSH × truyền tệp trong một",
    features: [
      { icon: "🤖", title: "Trợ lý AI", desc: "Claude · GPT · Gemini · Ollama · máy chủ của riêng bạn trong một giao diện" },
      { icon: "🖥️", title: "Quản lý SSH", desc: "Lưu host và khóa, kết nối nhanh, đa tab, AI nhận biết ngữ cảnh phiên" },
      { icon: "📁", title: "Truyền tệp (SFTP)", desc: "Trình duyệt tệp từ xa, tải lên/tải xuống, chỉnh sửa quyền, tìm kiếm" },
    ],
    sshStepTitle: "Chuẩn bị khóa SSH (tùy chọn)",
    sshStepDesc:
      "Nếu bạn muốn xác thực dựa trên khóa, bạn có thể tạo hoặc nhập khóa ngay bây giờ. Nếu chỉ dùng xác thực bằng mật khẩu, bạn có thể bỏ qua.",
    sshStepBtn: "🔑 Mở trình quản lý khóa SSH",
    llmStepTitle: "Kết nối backend LLM (tùy chọn)",
    llmStepDesc:
      "Đăng ký OpenAI · Ollama · endpoint tương thích để bắt đầu sử dụng trợ lý AI ngay. Bạn cũng có thể thêm sau trong ⚙ Cài đặt.",
    llmStepBtn: "🤖 Thêm backend LLM",
    prev: "← Trước",
    next: "Tiếp →",
    start: "Bắt đầu",
  },
  id: {
    skip: "Lewati",
    welcomeTitle: "Selamat datang di AI Terminal",
    welcomeSubtitle: "Terminal AI yang sadar konteks — LLM × SSH × transfer berkas dalam satu",
    features: [
      { icon: "🤖", title: "Asisten AI", desc: "Claude · GPT · Gemini · Ollama · server Anda sendiri dalam satu antarmuka" },
      { icon: "🖥️", title: "Manajemen SSH", desc: "Simpan host dan kunci, koneksi cepat, multi-tab, AI sadar konteks sesi" },
      { icon: "📁", title: "Transfer berkas (SFTP)", desc: "Penjelajah berkas jarak jauh, unggah/unduh, edit izin, pencarian" },
    ],
    sshStepTitle: "Siapkan kunci SSH (opsional)",
    sshStepDesc:
      "Jika Anda ingin autentikasi berbasis kunci, Anda dapat membuat atau mengimpor kunci sekarang. Jika hanya menggunakan autentikasi kata sandi, silakan lewati.",
    sshStepBtn: "🔑 Buka pengelola kunci SSH",
    llmStepTitle: "Hubungkan backend LLM (opsional)",
    llmStepDesc:
      "Daftarkan OpenAI · Ollama · endpoint yang kompatibel untuk mulai menggunakan asisten AI segera. Anda juga dapat menambahkannya nanti di ⚙ Pengaturan.",
    llmStepBtn: "🤖 Tambah backend LLM",
    prev: "← Sebelumnya",
    next: "Berikutnya →",
    start: "Mulai",
  },
  hi: {
    skip: "छोड़ें",
    welcomeTitle: "AI Terminal में आपका स्वागत है",
    welcomeSubtitle: "संदर्भ-सजग AI टर्मिनल — LLM × SSH × फ़ाइल स्थानांतरण एक में",
    features: [
      { icon: "🤖", title: "AI सहायक", desc: "Claude · GPT · Gemini · Ollama · आपका अपना सर्वर एक ही इंटरफ़ेस में" },
      { icon: "🖥️", title: "SSH प्रबंधन", desc: "host और कुंजियाँ सहेजें, त्वरित कनेक्ट, मल्टी-टैब, सत्र-संदर्भ AI सजगता" },
      { icon: "📁", title: "फ़ाइल स्थानांतरण (SFTP)", desc: "रिमोट फ़ाइल ब्राउज़र, अपलोड/डाउनलोड, अनुमति संपादन, खोज" },
    ],
    sshStepTitle: "SSH कुंजियाँ तैयार करें (वैकल्पिक)",
    sshStepDesc:
      "यदि आप कुंजी-आधारित प्रमाणीकरण चाहते हैं, तो आप अभी एक कुंजी बना या आयात कर सकते हैं। यदि आप केवल पासवर्ड प्रमाणीकरण का उपयोग करेंगे, तो बेझिझक छोड़ दें।",
    sshStepBtn: "🔑 SSH कुंजी प्रबंधक खोलें",
    llmStepTitle: "एक LLM बैकएंड कनेक्ट करें (वैकल्पिक)",
    llmStepDesc:
      "AI सहायक का तुरंत उपयोग शुरू करने के लिए OpenAI · Ollama · एक संगत endpoint पंजीकृत करें। आप बाद में ⚙ सेटिंग्स में भी एक जोड़ सकते हैं।",
    llmStepBtn: "🤖 LLM बैकएंड जोड़ें",
    prev: "← पिछला",
    next: "अगला →",
    start: "शुरू करें",
  },
};

export function OnboardingFlow({ onComplete }: Props) {
  const t = useT(STR);
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
            {t.skip}
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
                {t.welcomeTitle}
              </h1>
              <p style={{ color: "#9aa", fontSize: 13, margin: 0 }}>
                {t.welcomeSubtitle}
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {t.features.map((f) => (
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
            title={t.sshStepTitle}
            desc={t.sshStepDesc}
          >
            <button onClick={() => setShowKeys(true)} style={primaryBtnStyle}>
              {t.sshStepBtn}
            </button>
          </StepCard>
        )}

        {step === 2 && (
          <StepCard
            icon="🤖"
            title={t.llmStepTitle}
            desc={t.llmStepDesc}
          >
            <button onClick={() => setShowLlm(true)} style={primaryBtnStyle}>
              {t.llmStepBtn}
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
            {t.prev}
          </button>
          {step < 2 ? (
            <button onClick={() => setStep((s) => s + 1)} style={primaryBtnStyle}>
              {t.next}
            </button>
          ) : (
            <button onClick={onComplete} style={primaryBtnStyle}>
              {t.start}
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
