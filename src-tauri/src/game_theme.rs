//! In-game UI themes: ModHeim ships its own BepInEx plugin (game-theme/) that recolors
//! Valheim's interface from a small theme file in the profile's config folder.
//! Visual only: nothing here touches worlds or characters.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::profiles::{self, InstalledMod, Profile};

pub const PLUGIN_ID: &str = "ModHeim-GameTheme";
pub const PLUGIN_VERSION: &str = "0.1.0";
const PLUGIN_DLL: &[u8] = include_bytes!("../resources/ModHeim.GameTheme.dll");
const PLUGIN_REL: &str = "BepInEx/plugins/ModHeim-GameTheme/ModHeim.GameTheme.dll";
const THEME_REL: &str = "BepInEx/config/ModHeim.GameTheme.theme";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameTheme {
    pub name: String,
    pub enabled: bool,
    pub panel: String,
    pub button: String,
    pub heading: String,
    pub text: String,
    pub panel_strength: f32,
    #[serde(default)]
    pub dump_sprites: bool,
}

impl GameTheme {
    pub fn to_file(&self) -> String {
        format!(
            "; Written by the ModHeim launcher. Edit themes in ModHeim > Game Themes.\n\
             Name = {}\nEnabled = {}\nPanel = {}\nButton = {}\nHeading = {}\nText = {}\nPanelStrength = {:.2}\nDumpSprites = {}\n",
            self.name.replace(['\n', '\r'], " "),
            self.enabled,
            clean_hex(&self.panel),
            clean_hex(&self.button),
            clean_hex(&self.heading),
            clean_hex(&self.text),
            self.panel_strength.clamp(0.0, 1.0),
            self.dump_sprites,
        )
    }

    pub fn parse(text: &str) -> GameTheme {
        let mut t = GameTheme {
            name: "Off".into(),
            enabled: false,
            panel: "#FFFFFF".into(),
            button: "#FFFFFF".into(),
            heading: "#FFB554".into(),
            text: "#FFFFFF".into(),
            panel_strength: 0.6,
            dump_sprites: false,
        };
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with(';') {
                continue;
            }
            let Some((k, v)) = line.split_once('=') else { continue };
            let v = v.trim().to_string();
            match k.trim().to_ascii_lowercase().as_str() {
                "name" => t.name = v,
                "enabled" => t.enabled = v.eq_ignore_ascii_case("true"),
                "panel" => t.panel = v,
                "button" => t.button = v,
                "heading" => t.heading = v,
                "text" => t.text = v,
                "panelstrength" => t.panel_strength = v.parse().unwrap_or(0.6),
                "dumpsprites" => t.dump_sprites = v.eq_ignore_ascii_case("true"),
                _ => {}
            }
        }
        t
    }
}

/// Keep only "#RRGGBB" / "#RRGGBBAA"; anything else becomes white.
fn clean_hex(s: &str) -> String {
    let h = s.trim().trim_start_matches('#');
    if (h.len() == 6 || h.len() == 8) && h.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("#{}", h.to_ascii_uppercase())
    } else {
        "#FFFFFF".into()
    }
}

fn path(profile: &str, rel: &str) -> std::path::PathBuf {
    rel.split('/').fold(profiles::dir(profile), |p, c| p.join(c))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeState {
    pub installed: bool,
    pub plugin_enabled: bool,
    pub theme: Option<GameTheme>,
    pub sprite_dump: Option<String>,
}

pub fn state(profile: &str) -> Result<ThemeState> {
    let p = profiles::load(profile)?;
    let m = p.find(PLUGIN_ID);
    Ok(ThemeState {
        installed: m.is_some(),
        plugin_enabled: m.map(|m| m.enabled).unwrap_or(false),
        theme: std::fs::read_to_string(path(profile, THEME_REL))
            .ok()
            .map(|t| GameTheme::parse(&t)),
        sprite_dump: Some(path(profile, "BepInEx/ModHeim.GameTheme.sprites.txt"))
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().to_string()),
    })
}

/// Put the plugin into the profile (or refresh it) and record it like any other mod.
pub fn ensure_plugin(profile: &mut Profile, game_running: bool) -> Result<()> {
    let dll = path(&profile.name, PLUGIN_REL);
    let up_to_date = std::fs::read(&dll).map(|b| b == PLUGIN_DLL).unwrap_or(false);
    if !up_to_date {
        if game_running && dll.exists() {
            // the game has the old copy loaded; the next start picks up the new one
        } else {
            std::fs::create_dir_all(dll.parent().unwrap())?;
            std::fs::write(&dll, PLUGIN_DLL)?;
            let _ = std::fs::remove_file(dll.with_extension("dll.old"));
        }
    }
    let enabled = profile.find(PLUGIN_ID).map(|m| m.enabled).unwrap_or(true);
    profile.upsert(InstalledMod {
        full_name: PLUGIN_ID.into(),
        owner: "ModHeim".into(),
        name: "GameTheme".into(),
        version: PLUGIN_VERSION.into(),
        enabled,
        icon: String::new(),
        description: "ModHeim's in-game UI theme. Recolors menus, panels and text. Visual only.".into(),
        dependencies: vec![],
        files: vec![PLUGIN_REL.into()],
        installed_at: chrono::Utc::now().to_rfc3339(),
    });
    if !enabled {
        // turning on a theme means the plugin should run
        crate::mods::set_enabled(&profiles::dir(&profile.name), &[PLUGIN_REL.into()], true)?;
        if let Some(m) = profile.find_mut(PLUGIN_ID) {
            m.enabled = true;
        }
    }
    profiles::save(profile)
}

pub fn write_theme(profile: &str, theme: &GameTheme) -> Result<()> {
    let dest = path(profile, THEME_REL);
    std::fs::create_dir_all(dest.parent().unwrap())?;
    // write then rename so the plugin's file watcher never sees half a file
    let tmp = dest.with_extension("theme.tmp");
    std::fs::write(&tmp, theme.to_file())?;
    std::fs::rename(&tmp, &dest)?;
    Ok(())
}

pub fn require_bepinex(profile: &str) -> Result<()> {
    if crate::doorstop::preloader_path(&profiles::dir(profile)).is_file() {
        Ok(())
    } else {
        Err(AppError::msg("This profile has no BepInEx. Repair it on the Profiles page first."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_file_roundtrip_and_sanitizing() {
        let t = GameTheme {
            name: "Mistlands\nEvil = true".into(),
            enabled: true,
            panel: "#7a5cc4".into(),
            button: "not a color".into(),
            heading: "C9A6FF".into(),
            text: "#EEE8FF".into(),
            panel_strength: 1.7,
            dump_sprites: false,
        };
        let file = t.to_file();
        assert!(file.contains("Name = Mistlands Evil = true\n"));
        assert!(file.contains("Panel = #7A5CC4"));
        assert!(file.contains("Button = #FFFFFF"));
        assert!(file.contains("Heading = #C9A6FF"));
        assert!(file.contains("PanelStrength = 1.00"));
        let back = GameTheme::parse(&file);
        assert!(back.enabled);
        assert_eq!(back.panel, "#7A5CC4");
        assert_eq!(back.panel_strength, 1.0);
    }

    #[test]
    fn plugin_is_embedded() {
        // a .NET assembly starts with the PE "MZ" header
        assert_eq!(&PLUGIN_DLL[..2], b"MZ");
    }
}
