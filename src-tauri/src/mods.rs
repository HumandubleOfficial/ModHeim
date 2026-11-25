//! Putting Thunderstore package files into a profile's BepInEx folders, and taking them out.

use std::io::Read;
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};
use crate::thunderstore::BEPINEX_PACK;

pub const DISABLED_SUFFIX: &str = ".old";

/// Where one zip entry should go inside the profile.
#[derive(Debug, PartialEq, Eq)]
pub struct Target {
    /// Relative to the profile folder, forward slashes.
    pub rel: String,
    /// Config files are shared between mods and never overwritten or deleted.
    pub config: bool,
}

const ROOT_SKIP: &[&str] = &[
    "manifest.json",
    "readme.md",
    "changelog.md",
    "icon.png",
    "license",
    "license.md",
    "license.txt",
];

/// Split a zip entry name into safe components (rejects `..`, absolute paths, drive letters).
pub fn safe_components(entry: &str) -> Option<Vec<String>> {
    if entry.ends_with('/') || entry.ends_with('\\') {
        return None; // directory
    }
    let parts: Vec<String> = entry
        .replace('\\', "/")
        .split('/')
        .filter(|p| !p.is_empty() && *p != ".")
        .map(String::from)
        .collect();
    if parts.is_empty() || parts.iter().any(|p| p == ".." || p.contains(':')) {
        return None;
    }
    Some(parts)
}

/// Map a regular mod's zip entry to its place in the profile (r2modman-style layout).
pub fn map_entry(full_name: &str, entry: &str) -> Option<Target> {
    let mut parts = safe_components(entry)?;
    if parts.len() == 1 && ROOT_SKIP.contains(&parts[0].to_ascii_lowercase().as_str()) {
        return None;
    }
    if parts.len() > 1 && parts[0].eq_ignore_ascii_case("BepInEx") {
        parts.remove(0);
    }
    let first = parts[0].to_ascii_lowercase();
    let rest = || parts[1..].join("/");
    let t = |rel: String, config: bool| Some(Target { rel, config });
    match first.as_str() {
        "plugins" | "patchers" | "monomod" if parts.len() > 1 => {
            t(format!("BepInEx/{first}/{full_name}/{}", rest()), false)
        }
        "core" if parts.len() > 1 => t(format!("BepInEx/core/{}", rest()), false),
        "config" if parts.len() > 1 => t(format!("BepInEx/config/{}", rest()), true),
        _ => {
            let file = parts.last().unwrap().to_ascii_lowercase();
            if parts.len() == 1 && file.ends_with(".mm.dll") {
                t(format!("BepInEx/monomod/{full_name}/{}", parts[0]), false)
            } else {
                t(format!("BepInEx/plugins/{full_name}/{}", parts.join("/")), false)
            }
        }
    }
}

/// BepInExPack: only `BepInExPack_Valheim/BepInEx/**` goes into the profile.
/// (The Doorstop proxy files are handled separately, for the game folder.)
pub fn map_bepinex_entry(entry: &str) -> Option<Target> {
    let parts = safe_components(entry)?;
    if parts.len() < 3
        || !parts[0].eq_ignore_ascii_case("BepInExPack_Valheim")
        || !parts[1].eq_ignore_ascii_case("BepInEx")
    {
        return None;
    }
    let config = parts[2].eq_ignore_ascii_case("config");
    Some(Target { rel: format!("BepInEx/{}", parts[2..].join("/")), config })
}

fn to_path(profile: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(profile.to_path_buf(), |p, c| p.join(c))
}

/// Extract a package zip into the profile. Returns the files it owns (excluding configs).
pub fn install_zip(profile: &Path, full_name: &str, zip_path: &Path) -> Result<Vec<String>> {
    let is_pack = full_name.eq_ignore_ascii_case(BEPINEX_PACK);
    let mut zip = zip::ZipArchive::new(std::fs::File::open(zip_path)?)?;
    let mut owned = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        if entry.is_dir() {
            continue;
        }
        let target = if is_pack {
            map_bepinex_entry(entry.name())
        } else {
            map_entry(full_name, entry.name())
        };
        let Some(target) = target else { continue };
        let dest = to_path(profile, &target.rel);
        if target.config && dest.exists() {
            continue; // keep the player's settings
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf)?;
        std::fs::write(&dest, buf)?;
        // a leftover disabled copy would shadow nothing but confuse toggling
        let _ = std::fs::remove_file(with_suffix(&dest));
        if !target.config {
            owned.push(target.rel);
        }
    }
    if owned.is_empty() {
        return Err(AppError::msg(format!("{full_name} contained no files to install")));
    }
    owned.sort();
    owned.dedup();
    Ok(owned)
}

fn with_suffix(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(DISABLED_SUFFIX);
    PathBuf::from(s)
}

