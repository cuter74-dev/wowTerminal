import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import {
  AppSettings,
  Lang,
  LANGS,
  UI_FONTS,
  ShortcutAction,
  KeyBinding,
  DEFAULT_KEYBINDINGS,
  formatBinding,
} from "../settings";
import { LangDict, useT } from "../i18n";
import { Group, SshHost, Tag } from "../types";

interface Props {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  onClose: () => void;
}

type TabId = "general" | "terminal" | "shortcuts" | "backup";

const STR: LangDict<{
    settings: string;
    tabGeneral: string;
    tabTerminal: string;
    tabShortcuts: string;
    tabBackup: string;
    language: string;
    uiFontLabel: string;
    restoreTabs: string;
    aboutDesc: string;
    checkUpdate: string;
    upToDate: string;
    fontSize: string;
    fontFamily: string;
    theme: string;
    dark: string;
    light: string;
    cursorBlink: string;
    scrollback: string;
    altScreenWheelScroll: string;
    applyNote: string;
    readonlyNote: string;
    export: string;
    exportFile: string;
    importFile: string;
    importSshConfig: string;
    sshConfigEmpty: string;
    sshConfigImported: (n: number) => string;
    copy: string;
    import: string;
    backupPlaceholder: string;
    secretsNote: string;
    exportDone: string;
    exportFileDone: (path: string) => string;
    exportFail: (e: string) => string;
    importDone: (h: number, g: number, t: number) => string;
    importFail: (e: string) => string;
  }
