/**
 * 왼쪽 패널의 "파일" 탭 (#166, 화면 기획서 SC-01·SC-03·SC-04·SC-08).
 *
 * - 활성 탭의 호스트(로컬 또는 SSH)를 따라간다. 호스트마다 보던 폴더·펼침 상태를 기억한다.
 * - 클릭 = 선택(⌘/Shift로 여러 개), 두 번 클릭·Enter = 편집 탭으로 열기, 폴더는 클릭으로 펼침.
 * - 하단: 업로드(충돌 창) · 다운로드(기본 다운로드 폴더) · 새 파일 · 새 폴더 · 양쪽 보기.
 * - Finder에서 이 패널에 끌어 놓으면 현재 폴더(선택한 폴더)로 업로드한다.
 * - 삭제는 개수를 보여 주고 확인한다 — 서버에는 휴지통이 없다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { LangDict, useT } from "../i18n";
import { isMacOS } from "../platform";
import { FileEntry, Listing } from "../types";
import {
  displayName,
  hostColor,
  joinPath,
  parentPath,
  shellQuote,
  withSftp,
} from "../fileDocs";
import { downloadRemote, newTransferId, uniqueName } from "../downloads";
import { showToast } from "../toastBus";
import { onCommandDone } from "../commandBus";
import { ConflictModal, ConflictResolution } from "./FileBrowser";

type S = {
  noTarget: string;
  local: string;
  refresh: string;
  toTerminal: string;
  toTerminalUnknown: string;
  toTerminalTip: string;
  filter: string;
  upload: string;
  download: string;
  newFile: string;
  newFolder: string;
  bothSides: string;
  open: string;
  reveal: string;
  revealOther: string;
  rename: string;
  del: string;
  copyPath: string;
  empty: string;
  loading: string;
  retry: string;
  nameLabel: string;
  ok: string;
  cancel: string;
  invalidName: string;
  deleteTitle: (n: number) => string;
  deleteCounts: (files: number, dirs: number, more: boolean) => string;
  deleteRemote: string;
  deleteLocal: string;
  deleteBtn: string;
  downloaded: (name: string) => string;
  uploaded: (n: number, dir: string) => string;
  failed: (name: string, err: string) => string;
  pathCopied: string;
  dropHere: (dir: string) => string;
  noDownloadLocal: string;
};

const STR: LangDict<S> = {
  en: {
    noTarget: "Open a server or local tab, and its files show up here.",
    local: "Local",
    refresh: "Refresh",
    toTerminal: "⌂ Working folder",
    toTerminalUnknown: "Couldn't find the terminal's working folder (over SSH only Linux servers can be looked up), so the home folder is shown.",
    toTerminalTip: "Go to the folder this tab is working in (tmux pane, running program or shell) and follow it again",
    filter: "Filter names",
    upload: "Upload",
    download: "Download",
    newFile: "New file",
    newFolder: "New folder",
    bothSides: "Both sides",
    open: "Open",
    reveal: "Show in Finder",
    revealOther: "Show in folder",
    rename: "Rename",
    del: "Delete",
    copyPath: "Copy path",
    empty: "Empty — drop files here to upload",
    loading: "Loading…",
    retry: "Try again",
    nameLabel: "Name",
    ok: "OK",
    cancel: "Cancel",
    invalidName: "That name can't be used.",
    deleteTitle: (n) => `Permanently delete ${n} item${n === 1 ? "" : "s"}?`,
    deleteCounts: (f, d, more) => `Includes ${d} folder${d === 1 ? "" : "s"} and ${f} file${f === 1 ? "" : "s"}${more ? " or more" : ""}.`,
    deleteRemote: "The server has no trash — this can't be undone.",
    deleteLocal: "This doesn't go to the Trash — it can't be undone.",
    deleteBtn: "Delete permanently",
    downloaded: (n) => `Downloaded ${n}`,
    uploaded: (n, dir) => `Uploaded ${n} item${n === 1 ? "" : "s"} to ${dir}`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "Path copied",
    dropHere: (d) => `Drop to upload to ${d}`,
    noDownloadLocal: "Local files are already on this computer.",
  },
  ko: {
    noTarget: "서버나 로컬 탭을 열면 그 파일이 여기에 보입니다.",
    local: "로컬",
    refresh: "새로고침",
    toTerminal: "⌂ 작업 폴더",
    toTerminalUnknown: "터미널의 작업 폴더를 찾지 못해 홈 폴더를 보여 줍니다(SSH는 Linux 서버만 조회할 수 있음).",
    toTerminalTip: "이 탭이 작업 중인 폴더(tmux 창·실행 중 프로그램·셸)로 가고, 다시 터미널을 따라갑니다",
    filter: "이름으로 찾기",
    upload: "업로드",
    download: "다운로드",
    newFile: "새 파일",
    newFolder: "새 폴더",
    bothSides: "양쪽 보기",
    open: "열기",
    reveal: "Finder에서 보기",
    revealOther: "폴더에서 보기",
    rename: "이름 바꾸기",
    del: "삭제",
    copyPath: "경로 복사",
    empty: "비어 있음 — 파일을 끌어 놓으면 올라갑니다",
    loading: "불러오는 중…",
    retry: "다시 시도",
    nameLabel: "이름",
    ok: "확인",
    cancel: "취소",
    invalidName: "사용할 수 없는 이름입니다.",
    deleteTitle: (n) => `${n}개 항목을 영구 삭제할까요?`,
    deleteCounts: (f, d, more) => `폴더 ${d}개 · 파일 ${f}개${more ? " 이상" : ""} 포함.`,
    deleteRemote: "서버에는 휴지통이 없어 되돌릴 수 없습니다.",
    deleteLocal: "휴지통으로 가지 않고 바로 삭제되어 되돌릴 수 없습니다.",
    deleteBtn: "영구 삭제",
    downloaded: (n) => `${n} 다운로드 완료`,
    uploaded: (n, dir) => `${dir}에 ${n}개 업로드 완료`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "경로를 복사했습니다",
    dropHere: (d) => `놓으면 ${d}에 업로드`,
    noDownloadLocal: "로컬 파일은 이미 이 컴퓨터에 있습니다.",
  },
  es: {
    noTarget: "Abre una pestaña de servidor o local y sus archivos aparecerán aquí.",
    local: "Local",
    refresh: "Actualizar",
    toTerminal: "⌂ Carpeta de trabajo",
    toTerminalUnknown: "No se encontró la carpeta de trabajo del terminal (por SSH solo se pueden consultar servidores Linux), así que se muestra la carpeta personal.",
    toTerminalTip: "Ir a la carpeta en la que trabaja esta pestaña (panel de tmux, programa en ejecución o shell) y volver a seguirla",
    filter: "Filtrar por nombre",
    upload: "Subir",
    download: "Descargar",
    newFile: "Nuevo archivo",
    newFolder: "Nueva carpeta",
    bothSides: "Ambos lados",
    open: "Abrir",
    reveal: "Mostrar en Finder",
    revealOther: "Mostrar en la carpeta",
    rename: "Renombrar",
    del: "Eliminar",
    copyPath: "Copiar ruta",
    empty: "Vacío: suelta archivos aquí para subirlos",
    loading: "Cargando…",
    retry: "Reintentar",
    nameLabel: "Nombre",
    ok: "Aceptar",
    cancel: "Cancelar",
    invalidName: "Ese nombre no se puede usar.",
    deleteTitle: (n) => `¿Eliminar permanentemente ${n} elemento(s)?`,
    deleteCounts: (f, d, more) => `Incluye ${d} carpeta(s) y ${f} archivo(s)${more ? " o más" : ""}.`,
    deleteRemote: "El servidor no tiene papelera: no se puede deshacer.",
    deleteLocal: "No va a la papelera: no se puede deshacer.",
    deleteBtn: "Eliminar permanentemente",
    downloaded: (n) => `${n} descargado`,
    uploaded: (n, dir) => `${n} elemento(s) subido(s) a ${dir}`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "Ruta copiada",
    dropHere: (d) => `Suelta para subir a ${d}`,
    noDownloadLocal: "Los archivos locales ya están en este equipo.",
  },
  zh: {
    noTarget: "打开服务器或本地标签页后，其文件会显示在这里。",
    local: "本地",
    refresh: "刷新",
    toTerminal: "⌂ 工作目录",
    toTerminalUnknown: "未找到终端的工作目录（通过 SSH 仅能查询 Linux 服务器），因此显示主目录。",
    toTerminalTip: "转到此标签页正在使用的目录（tmux 窗格、运行中的程序或 shell），并重新跟随终端",
    filter: "按名称筛选",
    upload: "上传",
    download: "下载",
    newFile: "新建文件",
    newFolder: "新建文件夹",
    bothSides: "双栏视图",
    open: "打开",
    reveal: "在访达中显示",
    revealOther: "在文件夹中显示",
    rename: "重命名",
    del: "删除",
    copyPath: "复制路径",
    empty: "空 — 将文件拖到此处即可上传",
    loading: "正在加载…",
    retry: "重试",
    nameLabel: "名称",
    ok: "确定",
    cancel: "取消",
    invalidName: "无法使用该名称。",
    deleteTitle: (n) => `永久删除 ${n} 个项目？`,
    deleteCounts: (f, d, more) => `包含 ${d} 个文件夹和 ${f} 个文件${more ? "以上" : ""}。`,
    deleteRemote: "服务器没有回收站，无法撤销。",
    deleteLocal: "不会进入废纸篓，无法撤销。",
    deleteBtn: "永久删除",
    downloaded: (n) => `已下载 ${n}`,
    uploaded: (n, dir) => `已上传 ${n} 个项目到 ${dir}`,
    failed: (n, e) => `${n}：${e}`,
    pathCopied: "已复制路径",
    dropHere: (d) => `松开即可上传到 ${d}`,
    noDownloadLocal: "本地文件已在这台电脑上。",
  },
  ja: {
    noTarget: "サーバーまたはローカルのタブを開くと、そのファイルがここに表示されます。",
    local: "ローカル",
    refresh: "更新",
    toTerminal: "⌂ 作業フォルダー",
    toTerminalUnknown: "ターミナルの作業フォルダーが見つからないため、ホームフォルダーを表示しています（SSH では Linux サーバーのみ照会できます）。",
    toTerminalTip: "このタブの作業フォルダー（tmux ペイン・実行中のプログラム・シェル）へ移動し、再びターミナルに追従します",
    filter: "名前で絞り込み",
    upload: "アップロード",
    download: "ダウンロード",
    newFile: "新規ファイル",
    newFolder: "新規フォルダー",
    bothSides: "両側表示",
    open: "開く",
    reveal: "Finder で表示",
    revealOther: "フォルダーで表示",
    rename: "名前を変更",
    del: "削除",
    copyPath: "パスをコピー",
    empty: "空です — ファイルをドロップするとアップロードします",
    loading: "読み込み中…",
    retry: "再試行",
    nameLabel: "名前",
    ok: "OK",
    cancel: "キャンセル",
    invalidName: "その名前は使えません。",
    deleteTitle: (n) => `${n} 個の項目を完全に削除しますか？`,
    deleteCounts: (f, d, more) => `フォルダー ${d} 個・ファイル ${f} 個${more ? "以上" : ""}を含みます。`,
    deleteRemote: "サーバーにはゴミ箱がないため、元に戻せません。",
    deleteLocal: "ゴミ箱に入らず、元に戻せません。",
    deleteBtn: "完全に削除",
    downloaded: (n) => `${n} をダウンロードしました`,
    uploaded: (n, dir) => `${dir} に ${n} 個アップロードしました`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "パスをコピーしました",
    dropHere: (d) => `ドロップして ${d} にアップロード`,
    noDownloadLocal: "ローカルファイルはすでにこのコンピューターにあります。",
  },
  ru: {
    noTarget: "Откройте вкладку сервера или локальную вкладку — её файлы появятся здесь.",
    local: "Локально",
    refresh: "Обновить",
    toTerminal: "⌂ Рабочая папка",
    toTerminalUnknown: "Не удалось определить рабочую папку терминала (по SSH — только на серверах Linux), поэтому показана домашняя папка.",
    toTerminalTip: "Перейти в папку, где работает эта вкладка (панель tmux, запущенная программа или оболочка), и снова следовать за терминалом",
    filter: "Фильтр по имени",
    upload: "Загрузить",
    download: "Скачать",
    newFile: "Новый файл",
    newFolder: "Новая папка",
    bothSides: "Две панели",
    open: "Открыть",
    reveal: "Показать в Finder",
    revealOther: "Показать в папке",
    rename: "Переименовать",
    del: "Удалить",
    copyPath: "Копировать путь",
    empty: "Пусто — перетащите файлы сюда для загрузки",
    loading: "Загрузка…",
    retry: "Повторить",
    nameLabel: "Имя",
    ok: "ОК",
    cancel: "Отмена",
    invalidName: "Это имя использовать нельзя.",
    deleteTitle: (n) => `Удалить навсегда элементов: ${n}?`,
    deleteCounts: (f, d, more) => `Папок: ${d}, файлов: ${f}${more ? " или больше" : ""}.`,
    deleteRemote: "На сервере нет корзины — отменить нельзя.",
    deleteLocal: "Не попадёт в корзину — отменить нельзя.",
    deleteBtn: "Удалить навсегда",
    downloaded: (n) => `Скачано: ${n}`,
    uploaded: (n, dir) => `Загружено в ${dir}: ${n}`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "Путь скопирован",
    dropHere: (d) => `Отпустите, чтобы загрузить в ${d}`,
    noDownloadLocal: "Локальные файлы уже на этом компьютере.",
  },
  fr: {
    noTarget: "Ouvrez un onglet serveur ou local : ses fichiers s'afficheront ici.",
    local: "Local",
    refresh: "Actualiser",
    toTerminal: "⌂ Dossier de travail",
    toTerminalUnknown: "Dossier de travail du terminal introuvable (en SSH, seuls les serveurs Linux peuvent être interrogés) : le dossier personnel est affiché.",
    toTerminalTip: "Aller au dossier où travaille cet onglet (volet tmux, programme en cours ou shell) et le suivre à nouveau",
    filter: "Filtrer par nom",
    upload: "Téléverser",
    download: "Télécharger",
    newFile: "Nouveau fichier",
    newFolder: "Nouveau dossier",
    bothSides: "Deux volets",
    open: "Ouvrir",
    reveal: "Afficher dans le Finder",
    revealOther: "Afficher dans le dossier",
    rename: "Renommer",
    del: "Supprimer",
    copyPath: "Copier le chemin",
    empty: "Vide — déposez des fichiers ici pour les téléverser",
    loading: "Chargement…",
    retry: "Réessayer",
    nameLabel: "Nom",
    ok: "OK",
    cancel: "Annuler",
    invalidName: "Ce nom n'est pas utilisable.",
    deleteTitle: (n) => `Supprimer définitivement ${n} élément(s) ?`,
    deleteCounts: (f, d, more) => `Comprend ${d} dossier(s) et ${f} fichier(s)${more ? " ou plus" : ""}.`,
    deleteRemote: "Le serveur n'a pas de corbeille : action irréversible.",
    deleteLocal: "Ne passe pas par la Corbeille : action irréversible.",
    deleteBtn: "Supprimer définitivement",
    downloaded: (n) => `${n} téléchargé`,
    uploaded: (n, dir) => `${n} élément(s) téléversé(s) dans ${dir}`,
    failed: (n, e) => `${n} : ${e}`,
    pathCopied: "Chemin copié",
    dropHere: (d) => `Déposez pour téléverser dans ${d}`,
    noDownloadLocal: "Les fichiers locaux sont déjà sur cet ordinateur.",
  },
  de: {
    noTarget: "Öffnen Sie einen Server- oder lokalen Tab, dann erscheinen hier seine Dateien.",
    local: "Lokal",
    refresh: "Aktualisieren",
    toTerminal: "⌂ Arbeitsordner",
    toTerminalUnknown: "Arbeitsordner des Terminals nicht gefunden (per SSH nur bei Linux-Servern möglich), daher wird der Benutzerordner angezeigt.",
    toTerminalTip: "Zum Ordner wechseln, in dem dieser Tab arbeitet (tmux-Bereich, laufendes Programm oder Shell), und ihm wieder folgen",
    filter: "Nach Namen filtern",
    upload: "Hochladen",
    download: "Herunterladen",
    newFile: "Neue Datei",
    newFolder: "Neuer Ordner",
    bothSides: "Beide Seiten",
    open: "Öffnen",
    reveal: "Im Finder zeigen",
    revealOther: "Im Ordner anzeigen",
    rename: "Umbenennen",
    del: "Löschen",
    copyPath: "Pfad kopieren",
    empty: "Leer – Dateien hier ablegen zum Hochladen",
    loading: "Wird geladen…",
    retry: "Erneut versuchen",
    nameLabel: "Name",
    ok: "OK",
    cancel: "Abbrechen",
    invalidName: "Dieser Name ist nicht zulässig.",
    deleteTitle: (n) => `${n} Element(e) endgültig löschen?`,
    deleteCounts: (f, d, more) => `Enthält ${d} Ordner und ${f} Datei(en)${more ? " oder mehr" : ""}.`,
    deleteRemote: "Der Server hat keinen Papierkorb – nicht rückgängig zu machen.",
    deleteLocal: "Landet nicht im Papierkorb – nicht rückgängig zu machen.",
    deleteBtn: "Endgültig löschen",
    downloaded: (n) => `${n} heruntergeladen`,
    uploaded: (n, dir) => `${n} Element(e) nach ${dir} hochgeladen`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "Pfad kopiert",
    dropHere: (d) => `Ablegen zum Hochladen nach ${d}`,
    noDownloadLocal: "Lokale Dateien sind bereits auf diesem Computer.",
  },
  vi: {
    noTarget: "Mở một tab máy chủ hoặc cục bộ, tệp của nó sẽ hiện ở đây.",
    local: "Cục bộ",
    refresh: "Làm mới",
    toTerminal: "⌂ Thư mục làm việc",
    toTerminalUnknown: "Không tìm thấy thư mục làm việc của terminal (qua SSH chỉ tra được máy chủ Linux) nên đang hiển thị thư mục chính.",
    toTerminalTip: "Đến thư mục tab này đang làm việc (ô tmux, chương trình đang chạy hoặc shell) và tiếp tục theo terminal",
    filter: "Lọc theo tên",
    upload: "Tải lên",
    download: "Tải xuống",
    newFile: "Tệp mới",
    newFolder: "Thư mục mới",
    bothSides: "Hai bên",
    open: "Mở",
    reveal: "Hiện trong Finder",
    revealOther: "Hiện trong thư mục",
    rename: "Đổi tên",
    del: "Xóa",
    copyPath: "Sao chép đường dẫn",
    empty: "Trống — thả tệp vào đây để tải lên",
    loading: "Đang tải…",
    retry: "Thử lại",
    nameLabel: "Tên",
    ok: "OK",
    cancel: "Hủy",
    invalidName: "Không thể dùng tên này.",
    deleteTitle: (n) => `Xóa vĩnh viễn ${n} mục?`,
    deleteCounts: (f, d, more) => `Gồm ${d} thư mục và ${f} tệp${more ? " trở lên" : ""}.`,
    deleteRemote: "Máy chủ không có thùng rác — không thể hoàn tác.",
    deleteLocal: "Không vào Thùng rác — không thể hoàn tác.",
    deleteBtn: "Xóa vĩnh viễn",
    downloaded: (n) => `Đã tải xuống ${n}`,
    uploaded: (n, dir) => `Đã tải ${n} mục lên ${dir}`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "Đã sao chép đường dẫn",
    dropHere: (d) => `Thả để tải lên ${d}`,
    noDownloadLocal: "Tệp cục bộ đã có trên máy này.",
  },
  id: {
    noTarget: "Buka tab server atau lokal, berkasnya akan tampil di sini.",
    local: "Lokal",
    refresh: "Muat ulang",
    toTerminal: "⌂ Folder kerja",
    toTerminalUnknown: "Folder kerja terminal tidak ditemukan (lewat SSH hanya server Linux yang bisa dicari), jadi folder beranda yang ditampilkan.",
    toTerminalTip: "Buka folder tempat tab ini bekerja (panel tmux, program yang berjalan, atau shell) dan ikuti lagi",
    filter: "Saring nama",
    upload: "Unggah",
    download: "Unduh",
    newFile: "Berkas baru",
    newFolder: "Folder baru",
    bothSides: "Dua sisi",
    open: "Buka",
    reveal: "Tampilkan di Finder",
    revealOther: "Tampilkan di folder",
    rename: "Ganti nama",
    del: "Hapus",
    copyPath: "Salin jalur",
    empty: "Kosong — jatuhkan berkas di sini untuk mengunggah",
    loading: "Memuat…",
    retry: "Coba lagi",
    nameLabel: "Nama",
    ok: "OK",
    cancel: "Batal",
    invalidName: "Nama itu tidak bisa dipakai.",
    deleteTitle: (n) => `Hapus permanen ${n} item?`,
    deleteCounts: (f, d, more) => `Termasuk ${d} folder dan ${f} berkas${more ? " atau lebih" : ""}.`,
    deleteRemote: "Server tidak punya tempat sampah — tidak bisa dibatalkan.",
    deleteLocal: "Tidak masuk Tempat Sampah — tidak bisa dibatalkan.",
    deleteBtn: "Hapus permanen",
    downloaded: (n) => `${n} terunduh`,
    uploaded: (n, dir) => `${n} item terunggah ke ${dir}`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "Jalur disalin",
    dropHere: (d) => `Jatuhkan untuk mengunggah ke ${d}`,
    noDownloadLocal: "Berkas lokal sudah ada di komputer ini.",
  },
  hi: {
    noTarget: "कोई सर्वर या स्थानीय टैब खोलें, उसकी फ़ाइलें यहाँ दिखेंगी।",
    local: "स्थानीय",
    refresh: "रीफ़्रेश",
    toTerminal: "⌂ कार्य फ़ोल्डर",
    toTerminalUnknown: "टर्मिनल का कार्य फ़ोल्डर नहीं मिला (SSH पर केवल Linux सर्वर देखे जा सकते हैं), इसलिए होम फ़ोल्डर दिखाया गया है।",
    toTerminalTip: "इस टैब के कार्य फ़ोल्डर (tmux पेन, चल रहा प्रोग्राम या शेल) पर जाएँ और फिर से टर्मिनल का अनुसरण करें",
    filter: "नाम से छाँटें",
    upload: "अपलोड",
    download: "डाउनलोड",
    newFile: "नई फ़ाइल",
    newFolder: "नया फ़ोल्डर",
    bothSides: "दोनों ओर",
    open: "खोलें",
    reveal: "Finder में दिखाएँ",
    revealOther: "फ़ोल्डर में दिखाएँ",
    rename: "नाम बदलें",
    del: "हटाएँ",
    copyPath: "पथ कॉपी करें",
    empty: "खाली — अपलोड करने के लिए फ़ाइलें यहाँ छोड़ें",
    loading: "लोड हो रहा है…",
    retry: "फिर से प्रयास करें",
    nameLabel: "नाम",
    ok: "ठीक है",
    cancel: "रद्द करें",
    invalidName: "यह नाम उपयोग नहीं किया जा सकता।",
    deleteTitle: (n) => `${n} आइटम स्थायी रूप से हटाएँ?`,
    deleteCounts: (f, d, more) => `${d} फ़ोल्डर और ${f} फ़ाइलें${more ? " या अधिक" : ""} शामिल।`,
    deleteRemote: "सर्वर पर रीसायकल बिन नहीं है — इसे पूर्ववत नहीं किया जा सकता।",
    deleteLocal: "यह ट्रैश में नहीं जाएगा — पूर्ववत नहीं किया जा सकता।",
    deleteBtn: "स्थायी रूप से हटाएँ",
    downloaded: (n) => `${n} डाउनलोड हुआ`,
    uploaded: (n, dir) => `${dir} में ${n} आइटम अपलोड हुए`,
    failed: (n, e) => `${n}: ${e}`,
    pathCopied: "पथ कॉपी हुआ",
    dropHere: (d) => `${d} में अपलोड करने के लिए छोड़ें`,
    noDownloadLocal: "स्थानीय फ़ाइलें पहले से इस कंप्यूटर पर हैं।",
  },
};

type Loaded = Listing | "loading" | { error: string };
type View = {
  root: string | null;
  /**
   * 사용자가 패널에서 직접 폴더를 옮겼는지(#168). 옮기지 않았으면 패널은 이 탭의 터미널 작업
   * 폴더를 따라가고(파일 탭을 열 때·탭을 바꿀 때·명령이 끝날 때), 옮겼으면 그 위치를 지킨다.
   * "⌂ 작업 폴더"를 누르면 다시 따라간다.
   */
  pinned: boolean;
  listings: Record<string, Loaded>;
  expanded: string[];
  selected: string[];
  anchor: string | null;
  error: string | null;
};
type Row = { path: string; entry: FileEntry; depth: number } | { path: string; depth: number; pseudo: "loading" | "error"; text?: string };