/// Enable or disable a mod by renaming its files to/from `*.old`.
pub fn set_enabled(profile: &Path, files: &[String], enabled: bool) -> Result<()> {
    for rel in files {
        let on = to_path(profile, rel);
        let off = with_suffix(&on);
        let (from, to) = if enabled { (off, on) } else { (on, off) };
        if from.exists() {
            if to.exists() {
                std::fs::remove_file(&to)?;
            }
            std::fs::rename(&from, &to)?;
        }
    }
    Ok(())
}

/// Delete a mod's files (either state) and tidy up the folders they leave empty.
pub fn remove_files(profile: &Path, files: &[String]) -> Result<()> {
    let bepinex = profile.join("BepInEx");
    for rel in files {
        let on = to_path(profile, rel);
        for p in [with_suffix(&on), on] {
            if p.exists() {
                std::fs::remove_file(&p)?;
            }
        }
        // walk up removing empty folders, stopping at BepInEx\<kind>
        let mut dir = to_path(profile, rel).parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            if d.parent() == Some(bepinex.as_path()) || d == bepinex || !d.starts_with(&bepinex) {
                break;
            }
            if std::fs::remove_dir(&d).is_err() {
                break; // not empty
            }
            dir = d.parent().map(Path::to_path_buf);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn maps_common_layouts() {
        let m = |e| map_entry("Owner-Mod", e).map(|t| t.rel);
        assert_eq!(m(r"plugins\Jotunn.dll").as_deref(), Some("BepInEx/plugins/Owner-Mod/Jotunn.dll"));
        assert_eq!(m("BepInEx/plugins/Sub/x.dll").as_deref(), Some("BepInEx/plugins/Owner-Mod/Sub/x.dll"));
        assert_eq!(m("Mod.dll").as_deref(), Some("BepInEx/plugins/Owner-Mod/Mod.dll"));
        assert_eq!(m("assets/bundle").as_deref(), Some("BepInEx/plugins/Owner-Mod/assets/bundle"));
        assert_eq!(m("patchers/P.dll").as_deref(), Some("BepInEx/patchers/Owner-Mod/P.dll"));
        assert_eq!(m("Fix.mm.dll").as_deref(), Some("BepInEx/monomod/Owner-Mod/Fix.mm.dll"));
        let cfg = map_entry("Owner-Mod", "config/owner.mod.cfg").unwrap();
        assert_eq!(cfg, Target { rel: "BepInEx/config/owner.mod.cfg".into(), config: true });
        assert_eq!(m("manifest.json"), None);
        assert_eq!(m("README.md"), None);
        assert_eq!(m("../evil.dll"), None);
        assert_eq!(m("C:/evil.dll"), None);
        assert_eq!(m("plugins/"), None);
    }

    #[test]
    fn maps_bepinex_pack() {
        let m = |e| map_bepinex_entry(e).map(|t| t.rel);
        assert_eq!(
            m("BepInExPack_Valheim/BepInEx/core/BepInEx.Preloader.dll").as_deref(),
            Some("BepInEx/core/BepInEx.Preloader.dll")
        );
        assert!(map_bepinex_entry("BepInExPack_Valheim/BepInEx/config/BepInEx.cfg").unwrap().config);
        assert_eq!(m("BepInExPack_Valheim/winhttp.dll"), None);
        assert_eq!(m("README.md"), None);
    }

    fn make_zip(dir: &Path, files: &[(&str, &str)]) -> PathBuf {
        let p = dir.join("pkg.zip");
        let mut w = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
        for (name, body) in files {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        w.finish().unwrap();
        p
    }

    #[test]
    fn install_toggle_remove_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let profile = tmp.path().join("profile");
        let zip = make_zip(
            tmp.path(),
            &[
                ("manifest.json", "{}"),
                (r"plugins\Mod.dll", "dll"),
                ("config/mod.cfg", "default"),
            ],
        );
        // a config the player already edited must survive
        std::fs::create_dir_all(profile.join("BepInEx/config")).unwrap();
        std::fs::write(profile.join("BepInEx/config/mod.cfg"), "mine").unwrap();

        let files = install_zip(&profile, "Owner-Mod", &zip).unwrap();
        assert_eq!(files, vec!["BepInEx/plugins/Owner-Mod/Mod.dll"]);
        let dll = profile.join("BepInEx/plugins/Owner-Mod/Mod.dll");
        assert!(dll.is_file());
        assert_eq!(std::fs::read_to_string(profile.join("BepInEx/config/mod.cfg")).unwrap(), "mine");

        set_enabled(&profile, &files, false).unwrap();
        assert!(!dll.exists());
        assert!(profile.join("BepInEx/plugins/Owner-Mod/Mod.dll.old").is_file());
        set_enabled(&profile, &files, true).unwrap();
        assert!(dll.is_file());

        remove_files(&profile, &files).unwrap();
        assert!(!profile.join("BepInEx/plugins/Owner-Mod").exists());
        assert!(profile.join("BepInEx/plugins").is_dir()); // kind folder is kept
        assert!(profile.join("BepInEx/config/mod.cfg").is_file());
    }
}
