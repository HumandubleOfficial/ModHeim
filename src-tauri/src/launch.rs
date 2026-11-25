//! Starting Valheim (Xbox app activation, Steam, or the exe directly) and watching for it.

use std::path::Path;
use std::process::Command;

use crate::error::{AppError, Result};
use crate::game::{GameInstall, Platform, STEAM_APP_ID, steam_root};
use crate::settings::{LaunchMethod, Server};

pub fn build_args(server: Option<&Server>, extra: &str) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(s) = server {
        if !s.address.trim().is_empty() {
            args.push("+connect".to_string());
            args.push(s.address.trim().to_string());
        }
        if !s.password.is_empty() {
            args.push("+password".to_string());
            args.push(s.password.clone());
        }
    }
    args.extend(extra.split_whitespace().map(String::from));
    args
}

/// Join args into one command line, quoting where needed (for app activation).
pub fn join_args(args: &[String]) -> String {
    args.iter()
        .map(|a| {
            if a.is_empty() || a.contains([' ', '\t', '"']) {
                format!("\"{}\"", a.replace('"', "\\\""))
            } else {
                a.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn start(game: &GameInstall, method: LaunchMethod, args: &[String]) -> Result<()> {
    match (game.platform, method) {
        (Platform::Xbox, LaunchMethod::Activate) => activate_xbox(&game.xbox_aumid(), &join_args(args)),
        (Platform::Steam, LaunchMethod::Activate) => {
            let steam = steam_root()
                .map(|r| r.join("steam.exe"))
                .filter(|p| p.is_file())
                .ok_or_else(|| AppError::msg("Steam wasn't found"))?;
            Command::new(steam)
                .arg("-applaunch")
                .arg(STEAM_APP_ID)
                .args(args)
                .spawn()?;
            Ok(())
        }
        _ => run_direct(&game.path, args),
    }
}

fn run_direct(dir: &Path, args: &[String]) -> Result<()> {
    Command::new(dir.join(crate::game::GAME_EXE))
        .args(args)
        .current_dir(dir)
        .spawn()
        .map_err(|e| AppError::msg(format!("Couldn't start Valheim.exe: {e}")))?;
    Ok(())
}

#[cfg(windows)]
fn activate_xbox(aumid: &str, args: &str) -> Result<()> {
    use windows::Win32::System::Com::{
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
    };
    use windows::Win32::UI::Shell::{AO_NONE, ApplicationActivationManager, IApplicationActivationManager};
    use windows::core::{HSTRING, PCWSTR};

    let aumid = HSTRING::from(aumid);
    let args = HSTRING::from(args);
    // COM on its own thread so we don't fight Tauri's apartment.
    std::thread::spawn(move || -> std::result::Result<u32, String> {
        unsafe {
            let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let result = (|| {
                let mgr: IApplicationActivationManager =
                    CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)?;
                mgr.ActivateApplication(PCWSTR(aumid.as_ptr()), PCWSTR(args.as_ptr()), AO_NONE)
            })();
            if init.is_ok() {
                CoUninitialize();
            }
            result.map_err(|e| e.message().to_string())
        }
    })
    .join()
    .map_err(|_| AppError::msg("Launch thread crashed"))?
    .map(|_pid| ())
    .map_err(|e| AppError::msg(format!("Windows couldn't start the Xbox app version of Valheim: {e}")))
}

#[cfg(not(windows))]
fn activate_xbox(_aumid: &str, _args: &str) -> Result<()> {
    Err(AppError::msg("Xbox launching is only available on Windows"))
}

/// Is Valheim running right now? Only process names are read (no CPU/memory/command lines),
/// which keeps this cheap enough to poll every couple of seconds.
pub fn is_running(sys: &mut sysinfo::System) -> bool {
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    sys.processes()
        .values()
        .any(|p| p.name().eq_ignore_ascii_case("valheim.exe"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_connect_args() {
        let s = Server {
            id: "1".into(),
            name: "Home".into(),
            address: " 10.0.0.5:2456 ".into(),
            password: "my pass".into(),
            profile: None,
            vanilla: false,
        };
        let args = build_args(Some(&s), "-console");
        assert_eq!(args, vec!["+connect", "10.0.0.5:2456", "+password", "my pass", "-console"]);
        assert_eq!(join_args(&args), "+connect 10.0.0.5:2456 +password \"my pass\" -console");
        assert!(build_args(None, "").is_empty());
    }
}
