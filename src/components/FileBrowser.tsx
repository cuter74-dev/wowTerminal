import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { LangDict, useT } from "../i18n";
import { FileEntry, Listing, SearchHit } from "../types";

const STR: LangDict<{
    errLocal: (e: string) => string;
    errRemote: (e: string) => string;
    confirmOverwriteLocal: (name: string) => string;
    confirmOverwriteRemote: (name: string) => string;
    confirmDeleteRemote: (name: string) => string;
    errDelete: (e: string) => string;
    promptNewFolder: string;
    errMkdir: (e: string) => string;
    promptNewFile: string;
    errTouch: (e: string) => string;
    promptNewName: string;
    errRename: (e: string) => string;
    errChmod: (e: string) => string;
    errPreview: (e: string) => string;
    fileBrowser: string;
    localSep: string;
    newFolderRemote: string;
    newFolderRemoteTitle: string;
    newFileRemote: string;
    newFileRemoteTitle: string;
    searchRemote: string;
    searchRemoteTitle: string;
    deleteRemote: string;
    deleteRemoteTitle: string;
    refresh: string;
    refreshTitle: string;
    close: string;
    local: string;
    remoteWith: (label: string) => string;
    downloadTitle: string;
    uploadTitle: string;
    ctxPreview: string;
    ctxDownload: string;
    ctxRename: string;
    ctxProps: string;
    ctxDelete: string;
    ctxUpload: string;
    emptyFile: string;
    previewFooter: string;
    save: string;
    saved: string;
    saveErr: string;
    editFooter: string;
    loading: string;
    colName: string;
    colSize: string;
    colModified: string;
    propsTitle: (name: string) => string;
    directory: string;
    octal: string;
    owner: string;
    group: string;
    other: string;
    read: string;
    write: string;
    execute: string;
    cancel: string;
    apply: (octal: string) => string;
    transferQueue: (active: number, finished: number) => string;
    clearFinished: string;
    done: string;
    failed: string;
    remoteSearch: string;
    underRoot: (root: string) => string;
    searchPlaceholder: string;
    includeSub: string;
    searching: string;
    search: string;
    enterQuery: string;
    noResults: string;
    openLocation: string;
    truncated: string;
  }
