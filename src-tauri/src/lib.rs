pub mod ai;
pub mod pty;
pub mod secrets;
pub mod ssh;
pub mod windows;

use std::sync::Arc;

use ai::registry::AiRegistry;
use pty::commands::PtyState;
use secrets::{EncryptedFileStore, SecretStore};
use tauri::Manager;
use windows::DetachedRegistry;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to wowTerminal.", name)
}

/// 머신 고유 ID에서 secret 파일 암호화용 패스프레이즈를 파생한다.
/// 입력 없이 무프롬프트로 동작하지만, OS 키링과 달리 같은 머신·같은 사용자면 복호화 가능
/// (개인 개발/사용 용도의 trade-off). 머신 ID 조회 실패 시 고정 폴백.
fn machine_passphrase() -> String {
    let id = machine_uid::get().unwrap_or_else(|_| "wowterminal-fallback-machine".to_string());
    format!("wowterminal-secret-v1:{id}")
}

/// GlitchTip(Sentry 호환) 에러 추적 DSN. 공개 수집 키라 임베드해도 안전(비밀 아님).
/// 환경변수 `WOWTERMINAL_GLITCHTIP_DSN`로 덮어쓰거나, 빈 값으로 두면 추적을 끈다(opt-out).
const GLITCHTIP_DSN: &str = "https://663f23ace357492887f838d73b57a50c@glitchtip.oopnwow.com/1";

