//! Finding the Valheim install (Xbox app, Steam, or a folder picked by hand).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

pub const STEAM_APP_ID: &str = "892970";
pub const XBOX_PACKAGE_NAME: &str = "CoffeeStainStudios.Valheim";
/// Fallback when the package can't be read from the registry.
pub const XBOX_DEFAULT_FAMILY: &str = "CoffeeStainStudios.Valheim_496a1srhmar9w";
pub const XBOX_APP_ID: &str = "Game";
pub const GAME_EXE: &str = "Valheim.exe";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Xbox,
    Steam,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GameInstall {
    pub platform: Platform,
    pub path: PathBuf,
    /// Xbox only: package family name used to build the app user model id.
    #[serde(default)]
    pub package_family: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

impl GameInstall {
    pub fn xbox_aumid(&self) -> String {
        let family = self
            .package_family
            .clone()
            .unwrap_or_else(|| XBOX_DEFAULT_FAMILY.to_string());
        format!("{family}!{XBOX_APP_ID}")
    }
}

/// Resolve junctions/symlinks to the real folder (WindowsApps -> XboxGames).
fn real_path(p: &Path) -> PathBuf {
    dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

pub fn has_game_exe(dir: &Path) -> bool {
    dir.join(GAME_EXE).is_file()
}

pub fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".modheim_write_test");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Every Valheim install we can find, Xbox first.
pub fn detect_all() -> Vec<GameInstall> {
    let mut found: Vec<GameInstall> = Vec::new();
    let mut push = |g: GameInstall| {
        if !found.iter().any(|f| f.path == g.path) {
            found.push(g);
        }
    };
    for g in detect_xbox() {
        push(g);
    }
    for g in detect_steam() {
        push(g);
    }
    found
}

/// Build an install record for a folder the user picked.
pub fn from_path(path: &Path) -> Result<GameInstall> {
    let path = real_path(path);
    if !has_game_exe(&path) {
        return Err(AppError::msg(format!(
            "{} wasn't found in {}. Pick the folder that contains it.",
            GAME_EXE,
            path.display()
        )));
    }
    // If it matches a detected install, keep that platform info.
    if let Some(known) = detect_all().into_iter().find(|g| g.path == path) {
        return Ok(known);
    }
    // An XboxGames layout without a registry entry still behaves like Xbox.
    let looks_xbox = path.join("MicrosoftGame.Config").is_file();
    Ok(GameInstall {
        platform: if looks_xbox { Platform::Xbox } else { Platform::Manual },
        package_family: looks_xbox.then(|| XBOX_DEFAULT_FAMILY.to_string()),
        version: None,
        path,
    })
}

// ---------------------------------------------------------------- Xbox

/// "CoffeeStainStudios.Valheim_1.0.22.0_x64__496a1srhmar9w" -> ("CoffeeStainStudios.Valheim_496a1srhmar9w", "1.0.22.0")
pub fn parse_package_full_name(full: &str) -> Option<(String, String)> {
    let (front, publisher_id) = full.rsplit_once("__")?;
    let mut parts = front.split('_');
    let name = parts.next()?;
    let version = parts.next().unwrap_or("").to_string();
    Some((format!("{name}_{publisher_id}"), version))
}

#[cfg(windows)]
fn detect_xbox() -> Vec<GameInstall> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let mut out = Vec::new();
    let packages = RegKey::predef(HKEY_CURRENT_USER).open_subkey(
        r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages",
    );
    if let Ok(packages) = packages {
        for key_name in packages.enum_keys().flatten() {
            if !key_name.starts_with(XBOX_PACKAGE_NAME) {
                continue;
            }
            let Ok(key) = packages.open_subkey(&key_name) else { continue };
            let Ok(root): std::io::Result<String> = key.get_value("PackageRootFolder") else {
                continue;
            };
            let path = real_path(Path::new(&root));
            if !has_game_exe(&path) {
                continue;
            }
            let (family, version) = parse_package_full_name(&key_name)
                .map(|(f, v)| (Some(f), Some(v)))
                .unwrap_or((None, None));
            out.push(GameInstall {
                platform: Platform::Xbox,
                path,
                package_family: family,
                version,
            });
        }
    }

    // Fallback: <drive>:\XboxGames\Valheim\Content
    for letter in b'C'..=b'Z' {
        let path = PathBuf::from(format!(r"{}:\XboxGames\Valheim\Content", letter as char));
        if has_game_exe(&path) && !out.iter().any(|g| g.path == path) {
            out.push(GameInstall {
                platform: Platform::Xbox,
                path: real_path(&path),
                package_family: Some(XBOX_DEFAULT_FAMILY.to_string()),
                version: None,
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn detect_xbox() -> Vec<GameInstall> {
    Vec::new()
}

/// The installed game version right now (it changes when the Xbox app updates the game).
pub fn current_version(install: &GameInstall) -> Option<String> {
    match install.platform {
        Platform::Xbox => detect_xbox()
            .into_iter()
            .filter_map(|g| g.version)
            .max_by_key(|v| crate::thunderstore::version_key(v)),
        _ => install.version.clone(),
    }
}

/// Store pages where the player can install a game update.
pub const XBOX_PRODUCT_ID: &str = "9NCBL78CG9N7";

pub fn update_page_urls(platform: Platform) -> Vec<String> {
    match platform {
        Platform::Xbox => vec![
            format!("msxbox://game/?productId={XBOX_PRODUCT_ID}"),
            format!("ms-windows-store://pdp/?productid={XBOX_PRODUCT_ID}"),
        ],
        _ => vec![format!("steam://nav/games/details/{STEAM_APP_ID}")],
    }
}

// ---------------------------------------------------------------- Steam

#[cfg(windows)]
pub fn steam_root() -> Option<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Valve\Steam")
        .ok()?;
    let p: String = key.get_value("SteamPath").ok()?;
    Some(PathBuf::from(p.replace('/', "\\")))
}

#[cfg(not(windows))]
pub fn steam_root() -> Option<PathBuf> {
    None
}

/// Pull every quoted string out of a Valve KeyValues (VDF/ACF) file.
fn vdf_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut s = String::new();
        while let Some(c) = chars.next() {
            match c {
                '\\' => {
                    if let Some(n) = chars.next() {
                        s.push(n);
                    }
                }
                '"' => break,
                _ => s.push(c),
            }
        }
        tokens.push(s);
    }
    tokens
}

/// Values for `key` in `"key" "value"` pairs (ignores nested blocks' structure).
pub fn vdf_values(text: &str, key: &str) -> Vec<String> {
    let t = vdf_tokens(text);
    t.windows(2)
        .filter(|w| w[0].eq_ignore_ascii_case(key))
        .map(|w| w[1].clone())
        .collect()
}

fn detect_steam() -> Vec<GameInstall> {
    let Some(root) = steam_root() else { return Vec::new() };
    let mut libraries = vec![root.clone()];
    if let Ok(text) = std::fs::read_to_string(root.join(r"steamapps\libraryfolders.vdf")) {
        for p in vdf_values(&text, "path") {
            let p = PathBuf::from(p);
            if !libraries.contains(&p) {
                libraries.push(p);
            }
        }
    }
    let mut out = Vec::new();
    for lib in libraries {
        let manifest = lib.join(format!(r"steamapps\appmanifest_{STEAM_APP_ID}.acf"));
        let Ok(text) = std::fs::read_to_string(&manifest) else { continue };
        let Some(dir) = vdf_values(&text, "installdir").into_iter().next() else { continue };
        let path = lib.join("steamapps").join("common").join(dir);
        if has_game_exe(&path) {
            out.push(GameInstall {
                platform: Platform::Steam,
                path: real_path(&path),
                package_family: None,
                version: vdf_values(&text, "buildid").into_iter().next(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_package_full_name() {
        let (family, version) =
            parse_package_full_name("CoffeeStainStudios.Valheim_1.0.22.0_x64__496a1srhmar9w").unwrap();
        assert_eq!(family, "CoffeeStainStudios.Valheim_496a1srhmar9w");
        assert_eq!(version, "1.0.22.0");
    }

    #[test]
    fn parses_library_folders() {
        let vdf = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps" { "228980" "1" }
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        assert_eq!(
            vdf_values(vdf, "path"),
            vec![r"C:\Program Files (x86)\Steam", r"D:\SteamLibrary"]
        );
    }

    #[test]
    fn parses_app_manifest() {
        let acf = r#""AppState" { "appid" "892970" "installdir" "Valheim" "buildid" "123" }"#;
        assert_eq!(vdf_values(acf, "installdir"), vec!["Valheim"]);
        assert_eq!(vdf_values(acf, "buildid"), vec!["123"]);
    }
}
