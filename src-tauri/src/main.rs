#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io::{BufRead, BufReader}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}};
use tauri::Manager;

#[derive(Clone, Default, serde::Serialize)]
struct Status { url: Option<String>, error: Option<String> }
struct Backend { child: Mutex<Option<Child>>, status: Arc<Mutex<Status>> }
impl Backend {
    fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            #[cfg(unix)] unsafe { libc::kill(-(child.id() as i32), libc::SIGTERM); }
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).creation_flags(0x08000000).status();
            }
            // Allow Node/Playwright exit handlers to close detached browser processes.
            for _ in 0..40 {
                if child.try_wait().ok().flatten().is_some() { return; }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            #[cfg(unix)] unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
            let _ = child.kill(); let _ = child.wait();
        }
    }
}
#[tauri::command]
fn backend_status(state: tauri::State<Backend>) -> Status { state.status.lock().unwrap().clone() }
fn main() {
    let app = tauri::Builder::default()
        .manage(Backend { child: Mutex::new(None), status: Arc::new(Mutex::new(Status::default())) })
        .invoke_handler(tauri::generate_handler![backend_status])
        .setup(|app| {
            let state = app.state::<Backend>();
            let resource = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.desktop/runtime")
            } else { app.path().resource_dir()?.join("runtime") };
            let node = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("binaries/web-security-node-{}{}", env!("WSH_TARGET"), if cfg!(windows) { ".exe" } else { "" }))
            } else { std::env::current_exe()?.parent().unwrap().join(if cfg!(windows) { "web-security-node.exe" } else { "web-security-node" }) };
            let mut command = Command::new(node);
            command.arg(resource.join("desktop/host.js")).current_dir(&resource)
                .env("WEB_SECURITY_HUB_PACKAGED", "1")
                .env("WEB_SECURITY_HUB_DATA_DIR", std::env::var_os("WEB_SECURITY_HUB_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(app.path().app_data_dir()?))
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            #[cfg(unix)] { use std::os::unix::process::CommandExt; command.process_group(0); }
            #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
            match command.spawn() {
                Ok(mut child) => {
                    let stdout = child.stdout.take().unwrap(); let stderr = child.stderr.take().unwrap();
                    *state.child.lock().unwrap() = Some(child);
                    let status = state.status.clone();
                    std::thread::spawn(move || {
                        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                            if let Some(json) = line.strip_prefix("WSH_READY ") {
                                if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
                                    status.lock().unwrap().url = value["url"].as_str().map(String::from);
                                }
                            }
                        }
                        status.lock().unwrap().error.get_or_insert_with(|| "The background service exited. Close and reopen the app.".into());
                    });
                    let status = state.status.clone();
                    std::thread::spawn(move || {
                        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                            eprintln!("{line}");
                            if status.lock().unwrap().url.is_none() { status.lock().unwrap().error = Some(line); }
                        }
                    });
                }
                Err(error) => state.status.lock().unwrap().error = Some(error.to_string()),
            }
            Ok(())
        })
        .build(tauri::generate_context!()).expect("Could not initialize Web Security Hub");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) { handle.state::<Backend>().stop(); }
    });
}
