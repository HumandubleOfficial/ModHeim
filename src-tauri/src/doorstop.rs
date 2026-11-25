//! Unity Doorstop: the proxy DLL in the game folder that boots BepInEx.
//! ModHeim switches modded/vanilla by rewriting doorstop_config.ini before each launch.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, Result};
use crate::thunderstore::version_key;

pub const CONFIG_FILE: &str = "doorstop_config.ini";
pub const VERSION_FILE: &str = ".doorstop_version";
pub const PROXY_DLL: &str = "winhttp.dll";
const BACKUP_SUFFIX: &str = ".modheim-bak";
const PACK_PREFIX: &str = "BepInExPack_Valheim/";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoorstopStatus {
    pub proxy_installed: bool,
    pub version: Option<String>,
    pub enabled: Option<bool>,
    pub target: Option<String>,
}

/// Set `key = value` inside `[section]`, keeping every other line (and comments) as-is.
/// Adds the key (and section) if missing.
pub fn set_ini_value(content: &str, section: &str, key: &str, value: &str) -> String {
    let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<String> = content.lines().map(String::from).collect();
    let mut current = String::new();
    let mut section_header: Option<usize> = None;
    let mut section_end: Option<usize> = None;

    for i in 0..lines.len() {
        let t = lines[i].trim();
        if t.starts_with('[') && t.ends_with(']') {
            if current.eq_ignore_ascii_case(section) && section_end.is_none() {
                section_end = Some(i);
            }
            current = t[1..t.len() - 1].trim().to_string();
            if current.eq_ignore_ascii_case(section) {
                section_header = Some(i);
            }
            continue;
        }
        if t.starts_with('#') || t.starts_with(';') || !current.eq_ignore_ascii_case(section) {
            continue;
        }
        if let Some((k, _)) = t.split_once('=') {
            if k.trim().eq_ignore_ascii_case(key) {
                lines[i] = format!("{key} = {value}");
                return lines.join(newline) + newline;
            }
        }
    }

    match section_header {
        Some(h) => {
            // insert after the last non-blank line of the section
            let mut at = section_end.unwrap_or(lines.len());
            while at > h + 1 && lines[at - 1].trim().is_empty() {
                at -= 1;
            }
            lines.insert(at, format!("{key} = {value}"));
        }
        None => {
            lines.push(format!("[{section}]"));
            lines.push(format!("{key} = {value}"));
        }
    }
    lines.join(newline) + newline
}

pub fn get_ini_value(content: &str, section: &str, key: &str) -> Option<String> {
    let mut current = String::new();
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            current = t[1..t.len() - 1].trim().to_string();
        } else if !t.starts_with('#') && !t.starts_with(';') && current.eq_ignore_ascii_case(section) {
            if let Some((k, v)) = t.split_once('=') {
                if k.trim().eq_ignore_ascii_case(key) {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}

pub fn status(game_dir: &Path) -> DoorstopStatus {
    let ini = std::fs::read_to_string(game_dir.join(CONFIG_FILE)).ok();
    DoorstopStatus {
        proxy_installed: game_dir.join(PROXY_DLL).is_file(),
        version: std::fs::read_to_string(game_dir.join(VERSION_FILE))
            .ok()
            .map(|s| s.trim().to_string()),
        enabled: ini
            .as_deref()
            .and_then(|c| get_ini_value(c, "General", "enabled"))
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1"),
        target: ini
            .as_deref()
            .and_then(|c| get_ini_value(c, "General", "target_assembly")),
    }
}

/// Preloader path inside a profile.
pub fn preloader_path(profile_dir: &Path) -> PathBuf {
    profile_dir.join("BepInEx").join("core").join("BepInEx.Preloader.dll")
}

/// Turn mods on (pointing at `profile_dir`) or off for the next launch.
pub fn configure(game_dir: &Path, profile_dir: Option<&Path>) -> Result<()> {
    let ini_path = game_dir.join(CONFIG_FILE);
    let backup = game_dir.join(format!("{CONFIG_FILE}{BACKUP_SUFFIX}"));
    let mut content = match std::fs::read_to_string(&ini_path) {
        Ok(c) => {
            if !backup.exists() {
                std::fs::copy(&ini_path, &backup)?;
            }
            c
        }
        Err(_) => DEFAULT_INI.to_string(),
    };
    match profile_dir {
        Some(dir) => {
            let target = preloader_path(dir);
            if !target.is_file() {
                return Err(AppError::msg(
                    "This profile has no BepInEx yet. Open Profiles and repair it.",
                ));
            }
            content = set_ini_value(&content, "General", "enabled", "true");
            content = set_ini_value(
                &content,
                "General",
                "target_assembly",
                &target.to_string_lossy(),
            );
        }
        None => {
            content = set_ini_value(&content, "General", "enabled", "false");
        }
    }
    std::fs::write(&ini_path, content)?;
    Ok(())
}

/// Copy winhttp.dll (+ version file, + ini if missing) from a BepInExPack zip into the
/// game folder. Only replaces the proxy if the pack's Doorstop is newer or none is there.
/// Returns true if anything changed.
pub fn install_proxy_from_pack(game_dir: &Path, pack_zip: &Path) -> Result<bool> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(pack_zip)?)?;
    let read = |zip: &mut zip::ZipArchive<std::fs::File>, name: &str| -> Option<Vec<u8>> {
        let mut f = zip.by_name(&format!("{PACK_PREFIX}{name}")).ok()?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).ok()?;
        Some(buf)
    };
    let pack_version = read(&mut zip, VERSION_FILE)
        .map(|b| String::from_utf8_lossy(&b).trim().to_string())
        .unwrap_or_default();
    let current = status(game_dir);
    let need_proxy = !current.proxy_installed
        || current
            .version
            .as_deref()
            .map(|v| version_key(&pack_version) > version_key(v))
            .unwrap_or(true);

    let mut changed = false;
    if need_proxy {
        let dll = read(&mut zip, PROXY_DLL)
            .ok_or_else(|| AppError::msg("BepInExPack is missing winhttp.dll"))?;
        std::fs::write(game_dir.join(PROXY_DLL), dll).map_err(|e| {
            AppError::msg(format!(
                "Couldn't write winhttp.dll into the game folder (is Valheim running?): {e}"
            ))
        })?;
        if !pack_version.is_empty() {
            std::fs::write(game_dir.join(VERSION_FILE), &pack_version)?;
        }
        changed = true;
    }
    if !game_dir.join(CONFIG_FILE).is_file() {
        let ini = read(&mut zip, CONFIG_FILE).unwrap_or_else(|| DEFAULT_INI.as_bytes().to_vec());
        std::fs::write(game_dir.join(CONFIG_FILE), ini)?;
        // start disabled until ModHeim launches modded
        configure(game_dir, None)?;
        changed = true;
    }
    Ok(changed)
}