> = {
  en: {
    settings: "Settings",
    tabGeneral: "General",
    tabTerminal: "Terminal/Theme",
    tabShortcuts: "Shortcuts",
    tabBackup: "Import/Export",
    language: "Language",
    uiFontLabel: "UI font",
    restoreTabs: "Restore last tabs on startup (later)",
    aboutDesc: "A context-aware AI terminal — LLM × SSH × SFTP.",
    checkUpdate: "Check for updates",
    upToDate: "You're on the latest version.",
    fontSize: "Font size",
    fontFamily: "Font family",
    theme: "Theme",
    dark: "Dark",
    light: "Light",
    cursorBlink: "Cursor blink",
    scrollback: "Scrollback (lines)",
    altScreenWheelScroll: "Wheel scroll in alt-screen (less/vim)",
    applyNote: "Applied to all terminals immediately.",
    readonlyNote: "v1 is read-only. Custom key bindings later.",
    export: "Export (hosts/groups/tags)",
    copy: "Copy",
    import: "Import",
    backupPlaceholder:
      "Exported JSON appears here. To import, paste JSON and click [Import].",
    secretsNote:
      "Secrets (passwords/keys) stay in the Keychain and are not included in the export. But host addresses and usernames ARE included — avoid cloud-synced locations.",
    exportDone:
      "Export complete — copy the JSON below to keep it. (Secrets are not included)",
    exportFail: (e) => `Export failed: ${e}`,
    exportFile: "Export to file…",
    importFile: "Import from file…",
    importSshConfig: "Import ~/.ssh/config",
    sshConfigEmpty: "~/.ssh/config not found or empty.",
    sshConfigImported: (n) => `Imported ${n} hosts from ~/.ssh/config.`,
    exportFileDone: (p) => `Saved to ${p}`,
    importDone: (h, g, t) => `Import complete: hosts ${h} / groups ${g} / tags ${t}`,
    importFail: (e) => `Import failed: ${e}`,
  },
  ko: {
    settings: "설정",
    tabGeneral: "일반",
    tabTerminal: "터미널/테마",
    tabShortcuts: "단축키",
    tabBackup: "가져오기/내보내기",
    language: "언어",
    uiFontLabel: "UI 글꼴",
    restoreTabs: "앱 시작 시 마지막 탭 복원 (후속)",
    aboutDesc: "컨텍스트를 아는 AI 터미널 — LLM × SSH × SFTP.",
    checkUpdate: "업데이트 확인",
    upToDate: "현재 최신 버전입니다.",
    fontSize: "폰트 크기",
    fontFamily: "폰트 패밀리",
    theme: "테마",
    dark: "다크",
    light: "라이트",
    cursorBlink: "커서 깜빡임",
    scrollback: "스크롤백 (줄)",
    altScreenWheelScroll: "대체 화면 휠 스크롤 (less/vim)",
    applyNote: "변경 즉시 모든 터미널에 적용됩니다.",
    readonlyNote: "v1은 읽기 전용입니다. 사용자 정의 키 바인딩은 후속.",
    export: "내보내기 (호스트/그룹/태그)",
    copy: "복사",
    import: "가져오기",
    backupPlaceholder:
      "내보낸 JSON이 여기 표시됩니다. 가져오려면 JSON을 붙여넣고 [가져오기].",
    secretsNote:
      "시크릿(비밀번호/키)은 Keychain에 남고 export에 포함되지 않습니다. 단, 호스트 주소·계정명은 포함되니 클라우드 동기화 위치는 피하세요.",
    exportDone:
      "내보내기 완료 — 아래 JSON을 복사해 보관하세요. (시크릿은 포함되지 않습니다)",
    exportFail: (e) => `내보내기 실패: ${e}`,
    exportFile: "파일로 내보내기…",
    importFile: "파일에서 가져오기…",
    importSshConfig: "~/.ssh/config 가져오기",
    sshConfigEmpty: "~/.ssh/config가 없거나 비어 있습니다.",
    sshConfigImported: (n) => `~/.ssh/config에서 ${n}개 호스트를 가져왔습니다.`,
    exportFileDone: (p) => `저장됨: ${p}`,
    importDone: (h, g, t) => `가져오기 완료: 호스트 ${h} / 그룹 ${g} / 태그 ${t}`,
    importFail: (e) => `가져오기 실패: ${e}`,
  },
  es: {
    settings: "Configuración",
    tabGeneral: "General",
    tabTerminal: "Terminal/Tema",
    tabShortcuts: "Atajos",
    tabBackup: "Importar/Exportar",
    language: "Idioma",
    uiFontLabel: "Fuente de interfaz",
    restoreTabs: "Restaurar las últimas pestañas al iniciar (más adelante)",
    aboutDesc: "Un terminal de IA con reconocimiento de contexto — LLM × SSH × SFTP.",
    checkUpdate: "Buscar actualizaciones",
    upToDate: "Estás en la última versión.",
    fontSize: "Tamaño de fuente",
    fontFamily: "Familia de fuente",
    theme: "Tema",
    dark: "Oscuro",
    light: "Claro",
    cursorBlink: "Parpadeo del cursor",
    scrollback: "Desplazamiento (líneas)",
    altScreenWheelScroll: "Rueda en pantalla alternativa (less/vim)",
    applyNote: "Aplicado a todas las terminales de inmediato.",
    readonlyNote: "v1 es de solo lectura. Atajos personalizados más adelante.",
    export: "Exportar (hosts/grupos/etiquetas)",
    copy: "Copiar",
    import: "Importar",
    backupPlaceholder:
      "El JSON exportado aparece aquí. Para importar, pega el JSON y haz clic en [Importar].",
    secretsNote:
      "Los secretos (contraseñas/claves) permanecen en el Keychain y no se incluyen en la exportación. Pero las direcciones de host y los nombres de usuario SÍ se incluyen; evita ubicaciones sincronizadas en la nube.",
    exportDone:
      "Exportación completa — copia el JSON de abajo para conservarlo. (Los secretos no se incluyen)",
    exportFail: (e) => `Exportación fallida: ${e}`,
    exportFile: "Exportar a archivo…",
    importFile: "Importar desde archivo…",
    importSshConfig: "Importar ~/.ssh/config",
    sshConfigEmpty: "~/.ssh/config no encontrado o vacío.",
    sshConfigImported: (n) => `Se importaron ${n} hosts de ~/.ssh/config.`,
    exportFileDone: (p) => `Guardado en ${p}`,
    importDone: (h, g, t) => `Importación completa: hosts ${h} / grupos ${g} / etiquetas ${t}`,
    importFail: (e) => `Importación fallida: ${e}`,
  },
  zh: {
    settings: "设置",
    tabGeneral: "常规",
    tabTerminal: "终端/主题",
    tabShortcuts: "快捷键",
    tabBackup: "导入/导出",
    language: "语言",
    uiFontLabel: "界面字体",
    restoreTabs: "启动时恢复上次的标签页（稍后）",
    aboutDesc: "一个具有上下文感知的 AI 终端 — LLM × SSH × SFTP.",
    checkUpdate: "检查更新",
    upToDate: "您使用的是最新版本.",
    fontSize: "字体大小",
    fontFamily: "字体",
    theme: "主题",
    dark: "深色",
    light: "浅色",
    cursorBlink: "光标闪烁",
    scrollback: "回滚（行数）",
    altScreenWheelScroll: "备用屏幕滚轮滚动 (less/vim)",
    applyNote: "立即应用到所有终端。",
    readonlyNote: "v1 为只读。自定义按键绑定稍后推出。",
    export: "导出（主机/分组/标签）",
    copy: "复制",
    import: "导入",
    backupPlaceholder:
      "导出的 JSON 显示在这里。要导入，请粘贴 JSON 并点击 [导入]。",
    secretsNote:
      "密钥（密码/密钥）保留在 Keychain 中，不包含在导出内容中。但主机地址和用户名会包含在内，请避免使用云同步位置。",
    exportDone:
      "导出完成 — 复制下方的 JSON 进行保存。（不包含密钥）",
    exportFail: (e) => `导出失败: ${e}`,
    exportFile: "导出到文件…",
    importFile: "从文件导入…",
    importSshConfig: "导入 ~/.ssh/config",
    sshConfigEmpty: "未找到 ~/.ssh/config 或为空。",
    sshConfigImported: (n) => `已从 ~/.ssh/config 导入 ${n} 个主机。`,
    exportFileDone: (p) => `已保存到 ${p}`,
    importDone: (h, g, t) => `导入完成: 主机 ${h} / 分组 ${g} / 标签 ${t}`,
    importFail: (e) => `导入失败: ${e}`,
  },
  ja: {
    settings: "設定",
    tabGeneral: "一般",
    tabTerminal: "ターミナル/テーマ",
    tabShortcuts: "ショートカット",
    tabBackup: "インポート/エクスポート",
    language: "言語",
    uiFontLabel: "UI フォント",
    restoreTabs: "起動時に前回のタブを復元（後日）",
    aboutDesc: "コンテキストを理解する AI ターミナル — LLM × SSH × SFTP.",
    checkUpdate: "更新を確認",
    upToDate: "最新バージョンです.",
    fontSize: "フォントサイズ",
    fontFamily: "フォントファミリー",
    theme: "テーマ",
    dark: "ダーク",
    light: "ライト",
    cursorBlink: "カーソルの点滅",
    scrollback: "スクロールバック（行）",
    altScreenWheelScroll: "代替画面でホイールスクロール (less/vim)",
    applyNote: "すべてのターミナルに即座に適用されます。",
    readonlyNote: "v1 は読み取り専用です。カスタムキーバインドは後日。",
    export: "エクスポート（ホスト/グループ/タグ）",
    copy: "コピー",
    import: "インポート",
    backupPlaceholder:
      "エクスポートした JSON がここに表示されます。インポートするには JSON を貼り付けて [インポート] をクリック。",
    secretsNote:
      "シークレット（パスワード/キー）は Keychain に残り、エクスポートには含まれません。ただしホストアドレスとユーザー名は含まれます。クラウド同期先は避けてください。",
    exportDone:
      "エクスポート完了 — 下の JSON をコピーして保管してください。（シークレットは含まれません）",
    exportFail: (e) => `エクスポート失敗: ${e}`,
    exportFile: "ファイルに書き出し…",
    importFile: "ファイルから読み込み…",
    importSshConfig: "~/.ssh/config を取り込み",
    sshConfigEmpty: "~/.ssh/config が見つからないか空です。",
    sshConfigImported: (n) => `~/.ssh/config から ${n} 件のホストを取り込みました。`,
    exportFileDone: (p) => `保存しました: ${p}`,
    importDone: (h, g, t) => `インポート完了: ホスト ${h} / グループ ${g} / タグ ${t}`,
    importFail: (e) => `インポート失敗: ${e}`,
  },
  ru: {
    settings: "Настройки",
    tabGeneral: "Общие",
    tabTerminal: "Терминал/Тема",
    tabShortcuts: "Сочетания клавиш",
    tabBackup: "Импорт/Экспорт",
    language: "Язык",
    uiFontLabel: "Шрифт интерфейса",
    restoreTabs: "Восстанавливать последние вкладки при запуске (позже)",
    aboutDesc: "Контекстно-зависимый ИИ-терминал — LLM × SSH × SFTP.",
    checkUpdate: "Проверить обновления",
    upToDate: "У вас последняя версия.",
    fontSize: "Размер шрифта",
    fontFamily: "Семейство шрифтов",
    theme: "Тема",
    dark: "Тёмная",
    light: "Светлая",
    cursorBlink: "Мигание курсора",
    scrollback: "Прокрутка (строки)",
    altScreenWheelScroll: "Колесо в alt-экране (less/vim)",
    applyNote: "Применяется ко всем терминалам мгновенно.",
    readonlyNote: "v1 только для чтения. Пользовательские сочетания клавиш позже.",
    export: "Экспорт (хосты/группы/теги)",
    copy: "Копировать",
    import: "Импорт",
    backupPlaceholder:
      "Экспортированный JSON появится здесь. Чтобы импортировать, вставьте JSON и нажмите [Импорт].",
    secretsNote:
      "Секреты (пароли/ключи) остаются в Keychain и не включаются в экспорт. Но адреса хостов и имена пользователей включаются — избегайте облачных папок.",
    exportDone:
      "Экспорт завершён — скопируйте JSON ниже, чтобы сохранить его. (Секреты не включены)",
    exportFail: (e) => `Ошибка экспорта: ${e}`,
    exportFile: "Экспорт в файл…",
    importFile: "Импорт из файла…",
    importSshConfig: "Импорт ~/.ssh/config",
    sshConfigEmpty: "~/.ssh/config не найден или пуст.",
    sshConfigImported: (n) => `Импортировано хостов из ~/.ssh/config: ${n}.`,
    exportFileDone: (p) => `Сохранено: ${p}`,
    importDone: (h, g, t) => `Импорт завершён: хосты ${h} / группы ${g} / теги ${t}`,
    importFail: (e) => `Ошибка импорта: ${e}`,
  },
  fr: {
    settings: "Paramètres",
    tabGeneral: "Général",
    tabTerminal: "Terminal/Thème",
    tabShortcuts: "Raccourcis",
    tabBackup: "Importer/Exporter",
    language: "Langue",
    uiFontLabel: "Police de l'interface",
    restoreTabs: "Restaurer les derniers onglets au démarrage (plus tard)",
    aboutDesc: "Un terminal IA sensible au contexte — LLM × SSH × SFTP.",
    checkUpdate: "Vérifier les mises à jour",
    upToDate: "Vous utilisez la dernière version.",
    fontSize: "Taille de police",
    fontFamily: "Famille de police",
    theme: "Thème",
    dark: "Sombre",
    light: "Clair",
    cursorBlink: "Clignotement du curseur",
    scrollback: "Défilement arrière (lignes)",
    altScreenWheelScroll: "Molette en écran alternatif (less/vim)",
    applyNote: "Appliqué immédiatement à tous les terminaux.",
    readonlyNote: "v1 est en lecture seule. Raccourcis personnalisés plus tard.",
    export: "Exporter (hôtes/groupes/étiquettes)",
    copy: "Copier",
    import: "Importer",
    backupPlaceholder:
      "Le JSON exporté apparaît ici. Pour importer, collez le JSON et cliquez sur [Importer].",
    secretsNote:
      "Les secrets (mots de passe/clés) restent dans le Keychain et ne sont pas inclus dans l'exportation. Mais les adresses d'hôte et les noms d'utilisateur SONT inclus — évitez les emplacements synchronisés dans le cloud.",
    exportDone:
      "Exportation terminée — copiez le JSON ci-dessous pour le conserver. (Les secrets ne sont pas inclus)",
    exportFail: (e) => `Échec de l'exportation : ${e}`,
    exportFile: "Exporter vers un fichier…",
    importFile: "Importer depuis un fichier…",
    importSshConfig: "Importer ~/.ssh/config",
    sshConfigEmpty: "~/.ssh/config introuvable ou vide.",
    sshConfigImported: (n) => `${n} hôtes importés depuis ~/.ssh/config.`,
    exportFileDone: (p) => `Enregistré : ${p}`,
    importDone: (h, g, t) => `Importation terminée : hôtes ${h} / groupes ${g} / étiquettes ${t}`,
    importFail: (e) => `Échec de l'importation : ${e}`,
  },
  de: {
    settings: "Einstellungen",
    tabGeneral: "Allgemein",
    tabTerminal: "Terminal/Design",
    tabShortcuts: "Tastenkürzel",
    tabBackup: "Importieren/Exportieren",
    language: "Sprache",
    uiFontLabel: "UI-Schriftart",
    restoreTabs: "Letzte Tabs beim Start wiederherstellen (später)",
    aboutDesc: "Ein kontextbewusstes KI-Terminal — LLM × SSH × SFTP.",
    checkUpdate: "Nach Updates suchen",
    upToDate: "Sie haben die neueste Version.",
    fontSize: "Schriftgröße",
    fontFamily: "Schriftfamilie",
    theme: "Design",
    dark: "Dunkel",
    light: "Hell",
    cursorBlink: "Cursor-Blinken",
    scrollback: "Rückblättern (Zeilen)",
    altScreenWheelScroll: "Mausrad im Alt-Bildschirm (less/vim)",
    applyNote: "Wird sofort auf alle Terminals angewendet.",
    readonlyNote: "v1 ist schreibgeschützt. Benutzerdefinierte Tastenbelegungen später.",
    export: "Exportieren (Hosts/Gruppen/Tags)",
    copy: "Kopieren",
    import: "Importieren",
    backupPlaceholder:
      "Exportiertes JSON erscheint hier. Zum Importieren JSON einfügen und auf [Importieren] klicken.",
    secretsNote:
      "Geheimnisse (Passwörter/Schlüssel) bleiben im Keychain und sind nicht im Export enthalten. Hostadressen und Benutzernamen sind jedoch enthalten – meiden Sie Cloud-synchronisierte Orte.",
    exportDone:
      "Export abgeschlossen — kopieren Sie das JSON unten, um es aufzubewahren. (Geheimnisse sind nicht enthalten)",
    exportFail: (e) => `Export fehlgeschlagen: ${e}`,
    exportFile: "In Datei exportieren…",
    importFile: "Aus Datei importieren…",
    importSshConfig: "~/.ssh/config importieren",
    sshConfigEmpty: "~/.ssh/config nicht gefunden oder leer.",
    sshConfigImported: (n) => `${n} Hosts aus ~/.ssh/config importiert.`,
    exportFileDone: (p) => `Gespeichert: ${p}`,
    importDone: (h, g, t) => `Import abgeschlossen: Hosts ${h} / Gruppen ${g} / Tags ${t}`,
    importFail: (e) => `Import fehlgeschlagen: ${e}`,
  },
  vi: {
    settings: "Cài đặt",
    tabGeneral: "Chung",
    tabTerminal: "Terminal/Giao diện",
    tabShortcuts: "Phím tắt",
    tabBackup: "Nhập/Xuất",
    language: "Ngôn ngữ",
    uiFontLabel: "Phông chữ giao diện",
    restoreTabs: "Khôi phục các tab gần nhất khi khởi động (sau này)",
    aboutDesc: "Một terminal AI nhận biết ngữ cảnh — LLM × SSH × SFTP.",
    checkUpdate: "Kiểm tra cập nhật",
    upToDate: "Bạn đang dùng phiên bản mới nhất.",
    fontSize: "Cỡ chữ",
    fontFamily: "Phông chữ",
    theme: "Giao diện",
    dark: "Tối",
    light: "Sáng",
    cursorBlink: "Nhấp nháy con trỏ",
    scrollback: "Cuộn lại (dòng)",
    altScreenWheelScroll: "Cuộn chuột ở màn hình thay thế (less/vim)",
    applyNote: "Áp dụng ngay cho tất cả các terminal.",
    readonlyNote: "v1 chỉ đọc. Tùy chỉnh phím tắt sẽ có sau.",
    export: "Xuất (máy chủ/nhóm/thẻ)",
    copy: "Sao chép",
    import: "Nhập",
    backupPlaceholder:
      "JSON đã xuất hiển thị ở đây. Để nhập, dán JSON và nhấp [Nhập].",
    secretsNote:
      "Các bí mật (mật khẩu/khóa) vẫn nằm trong Keychain và không được bao gồm trong bản xuất. Nhưng địa chỉ máy chủ và tên người dùng CÓ được bao gồm — tránh các vị trí đồng bộ đám mây.",
    exportDone:
      "Xuất hoàn tất — sao chép JSON bên dưới để lưu giữ. (Không bao gồm bí mật)",
    exportFail: (e) => `Xuất thất bại: ${e}`,
    exportFile: "Xuất ra tệp…",
    importFile: "Nhập từ tệp…",
    importSshConfig: "Nhập ~/.ssh/config",
    sshConfigEmpty: "Không tìm thấy ~/.ssh/config hoặc trống.",
    sshConfigImported: (n) => `Đã nhập ${n} máy chủ từ ~/.ssh/config.`,
    exportFileDone: (p) => `Đã lưu: ${p}`,
    importDone: (h, g, t) => `Nhập hoàn tất: máy chủ ${h} / nhóm ${g} / thẻ ${t}`,
    importFail: (e) => `Nhập thất bại: ${e}`,
  },
  id: {
    settings: "Pengaturan",
    tabGeneral: "Umum",
    tabTerminal: "Terminal/Tema",
    tabShortcuts: "Pintasan",
    tabBackup: "Impor/Ekspor",
    language: "Bahasa",
    uiFontLabel: "Font UI",
    restoreTabs: "Pulihkan tab terakhir saat memulai (nanti)",
    aboutDesc: "Terminal AI yang sadar konteks — LLM × SSH × SFTP.",
    checkUpdate: "Periksa pembaruan",
    upToDate: "Anda menggunakan versi terbaru.",
    fontSize: "Ukuran font",
    fontFamily: "Jenis font",
    theme: "Tema",
    dark: "Gelap",
    light: "Terang",
    cursorBlink: "Kedipan kursor",
    scrollback: "Gulir balik (baris)",
    altScreenWheelScroll: "Gulir roda di layar alternatif (less/vim)",
    applyNote: "Diterapkan ke semua terminal segera.",
    readonlyNote: "v1 hanya-baca. Pengikatan tombol khusus nanti.",
    export: "Ekspor (host/grup/tag)",
    copy: "Salin",
    import: "Impor",
    backupPlaceholder:
      "JSON yang diekspor muncul di sini. Untuk mengimpor, tempel JSON dan klik [Impor].",
    secretsNote:
      "Rahasia (kata sandi/kunci) tetap di Keychain dan tidak disertakan dalam ekspor. Namun alamat host dan nama pengguna DISERTAKAN — hindari lokasi yang disinkronkan ke cloud.",
    exportDone:
      "Ekspor selesai — salin JSON di bawah untuk menyimpannya. (Rahasia tidak disertakan)",
    exportFail: (e) => `Ekspor gagal: ${e}`,
    exportFile: "Ekspor ke berkas…",
    importFile: "Impor dari berkas…",
    importSshConfig: "Impor ~/.ssh/config",
    sshConfigEmpty: "~/.ssh/config tidak ditemukan atau kosong.",
    sshConfigImported: (n) => `Mengimpor ${n} host dari ~/.ssh/config.`,
    exportFileDone: (p) => `Disimpan ke ${p}`,
    importDone: (h, g, t) => `Impor selesai: host ${h} / grup ${g} / tag ${t}`,
    importFail: (e) => `Impor gagal: ${e}`,
  },
  hi: {
    settings: "सेटिंग्स",
    tabGeneral: "सामान्य",
    tabTerminal: "टर्मिनल/थीम",
    tabShortcuts: "शॉर्टकट",
    tabBackup: "आयात/निर्यात",
    language: "भाषा",
    uiFontLabel: "UI फ़ॉन्ट",
    restoreTabs: "शुरू होने पर अंतिम टैब पुनर्स्थापित करें (बाद में)",
    aboutDesc: "एक संदर्भ-जागरूक AI टर्मिनल — LLM × SSH × SFTP.",
    checkUpdate: "अपडेट जाँचें",
    upToDate: "आप नवीनतम संस्करण पर हैं.",
    fontSize: "फ़ॉन्ट आकार",
    fontFamily: "फ़ॉन्ट परिवार",
    theme: "थीम",
    dark: "गहरा",
    light: "हल्का",
    cursorBlink: "कर्सर ब्लिंक",
    scrollback: "स्क्रॉलबैक (पंक्तियाँ)",
    altScreenWheelScroll: "ऑल्ट-स्क्रीन में व्हील स्क्रॉल (less/vim)",
    applyNote: "सभी टर्मिनलों पर तुरंत लागू।",
    readonlyNote: "v1 केवल-पढ़ने के लिए है। कस्टम की बाइंडिंग बाद में।",
    export: "निर्यात (होस्ट/समूह/टैग)",
    copy: "कॉपी करें",
    import: "आयात",
    backupPlaceholder:
      "निर्यात किया गया JSON यहाँ दिखता है। आयात करने के लिए, JSON पेस्ट करें और [आयात] पर क्लिक करें।",
    secretsNote:
      "रहस्य (पासवर्ड/कुंजियाँ) Keychain में रहते हैं और निर्यात में शामिल नहीं होते। लेकिन होस्ट पते और उपयोगकर्ता नाम शामिल होते हैं — क्लाउड-सिंक स्थानों से बचें।",
    exportDone:
      "निर्यात पूर्ण — इसे रखने के लिए नीचे का JSON कॉपी करें। (रहस्य शामिल नहीं हैं)",
    exportFail: (e) => `निर्यात विफल: ${e}`,
    exportFile: "फ़ाइल में निर्यात…",
    importFile: "फ़ाइल से आयात…",
    importSshConfig: "~/.ssh/config आयात करें",
    sshConfigEmpty: "~/.ssh/config नहीं मिला या खाली है।",
    sshConfigImported: (n) => `~/.ssh/config से ${n} होस्ट आयात किए।`,
    exportFileDone: (p) => `सहेजा गया: ${p}`,
    importDone: (h, g, t) => `आयात पूर्ण: होस्ट ${h} / समूह ${g} / टैग ${t}`,
    importFail: (e) => `आयात विफल: ${e}`,
  },
};

