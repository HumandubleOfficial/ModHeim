//! Play sessions (recorded by the launcher while the game runs) and a read-only look at the
//! worlds on this PC. Save files are only read: names, sizes and dates, never their contents
//! beyond the world header's name and seed name.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Unix seconds
    pub start: i64,
    pub end: i64,
    /// None = vanilla
    pub profile: Option<String>,
    pub errors: usize,
    pub crashed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileTotal {
    pub profile: Option<String>,
    pub sessions: usize,
    pub seconds: i64,
    pub crashes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub name: String,
    pub seed: Option<String>,
    pub bytes: u64,
    /// Unix seconds of the newest file
    pub modified: i64,
    /// Only map caches here: the world itself lives in the cloud / Xbox saves.
    pub cloud: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayStats {
    pub worlds: Vec<WorldInfo>,
    pub recent: Vec<Session>,
    pub by_profile: Vec<ProfileTotal>,
    pub total_seconds: i64,
    pub week_seconds: i64,
    pub sessions: usize,
    pub crashes: usize,
    /// Seconds played per day for the last 14 days, oldest first.
    pub days: Vec<i64>,
}

const KEEP: usize = 1000;

fn path() -> PathBuf {
    crate::settings::data_dir().join("sessions.json")
}

pub fn load() -> Vec<Session> {
    std::fs::read(path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn record(s: Session) {
    // very short runs are launch failures, not play
    if s.end - s.start < 20 {
        return;
    }
    let mut all = load();
    all.push(s);
    if all.len() > KEEP {
        let cut = all.len() - KEEP;
        all.drain(..cut);
    }
    let _ = crate::settings::write_json_atomic(&path(), &all);
}

fn crash_dir() -> PathBuf {
    std::env::temp_dir().join("IronGate").join("Valheim").join("Crashes")
}

/// Names of Valheim's crash report folders right now.
pub fn crash_reports() -> Vec<String> {
    std::fs::read_dir(crash_dir())
        .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default()
}

/// Errors BepInEx logged in a profile's (single-session) log.
pub fn log_errors(profile: &str) -> usize {
    let p = crate::profiles::dir(profile).join("BepInEx").join("LogOutput.log");
    std::fs::read(p)
        .map(|b| {
            String::from_utf8_lossy(&b)
                .lines()
                .filter(|l| l.starts_with("[Error") || l.starts_with("[Fatal"))
                .count()
        })
        .unwrap_or(0)
}

/// A .NET BinaryWriter string: 7-bit encoded length, then UTF-8.
fn dotnet_string(b: &[u8], p: &mut usize) -> Option<String> {
    let mut len = 0usize;
    let mut shift = 0;
    loop {
        let byte = *b.get(*p)?;
        *p += 1;
        len |= ((byte & 0x7F) as usize) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift > 28 {
            return None;
        }
    }
    let s = std::str::from_utf8(b.get(*p..*p + len)?).ok()?.to_string();
    *p += len;
    Some(s)
}

/// (name, seed name) from a world header (.fwl / _main.*.fwl2):
/// int32 size, int32 version, string name, string seed name, ...
fn world_header(b: &[u8]) -> Option<(String, String)> {
    let mut p = 8;
    let name = dotnet_string(b, &mut p)?;
    let seed = dotnet_string(b, &mut p)?;
    Some((name, seed))
}

fn mtime(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn world_folder(dir: &Path) -> Option<WorldInfo> {
    let mut bytes = 0;
    let mut modified = 0;
    let mut header = None;
    let mut real = false;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() {
            continue;
        }
        bytes += m.len();
        modified = modified.max(mtime(&m));
        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
        if n.ends_with(".fwl2") || n.ends_with(".fwl") {
            if let Ok(b) = std::fs::read(e.path()) {
                header = header.or_else(|| world_header(&b));
            }
        }
        if !n.starts_with("cacheminimap") {
            real = true;
        }
    }
    let folder = dir.file_name()?.to_string_lossy().into_owned();
    Some(WorldInfo {
        name: header.as_ref().map(|h| h.0.clone()).unwrap_or(folder),
        seed: header.map(|h| h.1),
        bytes,
        modified,
        cloud: !real,
    })
}

/// Older single-file format: <World>.fwl + <World>.db
fn legacy_world(p: &Path) -> Option<WorldInfo> {
    let b = std::fs::read(p).ok()?;
    let (name, seed) = world_header(&b).unwrap_or_default();
    let m = std::fs::metadata(p.with_extension("db")).ok();
    Some(WorldInfo {
        name: if name.is_empty() { p.file_stem()?.to_string_lossy().into_owned() } else { name },
        seed: (!seed.is_empty()).then_some(seed),
        bytes: m.as_ref().map(|m| m.len()).unwrap_or(0) + b.len() as u64,
        modified: m.as_ref().map(mtime).unwrap_or(0),
        cloud: false,
    })
}

/// Worlds in Valheim's local save folders (only read).
pub fn worlds() -> Vec<WorldInfo> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let base = home.join("AppData").join("LocalLow").join("IronGate").join("Valheim");
    let mut out: BTreeMap<String, WorldInfo> = BTreeMap::new();
    for sub in ["worlds_local", "worlds"] {
        let Ok(rd) = std::fs::read_dir(base.join(sub)) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let info = if p.is_dir() {
                world_folder(&p)
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("fwl")) && !p.to_string_lossy().contains("_backup_") {
                legacy_world(&p)
            } else {
                None
            };
            if let Some(w) = info {
                // the same world in both folders: keep the real one
                match out.get(&w.name) {
                    Some(old) if !old.cloud && w.cloud => {}
                    _ => {
                        out.insert(w.name.clone(), w);
                    }
                }
            }
        }
    }
    let mut v: Vec<WorldInfo> = out.into_values().collect();
    v.sort_by(|a, b| b.modified.cmp(&a.modified));
    v
}

pub fn summary(sessions: &[Session], now: i64) -> PlayStats {
    let mut by: BTreeMap<Option<String>, ProfileTotal> = BTreeMap::new();
    let mut days = vec![0i64; 14];
    let day = 86_400;
    let today_start = now - now.rem_euclid(day);
    for s in sessions {
        let secs = (s.end - s.start).max(0);
        let t = by.entry(s.profile.clone()).or_insert(ProfileTotal { profile: s.profile.clone(), sessions: 0, seconds: 0, crashes: 0 });
        t.sessions += 1;
        t.seconds += secs;
        t.crashes += s.crashed as usize;
        let ago = (today_start - (s.start - s.start.rem_euclid(day))) / day;
        if (0..14).contains(&ago) {
            days[13 - ago as usize] += secs;
        }
    }
    let mut by_profile: Vec<ProfileTotal> = by.into_values().collect();
    by_profile.sort_by(|a, b| b.seconds.cmp(&a.seconds));
    PlayStats {
        worlds: Vec::new(),
        recent: sessions.iter().rev().take(30).cloned().collect(),
        total_seconds: sessions.iter().map(|s| (s.end - s.start).max(0)).sum(),
        week_seconds: sessions.iter().filter(|s| s.start >= now - 7 * day).map(|s| (s.end - s.start).max(0)).sum(),
        sessions: sessions.len(),
        crashes: sessions.iter().filter(|s| s.crashed).count(),
        by_profile,
        days,
    }
}

pub fn play_stats() -> PlayStats {
    let now = chrono::Utc::now().timestamp();
    let mut s = summary(&load(), now);
    s.worlds = worlds();
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_world_header() {
        // int32 size, int32 version 42, "MyWorld", "AbCdEfGh12", then more
        let mut b = vec![0u8; 8];
        b[4] = 42;
        b.push(7);
        b.extend_from_slice(b"MyWorld");
        b.push(10);
        b.extend_from_slice(b"AbCdEfGh12");
        b.extend_from_slice(&[1, 2, 3, 4]);
        assert_eq!(world_header(&b), Some(("MyWorld".into(), "AbCdEfGh12".into())));
        assert_eq!(world_header(&[0, 0, 0]), None);
    }

    #[test]
    fn sums_sessions() {
        let day = 86_400;
        let now = 100 * day + 3600;
        let s = |start: i64, len: i64, p: Option<&str>, crashed: bool| Session {
            start,
            end: start + len,
            profile: p.map(String::from),
            errors: 0,
            crashed,
        };
        let list = vec![
            s(now - 20 * day, 1000, Some("Mods"), false),
            s(now - 2 * day, 600, Some("Mods"), true),
            s(now - 600, 300, None, false),
        ];
        let st = summary(&list, now);
        assert_eq!(st.total_seconds, 1900);
        assert_eq!(st.week_seconds, 900);
        assert_eq!(st.crashes, 1);
        assert_eq!(st.days[13], 300);
        assert_eq!(st.days[11], 600);
        assert_eq!(st.by_profile[0].profile.as_deref(), Some("Mods"));
        assert_eq!(st.recent[0].profile, None);
    }

    #[test]
    #[ignore]
    fn real_worlds() {
        for w in worlds() {
            println!("{} seed={:?} {} bytes cloud={}", w.name, w.seed, w.bytes, w.cloud);
        }
    }
}
