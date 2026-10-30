/**
 * 파일 편집 탭 (#166, 화면 기획서 SC-01·SC-05·SC-06). CodeMirror 6 편집기(D1).
 *
 * - 상태(로드·dirty·저장·충돌)는 fileDocs 저장소에 있고, 여기는 화면과 편집기만 갖는다.
 * - 읽기 전용인 경우(큰 파일·바이너리·비UTF-8·줄끝 혼합·권한 없음)는 위쪽 띠에 이유와 다음
 *   행동을 문장으로 보여 준다 — 자물쇠만 보이고 이유를 모르는 상태를 만들지 않는다.
 * - 이미지는 img 요소로만 보여 준다(SVG 속 스크립트가 실행되지 않게).
 */
import { useEffect, useMemo, useRef } from "react";
import { Compartment, EditorState, Prec, Text } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { LanguageDescription, bracketMatching, indentOnInput } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { LangDict, useT } from "../i18n";
import {
  FileDoc,
  ReadOnlyReason,
  SaveMethod,
  dismissConflict,
  dismissNotice,
  hostColor,
  loadDoc,
  registerEditor,
  reloadDoc,
  saveDoc,
  setDirty,
  useFileDocs,
} from "../fileDocs";

type S = {
  reason: Record<ReadOnlyReason, string>;
  notice: Record<Exclude<SaveMethod, "atomic" | "swap">, string>;
  external: string;
  reloaded: string;
  conflictTitle: string;
  conflictBody: string;
  missingTitle: string;
  missingBody: string;
  reloadServer: string;
  overwrite: string;
  recreate: string;
  keepEditing: string;
  download: string;
  retry: string;
  loading: string;
  save: string;
  saving: string;
  saved: string;
  modified: string;
  readOnly: string;
  dismiss: string;
  openFailed: string;
  saveFailed: string;
  local: string;
};