const EMPTY_VIEW: View = { root: null, pinned: false, listings: {}, expanded: [], selected: [], anchor: null, error: null };
const ACCENT = "#5b8def";

function sortEntries(es: FileEntry[]): FileEntry[] {
  return [...es].sort((a, b) =>
    a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

async function listDir(hostId: string | null, path: string | null): Promise<Listing> {
  if (!hostId) return invoke<Listing>("local_list_dir", { path });
  if (path === null) return invoke<Listing>("sftp_open", { hostId, path: null });
  return withSftp(hostId, () => invoke<Listing>("sftp_list", { hostId, path }));
}

function validName(n: string): boolean {
  const t = n.trim();
  return !!t && t !== "." && t !== ".." && !/[\\/]/.test(t);
}

/** 패널 루트 요소 — App이 OS 드롭 위치가 패널 위인지 판단하는 데 쓴다(터미널 드롭과 구분). */
let panelEl: HTMLElement | null = null;
export function isOverFilePanel(clientX: number, clientY: number): boolean {
  if (!panelEl || panelEl.offsetParent === null) return false;
  const r = panelEl.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

export function FilePanel({
  target,
  visible,
  hostLabel,
  activePaneId,
  onOpenFile,
  onOpenBothSides,
}: {
  /**
   * 보여 줄 대상(#168). 터미널 탭(패널)마다 key가 달라 트리·기준 폴더를 따로 기억한다.
   * resolveBase = 그 탭의 작업 폴더(tmux 창·실행 중 프로그램·셸), 모르면 null(홈).
   * null이면 탭이 없음. hostId null = 로컬.
   */
  target: { key: string; hostId: string | null; resolveBase: () => Promise<string | null> } | null;
  visible: boolean;
  hostLabel: (hostId: string) => string;
  activePaneId: string | null;
  onOpenFile: (hostId: string | null, path: string) => void;
  onOpenBothSides: (hostId: string, path: string) => void;
}) {
  const t = useT(STR);
  const key = target?.key ?? null;
  const hostId = target?.hostId ?? null;
  const [views, setViews] = useState<Record<string, View>>({});
  const view = (key && views[key]) || EMPTY_VIEW;
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; entry: FileEntry } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; value: string; onOk: (v: string) => Promise<void> } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ paths: string[]; files: number; dirs: number; more: boolean } | null>(null);
  const [conflict, setConflict] = useState<null | {
    entry: FileEntry;
    existing: FileEntry;
    destLabel: string;
    suggestion: string;
    taken: Set<string>;
    remaining: number;
    resolve: (r: ConflictResolution) => void;
  }>(null);
  const [transfers, setTransfers] = useState<Record<string, { label: string; done: number; total: number }>>({});
  const [dropHover, setDropHover] = useState(false);
  const [cwdKnown, setCwdKnown] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setView = useCallback(
    (k: string, f: (v: View) => View) => setViews((all) => ({ ...all, [k]: f(all[k] ?? EMPTY_VIEW) })),
    [],
  );

  const loadInto = useCallback(
    async (k: string, h: string | null, path: string) => {
      setView(k, (v) => ({ ...v, listings: { ...v.listings, [path]: "loading" } }));
      try {
        const l = await listDir(h, path);
        setView(k, (v) => ({ ...v, listings: { ...v.listings, [path]: l } }));
      } catch (e) {
        setView(k, (v) => ({ ...v, listings: { ...v.listings, [path]: { error: String(e) } } }));
      }
    },
    [setView],
  );

  const goTo = useCallback(
    async (path: string | null) => {
      if (!key) return;
      const k = key;
      setView(k, (v) => ({ ...v, error: null }));
      try {
        const l = await listDir(hostId, path);
        setView(k, () => ({ ...EMPTY_VIEW, pinned: true, root: l.cwd, listings: { [l.cwd]: l } }));
      } catch (e) {
        setView(k, (v) => ({ ...v, error: String(e) }));
      }
    },
    [key, hostId, setView],
  );

  /**
   * 이 탭의 터미널 작업 폴더를 찾아 연다(#168). 못 찾으면 홈. 찾았으면 true.
   * 이미 그 폴더를 보고 있으면 펼침·선택을 지킨 채 목록만 새로 읽는다.
   */
  const resolveRef = useRef(target?.resolveBase);
  resolveRef.current = target?.resolveBase;
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const syncToTerminal = useCallback(async (): Promise<boolean> => {
    if (!key) return false;
    const k = key;
    let base: string | null = null;
    try {
      base = (await resolveRef.current?.()) ?? null;
    } catch {
      base = null;
    }
    const open = async (path: string | null) => {
      const l = await listDir(hostId, path);
      setView(k, (v) =>
        v.root === l.cwd
          ? { ...v, pinned: false, error: null, listings: { ...v.listings, [l.cwd]: l } }
          : { ...EMPTY_VIEW, root: l.cwd, listings: { [l.cwd]: l } },
      );
    };
    try {
      await open(base);
      return !!base;
    } catch (e) {
      if (base) {
        try {
          await open(null);
        } catch (e2) {
          setView(k, (v) => ({ ...v, error: String(e2) }));
        }
        return false;
      }
      setView(k, (v) => ({ ...v, error: String(e) }));
      return false;
    }
  }, [key, hostId, setView]);

  const refresh = useCallback(() => {
    if (!key || !view.root) return;
    void loadInto(key, hostId, view.root);
    for (const p of view.expanded) void loadInto(key, hostId, p);
  }, [key, hostId, view.root, view.expanded, loadInto]);

  // 패널이 보일 때·탭을 바꿀 때·터미널 명령이 끝날 때(OSC 133): 직접 옮기지 않은 패널은 터미널
  // 작업 폴더를 따라가고, 옮긴 패널은 지금 폴더를 다시 읽기만 한다.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const syncRef = useRef(syncToTerminal);
  syncRef.current = syncToTerminal;
  const follow = useCallback(() => {
    const v = key ? viewsRef.current[key] : undefined;
    if (!v || !v.pinned) void syncRef.current();
    else refreshRef.current();
  }, [key]);
  useEffect(() => {
    if (visible && key) follow();
  }, [visible, key, follow]);
  useEffect(
    () =>
      onCommandDone((info) => {
        if (visible && info.paneId === activePaneId) follow();
      }),
    [visible, activePaneId, follow],
  );

  // 전송 진행.
  useEffect(() => {
    let un: (() => void) | undefined;
    void listen<{ transferId: string; transferred: number; total: number }>("sftp:progress", (e) => {
      setTransfers((tr) =>
        tr[e.payload.transferId]
          ? { ...tr, [e.payload.transferId]: { ...tr[e.payload.transferId], done: e.payload.transferred, total: e.payload.total } }
          : tr,
      );
    }).then((f) => (un = f));
    return () => un?.();
  }, []);

  // ---- 행 펼치기 ----
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (!view.root) return out;
    const f = filter.trim().toLowerCase();
    const walk = (dir: string, depth: number) => {
      const l = view.listings[dir];
      if (!l || l === "loading") {
        if (depth > 0) out.push({ path: dir + "\u0000loading", depth, pseudo: "loading" });
        return;
      }
      if ("error" in l) {
        out.push({ path: dir + "\u0000error", depth, pseudo: "error", text: l.error });
        return;
      }
      for (const e of sortEntries(l.entries)) {
        const p = joinPath(l.cwd, e.name);
        const open = e.is_dir && view.expanded.includes(p);
        if (!f || e.name.toLowerCase().includes(f) || open) out.push({ path: p, entry: e, depth });
        if (open) walk(p, depth + 1);
      }
    };
    walk(view.root, 0);
    return out;
  }, [view, filter]);
  const realRows = rows.filter((r): r is Extract<Row, { entry: FileEntry }> => "entry" in r);
  const entryOf = (p: string) => realRows.find((r) => r.path === p)?.entry;

  /** 새 항목·업로드가 들어갈 폴더: 선택한 폴더 하나 → 선택한 파일의 폴더 → 현재 폴더. */
  const currentDir = (): string | null => {
    if (view.selected.length === 1) {
      const p = view.selected[0];
      const e = entryOf(p);
      if (e) return e.is_dir ? p : parentPath(p);
    }
    return view.root;
  };

  const select = (path: string, ev: { meta: boolean; shift: boolean }) => {
    if (!key) return;
    setView(key, (v) => {
      if (ev.shift && v.anchor) {
        const a = realRows.findIndex((r) => r.path === v.anchor);
        const b = realRows.findIndex((r) => r.path === path);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          return { ...v, selected: realRows.slice(lo, hi + 1).map((r) => r.path) };
        }
      }
      if (ev.meta) {
        const has = v.selected.includes(path);
        return { ...v, selected: has ? v.selected.filter((x) => x !== path) : [...v.selected, path], anchor: path };
      }
      return { ...v, selected: [path], anchor: path };
    });
  };

  const toggleDir = (path: string, force?: boolean) => {
    if (!key) return;
    const open = view.expanded.includes(path);
    const next = force ?? !open;
    setView(key, (v) => ({
      ...v,
      expanded: next ? [...v.expanded.filter((x) => x !== path), path] : v.expanded.filter((x) => x !== path && !x.startsWith(path + "/")),
    }));
    if (next && !view.listings[path]) void loadInto(key, hostId, path);
  };

  const openPath = (path: string, e: FileEntry) => {
    if (e.is_dir) void goTo(path);
    else onOpenFile(hostId, path);
  };

  // ---- 작업 ----
  const reloadDir = (dir: string) => key && void loadInto(key, hostId, dir);

  const askName = (title: string, value: string, onOk: (v: string) => Promise<void>) =>
    setPrompt({ title, value, onOk });

  const doNew = (folder: boolean) => {
    const dir = currentDir();
    if (!dir) return;
    askName(folder ? t.newFolder : t.newFile, "", async (name) => {
      const p = joinPath(dir, name.trim());
      await withSftp(hostId, () => invoke(folder ? "file_mkdir" : "file_create", { hostId, path: p }));
      if (dir !== view.root && key) toggleDir(dir, true);
      reloadDir(dir);
      if (!folder) onOpenFile(hostId, p);
    });
  };

  const doRename = (path: string) => {
    const old = path.split(/[\\/]/).pop() ?? path;
    askName(t.rename, old, async (name) => {
      const to = joinPath(parentPath(path), name.trim());
      if (to === path) return;
      await withSftp(hostId, () => invoke("file_rename", { hostId, from: path, to }));
      reloadDir(parentPath(path));
    });
  };

  const doDeleteAsk = async (paths: string[]) => {
    let files = 0;
    let dirs = 0;
    let more = false;
    for (const p of paths) {
      try {
        const c = await withSftp(hostId, () =>
          invoke<{ files: number; dirs: number; truncated: boolean }>("file_count", { hostId, path: p }),
        );
        files += c.files;
        dirs += c.dirs;
        more ||= c.truncated;
      } catch (e) {
        showToast({ kind: "error", text: t.failed(p, String(e)) });
        return;
      }
    }
    setConfirmDel({ paths, files, dirs, more });
  };

  const doDelete = async (paths: string[]) => {
    setConfirmDel(null);
    const parents = new Set<string>();
    for (const p of paths) {
      try {
        await withSftp(hostId, () => invoke("file_delete", { hostId, path: p }));
      } catch (e) {
        showToast({ kind: "error", text: t.failed(p, String(e)) });
      }
      parents.add(parentPath(p));
    }
    if (key) setView(key, (v) => ({ ...v, selected: [] }));
    parents.forEach(reloadDir);
  };

  const copyPath = (p: string) => {
    void navigator.clipboard.writeText(shellQuote(p)).then(() => showToast({ kind: "info", text: t.pathCopied }, 1500));
  };

  const doDownload = async (paths: string[]) => {
    if (!hostId) {
      showToast({ kind: "info", text: t.noDownloadLocal });
      return;
    }
    for (const p of paths) {
      const name = p.split("/").pop() ?? p;
      try {
        const local = await downloadRemote(hostId, p, name, (id) =>
          setTransfers((tr) => ({ ...tr, [id]: { label: `↓ ${name}`, done: 0, total: 0 } })),
        );
        showToast({
          kind: "ok",
          text: t.downloaded(name),
          action: { label: isMacOS() ? t.reveal : t.revealOther, run: () => void invoke("reveal_in_file_manager", { path: local }) },
        });
      } catch (e) {
        showToast({ kind: "error", text: t.failed(name, String(e)) });
      } finally {
        setTransfers((tr) => Object.fromEntries(Object.entries(tr).filter(([, v]) => v.label !== `↓ ${name}`)));
      }
    }
  };

  /** 로컬 파일들을 dir로 올린다. 같은 이름은 충돌 창(새 이름이 기본)으로 묻는다. */
  const uploadPaths = async (localPaths: string[], dir: string) => {
    if (!key) return;
    let listing: Listing;
    try {
      listing = await listDir(hostId, dir);
    } catch (e) {
      showToast({ kind: "error", text: t.failed(dir, String(e)) });
      return;
    }
    const taken = new Set(listing.entries.map((e) => e.name));
    let bulk: ConflictResolution | null = null;
    let count = 0;
    for (let i = 0; i < localPaths.length; i++) {
      const src = localPaths[i];
      const name = src.split(/[\\/]/).pop() || src;
      let destName: string | null = name;
      if (taken.has(name)) {
        const existing = listing.entries.find((e) => e.name === name)!;
        const r: ConflictResolution =
          bulk ??
          (await new Promise<ConflictResolution>((resolve) =>
            setConflict({
              entry: { name, is_dir: false, size: 0 },
              existing,
              destLabel: dir,
              suggestion: uniqueName(name, taken),
              taken,
              remaining: localPaths.length - i - 1,
              resolve: (res) => {
                setConflict(null);
                resolve(res);
              },
            }),
          ));
        if (r.applyAll && !bulk) bulk = r;
        if (r.action === "cancel") break;
        if (r.action === "skip") continue;
        destName = r.action === "rename" ? (r.name && !taken.has(r.name) ? r.name : uniqueName(name, taken)) : name;
      }
      taken.add(destName);
      try {
        if (hostId) {
          const id = newTransferId();
          setTransfers((tr) => ({ ...tr, [id]: { label: `↑ ${destName}`, done: 0, total: 0 } }));
          try {
            await withSftp(hostId, () =>
              invoke("sftp_upload", { hostId, localPath: src, remoteDir: dir, transferId: id, destName }),
            );
          } finally {
            setTransfers((tr) => Object.fromEntries(Object.entries(tr).filter(([k]) => k !== id)));
          }
        } else {
          // 로컬은 복사(이동 아님). 같은 이름은 백엔드가 "이름 (1)"로 피한다.
          await invoke("local_copy_into", { srcPath: src, destDir: dir });
        }
        count++;
      } catch (e) {
        showToast({ kind: "error", text: t.failed(name, String(e)) });
      }
    }
    reloadDir(dir);
    if (count) showToast({ kind: "ok", text: t.uploaded(count, dir) });
  };

  const doUploadPick = async () => {
    const dir = currentDir();
    if (!dir) return;
    const picked = await openDialog({ multiple: true, directory: false });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    await uploadPaths(paths.map(String), dir);
  };

  // Finder에서 패널에 끌어 놓기 → 현재 폴더로 업로드(터미널 위 드롭은 App이 처리).
  const uploadRef = useRef(uploadPaths);
  uploadRef.current = uploadPaths;
  const dirRef = useRef(currentDir);
  dirRef.current = currentDir;
  useEffect(() => {
    panelEl = rootRef.current;
    let un: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "leave") {
          setDropHover(false);
          return;
        }
        const scale = window.devicePixelRatio || 1;
        const over = visible && isOverFilePanel(p.position.x / scale, p.position.y / scale);
        if (p.type === "enter" || p.type === "over") {
          setDropHover(over);
          return;
        }
        setDropHover(false);
        const dir = dirRef.current();
        if (over && dir) void uploadRef.current(p.paths, dir);
      })
      .then((f) => (un = f));
    return () => {
      un?.();
      if (panelEl === rootRef.current) panelEl = null;
    };
  }, [visible]);

  // ---- 키보드 ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (prompt || confirmDel || conflict) return;
    const mod = e.metaKey || e.ctrlKey;
    const sel = view.selected;
    const idx = realRows.findIndex((r) => r.path === (view.anchor ?? sel[0]));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, Math.min(realRows.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)));
      const r = realRows[n];
      if (r) select(r.path, { meta: false, shift: e.shiftKey });
      return;
    }
    const cur = idx >= 0 ? realRows[idx] : undefined;
    if (e.key === "ArrowRight" && cur?.entry.is_dir) {
      e.preventDefault();
      toggleDir(cur.path, true);
    } else if (e.key === "ArrowLeft" && cur) {
      e.preventDefault();
      if (cur.entry.is_dir && view.expanded.includes(cur.path)) toggleDir(cur.path, false);
      else {
        const parent = parentPath(cur.path);
        if (parent !== view.root && realRows.some((r) => r.path === parent)) select(parent, { meta: false, shift: false });
      }
    } else if (e.key === "Enter" && sel.length) {
      e.preventDefault();
      for (const p of sel) {
        const en = entryOf(p);
        if (en) openPath(p, en);
      }
    } else if (e.key === "F2" && sel.length === 1) {
      e.preventDefault();
      e.stopPropagation(); // 탭 이름 바꾸기(F2)보다 우선
      doRename(sel[0]);
    } else if ((e.key === "Delete" || (mod && e.key === "Backspace")) && sel.length) {
      e.preventDefault();
      void doDeleteAsk(sel);
    } else if (mod && e.altKey && (e.key === "c" || e.key === "ç" || e.code === "KeyC") && sel.length === 1) {
      e.preventDefault();
      copyPath(sel[0]);
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "d" && sel.length) {
      e.preventDefault();
      void doDownload(sel);
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "u") {
      e.preventDefault();
      void doUploadPick();
    }
  };

  // ---- 화면 ----
  if (!target) {
    return (
      <div ref={rootRef} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center", fontSize: 12, color: "#7a8290", lineHeight: 1.6 }}>
        {t.noTarget}
      </div>
    );
  }

  const color = hostColor(hostId);
  const label = hostId ? hostLabel(hostId) : t.local;
  const crumbs = view.root ? crumbsOf(view.root) : [];
  const activeTransfers = Object.entries(transfers);

  return (
    <div
      ref={rootRef}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", outline: dropHover ? `2px dashed ${ACCENT}` : "none", outlineOffset: -3 }}
    >
      {/* 서버 배지 + 경로(SC-01 ②) */}
      <div style={{ padding: "6px 10px 4px", display: "flex", flexDirection: "column", gap: 5, borderBottom: "1px solid #2a2a30" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, ...(color ? { background: color } : { border: "2px solid #8a8f98", boxSizing: "border-box" }) }} />
          <b style={{ color: "#e6e6e6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</b>
          <span style={{ flex: 1 }} />
          <IconBtn title={t.refresh} onClick={refresh}>↻</IconBtn>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, fontSize: 11, color: "#8a93a3" }}>
          {crumbs.map((c, i) => (
            <span key={c.path} style={{ display: "flex", gap: 2 }}>
              {i > 0 && <span>›</span>}
              <span onClick={() => void goTo(c.path)} style={{ cursor: "pointer", color: i === crumbs.length - 1 ? "#cfd6e0" : undefined }} title={c.path}>
                {displayName(c.label)}
              </span>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t.filter}
            spellCheck={false}
            style={{ flex: 1, minWidth: 0, height: 22, background: "#15151a", border: "1px solid #2f2f37", borderRadius: 4, color: "#ddd", fontSize: 11, padding: "0 6px" }}
          />
          <button
            title={cwdKnown ? t.toTerminalTip : t.toTerminalUnknown}
            onClick={async () => {
              const ok = await syncToTerminal();
              setCwdKnown(ok);
              if (!ok) showToast({ kind: "info", text: t.toTerminalUnknown }, 4000);
            }}
            style={{ height: 22, background: "#22222a", border: "1px solid #2f2f37", borderRadius: 4, color: "#cfd6e0", fontSize: 10, padding: "0 6px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {t.toTerminal}
          </button>
        </div>
      </div>

      {/* 트리 */}
      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          if (e.target === e.currentTarget && key) setView(key, (v) => ({ ...v, selected: [] }));
        }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "4px 4px", outline: "none" }}
      >
        {view.error ? (
          <div style={{ padding: 10, fontSize: 12, color: "#e08080", lineHeight: 1.5, wordBreak: "break-word" }}>
            {view.error}
            <div style={{ marginTop: 8 }}>
              <IconBtn onClick={() => void (view.pinned ? goTo(view.root) : syncToTerminal())}>{t.retry}</IconBtn>
            </div>
          </div>
        ) : !view.root ? (
          <div style={{ padding: 10, fontSize: 12, color: "#7a8290" }}>{t.loading}</div>
        ) : (
          <>
            {parentPath(view.root) !== view.root && (
              <TreeRow depth={0} isDir up name=".." selected={false} onClick={() => void goTo(parentPath(view.root!))} onDoubleClick={() => {}} />
            )}
            {rows.map((r) =>
              "entry" in r ? (
                <TreeRow
                  key={r.path}
                  depth={r.depth}
                  isDir={r.entry.is_dir}
                  open={view.expanded.includes(r.path)}
                  name={displayName(r.entry.name)}
                  selected={view.selected.includes(r.path)}
                  onClick={(ev) => {
                    select(r.path, { meta: ev.metaKey || ev.ctrlKey, shift: ev.shiftKey });
                    if (r.entry.is_dir && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) toggleDir(r.path);
                  }}
                  onDoubleClick={() => openPath(r.path, r.entry)}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    if (!view.selected.includes(r.path)) select(r.path, { meta: false, shift: false });
                    setMenu({ x: ev.clientX, y: ev.clientY, path: r.path, entry: r.entry });
                  }}
                />
              ) : (
                <div key={r.path} style={{ paddingLeft: 8 + r.depth * 12, fontSize: 11, color: r.pseudo === "error" ? "#e08080" : "#7a8290", height: 22, display: "flex", alignItems: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                  {r.pseudo === "loading" ? t.loading : r.text}
                </div>
              ),
            )}
            {rows.length === 0 && view.listings[view.root] && view.listings[view.root] !== "loading" && (
              <div style={{ margin: 8, padding: 12, border: "2px dashed #33333b", borderRadius: 8, fontSize: 11, color: "#7a8290", textAlign: "center" }}>
                {t.empty}
              </div>
            )}
          </>
        )}
      </div>

      {dropHover && view.root && (
        <div style={{ padding: "4px 10px", fontSize: 11, background: "#1b2a44", color: "#c9d8f2" }}>{t.dropHere(currentDir() ?? view.root)}</div>
      )}

      {/* 전송 표시줄(SC-01 ⑥) */}
      {activeTransfers.length > 0 && (
        <div style={{ padding: "3px 10px", fontSize: 11, background: "#1b2333", color: "#9db7e8", borderTop: "1px solid #2a2a30" }}>
          {activeTransfers.slice(0, 3).map(([id, tr]) => (
            <div key={id} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {tr.label} {tr.total ? `${Math.round((tr.done / tr.total) * 100)}%` : ""}
            </div>
          ))}
        </div>
      )}

      {/* 하단 동작줄(SC-01 ⑤) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "5px 6px", borderTop: "1px solid #2a2a30" }}>
        <BarBtn onClick={() => void doUploadPick()}>{t.upload}</BarBtn>
        <BarBtn disabled={!hostId || view.selected.length === 0} onClick={() => void doDownload(view.selected)}>
          {t.download}
          {view.selected.length > 1 ? ` (${view.selected.length})` : ""}
        </BarBtn>
        <BarBtn onClick={() => doNew(false)}>{t.newFile}</BarBtn>
        <BarBtn onClick={() => doNew(true)}>{t.newFolder}</BarBtn>
        {hostId && (
          <BarBtn onClick={() => onOpenBothSides(hostId, currentDir() ?? view.root ?? ".")}>{t.bothSides}</BarBtn>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {!menu.entry.is_dir && <MenuItem onClick={() => onOpenFile(hostId, menu.path)}>{t.open}</MenuItem>}
          {hostId ? (
            <MenuItem onClick={() => void doDownload(view.selected.length ? view.selected : [menu.path])}>{t.download}</MenuItem>
          ) : (
            <MenuItem onClick={() => void invoke("reveal_in_file_manager", { path: menu.path })}>{isMacOS() ? t.reveal : t.revealOther}</MenuItem>
          )}
          <MenuItem onClick={() => doRename(menu.path)}>{t.rename}</MenuItem>
          <MenuItem onClick={() => copyPath(menu.path)}>{t.copyPath}</MenuItem>
          <MenuItem onClick={() => doNew(false)}>{t.newFile}</MenuItem>
          <MenuItem onClick={() => doNew(true)}>{t.newFolder}</MenuItem>
          <MenuItem danger onClick={() => void doDeleteAsk(view.selected.length ? view.selected : [menu.path])}>{t.del}</MenuItem>
        </ContextMenu>
      )}

      {prompt && (
        <NamePrompt
          title={prompt.title}
          initial={prompt.value}
          label={t.nameLabel}
          ok={t.ok}
          cancel={t.cancel}
          invalid={t.invalidName}
          onCancel={() => setPrompt(null)}
          onOk={async (v) => {
            try {
              await prompt.onOk(v);
              setPrompt(null);
            } catch (e) {
              return String(e);
            }
            return null;
          }}
        />
      )}

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)}>
          <div style={{ fontWeight: 700, color: "#f08080" }}>{t.deleteTitle(confirmDel.paths.length)}</div>
          <div style={{ fontSize: 12, color: "#b8c0cc", lineHeight: 1.5, maxHeight: 120, overflowY: "auto", wordBreak: "break-all" }}>
            {confirmDel.paths.slice(0, 8).map((p) => (
              <div key={p}>{displayName(p)}</div>
            ))}
            {confirmDel.paths.length > 8 && <div>…</div>}
          </div>
          <div style={{ fontSize: 12, color: "#b8c0cc" }}>
            {t.deleteCounts(confirmDel.files, confirmDel.dirs, confirmDel.more)} {hostId ? t.deleteRemote : t.deleteLocal}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <ModalBtn autoFocus onClick={() => setConfirmDel(null)}>{t.cancel}</ModalBtn>
            <ModalBtn danger onClick={() => void doDelete(confirmDel.paths)}>{t.deleteBtn}</ModalBtn>
          </div>
        </Modal>
      )}

      {conflict && (
        <ConflictModal
          entry={conflict.entry}
          existing={conflict.existing}
          destLabel={conflict.destLabel}
          suggestion={conflict.suggestion}
          taken={conflict.taken}
          remaining={conflict.remaining}
          onResolve={conflict.resolve}
        />
      )}
    </div>
  );
}

function crumbsOf(root: string): { label: string; path: string }[] {
  const win = root.includes("\\") && !root.includes("/");
  const sep = win ? "\\" : "/";
  const parts = root.split(sep).filter(Boolean);
  const out: { label: string; path: string }[] = [];
  if (!win) out.push({ label: "/", path: "/" });
  let acc = win ? "" : "";
  parts.forEach((p, i) => {
    acc = win ? (i === 0 ? p + sep : acc + (acc.endsWith(sep) ? "" : sep) + p) : acc + sep + p;
    out.push({ label: p, path: acc });
  });
  return out;
}

function TreeRow({
  depth,
  isDir,
  up,
  open,
  name,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  depth: number;
  isDir: boolean;
  /** ".." (상위 폴더) 행 — 펼침 화살표 없음. */
  up?: boolean;
  open?: boolean;
  name: string;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={name}
      style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        gap: 5,
        paddingLeft: 4 + depth * 12,
        paddingRight: 4,
        fontSize: 12,
        borderRadius: 4,
        cursor: "default",
        userSelect: "none",
        background: selected ? "#26406b" : "transparent",
        color: selected ? "#ffffff" : "#d6dbe3",
      }}
    >
      <span style={{ width: 10, fontSize: 9, color: "#8a93a3", flexShrink: 0 }}>{isDir && !up ? (open ? "▾" : "▸") : ""}</span>
      <span style={{ flexShrink: 0, fontSize: 12, opacity: 0.85 }}>{up ? "↰" : isDir ? "📁" : "📄"}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </div>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{ background: "transparent", border: "1px solid #2f2f37", borderRadius: 4, color: "#b8c0cc", fontSize: 11, padding: "1px 6px", cursor: "pointer" }}>
      {children}
    </button>
  );
}

function BarBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ background: "#22222a", border: "1px solid #2f2f37", borderRadius: 4, color: disabled ? "#5d6470" : "#cfd6e0", fontSize: 11, padding: "3px 7px", cursor: disabled ? "default" : "pointer" }}
    >
      {children}
    </button>
  );
}

function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  return (
    <div
      style={{ position: "fixed", left: Math.min(x, window.innerWidth - 190), top: Math.min(y, window.innerHeight - 260), zIndex: 1300, minWidth: 170, background: "#25252c", border: "1px solid #3a3a44", borderRadius: 6, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
    >
      {children}
    </div>
  );
}

function MenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#33333c")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      style={{ padding: "5px 10px", fontSize: 12, borderRadius: 4, cursor: "default", color: danger ? "#f08080" : "#dfe3ea" }}
    >
      {children}
    </div>
  );
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1400 }}
    >
      <div onClick={(e) => e.stopPropagation()} role="dialog" style={{ width: 420, maxWidth: "90vw", background: "#23232a", border: "1px solid #3a3a44", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 10, color: "#e6e6e6" }}>
        {children}
      </div>
    </div>
  );
}

function ModalBtn({ onClick, danger, autoFocus, disabled, children }: { onClick: () => void; danger?: boolean; autoFocus?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      autoFocus={autoFocus}
      disabled={disabled}
      onClick={onClick}
      style={{ background: danger ? "#3a1f22" : "#2b2f38", color: danger ? "#f08080" : "#e6e6e6", border: `1px solid ${danger ? "#a33" : "#4a505c"}`, borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: disabled ? "default" : "pointer" }}
    >
      {children}
    </button>
  );
}

