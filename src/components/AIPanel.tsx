import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BackendInfo,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Tab,
  TerminalSource,
} from "../types";
import { LlmSetupModal } from "./LlmSetupModal";
import { getTerminal } from "../terminalRegistry";
import { LangDict, useT } from "../i18n";
import {
  ChatSession,
  loadSessions,
  newSessionId,
  saveSessions,
  titleFromMessages,
} from "../chatSessions";

const STR: LangDict<{
    assistant: string;
    noBackend: string;
    backendSettings: string;
    history: string;
    newChat: string;
    paneSplit: (n: number) => string;
    askAnything: (name: string) => string;
    autoContextLater: string;
    generating: string;
    inputPlaceholder: string;
    setupFirst: string;
    includeContext: string;
    send: string;
    localShell: string;
    noActiveTab: string;
    sshContext: (label: string) => string;
    errorPrefix: (e: string) => string;
    noPaneToInput: string;
    runInTerminal: string;
    runInTerminalTitle: string;
    copied: string;
    copy: string;
    noBackendConfigured: string;
    addBackend: string;
    supportedEndpoints: string;
    newChatPlus: string;
    noSavedChats: string;
    messageCount: (n: number) => string;
    delete: string;
    ctxAssistantSys: (where: string, ctx: string) => string;
    ctxSshHost: (label: string) => string;
    ctxLocalShell: string;
    ctxTerminal: string;
    ctxRemote: string;
  }