const DEFAULT_INI: &str = "# General options for Unity Doorstop\n[General]\nenabled = false\ntarget_assembly=BepInEx\\core\\BepInEx.Preloader.dll\nredirect_output_log = false\nboot_config_override =\nignore_disable_switch = false\n\n[UnityMono]\ndll_search_path_override =\ndebug_enabled = false\ndebug_address = 127.0.0.1:10000\ndebug_suspend = false\n";

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# General options for Unity Doorstop\r\n[General]\r\n\r\n# Enable Doorstop?\r\nenabled = true\r\n\r\n# Path to the assembly\r\ntarget_assembly=BepInEx\\core\\BepInEx.Preloader.dll\r\n\r\n[UnityMono]\r\n# enabled = true here is a comment\r\ndebug_enabled = false\r\n";

    #[test]
    fn rewrites_keys_and_keeps_comments() {
        let out = set_ini_value(SAMPLE, "General", "enabled", "false");
        let out = set_ini_value(&out, "General", "target_assembly", r"C:\P\BepInEx\core\BepInEx.Preloader.dll");
        assert!(out.contains("# Enable Doorstop?"));
        assert!(out.contains("enabled = false\r\n"));
        assert!(out.contains(r"target_assembly = C:\P\BepInEx\core\BepInEx.Preloader.dll"));
        assert!(out.contains("# enabled = true here is a comment"));
        assert!(out.contains("debug_enabled = false"));
        assert_eq!(get_ini_value(&out, "General", "enabled").as_deref(), Some("false"));
        assert_eq!(get_ini_value(&out, "UnityMono", "debug_enabled").as_deref(), Some("false"));
    }

    #[test]
    fn adds_missing_key_inside_section() {
        let out = set_ini_value("[General]\nfoo = 1\n\n[Other]\nx = 2\n", "General", "enabled", "true");
        assert_eq!(out, "[General]\nfoo = 1\nenabled = true\n\n[Other]\nx = 2\n");
        let out = set_ini_value("", "General", "enabled", "true");
        assert_eq!(out, "[General]\nenabled = true\n");
    }

    #[test]
    fn configure_toggles_and_backs_up() {
        let game = tempfile::tempdir().unwrap();
        let profile = tempfile::tempdir().unwrap();
        std::fs::write(game.path().join(CONFIG_FILE), SAMPLE).unwrap();
        // no preloader yet -> error
        assert!(configure(game.path(), Some(profile.path())).is_err());
        let core = profile.path().join("BepInEx/core");
        std::fs::create_dir_all(&core).unwrap();
        std::fs::write(core.join("BepInEx.Preloader.dll"), b"x").unwrap();
        configure(game.path(), Some(profile.path())).unwrap();
        let s = status(game.path());
        assert_eq!(s.enabled, Some(true));
        assert!(s.target.unwrap().ends_with("BepInEx.Preloader.dll"));
        assert!(game.path().join("doorstop_config.ini.modheim-bak").is_file());
        configure(game.path(), None).unwrap();
        assert_eq!(status(game.path()).enabled, Some(false));
    }
}
