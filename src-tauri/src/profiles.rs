//! Mod profiles: each is a folder with its own BepInEx and a profile.json listing its mods.
//! Export/import uses r2modman's .r2z format so profiles can be swapped with friends.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::settings::{profiles_dir, write_json_atomic};

pub const MANIFEST: &str = "profile.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Files this mod owns, relative to the profile folder.
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub mods: Vec<InstalledMod>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub name: String,
    pub mod_count: usize,
    pub enabled_count: usize,
    pub has_bepinex: bool,
    pub created: String,
}

impl Profile {
    pub fn installed_versions(&self) -> HashMap<String, String> {
        self.mods
            .iter()
            .map(|m| (m.full_name.clone(), m.version.clone()))
            .collect()
    }

    pub fn find(&self, full_name: &str) -> Option<&InstalledMod> {
        self.mods.iter().find(|m| m.full_name.eq_ignore_ascii_case(full_name))
    }

    pub fn find_mut(&mut self, full_name: &str) -> Option<&mut InstalledMod> {
        self.mods.iter_mut().find(|m| m.full_name.eq_ignore_ascii_case(full_name))
    }

    pub fn upsert(&mut self, m: InstalledMod) {
        match self.find_mut(&m.full_name) {
            Some(existing) => *existing = m,
            None => self.mods.push(m),
        }
        self.mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }
}

pub fn validate_name(name: &str) -> Result<String> {
    let n = name.trim();
    let bad = n.is_empty()
        || n.len() > 48
        || n.ends_with('.')
        || n.chars().any(|c| "<>:\"/\\|?*".contains(c) || c.is_control());
    let reserved = ["con", "prn", "aux", "nul", "com1", "lpt1"];
    if bad || reserved.contains(&n.to_ascii_lowercase().as_str()) {
        return Err(AppError::msg(
            "Profile names can be up to 48 characters and can't contain < > : \" / \\ | ? *",
        ));
    }
    Ok(n.to_string())
}

pub fn dir(name: &str) -> PathBuf {
    profiles_dir().join(name)
}

pub fn exists(name: &str) -> bool {
    dir(name).join(MANIFEST).is_file()
}

pub fn load(name: &str) -> Result<Profile> {
    let path = dir(name).join(MANIFEST);
    let bytes = std::fs::read(&path)
        .map_err(|_| AppError::msg(format!("Profile \"{name}\" doesn't exist")))?;
    let mut p: Profile = serde_json::from_slice(&bytes)?;
    p.name = name.to_string(); // folder name is the source of truth
    Ok(p)
}

pub fn save(p: &Profile) -> Result<()> {
    write_json_atomic(&dir(&p.name).join(MANIFEST), p)
}

