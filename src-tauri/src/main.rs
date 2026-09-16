// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 세션 데몬 모드 (#153): `--daemon --socket <path>`로 띄우면 Tauri UI 대신 데몬 루프를
    // 돈다. 같은 실행 파일을 재사용해 기존 매니저·스토어를 그대로 host한다.
    #[cfg(unix)]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.iter().any(|a| a == "--daemon") {
            let socket = args
                .iter()
                .position(|a| a == "--socket")
                .and_then(|i| args.get(i + 1))
                .cloned()
                .unwrap_or_default();
            if socket.is_empty() {
                eprintln!("--daemon requires --socket <path>");
                std::process::exit(2);
            }
            let rt = tokio::runtime::Runtime::new().expect("daemon runtime");
            if let Err(e) = rt.block_on(wowterminal_lib::daemon::server::run(
                std::path::Path::new(&socket),
            )) {
                eprintln!("[daemon] exited with error: {e}");
                std::process::exit(1);
            }
            return;
        }
    }
    wowterminal_lib::run()
}
