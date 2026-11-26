//! Safe launch guard and the live game log.
//!  - Before a modded launch: mods that use things the installed game no longer has, and mods
//!    that kept erroring last time.
//!  - While the game runs: watch BepInEx's log and warn when one problem repeats nonstop (the
//!    kind that makes the game stop responding), naming the mod most likely behind it.
//!  - The log itself, for the Game Log page, and a shareable crash report.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::compat;
use crate::error::Result;
use crate::health;
use crate::profiles::{self, Profile};

// ------------------------------------------------------------ before launch

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GuardIssue {
    pub full_name: String,
    pub name: String,
    /// Things the mod uses that this game version doesn't have.
    pub missing: Vec<String>,
    /// Errors traced to this mod in the last launch.
    pub errors: usize,
    pub example: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCheck {
    pub profile: String,
    pub game_version: Option<String>,
    pub issues: Vec<GuardIssue>,
}

/// Errors from the same mod past this count in one session are worth a warning.
const ERROR_THRESHOLD: usize = 25;

fn log_path(profile: &str) -> PathBuf {
    profiles::dir(profile).join("BepInEx").join("LogOutput.log")
}

/// Per-mod error counts from a log, attributing errors by plugin, stack trace, or (for
/// missing-member errors) by which mod uses that member.
fn errors_by_mod(log: &str, profile: &Profile, dir: &Path) -> HashMap<String, (String, usize, String)> {
    let mut out: HashMap<String, (String, usize, String)> = HashMap::new();
    let mut by_message: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for e in health::entries(log) {
        if e.level != "Error" && e.level != "Fatal" {
            continue;
        }
        let text = format!("{}\n{}", e.first, e.rest.join("\n"));
        let culprits = match health::attribute(&e, profile) {
            Some(c) => vec![c],
            None => by_message.entry(e.first.clone()).or_insert_with(|| compat::mods_using(&text, profile, dir)).clone(),
        };
        for (name, full) in culprits {
            let entry = out.entry(full).or_insert((name, 0, e.first.chars().take(200).collect()));
            entry.1 += 1;
        }
    }
    out
}

pub fn launch_check(profile_name: &str, game_dir: &Path, game_version: Option<String>) -> Result<LaunchCheck> {
    let profile = profiles::load(profile_name)?;
    let dir = profiles::dir(profile_name);
    let mut issues: Vec<GuardIssue> = compat::check_profile(&profile, &dir, game_dir)
        .into_iter()
        .map(|c| GuardIssue { full_name: c.full_name, name: c.name, missing: c.missing, errors: 0, example: None })
        .collect();
    if let Ok(log) = std::fs::read(log_path(profile_name)) {
        let log = String::from_utf8_lossy(&log);
        for (full, (name, count, example)) in errors_by_mod(&log, &profile, &dir) {
            // only mods that are still on
            if count < ERROR_THRESHOLD || !profile.find(&full).is_some_and(|m| m.enabled) {
                continue;
            }
            match issues.iter_mut().find(|i| i.full_name == full) {
                Some(i) => {
                    i.errors = count;
                    i.example = Some(example);
                }
                None => issues.push(GuardIssue { full_name: full, name: name.replace('_', " "), missing: Vec::new(), errors: count, example: Some(example) }),
            }
        }
    }
    // the worst first: errors seen in practice, then most missing pieces
    issues.sort_by(|a, b| b.errors.cmp(&a.errors).then(b.missing.len().cmp(&a.missing.len())));
    Ok(LaunchCheck { profile: profile_name.to_string(), game_version, issues })
}

// ------------------------------------------------------------ while the game runs

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorStorm {
    pub profile: String,
    pub message: String,
    pub count: usize,
    /// (name, full name) of the mods most likely behind it
    pub mods: Vec<(String, String)>,
}

/// Follows one profile's LogOutput.log during a modded session.
pub struct LogWatch {
    profile: String,
    path: PathBuf,
    offset: u64,
    head: Vec<u8>,
    window_start: Instant,
    counts: HashMap<String, usize>,
    warned: std::collections::HashSet<String>,
    culprits: HashMap<String, Vec<(String, String)>>,
}

/// Same problem this many times inside one window means it's firing every frame.
const STORM_COUNT: usize = 60;
const STORM_WINDOW: Duration = Duration::from_secs(30);

fn read_head(path: &Path) -> Vec<u8> {
    let mut buf = vec![0u8; 256];
    match std::fs::File::open(path).and_then(|mut f| f.read(&mut buf)) {
        Ok(n) => {
            buf.truncate(n);
            buf
        }
        Err(_) => Vec::new(),
    }
}

impl LogWatch {
    /// Start following `profile`'s log from its current end (the old session's content).
    pub fn new(profile: &str) -> LogWatch {
        let path = log_path(profile);
        let offset = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        LogWatch {
            profile: profile.to_string(),
            head: read_head(&path),
            path,
            offset,
            window_start: Instant::now(),
            counts: HashMap::new(),
            warned: Default::default(),
            culprits: HashMap::new(),
        }
    }

    /// Read what the game wrote since last time; returns any new error storms.
    pub fn poll(&mut self) -> Vec<ErrorStorm> {
        let len = std::fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
        let head = read_head(&self.path);
        // BepInEx rewrites the log when the game starts: begin again from the top
        if len < self.offset || (!self.head.is_empty() && head != self.head && head.len() >= self.head.len().min(64)) {
            self.offset = 0;
        }
        self.head = head;
        if len <= self.offset {
            return Vec::new();
        }
        let mut chunk = Vec::new();
        if let Ok(mut f) = std::fs::File::open(&self.path) {
            let _ = f.seek(SeekFrom::Start(self.offset));
            let _ = f.take((len - self.offset).min(8 << 20)).read_to_end(&mut chunk);
        }
        // only whole lines; the rest is read next time
        let cut = chunk.iter().rposition(|&c| c == b'\n').map(|i| i + 1).unwrap_or(0);
        self.offset += cut as u64;
        let text = String::from_utf8_lossy(&chunk[..cut]);
        if self.window_start.elapsed() > STORM_WINDOW {
            self.window_start = Instant::now();
            self.counts.clear();
        }
        let mut storms = Vec::new();
        let profile = profiles::load(&self.profile).ok();
        let dir = profiles::dir(&self.profile);
        for e in health::entries(&text) {
            if e.level != "Error" && e.level != "Fatal" {
                continue;
            }
            let key: String = e.first.chars().take(200).collect();
            let n = self.counts.entry(key.clone()).or_insert(0);
            *n += 1;
            if *n >= STORM_COUNT && !self.warned.contains(&key) {
                self.warned.insert(key.clone());
                let mods = match &profile {
                    Some(p) => {
                        let text = format!("{}\n{}", e.first, e.rest.join("\n"));
                        self.culprits
                            .entry(key.clone())
                            .or_insert_with(|| health::attribute(&e, p).map(|c| vec![c]).unwrap_or_else(|| compat::mods_using(&text, p, &dir)))
                            .clone()
                    }
                    None => Vec::new(),
                };
                storms.push(ErrorStorm { profile: self.profile.clone(), message: key, count: *n, mods });
            }
        }
        storms
    }
}

/// The profile the game folder is set up to load right now, from Doorstop's target path
/// (<profiles>\<name>\BepInEx\core\BepInEx.Preloader.dll), if it's one of ours.
pub fn modded_profile(game_dir: &Path) -> Option<String> {
    let st = crate::doorstop::status(game_dir);
    if st.enabled != Some(true) {
        return None;
    }
    let target = PathBuf::from(st.target?);
    let profile_dir = target.parent()?.parent()?.parent()?;
    let profiles_root = crate::settings::profiles_dir();
    let same = |a: &Path, b: &Path| dunce::canonicalize(a).ok() == dunce::canonicalize(b).ok();
    if !same(profile_dir.parent()?, &profiles_root) {
        return None;
    }
    Some(profile_dir.file_name()?.to_string_lossy().to_string())
}

// ------------------------------------------------------------ the log page and crash report

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogChunk {
    pub text: String,
    /// Pass back as `from` next time.
    pub next: u64,
    /// The log was rewritten (new game session): drop what you have and start over.
    pub reset: bool,
    pub exists: bool,
}

const FIRST_READ: u64 = 768 * 1024;

pub fn read_log(profile: &str, from: u64) -> LogChunk {
    let path = log_path(profile);
    let Ok(mut f) = std::fs::File::open(&path) else {
        return LogChunk { text: String::new(), next: 0, reset: from > 0, exists: false };
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let (mut start, reset) = if from > len || from == 0 { (len.saturating_sub(FIRST_READ), from > 0) } else { (from, false) };
    if start == len {
        return LogChunk { text: String::new(), next: len, reset, exists: true };
    }
    let mut buf = Vec::new();
    let _ = f.seek(SeekFrom::Start(start));
    let _ = f.take(len - start).read_to_end(&mut buf);
    // a cut-off first line on the initial read
    if start > 0 && (from == 0 || reset) {
        if let Some(i) = buf.iter().position(|&c| c == b'\n') {
            buf.drain(..=i);
            start += i as u64 + 1;
        }
    }
    let cut = buf.iter().rposition(|&c| c == b'\n').map(|i| i + 1).unwrap_or(0);
    buf.truncate(cut);
    let next = start + cut as u64;
    LogChunk { text: String::from_utf8_lossy(&buf).into_owned(), next, reset, exists: true }
}

/// Hide the Windows user name in paths before a report is shared.
fn redact(text: &str) -> String {
    let mut out = text.to_string();
    if let Some(home) = dirs::home_dir() {
        let h = home.to_string_lossy().to_string();
        out = out.replace(&h, "%USERPROFILE%").replace(&h.replace('\\', "/"), "%USERPROFILE%");
        if let Some(user) = home.file_name().map(|n| n.to_string_lossy().to_string()) {
            if user.len() >= 3 {
                out = out.replace(&format!("\\{user}\\"), "\\<user>\\").replace(&format!("/{user}/"), "/<user>/");
            }
        }
    }
    out
}

pub fn crash_report(profile_name: &str, app_version: &str, game: Option<&crate::game::GameInstall>) -> Result<String> {
    use std::fmt::Write;
    let profile = profiles::load(profile_name)?;
    let dir = profiles::dir(profile_name);
    let log = std::fs::read(log_path(profile_name)).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let mut r = String::new();
    let _ = writeln!(r, "ModHeim crash report");
    let _ = writeln!(r, "=====================");
    let _ = writeln!(r, "ModHeim {app_version}");
    if let Some(g) = game {
        let _ = writeln!(r, "Valheim {} ({:?})", crate::game::current_version(g).or(g.version.clone()).unwrap_or_else(|| "?".into()), g.platform);
    }
    let _ = writeln!(r, "Profile: {} ({} mods, {} on)\n", profile.name, profile.mods.len(), profile.mods.iter().filter(|m| m.enabled).count());

    let _ = writeln!(r, "Mods");
    let _ = writeln!(r, "----");
    let mut mods: Vec<_> = profile.mods.iter().collect();
    mods.sort_by(|a, b| a.full_name.to_lowercase().cmp(&b.full_name.to_lowercase()));
    for m in mods {
        let _ = writeln!(r, "{} {} {}", if m.enabled { "[on] " } else { "[off]" }, m.full_name, m.version);
    }

    if let Some(g) = game {
        let compat = compat::check_profile(&profile, &dir, &g.path);
        if !compat.is_empty() {
            let _ = writeln!(r, "\nMods using things this game version doesn't have");
            let _ = writeln!(r, "-------------------------------------------------");
            for c in compat {
                let _ = writeln!(r, "{}: {}", c.name, c.missing.join(", "));
            }
        }
    }

    let (issues, errors, warnings) = health::analyze_log(&log, &profile);
    let _ = writeln!(r, "\nLast launch: {errors} errors, {warnings} warnings");
    let _ = writeln!(r, "-----------------------------------");
    for i in issues.iter().take(15) {
        let who = i.mod_name.as_deref().map(|m| format!(" [{m}]")).unwrap_or_default();
        let _ = writeln!(r, "{} x{} {}{}: {}", i.level, i.count, i.source, who, i.message);
        for l in i.detail.lines().take(4) {
            let _ = writeln!(r, "      {l}");
        }
    }

    let tail: Vec<&str> = log.lines().rev().take(80).collect();
    let _ = writeln!(r, "\nEnd of LogOutput.log");
    let _ = writeln!(r, "--------------------");
    for l in tail.into_iter().rev() {
        let _ = writeln!(r, "{l}");
    }
    Ok(redact(&r))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storm_detection_and_session_reset() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("LogOutput.log");
        std::fs::write(&path, "[Info   :   BepInEx] old session\n").unwrap();
        let mut w = LogWatch {
            profile: "nope".into(),
            path: path.clone(),
            offset: std::fs::metadata(&path).unwrap().len(),
            head: read_head(&path),
            window_start: Instant::now(),
            counts: HashMap::new(),
            warned: Default::default(),
            culprits: HashMap::new(),
        };
        assert!(w.poll().is_empty());
        // new session rewrites the file, then the same error repeats every frame
        let mut s = String::from("[Message:   BepInEx] new session starting\n");
        for _ in 0..70 {
            s.push_str("[Error  : Unity Log] MissingFieldException: Field not found: bool .InstanceRenderer.m_frustumCull\nStack trace:\n  at X\n");
        }
        std::fs::write(&path, &s).unwrap();
        let storms = w.poll();
        assert_eq!(storms.len(), 1);
        assert!(storms[0].message.contains("m_frustumCull"));
        assert!(w.poll().is_empty(), "warns once per problem");
    }

    #[test]
    fn redacts_user_paths() {
        let home = dirs::home_dir().unwrap();
        let line = format!("{}\\AppData\\x.dll", home.display());
        assert!(redact(&line).starts_with("%USERPROFILE%"));
        assert!(!redact(&line).contains(&*home.to_string_lossy()));
    }

    /// Read-only check of a real profile: MODHEIM_SCAN_PROFILE=Mods cargo test real_launch_check -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_launch_check() {
        let Ok(name) = std::env::var("MODHEIM_SCAN_PROFILE") else { return };
        let game = std::path::Path::new(r"C:\XboxGames\Valheim\Content");
        let t = std::time::Instant::now();
        let c = launch_check(&name, game, None).unwrap();
        for i in &c.issues {
            println!("{} missing={:?} errors={}", i.name, i.missing, i.errors);
        }
        println!("{} issues in {:?}", c.issues.len(), t.elapsed());
    }
}