> = {
  en: {
    errLocal: (e) => `Local: ${e}`,
    errRemote: (e) => `Remote: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' already exists locally. Overwrite?`,
    confirmOverwriteRemote: (name) =>
      `'${name}' already exists on the remote. Overwrite?`,
    confirmDeleteRemote: (name) => `Delete remote '${name}'?`,
    errDelete: (e) => `Delete: ${e}`,
    promptNewFolder: "New remote folder name:",
    errMkdir: (e) => `New folder: ${e}`,
    promptNewFile: "New remote file name:",
    errTouch: (e) => `New file: ${e}`,
    promptNewName: "New name:",
    errRename: (e) => `Rename: ${e}`,
    errChmod: (e) => `Change permissions: ${e}`,
    errPreview: (e) => `Preview: ${e}`,
    fileBrowser: "📁 File Browser",
    localSep: "Local ↔ ",
    newFolderRemote: "+ Folder (remote)",
    newFolderRemoteTitle: "New remote folder",
    newFileRemote: "+ File (remote)",
    newFileRemoteTitle: "New remote file",
    searchRemote: "🔍 Search (remote)",
    searchRemoteTitle: "Remote search (S-031)",
    deleteRemote: "🗑 Delete (remote)",
    deleteRemoteTitle: "Delete remote selection",
    refresh: "↺ Refresh",
    refreshTitle: "Refresh",
    close: "Close",
    local: "Local",
    remoteWith: (label) => `Remote — ${label}`,
    downloadTitle: "Download remote → local",
    uploadTitle: "Upload local → remote",
    ctxPreview: "Preview",
    ctxDownload: "← Download",
    ctxRename: "Rename",
    ctxProps: "Properties/Permissions",
    ctxDelete: "Delete",
    ctxUpload: "→ Upload",
    emptyFile: "(empty file)",
    previewFooter: "Up to 256KB preview · binary may appear garbled",
    save: "Save",
    saved: "Saved ✓",
    saveErr: "Save failed",
    editFooter: "Edit and Save (⌘S) — overwrites the remote file",
    loading: "Loading…",
    colName: "Name",
    colSize: "Size",
    colModified: "Modified",
    propsTitle: (name) => `Properties / Permissions — ${name}`,
    directory: "Directory",
    octal: "octal",
    owner: "Owner",
    group: "Group",
    other: "Other",
    read: "Read (r)",
    write: "Write (w)",
    execute: "Execute (x)",
    cancel: "Cancel",
    apply: (octal) => `Apply (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `Transfer queue · in progress ${active} / done·failed ${finished}`,
    clearFinished: "Clear finished",
    done: "✓ Done",
    failed: "✗ Failed",
    remoteSearch: "🔍 Remote search",
    underRoot: (root) => `under ${root}`,
    searchPlaceholder: "File name (case-insensitive)",
    includeSub: "Include subdirs",
    searching: "Searching...",
    search: "Search",
    enterQuery: "Enter a query and press Enter.",
    noResults: "No results",
    openLocation: "Double-click: open location",
    truncated: "Results were truncated at 500. Make your query more specific.",
  },
  ko: {
    errLocal: (e) => `로컬: ${e}`,
    errRemote: (e) => `원격: ${e}`,
    confirmOverwriteLocal: (name) =>
      `로컬에 '${name}'이(가) 이미 있습니다. 덮어쓸까요?`,
    confirmOverwriteRemote: (name) =>
      `원격에 '${name}'이(가) 이미 있습니다. 덮어쓸까요?`,
    confirmDeleteRemote: (name) => `원격 '${name}'을(를) 삭제할까요?`,
    errDelete: (e) => `삭제: ${e}`,
    promptNewFolder: "새 원격 폴더 이름:",
    errMkdir: (e) => `새 폴더: ${e}`,
    promptNewFile: "새 원격 파일 이름:",
    errTouch: (e) => `새 파일: ${e}`,
    promptNewName: "새 이름:",
    errRename: (e) => `이름 변경: ${e}`,
    errChmod: (e) => `권한 변경: ${e}`,
    errPreview: (e) => `미리보기: ${e}`,
    fileBrowser: "📁 파일 브라우저",
    localSep: "로컬 ↔ ",
    newFolderRemote: "+ 폴더(원격)",
    newFolderRemoteTitle: "원격 새 폴더",
    newFileRemote: "+ 파일(원격)",
    newFileRemoteTitle: "원격 새 파일",
    searchRemote: "🔍 검색(원격)",
    searchRemoteTitle: "원격 검색 (S-031)",
    deleteRemote: "🗑 삭제(원격)",
    deleteRemoteTitle: "원격 선택 삭제",
    refresh: "↺ 새로고침",
    refreshTitle: "새로고침",
    close: "닫기",
    local: "로컬",
    remoteWith: (label) => `원격 — ${label}`,
    downloadTitle: "원격 → 로컬 다운로드",
    uploadTitle: "로컬 → 원격 업로드",
    ctxPreview: "미리보기",
    ctxDownload: "← 다운로드",
    ctxRename: "이름 변경",
    ctxProps: "속성/권한",
    ctxDelete: "삭제",
    ctxUpload: "→ 업로드",
    emptyFile: "(빈 파일)",
    previewFooter: "최대 256KB 미리보기 · 바이너리는 깨져 보일 수 있음",
    save: "저장",
    saved: "저장됨 ✓",
    saveErr: "저장 실패",
    editFooter: "편집 후 저장(⌘S) — 원격 파일을 덮어씁니다",
    loading: "불러오는 중…",
    colName: "이름",
    colSize: "크기",
    colModified: "수정",
    propsTitle: (name) => `속성 / 권한 — ${name}`,
    directory: "디렉토리",
    octal: "8진수",
    owner: "소유자",
    group: "그룹",
    other: "기타",
    read: "읽기 (r)",
    write: "쓰기 (w)",
    execute: "실행 (x)",
    cancel: "취소",
    apply: (octal) => `적용 (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `전송 큐 · 진행 ${active} / 완료·실패 ${finished}`,
    clearFinished: "완료 항목 비우기",
    done: "✓ 완료",
    failed: "✗ 실패",
    remoteSearch: "🔍 원격 검색",
    underRoot: (root) => `${root} 이하`,
    searchPlaceholder: "파일 이름 (대소문자 무시)",
    includeSub: "하위 포함",
    searching: "검색 중...",
    search: "검색",
    enterQuery: "검색어를 입력하고 Enter를 누르세요.",
    noResults: "결과 없음",
    openLocation: "더블클릭: 위치 열기",
    truncated: "결과가 500개로 잘렸습니다. 검색어를 더 구체적으로.",
  },
  es: {
    errLocal: (e) => `Local: ${e}`,
    errRemote: (e) => `Remoto: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' ya existe localmente. ¿Sobrescribir?`,
    confirmOverwriteRemote: (name) =>
      `'${name}' ya existe en el remoto. ¿Sobrescribir?`,
    confirmDeleteRemote: (name) => `¿Eliminar el remoto '${name}'?`,
    errDelete: (e) => `Eliminar: ${e}`,
    promptNewFolder: "Nombre de la nueva carpeta remota:",
    errMkdir: (e) => `Nueva carpeta: ${e}`,
    promptNewFile: "Nombre del nuevo archivo remoto:",
    errTouch: (e) => `Nuevo archivo: ${e}`,
    promptNewName: "Nuevo nombre:",
    errRename: (e) => `Renombrar: ${e}`,
    errChmod: (e) => `Cambiar permisos: ${e}`,
    errPreview: (e) => `Vista previa: ${e}`,
    fileBrowser: "📁 Explorador de archivos",
    localSep: "Local ↔ ",
    newFolderRemote: "+ Carpeta (remoto)",
    newFolderRemoteTitle: "Nueva carpeta remota",
    newFileRemote: "+ Archivo (remoto)",
    newFileRemoteTitle: "Nuevo archivo remoto",
    searchRemote: "🔍 Buscar (remoto)",
    searchRemoteTitle: "Búsqueda remota (S-031)",
    deleteRemote: "🗑 Eliminar (remoto)",
    deleteRemoteTitle: "Eliminar selección remota",
    refresh: "↺ Actualizar",
    refreshTitle: "Actualizar",
    close: "Cerrar",
    local: "Local",
    remoteWith: (label) => `Remoto — ${label}`,
    downloadTitle: "Descargar remoto → local",
    uploadTitle: "Subir local → remoto",
    ctxPreview: "Vista previa",
    ctxDownload: "← Descargar",
    ctxRename: "Renombrar",
    ctxProps: "Propiedades/Permisos",
    ctxDelete: "Eliminar",
    ctxUpload: "→ Subir",
    emptyFile: "(archivo vacío)",
    previewFooter: "Vista previa hasta 256KB · los binarios pueden verse ilegibles",
    save: "Guardar",
    saved: "Guardado ✓",
    saveErr: "Error al guardar",
    editFooter: "Edita y guarda (⌘S) — sobrescribe el archivo remoto",
    loading: "Cargando…",
    colName: "Nombre",
    colSize: "Tamaño",
    colModified: "Modificado",
    propsTitle: (name) => `Propiedades / Permisos — ${name}`,
    directory: "Directorio",
    octal: "octal",
    owner: "Propietario",
    group: "Grupo",
    other: "Otros",
    read: "Lectura (r)",
    write: "Escritura (w)",
    execute: "Ejecución (x)",
    cancel: "Cancelar",
    apply: (octal) => `Aplicar (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `Cola de transferencias · en curso ${active} / hechas·fallidas ${finished}`,
    clearFinished: "Limpiar finalizadas",
    done: "✓ Hecho",
    failed: "✗ Falló",
    remoteSearch: "🔍 Búsqueda remota",
    underRoot: (root) => `bajo ${root}`,
    searchPlaceholder: "Nombre de archivo (sin distinción de mayúsculas)",
    includeSub: "Incluir subdirectorios",
    searching: "Buscando...",
    search: "Buscar",
    enterQuery: "Introduce una consulta y pulsa Enter.",
    noResults: "Sin resultados",
    openLocation: "Doble clic: abrir ubicación",
    truncated: "Los resultados se truncaron en 500. Haz tu consulta más específica.",
  },
  zh: {
    errLocal: (e) => `本地: ${e}`,
    errRemote: (e) => `远程: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' 在本地已存在。是否覆盖？`,
    confirmOverwriteRemote: (name) =>
      `'${name}' 在远程已存在。是否覆盖？`,
    confirmDeleteRemote: (name) => `删除远程 '${name}'？`,
    errDelete: (e) => `删除: ${e}`,
    promptNewFolder: "新远程文件夹名称:",
    errMkdir: (e) => `新文件夹: ${e}`,
    promptNewFile: "新远程文件名称:",
    errTouch: (e) => `新文件: ${e}`,
    promptNewName: "新名称:",
    errRename: (e) => `重命名: ${e}`,
    errChmod: (e) => `更改权限: ${e}`,
    errPreview: (e) => `预览: ${e}`,
    fileBrowser: "📁 文件浏览器",
    localSep: "本地 ↔ ",
    newFolderRemote: "+ 文件夹（远程）",
    newFolderRemoteTitle: "新建远程文件夹",
    newFileRemote: "+ 文件（远程）",
    newFileRemoteTitle: "新建远程文件",
    searchRemote: "🔍 搜索（远程）",
    searchRemoteTitle: "远程搜索 (S-031)",
    deleteRemote: "🗑 删除（远程）",
    deleteRemoteTitle: "删除远程所选项",
    refresh: "↺ 刷新",
    refreshTitle: "刷新",
    close: "关闭",
    local: "本地",
    remoteWith: (label) => `远程 — ${label}`,
    downloadTitle: "下载 远程 → 本地",
    uploadTitle: "上传 本地 → 远程",
    ctxPreview: "预览",
    ctxDownload: "← 下载",
    ctxRename: "重命名",
    ctxProps: "属性/权限",
    ctxDelete: "删除",
    ctxUpload: "→ 上传",
    emptyFile: "(空文件)",
    previewFooter: "最多预览 256KB · 二进制文件可能显示乱码",
    save: "保存",
    saved: "已保存 ✓",
    saveErr: "保存失败",
    editFooter: "编辑并保存（⌘S）— 覆盖远程文件",
    loading: "加载中…",
    colName: "名称",
    colSize: "大小",
    colModified: "修改时间",
    propsTitle: (name) => `属性 / 权限 — ${name}`,
    directory: "目录",
    octal: "八进制",
    owner: "所有者",
    group: "组",
    other: "其他",
    read: "读 (r)",
    write: "写 (w)",
    execute: "执行 (x)",
    cancel: "取消",
    apply: (octal) => `应用 (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `传输队列 · 进行中 ${active} / 完成·失败 ${finished}`,
    clearFinished: "清除已完成",
    done: "✓ 完成",
    failed: "✗ 失败",
    remoteSearch: "🔍 远程搜索",
    underRoot: (root) => `在 ${root} 下`,
    searchPlaceholder: "文件名（不区分大小写）",
    includeSub: "包含子目录",
    searching: "搜索中...",
    search: "搜索",
    enterQuery: "输入搜索词并按 Enter。",
    noResults: "无结果",
    openLocation: "双击：打开位置",
    truncated: "结果被截断为 500 条。请使搜索词更具体。",
  },
  ja: {
    errLocal: (e) => `ローカル: ${e}`,
    errRemote: (e) => `リモート: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' はローカルに既に存在します。上書きしますか？`,
    confirmOverwriteRemote: (name) =>
      `'${name}' はリモートに既に存在します。上書きしますか？`,
    confirmDeleteRemote: (name) => `リモートの '${name}' を削除しますか？`,
    errDelete: (e) => `削除: ${e}`,
    promptNewFolder: "新しいリモートフォルダ名:",
    errMkdir: (e) => `新規フォルダ: ${e}`,
    promptNewFile: "新しいリモートファイル名:",
    errTouch: (e) => `新規ファイル: ${e}`,
    promptNewName: "新しい名前:",
    errRename: (e) => `名前変更: ${e}`,
    errChmod: (e) => `権限変更: ${e}`,
    errPreview: (e) => `プレビュー: ${e}`,
    fileBrowser: "📁 ファイルブラウザ",
    localSep: "ローカル ↔ ",
    newFolderRemote: "+ フォルダ（リモート）",
    newFolderRemoteTitle: "新規リモートフォルダ",
    newFileRemote: "+ ファイル（リモート）",
    newFileRemoteTitle: "新規リモートファイル",
    searchRemote: "🔍 検索（リモート）",
    searchRemoteTitle: "リモート検索 (S-031)",
    deleteRemote: "🗑 削除（リモート）",
    deleteRemoteTitle: "リモートの選択を削除",
    refresh: "↺ 更新",
    refreshTitle: "更新",
    close: "閉じる",
    local: "ローカル",
    remoteWith: (label) => `リモート — ${label}`,
    downloadTitle: "ダウンロード リモート → ローカル",
    uploadTitle: "アップロード ローカル → リモート",
    ctxPreview: "プレビュー",
    ctxDownload: "← ダウンロード",
    ctxRename: "名前変更",
    ctxProps: "プロパティ/権限",
    ctxDelete: "削除",
    ctxUpload: "→ アップロード",
    emptyFile: "(空のファイル)",
    previewFooter: "最大 256KB のプレビュー · バイナリは文字化けする場合があります",
    save: "保存",
    saved: "保存しました ✓",
    saveErr: "保存に失敗",
    editFooter: "編集して保存（⌘S）— リモートファイルを上書き",
    loading: "読み込み中…",
    colName: "名前",
    colSize: "サイズ",
    colModified: "更新日時",
    propsTitle: (name) => `プロパティ / 権限 — ${name}`,
    directory: "ディレクトリ",
    octal: "8進数",
    owner: "所有者",
    group: "グループ",
    other: "その他",
    read: "読み取り (r)",
    write: "書き込み (w)",
    execute: "実行 (x)",
    cancel: "キャンセル",
    apply: (octal) => `適用 (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `転送キュー · 進行中 ${active} / 完了·失敗 ${finished}`,
    clearFinished: "完了項目をクリア",
    done: "✓ 完了",
    failed: "✗ 失敗",
    remoteSearch: "🔍 リモート検索",
    underRoot: (root) => `${root} 以下`,
    searchPlaceholder: "ファイル名（大文字小文字を区別しない）",
    includeSub: "サブディレクトリを含む",
    searching: "検索中...",
    search: "検索",
    enterQuery: "検索語を入力して Enter を押してください。",
    noResults: "結果なし",
    openLocation: "ダブルクリック: 場所を開く",
    truncated: "結果が 500 件で切り捨てられました。検索語をより具体的にしてください。",
  },
  ru: {
    errLocal: (e) => `Локально: ${e}`,
    errRemote: (e) => `Удалённо: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' уже существует локально. Перезаписать?`,
    confirmOverwriteRemote: (name) =>
      `'${name}' уже существует на удалённом сервере. Перезаписать?`,
    confirmDeleteRemote: (name) => `Удалить удалённый '${name}'?`,
    errDelete: (e) => `Удаление: ${e}`,
    promptNewFolder: "Имя новой удалённой папки:",
    errMkdir: (e) => `Новая папка: ${e}`,
    promptNewFile: "Имя нового удалённого файла:",
    errTouch: (e) => `Новый файл: ${e}`,
    promptNewName: "Новое имя:",
    errRename: (e) => `Переименование: ${e}`,
    errChmod: (e) => `Изменение прав: ${e}`,
    errPreview: (e) => `Предпросмотр: ${e}`,
    fileBrowser: "📁 Файловый менеджер",
    localSep: "Локально ↔ ",
    newFolderRemote: "+ Папка (удалённо)",
    newFolderRemoteTitle: "Новая удалённая папка",
    newFileRemote: "+ Файл (удалённо)",
    newFileRemoteTitle: "Новый удалённый файл",
    searchRemote: "🔍 Поиск (удалённо)",
    searchRemoteTitle: "Удалённый поиск (S-031)",
    deleteRemote: "🗑 Удалить (удалённо)",
    deleteRemoteTitle: "Удалить выбранное на сервере",
    refresh: "↺ Обновить",
    refreshTitle: "Обновить",
    close: "Закрыть",
    local: "Локально",
    remoteWith: (label) => `Удалённо — ${label}`,
    downloadTitle: "Скачать удалённо → локально",
    uploadTitle: "Загрузить локально → удалённо",
    ctxPreview: "Предпросмотр",
    ctxDownload: "← Скачать",
    ctxRename: "Переименовать",
    ctxProps: "Свойства/Права",
    ctxDelete: "Удалить",
    ctxUpload: "→ Загрузить",
    emptyFile: "(пустой файл)",
    previewFooter: "Предпросмотр до 256КБ · двоичные файлы могут отображаться некорректно",
    save: "Сохранить",
    saved: "Сохранено ✓",
    saveErr: "Не удалось сохранить",
    editFooter: "Измените и сохраните (⌘S) — перезапишет удалённый файл",
    loading: "Загрузка…",
    colName: "Имя",
    colSize: "Размер",
    colModified: "Изменён",
    propsTitle: (name) => `Свойства / Права — ${name}`,
    directory: "Каталог",
    octal: "восьмеричный",
    owner: "Владелец",
    group: "Группа",
    other: "Остальные",
    read: "Чтение (r)",
    write: "Запись (w)",
    execute: "Выполнение (x)",
    cancel: "Отмена",
    apply: (octal) => `Применить (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `Очередь передачи · в процессе ${active} / готово·ошибки ${finished}`,
    clearFinished: "Очистить завершённые",
    done: "✓ Готово",
    failed: "✗ Ошибка",
    remoteSearch: "🔍 Удалённый поиск",
    underRoot: (root) => `в ${root}`,
    searchPlaceholder: "Имя файла (без учёта регистра)",
    includeSub: "Включая подкаталоги",
    searching: "Поиск...",
    search: "Поиск",
    enterQuery: "Введите запрос и нажмите Enter.",
    noResults: "Нет результатов",
    openLocation: "Двойной клик: открыть расположение",
    truncated: "Результаты обрезаны до 500. Сделайте запрос более конкретным.",
  },
  fr: {
    errLocal: (e) => `Local : ${e}`,
    errRemote: (e) => `Distant : ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' existe déjà en local. Écraser ?`,
    confirmOverwriteRemote: (name) =>
      `'${name}' existe déjà sur le distant. Écraser ?`,
    confirmDeleteRemote: (name) => `Supprimer le distant '${name}' ?`,
    errDelete: (e) => `Suppression : ${e}`,
    promptNewFolder: "Nom du nouveau dossier distant :",
    errMkdir: (e) => `Nouveau dossier : ${e}`,
    promptNewFile: "Nom du nouveau fichier distant :",
    errTouch: (e) => `Nouveau fichier : ${e}`,
    promptNewName: "Nouveau nom :",
    errRename: (e) => `Renommer : ${e}`,
    errChmod: (e) => `Changer les permissions : ${e}`,
    errPreview: (e) => `Aperçu : ${e}`,
    fileBrowser: "📁 Explorateur de fichiers",
    localSep: "Local ↔ ",
    newFolderRemote: "+ Dossier (distant)",
    newFolderRemoteTitle: "Nouveau dossier distant",
    newFileRemote: "+ Fichier (distant)",
    newFileRemoteTitle: "Nouveau fichier distant",
    searchRemote: "🔍 Rechercher (distant)",
    searchRemoteTitle: "Recherche distante (S-031)",
    deleteRemote: "🗑 Supprimer (distant)",
    deleteRemoteTitle: "Supprimer la sélection distante",
    refresh: "↺ Actualiser",
    refreshTitle: "Actualiser",
    close: "Fermer",
    local: "Local",
    remoteWith: (label) => `Distant — ${label}`,
    downloadTitle: "Télécharger distant → local",
    uploadTitle: "Envoyer local → distant",
    ctxPreview: "Aperçu",
    ctxDownload: "← Télécharger",
    ctxRename: "Renommer",
    ctxProps: "Propriétés/Permissions",
    ctxDelete: "Supprimer",
    ctxUpload: "→ Envoyer",
    emptyFile: "(fichier vide)",
    previewFooter: "Aperçu jusqu'à 256 Ko · le binaire peut être illisible",
    save: "Enregistrer",
    saved: "Enregistré ✓",
    saveErr: "Échec de l'enregistrement",
    editFooter: "Modifiez et enregistrez (⌘S) — écrase le fichier distant",
    loading: "Chargement…",
    colName: "Nom",
    colSize: "Taille",
    colModified: "Modifié",
    propsTitle: (name) => `Propriétés / Permissions — ${name}`,
    directory: "Répertoire",
    octal: "octal",
    owner: "Propriétaire",
    group: "Groupe",
    other: "Autres",
    read: "Lecture (r)",
    write: "Écriture (w)",
    execute: "Exécution (x)",
    cancel: "Annuler",
    apply: (octal) => `Appliquer (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `File de transfert · en cours ${active} / terminés·échoués ${finished}`,
    clearFinished: "Effacer les terminés",
    done: "✓ Terminé",
    failed: "✗ Échec",
    remoteSearch: "🔍 Recherche distante",
    underRoot: (root) => `sous ${root}`,
    searchPlaceholder: "Nom de fichier (insensible à la casse)",
    includeSub: "Inclure les sous-dossiers",
    searching: "Recherche...",
    search: "Rechercher",
    enterQuery: "Saisissez une requête et appuyez sur Entrée.",
    noResults: "Aucun résultat",
    openLocation: "Double-clic : ouvrir l'emplacement",
    truncated: "Les résultats ont été tronqués à 500. Précisez votre requête.",
  },
  de: {
    errLocal: (e) => `Lokal: ${e}`,
    errRemote: (e) => `Remote: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' existiert bereits lokal. Überschreiben?`,
    confirmOverwriteRemote: (name) =>
      `'${name}' existiert bereits auf dem Remote. Überschreiben?`,
    confirmDeleteRemote: (name) => `Remote '${name}' löschen?`,
    errDelete: (e) => `Löschen: ${e}`,
    promptNewFolder: "Name des neuen Remote-Ordners:",
    errMkdir: (e) => `Neuer Ordner: ${e}`,
    promptNewFile: "Name der neuen Remote-Datei:",
    errTouch: (e) => `Neue Datei: ${e}`,
    promptNewName: "Neuer Name:",
    errRename: (e) => `Umbenennen: ${e}`,
    errChmod: (e) => `Berechtigungen ändern: ${e}`,
    errPreview: (e) => `Vorschau: ${e}`,
    fileBrowser: "📁 Dateibrowser",
    localSep: "Lokal ↔ ",
    newFolderRemote: "+ Ordner (Remote)",
    newFolderRemoteTitle: "Neuer Remote-Ordner",
    newFileRemote: "+ Datei (Remote)",
    newFileRemoteTitle: "Neue Remote-Datei",
    searchRemote: "🔍 Suchen (Remote)",
    searchRemoteTitle: "Remote-Suche (S-031)",
    deleteRemote: "🗑 Löschen (Remote)",
    deleteRemoteTitle: "Remote-Auswahl löschen",
    refresh: "↺ Aktualisieren",
    refreshTitle: "Aktualisieren",
    close: "Schließen",
    local: "Lokal",
    remoteWith: (label) => `Remote — ${label}`,
    downloadTitle: "Herunterladen Remote → Lokal",
    uploadTitle: "Hochladen Lokal → Remote",
    ctxPreview: "Vorschau",
    ctxDownload: "← Herunterladen",
    ctxRename: "Umbenennen",
    ctxProps: "Eigenschaften/Berechtigungen",
    ctxDelete: "Löschen",
    ctxUpload: "→ Hochladen",
    emptyFile: "(leere Datei)",
    previewFooter: "Vorschau bis 256 KB · Binärdateien können unleserlich erscheinen",
    save: "Speichern",
    saved: "Gespeichert ✓",
    saveErr: "Speichern fehlgeschlagen",
    editFooter: "Bearbeiten und speichern (⌘S) — überschreibt die Remote-Datei",
    loading: "Wird geladen…",
    colName: "Name",
    colSize: "Größe",
    colModified: "Geändert",
    propsTitle: (name) => `Eigenschaften / Berechtigungen — ${name}`,
    directory: "Verzeichnis",
    octal: "oktal",
    owner: "Eigentümer",
    group: "Gruppe",
    other: "Andere",
    read: "Lesen (r)",
    write: "Schreiben (w)",
    execute: "Ausführen (x)",
    cancel: "Abbrechen",
    apply: (octal) => `Anwenden (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `Übertragungswarteschlange · läuft ${active} / fertig·fehlgeschlagen ${finished}`,
    clearFinished: "Abgeschlossene löschen",
    done: "✓ Fertig",
    failed: "✗ Fehlgeschlagen",
    remoteSearch: "🔍 Remote-Suche",
    underRoot: (root) => `unter ${root}`,
    searchPlaceholder: "Dateiname (Groß-/Kleinschreibung egal)",
    includeSub: "Unterverzeichnisse einbeziehen",
    searching: "Wird gesucht...",
    search: "Suchen",
    enterQuery: "Geben Sie eine Suchanfrage ein und drücken Sie Enter.",
    noResults: "Keine Ergebnisse",
    openLocation: "Doppelklick: Speicherort öffnen",
    truncated: "Ergebnisse wurden bei 500 abgeschnitten. Präzisieren Sie Ihre Suchanfrage.",
  },
  vi: {
    errLocal: (e) => `Cục bộ: ${e}`,
    errRemote: (e) => `Từ xa: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' đã tồn tại cục bộ. Ghi đè?`,
    confirmOverwriteRemote: (name) =>
      `'${name}' đã tồn tại trên máy từ xa. Ghi đè?`,
    confirmDeleteRemote: (name) => `Xóa '${name}' trên máy từ xa?`,
    errDelete: (e) => `Xóa: ${e}`,
    promptNewFolder: "Tên thư mục từ xa mới:",
    errMkdir: (e) => `Thư mục mới: ${e}`,
    promptNewFile: "Tên tệp từ xa mới:",
    errTouch: (e) => `Tệp mới: ${e}`,
    promptNewName: "Tên mới:",
    errRename: (e) => `Đổi tên: ${e}`,
    errChmod: (e) => `Đổi quyền: ${e}`,
    errPreview: (e) => `Xem trước: ${e}`,
    fileBrowser: "📁 Trình duyệt tệp",
    localSep: "Cục bộ ↔ ",
    newFolderRemote: "+ Thư mục (từ xa)",
    newFolderRemoteTitle: "Thư mục từ xa mới",
    newFileRemote: "+ Tệp (từ xa)",
    newFileRemoteTitle: "Tệp từ xa mới",
    searchRemote: "🔍 Tìm kiếm (từ xa)",
    searchRemoteTitle: "Tìm kiếm từ xa (S-031)",
    deleteRemote: "🗑 Xóa (từ xa)",
    deleteRemoteTitle: "Xóa mục đã chọn từ xa",
    refresh: "↺ Làm mới",
    refreshTitle: "Làm mới",
    close: "Đóng",
    local: "Cục bộ",
    remoteWith: (label) => `Từ xa — ${label}`,
    downloadTitle: "Tải xuống từ xa → cục bộ",
    uploadTitle: "Tải lên cục bộ → từ xa",
    ctxPreview: "Xem trước",
    ctxDownload: "← Tải xuống",
    ctxRename: "Đổi tên",
    ctxProps: "Thuộc tính/Quyền",
    ctxDelete: "Xóa",
    ctxUpload: "→ Tải lên",
    emptyFile: "(tệp trống)",
    previewFooter: "Xem trước tối đa 256KB · tệp nhị phân có thể hiển thị lỗi",
    save: "Lưu",
    saved: "Đã lưu ✓",
    saveErr: "Lưu thất bại",
    editFooter: "Chỉnh sửa và lưu (⌘S) — ghi đè tệp từ xa",
    loading: "Đang tải…",
    colName: "Tên",
    colSize: "Kích thước",
    colModified: "Đã sửa đổi",
    propsTitle: (name) => `Thuộc tính / Quyền — ${name}`,
    directory: "Thư mục",
    octal: "bát phân",
    owner: "Chủ sở hữu",
    group: "Nhóm",
    other: "Khác",
    read: "Đọc (r)",
    write: "Ghi (w)",
    execute: "Thực thi (x)",
    cancel: "Hủy",
    apply: (octal) => `Áp dụng (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `Hàng đợi truyền · đang chạy ${active} / xong·thất bại ${finished}`,
    clearFinished: "Xóa mục đã xong",
    done: "✓ Xong",
    failed: "✗ Thất bại",
    remoteSearch: "🔍 Tìm kiếm từ xa",
    underRoot: (root) => `trong ${root}`,
    searchPlaceholder: "Tên tệp (không phân biệt hoa thường)",
    includeSub: "Bao gồm thư mục con",
    searching: "Đang tìm...",
    search: "Tìm kiếm",
    enterQuery: "Nhập từ khóa và nhấn Enter.",
    noResults: "Không có kết quả",
    openLocation: "Nhấp đúp: mở vị trí",
    truncated: "Kết quả bị cắt ở 500. Hãy làm từ khóa cụ thể hơn.",
  },
  id: {
    errLocal: (e) => `Lokal: ${e}`,
    errRemote: (e) => `Jarak jauh: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' sudah ada secara lokal. Timpa?`,
    confirmOverwriteRemote: (name) =>
      `'${name}' sudah ada di server jarak jauh. Timpa?`,
    confirmDeleteRemote: (name) => `Hapus '${name}' di jarak jauh?`,
    errDelete: (e) => `Hapus: ${e}`,
    promptNewFolder: "Nama folder jarak jauh baru:",
    errMkdir: (e) => `Folder baru: ${e}`,
    promptNewFile: "Nama file jarak jauh baru:",
    errTouch: (e) => `File baru: ${e}`,
    promptNewName: "Nama baru:",
    errRename: (e) => `Ganti nama: ${e}`,
    errChmod: (e) => `Ubah izin: ${e}`,
    errPreview: (e) => `Pratinjau: ${e}`,
    fileBrowser: "📁 Penjelajah File",
    localSep: "Lokal ↔ ",
    newFolderRemote: "+ Folder (jarak jauh)",
    newFolderRemoteTitle: "Folder jarak jauh baru",
    newFileRemote: "+ File (jarak jauh)",
    newFileRemoteTitle: "File jarak jauh baru",
    searchRemote: "🔍 Cari (jarak jauh)",
    searchRemoteTitle: "Pencarian jarak jauh (S-031)",
    deleteRemote: "🗑 Hapus (jarak jauh)",
    deleteRemoteTitle: "Hapus pilihan jarak jauh",
    refresh: "↺ Segarkan",
    refreshTitle: "Segarkan",
    close: "Tutup",
    local: "Lokal",
    remoteWith: (label) => `Jarak jauh — ${label}`,
    downloadTitle: "Unduh jarak jauh → lokal",
    uploadTitle: "Unggah lokal → jarak jauh",
    ctxPreview: "Pratinjau",
    ctxDownload: "← Unduh",
    ctxRename: "Ganti nama",
    ctxProps: "Properti/Izin",
    ctxDelete: "Hapus",
    ctxUpload: "→ Unggah",
    emptyFile: "(file kosong)",
    previewFooter: "Pratinjau hingga 256KB · biner mungkin tampak rusak",
    save: "Simpan",
    saved: "Tersimpan ✓",
    saveErr: "Gagal menyimpan",
    editFooter: "Edit dan simpan (⌘S) — menimpa berkas jarak jauh",
    loading: "Memuat…",
    colName: "Nama",
    colSize: "Ukuran",
    colModified: "Diubah",
    propsTitle: (name) => `Properti / Izin — ${name}`,
    directory: "Direktori",
    octal: "oktal",
    owner: "Pemilik",
    group: "Grup",
    other: "Lainnya",
    read: "Baca (r)",
    write: "Tulis (w)",
    execute: "Eksekusi (x)",
    cancel: "Batal",
    apply: (octal) => `Terapkan (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `Antrean transfer · berlangsung ${active} / selesai·gagal ${finished}`,
    clearFinished: "Bersihkan yang selesai",
    done: "✓ Selesai",
    failed: "✗ Gagal",
    remoteSearch: "🔍 Pencarian jarak jauh",
    underRoot: (root) => `di bawah ${root}`,
    searchPlaceholder: "Nama file (tidak peka huruf besar/kecil)",
    includeSub: "Sertakan subdirektori",
    searching: "Mencari...",
    search: "Cari",
    enterQuery: "Masukkan kueri dan tekan Enter.",
    noResults: "Tidak ada hasil",
    openLocation: "Klik ganda: buka lokasi",
    truncated: "Hasil dipotong pada 500. Buat kueri Anda lebih spesifik.",
  },
  hi: {
    errLocal: (e) => `लोकल: ${e}`,
    errRemote: (e) => `रिमोट: ${e}`,
    confirmOverwriteLocal: (name) =>
      `'${name}' पहले से लोकल में मौजूद है। अधिलेखित करें?`,
    confirmOverwriteRemote: (name) =>
      `'${name}' पहले से रिमोट पर मौजूद है। अधिलेखित करें?`,
    confirmDeleteRemote: (name) => `रिमोट '${name}' हटाएं?`,
    errDelete: (e) => `हटाएं: ${e}`,
    promptNewFolder: "नए रिमोट फ़ोल्डर का नाम:",
    errMkdir: (e) => `नया फ़ोल्डर: ${e}`,
    promptNewFile: "नई रिमोट फ़ाइल का नाम:",
    errTouch: (e) => `नई फ़ाइल: ${e}`,
    promptNewName: "नया नाम:",
    errRename: (e) => `नाम बदलें: ${e}`,
    errChmod: (e) => `अनुमतियां बदलें: ${e}`,
    errPreview: (e) => `पूर्वावलोकन: ${e}`,
    fileBrowser: "📁 फ़ाइल ब्राउज़र",
    localSep: "लोकल ↔ ",
    newFolderRemote: "+ फ़ोल्डर (रिमोट)",
    newFolderRemoteTitle: "नया रिमोट फ़ोल्डर",
    newFileRemote: "+ फ़ाइल (रिमोट)",
    newFileRemoteTitle: "नई रिमोट फ़ाइल",
    searchRemote: "🔍 खोजें (रिमोट)",
    searchRemoteTitle: "रिमोट खोज (S-031)",
    deleteRemote: "🗑 हटाएं (रिमोट)",
    deleteRemoteTitle: "रिमोट चयन हटाएं",
    refresh: "↺ रिफ़्रेश",
    refreshTitle: "रिफ़्रेश",
    close: "बंद करें",
    local: "लोकल",
    remoteWith: (label) => `रिमोट — ${label}`,
    downloadTitle: "डाउनलोड रिमोट → लोकल",
    uploadTitle: "अपलोड लोकल → रिमोट",
    ctxPreview: "पूर्वावलोकन",
    ctxDownload: "← डाउनलोड",
    ctxRename: "नाम बदलें",
    ctxProps: "गुण/अनुमतियां",
    ctxDelete: "हटाएं",
    ctxUpload: "→ अपलोड",
    emptyFile: "(खाली फ़ाइल)",
    previewFooter: "256KB तक पूर्वावलोकन · बाइनरी विकृत दिख सकती है",
    save: "सहेजें",
    saved: "सहेजा गया ✓",
    saveErr: "सहेजना विफल",
    editFooter: "संपादित करें और सहेजें (⌘S) — रिमोट फ़ाइल अधिलेखित करता है",
    loading: "लोड हो रहा है…",
    colName: "नाम",
    colSize: "आकार",
    colModified: "संशोधित",
    propsTitle: (name) => `गुण / अनुमतियां — ${name}`,
    directory: "डायरेक्टरी",
    octal: "अष्टाधारी",
    owner: "स्वामी",
    group: "समूह",
    other: "अन्य",
    read: "पढ़ें (r)",
    write: "लिखें (w)",
    execute: "निष्पादित करें (x)",
    cancel: "रद्द करें",
    apply: (octal) => `लागू करें (chmod ${octal})`,
    transferQueue: (active, finished) =>
      `ट्रांसफर कतार · प्रगति में ${active} / पूर्ण·विफल ${finished}`,
    clearFinished: "पूर्ण हटाएं",
    done: "✓ पूर्ण",
    failed: "✗ विफल",
    remoteSearch: "🔍 रिमोट खोज",
    underRoot: (root) => `${root} के अंतर्गत`,
    searchPlaceholder: "फ़ाइल नाम (केस-असंवेदनशील)",
    includeSub: "उपनिर्देशिकाएं शामिल करें",
    searching: "खोज रहे हैं...",
    search: "खोजें",
    enterQuery: "क्वेरी दर्ज करें और Enter दबाएं।",
    noResults: "कोई परिणाम नहीं",
    openLocation: "डबल-क्लिक: स्थान खोलें",
    truncated: "परिणाम 500 पर काट दिए गए। अपनी क्वेरी अधिक विशिष्ट बनाएं।",
  },
};

function newTransferId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

interface TransferItem {
  id: string;
  label: string;
  direction: "up" | "down";
  transferred: number;
  total: number;
  status: "active" | "done" | "error";
  error?: string;
}

interface Props {
  hostId: string;
  hostLabel: string;
  /** 원격 패널 시작 경로 (셸 cwd, OSC 7로 추적). 없으면 SSH 기본 홈. */
  initialRemotePath?: string;
  onClose: () => void;
}

/** posix 경로 결합 (원격용). */
function joinPosix(cwd: string, name: string): string {
  if (name === "..") {
    const idx = cwd.replace(/\/+$/, "").lastIndexOf("/");
    return idx <= 0 ? "/" : cwd.slice(0, idx);
  }
  return `${cwd.replace(/\/+$/, "")}/${name}`;
}

// 로컬 pane 경로 조합 — Windows(역슬래시·드라이브 루트 C:\)와 POSIX 모두 처리한다.
// joinPosix를 로컬에 쓰면 Windows 경로(C:\Users\...)에서 ".."가 "/"로 튕기고,
// 하위 진입이 "C:\...\dir" 대신 "C:\.../dir"가 되어 os error 123이 난다(#94).
function joinLocal(cwd: string, name: string): string {
  const win = cwd.includes("\\");
  const sep = win ? "\\" : "/";
  const trimmed = cwd.replace(win ? /[\\/]+$/ : /\/+$/, "");
  if (name === "..") {
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    if (idx < 0) return cwd; // 더 올라갈 곳 없음
    const parent = trimmed.slice(0, idx);
    if (/^[A-Za-z]:$/.test(parent)) return parent + "\\"; // 드라이브 루트는 C:\ 형태 유지
    return parent === "" ? "/" : parent;
  }
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\${name}`;
  return `${trimmed}${sep}${name}`;
}

function nameExists(listing: Listing | null, name: string): boolean {
  return !!listing?.entries.some((e) => e.name === name);
}

// 확장자 → 이미지 MIME (미리보기용). 미지원이면 null.
function imageMime(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "ico":
      return "image/x-icon";
    default:
      return null;
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fmtDate(epoch?: number | null): string {
  if (!epoch) return "";
  return new Date(epoch * 1000).toLocaleString();
}

export function FileBrowser({ hostId, hostLabel, initialRemotePath, onClose }: Props) {
  const t = useT(STR);
  const [local, setLocal] = useState<Listing | null>(null);
  const [remote, setRemote] = useState<Listing | null>(null);
  const [localSel, setLocalSel] = useState<FileEntry | null>(null);
  const [remoteSel, setRemoteSel] = useState<FileEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(true);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);

  function updateTransfer(id: string, patch: Partial<TransferItem>) {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  const [menu, setMenu] = useState<{
    entry: FileEntry;
    x: number;
    y: number;
    side: "local" | "remote";
  } | null>(null);
  const [preview, setPreview] = useState<{
    name: string;
    content: string;
    imageUrl?: string;
    /** 텍스트 파일이면 편집 가능. 저장에 필요한 위치 정보. */
    editable?: boolean;
    path?: string;
    hostId?: string;
    isLocal?: boolean;
  } | null>(null);
  const [permEdit, setPermEdit] = useState<FileEntry | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const loadLocal = useCallback(async (path?: string) => {
    try {
      const l = await invoke<Listing>("local_list_dir", { path: path ?? null });
      setLocal(l);
    } catch (e) {
      setError(t.errLocal(String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

    // 첫 호출은 sftp_open(연결+리스트)을 써야 한다. sftp_list는 연결을 가정하므로
    // 초기 경로(셸 cwd)가 있어도 연결을 먼저 establish하도록 sftp_open(path)로 연다.
  const connectedRef = useRef(false);
  const loadRemote = useCallback(
    async (path?: string) => {
      setRemoteBusy(true);
      try {
        const cmd = connectedRef.current && path ? "sftp_list" : "sftp_open";
        const args = { hostId, path: path ?? null };
        const r = await invoke<Listing>(cmd, args);
        connectedRef.current = true;
        setRemote(r);
        setError(null);
      } catch (e) {
        setError(t.errRemote(String(e)));
      } finally {
        setRemoteBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostId],
  );

  useEffect(() => {
    void loadLocal();
    // 셸 cwd가 있으면 그 경로에서 원격 패널 시작 (없으면 SSH 기본 홈).
    void loadRemote(initialRemotePath || undefined);
    return () => {
      void invoke("sftp_disconnect", { hostId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 전송 진행 이벤트 구독.
  useEffect(() => {
    let un: UnlistenFn | undefined;
    void listen<{ transferId: string; transferred: number; total: number }>(
      "sftp:progress",
      (e) => {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === e.payload.transferId
              ? { ...t, transferred: e.payload.transferred, total: e.payload.total }
              : t,
          ),
        );
      },
    ).then((f) => {
      un = f;
    });
    return () => un?.();
  }, []);

  // OS(Finder/탐색기)에서 파일을 앱에 드롭 → 원격 cwd로 업로드 (#26).
  // remote.cwd는 자주 바뀌므로 ref로 최신값을 읽어 effect는 1회만 구독한다.
  const remoteRef = useRef<Listing | null>(null);
  remoteRef.current = remote;
  const [dragOver, setDragOver] = useState(false);

  // 앱 내부 패널 간 드래그(pointer 기반; dragDropEnabled=true라 HTML5 DnD 불가).
  // 로컬 항목→원격 패널=업로드, 원격 항목→로컬 패널=다운로드.
  const localPanelRef = useRef<HTMLDivElement>(null);
  const remotePanelRef = useRef<HTMLDivElement>(null);
  const [paneDrag, setPaneDrag] = useState<{
    entry: FileEntry;
    from: "local" | "remote";
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const paneDragRef = useRef(paneDrag);
  paneDragRef.current = paneDrag;

  function onItemMouseDown(
    from: "local" | "remote",
    entry: FileEntry,
    e: React.MouseEvent,
  ) {
    if (e.button !== 0 || entry.is_dir) return; // 디렉토리 전송은 v1 미지원
    setPaneDrag({ entry, from, x: e.clientX, y: e.clientY, active: false });
  }
  useEffect(() => {
    let un: UnlistenFn | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragOver(true);
          return;
        }
        if (p.type === "leave") {
          setDragOver(false);
          return;
        }
        // type === "drop"
        setDragOver(false);
        const r = remoteRef.current;
        if (!r) return;
        const remoteCwd = r.cwd;
        for (const path of p.paths) {
          const name = path.split(/[\\/]/).pop() || path;
          const id = newTransferId();
          setTransfers((prev) => [
            ...prev,
            { id, label: `↑ ${name}`, direction: "up", transferred: 0, total: 0, status: "active" },
          ]);
          void invoke("sftp_upload", { hostId, localPath: path, remoteDir: remoteCwd, transferId: id })
            .then(() => {
              updateTransfer(id, { status: "done" });
              void loadRemote(remoteCwd);
            })
            .catch((e) => updateTransfer(id, { status: "error", error: String(e) }));
        }
      })
      .then((f) => {
        un = f;
      });
    return () => un?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 다운로드/업로드를 큐에 넣고 비동기 진행 (동시 여러 전송 가능).
  async function doDownload(entry: FileEntry) {
    if (entry.is_dir || !remote) return;
    // WKWebView는 앱→OS 드래그 아웃을 지원하지 않으므로, 저장할 폴더를 직접 고른다.
    const dir = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: local?.cwd,
    });
    if (typeof dir !== "string") return;
    const id = newTransferId();
    const remotePath = joinPosix(remote.cwd, entry.name);
    setTransfers((prev) => [
      ...prev,
      { id, label: `↓ ${entry.name}`, direction: "down", transferred: 0, total: entry.size, status: "active" },
    ]);
    void invoke("sftp_download", { hostId, remotePath, localDir: dir, transferId: id })
      .then(() => {
        updateTransfer(id, { status: "done", transferred: entry.size });
        // 선택한 폴더가 현재 로컬 뷰면 새로고침.
        if (dir === local?.cwd) void loadLocal(dir);
      })
      .catch((e) => updateTransfer(id, { status: "error", error: String(e) }));
  }

  function doUpload(entry: FileEntry) {
    if (entry.is_dir || !local || !remote) return;
    if (
      nameExists(remote, entry.name) &&
      !confirm(t.confirmOverwriteRemote(entry.name))
    )
      return;
    const id = newTransferId();
    const remoteCwd = remote.cwd;
    const localPath = joinPosix(local.cwd, entry.name);
    setTransfers((prev) => [
      ...prev,
      { id, label: `↑ ${entry.name}`, direction: "up", transferred: 0, total: entry.size, status: "active" },
    ]);
    void invoke("sftp_upload", { hostId, localPath, remoteDir: remoteCwd, transferId: id })
      .then(() => {
        updateTransfer(id, { status: "done", transferred: entry.size });
        void loadRemote(remoteCwd);
      })
      .catch((e) => updateTransfer(id, { status: "error", error: String(e) }));
  }

  // 패널 간 드래그 다운로드 — 폴더 선택 없이 현재 로컬 폴더로 바로 저장.
  function doDownloadTo(entry: FileEntry) {
    if (entry.is_dir || !remote || !local) return;
    const id = newTransferId();
    const localCwd = local.cwd;
    const remotePath = joinPosix(remote.cwd, entry.name);
    setTransfers((prev) => [
      ...prev,
      { id, label: `↓ ${entry.name}`, direction: "down", transferred: 0, total: entry.size, status: "active" },
    ]);
    void invoke("sftp_download", { hostId, remotePath, localDir: localCwd, transferId: id })
      .then(() => {
        updateTransfer(id, { status: "done", transferred: entry.size });
        void loadLocal(localCwd);
      })
      .catch((e) => updateTransfer(id, { status: "error", error: String(e) }));
  }

  // 패널 간 pointer 드래그: 이동 임계를 넘으면 active, mouseup 시 반대 패널 위면 전송.
  useEffect(() => {
    function move(e: MouseEvent) {
      const d = paneDragRef.current;
      if (!d) return;
      const active = d.active || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6;
      setPaneDrag({ ...d, x: e.clientX, y: e.clientY, active });
    }
    function up(e: MouseEvent) {
      const d = paneDragRef.current;
      if (d?.active) {
        const inRect = (ref: React.RefObject<HTMLDivElement | null>) => {
          const r = ref.current?.getBoundingClientRect();
          return (
            !!r &&
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          );
        };
        if (d.from === "local" && inRect(remotePanelRef)) doUpload(d.entry);
        else if (d.from === "remote" && inRect(localPanelRef)) doDownloadTo(d.entry);
      }
      if (paneDragRef.current) setPaneDrag(null);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, remote, hostId]);

  async function removeRemote() {
    if (!remoteSel || !remote) return;
    if (!confirm(t.confirmDeleteRemote(remoteSel.name))) return;
    try {
      await invoke("sftp_remove", {
        hostId,
        path: joinPosix(remote.cwd, remoteSel.name),
        isDir: remoteSel.is_dir,
      });
      setRemoteSel(null);
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(t.errDelete(String(e)));
    }
  }

  async function mkdirRemote() {
    if (!remote) return;
    const name = prompt(t.promptNewFolder);
    if (!name) return;
    try {
      await invoke("sftp_mkdir", { hostId, path: joinPosix(remote.cwd, name) });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(t.errMkdir(String(e)));
    }
  }

  async function touchRemote() {
    if (!remote) return;
    const name = prompt(t.promptNewFile);
    if (!name) return;
    try {
      await invoke("sftp_touch", { hostId, path: joinPosix(remote.cwd, name) });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(t.errTouch(String(e)));
    }
  }

  async function renameRemote(entry: FileEntry) {
    if (!remote) return;
    const next = prompt(t.promptNewName, entry.name);
    if (!next || next === entry.name) return;
    try {
      await invoke("sftp_rename", {
        hostId,
        from: joinPosix(remote.cwd, entry.name),
        to: joinPosix(remote.cwd, next),
      });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(t.errRename(String(e)));
    }
  }

  async function applyChmod(entry: FileEntry, mode: number) {
    if (!remote) return;
    try {
      await invoke("sftp_chmod", {
        hostId,
        path: joinPosix(remote.cwd, entry.name),
        mode,
      });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(t.errChmod(String(e)));
    }
  }

  async function previewRemote(entry: FileEntry) {
    if (!remote || entry.is_dir) return;
    const path = joinPosix(remote.cwd, entry.name);
    const mime = imageMime(entry.name);
    try {
      if (mime) {
        const b64 = await invoke<string>("sftp_read_bytes", { hostId, path });
        setPreview({
          name: entry.name,
          content: "",
          imageUrl: `data:${mime};base64,${b64}`,
        });
        return;
      }
      const content = await invoke<string>("sftp_read_text", { hostId, path });
      setPreview({ name: entry.name, content, editable: true, path, hostId });
    } catch (e) {
      setError(t.errPreview(String(e)));
    }
  }

  async function previewLocal(entry: FileEntry) {
    if (!local || entry.is_dir) return;
    const path = joinPosix(local.cwd, entry.name);
    const mime = imageMime(entry.name);
    try {
      if (mime) {
        const b64 = await invoke<string>("local_read_bytes", { path });
        setPreview({
          name: entry.name,
          content: "",
          imageUrl: `data:${mime};base64,${b64}`,
        });
        return;
      }
      const content = await invoke<string>("local_read_text", { path });
      setPreview({ name: entry.name, content, editable: true, path, isLocal: true });
    } catch (e) {
      setError(t.errPreview(String(e)));
    }
  }

  async function deleteRemoteEntry(entry: FileEntry) {
    if (!remote) return;
    if (!confirm(t.confirmDeleteRemote(entry.name))) return;
    try {
      await invoke("sftp_remove", {
        hostId,
        path: joinPosix(remote.cwd, entry.name),
        isDir: entry.is_dir,
      });
      await loadRemote(remote.cwd);
    } catch (e) {
      setError(t.errDelete(String(e)));
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "90vw",
          height: "85vh",
          background: "#1e1e24",
          border: "1px solid #333",
          borderRadius: 8,
          color: "#e6e6e6",
          display: "flex",
          flexDirection: "column",
          fontSize: 12,
          overflow: "hidden",
          outline: dragOver ? "2px dashed #4a9eff" : "none",
          outlineOffset: -4,
        }}
        role="dialog"
        aria-modal="true"
      >
        {dragOver && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,16,32,0.55)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              zIndex: 20,
              pointerEvents: "none",
              color: "#cfe6ff",
            }}
          >
            <div style={{ fontSize: 40 }}>⬆</div>
            <div style={{ fontSize: 15 }}>{t.uploadTitle}</div>
          </div>
        )}
        {paneDrag?.active && (
          <div
            style={{
              position: "fixed",
              top: paneDrag.y + 12,
              left: paneDrag.x + 12,
              zIndex: 3000,
              pointerEvents: "none",
              background: "#094771",
              color: "#fff",
              padding: "3px 8px",
              borderRadius: 4,
              fontSize: 11,
              boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
            }}
          >
            {paneDrag.from === "local" ? "↑ " : "↓ "}
            {paneDrag.entry.name}
          </div>
        )}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: "1px solid #2a2a30",
            background: "#23232a",
          }}
        >
          <strong style={{ fontSize: 14 }}>{t.fileBrowser}</strong>
          <span style={{ color: "#789" }}>{t.localSep}{hostLabel}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button onClick={() => void mkdirRemote()} style={toolBtnStyle} title={t.newFolderRemoteTitle}>
              {t.newFolderRemote}
            </button>
            <button onClick={() => void touchRemote()} style={toolBtnStyle} title={t.newFileRemoteTitle}>
              {t.newFileRemote}
            </button>
            <button
              onClick={() => setShowSearch(true)}
              disabled={!remote}
              style={toolBtnStyle}
              title={t.searchRemoteTitle}
            >
              {t.searchRemote}
            </button>
            <button
              onClick={() => void removeRemote()}
              disabled={!remoteSel}
              style={{ ...toolBtnStyle, opacity: remoteSel ? 1 : 0.5 }}
              title={t.deleteRemoteTitle}
            >
              {t.deleteRemote}
            </button>
            <button
              onClick={() => {
                void loadLocal(local?.cwd);
                void loadRemote(remote?.cwd);
              }}
              style={toolBtnStyle}
              title={t.refreshTitle}
            >
              {t.refresh}
            </button>
            <button onClick={onClose} style={toolBtnStyle}>
              {t.close}
            </button>
          </div>
        </header>

        {error && (
          <div style={{ padding: "6px 14px", background: "#3a1d1d", color: "#fdd" }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div ref={localPanelRef} style={{ flex: 1, display: "flex", minWidth: 0 }}>
            <Panel
              title={t.local}
              listing={local}
              selected={localSel}
              onSelect={setLocalSel}
              onNavigate={(p) => {
                setLocalSel(null);
                void loadLocal(p);
              }}
              onContextMenu={(entry, x, y) => setMenu({ entry, x, y, side: "local" })}
              onItemMouseDown={(entry, ev) => onItemMouseDown("local", entry, ev)}
              onFileActivate={(entry) => void previewLocal(entry)}
              dragging={!!paneDrag?.active}
              joinPath={(cwd, name) => joinLocal(cwd, name)}
            />
          </div>
          <div
            style={{
              width: 64,
              background: "#16161c",
              borderLeft: "1px solid #2a2a30",
              borderRight: "1px solid #2a2a30",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              color: "#789",
            }}
          >
            <button
              onClick={() => remoteSel && doDownload(remoteSel)}
              disabled={!remoteSel || remoteSel.is_dir}
              title={t.downloadTitle}
              style={arrowBtnStyle(!!remoteSel && !remoteSel.is_dir)}
            >
              ←
            </button>
            <button
              onClick={() => localSel && doUpload(localSel)}
              disabled={!localSel || localSel.is_dir}
              title={t.uploadTitle}
              style={arrowBtnStyle(!!localSel && !localSel.is_dir)}
            >
              →
            </button>
          </div>
          <div ref={remotePanelRef} style={{ flex: 1, display: "flex", minWidth: 0 }}>
            <Panel
              title={t.remoteWith(hostLabel)}
              listing={remote}
              busy={remoteBusy}
              selected={remoteSel}
              onSelect={setRemoteSel}
              onNavigate={(p) => {
                setRemoteSel(null);
                void loadRemote(p);
              }}
              onContextMenu={(entry, x, y) => setMenu({ entry, x, y, side: "remote" })}
              onItemMouseDown={(entry, ev) => onItemMouseDown("remote", entry, ev)}
              onFileActivate={(entry) => void previewRemote(entry)}
              dragging={!!paneDrag?.active}
              joinPath={(cwd, name) => joinPosix(cwd, name)}
            />
          </div>
        </div>

        {transfers.length > 0 && (
          <TransferQueue
            transfers={transfers}
            onClear={() =>
              setTransfers((prev) => prev.filter((t) => t.status === "active"))
            }
          />
        )}

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            side={menu.side}
            entry={menu.entry}
            onDismiss={() => setMenu(null)}
            onPreview={() =>
              menu.side === "remote"
                ? void previewRemote(menu.entry)
                : void previewLocal(menu.entry)
            }
            onDownload={() => doDownload(menu.entry)}
            onUpload={() => doUpload(menu.entry)}
            onRename={() => void renameRemote(menu.entry)}
            onDelete={() => void deleteRemoteEntry(menu.entry)}
            onProps={() => setPermEdit(menu.entry)}
          />
        )}

        {permEdit && (
          <PermissionsModal
            entry={permEdit}
            onClose={() => setPermEdit(null)}
            onApply={(mode) => {
              void applyChmod(permEdit, mode);
              setPermEdit(null);
            }}
          />
        )}

        {showSearch && remote && (
          <SearchModal
            hostId={hostId}
            root={remote.cwd}
            onClose={() => setShowSearch(false)}
            onNavigate={(path, isDir) => {
              const target = isDir ? path : joinPosix(path, "..");
              setRemoteSel(null);
              void loadRemote(target);
              setShowSearch(false);
            }}
          />
        )}

        {preview && (
          <PreviewModal
            name={preview.name}
            content={preview.content}
            imageUrl={preview.imageUrl}
            editable={preview.editable}
            onSave={
              preview.editable && preview.path
                ? async (next) => {
                    if (preview.isLocal) {
                      await invoke("local_write_text", {
                        path: preview.path,
                        content: next,
                      });
                    } else {
                      await invoke("sftp_write_text", {
                        hostId: preview.hostId,
                        path: preview.path,
                        content: next,
                      });
                    }
                  }
                : undefined
            }
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </div>
  );
}

function ContextMenu({
  x,
  y,
  side,
  entry,
  onDismiss,
  onPreview,
  onDownload,
  onUpload,
  onRename,
  onDelete,
  onProps,
}: {
  x: number;
  y: number;
  side: "local" | "remote";
  entry: FileEntry;
  onDismiss: () => void;
  onPreview: () => void;
  onDownload: () => void;
  onUpload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onProps: () => void;
}) {
  const t = useT(STR);
  useEffect(() => {
    const close = () => onDismiss();
    const t = setTimeout(() => {
      window.addEventListener("mousedown", close);
      window.addEventListener("keydown", close);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onDismiss]);

  const items: Array<{ label: string; action: () => void; disabled?: boolean }> = [];
  if (side === "remote") {
    items.push({ label: t.ctxPreview, action: onPreview, disabled: entry.is_dir });
    items.push({ label: t.ctxDownload, action: onDownload, disabled: entry.is_dir });
    items.push({ label: t.ctxRename, action: onRename });
    items.push({ label: t.ctxProps, action: onProps });
    items.push({ label: t.ctxDelete, action: onDelete });
  } else {
    items.push({ label: t.ctxPreview, action: onPreview, disabled: entry.is_dir });
    items.push({ label: t.ctxUpload, action: onUpload, disabled: entry.is_dir });
  }

  const mx = Math.min(x, window.innerWidth - 180);
  const my = Math.min(y, window.innerHeight - 160);
  return (
    <div
      style={{
        position: "fixed",
        left: mx,
        top: my,
        width: 160,
        background: "#26262d",
        border: "1px solid #111",
        borderRadius: 4,
        boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
        padding: "4px 0",
        zIndex: 1100,
        fontSize: 12,
      }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          disabled={it.disabled}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (!it.disabled) {
              it.action();
              onDismiss();
            }
          }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "6px 12px",
            background: "transparent",
            border: "none",
            color: it.disabled ? "#666" : "#dcdcdc",
            cursor: it.disabled ? "not-allowed" : "pointer",
            fontSize: 12,
          }}
          onMouseEnter={(e) => {
            if (!it.disabled)
              (e.currentTarget as HTMLButtonElement).style.background = "#094771";
          }}
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
          }
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function PreviewModal({
  name,
  content,
  imageUrl,
  editable,
  onSave,
  onClose,
}: {
  name: string;
  content: string;
  imageUrl?: string;
  editable?: boolean;
  onSave?: (next: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT(STR);
  const canEdit = !!editable && !imageUrl && !!onSave;
  const [draft, setDraft] = useState(content);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errMsg, setErrMsg] = useState("");
  const dirty = canEdit && draft !== content;

  const save = useCallback(async () => {
    if (!onSave || status === "saving") return;
    setStatus("saving");
    try {
      await onSave(draft);
      setStatus("saved");
    } catch (e) {
      setErrMsg(String(e));
      setStatus("error");
    }
  }, [onSave, draft, status]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // ⌘S / Ctrl-S 로 저장.
          if (canEdit && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            void save();
          }
        }}
        style={{
          width: "70vw",
          height: "75vh",
          background: "#1e1e24",
          border: "1px solid #333",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 14px",
            borderBottom: "1px solid #2a2a30",
            background: "#23232a",
            color: "#e6e6e6",
          }}
        >
          <strong style={{ fontSize: 13 }}>
            {imageUrl ? "🖼" : canEdit ? "✏️" : "📄"} {name}
            {dirty && <span style={{ color: "#e0b050" }}> ●</span>}
          </strong>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {canEdit && (
              <>
                {status === "saved" && !dirty && (
                  <span style={{ color: "#7ed98a", fontSize: 12 }}>{t.saved}</span>
                )}
                {status === "error" && (
                  <span style={{ color: "#e06c6c", fontSize: 12 }}>
                    {t.saveErr}: {errMsg}
                  </span>
                )}
                <button
                  onClick={() => void save()}
                  disabled={!dirty || status === "saving"}
                  style={{
                    background: dirty ? "#2e6aa3" : "#33333a",
                    border: "1px solid #3a6ea5",
                    color: dirty ? "#fff" : "#888",
                    borderRadius: 4,
                    padding: "3px 12px",
                    cursor: dirty ? "pointer" : "default",
                    fontSize: 12,
                  }}
                >
                  💾 {t.save}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              style={{ background: "transparent", border: "none", color: "#ccc", cursor: "pointer", fontSize: 15 }}
            >
              ×
            </button>
          </div>
        </header>
        {imageUrl ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              padding: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "auto",
              background:
                "repeating-conic-gradient(#2a2a30 0% 25%, #23232a 0% 50%) 50% / 24px 24px",
            }}
          >
            <img
              src={imageUrl}
              alt={name}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          </div>
        ) : canEdit ? (
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            spellCheck={false}
            autoFocus
            style={{
              flex: 1,
              margin: 0,
              padding: 14,
              border: "none",
              outline: "none",
              resize: "none",
              background: "#15151a",
              fontFamily: "Menlo, Consolas, monospace",
              fontSize: 12,
              color: "#dcdcdc",
              lineHeight: 1.5,
            }}
          />
        ) : (
          <pre
            style={{
              flex: 1,
              margin: 0,
              padding: 14,
              overflow: "auto",
              fontFamily: "Menlo, Consolas, monospace",
              fontSize: 12,
              color: "#dcdcdc",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {content || t.emptyFile}
          </pre>
        )}
        {!imageUrl && (
          <div style={{ padding: "4px 14px", fontSize: 10, color: "#789", borderTop: "1px solid #2a2a30" }}>
            {canEdit ? t.editFooter : t.previewFooter}
          </div>
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  listing,
  busy,
  selected,
  onSelect,
  onNavigate,
  onContextMenu,
  onItemMouseDown,
  onFileActivate,
  dragging,
  joinPath,
}: {
  title: string;
  listing: Listing | null;
  busy?: boolean;
  selected: FileEntry | null;
  onSelect: (e: FileEntry) => void;
  onNavigate: (path: string) => void;
  onContextMenu: (e: FileEntry, x: number, y: number) => void;
  onItemMouseDown: (e: FileEntry, ev: React.MouseEvent) => void;
  /** 파일(비-디렉토리) 더블클릭 시 호출 (미리보기). 없으면 동작 안 함. */
  onFileActivate?: (e: FileEntry) => void;
  dragging: boolean;
  joinPath: (cwd: string, name: string) => string;
}) {
  const t = useT(STR);
  const entries = listing
    ? [...listing.entries].sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid #2a2a30",
          color: "#9aa",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 600, color: "#ddd", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <span
          style={{
            flex: 1,
            color: "#789",
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={listing?.cwd}
        >
          {listing?.cwd ?? "…"}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {busy && <div style={{ padding: 16, color: "#789" }}>{t.loading}</div>}
        {listing && (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <thead>
              <tr style={{ color: "#789", fontSize: 11 }}>
                <th style={thStyle}>{t.colName}</th>
                <th style={{ ...thStyle, width: 80, textAlign: "right" }}>{t.colSize}</th>
                <th style={{ ...thStyle, width: 150 }}>{t.colModified}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                onDoubleClick={() => onNavigate(joinPath(listing.cwd, ".."))}
                style={{ cursor: "pointer" }}
              >
                <td style={tdStyle}>📁 ..</td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
              </tr>
              {entries.map((e: FileEntry) => {
                const sel = selected?.name === e.name;
                return (
                  <tr
                    key={e.name}
                    onClick={() => onSelect(e)}
                    onMouseDown={(ev) => onItemMouseDown(e, ev)}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      onSelect(e);
                      onContextMenu(e, ev.clientX, ev.clientY);
                    }}
                    onDoubleClick={() =>
                      e.is_dir
                        ? onNavigate(joinPath(listing.cwd, e.name))
                        : onFileActivate?.(e)
                    }
                    style={{
                      cursor: e.is_dir ? "pointer" : "default",
                      background: sel ? "#094771" : "transparent",
                      color: sel ? "#fff" : "#e6e6e6",
                    }}
                    onMouseEnter={(ev) => {
                      // 드래그 중에는 지나가는 행에 hover 강조를 칠하지 않는다(선택처럼 보임).
                      if (!sel && !dragging)
                        (ev.currentTarget as HTMLTableRowElement).style.background =
                          "#26262e";
                    }}
                    onMouseLeave={(ev) => {
                      if (!sel)
                        (ev.currentTarget as HTMLTableRowElement).style.background =
                          "transparent";
                    }}
                  >
                    <td style={tdStyle}>
                      {e.is_dir ? "📁" : "📄"} {e.name}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: sel ? "#cde" : "#9aa" }}>
                      {e.is_dir ? "" : fmtSize(e.size)}
                    </td>
                    <td style={{ ...tdStyle, color: sel ? "#cde" : "#789" }}>
                      {fmtDate(e.modified)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PermissionsModal({
  entry,
  onClose,
  onApply,
}: {
  entry: FileEntry;
  onClose: () => void;
  onApply: (mode: number) => void;
}) {
  const t = useT(STR);
  const init = ((entry.permissions ?? 0o644) & 0o777) >>> 0;
  const [mode, setMode] = useState(init);
  const groups: Array<{ label: string; shift: number }> = [
    { label: t.owner, shift: 6 },
    { label: t.group, shift: 3 },
    { label: t.other, shift: 0 },
  ];
  const bits: Array<{ label: string; bit: number }> = [
    { label: t.read, bit: 4 },
    { label: t.write, bit: 2 },
    { label: t.execute, bit: 1 },
  ];
  const has = (shift: number, bit: number) => (mode & (bit << shift)) !== 0;
  const toggle = (shift: number, bit: number) => setMode((m) => m ^ (bit << shift));
  const octal = (mode & 0o777).toString(8).padStart(3, "0");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          background: "#26262d",
          border: "1px solid #333",
          borderRadius: 6,
          color: "#e6e6e6",
          padding: 18,
          fontSize: 13,
        }}
      >
        <strong style={{ fontSize: 14 }}>{t.propsTitle(entry.name)}</strong>
        <div style={{ fontSize: 11, color: "#789", margin: "6px 0 14px" }}>
          {entry.is_dir ? t.directory : `${fmtSize(entry.size)}`} · {t.octal}{" "}
          <code style={{ color: "#9cf" }}>{octal}</code>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#9aa", fontSize: 11 }}>
              <th style={{ textAlign: "left", padding: 4 }} />
              {bits.map((b) => (
                <th key={b.bit} style={{ padding: 4 }}>{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.shift}>
                <td style={{ padding: 4, color: "#ccc" }}>{g.label}</td>
                {bits.map((b) => (
                  <td key={b.bit} style={{ textAlign: "center", padding: 4 }}>
                    <input
                      type="checkbox"
                      checked={has(g.shift, b.bit)}
                      onChange={() => toggle(g.shift, b.bit)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={toolBtnStyle}>{t.cancel}</button>
          <button
            onClick={() => onApply(mode & 0o777)}
            style={{ ...toolBtnStyle, background: "#0a5380", borderColor: "#4a9eff", color: "#fff" }}
          >
            {t.apply(octal)}
          </button>
        </div>
      </div>
    </div>
  );
}

function TransferQueue({
  transfers,
  onClear,
}: {
  transfers: TransferItem[];
  onClear: () => void;
}) {
  const t = useT(STR);
  const active = transfers.filter((tr) => tr.status === "active").length;
  const finished = transfers.length - active;
  return (
    <div
      style={{
        borderTop: "1px solid #2a2a30",
        background: "#181820",
        maxHeight: 160,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 12px",
          fontSize: 11,
          color: "#9aa",
        }}
      >
        <span>
          {t.transferQueue(active, finished)}
        </span>
        {finished > 0 && (
          <button
            onClick={onClear}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid #444",
              color: "#bbb",
              borderRadius: 3,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {t.clearFinished}
          </button>
        )}
      </div>
      <div style={{ overflowY: "auto", padding: "0 12px 8px" }}>
        {transfers.map((tr) => {
          const pct = tr.total > 0 ? Math.round((tr.transferred / tr.total) * 100) : 0;
          return (
            <div key={tr.id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", fontSize: 11, color: "#ccc", gap: 8 }}>
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tr.label}
                </span>
                <span
                  style={{
                    color:
                      tr.status === "done"
                        ? "#5ad27a"
                        : tr.status === "error"
                          ? "#ff8c8c"
                          : "#789",
                  }}
                >
                  {tr.status === "done"
                    ? t.done
                    : tr.status === "error"
                      ? t.failed
                      : `${pct}%`}
                </span>
              </div>
              {tr.status === "active" && (
                <div
                  style={{
                    height: 3,
                    background: "#2a2a30",
                    borderRadius: 2,
                    overflow: "hidden",
                    marginTop: 2,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: "#4a9eff",
                      transition: "width 0.1s",
                    }}
                  />
                </div>
              )}
              {tr.status === "error" && tr.error && (
                <div style={{ fontSize: 10, color: "#c88" }}>{tr.error}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SearchModal({
  hostId,
  root,
  onClose,
  onNavigate,
}: {
  hostId: string;
  root: string;
  onClose: () => void;
  onNavigate: (path: string, isDir: boolean) => void;
}) {
  const t = useT(STR);
  const [query, setQuery] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await invoke<SearchHit[]>("sftp_search", {
        hostId,
        root,
        query: query.trim(),
        recursive,
      });
      setHits(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "60vw",
          height: "70vh",
          background: "#1e1e24",
          border: "1px solid #333",
          borderRadius: 8,
          color: "#e6e6e6",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header style={{ padding: "10px 14px", borderBottom: "1px solid #2a2a30", background: "#23232a" }}>
          <strong style={{ fontSize: 13 }}>{t.remoteSearch}</strong>
          <span style={{ fontSize: 11, color: "#789", marginLeft: 8 }}>{t.underRoot(root)}</span>
        </header>
        <div style={{ display: "flex", gap: 6, padding: 10, alignItems: "center" }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
            placeholder={t.searchPlaceholder}
            style={{
              flex: 1,
              background: "#101015",
              border: "1px solid #444",
              color: "#fff",
              borderRadius: 4,
              padding: "6px 8px",
              fontSize: 12,
            }}
          />
          <label style={{ fontSize: 11, color: "#9aa", display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
            />
            {t.includeSub}
          </label>
          <button onClick={() => void run()} disabled={busy || !query.trim()} style={toolBtnStyle}>
            {busy ? t.searching : t.search}
          </button>
        </div>
        {err && <div style={{ padding: "0 14px 6px", color: "#fdd", fontSize: 11 }}>{err}</div>}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
          {hits === null && (
            <div style={{ color: "#789", textAlign: "center", padding: 24, fontSize: 12 }}>
              {t.enterQuery}
            </div>
          )}
          {hits !== null && hits.length === 0 && (
            <div style={{ color: "#789", textAlign: "center", padding: 24, fontSize: 12 }}>
              {t.noResults}
            </div>
          )}
          {hits?.map((h) => (
            <div
              key={h.path}
              onDoubleClick={() => onNavigate(h.path, h.is_dir)}
              title={`${t.openLocation}\n${h.path}`}
              style={{
                display: "flex",
                gap: 8,
                padding: "5px 10px",
                cursor: "pointer",
                borderRadius: 3,
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLDivElement).style.background = "#26262e")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLDivElement).style.background = "transparent")
              }
            >
              <span>{h.is_dir ? "📁" : "📄"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12 }}>{h.name}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#789",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.path}
                </div>
              </span>
            </div>
          ))}
        </div>
        {hits !== null && hits.length >= 500 && (
          <div style={{ padding: "4px 14px", fontSize: 10, color: "#fa8", borderTop: "1px solid #2a2a30" }}>
            {t.truncated}
          </div>
        )}
      </div>
    </div>
  );
}

const toolBtnStyle: React.CSSProperties = {
  background: "#2a2a35",
  color: "#ddd",
  border: "1px solid #444",
  borderRadius: 4,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 12,
};

function arrowBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    width: 38,
    height: 38,
    borderRadius: 6,
    border: `1px solid ${enabled ? "#4a9eff" : "#333"}`,
    background: enabled ? "#0a5380" : "#20202a",
    color: enabled ? "#fff" : "#555",
    fontSize: 18,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "4px 10px",
  position: "sticky",
  top: 0,
  background: "#1e1e24",
  borderBottom: "1px solid #2a2a30",
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: "4px 10px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 0,
};
