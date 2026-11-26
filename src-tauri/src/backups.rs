//! World and character backups. Save files are only ever *read*: each backup is a zip in
//! %APPDATA%\ModHeim\backups. Nothing here writes to the game's save folders, and there is no
//! automatic restore; the user copies files back themselves if they ever need to.
//!
//! Where Valheim keeps saves:
//!  - %USERPROFILE%\AppData\LocalLow\IronGate\Valheim\{worlds_local, characters_local, worlds, characters}
//!  - Xbox app version: characters and cloud saves in the app's container,
//!    %LOCALAPPDATA%\Packages\<package>\SystemAppData\wgs

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub file: String,
    /// RFC 3339
    pub created: String,
    pub reason: String,
    pub bytes: u64,
    pub files: usize,
    pub worlds: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSource {
    pub label: String,
    pub path: String,
    pub files: usize,
    pub bytes: u64,
}

pub fn backup_dir() -> PathBuf {
    crate::settings::data_dir().join("backups")
}

/// (label inside the zip, folder on disk) for every save folder that exists.
pub fn sources(package_family: Option<&str>) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if let Some(home) = dirs::home_dir() {
        let base = home.join("AppData").join("LocalLow").join("IronGate").join("Valheim");
        for d in ["worlds_local", "characters_local", "worlds", "characters"] {
            let p = base.join(d);
            if p.is_dir() {
                out.push((d.to_string(), p));
            }
        }
    }
    if let (Some(local), Some(pkg)) = (dirs::data_local_dir(), package_family) {
        let wgs = local.join("Packages").join(pkg).join("SystemAppData").join("wgs");
        if wgs.is_dir() {
            out.push(("xbox_saves".to_string(), wgs));
        }
    }
    out
}

fn files_in(dir: &Path) -> Vec<(PathBuf, std::fs::Metadata)> {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok().map(|m| (e.path().to_path_buf(), m)))
        .collect()
}

pub fn describe_sources(package_family: Option<&str>) -> Vec<SaveSource> {
    sources(package_family)
        .into_iter()
        .map(|(label, path)| {
            let f = files_in(&path);
            SaveSource { label, path: path.to_string_lossy().into(), files: f.len(), bytes: f.iter().map(|(_, m)| m.len()).sum() }
        })
        .collect()
}

/// Changes whenever any save file is added, removed, resized or rewritten.
fn fingerprint(srcs: &[(String, PathBuf)]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for (label, dir) in srcs {
        let mut f = files_in(dir);
        f.sort_by(|a, b| a.0.cmp(&b.0));
        for (p, m) in f {
            label.hash(&mut h);
            p.hash(&mut h);
            m.len().hash(&mut h);
            m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).hash(&mut h);
        }
    }
    format!("{:016x}", h.finish())
}

#[derive(Serialize, Deserialize, Default)]
struct State {
    fingerprint: String,
}

fn state_path() -> PathBuf {
    backup_dir().join("last.json")
}

/// World names from the worlds folders (new chunked format: one folder per world; older: .fwl files).
fn world_names(srcs: &[(String, PathBuf)]) -> Vec<String> {
    let mut names = Vec::new();
    for (label, dir) in srcs.iter().filter(|(l, _)| l.starts_with("worlds")) {
        let _ = label;
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                let world = if e.path().is_dir() {
                    Some(n)
                } else {
                    n.strip_suffix(".fwl").map(str::to_string)
                };
                if let Some(w) = world.filter(|w| !w.contains("_backup_")) {
                    if !names.contains(&w) {
                        names.push(w);
                    }
                }
            }
        }
    }
    names.sort();
    names
}