export function SettingsModal({ settings, onChange, onClose }: Props) {
  const t = useT(STR);
  const [tab, setTab] = useState<TabId>("general");
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  const TABS: Array<{ id: TabId; label: string }> = [
    { id: "general", label: t.tabGeneral },
    { id: "terminal", label: t.tabTerminal },
    { id: "shortcuts", label: t.tabShortcuts },
    { id: "backup", label: t.tabBackup },
  ];

  function patchTerminal(p: Partial<AppSettings["terminal"]>) {
    onChange({ ...settings, terminal: { ...settings.terminal, ...p } });
  }
  function patchGeneral(p: Partial<AppSettings["general"]>) {
    onChange({ ...settings, general: { ...settings.general, ...p } });
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle} role="dialog" aria-modal="true">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 15 }}>⚙ {t.settings}</strong>
          <button onClick={onClose} style={iconBtnStyle}>×</button>
        </header>

        <div style={{ display: "flex", gap: 6, borderBottom: "1px solid #2a2a30", paddingBottom: 8 }}>
          {TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              style={{
                background: tab === tb.id ? "#094771" : "transparent",
                color: tab === tb.id ? "#fff" : "#aaa",
                border: "none",
                borderRadius: 4,
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div style={{ minHeight: 280 }}>
          {tab === "general" && (
            <Section>
              <Row label={t.language}>
                <select
                  value={settings.general.language}
                  onChange={(e) => patchGeneral({ language: e.target.value as Lang })}
                  style={inputStyle}
                >
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label={t.uiFontLabel}>
                <select
                  value={settings.general.uiFont}
                  onChange={(e) => patchGeneral({ uiFont: e.target.value })}
                  style={{ ...inputStyle, fontFamily: settings.general.uiFont }}
                >
                  {UI_FONTS.map((f) => (
                    <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label={t.restoreTabs}>
                <input
                  type="checkbox"
                  checked={settings.general.restoreTabs}
                  onChange={(e) => patchGeneral({ restoreTabs: e.target.checked })}
                />
              </Row>

              {/* About (S-068) */}
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  background: "#1d1d24",
                  border: "1px solid #2f2f37",
                  borderRadius: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <img
                    src="/logo.png"
                    alt="AI Terminal"
                    style={{ width: 32, height: 32, objectFit: "contain" }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, color: "#fff" }}>AI Terminal</div>
                    <div style={{ fontSize: 11, color: "#789" }}>
                      {appVersion ? `v${appVersion}` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#9aa", lineHeight: 1.6 }}>
                  {t.aboutDesc}
                  <br />
                  Tauri 2 (Rust) · React 19 · xterm.js · russh · russh-sftp
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={() => alert(t.upToDate)}
                    style={{
                      background: "#2a2a35",
                      color: "#ddd",
                      border: "1px solid #444",
                      borderRadius: 4,
                      padding: "5px 12px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    {t.checkUpdate}
                  </button>
                  <span style={{ fontSize: 11, color: "#566" }}>
                    github.com/cuter74-dev/wowTerminal
                  </span>
                </div>
              </div>
            </Section>
          )}

          {tab === "terminal" && (
            <Section>
              <Row label={t.fontSize}>
                <input
                  type="number"
                  min={8}
                  max={32}
                  value={settings.terminal.fontSize}
                  onChange={(e) =>
                    patchTerminal({ fontSize: parseInt(e.target.value || "14", 10) })
                  }
                  style={inputStyle}
                />
              </Row>
              <Row label={t.fontFamily}>
                <input
                  value={settings.terminal.fontFamily}
                  onChange={(e) => patchTerminal({ fontFamily: e.target.value })}
                  style={{ ...inputStyle, width: 240 }}
                />
              </Row>
              <Row label={t.theme}>
                <select
                  value={settings.terminal.theme}
                  onChange={(e) =>
                    patchTerminal({ theme: e.target.value as "dark" | "light" })
                  }
                  style={inputStyle}
                >
                  <option value="dark">{t.dark}</option>
                  <option value="light">{t.light}</option>
                </select>
              </Row>
              <Row label={t.cursorBlink}>
                <input
                  type="checkbox"
                  checked={settings.terminal.cursorBlink}
                  onChange={(e) => patchTerminal({ cursorBlink: e.target.checked })}
                />
              </Row>
              <Row label={t.scrollback}>
                <input
                  type="number"
                  min={100}
                  max={100000}
                  step={100}
                  value={settings.terminal.scrollback}
                  onChange={(e) =>
                    patchTerminal({ scrollback: parseInt(e.target.value || "1000", 10) })
                  }
                  style={inputStyle}
                />
              </Row>
              <Row label={t.altScreenWheelScroll}>
                <input
                  type="checkbox"
                  checked={settings.terminal.altScreenWheelScroll}
                  onChange={(e) =>
                    patchTerminal({ altScreenWheelScroll: e.target.checked })
                  }
                />
              </Row>
              <div style={{ color: "#789", fontSize: 11, marginTop: 6 }}>
                {t.applyNote}
              </div>
            </Section>
          )}

          {tab === "shortcuts" && (
            <ShortcutsTab settings={settings} onChange={onChange} />
          )}

          {tab === "backup" && <BackupTab />}
        </div>
      </div>
    </div>
  );
}

// 단축키 탭 전용 문자열 (큰 STR을 안 건드리도록 별도; en 필수, 나머지는 en 폴백).
const SC_STR: LangDict<{
  rebind: string;
  recording: string;
  resetDefaults: string;
  fixedNote: string;
  hint: string;
}> = {
  en: {
    rebind: "Rebind",
    recording: "Press keys…",
    resetDefaults: "Reset to defaults",
    fixedNote:
      "Fixed: Ctrl/⌘ + 1–9 (jump to tab), Ctrl/⌘ + Shift + Arrows (focus pane / move tab).",
    hint: "Click Rebind, then press the new key combination.",
  },
  ko: {
    rebind: "재지정",
    recording: "키 입력…",
    resetDefaults: "기본값 복원",
    fixedNote:
      "고정: Ctrl/⌘ + 1~9 (탭 이동), Ctrl/⌘ + Shift + 화살표 (패널 포커스 / 탭 이동).",
    hint: "재지정을 누른 뒤 새 키 조합을 입력하세요.",
  },
};

const ACTION_LABELS: LangDict<Record<ShortcutAction, string>> = {
  en: {
    newTab: "New tab",
    closeTab: "Close tab",
    nextTab: "Next tab",
    prevTab: "Previous tab",
    splitVertical: "Split left/right",
    splitHorizontal: "Split top/bottom",
    duplicateTab: "Duplicate tab",
    renameTab: "Rename tab",
  },
  ko: {
    newTab: "새 탭",
    closeTab: "탭 닫기",
    nextTab: "다음 탭",
    prevTab: "이전 탭",
    splitVertical: "좌우 분할",
    splitHorizontal: "상하 분할",
    duplicateTab: "탭 복제",
    renameTab: "탭 이름 변경",
  },
};

const SHORTCUT_ACTIONS: ShortcutAction[] = [
  "newTab",
  "closeTab",
  "nextTab",
  "prevTab",
  "splitVertical",
  "splitHorizontal",
  "duplicateTab",
  "renameTab",
];

function ShortcutsTab({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
}) {
  const sc = useT(SC_STR);
  const labels = useT(ACTION_LABELS);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    if (!recording) return;
    const action: ShortcutAction = recording;
    function onKey(e: KeyboardEvent) {
      // 캡처 단계에서 가로채 앱 전역 단축키가 발동하지 않게 한다.
      e.preventDefault();
      e.stopPropagation();
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return; // 수정자 단독은 무시
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const binding: KeyBinding = {
        key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
        mod: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
      };
      onChange({
        ...settings,
        keybindings: { ...settings.keybindings, [action]: binding },
      });
      setRecording(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, settings, onChange]);

  return (
    <Section>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {SHORTCUT_ACTIONS.map((a) => (
            <tr key={a}>
              <td style={{ padding: "5px 8px" }}>{labels[a]}</td>
              <td style={{ padding: "5px 8px", textAlign: "right" }}>
                <kbd style={kbdStyle}>{formatBinding(settings.keybindings[a])}</kbd>
              </td>
              <td style={{ padding: "5px 8px", width: 90, textAlign: "right" }}>
                <button
                  onClick={() => setRecording(a)}
                  style={{
                    ...btnStyle,
                    padding: "3px 8px",
                    background: recording === a ? "#0a5380" : "#3a3a3a",
                    borderColor: recording === a ? "#4a9eff" : "#555",
                  }}
                >
                  {recording === a ? sc.recording : sc.rebind}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <span style={{ color: "#789", fontSize: 11 }}>{sc.hint}</span>
        <button
          onClick={() =>
            onChange({ ...settings, keybindings: { ...DEFAULT_KEYBINDINGS } })
          }
          style={btnStyle}
        >
          {sc.resetDefaults}
        </button>
      </div>
      <div style={{ color: "#789", fontSize: 11, marginTop: 6 }}>{sc.fixedNote}</div>
    </Section>
  );
}

interface ParsedSshHost {
  name: string;
  host: string;
  user: string;
  port: number;
}

/** ~/.ssh/config의 Host 블록을 파싱한다. 와일드카드(*,?) Host는 건너뛴다. */
function parseSshConfig(text: string): ParsedSshHost[] {
  const out: ParsedSshHost[] = [];
  let cur: ParsedSshHost | null = null;
  const flush = () => {
    if (cur && cur.name && !/[*?]/.test(cur.name)) out.push(cur);
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\S+)[\s=]+(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "host") {
      flush();
      const alias =
        val.split(/\s+/).find((a) => !/[*?]/.test(a)) ?? val.split(/\s+/)[0];
      cur = { name: alias, host: alias, user: "", port: 22 };
    } else if (cur) {
      if (key === "hostname") cur.host = val;
      else if (key === "user") cur.user = val;
      else if (key === "port") cur.port = parseInt(val, 10) || 22;
    }
  }
  flush();
  return out;
}

function BackupTab() {
  const t = useT(STR);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function buildExportJson(): Promise<string> {
    const [hosts, groups, tags] = await Promise.all([
      invoke<SshHost[]>("ssh_list_hosts"),
      invoke<Group[]>("ssh_list_groups"),
      invoke<Tag[]>("ssh_list_tags"),
    ]);
    return JSON.stringify({ version: 1, hosts, groups, tags }, null, 2);
  }

  async function applyImportJson(json: string): Promise<string> {
    const parsed = JSON.parse(json);
    const groups: Group[] = parsed.groups ?? [];
    const tags: Tag[] = parsed.tags ?? [];
    const hosts: SshHost[] = parsed.hosts ?? [];
    for (const g of groups) await invoke("ssh_save_group", { group: g });
    for (const t2 of tags) await invoke("ssh_save_tag", { tag: t2 });
    for (const h of hosts) await invoke("ssh_save_host", { host: h });
    return t.importDone(hosts.length, groups.length, tags.length);
  }

  // ~/.ssh/config 가져오기: Host 블록을 파싱해 호스트로 등록(auth는 ssh-agent 기본, 편집 가능).
  async function doImportSshConfig() {
    setMsg(null);
    try {
      const text = await invoke<string>("ssh_read_config");
      const parsed = parseSshConfig(text);
      if (parsed.length === 0) {
        setMsg(t.sshConfigEmpty);
        return;
      }
      for (const p of parsed) {
        const host: SshHost = {
          id: crypto.randomUUID(),
          name: p.name,
          host: p.host || p.name,
          port: p.port,
          user: p.user,
          auth: { type: "agent" },
          tags: [],
          group_id: null,
        };
        await invoke("ssh_save_host", { host });
      }
      setMsg(t.sshConfigImported(parsed.length));
    } catch (e) {
      setMsg(t.importFail(String(e)));
    }
  }

  async function doExport() {
    setMsg(null);
    try {
      setText(await buildExportJson());
      setMsg(t.exportDone);
    } catch (e) {
      setMsg(t.exportFail(String(e)));
    }
  }

  async function doImport() {
    setMsg(null);
    try {
      setMsg(await applyImportJson(text));
    } catch (e) {
      setMsg(t.importFail(String(e)));
    }
  }

  // 파일로 내보내기: 저장 다이얼로그 → JSON 파일 쓰기.
  async function doExportFile() {
    setMsg(null);
    try {
      const json = await buildExportJson();
      setText(json);
      const path = await save({
        defaultPath: "wowterminal-hosts.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return; // 취소
      await invoke("local_write_text", { path, content: json });
      setMsg(t.exportFileDone(path));
    } catch (e) {
      setMsg(t.exportFail(String(e)));
    }
  }

  // 파일에서 가져오기: 열기 다이얼로그 → JSON 파일 읽기 → 적용.
  async function doImportFile() {
    setMsg(null);
    try {
      const sel = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const path = Array.isArray(sel) ? sel[0] : sel;
      if (!path) return; // 취소
      const json = await invoke<string>("local_read_text", { path });
      setText(json);
      setMsg(await applyImportJson(json));
    } catch (e) {
      setMsg(t.importFail(String(e)));
    }
  }

  return (
    <Section>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => void doExportFile()} style={primaryBtnStyle}>
          {t.exportFile}
        </button>
        <button onClick={() => void doImportFile()} style={primaryBtnStyle}>
          {t.importFile}
        </button>
        <button
          onClick={() => void doImportSshConfig()}
          style={btnStyle}
          title="~/.ssh/config"
        >
          {t.importSshConfig}
        </button>
      </div>
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}
      >
        <button onClick={() => void doExport()} style={btnStyle}>
          {t.export}
        </button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text);
          }}
          disabled={!text}
          style={btnStyle}
        >
          {t.copy}
        </button>
        <button onClick={() => void doImport()} disabled={!text.trim()} style={btnStyle}>
          {t.import}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder={t.backupPlaceholder}
        style={{
          ...inputStyle,
          width: "100%",
          fontFamily: "monospace",
          fontSize: 11,
          resize: "vertical",
          marginTop: 8,
        }}
      />
      {msg && <div style={{ color: "#9cf", fontSize: 11, marginTop: 6 }}>{msg}</div>}
      <div style={{ color: "#789", fontSize: 11, marginTop: 4 }}>
        {t.secretsNote}
      </div>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>{children}</div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 12, color: "#ccc" }}>{label}</span>
      {children}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  width: 560,
  maxWidth: "92vw",
  maxHeight: "88vh",
  overflowY: "auto",
  background: "#26262d",
  border: "1px solid #333",
  borderRadius: 6,
  color: "#e6e6e6",
  boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
  padding: 20,
  fontSize: 13,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};
const inputStyle: React.CSSProperties = {
  background: "#1e1e1e",
  color: "#e6e6e6",
  border: "1px solid #444",
  padding: "5px 8px",
  borderRadius: 3,
  fontSize: 12,
  outline: "none",
};
const btnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  color: "#cccccc",
  border: "1px solid #555",
  padding: "6px 12px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 12,
};
const primaryBtnStyle: React.CSSProperties = {
  background: "#0a5380",
  color: "#fff",
  border: "1px solid #4a9eff",
  padding: "6px 12px",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 12,
};
const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 15,
  padding: "0 4px",
};
const kbdStyle: React.CSSProperties = {
  background: "#1a1a20",
  border: "1px solid #444",
  borderRadius: 3,
  padding: "2px 6px",
  fontFamily: "monospace",
  fontSize: 11,
};