pub fn list() -> Result<Vec<ProfileSummary>> {
    std::fs::create_dir_all(profiles_dir())?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(profiles_dir())? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(p) = load(&name) else { continue };
        // BepInEx itself isn't counted as a mod
        let mods = || p.mods.iter().filter(|m| m.full_name != crate::thunderstore::BEPINEX_PACK);
        out.push(ProfileSummary {
            mod_count: mods().count(),
            enabled_count: mods().filter(|m| m.enabled).count(),
            has_bepinex: crate::doorstop::preloader_path(&dir(&name)).is_file(),
            created: p.created,
            name,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub fn create(name: &str) -> Result<Profile> {
    let name = validate_name(name)?;
    if dir(&name).exists() {
        return Err(AppError::msg(format!("A profile named \"{name}\" already exists")));
    }
    std::fs::create_dir_all(dir(&name).join("BepInEx").join("plugins"))?;
    let p = Profile {
        name,
        created: chrono::Utc::now().to_rfc3339(),
        mods: Vec::new(),
    };
    save(&p)?;
    Ok(p)
}

pub fn rename(old: &str, new: &str) -> Result<()> {
    let new = validate_name(new)?;
    if old == new {
        return Ok(());
    }
    // case-only renames are fine on Windows; anything else must be free
    if dir(&new).exists() && !old.eq_ignore_ascii_case(&new) {
        return Err(AppError::msg(format!("A profile named \"{new}\" already exists")));
    }
    std::fs::rename(dir(old), dir(&new))?;
    let mut p = load(&new)?;
    p.name = new;
    save(&p)
}

pub fn clone(src: &str, new: &str) -> Result<()> {
    let new = validate_name(new)?;
    if dir(&new).exists() {
        return Err(AppError::msg(format!("A profile named \"{new}\" already exists")));
    }
    let from = dir(src);
    let to = dir(&new);
    for entry in walkdir::WalkDir::new(&from) {
        let entry = entry.map_err(|e| AppError::msg(e.to_string()))?;
        let rel = entry.path().strip_prefix(&from).unwrap();
        let dest = to.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else {
            std::fs::copy(entry.path(), &dest)?;
        }
    }
    let mut p = load(&new)?;
    p.name = new;
    p.created = chrono::Utc::now().to_rfc3339();
    save(&p)
}

/// Moves the profile folder to the Recycle Bin so it can be restored.
pub fn delete(name: &str) -> Result<()> {
    let d = dir(name);
    if !d.exists() {
        return Ok(());
    }
    trash::delete(&d).map_err(|e| AppError::msg(format!("Couldn't move profile to the Recycle Bin: {e}")))
}

// ------------------------------------------------------------ r2modman .r2z

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct R2Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct R2Mod {
    pub name: String,
    pub version: R2Version,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct R2x {
    pub profile_name: String,
    #[serde(default)]
    pub mods: Vec<R2Mod>,
}

impl R2Mod {
    pub fn version_string(&self) -> String {
        format!("{}.{}.{}", self.version.major, self.version.minor, self.version.patch)
    }
}

const CONFIG_EXTS: &[&str] = &["cfg", "json", "yml", "yaml", "txt", "ini", "toml", "xml", "conf"];

pub(crate) fn is_config_file(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    lower.starts_with("bepinex/config/")
        && lower.rsplit('.').next().map(|e| CONFIG_EXTS.contains(&e)).unwrap_or(false)
}

pub fn r2x_for(p: &Profile) -> R2x {
    R2x {
        profile_name: p.name.clone(),
        mods: p
            .mods
            .iter()
            // ModHeim's own plugin isn't on Thunderstore, so r2modman couldn't install it
            .filter(|m| !m.full_name.starts_with("ModHeim-"))
            .map(|m| {
                let (major, minor, patch) = crate::thunderstore::version_key(&m.version);
                R2Mod {
                    name: m.full_name.clone(),
                    version: R2Version { major, minor, patch },
                    enabled: m.enabled,
                }
            })
            .collect(),
    }
}

/// Build an r2modman-compatible .r2z: export.r2x + the profile's config files.
pub fn export_bytes(name: &str) -> Result<Vec<u8>> {
    let p = load(name)?;
    let root = dir(name);
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        w.start_file("export.r2x", opts)?;
        w.write_all(serde_yaml::to_string(&r2x_for(&p))?.as_bytes())?;
        let config = root.join("BepInEx").join("config");
        if config.is_dir() {
            for entry in walkdir::WalkDir::new(&config).into_iter().flatten() {
                if !entry.file_type().is_file() {
                    continue;
                }
                let rel = entry
                    .path()
                    .strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                if is_config_file(&rel) {
                    w.start_file(&rel, opts)?;
                    w.write_all(&std::fs::read(entry.path())?)?;
                }
            }
        }
        w.finish()?;
    }
    Ok(buf.into_inner())
}

pub struct ParsedExport {
    pub r2x: R2x,
    /// (relative path, contents) of config files
    pub configs: Vec<(String, Vec<u8>)>,
}

pub fn parse_export(bytes: &[u8]) -> Result<ParsedExport> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))?;
    let mut r2x: Option<R2x> = None;
    let mut configs = Vec::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        if f.is_dir() {
            continue;
        }
        let Some(parts) = crate::mods::safe_components(f.name()) else { continue };
        let rel = parts.join("/");
        let mut data = Vec::new();
        f.read_to_end(&mut data)?;
        if rel.eq_ignore_ascii_case("export.r2x") {
            r2x = Some(serde_yaml::from_slice(&data)?);
        } else if is_config_file(&rel) && data.len() < 8 * 1024 * 1024 {
            configs.push((rel, data));
        }
    }
    let r2x = r2x.ok_or_else(|| AppError::msg("That file isn't a profile export (no export.r2x inside)"))?;
    Ok(ParsedExport { r2x, configs })
}

