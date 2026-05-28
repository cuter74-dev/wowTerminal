pub mod ai;
pub mod pty;
pub mod secrets;
pub mod ssh;
pub mod windows;

use std::sync::Arc;

use ai::registry::AiRegistry;
use pty::commands::PtyState;
use secrets::{KeyringStore, SecretStore};
use tauri::Manager;
use windows::DetachedRegistry;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to wowTerminal.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AiRegistry::new())
        .manage(DetachedRegistry::default())
        .setup(|app| {
            let pty_manager = pty::commands::build_manager(&app.handle());
            app.manage(PtyState(pty_manager));

            let config_dir = dirs::config_dir()
                .map(|p| p.join("wowterminal"))
                .unwrap_or_else(|| std::path::PathBuf::from("."));

            // AI backends.toml 로드 후 registry에 등록.
            let ai_state = ai::commands::build_state(config_dir.join("backends.toml"));
            let registry = app.state::<AiRegistry>().inner().clone();
            let state_for_bootstrap = ai::commands::AiState {
                backends: ai::store::BackendsStore::new(config_dir.join("backends.toml")),
                secrets: ai_state.secrets.clone(),
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
            );
            // OS 키링을 기본 secret store로 활성화. macOS는 Keychain, Linux는 Secret Service,
            // Windows는 Credential Manager. KeyringStore::save 시 OS가 사용자에게 권한 prompt 가능.
            let keyring: Arc<dyn SecretStore> = Arc::new(KeyringStore::new("wowterminal"));
            ssh_state.secrets = Some(keyring);
            app.manage(ssh_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            ai::commands::ai_list_backends,
            ai::commands::ai_complete,
            ai::commands::ai_list_backend_configs,
            ai::commands::ai_save_backend,
            ai::commands::ai_delete_backend,
            pty::commands::pty_spawn,
            pty::commands::pty_write,
            pty::commands::pty_resize,
            pty::commands::pty_kill,
            ssh::commands::ssh_list_hosts,
            ssh::commands::ssh_save_host,
            ssh::commands::ssh_delete_host,
            ssh::commands::ssh_connect,
            ssh::commands::ssh_write,
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
            ssh::commands::sftp_chmod,
            ssh::commands::sftp_search,
            ssh::commands::local_list_dir,
            windows::open_detached_window,
            windows::detached_init,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
