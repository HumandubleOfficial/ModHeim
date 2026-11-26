//! Restore points: a copy of a profile (its mod list and BepInEx folder) taken before risky
//! changes such as updates and uninstalls, so a bad update is one click to undo.
//! Stored in %APPDATA%\ModHeim\snapshots\<profile>\<id>\.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::profiles;

const KEEP: usize = 10;
/// Logs and caches change constantly and aren't part of a profile's setup.
const SKIP: &[&str] = &["bepinex/logoutput.log", "bepinex/cache/", "bepinex/errorlog.log"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub profile: String,
    /// RFC 3339
    pub created: String,
    /// Why it was taken, e.g. "Before updating 3 mods".
    pub reason: String,
    pub mod_count: usize,
    pub bytes: u64,
}

fn root(profile: &str) -> PathBuf {
    crate::settings::data_dir().join("snapshots").join(profile)
}

fn skip(rel: &str) -> bool {
    let l = rel.to_ascii_lowercase().replace('\\', "/");
    SKIP.iter().any(|s| l == s.trim_end_matches('/') || l.starts_with(s))
}

fn copy_tree(from: &Path, to: &Path) -> Result<u64> {
    let mut bytes = 0;
    for e in walkdir::WalkDir::new(from).into_iter().flatten() {
        let Ok(rel) = e.path().strip_prefix(from) else { continue };
        if rel.as_os_str().is_empty() || skip(&rel.to_string_lossy()) {
            continue;
        }
        let dest = to.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else if e.file_type().is_file() {
            if let Some(p) = dest.parent() {
                std::fs::create_dir_all(p)?;
            }
            bytes += std::fs::copy(e.path(), &dest)?;
        }
    }
    Ok(bytes)
}

/// Take a restore point of `profile` now.
pub fn create(profile: &str, reason: &str) -> Result<Snapshot> {
    let p = profiles::load(profile)?;
    let now = chrono::Local::now();
    let mut id = now.format("%Y%m%d-%H%M%S").to_string();
    let base = root(profile);
    let mut n = 2;
    while base.join(&id).exists() {
        id = format!("{}-{n}", now.format("%Y%m%d-%H%M%S"));
        n += 1;
    }
    let dir = base.join(&id);
    let tmp = base.join(format!("{id}.partial"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let result = (|| -> Result<u64> { copy_tree(&profiles::dir(profile), &tmp) })();
    let bytes = match result {
        Ok(b) => b,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(e);
        }
    };
    let snap = Snapshot {
        id: id.clone(),
        profile: profile.to_string(),
        created: now.to_rfc3339(),
        reason: reason.to_string(),
        mod_count: p.mods.len(),
        bytes,
    };
    crate::settings::write_json_atomic(&tmp.join("snapshot.json"), &snap)?;
    std::fs::rename(&tmp, &dir)?;
    prune(profile);
    Ok(snap)
}

/// Newest first.
pub fn list(profile: &str) -> Vec<Snapshot> {
    let Ok(entries) = std::fs::read_dir(root(profile)) else { return Vec::new() };
    let mut out: Vec<Snapshot> = entries
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().ends_with(".partial"))
        .filter_map(|e| std::fs::read(e.path().join("snapshot.json")).ok())
        .filter_map(|b| serde_json::from_slice(&b).ok())
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

fn prune(profile: &str) {
    for old in list(profile).into_iter().skip(KEEP) {
        let _ = std::fs::remove_dir_all(root(profile).join(&old.id));
    }
}

fn safe_id(id: &str) -> Result<&str> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::msg("Unknown restore point"));
    }
    Ok(id)
}

pub fn delete(profile: &str, id: &str) -> Result<()> {
    let dir = root(profile).join(safe_id(id)?);
    if dir.is_dir() {
        std::fs::remove_dir_all(dir)?;
    }
    Ok(())
}

/// Put `profile` back the way it was at restore point `id`. The current state is saved as a
/// restore point first, so this can itself be undone.
pub fn restore(profile: &str, id: &str) -> Result<Snapshot> {
    let src = root(profile).join(safe_id(id)?);
    let snap: Snapshot = serde_json::from_slice(&std::fs::read(src.join("snapshot.json")).map_err(|_| AppError::msg("That restore point is gone"))?)?;
    create(profile, &format!("Before restoring {}", snap.created.get(..16).unwrap_or(&snap.created).replace('T', " ")))?;
    let dest = profiles::dir(profile);
    // Swap in a full copy: copy to a side folder first, then replace, so a failed copy leaves
    // the profile as it was.
    let staging = dest.with_file_name(format!("{profile}.restoring"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;
    if let Err(e) = copy_tree(&src, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    let _ = std::fs::remove_file(staging.join("snapshot.json"));
    // keep the live log; it isn't part of the snapshot
    let log = dest.join("BepInEx").join("LogOutput.log");
    if log.is_file() {
        let _ = std::fs::create_dir_all(staging.join("BepInEx"));
        let _ = std::fs::copy(&log, staging.join("BepInEx").join("LogOutput.log"));
    }
    let old = dest.with_file_name(format!("{profile}.old-{}", chrono::Local::now().format("%H%M%S")));
    std::fs::rename(&dest, &old)?;
    if let Err(e) = std::fs::rename(&staging, &dest) {
        let _ = std::fs::rename(&old, &dest);
        return Err(e.into());
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(snap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_list_restore_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        // SAFETY: only this test reads MODHEIM_DATA_DIR
        unsafe { std::env::set_var("MODHEIM_DATA_DIR", tmp.path()) };
        let name = "SnapTest";
        let dir = profiles::dir(name);
        std::fs::create_dir_all(dir.join("BepInEx/plugins/A")).unwrap();
        std::fs::create_dir_all(dir.join("BepInEx/cache")).unwrap();
        std::fs::write(dir.join("BepInEx/plugins/A/a.dll"), "v1").unwrap();
        std::fs::write(dir.join("BepInEx/LogOutput.log"), "log").unwrap();
        std::fs::write(dir.join("BepInEx/cache/x.dat"), "cache").unwrap();
        profiles::save(&profiles::Profile { name: name.into(), created: String::new(), mods: Vec::new() }).unwrap();

        let s = create(name, "Before updating").unwrap();
        assert!(!root(name).join(&s.id).join("BepInEx/LogOutput.log").exists());
        assert!(!root(name).join(&s.id).join("BepInEx/cache").exists());

        std::fs::write(dir.join("BepInEx/plugins/A/a.dll"), "v2").unwrap();
        std::fs::write(dir.join("BepInEx/plugins/A/new.dll"), "new").unwrap();
        restore(name, &s.id).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("BepInEx/plugins/A/a.dll")).unwrap(), "v1");
        assert!(!dir.join("BepInEx/plugins/A/new.dll").exists());
        assert_eq!(std::fs::read_to_string(dir.join("BepInEx/LogOutput.log")).unwrap(), "log");
        // the restore itself left a restore point of the "v2" state
        assert_eq!(list(name).len(), 2);
        assert!(restore(name, "../evil").is_err());
        unsafe { std::env::remove_var("MODHEIM_DATA_DIR") };
    }
}