pub fn write_configs(name: &str, configs: &[(String, Vec<u8>)]) -> Result<()> {
    let root = dir(name);
    for (rel, data) in configs {
        let dest = rel.split('/').fold(root.clone(), |p: PathBuf, c| p.join(c));
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(dest, data)?;
    }
    Ok(())
}

// ------------------------------------------------------------ share codes (r2modman-compatible)

const SHARE_PREFIX: &str = "#r2modman";
const SHARE_CREATE: &str = "https://thunderstore.io/api/experimental/legacyprofile/create/";
const SHARE_GET: &str = "https://thunderstore.io/api/experimental/legacyprofile/get/";

#[derive(Deserialize)]
struct ShareResp {
    key: String,
}

pub async fn upload_share(client: &reqwest::Client, export: Vec<u8>) -> Result<String> {
    let body = format!(
        "{SHARE_PREFIX}\n{}",
        base64::engine::general_purpose::STANDARD.encode(export)
    );
    let r: ShareResp = client
        .post(SHARE_CREATE)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(r.key)
}

pub async fn download_share(client: &reqwest::Client, code: &str) -> Result<Vec<u8>> {
    let code = code.trim();
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::msg("That doesn't look like a profile code"));
    }
    let resp = client.get(format!("{SHARE_GET}{code}/")).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::msg("No profile found for that code (codes expire after a while)"));
    }
    let text = resp.error_for_status()?.text().await?;
    let b64 = text
        .strip_prefix(SHARE_PREFIX)
        .ok_or_else(|| AppError::msg("The shared data isn't an r2modman-style profile"))?
        .trim();
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| AppError::msg(format!("Shared profile data is corrupt: {e}")))
}

/// Pick a free profile name based on `base` ("Name", "Name (2)", ...).
pub fn free_name(base: &str) -> String {
    let base = validate_name(base).unwrap_or_else(|_| "Imported".to_string());
    if !dir(&base).exists() {
        return base;
    }
    (2..)
        .map(|i| format!("{base} ({i})"))
        .find(|n| !dir(n).exists())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn r2x_roundtrip_matches_r2modman_shape() {
        let yaml = "profileName: Friends\nmods:\n  - name: denikson-BepInExPack_Valheim\n    version:\n      major: 5\n      minor: 4\n      patch: 2360\n    enabled: true\n  - name: ValheimModding-Jotunn\n    version:\n      major: 2\n      minor: 30\n      patch: 2\n    enabled: false\n";
        let r: R2x = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(r.profile_name, "Friends");
        assert_eq!(r.mods[1].version_string(), "2.30.2");
        assert!(!r.mods[1].enabled);
        let back: R2x = serde_yaml::from_str(&serde_yaml::to_string(&r).unwrap()).unwrap();
        assert_eq!(back, r);
    }

    #[test]
    fn validates_names() {
        assert!(validate_name("Building w/ friends").is_err());
        assert!(validate_name("  ").is_err());
        assert!(validate_name("con").is_err());
        assert_eq!(validate_name(" Server Pack ").unwrap(), "Server Pack");
    }

    #[test]
    fn only_config_files_travel() {
        assert!(is_config_file("BepInEx/config/BepInEx.cfg"));
        assert!(is_config_file("BepInEx/config/sub/thing.yml"));
        assert!(!is_config_file("BepInEx/plugins/x.dll"));
        assert!(!is_config_file("BepInEx/config/evil.dll"));
    }
}
