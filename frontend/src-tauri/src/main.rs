// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// Holds the sidecar child process so it lives as long as the app.
/// When the app exits, Drop kills the child automatically.
struct Backend(Mutex<Option<Child>>);

impl Drop for Backend {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg(windows)]
fn show_error(msg: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR};
    let msg_wide: Vec<u16> = msg.encode_utf16().chain(Some(0)).collect();
    let title_wide: Vec<u16> = "EVE Flipper\0".encode_utf16().collect();
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            msg_wide.as_ptr(),
            title_wide.as_ptr(),
            MB_ICONERROR,
        );
    }
}

#[cfg(not(windows))]
fn show_error(msg: &str) {
    eprintln!("EVE Flipper error: {}", msg);
}

/// Locate the Go backend binary next to the current exe.
/// Looks in several places:
///   1. <exe_dir>/binaries/eve-flipper-backend-<triple>.exe
///   2. <exe_dir>/eve-flipper-backend-<triple>.exe
///   3. <exe_dir>/eve-flipper-backend.exe  (simple name fallback)
fn find_backend() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()?
        .parent()?
        .to_path_buf();

    let triple = if cfg!(target_arch = "x86_64") {
        if cfg!(target_os = "windows") {
            "x86_64-pc-windows-msvc"
        } else if cfg!(target_os = "linux") {
            "x86_64-unknown-linux-gnu"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_arch = "aarch64") {
        if cfg!(target_os = "macos") {
            "aarch64-apple-darwin"
        } else {
            "aarch64-unknown-linux-gnu"
        }
    } else {
        "unknown"
    };

    let ext = if cfg!(windows) { ".exe" } else { "" };
    let triple_name = format!("eve-flipper-backend-{triple}{ext}");
    let simple_name = format!("eve-flipper-backend{ext}");

    let candidates = [
        exe_dir.join("binaries").join(&triple_name),
        exe_dir.join(&triple_name),
        exe_dir.join("binaries").join(&simple_name),
        exe_dir.join(&simple_name),
    ];

    for path in &candidates {
        if path.is_file() {
            return Some(path.clone());
        }
    }

    None
}

/// Wait for the Go backend to accept TCP connections on port 13370.
fn wait_for_backend(timeout_secs: u64) -> bool {
    let start = Instant::now();
    let timeout = Duration::from_secs(timeout_secs);
    let poll_interval = Duration::from_millis(250);

    while start.elapsed() < timeout {
        if TcpStream::connect_timeout(
            &"127.0.0.1:13370".parse().unwrap(),
            Duration::from_millis(500),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(poll_interval);
    }
    false
}

fn main() {
    // Locate and start the Go backend before Tauri initializes.
    // This avoids Tauri's sidecar resolution which doesn't work
    // reliably for portable (non-installed) builds.

    let backend_path = match find_backend() {
        Some(p) => p,
        None => {
            show_error(
                "Backend binary not found.\n\n\
                 Place eve-flipper-backend.exe in the same folder \
                 (or in a 'binaries' subfolder) next to this application.",
            );
            std::process::exit(1);
        }
    };

    let child = match Command::new(&backend_path)
        .args(["--port", "13370"])
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let msg = format!(
                "Failed to start the backend server.\n\
                 Path: {}\n\n\
                 Details: {:?}",
                backend_path.display(),
                e
            );
            show_error(&msg);
            std::process::exit(1);
        }
    };

    // Wait for the backend to start accepting connections (max 30 s).
    if !wait_for_backend(30) {
        show_error(
            "Backend server did not start within 30 seconds.\n\
             Please check if port 13370 is already in use.",
        );
        std::process::exit(1);
    }

    // Now start Tauri with the backend already running.
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            // Store the child handle so it lives as long as the app.
            app.manage(Backend(Mutex::new(Some(child))));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
