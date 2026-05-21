pub mod ai;
pub mod pty;
pub mod secrets;
pub mod ssh;

use ai::registry::AiRegistry;
use pty::commands::PtyState;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to wowTerminal.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AiRegistry::new())
        .setup(|app| {
            let pty_manager = pty::commands::build_manager(&app.handle());
            app.manage(PtyState(pty_manager));

            let hosts_path = dirs::config_dir()
                .map(|p| p.join("wowterminal").join("hosts.toml"))
                .unwrap_or_else(|| std::path::PathBuf::from("hosts.toml"));
            let ssh_state = ssh::commands::build_state(&app.handle(), hosts_path);
            app.manage(ssh_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            ai::commands::ai_list_backends,
            ai::commands::ai_complete,
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
            ssh::commands::secrets_unlock,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
