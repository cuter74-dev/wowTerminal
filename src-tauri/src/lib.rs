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
            let manager = pty::commands::build_manager(&app.handle());
            app.manage(PtyState(manager));
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