> = {
  en: {
    assistant: "AI Assistant",
    noBackend: "No backend",
    backendSettings: "LLM backend settings (S-038)",
    history: "Chat history (S-049)",
    newChat: "New chat",
    paneSplit: (n) => ` · split ${n} panes`,
    askAnything: (name) => `Ask ${name} anything.`,
    autoContextLater: "Auto context attachment coming later (S-048).",
    generating: "Generating response…",
    inputPlaceholder: "Enter to send, Shift+Enter for newline",
    setupFirst: "Please set up a backend first",
    includeContext: "Include active pane output as context (S-048)",
    send: "Send",
    localShell: "Local shell",
    noActiveTab: "No active tab",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Error] ${e}`,
    noPaneToInput: "No terminal pane to input into.",
    runInTerminal: "▶ Send to terminal",
    runInTerminalTitle: "Send to active terminal pane (press Enter yourself)",
    copied: "Copied",
    copy: "Copy",
    noBackendConfigured: "No LLM backend has been configured yet.",
    addBackend: "+ Add LLM backend",
    supportedEndpoints: "Supports OpenAI / Ollama / compatible endpoints",
    newChatPlus: "＋ New chat",
    noSavedChats: "No saved chats",
    messageCount: (n) => `${n} messages`,
    delete: "Delete",
    ctxAssistantSys: (where, ctx) =>
      `You are an assistant helping with terminal work. The current ${where} screen output is below. ` +
      "When suggesting commands, present them in a code block wrapped in ```.\n\n--- Terminal output ---\n" +
      `${ctx}\n--- End ---`,
    ctxSshHost: (label) => `SSH host: ${label}`,
    ctxLocalShell: "local shell",
    ctxTerminal: "terminal",
    ctxRemote: "remote",
  },
  ko: {
    assistant: "AI 어시스턴트",
    noBackend: "백엔드 없음",
    backendSettings: "LLM 백엔드 설정 (S-038)",
    history: "대화 이력 (S-049)",
    newChat: "새 대화",
    paneSplit: (n) => ` · 분할 ${n}패널`,
    askAnything: (name) => `${name}에 무엇이든 물어보세요.`,
    autoContextLater: "컨텍스트 자동 첨부는 후속 (S-048).",
    generating: "응답 생성 중…",
    inputPlaceholder: "Enter로 전송, Shift+Enter 줄바꿈",
    setupFirst: "백엔드를 먼저 설정해주세요",
    includeContext: "활성 패널 출력을 컨텍스트로 포함 (S-048)",
    send: "전송",
    localShell: "로컬 셸",
    noActiveTab: "활성 탭 없음",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[에러] ${e}`,
    noPaneToInput: "입력할 터미널 패널이 없습니다.",
    runInTerminal: "▶ 터미널에 입력",
    runInTerminalTitle: "활성 터미널 패널에 입력 (Enter는 직접)",
    copied: "복사됨",
    copy: "복사",
    noBackendConfigured: "LLM 백엔드가 아직 설정되지 않았습니다.",
    addBackend: "+ LLM 백엔드 추가",
    supportedEndpoints: "OpenAI / Ollama / 호환 엔드포인트 지원",
    newChatPlus: "＋ 새 대화",
    noSavedChats: "저장된 대화 없음",
    messageCount: (n) => `${n}개 메시지`,
    delete: "삭제",
    ctxAssistantSys: (where, ctx) =>
      `너는 터미널 작업을 돕는 어시스턴트다. 사용자의 현재 ${where} 화면 출력은 다음과 같다. ` +
      "명령을 제안할 땐 ```로 감싼 코드블록으로 제시하라.\n\n--- 터미널 출력 ---\n" +
      `${ctx}\n--- 끝 ---`,
    ctxSshHost: (label) => `SSH 호스트: ${label}`,
    ctxLocalShell: "로컬 셸",
    ctxTerminal: "터미널",
    ctxRemote: "원격",
  },
  es: {
    assistant: "Asistente de IA",
    noBackend: "Sin backend",
    backendSettings: "Configuración del backend LLM (S-038)",
    history: "Historial de chat (S-049)",
    newChat: "Nuevo chat",
    paneSplit: (n) => ` · ${n} paneles divididos`,
    askAnything: (name) => `Pregúntale lo que quieras a ${name}.`,
    autoContextLater: "La inclusión automática de contexto llegará más adelante (S-048).",
    generating: "Generando respuesta…",
    inputPlaceholder: "Enter para enviar, Shift+Enter para nueva línea",
    setupFirst: "Configura un backend primero",
    includeContext: "Incluir la salida del panel activo como contexto (S-048)",
    send: "Enviar",
    localShell: "Shell local",
    noActiveTab: "Sin pestaña activa",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Error] ${e}`,
    noPaneToInput: "No hay panel de terminal donde escribir.",
    runInTerminal: "▶ Enviar a la terminal",
    runInTerminalTitle: "Enviar al panel de terminal activo (pulsa Enter tú mismo)",
    copied: "Copiado",
    copy: "Copiar",
    noBackendConfigured: "Aún no se ha configurado ningún backend LLM.",
    addBackend: "+ Agregar backend LLM",
    supportedEndpoints: "Compatible con OpenAI / Ollama / endpoints compatibles",
    newChatPlus: "＋ Nuevo chat",
    noSavedChats: "No hay chats guardados",
    messageCount: (n) => `${n} mensajes`,
    delete: "Eliminar",
    ctxAssistantSys: (where, ctx) =>
      `Eres un asistente que ayuda con tareas de terminal. La salida actual de la pantalla ${where} está abajo. ` +
      "Cuando sugieras comandos, preséntalos en un bloque de código envuelto en ```.\n\n--- Salida de terminal ---\n" +
      `${ctx}\n--- Fin ---`,
    ctxSshHost: (label) => `Host SSH: ${label}`,
    ctxLocalShell: "shell local",
    ctxTerminal: "terminal",
    ctxRemote: "remoto",
  },
  zh: {
    assistant: "AI 助手",
    noBackend: "无后端",
    backendSettings: "LLM 后端设置 (S-038)",
    history: "聊天记录 (S-049)",
    newChat: "新对话",
    paneSplit: (n) => ` · 分割 ${n} 个面板`,
    askAnything: (name) => `向 ${name} 提任何问题。`,
    autoContextLater: "上下文自动附加功能稍后推出 (S-048)。",
    generating: "正在生成回复…",
    inputPlaceholder: "Enter 发送，Shift+Enter 换行",
    setupFirst: "请先设置一个后端",
    includeContext: "将活动面板的输出作为上下文包含 (S-048)",
    send: "发送",
    localShell: "本地 shell",
    noActiveTab: "无活动标签页",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[错误] ${e}`,
    noPaneToInput: "没有可输入的终端面板。",
    runInTerminal: "▶ 发送到终端",
    runInTerminalTitle: "发送到活动终端面板（请自行按 Enter）",
    copied: "已复制",
    copy: "复制",
    noBackendConfigured: "尚未配置任何 LLM 后端。",
    addBackend: "+ 添加 LLM 后端",
    supportedEndpoints: "支持 OpenAI / Ollama / 兼容端点",
    newChatPlus: "＋ 新对话",
    noSavedChats: "没有已保存的对话",
    messageCount: (n) => `${n} 条消息`,
    delete: "删除",
    ctxAssistantSys: (where, ctx) =>
      `你是一个帮助处理终端工作的助手。当前 ${where} 屏幕输出如下。` +
      "建议命令时，请用 ``` 包裹的代码块来呈现。\n\n--- 终端输出 ---\n" +
      `${ctx}\n--- 结束 ---`,
    ctxSshHost: (label) => `SSH 主机: ${label}`,
    ctxLocalShell: "本地 shell",
    ctxTerminal: "终端",
    ctxRemote: "远程",
  },
  ja: {
    assistant: "AI アシスタント",
    noBackend: "バックエンドなし",
    backendSettings: "LLM バックエンド設定 (S-038)",
    history: "チャット履歴 (S-049)",
    newChat: "新規チャット",
    paneSplit: (n) => ` · ${n} ペイン分割`,
    askAnything: (name) => `${name} に何でも質問してください。`,
    autoContextLater: "コンテキストの自動添付は後日対応 (S-048)。",
    generating: "応答を生成中…",
    inputPlaceholder: "Enter で送信、Shift+Enter で改行",
    setupFirst: "先にバックエンドを設定してください",
    includeContext: "アクティブなペインの出力をコンテキストとして含める (S-048)",
    send: "送信",
    localShell: "ローカルシェル",
    noActiveTab: "アクティブなタブなし",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[エラー] ${e}`,
    noPaneToInput: "入力できる端末ペインがありません。",
    runInTerminal: "▶ 端末に送信",
    runInTerminalTitle: "アクティブな端末ペインに送信（Enter はご自身で）",
    copied: "コピーしました",
    copy: "コピー",
    noBackendConfigured: "LLM バックエンドはまだ設定されていません。",
    addBackend: "+ LLM バックエンドを追加",
    supportedEndpoints: "OpenAI / Ollama / 互換エンドポイントに対応",
    newChatPlus: "＋ 新規チャット",
    noSavedChats: "保存されたチャットなし",
    messageCount: (n) => `${n} 件のメッセージ`,
    delete: "削除",
    ctxAssistantSys: (where, ctx) =>
      `あなたは端末作業を支援するアシスタントです。現在の ${where} 画面の出力は以下のとおりです。` +
      "コマンドを提案するときは、``` で囲んだコードブロックで提示してください。\n\n--- 端末出力 ---\n" +
      `${ctx}\n--- 終わり ---`,
    ctxSshHost: (label) => `SSH ホスト: ${label}`,
    ctxLocalShell: "ローカルシェル",
    ctxTerminal: "端末",
    ctxRemote: "リモート",
  },
  ru: {
    assistant: "ИИ-ассистент",
    noBackend: "Нет бэкенда",
    backendSettings: "Настройки бэкенда LLM (S-038)",
    history: "История чата (S-049)",
    newChat: "Новый чат",
    paneSplit: (n) => ` · разделение на ${n} панелей`,
    askAnything: (name) => `Спросите ${name} о чём угодно.`,
    autoContextLater: "Автоматическое прикрепление контекста появится позже (S-048).",
    generating: "Генерация ответа…",
    inputPlaceholder: "Enter — отправить, Shift+Enter — новая строка",
    setupFirst: "Сначала настройте бэкенд",
    includeContext: "Включить вывод активной панели как контекст (S-048)",
    send: "Отправить",
    localShell: "Локальная оболочка",
    noActiveTab: "Нет активной вкладки",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Ошибка] ${e}`,
    noPaneToInput: "Нет панели терминала для ввода.",
    runInTerminal: "▶ Отправить в терминал",
    runInTerminalTitle: "Отправить в активную панель терминала (Enter нажмите сами)",
    copied: "Скопировано",
    copy: "Копировать",
    noBackendConfigured: "Бэкенд LLM ещё не настроен.",
    addBackend: "+ Добавить бэкенд LLM",
    supportedEndpoints: "Поддержка OpenAI / Ollama / совместимых эндпоинтов",
    newChatPlus: "＋ Новый чат",
    noSavedChats: "Нет сохранённых чатов",
    messageCount: (n) => `${n} сообщений`,
    delete: "Удалить",
    ctxAssistantSys: (where, ctx) =>
      `Ты ассистент, помогающий с работой в терминале. Текущий вывод экрана ${where} приведён ниже. ` +
      "Предлагая команды, оформляй их в блоке кода, обёрнутом в ```.\n\n--- Вывод терминала ---\n" +
      `${ctx}\n--- Конец ---`,
    ctxSshHost: (label) => `Хост SSH: ${label}`,
    ctxLocalShell: "локальная оболочка",
    ctxTerminal: "терминал",
    ctxRemote: "удалённый",
  },
  fr: {
    assistant: "Assistant IA",
    noBackend: "Aucun backend",
    backendSettings: "Paramètres du backend LLM (S-038)",
    history: "Historique des conversations (S-049)",
    newChat: "Nouvelle conversation",
    paneSplit: (n) => ` · ${n} volets divisés`,
    askAnything: (name) => `Posez n'importe quelle question à ${name}.`,
    autoContextLater: "L'ajout automatique du contexte arrivera plus tard (S-048).",
    generating: "Génération de la réponse…",
    inputPlaceholder: "Entrée pour envoyer, Maj+Entrée pour un saut de ligne",
    setupFirst: "Veuillez d'abord configurer un backend",
    includeContext: "Inclure la sortie du volet actif comme contexte (S-048)",
    send: "Envoyer",
    localShell: "Shell local",
    noActiveTab: "Aucun onglet actif",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Erreur] ${e}`,
    noPaneToInput: "Aucun volet de terminal où saisir.",
    runInTerminal: "▶ Envoyer au terminal",
    runInTerminalTitle: "Envoyer au volet de terminal actif (appuyez vous-même sur Entrée)",
    copied: "Copié",
    copy: "Copier",
    noBackendConfigured: "Aucun backend LLM n'a encore été configuré.",
    addBackend: "+ Ajouter un backend LLM",
    supportedEndpoints: "Prend en charge OpenAI / Ollama / endpoints compatibles",
    newChatPlus: "＋ Nouvelle conversation",
    noSavedChats: "Aucune conversation enregistrée",
    messageCount: (n) => `${n} messages`,
    delete: "Supprimer",
    ctxAssistantSys: (where, ctx) =>
      `Tu es un assistant qui aide aux tâches de terminal. La sortie actuelle de l'écran ${where} est ci-dessous. ` +
      "Lorsque tu suggères des commandes, présente-les dans un bloc de code entouré de ```.\n\n--- Sortie du terminal ---\n" +
      `${ctx}\n--- Fin ---`,
    ctxSshHost: (label) => `Hôte SSH : ${label}`,
    ctxLocalShell: "shell local",
    ctxTerminal: "terminal",
    ctxRemote: "distant",
  },
  de: {
    assistant: "KI-Assistent",
    noBackend: "Kein Backend",
    backendSettings: "LLM-Backend-Einstellungen (S-038)",
    history: "Chatverlauf (S-049)",
    newChat: "Neuer Chat",
    paneSplit: (n) => ` · ${n} geteilte Bereiche`,
    askAnything: (name) => `Frag ${name} alles.`,
    autoContextLater: "Automatisches Anhängen von Kontext kommt später (S-048).",
    generating: "Antwort wird generiert…",
    inputPlaceholder: "Enter zum Senden, Shift+Enter für Zeilenumbruch",
    setupFirst: "Bitte zuerst ein Backend einrichten",
    includeContext: "Ausgabe des aktiven Bereichs als Kontext einbeziehen (S-048)",
    send: "Senden",
    localShell: "Lokale Shell",
    noActiveTab: "Kein aktiver Tab",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Fehler] ${e}`,
    noPaneToInput: "Kein Terminalbereich zur Eingabe vorhanden.",
    runInTerminal: "▶ An Terminal senden",
    runInTerminalTitle: "An aktiven Terminalbereich senden (Enter selbst drücken)",
    copied: "Kopiert",
    copy: "Kopieren",
    noBackendConfigured: "Es wurde noch kein LLM-Backend konfiguriert.",
    addBackend: "+ LLM-Backend hinzufügen",
    supportedEndpoints: "Unterstützt OpenAI / Ollama / kompatible Endpunkte",
    newChatPlus: "＋ Neuer Chat",
    noSavedChats: "Keine gespeicherten Chats",
    messageCount: (n) => `${n} Nachrichten`,
    delete: "Löschen",
    ctxAssistantSys: (where, ctx) =>
      `Du bist ein Assistent, der bei Terminalarbeit hilft. Die aktuelle Bildschirmausgabe von ${where} ist unten. ` +
      "Wenn du Befehle vorschlägst, präsentiere sie in einem mit ``` umschlossenen Codeblock.\n\n--- Terminalausgabe ---\n" +
      `${ctx}\n--- Ende ---`,
    ctxSshHost: (label) => `SSH-Host: ${label}`,
    ctxLocalShell: "lokale Shell",
    ctxTerminal: "Terminal",
    ctxRemote: "remote",
  },
  vi: {
    assistant: "Trợ lý AI",
    noBackend: "Không có backend",
    backendSettings: "Cài đặt backend LLM (S-038)",
    history: "Lịch sử trò chuyện (S-049)",
    newChat: "Cuộc trò chuyện mới",
    paneSplit: (n) => ` · chia ${n} khung`,
    askAnything: (name) => `Hỏi ${name} bất cứ điều gì.`,
    autoContextLater: "Tính năng tự động đính kèm ngữ cảnh sẽ có sau (S-048).",
    generating: "Đang tạo phản hồi…",
    inputPlaceholder: "Enter để gửi, Shift+Enter để xuống dòng",
    setupFirst: "Vui lòng thiết lập backend trước",
    includeContext: "Bao gồm đầu ra của khung đang hoạt động làm ngữ cảnh (S-048)",
    send: "Gửi",
    localShell: "Shell cục bộ",
    noActiveTab: "Không có tab đang hoạt động",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Lỗi] ${e}`,
    noPaneToInput: "Không có khung terminal để nhập.",
    runInTerminal: "▶ Gửi đến terminal",
    runInTerminalTitle: "Gửi đến khung terminal đang hoạt động (tự nhấn Enter)",
    copied: "Đã sao chép",
    copy: "Sao chép",
    noBackendConfigured: "Chưa có backend LLM nào được cấu hình.",
    addBackend: "+ Thêm backend LLM",
    supportedEndpoints: "Hỗ trợ OpenAI / Ollama / các endpoint tương thích",
    newChatPlus: "＋ Cuộc trò chuyện mới",
    noSavedChats: "Không có cuộc trò chuyện đã lưu",
    messageCount: (n) => `${n} tin nhắn`,
    delete: "Xóa",
    ctxAssistantSys: (where, ctx) =>
      `Bạn là trợ lý hỗ trợ công việc terminal. Đầu ra màn hình ${where} hiện tại ở bên dưới. ` +
      "Khi đề xuất lệnh, hãy trình bày chúng trong khối mã được bao bằng ```.\n\n--- Đầu ra terminal ---\n" +
      `${ctx}\n--- Kết thúc ---`,
    ctxSshHost: (label) => `Host SSH: ${label}`,
    ctxLocalShell: "shell cục bộ",
    ctxTerminal: "terminal",
    ctxRemote: "từ xa",
  },
  id: {
    assistant: "Asisten AI",
    noBackend: "Tidak ada backend",
    backendSettings: "Pengaturan backend LLM (S-038)",
    history: "Riwayat obrolan (S-049)",
    newChat: "Obrolan baru",
    paneSplit: (n) => ` · ${n} panel terbagi`,
    askAnything: (name) => `Tanyakan apa saja kepada ${name}.`,
    autoContextLater: "Pelampiran konteks otomatis akan hadir nanti (S-048).",
    generating: "Membuat respons…",
    inputPlaceholder: "Enter untuk kirim, Shift+Enter untuk baris baru",
    setupFirst: "Silakan siapkan backend terlebih dahulu",
    includeContext: "Sertakan keluaran panel aktif sebagai konteks (S-048)",
    send: "Kirim",
    localShell: "Shell lokal",
    noActiveTab: "Tidak ada tab aktif",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Kesalahan] ${e}`,
    noPaneToInput: "Tidak ada panel terminal untuk diketik.",
    runInTerminal: "▶ Kirim ke terminal",
    runInTerminalTitle: "Kirim ke panel terminal aktif (tekan Enter sendiri)",
    copied: "Tersalin",
    copy: "Salin",
    noBackendConfigured: "Belum ada backend LLM yang dikonfigurasi.",
    addBackend: "+ Tambah backend LLM",
    supportedEndpoints: "Mendukung OpenAI / Ollama / endpoint yang kompatibel",
    newChatPlus: "＋ Obrolan baru",
    noSavedChats: "Tidak ada obrolan tersimpan",
    messageCount: (n) => `${n} pesan`,
    delete: "Hapus",
    ctxAssistantSys: (where, ctx) =>
      `Anda adalah asisten yang membantu pekerjaan terminal. Keluaran layar ${where} saat ini ada di bawah. ` +
      "Saat menyarankan perintah, sajikan dalam blok kode yang dibungkus dengan ```.\n\n--- Keluaran terminal ---\n" +
      `${ctx}\n--- Selesai ---`,
    ctxSshHost: (label) => `Host SSH: ${label}`,
    ctxLocalShell: "shell lokal",
    ctxTerminal: "terminal",
    ctxRemote: "jarak jauh",
  },
  hi: {
    assistant: "AI सहायक",
    noBackend: "कोई बैकएंड नहीं",
    backendSettings: "LLM बैकएंड सेटिंग्स (S-038)",
    history: "चैट इतिहास (S-049)",
    newChat: "नई चैट",
    paneSplit: (n) => ` · ${n} पैनल विभाजित`,
    askAnything: (name) => `${name} से कुछ भी पूछें।`,
    autoContextLater: "संदर्भ का स्वतः संलग्न होना बाद में आएगा (S-048)।",
    generating: "उत्तर तैयार किया जा रहा है…",
    inputPlaceholder: "भेजने के लिए Enter, नई पंक्ति के लिए Shift+Enter",
    setupFirst: "कृपया पहले एक बैकएंड सेट करें",
    includeContext: "सक्रिय पैनल के आउटपुट को संदर्भ के रूप में शामिल करें (S-048)",
    send: "भेजें",
    localShell: "लोकल शेल",
    noActiveTab: "कोई सक्रिय टैब नहीं",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[त्रुटि] ${e}`,
    noPaneToInput: "इनपुट करने के लिए कोई टर्मिनल पैनल नहीं है।",
    runInTerminal: "▶ टर्मिनल में भेजें",
    runInTerminalTitle: "सक्रिय टर्मिनल पैनल में भेजें (Enter स्वयं दबाएं)",
    copied: "कॉपी किया गया",
    copy: "कॉपी करें",
    noBackendConfigured: "अभी तक कोई LLM बैकएंड कॉन्फ़िगर नहीं किया गया है।",
    addBackend: "+ LLM बैकएंड जोड़ें",
    supportedEndpoints: "OpenAI / Ollama / संगत एंडपॉइंट का समर्थन करता है",
    newChatPlus: "＋ नई चैट",
    noSavedChats: "कोई सहेजी गई चैट नहीं",
    messageCount: (n) => `${n} संदेश`,
    delete: "हटाएं",
    ctxAssistantSys: (where, ctx) =>
      `तुम एक सहायक हो जो टर्मिनल कार्य में मदद करता है। वर्तमान ${where} स्क्रीन का आउटपुट नीचे दिया गया है। ` +
      "कमांड सुझाते समय, उन्हें ``` से लपेटे गए कोड ब्लॉक में प्रस्तुत करो।\n\n--- टर्मिनल आउटपुट ---\n" +
      `${ctx}\n--- अंत ---`,
    ctxSshHost: (label) => `SSH होस्ट: ${label}`,
    ctxLocalShell: "लोकल शेल",
    ctxTerminal: "टर्मिनल",
    ctxRemote: "रिमोट",
  },
};