/// Sentry/GlitchTip을 초기화하고 가드를 반환한다. 가드가 살아있는 동안만 이벤트가 전송되므로
/// 호출부(run)에서 앱 수명 동안 보관해야 한다. DSN이 비면 None(추적 비활성).
fn init_error_tracking() -> Option<sentry::ClientInitGuard> {
    let dsn = std::env::var("WOWTERMINAL_GLITCHTIP_DSN")
        .unwrap_or_else(|_| GLITCHTIP_DSN.to_string());
    if dsn.trim().is_empty() {
        return None;
    }
    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(), // wowterminal@<버전>
            environment: Some(
                if cfg!(debug_assertions) { "development" } else { "production" }.into(),
            ),
            ..Default::default()
        },
    ));
    // 백엔드/프론트를 한 프로젝트에서 태그로 구분한다.
    sentry::configure_scope(|scope| scope.set_tag("component", "backend"));
    Some(guard)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 가드는 run()이 반환할 때까지(=앱 종료까지) 살아있어야 panic/에러가 전송된다.
    let _sentry_guard = init_error_tracking();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AiRegistry::new())
        .manage(DetachedRegistry::default())
        .setup(|app| {
            // 기본 메뉴(App/Edit/Window 등)를 설정한다. Edit 메뉴의 Copy/Paste/Cut/Select All이
            // 있어야 macOS 등에서 cmd+C/V/X/A 키가 입력창·터미널로 전달된다(없으면 동작 안 함).
            let menu = tauri::menu::Menu::default(app.handle())?;
            app.set_menu(menu)?;

            // 세션 출력 ring buffer (pty/ssh 공유) — 탭 분리 시 스크롤백 복원용.
            let history = Arc::new(pty::manager::HistoryStore::new(512 * 1024));
            app.manage(pty::commands::HistoryState(Arc::clone(&history)));

            let pty_manager = pty::commands::build_manager(&app.handle(), Arc::clone(&history));
            app.manage(PtyState(pty_manager));

            let config_dir = dirs::config_dir()
                .map(|p| p.join("wowterminal"))
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            let _ = std::fs::create_dir_all(&config_dir);

            // secret 저장: OS 키링 대신 머신 키 기반 암호화 파일(EncryptedFileStore).
            // unsigned 빌드에서 macOS Keychain이 매 실행 권한을 묻는 문제를 피한다.
            // ssh/ai가 같은 store를 공유(키는 각자 id로 네임스페이스).
            let secret_store: Arc<dyn SecretStore> = Arc::new(
                EncryptedFileStore::open_or_create(
                    config_dir.join("secrets.enc"),
                    &machine_passphrase(),
                )
                .expect("open encrypted secret store"),
            );

            // AI backends.toml 로드 후 registry에 등록.
            let mut ai_state = ai::commands::build_state(config_dir.join("backends.toml"));
            ai_state.secrets = secret_store.clone();
            let registry = app.state::<AiRegistry>().inner().clone();
            let state_for_bootstrap = ai::commands::AiState {
                backends: ai::store::BackendsStore::new(config_dir.join("backends.toml")),
                secrets: secret_store.clone(),
            };
            tauri::async_runtime::spawn(async move {
                ai::commands::bootstrap_registry(&state_for_bootstrap, &registry).await;
            });
            app.manage(ai_state);
            let hosts_path = config_dir.join("hosts.toml");
            let known_hosts_path = config_dir.join("known_hosts.toml");
            let groups_path = config_dir.join("groups.toml");
            let tags_path = config_dir.join("tags.toml");
            let keys_path = config_dir.join("keys.toml");
            let mut ssh_state = ssh::commands::build_state(
                &app.handle(),
                hosts_path,
                known_hosts_path,
                groups_path,
                tags_path,
                keys_path,
                Arc::clone(&history),
            );
            ssh_state.secrets = Some(secret_store.clone());
            app.manage(ssh_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            ai::commands::ai_list_backends,
            ai::commands::ai_complete,
            ai::commands::ai_complete_stream,
            ai::commands::ai_list_backend_configs,
            ai::commands::ai_list_models,
            ai::commands::ai_save_backend,
            ai::commands::ai_delete_backend,
            pty::commands::pty_spawn,
            pty::commands::session_history,
            pty::commands::pty_write,
            pty::commands::pty_resize,
            pty::commands::pty_kill,
            ssh::commands::ssh_list_hosts,
            ssh::commands::ssh_save_host,
            ssh::commands::ssh_delete_host,
            ssh::commands::ssh_connect,
            ssh::commands::ssh_write,
            ssh::commands::ssh_remote_cwd,
            ssh::commands::ssh_tmux_sessions,
            ssh::commands::ssh_probe_system,
            pty::commands::local_tmux_sessions,
            pty::commands::local_system_info,
            ssh::commands::ssh_resize,
            ssh::commands::ssh_kill,
            ssh::commands::ssh_list_known_hosts,
            ssh::commands::ssh_forget_known_host,
            ssh::commands::ssh_trust_known_host,
            ssh::commands::secrets_unlock,
            ssh::commands::ssh_remember_password,
            ssh::commands::ssh_list_groups,
            ssh::commands::ssh_save_group,
            ssh::commands::ssh_delete_group,
            ssh::commands::ssh_list_tags,
            ssh::commands::ssh_save_tag,
            ssh::commands::ssh_delete_tag,
            ssh::commands::ssh_list_keys,
            ssh::commands::ssh_generate_key,
            ssh::commands::ssh_import_key,
            ssh::commands::ssh_delete_key,
            ssh::commands::sftp_open,
            ssh::commands::sftp_list,
            ssh::commands::sftp_disconnect,
            ssh::commands::sftp_download,
            ssh::commands::sftp_upload,
            ssh::commands::sftp_remove,
            ssh::commands::sftp_rename,
            ssh::commands::sftp_mkdir,
            ssh::commands::sftp_touch,
            ssh::commands::sftp_read_text,
            ssh::commands::sftp_write_text,
            ssh::commands::sftp_read_bytes,
            ssh::commands::sftp_chmod,
            ssh::commands::sftp_search,
            ssh::commands::local_list_dir,
            ssh::commands::local_read_text,
            ssh::commands::local_write_text,
            ssh::commands::local_copy_into,
            ssh::commands::tunnel_start_local,
            ssh::commands::tunnel_start_dynamic,
            ssh::commands::tunnel_start_remote,
            ssh::commands::tunnel_stop,
            ssh::commands::tunnel_list,
            ssh::commands::session_log_append,
            ssh::commands::ssh_read_config,
            ssh::commands::local_read_bytes,
            windows::open_detached_window,
            windows::mark_session_detached,
            windows::detached_init,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
