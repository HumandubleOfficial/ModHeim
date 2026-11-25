//! Import profiles straight from other mod managers on this PC: r2modman and the
//! Thunderstore Mod Manager keep each profile as a folder with a `mods.yml` mod list and its
//! own `BepInEx/config`. Their files are only ever read, never changed.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::profiles::{ParsedExport, R2Mod, R2Version, R2x};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalProfile {
    /// "r2modman" | "Thunderstore Mod Manager"
    pub source: String,
    pub name: String,
    pub path: String,
    pub mod_count: usize,
    pub enabled_count: usize,
    /// Unix seconds mods.yml was last changed.
    pub modified: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModsYmlEntry {
    name: String,
    version_number: Option<R2Version>,
    #[serde(default = "yes")]
    enabled: bool,
}

fn yes() -> bool {
    true
}

const MAX_CONFIG: u64 = 5 * 1024 * 1024;

/// Where each manager keeps its Valheim profiles by default.
fn roots() -> Vec<(&'static str, PathBuf)> {
    let Some(appdata) = dirs::config_dir() else { return Vec::new() };
    vec![
        ("r2modman", appdata.join("r2modmanPlus-local").join("Valheim").join("profiles")),
        (
            "Thunderstore Mod Manager",
            appdata.join("Thunderstore Mod Manager").join("DataFolder").join("Valheim").join("profiles"),
        ),
    ]
}

fn parse_mods_yml(text: &str) -> Result<Vec<R2Mod>> {
    // An empty profile's mods.yml is "[]" or blank.
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let entries: Vec<ModsYmlEntry> = serde_yaml::from_str(text)?;
    Ok(entries
        .into_iter()
        .filter(|e| e.name.contains('-'))
        .map(|e| R2Mod {
            name: e.name,
            version: e.version_number.unwrap_or(R2Version { major: 0, minor: 0, patch: 0 }),
            enabled: e.enabled,
        })
        .collect())
}

fn summarize(source: &str, dir: &Path) -> Option<ExternalProfile> {
    let yml = dir.join("mods.yml");
    let text = std::fs::read_to_string(&yml).ok()?;
    let mods = parse_mods_yml(&text).ok()?;
    let modified = std::fs::metadata(&yml)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Some(ExternalProfile {
        source: source.to_string(),
        name: dir.file_name()?.to_string_lossy().to_string(),
        path: dir.to_string_lossy().to_string(),
        mod_count: mods.len(),
        enabled_count: mods.iter().filter(|m| m.enabled).count(),
        modified,
    })
}

/// Every r2modman / Thunderstore Mod Manager profile found in the default locations.
pub fn list() -> Vec<ExternalProfile> {
    let mut out = Vec::new();
    for (source, root) in roots() {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for e in entries.flatten() {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if let Some(p) = summarize(source, &e.path()) {
                    out.push(p);
                }
            }
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

/// Read a profile folder (one containing mods.yml) into the same shape as an .r2z export:
/// the mod list plus the files in its BepInEx/config.
pub fn load(dir: &Path) -> Result<ParsedExport> {
    let yml = dir.join("mods.yml");
    let text = std::fs::read_to_string(&yml).map_err(|_| {
        AppError::msg("That folder isn't an r2modman profile. Pick a profile folder (it has a mods.yml file in it).")
    })?;
    let mods = parse_mods_yml(&text).map_err(|e| AppError::msg(format!("Couldn't read mods.yml: {e}")))?;
    let mut configs = Vec::new();
    let config = dir.join("BepInEx").join("config");
    if config.is_dir() {
        for entry in walkdir::WalkDir::new(&config).into_iter().flatten() {
            if !entry.file_type().is_file() || entry.metadata().map(|m| m.len() > MAX_CONFIG).unwrap_or(true) {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(dir) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            // A local import is a full copy, so mods' own data files in config/ come too
            // (shared .r2z exports only carry the settings-type files).
            if crate::mods::safe_components(&rel).is_some() {
                configs.push((rel, std::fs::read(entry.path())?));
            }
        }
    }
    let profile_name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Imported".into());
    Ok(ParsedExport { r2x: R2x { profile_name, mods }, configs })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
- manifestVersion: 1
  name: denikson-BepInExPack_Valheim
  authorName: denikson
  description: >-
    BepInEx pack for Valheim.
  dependencies: []
  versionNumber:
    major: 5
    minor: 4
    patch: 2360
  enabled: true
  onlineSource: true
- manifestVersion: 1
  name: DJAventuras-OreWeakSpots
  versionNumber:
    major: 0
    minor: 9
    patch: 1
  enabled: false
"#;

    #[test]
    fn parses_r2modman_mods_yml() {
        let mods = parse_mods_yml(SAMPLE).unwrap();
        assert_eq!(mods.len(), 2);
        assert_eq!(mods[0].name, "denikson-BepInExPack_Valheim");
        assert_eq!(mods[0].version_string(), "5.4.2360");
        assert!(!mods[1].enabled);
        assert!(parse_mods_yml("").unwrap().is_empty());
        assert!(parse_mods_yml("[]").unwrap().is_empty());
    }

    #[test]
    fn loads_a_profile_folder_with_configs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("My Mods");
        std::fs::create_dir_all(dir.join("BepInEx/config/sub")).unwrap();
        std::fs::create_dir_all(dir.join("BepInEx/plugins/x")).unwrap();
        std::fs::write(dir.join("mods.yml"), SAMPLE).unwrap();
        std::fs::write(dir.join("BepInEx/config/a.cfg"), "x = 1").unwrap();
        std::fs::write(dir.join("BepInEx/config/sub/b.json"), "{}").unwrap();
        std::fs::write(dir.join("BepInEx/config/cache.dat"), "d").unwrap();
        std::fs::write(dir.join("BepInEx/plugins/x/p.dll"), "dll").unwrap();
        let parsed = load(&dir).unwrap();
        assert_eq!(parsed.r2x.profile_name, "My Mods");
        assert_eq!(parsed.r2x.mods.len(), 2);
        let mut rels: Vec<_> = parsed.configs.iter().map(|(r, _)| r.as_str()).collect();
        rels.sort();
        assert_eq!(rels, ["BepInEx/config/a.cfg", "BepInEx/config/cache.dat", "BepInEx/config/sub/b.json"]);
        assert_eq!(summarize("r2modman", &dir).unwrap().enabled_count, 1);
        assert!(load(tmp.path()).is_err());
    }

    /// Read-only look at the managers installed on this PC: `cargo test -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn lists_profiles_on_this_pc() {
        for p in list() {
            let parsed = load(Path::new(&p.path)).unwrap();
            println!("{} / {}: {} mods ({} on), {} config files", p.source, p.name, p.mod_count, p.enabled_count, parsed.configs.len());
            for m in parsed.r2x.mods.iter().take(5) {
                println!("  {} {} {}", m.name, m.version_string(), if m.enabled { "on" } else { "off" });
            }
        }
    }
}