interface Props {
  activeTab: Tab | null;
  focusedSource: TerminalSource | null;
  /** 포커스된 패널(leaf) id — 컨텍스트 추출/명령 주입 대상. */
  focusedPaneId: string | null;
  paneCount: number;
  /** 사이드바에서 호스트명 → 라벨 매핑이 가능하면 컨텍스트 표시에 사용. */
  contextLabel?: string;
  /** 활성 대화 세션 id가 바뀔 때 보고 (App이 탭별 보관 → 분리 시 새 창에 인계). */
  onActiveSession?: (sessionId: string | null) => void;
  /** 세션 인계: 있으면 mount 시 이 대화를 localStorage에서 복원 (분리된 새 창). */
  initialSessionId?: string;
}

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```(?:[a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = m[1].replace(/\n+$/, "");
    if (code.trim()) blocks.push(code);
  }
  return blocks;
}

/**
 * S-046/050 AI 채팅 패널.
 *
 * 다음 증분에서 추가될 것:
 * - 세션 컨텍스트 자동 첨부 (S-048)
 * - 응답에서 명령어 추출 → 카드 + "실행" 버튼 (S-047)
 * - 대화 이력/세션 전환 (S-049)
 * - 스트리밍 응답
 */
export function AIPanel({
  activeTab,
  focusedSource,
  focusedPaneId,
  paneCount,
  contextLabel,
  onActiveSession,
  initialSessionId,
}: Props) {
  const t = useT(STR);
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  function persistSession(sid: string, msgs: ChatMessage[]) {
    setSessions((prev) => {
      const sess: ChatSession = {
        id: sid,
        title: titleFromMessages(msgs),
        messages: msgs,
        backendId: currentId,
        updatedAt: Date.now(),
      };
      const next = prev.find((s) => s.id === sid)
        ? prev.map((s) => (s.id === sid ? sess : s))
        : [sess, ...prev];
      saveSessions(next);
      return next;
    });
  }

  function selectSession(id: string) {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    setActiveSessionId(id);
    setMessages(s.messages);
    if (s.backendId && backends.find((b) => b.id === s.backendId)) {
      setCurrentId(s.backendId);
    }
    setShowHistory(false);
  }

  function deleteSession(id: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSessions(next);
      return next;
    });
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }

  async function reload() {
    try {
      const list = await invoke<BackendInfo[]>("ai_list_backend_configs");
      setBackends(list);
      // 현재 선택이 사라졌으면 첫 번째로.
      if (list.length === 0) {
        setCurrentId(null);
      } else if (!list.find((b) => b.id === currentId)) {
        setCurrentId(list[0].id);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void reload();
    // 세션 인계: 분리된 새 창은 받은 sessionId로 대화를 localStorage에서 복원.
    if (initialSessionId) {
      const s = loadSessions().find((x) => x.id === initialSessionId);
      if (s) {
        setActiveSessionId(s.id);
        setMessages(s.messages);
        if (s.backendId) setCurrentId(s.backendId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 활성 대화 세션 id를 부모에 보고 → App이 탭별로 보관(분리 시 인계용).
  useEffect(() => {
    onActiveSession?.(activeSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  const current = useMemo(
    () => backends.find((b) => b.id === currentId) ?? null,
    [backends, currentId],
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || !current || busy) return;
    setError(null);
    setInput("");
    let sid = activeSessionId;
    if (!sid) {
      sid = newSessionId();
      setActiveSessionId(sid);
    }
    const userMsg: ChatMessage = { role: "user", content: text };
    // 화면에 표시할 메시지에는 컨텍스트를 넣지 않고, API 요청에만 system 메시지로 첨부.
    const display = [...messages, userMsg];
    setMessages(display);
    persistSession(sid, display);
    setBusy(true);

    const reqMessages: ChatMessage[] = [];
    if (includeContext) {
      const ctx = getTerminal(focusedPaneId)?.getRecentText(60);
      if (ctx) {
        const where = focusedSource
          ? focusedSource.kind === "ssh"
            ? t.ctxSshHost(contextLabel ?? t.ctxRemote)
            : t.ctxLocalShell
          : t.ctxTerminal;
        reqMessages.push({
          role: "system",
          content: t.ctxAssistantSys(where, ctx),
        });
      }
    }
    reqMessages.push(...display);

    try {
      const req: ChatRequest = {
        model: current.defaultModel,
        messages: reqMessages,
      };
      const resp = await invoke<ChatResponse>("ai_complete", {
        backendId: current.id,
        request: req,
      });
      const final = [
        ...display,
        { role: "assistant" as const, content: resp.content },
      ];
      setMessages(final);
      persistSession(sid, final);
    } catch (e) {
      setError(String(e));
      const final = [
        ...display,
        { role: "assistant" as const, content: t.errorPrefix(String(e)) },
      ];
      setMessages(final);
      persistSession(sid, final);
    } finally {
      setBusy(false);
    }
  }

  function runInTerminal(code: string) {
    const handle = getTerminal(focusedPaneId);
    if (!handle) {
      setError(t.noPaneToInput);
      return;
    }
    // 개행 없이 입력만 — 사용자가 직접 Enter로 실행하도록 (안전).
    handle.sendInput(code);
  }

  function newChat() {
    setMessages([]);
    setActiveSessionId(null);
    setError(null);
    setShowHistory(false);
  }

  const sourceCtx = activeTab
    ? focusedSource
      ? focusedSource.kind === "ssh"
        ? t.sshContext(contextLabel ?? activeTab.label)
        : t.localShell
      : activeTab.label
    : t.noActiveTab;

  return (
    <aside
      style={{
        width: "100%",
        height: "100%",
        background: "#1a1a20",
        color: "#cccccc",
        borderLeft: "1px solid #111",
        display: "flex",
        flexDirection: "column",
        fontSize: 13,
        minWidth: 0,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #2a2a30",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <strong style={{ color: "#fff", marginRight: "auto" }}>{t.assistant}</strong>
        {backends.length > 0 ? (
          <select
            value={currentId ?? ""}
            onChange={(e) => setCurrentId(e.target.value)}
            style={{
              background: "#101015",
              color: "#ddd",
              border: "1px solid #333",
              borderRadius: 3,
              padding: "2px 4px",
              fontSize: 11,
              maxWidth: 140,
            }}
          >
            {backends.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName} ({b.defaultModel})
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: "#789", fontSize: 11 }}>{t.noBackend}</span>
        )}
        <button
          onClick={() => setShowSetup(true)}
          style={iconBtnStyle}
          title={t.backendSettings}
        >
          ⚙
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          style={{ ...iconBtnStyle, color: showHistory ? "#4a9eff" : "#888" }}
          title={t.history}
        >
          🕘
        </button>
        <button onClick={newChat} style={iconBtnStyle} title={t.newChat}>
          ＋
        </button>
      </header>

      <div
        style={{
          padding: "6px 12px",
          fontSize: 11,
          color: "#789",
          borderBottom: "1px solid #2a2a30",
        }}
      >
        📍 {sourceCtx}
        {paneCount > 1 && t.paneSplit(paneCount)}
      </div>

      {showHistory ? (
        <HistoryDrawer
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={selectSession}
          onDelete={deleteSession}
          onNew={newChat}
        />
      ) : (
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minHeight: 0,
        }}
      >
        {!current && <EmptyState onSetup={() => setShowSetup(true)} />}
        {current && messages.length === 0 && !busy && (
          <div style={{ color: "#789", textAlign: "center", marginTop: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
            <div style={{ fontSize: 12 }}>
              {t.askAnything(current.displayName)}
            </div>
            <div style={{ fontSize: 10, marginTop: 6 }}>
              {t.autoContextLater}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            role={m.role}
            content={m.content}
            onRun={runInTerminal}
          />
        ))}
        {busy && (
          <div style={{ color: "#789", fontSize: 12, fontStyle: "italic" }}>
            {t.generating}
          </div>
        )}
      </div>
      )}

      {error && (
        <div style={{ padding: 8, background: "#3a1d1d", color: "#fdd", fontSize: 11 }}>
          {error}
          <button onClick={() => setError(null)} style={{ ...iconBtnStyle, float: "right" }}>
            ×
          </button>
        </div>
      )}

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px 0",
          fontSize: 11,
          color: "#9aa",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={includeContext}
          onChange={(e) => setIncludeContext(e.target.checked)}
        />
        <span>{t.includeContext}</span>
      </label>

      <div
        style={{
          borderTop: "1px solid #2a2a30",
          padding: 10,
          display: "flex",
          gap: 6,
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={current ? t.inputPlaceholder : t.setupFirst}
          disabled={!current || busy}
          rows={2}
          style={{
            flex: 1,
            background: "#101015",
            color: current ? "#fff" : "#666",
            border: "1px solid #2a2a30",
            borderRadius: 4,
            padding: "6px 8px",
            fontSize: 12,
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={() => void send()}
          disabled={!current || busy || !input.trim()}
          style={{
            background: current && input.trim() ? "#0a5380" : "#2a2a35",
            color: "#fff",
            border: "1px solid #4a9eff",
            borderRadius: 4,
            padding: "0 12px",
            fontSize: 12,
            cursor: current && input.trim() ? "pointer" : "not-allowed",
          }}
        >
          {t.send}
        </button>
      </div>

      {showSetup && (
        <LlmSetupModal
          onClose={() => setShowSetup(false)}
          onChanged={() => void reload()}
        />
      )}
    </aside>
  );
}

function MessageBubble({
  role,
  content,
  onRun,
}: {
  role: string;
  content: string;
  onRun: (code: string) => void;
}) {
  const isUser = role === "user";
  const codeBlocks = isUser ? [] : extractCodeBlocks(content);
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "92%",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          background: isUser ? "#0a5380" : "#26262d",
          border: "1px solid #333",
          padding: "8px 10px",
          borderRadius: 6,
          color: "#e6e6e6",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: 1.5,
        }}
      >
        {content}
      </div>
      {codeBlocks.map((code, i) => (
        <CommandCard key={i} code={code} onRun={onRun} />
      ))}
    </div>
  );
}

function CommandCard({
  code,
  onRun,
}: {
  code: string;
  onRun: (code: string) => void;
}) {
  const t = useT(STR);
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        background: "#0d0d12",
        border: "1px solid #2a3a4a",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          fontSize: 11,
          fontFamily: "Menlo, Consolas, monospace",
          color: "#cfe",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 160,
          overflowY: "auto",
        }}
      >
        {code}
      </pre>
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "6px 8px",
          borderTop: "1px solid #1d2530",
          background: "#10141a",
        }}
      >
        <button
          onClick={() => onRun(code)}
          style={cardBtnStyle}
          title={t.runInTerminalTitle}
        >
          {t.runInTerminal}
        </button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          style={cardBtnStyle}
        >
          {copied ? t.copied : t.copy}
        </button>
      </div>
    </div>
  );
}

const cardBtnStyle: React.CSSProperties = {
  background: "#1a2a3a",
  color: "#cfe",
  border: "1px solid #2a3a4a",
  borderRadius: 3,
  padding: "3px 10px",
  fontSize: 11,
  cursor: "pointer",
};

function EmptyState({ onSetup }: { onSetup: () => void }) {
  const t = useT(STR);
  return (
    <div
      style={{
        textAlign: "center",
        marginTop: 32,
        color: "#789",
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
      <div style={{ marginBottom: 8 }}>{t.noBackendConfigured}</div>
      <button
        onClick={onSetup}
        style={{
          background: "#0a5380",
          color: "#fff",
          border: "1px solid #4a9eff",
          borderRadius: 4,
          padding: "6px 14px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {t.addBackend}
      </button>
      <div style={{ fontSize: 10, marginTop: 10, lineHeight: 1.5 }}>
        {t.supportedEndpoints}
      </div>
    </div>
  );
}

function HistoryDrawer({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onNew,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  const t = useT(STR);
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 8, minHeight: 0 }}>
      <button
        onClick={onNew}
        style={{
          width: "100%",
          background: "#0a5380",
          color: "#fff",
          border: "1px solid #4a9eff",
          borderRadius: 4,
          padding: "6px 10px",
          cursor: "pointer",
          fontSize: 12,
          marginBottom: 8,
        }}
      >
        {t.newChatPlus}
      </button>
      {sorted.length === 0 && (
        <div style={{ color: "#789", textAlign: "center", padding: 16, fontSize: 12 }}>
          {t.noSavedChats}
        </div>
      )}
      {sorted.map((s) => {
        const active = s.id === activeSessionId;
        return (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 10px",
              borderRadius: 4,
              cursor: "pointer",
              background: active ? "#094771" : "transparent",
              marginBottom: 2,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: active ? "#fff" : "#ddd",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.title}
              </div>
              <div style={{ fontSize: 10, color: "#789" }}>
                {t.messageCount(s.messages.length)} ·{" "}
                {new Date(s.updatedAt).toLocaleString()}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
              style={iconBtnStyle}
              title={t.delete}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 14,
  padding: "0 4px",
};
