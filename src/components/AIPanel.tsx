import { useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  BackendInfo,
  ChatMessage,
  ChatRequest,
  Tab,
  TerminalSource,
} from "../types";
import { LlmSetupModal } from "./LlmSetupModal";
import { getTerminal } from "../terminalRegistry";
import { setAskAIListener } from "../aiBus";
import { LangDict, useT } from "../i18n";
import {
  ChatSession,
  loadSessions,
  newSessionId,
  saveSessions,
  titleFromMessages,
} from "../chatSessions";

/**
 * AI 마크 — 그라데이션 스파클(✨ 모티프). 이모지 🤖 대신 고급스러운 인라인 SVG.
 * 큰 4점 별 + 작은 보조 별 + 부드러운 글로우. gradient id는 useId로 인스턴스별 유니크.
 */
function AiMark({ size = 40 }: { size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const grad = `aiMarkGrad-${uid}`;
  const glow = `aiMarkGlow-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", margin: "0 auto" }}
    >
      <defs>
        <linearGradient
          id={grad}
          x1="3"
          y1="3"
          x2="21"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#7cc0ff" />
          <stop offset="0.55" stopColor="#8e9bff" />
          <stop offset="1" stopColor="#c08bff" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#8ea8ff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#8ea8ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill={`url(#${glow})`} />
      {/* 큰 4점 별 — 가운데 */}
      <path
        d="M12 2.2c.62 4.9 2.28 6.56 7.18 7.18C14.28 10 12.62 11.66 12 16.56 11.38 11.66 9.72 10 4.82 9.38 9.72 8.76 11.38 7.1 12 2.2Z"
        fill={`url(#${grad})`}
      />
      {/* 작은 보조 별 — 우하단 */}
      <path
        d="M18.4 13.2c.28 1.9.92 2.54 2.82 2.82-1.9.28-2.54.92-2.82 2.82-.28-1.9-.92-2.54-2.82-2.82 1.9-.28 2.54-.92 2.82-2.82Z"
        fill={`url(#${grad})`}
        opacity="0.85"
      />
    </svg>
  );
}

// 백엔드 ai_complete_stream이 Channel로 보내는 스트리밍 이벤트.
type StreamEvent =
  | { type: "delta"; delta: string }
  | { type: "done"; content: string }
  | { type: "error"; message: string };

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
    qaFixLabel: string;
    qaFixPrompt: string;
    qaExplainLabel: string;
    qaExplainPrompt: string;
    qaNextLabel: string;
    qaNextPrompt: string;
    quickActionsTitle: string;
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
    autoContextLater: "Active pane output can be sent as context.",
    generating: "Generating response…",
    inputPlaceholder: "Enter to send, Shift+Enter for newline",
    setupFirst: "Please set up a backend first",
    includeContext: "Include active pane output as context",
    send: "Send",
    localShell: "Local shell",
    noActiveTab: "No active tab",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Error] ${e}`,
    noPaneToInput: "No terminal pane to input into.",
    qaFixLabel: "🔧 Fix error",
    qaFixPrompt: "Check the current terminal output. If there's an error, explain the cause and give the command(s) to fix it (in a code block).",
    qaExplainLabel: "❔ Explain",
    qaExplainPrompt: "Explain what the current terminal output means.",
    qaNextLabel: "➡️ Next step",
    qaNextPrompt: "Based on the current state, suggest the next useful command(s) (in a code block).",
    quickActionsTitle: "Quick actions",
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
    autoContextLater: "활성 패널 출력을 컨텍스트로 함께 보낼 수 있어요.",
    generating: "응답 생성 중…",
    inputPlaceholder: "Enter로 전송, Shift+Enter 줄바꿈",
    setupFirst: "백엔드를 먼저 설정해주세요",
    includeContext: "활성 패널 출력을 컨텍스트로 포함",
    send: "전송",
    localShell: "로컬 셸",
    noActiveTab: "활성 탭 없음",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[에러] ${e}`,
    noPaneToInput: "입력할 터미널 패널이 없습니다.",
    qaFixLabel: "🔧 에러 고치기",
    qaFixPrompt: "현재 터미널 출력을 확인해서 에러가 있으면 원인을 설명하고 해결 명령을 코드블록으로 알려줘.",
    qaExplainLabel: "❔ 설명",
    qaExplainPrompt: "현재 터미널 출력이 무슨 의미인지 설명해줘.",
    qaNextLabel: "➡️ 다음 단계",
    qaNextPrompt: "지금 상황에서 다음에 실행하면 좋은 명령을 코드블록으로 제안해줘.",
    quickActionsTitle: "빠른 동작",
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
    autoContextLater: "La salida del panel activo puede enviarse como contexto.",
    generating: "Generando respuesta…",
    inputPlaceholder: "Enter para enviar, Shift+Enter para nueva línea",
    setupFirst: "Configura un backend primero",
    includeContext: "Incluir la salida del panel activo como contexto",
    send: "Enviar",
    localShell: "Shell local",
    noActiveTab: "Sin pestaña activa",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Error] ${e}`,
    noPaneToInput: "No hay panel de terminal donde escribir.",
    qaFixLabel: "🔧 Corregir error",
    qaFixPrompt: "Revisa la salida actual del terminal. Si hay un error, explica la causa y da el/los comando(s) para solucionarlo (en bloque de código).",
    qaExplainLabel: "❔ Explicar",
    qaExplainPrompt: "Explica qué significa la salida actual del terminal.",
    qaNextLabel: "➡️ Siguiente",
    qaNextPrompt: "Según el estado actual, sugiere el/los siguiente(s) comando(s) útil(es) (en bloque de código).",
    quickActionsTitle: "Acciones rápidas",
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
    autoContextLater: "可将活动面板的输出作为上下文发送。",
    generating: "正在生成回复…",
    inputPlaceholder: "Enter 发送，Shift+Enter 换行",
    setupFirst: "请先设置一个后端",
    includeContext: "将活动面板的输出作为上下文包含",
    send: "发送",
    localShell: "本地 shell",
    noActiveTab: "无活动标签页",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[错误] ${e}`,
    noPaneToInput: "没有可输入的终端面板。",
    qaFixLabel: "🔧 修复错误",
    qaFixPrompt: "检查当前终端输出。如果有错误，请说明原因并给出修复命令（用代码块）。",
    qaExplainLabel: "❔ 解释",
    qaExplainPrompt: "解释当前终端输出的含义。",
    qaNextLabel: "➡️ 下一步",
    qaNextPrompt: "根据当前状态，建议接下来有用的命令（用代码块）。",
    quickActionsTitle: "快捷操作",
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
    autoContextLater: "アクティブなペインの出力をコンテキストとして送れます。",
    generating: "応答を生成中…",
    inputPlaceholder: "Enter で送信、Shift+Enter で改行",
    setupFirst: "先にバックエンドを設定してください",
    includeContext: "アクティブなペインの出力をコンテキストとして含める",
    send: "送信",
    localShell: "ローカルシェル",
    noActiveTab: "アクティブなタブなし",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[エラー] ${e}`,
    noPaneToInput: "入力できる端末ペインがありません。",
    qaFixLabel: "🔧 エラー修正",
    qaFixPrompt: "現在の端末出力を確認して、エラーがあれば原因を説明し、修正コマンドをコードブロックで示して。",
    qaExplainLabel: "❔ 説明",
    qaExplainPrompt: "現在の端末出力の意味を説明して。",
    qaNextLabel: "➡️ 次の手順",
    qaNextPrompt: "現在の状況で次に実行すると良いコマンドをコードブロックで提案して。",
    quickActionsTitle: "クイック操作",
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
    autoContextLater: "Вывод активной панели можно отправить как контекст.",
    generating: "Генерация ответа…",
    inputPlaceholder: "Enter — отправить, Shift+Enter — новая строка",
    setupFirst: "Сначала настройте бэкенд",
    includeContext: "Включить вывод активной панели как контекст",
    send: "Отправить",
    localShell: "Локальная оболочка",
    noActiveTab: "Нет активной вкладки",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Ошибка] ${e}`,
    noPaneToInput: "Нет панели терминала для ввода.",
    qaFixLabel: "🔧 Исправить ошибку",
    qaFixPrompt: "Проверь текущий вывод терминала. Если есть ошибка, объясни причину и дай команду(ы) для исправления (в блоке кода).",
    qaExplainLabel: "❔ Объяснить",
    qaExplainPrompt: "Объясни, что означает текущий вывод терминала.",
    qaNextLabel: "➡️ Дальше",
    qaNextPrompt: "Исходя из текущего состояния, предложи следующие полезные команды (в блоке кода).",
    quickActionsTitle: "Быстрые действия",
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
    autoContextLater: "La sortie du volet actif peut être envoyée comme contexte.",
    generating: "Génération de la réponse…",
    inputPlaceholder: "Entrée pour envoyer, Maj+Entrée pour un saut de ligne",
    setupFirst: "Veuillez d'abord configurer un backend",
    includeContext: "Inclure la sortie du volet actif comme contexte",
    send: "Envoyer",
    localShell: "Shell local",
    noActiveTab: "Aucun onglet actif",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Erreur] ${e}`,
    noPaneToInput: "Aucun volet de terminal où saisir.",
    qaFixLabel: "🔧 Corriger l'erreur",
    qaFixPrompt: "Vérifie la sortie actuelle du terminal. S'il y a une erreur, explique la cause et donne la ou les commande(s) pour la corriger (dans un bloc de code).",
    qaExplainLabel: "❔ Expliquer",
    qaExplainPrompt: "Explique ce que signifie la sortie actuelle du terminal.",
    qaNextLabel: "➡️ Étape suivante",
    qaNextPrompt: "D'après l'état actuel, suggère la ou les prochaine(s) commande(s) utile(s) (dans un bloc de code).",
    quickActionsTitle: "Actions rapides",
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
    autoContextLater: "Die Ausgabe des aktiven Bereichs kann als Kontext gesendet werden.",
    generating: "Antwort wird generiert…",
    inputPlaceholder: "Enter zum Senden, Shift+Enter für Zeilenumbruch",
    setupFirst: "Bitte zuerst ein Backend einrichten",
    includeContext: "Ausgabe des aktiven Bereichs als Kontext einbeziehen",
    send: "Senden",
    localShell: "Lokale Shell",
    noActiveTab: "Kein aktiver Tab",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Fehler] ${e}`,
    noPaneToInput: "Kein Terminalbereich zur Eingabe vorhanden.",
    qaFixLabel: "🔧 Fehler beheben",
    qaFixPrompt: "Prüfe die aktuelle Terminalausgabe. Falls ein Fehler vorliegt, erkläre die Ursache und gib die Befehle zur Behebung an (im Codeblock).",
    qaExplainLabel: "❔ Erklären",
    qaExplainPrompt: "Erkläre, was die aktuelle Terminalausgabe bedeutet.",
    qaNextLabel: "➡️ Nächster Schritt",
    qaNextPrompt: "Schlage basierend auf dem aktuellen Zustand die nächsten nützlichen Befehle vor (im Codeblock).",
    quickActionsTitle: "Schnellaktionen",
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
    autoContextLater: "Có thể gửi đầu ra của khung đang hoạt động làm ngữ cảnh.",
    generating: "Đang tạo phản hồi…",
    inputPlaceholder: "Enter để gửi, Shift+Enter để xuống dòng",
    setupFirst: "Vui lòng thiết lập backend trước",
    includeContext: "Bao gồm đầu ra của khung đang hoạt động làm ngữ cảnh",
    send: "Gửi",
    localShell: "Shell cục bộ",
    noActiveTab: "Không có tab đang hoạt động",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Lỗi] ${e}`,
    noPaneToInput: "Không có khung terminal để nhập.",
    qaFixLabel: "🔧 Sửa lỗi",
    qaFixPrompt: "Kiểm tra đầu ra terminal hiện tại. Nếu có lỗi, hãy giải thích nguyên nhân và đưa ra (các) lệnh để sửa (trong khối mã).",
    qaExplainLabel: "❔ Giải thích",
    qaExplainPrompt: "Giải thích đầu ra terminal hiện tại có nghĩa là gì.",
    qaNextLabel: "➡️ Bước tiếp theo",
    qaNextPrompt: "Dựa trên trạng thái hiện tại, hãy đề xuất (các) lệnh hữu ích tiếp theo (trong khối mã).",
    quickActionsTitle: "Tác vụ nhanh",
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
    autoContextLater: "Keluaran panel aktif dapat dikirim sebagai konteks.",
    generating: "Membuat respons…",
    inputPlaceholder: "Enter untuk kirim, Shift+Enter untuk baris baru",
    setupFirst: "Silakan siapkan backend terlebih dahulu",
    includeContext: "Sertakan keluaran panel aktif sebagai konteks",
    send: "Kirim",
    localShell: "Shell lokal",
    noActiveTab: "Tidak ada tab aktif",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[Kesalahan] ${e}`,
    noPaneToInput: "Tidak ada panel terminal untuk diketik.",
    qaFixLabel: "🔧 Perbaiki error",
    qaFixPrompt: "Periksa keluaran terminal saat ini. Jika ada error, jelaskan penyebabnya dan berikan perintah untuk memperbaikinya (dalam blok kode).",
    qaExplainLabel: "❔ Jelaskan",
    qaExplainPrompt: "Jelaskan arti keluaran terminal saat ini.",
    qaNextLabel: "➡️ Langkah berikutnya",
    qaNextPrompt: "Berdasarkan kondisi saat ini, sarankan perintah berguna berikutnya (dalam blok kode).",
    quickActionsTitle: "Aksi cepat",
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
    autoContextLater: "सक्रिय पैनल के आउटपुट को संदर्भ के रूप में भेजा जा सकता है।",
    generating: "उत्तर तैयार किया जा रहा है…",
    inputPlaceholder: "भेजने के लिए Enter, नई पंक्ति के लिए Shift+Enter",
    setupFirst: "कृपया पहले एक बैकएंड सेट करें",
    includeContext: "सक्रिय पैनल के आउटपुट को संदर्भ के रूप में शामिल करें",
    send: "भेजें",
    localShell: "लोकल शेल",
    noActiveTab: "कोई सक्रिय टैब नहीं",
    sshContext: (label) => `SSH — ${label}`,
    errorPrefix: (e) => `[त्रुटि] ${e}`,
    noPaneToInput: "इनपुट करने के लिए कोई टर्मिनल पैनल नहीं है।",
    qaFixLabel: "🔧 त्रुटि ठीक करें",
    qaFixPrompt: "वर्तमान टर्मिनल आउटपुट जांचें। यदि कोई त्रुटि है, तो कारण बताएं और उसे ठीक करने के लिए कमांड दें (कोड ब्लॉक में)।",
    qaExplainLabel: "❔ समझाएं",
    qaExplainPrompt: "वर्तमान टर्मिनल आउटपुट का क्या अर्थ है, समझाएं।",
    qaNextLabel: "➡️ अगला चरण",
    qaNextPrompt: "वर्तमान स्थिति के आधार पर, अगली उपयोगी कमांड सुझाएं (कोड ब्लॉक में)।",
    quickActionsTitle: "त्वरित क्रियाएं",
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
  /** 포커스된 패널의 백엔드 세션 id 조회 (#103: ssh_probe_system 호출용). */
  getSessionId?: (paneId: string) => string | undefined;
  /** 컨텍스트로 첨부할 활성 패널 출력 줄 수 (#103). 설정에서 변경, 기본 100. */
  contextLines?: number;
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
 * - 세션 컨텍스트 자동 첨부
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
  getSessionId,
  contextLines = 100,
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
  // 세션 단위 사고력 강도 오버라이드(#129): "" = 백엔드 등록값 사용.
  const [reasoningOverride, setReasoningOverride] = useState("");
  // 새 대화(+)로 리셋 후 진행 중이던 스트림 콜백이 이전 대화를 다시 그리지 않게 하는 세대 표식.
  const chatEpochRef = useRef(0);
  // 세션별 시스템 요약 캐시 (#103). OS/셸/유저는 세션 내내 안정적이라 한 번만 조회한다.
  const sysInfoCache = useRef<Map<string, string>>(new Map());

  // 포커스된 세션의 시스템 요약을 조용히 조회(SSH=별도 채널, 로컬=std). 실패하면 null.
  // 대화형 터미널에 흔적을 남기지 않으며, LLM이 명령을 고르는 게 아니라 고정 정보만 채운다.
  async function probeSystemInfo(): Promise<string | null> {
    if (!focusedSource) return null;
    try {
      if (focusedSource.kind === "ssh") {
        const sid = focusedPaneId ? getSessionId?.(focusedPaneId) : undefined;
        if (!sid) return null;
        const cached = sysInfoCache.current.get(sid);
        if (cached) return cached;
        const info = await invoke<string | null>("ssh_probe_system", {
          sessionId: sid,
        });
        if (info) sysInfoCache.current.set(sid, info);
        return info ?? null;
      }
      // 로컬: 같은 머신이라 세션 id 불필요. "local" 키로 한 번만 캐시.
      const cached = sysInfoCache.current.get("local");
      if (cached) return cached;
      const info = await invoke<string | null>("local_system_info");
      if (info) sysInfoCache.current.set("local", info);
      return info ?? null;
    } catch {
      return null;
    }
  }

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
    chatEpochRef.current += 1; // 진행 중 스트림이 이 세션 화면을 덮지 않게(#130).
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

  // 가져오기 후 LLM 백엔드 목록 즉시 갱신 — SettingsModal이 발행하는 이벤트(#114).
  useEffect(() => {
    const un = listen("wt://data-imported", () => void reload());
    return () => {
      void un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 백엔드 추가/수정/삭제 시 모든 탭의 AI 패널 갱신(#132) — AI 패널은 탭마다 별개
  // 인스턴스라, LlmSetupModal을 연 패널만 reload되고 다른 탭은 새로 열기 전까지 몰랐다.
  useEffect(() => {
    const un = listen("wt://backends-changed", () => void reload());
    return () => {
      void un.then((f) => f());
    };
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
    if (!text) return;
    setInput("");
    await sendText(text);
  }

  // 빠른 동작(에러 고치기 등)은 forceContext=true로 현재 출력을 무조건 첨부한다.
  async function sendText(text: string, forceContext = false) {
    if (!text || !current || busy) return;
    setError(null);
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
    // 이 요청이 속한 대화 세대(#130): 새 대화(+)로 세대가 바뀌면 늦은 스트림/에러 콜백을 버린다.
    const epoch = chatEpochRef.current;

    const reqMessages: ChatMessage[] = [];
    // 어떤 시스템에 연결됐는지(OS/셸/유저)와 현재 경로는 출력-첨부 토글과 무관하게 항상 주입한다 (#103).
    // "LLM이 어떤 시스템인지 안다"가 목적이므로 토글에 묶지 않는다 — 토글은 아래 100줄 출력만 제어.
    // 영어 한 줄 — 답변 언어는 ctxAssistantSys(로컬라이즈됨)가 결정하므로 영향 없음.
    {
      const sysParts: string[] = [];
      const sysInfo = await probeSystemInfo();
      if (sysInfo) sysParts.push(`system: ${sysInfo}`);
      const cwd = focusedPaneId ? getTerminal(focusedPaneId)?.getCwd() : null;
      if (cwd) sysParts.push(`cwd: ${cwd}`);
      if (sysParts.length) {
        reqMessages.push({
          role: "system",
          content:
            `Current session — ${sysParts.join("; ")}. ` +
            "Tailor any suggested commands to this system (OS, shell, paths).",
        });
      }
    }
    if (includeContext || forceContext) {
      const ctx = getTerminal(focusedPaneId)?.getRecentText(contextLines);
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
        // 세션 오버라이드가 있으면 요청에 실어 백엔드 등록값을 덮는다(#129).
        reasoning_effort: reasoningOverride || null,
      };
      const channel = new Channel<StreamEvent>();
      let acc = "";
      // 스트리밍으로 채울 빈 assistant 메시지를 미리 추가.
      setMessages([...display, { role: "assistant", content: "" }]);
      channel.onmessage = (ev) => {
        if (epoch !== chatEpochRef.current) return; // 새 대화로 리셋됨 — 이전 스트림 무시.
        if (ev.type === "delta") {
          acc += ev.delta;
          setMessages([...display, { role: "assistant", content: acc }]);
        } else if (ev.type === "done") {
          const final = [
            ...display,
            { role: "assistant" as const, content: ev.content || acc },
          ];
          setMessages(final);
          persistSession(sid, final);
        } else if (ev.type === "error") {
          setError(ev.message);
          const final = [
            ...display,
            { role: "assistant" as const, content: t.errorPrefix(ev.message) },
          ];
          setMessages(final);
          persistSession(sid, final);
        }
      };
      await invoke("ai_complete_stream", {
        backendId: current.id,
        request: req,
        onEvent: channel,
      });
    } catch (e) {
      if (epoch === chatEpochRef.current) {
        setError(String(e));
        const final = [
          ...display,
          { role: "assistant" as const, content: t.errorPrefix(String(e)) },
        ];
        setMessages(final);
        persistSession(sid, final);
      }
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
    // 포커스를 터미널로 옮긴다(#131): 버튼에 포커스가 남으면 Enter가 버튼을 다시 눌러
    // 같은 명령이 중복 입력됐다. 이제 입력 직후 바로 Enter로 실행할 수 있다.
    handle.focus();
  }

  // 터미널 커맨드 블록의 ✨ 버튼 → 그 블록(명령+출력)을 AI에 질문. ref로 최신 sendText 사용.
  const askRef = useRef<(block: string) => void>(() => {});
  askRef.current = (block: string) => {
    if (!current) return;
    setShowHistory(false);
    void sendText(
      `${t.qaExplainPrompt}\n\n\`\`\`\n${block.trim()}\n\`\`\``,
      false,
    );
  };
  useEffect(() => {
    setAskAIListener((block) => askRef.current(block));
    return () => setAskAIListener(null);
  }, []);

  function newChat() {
    // 진행 중 스트림이 이전 대화를 다시 그리지 않도록 세대를 올린다(#130 — "+ 가 안 먹는" 원인).
    chatEpochRef.current += 1;
    setBusy(false);
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
              borderRadius: 4,
              padding: "4px 6px",
              fontSize: 13,
              maxWidth: 200,
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
        {backends.length > 0 && (
          <select
            value={reasoningOverride}
            onChange={(e) => setReasoningOverride(e.target.value)}
            title="Reasoning effort (session override)"
            style={{
              background: "#101015",
              color: reasoningOverride ? "#9cf" : "#888",
              border: "1px solid #333",
              borderRadius: 4,
              padding: "4px 4px",
              fontSize: 12,
            }}
          >
            {/* 사고력 강도(#129): 기본은 백엔드 등록값, 세션 단위 오버라이드. 값은 그대로
                전달되므로 제공자별 확장값(minimal=OpenAI, max=GLM 등)도 지원. */}
            <option value="">🧠 auto</option>
            <option value="minimal">🧠 minimal</option>
            <option value="low">🧠 low</option>
            <option value="medium">🧠 med</option>
            <option value="high">🧠 high</option>
            <option value="max">🧠 max</option>
          </select>
        )}
        <button
          onClick={() => setShowSetup(true)}
          style={{
            ...iconBtnStyle,
            color: "#cfcfd6",
            display: "flex",
            alignItems: "center",
          }}
          title={t.backendSettings}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
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
            <div style={{ marginBottom: 10 }}>
              <AiMark size={44} />
            </div>
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

      {current && (
        <div
          title={t.quickActionsTitle}
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            padding: "8px 12px 0",
          }}
        >
          {[
            { label: t.qaFixLabel, prompt: t.qaFixPrompt },
            { label: t.qaExplainLabel, prompt: t.qaExplainPrompt },
            { label: t.qaNextLabel, prompt: t.qaNextPrompt },
          ].map((qa) => (
            <button
              key={qa.label}
              onClick={() => void sendText(qa.prompt, true)}
              disabled={busy}
              title={qa.prompt}
              style={{
                background: "#202a38",
                color: "#cde",
                border: "1px solid #2f3f52",
                borderRadius: 14,
                padding: "3px 10px",
                fontSize: 11,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {qa.label}
            </button>
          ))}
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
      <div style={{ marginBottom: 10 }}>
        <AiMark size={44} />
      </div>
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
  fontSize: 17,
  padding: "2px 6px",
  lineHeight: 1,
};