/// Zip every save folder into a new backup. With `only_if_changed`, does nothing (returns
/// None) when nothing changed since the last backup.
pub fn create(package_family: Option<&str>, reason: &str, only_if_changed: bool, keep: usize) -> Result<Option<Backup>> {
    let srcs = sources(package_family);
    if srcs.is_empty() {
        return Err(AppError::msg("Couldn't find Valheim's save folders."));
    }
    let fp = fingerprint(&srcs);
    let last: State = std::fs::read(state_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if only_if_changed && last.fingerprint == fp && !list().is_empty() {
        return Ok(None);
    }
    std::fs::create_dir_all(backup_dir())?;
    let now = chrono::Local::now();
    let name = format!("Valheim saves {}.zip", now.format("%Y-%m-%d %H-%M-%S"));
    let dest = backup_dir().join(&name);
    let tmp = dest.with_extension("zip.partial");
    let worlds = world_names(&srcs);
    let written = (|| -> Result<(u64, usize)> {
        let file = std::fs::File::create(&tmp)?;
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(3));
        let (mut bytes, mut count) = (0u64, 0usize);
        let mut buf = Vec::new();
        for (label, dir) in &srcs {
            for (path, _) in files_in(dir) {
                let Ok(rel) = path.strip_prefix(dir) else { continue };
                let inner = format!("{label}/{}", rel.to_string_lossy().replace('\\', "/"));
                buf.clear();
                // read-only open; a file locked by the game is skipped rather than failing the backup
                let Ok(mut f) = std::fs::File::open(&path) else { continue };
                if f.read_to_end(&mut buf).is_err() {
                    continue;
                }
                zip.start_file(&inner, opts)?;
                zip.write_all(&buf)?;
                bytes += buf.len() as u64;
                count += 1;
            }
        }
        let meta = serde_json::json!({ "created": now.to_rfc3339(), "reason": reason, "worlds": worlds });
        zip.set_comment(meta.to_string());
        zip.finish()?.flush()?;
        Ok((bytes, count))
    })();
    match written {
        Ok(_) => {}
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }
    std::fs::rename(&tmp, &dest)?;
    crate::settings::write_json_atomic(&state_path(), &State { fingerprint: fp })?;
    prune(keep);
    Ok(list().into_iter().find(|b| b.file == name))
}

pub fn list() -> Vec<Backup> {
    let Ok(rd) = std::fs::read_dir(backup_dir()) else { return Vec::new() };
    let mut out: Vec<Backup> = rd
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".zip"))
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let bytes = e.metadata().ok()?.len();
            let zip = zip::ZipArchive::new(std::fs::File::open(e.path()).ok()?).ok()?;
            let meta: serde_json::Value = serde_json::from_slice(zip.comment()).unwrap_or_default();
            Some(Backup {
                file,
                created: meta["created"].as_str().unwrap_or_default().to_string(),
                reason: meta["reason"].as_str().unwrap_or_default().to_string(),
                bytes,
                files: zip.len(),
                worlds: meta["worlds"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

fn prune(keep: usize) {
    for old in list().into_iter().skip(keep.max(1)) {
        let _ = std::fs::remove_file(backup_dir().join(old.file));
    }
}

pub fn delete(file: &str) -> Result<()> {
    if file.contains(['/', '\\']) || !file.ends_with(".zip") {
        return Err(AppError::msg("Unknown backup"));
    }
    let p = backup_dir().join(file);
    if p.is_file() {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_names_cover_both_formats() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path().join("worlds_local");
        std::fs::create_dir_all(w.join("MyWorld")).unwrap();
        std::fs::write(w.join("Old.fwl"), "x").unwrap();
        std::fs::write(w.join("Old.db"), "x").unwrap();
        std::fs::write(w.join("Old_backup_auto-1.fwl"), "x").unwrap();
        let names = world_names(&[("worlds_local".into(), w)]);
        assert_eq!(names, ["MyWorld", "Old"]);
    }

    #[test]
    fn fingerprint_changes_with_files() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path().join("characters_local");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("a.fch"), "1").unwrap();
        let src = vec![("characters_local".to_string(), d.clone())];
        let a = fingerprint(&src);
        assert_eq!(a, fingerprint(&src));
        std::fs::write(d.join("a.fch"), "22").unwrap();
        assert_ne!(a, fingerprint(&src));
    }

    /// Real backup of this PC's saves (reads them, writes a zip to ModHeim's folder):
    /// MODHEIM_REAL_BACKUP=1 cargo test real_backup -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_backup() {
        if std::env::var("MODHEIM_REAL_BACKUP").is_err() {
            return;
        }
        let pkg = Some("CoffeeStainStudios.Valheim_496a1srhmar9w");
        for s in describe_sources(pkg) {
            println!("{} {} files {} bytes {}", s.label, s.files, s.bytes, s.path);
        }
        let b = create(pkg, "Test from ModHeim", false, 10).unwrap().unwrap();
        println!("{b:?}");
        assert!(create(pkg, "unchanged", true, 10).unwrap().is_none(), "second run should skip");
    }
}
