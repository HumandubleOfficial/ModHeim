use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::game::GameInstall;

/// Root data folder: %APPDATA%\ModHeim
pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("MODHEIM_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ModHeim")
}

pub fn profiles_dir() -> PathBuf {
    data_dir().join("profiles")
}

pub fn cache_dir() -> PathBuf {
    data_dir().join("cache")
}

pub fn package_cache_dir() -> PathBuf {
    cache_dir().join("packages")
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMethod {
    /// Xbox: activate the packaged app (official path). Steam: steam -applaunch.
    #[default]
    Activate,
    /// Run Valheim.exe from the game folder directly.
    Direct,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    /// host:port
    pub address: String,
    #[serde(default)]
    pub password: String,
    /// Profile to launch with; None = whichever profile is active.
    #[serde(default)]
    pub profile: Option<String>,
    /// Launch vanilla instead of modded.
    #[serde(default)]
    pub vanilla: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub game: Option<GameInstall>,
    pub theme: String,
    pub active_profile: String,
    pub launch_method: LaunchMethod,
    pub extra_args: String,
    pub servers: Vec<Server>,
    pub show_nsfw: bool,
    pub show_deprecated: bool,
    /// File name (in the data folder) of the user's own Play-screen picture; None = built-in scene.
    pub background: Option<String>,
    /// Animated backdrop behind the pages: aurora | forest | embers | plain
    pub backdrop: String,
    /// Check mods against the game version before a modded launch.
    pub launch_guard: bool,
    /// Back up worlds and characters before modded launches (only when they changed).
    pub backup_before_launch: bool,
    pub backup_keep: u32,
    pub sounds: bool,
    pub ambience: bool,
    /// 0..1
    pub volume: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            game: None,
            theme: "norse".into(),
            active_profile: "Default".into(),
            launch_method: LaunchMethod::Activate,
            extra_args: String::new(),
            servers: Vec::new(),
            show_nsfw: false,
            show_deprecated: false,
            background: None,
            backdrop: "aurora".into(),
            launch_guard: true,
            backup_before_launch: true,
            backup_keep: 10,
            sounds: true,
            ambience: true,
            volume: 0.6,
        }
    }
}

fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

impl Settings {
    pub fn load() -> Settings {
        std::fs::read(settings_path())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<()> {
        write_json_atomic(&settings_path(), self)
    }
}

/// Write JSON to a temp file then rename, so a crash never leaves a half-written file.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}