const STR: LangDict<S> = {
  en: {
    reason: {
      too_large: "Larger than 5 MB — showing the first 1 MB, read-only.",
      binary: "Not a text file (binary). It can't be edited here.",
      not_utf8: "Not UTF-8 text. Opened read-only so characters don't get corrupted.",
      utf16: "UTF-16 text. Opened read-only.",
      mixed_eol: "Line endings are mixed (CRLF and LF), so it can't be saved back exactly. Opened read-only.",
      no_permission: "You don't have permission to change this file. View only.",
      image_too_large: "Images larger than 8 MB aren't previewed.",
    },
    notice: {
      direct_dir_not_writable: "The folder isn't writable, so the file was saved in place without a temporary copy (a cut-off during saving could leave it incomplete).",
      direct_owner: "The file belongs to another user, so it was saved in place to keep its owner.",
      direct_hardlink: "The file has hard links, so it was saved in place to keep them.",
    },
    external: "The file changed on the server. Saving will ask what to do.",
    reloaded: "The file changed on the server and was reloaded.",
    conflictTitle: "The file changed on the server",
    conflictBody: "Someone changed it after you opened it. Saving now would overwrite their change.",
    missingTitle: "The file is gone from the server",
    missingBody: "It was deleted or moved after you opened it.",
    reloadServer: "Reload the server's version (⌘Z brings yours back)",
    overwrite: "Overwrite with mine",
    recreate: "Create it again with my text",
    keepEditing: "Cancel (keep editing)",
    download: "Download",
    retry: "Try again",
    loading: "Opening…",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    modified: "Modified",
    readOnly: "Read-only",
    dismiss: "Close",
    openFailed: "Couldn't open the file",
    saveFailed: "Couldn't save — your text is still here",
    local: "Local",
  },
  ko: {
    reason: {
      too_large: "5MB보다 큰 파일이라 앞 1MB만 읽기 전용으로 보여 줍니다.",
      binary: "텍스트 파일이 아닙니다(바이너리). 여기서는 편집할 수 없습니다.",
      not_utf8: "UTF-8이 아닌 텍스트입니다. 글자가 깨지지 않게 읽기 전용으로 열었습니다.",
      utf16: "UTF-16 텍스트입니다. 읽기 전용으로 열었습니다.",
      mixed_eol: "줄끝(CRLF와 LF)이 섞여 있어 그대로 저장할 수 없습니다. 읽기 전용으로 열었습니다.",
      no_permission: "이 파일을 고칠 권한이 없습니다. 보기만 가능합니다.",
      image_too_large: "8MB보다 큰 이미지는 미리보기하지 않습니다.",
    },
    notice: {
      direct_dir_not_writable: "폴더에 쓸 권한이 없어 임시 파일 없이 기존 파일에 직접 저장했습니다(저장 도중 끊기면 파일이 불완전해질 수 있음).",
      direct_owner: "다른 사용자 소유의 파일이라 소유자를 유지하려고 기존 파일에 직접 저장했습니다.",
      direct_hardlink: "하드 링크로 연결된 파일이라 링크를 유지하려고 기존 파일에 직접 저장했습니다.",
    },
    external: "서버의 파일이 바뀌었습니다. 저장하면 어떻게 할지 묻습니다.",
    reloaded: "서버에서 파일이 바뀌어 다시 불러왔습니다.",
    conflictTitle: "서버의 파일이 바뀌었습니다",
    conflictBody: "연 뒤에 다른 곳에서 수정되었습니다. 지금 저장하면 그 수정을 덮어씁니다.",
    missingTitle: "서버에서 파일이 사라졌습니다",
    missingBody: "연 뒤에 삭제되거나 옮겨졌습니다.",
    reloadServer: "서버 것 다시 불러오기 (⌘Z로 내 것 되살림)",
    overwrite: "내 것으로 덮어쓰기",
    recreate: "내 내용으로 다시 만들기",
    keepEditing: "취소 (계속 편집)",
    download: "다운로드",
    retry: "다시 시도",
    loading: "여는 중…",
    save: "저장",
    saving: "저장 중…",
    saved: "저장됨",
    modified: "수정됨",
    readOnly: "읽기 전용",
    dismiss: "닫기",
    openFailed: "파일을 열 수 없습니다",
    saveFailed: "저장하지 못했습니다 — 내용은 그대로 있습니다",
    local: "로컬",
  },
  es: {
    reason: {
      too_large: "Mayor de 5 MB: se muestra el primer 1 MB, solo lectura.",
      binary: "No es un archivo de texto (binario). No se puede editar aquí.",
      not_utf8: "No es texto UTF-8. Se abrió en solo lectura para no dañar los caracteres.",
      utf16: "Texto UTF-16. Se abrió en solo lectura.",
      mixed_eol: "Los finales de línea están mezclados (CRLF y LF) y no se puede guardar tal cual. Se abrió en solo lectura.",
      no_permission: "No tienes permiso para modificar este archivo. Solo lectura.",
      image_too_large: "Las imágenes de más de 8 MB no se previsualizan.",
    },
    notice: {
      direct_dir_not_writable: "La carpeta no admite escritura, así que el archivo se guardó directamente sin copia temporal (un corte durante el guardado podría dejarlo incompleto).",
      direct_owner: "El archivo pertenece a otro usuario, así que se guardó directamente para conservar su propietario.",
      direct_hardlink: "El archivo tiene enlaces duros, así que se guardó directamente para conservarlos.",
    },
    external: "El archivo cambió en el servidor. Al guardar se te preguntará qué hacer.",
    reloaded: "El archivo cambió en el servidor y se volvió a cargar.",
    conflictTitle: "El archivo cambió en el servidor",
    conflictBody: "Alguien lo modificó después de que lo abrieras. Guardar ahora sobrescribiría ese cambio.",
    missingTitle: "El archivo ya no está en el servidor",
    missingBody: "Se eliminó o movió después de abrirlo.",
    reloadServer: "Recargar la versión del servidor (⌘Z recupera la tuya)",
    overwrite: "Sobrescribir con la mía",
    recreate: "Volver a crearlo con mi texto",
    keepEditing: "Cancelar (seguir editando)",
    download: "Descargar",
    retry: "Reintentar",
    loading: "Abriendo…",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado",
    modified: "Modificado",
    readOnly: "Solo lectura",
    dismiss: "Cerrar",
    openFailed: "No se pudo abrir el archivo",
    saveFailed: "No se pudo guardar: tu texto sigue aquí",
    local: "Local",
  },
  zh: {
    reason: {
      too_large: "文件大于 5 MB — 仅以只读方式显示前 1 MB。",
      binary: "不是文本文件（二进制），无法在此编辑。",
      not_utf8: "不是 UTF-8 文本。为避免字符损坏，已以只读方式打开。",
      utf16: "UTF-16 文本，已以只读方式打开。",
      mixed_eol: "换行符混用（CRLF 和 LF），无法原样保存，已以只读方式打开。",
      no_permission: "你没有修改此文件的权限，仅可查看。",
      image_too_large: "大于 8 MB 的图片不提供预览。",
    },
    notice: {
      direct_dir_not_writable: "文件夹不可写，因此未使用临时文件，直接写入了原文件（保存中断可能导致文件不完整）。",
      direct_owner: "文件属于其他用户，为保留所有者已直接写入原文件。",
      direct_hardlink: "文件有硬链接，为保留链接已直接写入原文件。",
    },
    external: "服务器上的文件已更改。保存时会询问如何处理。",
    reloaded: "服务器上的文件已更改，已重新加载。",
    conflictTitle: "服务器上的文件已更改",
    conflictBody: "在你打开后有人修改了它。现在保存会覆盖对方的修改。",
    missingTitle: "服务器上的文件已不存在",
    missingBody: "打开后被删除或移动了。",
    reloadServer: "重新加载服务器版本（⌘Z 可恢复你的内容）",
    overwrite: "用我的内容覆盖",
    recreate: "用我的内容重新创建",
    keepEditing: "取消（继续编辑）",
    download: "下载",
    retry: "重试",
    loading: "正在打开…",
    save: "保存",
    saving: "正在保存…",
    saved: "已保存",
    modified: "已修改",
    readOnly: "只读",
    dismiss: "关闭",
    openFailed: "无法打开文件",
    saveFailed: "保存失败 — 你的内容仍在",
    local: "本地",
  },
  ja: {
    reason: {
      too_large: "5 MB を超えるため、先頭 1 MB のみ読み取り専用で表示しています。",
      binary: "テキストファイルではありません（バイナリ）。ここでは編集できません。",
      not_utf8: "UTF-8 ではないテキストです。文字化けを防ぐため読み取り専用で開きました。",
      utf16: "UTF-16 テキストです。読み取り専用で開きました。",
      mixed_eol: "改行コード（CRLF と LF）が混在しているため、そのまま保存できません。読み取り専用で開きました。",
      no_permission: "このファイルを変更する権限がありません。表示のみです。",
      image_too_large: "8 MB を超える画像はプレビューしません。",
    },
    notice: {
      direct_dir_not_writable: "フォルダーに書き込めないため、一時ファイルを使わず既存ファイルに直接保存しました（保存中に切断されると不完全になる場合があります）。",
      direct_owner: "他のユーザーが所有するファイルのため、所有者を保つよう既存ファイルに直接保存しました。",
      direct_hardlink: "ハードリンクのあるファイルのため、リンクを保つよう既存ファイルに直接保存しました。",
    },
    external: "サーバー上のファイルが変更されました。保存時にどうするか確認します。",
    reloaded: "サーバー上のファイルが変更されたため、再読み込みしました。",
    conflictTitle: "サーバー上のファイルが変更されました",
    conflictBody: "開いた後に別の場所で変更されました。今保存するとその変更を上書きします。",
    missingTitle: "サーバーからファイルがなくなりました",
    missingBody: "開いた後に削除または移動されました。",
    reloadServer: "サーバー版を再読み込み（⌘Z で自分の内容を戻せます）",
    overwrite: "自分の内容で上書き",
    recreate: "自分の内容で作り直す",
    keepEditing: "キャンセル（編集を続ける）",
    download: "ダウンロード",
    retry: "再試行",
    loading: "開いています…",
    save: "保存",
    saving: "保存中…",
    saved: "保存しました",
    modified: "変更あり",
    readOnly: "読み取り専用",
    dismiss: "閉じる",
    openFailed: "ファイルを開けません",
    saveFailed: "保存できませんでした — 内容はそのまま残っています",
    local: "ローカル",
  },
  ru: {
    reason: {
      too_large: "Больше 5 МБ — показан первый 1 МБ, только чтение.",
      binary: "Это не текстовый файл (двоичный). Здесь его нельзя редактировать.",
      not_utf8: "Текст не в UTF-8. Открыт только для чтения, чтобы не испортить символы.",
      utf16: "Текст в UTF-16. Открыт только для чтения.",
      mixed_eol: "Окончания строк смешаны (CRLF и LF), сохранить без изменений нельзя. Открыт только для чтения.",
      no_permission: "У вас нет прав на изменение этого файла. Только просмотр.",
      image_too_large: "Изображения больше 8 МБ не показываются.",
    },
    notice: {
      direct_dir_not_writable: "Папка недоступна для записи, поэтому файл сохранён на месте без временной копии (обрыв во время сохранения может оставить его неполным).",
      direct_owner: "Файл принадлежит другому пользователю, поэтому сохранён на месте, чтобы не сменить владельца.",
      direct_hardlink: "У файла есть жёсткие ссылки, поэтому он сохранён на месте, чтобы их сохранить.",
    },
    external: "Файл на сервере изменился. При сохранении вас спросят, что делать.",
    reloaded: "Файл на сервере изменился и был перезагружен.",
    conflictTitle: "Файл на сервере изменился",
    conflictBody: "Кто-то изменил его после того, как вы его открыли. Сохранение перезапишет это изменение.",
    missingTitle: "Файла больше нет на сервере",
    missingBody: "Его удалили или переместили после открытия.",
    reloadServer: "Загрузить версию с сервера (⌘Z вернёт вашу)",
    overwrite: "Перезаписать моей версией",
    recreate: "Создать заново с моим текстом",
    keepEditing: "Отмена (продолжить правку)",
    download: "Скачать",
    retry: "Повторить",
    loading: "Открытие…",
    save: "Сохранить",
    saving: "Сохранение…",
    saved: "Сохранено",
    modified: "Изменён",
    readOnly: "Только чтение",
    dismiss: "Закрыть",
    openFailed: "Не удалось открыть файл",
    saveFailed: "Не удалось сохранить — ваш текст на месте",
    local: "Локально",
  },
  fr: {
    reason: {
      too_large: "Plus de 5 Mo : seul le premier Mo est affiché, en lecture seule.",
      binary: "Ce n'est pas un fichier texte (binaire). Il ne peut pas être modifié ici.",
      not_utf8: "Texte non UTF-8. Ouvert en lecture seule pour ne pas abîmer les caractères.",
      utf16: "Texte UTF-16. Ouvert en lecture seule.",
      mixed_eol: "Les fins de ligne sont mélangées (CRLF et LF) : impossible de réenregistrer à l'identique. Ouvert en lecture seule.",
      no_permission: "Vous n'avez pas le droit de modifier ce fichier. Lecture seule.",
      image_too_large: "Les images de plus de 8 Mo ne sont pas prévisualisées.",
    },
    notice: {
      direct_dir_not_writable: "Le dossier n'est pas accessible en écriture : le fichier a été enregistré sur place sans copie temporaire (une coupure pendant l'enregistrement pourrait le laisser incomplet).",
      direct_owner: "Le fichier appartient à un autre utilisateur : il a été enregistré sur place pour garder son propriétaire.",
      direct_hardlink: "Le fichier a des liens physiques : il a été enregistré sur place pour les conserver.",
    },
    external: "Le fichier a changé sur le serveur. L'enregistrement vous demandera quoi faire.",
    reloaded: "Le fichier a changé sur le serveur et a été rechargé.",
    conflictTitle: "Le fichier a changé sur le serveur",
    conflictBody: "Quelqu'un l'a modifié après son ouverture. Enregistrer maintenant écraserait cette modification.",
    missingTitle: "Le fichier n'est plus sur le serveur",
    missingBody: "Il a été supprimé ou déplacé après son ouverture.",
    reloadServer: "Recharger la version du serveur (⌘Z rétablit la vôtre)",
    overwrite: "Écraser avec la mienne",
    recreate: "Le recréer avec mon texte",
    keepEditing: "Annuler (continuer à modifier)",
    download: "Télécharger",
    retry: "Réessayer",
    loading: "Ouverture…",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistré",
    modified: "Modifié",
    readOnly: "Lecture seule",
    dismiss: "Fermer",
    openFailed: "Impossible d'ouvrir le fichier",
    saveFailed: "Échec de l'enregistrement — votre texte est toujours là",
    local: "Local",
  },
  de: {
    reason: {
      too_large: "Größer als 5 MB – nur das erste 1 MB wird schreibgeschützt angezeigt.",
      binary: "Keine Textdatei (binär). Sie kann hier nicht bearbeitet werden.",
      not_utf8: "Kein UTF-8-Text. Schreibgeschützt geöffnet, damit keine Zeichen beschädigt werden.",
      utf16: "UTF-16-Text. Schreibgeschützt geöffnet.",
      mixed_eol: "Gemischte Zeilenenden (CRLF und LF) – kann nicht unverändert gespeichert werden. Schreibgeschützt geöffnet.",
      no_permission: "Sie dürfen diese Datei nicht ändern. Nur Ansicht.",
      image_too_large: "Bilder über 8 MB werden nicht in der Vorschau gezeigt.",
    },
    notice: {
      direct_dir_not_writable: "Der Ordner ist nicht beschreibbar, daher wurde die Datei ohne temporäre Kopie direkt gespeichert (ein Abbruch beim Speichern könnte sie unvollständig hinterlassen).",
      direct_owner: "Die Datei gehört einem anderen Benutzer, daher wurde sie direkt gespeichert, um den Eigentümer zu behalten.",
      direct_hardlink: "Die Datei hat harte Links, daher wurde sie direkt gespeichert, um sie zu erhalten.",
    },
    external: "Die Datei wurde auf dem Server geändert. Beim Speichern werden Sie gefragt.",
    reloaded: "Die Datei wurde auf dem Server geändert und neu geladen.",
    conflictTitle: "Die Datei wurde auf dem Server geändert",
    conflictBody: "Jemand hat sie nach dem Öffnen geändert. Speichern würde diese Änderung überschreiben.",
    missingTitle: "Die Datei ist nicht mehr auf dem Server",
    missingBody: "Sie wurde nach dem Öffnen gelöscht oder verschoben.",
    reloadServer: "Serverversion neu laden (⌘Z holt Ihre zurück)",
    overwrite: "Mit meiner überschreiben",
    recreate: "Mit meinem Text neu anlegen",
    keepEditing: "Abbrechen (weiter bearbeiten)",
    download: "Herunterladen",
    retry: "Erneut versuchen",
    loading: "Wird geöffnet…",
    save: "Speichern",
    saving: "Wird gespeichert…",
    saved: "Gespeichert",
    modified: "Geändert",
    readOnly: "Schreibgeschützt",
    dismiss: "Schließen",
    openFailed: "Datei konnte nicht geöffnet werden",
    saveFailed: "Speichern fehlgeschlagen – Ihr Text ist noch da",
    local: "Lokal",
  },
  vi: {
    reason: {
      too_large: "Lớn hơn 5 MB — chỉ hiển thị 1 MB đầu ở chế độ chỉ đọc.",
      binary: "Không phải tệp văn bản (nhị phân). Không thể chỉnh sửa ở đây.",
      not_utf8: "Văn bản không phải UTF-8. Đã mở chỉ đọc để không làm hỏng ký tự.",
      utf16: "Văn bản UTF-16. Đã mở chỉ đọc.",
      mixed_eol: "Ký tự xuống dòng bị lẫn (CRLF và LF) nên không thể lưu lại nguyên dạng. Đã mở chỉ đọc.",
      no_permission: "Bạn không có quyền sửa tệp này. Chỉ xem.",
      image_too_large: "Không xem trước ảnh lớn hơn 8 MB.",
    },
    notice: {
      direct_dir_not_writable: "Thư mục không ghi được nên tệp được ghi trực tiếp không qua bản tạm (nếu bị ngắt khi lưu, tệp có thể không đầy đủ).",
      direct_owner: "Tệp thuộc người dùng khác nên được ghi trực tiếp để giữ chủ sở hữu.",
      direct_hardlink: "Tệp có liên kết cứng nên được ghi trực tiếp để giữ liên kết.",
    },
    external: "Tệp trên máy chủ đã thay đổi. Khi lưu sẽ hỏi bạn muốn làm gì.",
    reloaded: "Tệp trên máy chủ đã thay đổi và đã được tải lại.",
    conflictTitle: "Tệp trên máy chủ đã thay đổi",
    conflictBody: "Ai đó đã sửa sau khi bạn mở. Lưu bây giờ sẽ ghi đè thay đổi đó.",
    missingTitle: "Tệp không còn trên máy chủ",
    missingBody: "Tệp đã bị xóa hoặc di chuyển sau khi mở.",
    reloadServer: "Tải lại bản trên máy chủ (⌘Z để lấy lại bản của bạn)",
    overwrite: "Ghi đè bằng bản của tôi",
    recreate: "Tạo lại bằng nội dung của tôi",
    keepEditing: "Hủy (tiếp tục sửa)",
    download: "Tải xuống",
    retry: "Thử lại",
    loading: "Đang mở…",
    save: "Lưu",
    saving: "Đang lưu…",
    saved: "Đã lưu",
    modified: "Đã sửa",
    readOnly: "Chỉ đọc",
    dismiss: "Đóng",
    openFailed: "Không mở được tệp",
    saveFailed: "Không lưu được — nội dung của bạn vẫn còn",
    local: "Cục bộ",
  },
  id: {
    reason: {
      too_large: "Lebih dari 5 MB — hanya 1 MB pertama ditampilkan, hanya-baca.",
      binary: "Bukan berkas teks (biner). Tidak bisa diedit di sini.",
      not_utf8: "Teks bukan UTF-8. Dibuka hanya-baca agar karakter tidak rusak.",
      utf16: "Teks UTF-16. Dibuka hanya-baca.",
      mixed_eol: "Akhir baris campuran (CRLF dan LF) sehingga tidak bisa disimpan persis. Dibuka hanya-baca.",
      no_permission: "Anda tidak berhak mengubah berkas ini. Hanya lihat.",
      image_too_large: "Gambar lebih dari 8 MB tidak dipratinjau.",
    },
    notice: {
      direct_dir_not_writable: "Folder tidak bisa ditulisi, jadi berkas disimpan langsung tanpa salinan sementara (terputus saat menyimpan bisa membuatnya tidak lengkap).",
      direct_owner: "Berkas milik pengguna lain, jadi disimpan langsung agar pemiliknya tetap.",
      direct_hardlink: "Berkas memiliki hard link, jadi disimpan langsung agar tautannya tetap.",
    },
    external: "Berkas di server berubah. Saat menyimpan, Anda akan ditanya.",
    reloaded: "Berkas di server berubah dan sudah dimuat ulang.",
    conflictTitle: "Berkas di server berubah",
    conflictBody: "Seseorang mengubahnya setelah Anda membukanya. Menyimpan sekarang akan menimpa perubahan itu.",
    missingTitle: "Berkas sudah tidak ada di server",
    missingBody: "Berkas dihapus atau dipindah setelah dibuka.",
    reloadServer: "Muat ulang versi server (⌘Z mengembalikan milik Anda)",
    overwrite: "Timpa dengan milik saya",
    recreate: "Buat ulang dengan teks saya",
    keepEditing: "Batal (lanjut mengedit)",
    download: "Unduh",
    retry: "Coba lagi",
    loading: "Membuka…",
    save: "Simpan",
    saving: "Menyimpan…",
    saved: "Tersimpan",
    modified: "Diubah",
    readOnly: "Hanya-baca",
    dismiss: "Tutup",
    openFailed: "Tidak dapat membuka berkas",
    saveFailed: "Gagal menyimpan — teks Anda masih ada",
    local: "Lokal",
  },
  hi: {
    reason: {
      too_large: "5 MB से बड़ी — केवल पहला 1 MB केवल-पढ़ने के लिए दिखाया गया है।",
      binary: "यह टेक्स्ट फ़ाइल नहीं है (बाइनरी)। इसे यहाँ संपादित नहीं किया जा सकता।",
      not_utf8: "UTF-8 टेक्स्ट नहीं है। अक्षर न बिगड़ें इसलिए केवल-पढ़ने के लिए खोला गया।",
      utf16: "UTF-16 टेक्स्ट। केवल-पढ़ने के लिए खोला गया।",
      mixed_eol: "लाइन अंत मिश्रित हैं (CRLF और LF), इसलिए ज्यों-का-त्यों सहेजा नहीं जा सकता। केवल-पढ़ने के लिए खोला गया।",
      no_permission: "आपको इस फ़ाइल को बदलने की अनुमति नहीं है। केवल देखें।",
      image_too_large: "8 MB से बड़ी छवियों का पूर्वावलोकन नहीं होता।",
    },
    notice: {
      direct_dir_not_writable: "फ़ोल्डर में लिखा नहीं जा सकता, इसलिए फ़ाइल अस्थायी प्रति के बिना सीधे सहेजी गई (सहेजते समय कटने पर फ़ाइल अधूरी रह सकती है)।",
      direct_owner: "फ़ाइल किसी अन्य उपयोगकर्ता की है, इसलिए स्वामी बनाए रखने के लिए सीधे सहेजी गई।",
      direct_hardlink: "फ़ाइल के हार्ड लिंक हैं, इसलिए उन्हें बनाए रखने के लिए सीधे सहेजी गई।",
    },
    external: "सर्वर पर फ़ाइल बदल गई है। सहेजते समय पूछा जाएगा कि क्या करें।",
    reloaded: "सर्वर पर फ़ाइल बदल गई थी और फिर से लोड की गई।",
    conflictTitle: "सर्वर पर फ़ाइल बदल गई है",
    conflictBody: "आपके खोलने के बाद किसी ने इसे बदला। अभी सहेजने से वह बदलाव मिट जाएगा।",
    missingTitle: "फ़ाइल अब सर्वर पर नहीं है",
    missingBody: "खोलने के बाद इसे हटाया या स्थानांतरित किया गया।",
    reloadServer: "सर्वर का संस्करण फिर से लोड करें (⌘Z से आपका वापस आएगा)",
    overwrite: "मेरे संस्करण से अधिलेखित करें",
    recreate: "मेरे टेक्स्ट से फिर से बनाएँ",
    keepEditing: "रद्द करें (संपादन जारी रखें)",
    download: "डाउनलोड",
    retry: "फिर से प्रयास करें",
    loading: "खुल रहा है…",
    save: "सहेजें",
    saving: "सहेजा जा रहा है…",
    saved: "सहेजा गया",
    modified: "बदला गया",
    readOnly: "केवल-पढ़ने के लिए",
    dismiss: "बंद करें",
    openFailed: "फ़ाइल नहीं खुल सकी",
    saveFailed: "सहेजा नहीं जा सका — आपका टेक्स्ट अभी भी यहाँ है",
    local: "स्थानीय",
  },
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const ACCENT = "#5b8def";

export function FileEditor({
  id,
  active,
  hostLabel,
  onDownload,
}: {
  id: string;
  active: boolean;
  hostLabel: (hostId: string) => string;
  onDownload: (doc: FileDoc) => void;
}) {
  const t = useT(STR);
  const doc = useFileDocs().find((d) => d.id === id);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const baseRef = useRef<Text>(Text.empty);
  const readOnlyComp = useMemo(() => new Compartment(), []);
  const langComp = useMemo(() => new Compartment(), []);

  // 복원된 탭은 처음 보일 때 읽는다.
  useEffect(() => {
    if (active && doc?.state === "unloaded") void loadDoc(id);
  }, [active, doc?.state, id]);

  // 저장·다시 읽기로 기준 텍스트가 바뀌면 dirty 비교 기준도 바꾼다.
  useEffect(() => {
    baseRef.current = Text.of((doc?.base ?? "").split("\n"));
  }, [doc?.base]);

  const ready = doc?.state === "ready" && !!doc.opened && !doc.opened.image;
  const editable = !!doc?.opened?.editable;

  // 편집기 생성(문서가 처음 준비됐을 때 한 번).
  useEffect(() => {
    if (!ready || viewRef.current || !hostRef.current || !doc?.opened) return;
    const initial = doc.base;
    baseRef.current = Text.of(initial.split("\n"));
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          Prec.high(
            keymap.of([
              {
                key: "Mod-s",
                run: () => {
                  void saveDoc(id);
                  return true;
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          oneDark,
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": { fontFamily: "Menlo, Consolas, monospace" },
          }),
          readOnlyComp.of([
            EditorState.readOnly.of(!doc.opened.editable),
            EditorView.editable.of(doc.opened.editable),
          ]),
          langComp.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setDirty(id, !u.state.doc.eq(baseRef.current));
          }),
        ],
      }),
    });
    viewRef.current = view;
    const unreg = registerEditor(id, {
      getText: () => view.state.doc.toString(),
      replaceAll: (text) => {
        const sel = view.state.selection.main.head;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: Math.min(sel, text.length) },
        });
      },
      focus: () => view.focus(),
    });
    // 문법 강조는 파일 이름으로 고른 언어를 필요할 때 불러온다.
    const desc = LanguageDescription.matchFilename(languages, doc.name);
    if (desc) {
      void desc.load().then((support) => {
        if (viewRef.current === view) view.dispatch({ effects: langComp.reconfigure(support) });
      });
    }
    return () => {
      unreg();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 다시 읽기로 편집 가능 여부가 바뀌면(권한 변경 등) 반영.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyComp.reconfigure([
        EditorState.readOnly.of(!editable),
        EditorView.editable.of(editable),
      ]),
    });
  }, [editable, readOnlyComp]);

  useEffect(() => {
    if (active) requestAnimationFrame(() => viewRef.current?.focus());
  }, [active]);

  if (!doc) return null;
  const o = doc.opened;
  const remote = !!doc.hostId;
  const color = hostColor(doc.hostId);
  const showReloaded = doc.reloadedAt > 0 && Date.now() - doc.reloadedAt < 4000;

  return (
    <div style={{ display: active ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column", position: "relative", background: "#282c34" }}>
      {/* 경로 머리줄 — 파란 면으로 터미널과 구분(SC-02 ②) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: "#1b2333", borderBottom: "1px solid #2c3a55", fontSize: 12, color: "#aab6c8", flexShrink: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, ...(color ? { background: color } : { border: "2px solid #8a8f98", boxSizing: "border-box" }) }} />
        <span style={{ color: "#dfe6f0" }}>{doc.hostId ? hostLabel(doc.hostId) : t.local}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left", flex: 1, minWidth: 0 }}>
          {"‎" + (o?.real_path ?? doc.path)}
        </span>
        {o?.editable && (
          <button
            onClick={() => void saveDoc(id)}
            disabled={!doc.dirty || doc.saving}
            style={{ background: doc.dirty ? ACCENT : "#2b3446", color: doc.dirty ? "#fff" : "#7d889a", border: "none", borderRadius: 4, padding: "2px 10px", fontSize: 12, cursor: doc.dirty ? "pointer" : "default" }}
          >
            {doc.saving ? t.saving : `${t.save} ⌘S`}
          </button>
        )}
      </div>

      {/* 띠: 이유와 다음 행동(SC-06) */}
      {o?.reason && (
        <Banner tone={o.reason === "no_permission" || o.reason === "binary" || o.reason === "too_large" ? "info" : "warn"}>
          🔒︎ {t.reason[o.reason]}
          {remote && (o.reason === "too_large" || o.reason === "binary" || o.reason === "image_too_large") && (
            <BannerBtn onClick={() => onDownload(doc)}>{t.download}</BannerBtn>
          )}
        </Banner>
      )}
      {doc.externalChange && !doc.conflict && (
        <Banner tone="warn">
          ⚠ {t.external}
          <BannerBtn onClick={() => void reloadDoc(id)}>{t.reloadServer}</BannerBtn>
        </Banner>
      )}
      {showReloaded && <Banner tone="info">↻ {t.reloaded}</Banner>}
      {doc.notice && (
        <Banner tone="info">
          {t.notice[doc.notice as keyof S["notice"]]}
          <BannerBtn onClick={() => dismissNotice(id)}>{t.dismiss}</BannerBtn>
        </Banner>
      )}
      {doc.error && doc.state === "ready" && (
        <Banner tone="error">
          ✗ {t.saveFailed}: {doc.error}
        </Banner>
      )}

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {doc.state === "loading" || doc.state === "unloaded" ? (
          <Center>{t.loading}</Center>
        ) : doc.state === "error" ? (
          <Center>
            <div style={{ color: "#e06c6c", marginBottom: 8 }}>{t.openFailed}</div>
            <div style={{ fontSize: 12, color: "#9aa4b2", marginBottom: 12, maxWidth: 520, wordBreak: "break-word" }}>{doc.error}</div>
            <BannerBtn onClick={() => void loadDoc(id)}>{t.retry}</BannerBtn>
          </Center>
        ) : o?.image ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "repeating-conic-gradient(#2a2e36 0% 25%, #23262d 0% 50%) 50% / 20px 20px" }}>
            <img src={o.image} alt={doc.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </div>
        ) : (
          <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
        )}

        {/* 저장 충돌(SC-05 ①) — 기본 포커스는 덮어쓰기가 아닌 쪽 */}
        {doc.conflict && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5 }}>
            <div role="dialog" style={{ width: 400, maxWidth: "90%", background: "#23262e", border: "1px solid #3a3f4b", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 10, color: "#e6e6e6" }}>
              <div style={{ fontWeight: 700, color: "#f0a640" }}>
                ⚠ {doc.conflict.current ? t.conflictTitle : t.missingTitle}
              </div>
              <div style={{ fontSize: 13, color: "#b8c0cc", lineHeight: 1.5 }}>
                {doc.conflict.current ? t.conflictBody : t.missingBody}
              </div>
              {doc.conflict.current && (
                <DialogBtn autoFocus onClick={() => void reloadDoc(id)}>
                  {t.reloadServer}
                </DialogBtn>
              )}
              <DialogBtn danger onClick={() => void saveDoc(id, true)}>
                {doc.conflict.current ? t.overwrite : t.recreate}
              </DialogBtn>
              <DialogBtn autoFocus={!doc.conflict.current} onClick={() => dismissConflict(id)}>
                {t.keepEditing}
              </DialogBtn>
            </div>
          </div>
        )}
      </div>

      {/* 상태줄: 인코딩 · 줄끝 · 크기 · 권한 · 상태 */}
      {o && !o.image && (
        <div style={{ display: "flex", gap: 14, padding: "2px 10px", fontSize: 11, color: "#7d889a", borderTop: "1px solid #2c313a", background: "#21252b", flexShrink: 0 }}>
          <span>{o.reason === "utf16" ? "UTF-16" : o.reason === "not_utf8" ? "?" : o.bom ? "UTF-8 BOM" : "UTF-8"}</span>
          {o.editable && <span>{o.eol.toUpperCase()}</span>}
          <span>{fmtSize(o.size)}</span>
          {o.mode !== null && <span>{(o.mode & 0o777).toString(8).padStart(3, "0")}</span>}
          <span style={{ flex: 1 }} />
          <span style={{ color: doc.dirty ? "#e0b050" : "#7d889a" }}>
            {!o.editable ? t.readOnly : doc.saving ? t.saving : doc.dirty ? t.modified : doc.savedAt ? t.saved : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: "info" | "warn" | "error"; children: React.ReactNode }) {
  const c = {
    info: { bg: "#1b2a44", bd: "#2f4a78", fg: "#c9d8f2" },
    warn: { bg: "#3a2c12", bd: "#6b4f1d", fg: "#f2d9a6" },
    error: { bg: "#3d1d1d", bd: "#7a2e2e", fg: "#f2c0c0" },
  }[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 10px", fontSize: 12, lineHeight: 1.45, background: c.bg, color: c.fg, borderBottom: `1px solid ${c.bd}`, flexShrink: 0 }}>
      {children}
    </div>
  );
}

function BannerBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ background: "#2b3446", color: "#dfe6f0", border: "1px solid #46526a", borderRadius: 4, padding: "2px 10px", fontSize: 12, cursor: "pointer" }}>
      {children}
    </button>
  );
}

function DialogBtn({ onClick, danger, autoFocus, children }: { onClick: () => void; danger?: boolean; autoFocus?: boolean; children: React.ReactNode }) {
  return (
    <button
      autoFocus={autoFocus}
      onClick={onClick}
      style={{ background: "#2b2f38", color: danger ? "#f08080" : "#e6e6e6", border: `1px solid ${danger ? "#a33" : "#4a505c"}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, cursor: "pointer", textAlign: "center" }}
    >
      {children}
    </button>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9aa4b2", fontSize: 13, textAlign: "center", padding: 16 }}>
      {children}
    </div>
  );
}