function NamePrompt({
  title,
  initial,
  label,
  ok,
  cancel,
  invalid,
  onOk,
  onCancel,
}: {
  title: string;
  initial: string;
  label: string;
  ok: string;
  cancel: string;
  invalid: string;
  onOk: (v: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // 확장자 앞까지만 선택(이름 바꾸기에서 확장자를 실수로 지우지 않게).
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const valid = validName(v);
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const e = await onOk(v);
    setBusy(false);
    setErr(e);
  };
  return (
    <Modal onClose={onCancel}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <label style={{ fontSize: 11, color: "#9aa4b2" }}>{label}</label>
      <input
        ref={ref}
        value={v}
        spellCheck={false}
        onChange={(e) => {
          setV(e.target.value);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit();
          if (e.key === "Escape") onCancel();
        }}
        style={{ height: 28, background: "#15151a", border: `1px solid ${valid ? "#3a3a44" : "#a33"}`, borderRadius: 4, color: "#eee", padding: "0 8px", fontSize: 13 }}
      />
      {(!valid && v) || err ? <div style={{ fontSize: 11, color: "#f08080", wordBreak: "break-word" }}>{err ?? invalid}</div> : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <ModalBtn onClick={onCancel}>{cancel}</ModalBtn>
        <ModalBtn disabled={!valid || busy} onClick={() => void submit()}>{ok}</ModalBtn>
      </div>
    </Modal>
  );
}
