//! Profile health: problems in the last BepInEx log, and mod-level checks (missing or
//! turned-off dependencies, updates, deprecated mods, mods older than the latest game patch).

use std::collections::HashMap;

use serde::Serialize;

use crate::profiles::Profile;
use crate::thunderstore::{self as ts, BEPINEX_PACK, Index};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogIssue {
    /// error | warning
    pub level: String,
    /// The plugin (or "Unity Log") that logged it.
    pub source: String,
    pub message: String,
    /// Stack trace or extra lines, trimmed.
    pub detail: String,
    pub count: usize,
    /// Installed mod this most likely came from.
    pub mod_name: Option<String>,
    pub mod_full_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModIssue {
    pub full_name: String,
    pub name: String,
    /// missingDep | disabledDep | update | deprecated | outdated
    pub kind: String,
    pub detail: String,
    /// What the fix button does: install | enable | update (None = nothing to click)
    pub fix: Option<String>,
    pub fix_target: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub log_found: bool,
    /// Unix seconds the log was last written (= last modded launch).
    pub log_time: Option<i64>,
    pub log_errors: usize,
    pub log_warnings: usize,
    pub log_issues: Vec<LogIssue>,
    pub mod_issues: Vec<ModIssue>,
}

pub(crate) struct Entry {
    pub(crate) level: String,
    pub(crate) source: String,
    pub(crate) first: String,
    pub(crate) rest: Vec<String>,
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase()
}

/// Split a BepInEx LogOutput.log into entries: "[Level  :Source] message" plus continuation lines.
pub(crate) fn entries(log: &str) -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::new();
    for line in log.lines() {
        let parsed = line.strip_prefix('[').and_then(|rest| {
            let close = rest.find(']')?;
            let (level, source) = rest[..close].split_once(':')?;
            Some((level.trim().to_string(), source.trim().to_string(), rest[close + 1..].trim().to_string()))
        });
        match parsed {
            Some((level, source, msg)) if !level.contains(' ') && !level.is_empty() => {
                out.push(Entry { level, source, first: msg, rest: Vec::new() })
            }
            _ => {
                if let Some(last) = out.last_mut() {
                    if !line.trim().is_empty() && last.rest.len() < 40 {
                        last.rest.push(line.trim_end().to_string());
                    }
                }
            }
        }
    }
    out
}

/// Which installed mod an issue belongs to: the logging plugin's name, or a mod DLL named in the stack trace.
pub(crate) fn attribute(e: &Entry, profile: &Profile) -> Option<(String, String)> {
    let source = norm(&e.source);
    let skip = ["unitylog", "bepinex", "harmonyx", "preloader"];
    if !skip.contains(&source.as_str()) {
        for m in &profile.mods {
            let n = norm(&m.name);
            if !n.is_empty() && (n == source || source.contains(&n) || n.contains(&source)) {
                return Some((m.name.clone(), m.full_name.clone()));
            }
        }
    }
    let text = format!("{}\n{}", e.first, e.rest.join("\n"));
    for m in &profile.mods {
        if m.full_name == BEPINEX_PACK {
            continue;
        }
        for f in &m.files {
            let Some(stem) = f.rsplit('/').next().and_then(|n| n.strip_suffix(".dll")) else { continue };
            if stem.len() >= 4 && (text.contains(&format!("{stem}.")) || text.contains(&format!("[{stem}"))) {
                return Some((m.name.clone(), m.full_name.clone()));
            }
        }
    }
    None
}

pub fn analyze_log(log: &str, profile: &Profile) -> (Vec<LogIssue>, usize, usize) {
    let mut grouped: Vec<LogIssue> = Vec::new();
    let mut index: HashMap<(String, String, String), usize> = HashMap::new();
    let (mut errors, mut warnings) = (0, 0);
    for e in entries(log) {
        let level = match e.level.as_str() {
            "Error" | "Fatal" => "error",
            // Unity's own warnings are mostly noise (missing audio clips etc.); keep plugin warnings.
            "Warning" if e.source != "Unity Log" => "warning",
            _ => continue,
        };
        if level == "error" {
            errors += 1;
        } else {
            warnings += 1;
        }
        let mut message: String = e.first.chars().take(300).collect();
        if message.is_empty() {
            message = e.rest.first().cloned().unwrap_or_default();
        }
        let key = (level.to_string(), e.source.clone(), message.clone());
        if let Some(&i) = index.get(&key) {
            grouped[i].count += 1;
            continue;
        }
        let (mod_name, mod_full_name) = match attribute(&e, profile) {
            Some((n, f)) => (Some(n), Some(f)),
            None => (None, None),
        };
        index.insert(key, grouped.len());
        grouped.push(LogIssue {
            level: level.into(),
            source: e.source.clone(),
            message,
            detail: e.rest.iter().take(12).cloned().collect::<Vec<_>>().join("\n"),
            count: 1,
            mod_name,
            mod_full_name,
        });
    }
    // errors first, then most frequent
    grouped.sort_by(|a, b| (a.level != "error").cmp(&(b.level != "error")).then(b.count.cmp(&a.count)));
    grouped.truncate(60);
    (grouped, errors, warnings)
}

/// `patch`: (version, unix date) of the newest Valheim patch, if known.
pub fn check_mods(profile: &Profile, index: Option<&Index>, patch: Option<(&str, i64)>) -> Vec<ModIssue> {
    let mut out = Vec::new();
    let installed: HashMap<String, &crate::profiles::InstalledMod> =
        profile.mods.iter().map(|m| (m.full_name.to_ascii_lowercase(), m)).collect();

    for m in profile.mods.iter().filter(|m| m.enabled) {
        let pretty = m.name.replace('_', " ");
        for dep in &m.dependencies {
            let Some((dep_name, min_ver)) = ts::split_dependency(dep) else { continue };
            let dep_pretty = dep_name.split('-').nth(1).unwrap_or(&dep_name).replace('_', " ");
            match installed.get(&dep_name.to_ascii_lowercase()) {
                None => out.push(ModIssue {
                    full_name: m.full_name.clone(),
                    name: pretty.clone(),
                    kind: "missingDep".into(),
                    detail: format!("Needs {dep_pretty}, which isn't installed"),
                    fix: Some("install".into()),
                    fix_target: Some(dep_name.clone()),
                }),
                Some(d) if !d.enabled => out.push(ModIssue {
                    full_name: m.full_name.clone(),
                    name: pretty.clone(),
                    kind: "disabledDep".into(),
                    detail: format!("Needs {dep_pretty}, which is turned off"),
                    fix: Some("enable".into()),
                    fix_target: Some(d.full_name.clone()),
                }),
                Some(d) if ts::is_newer(&min_ver, &d.version) => out.push(ModIssue {
                    full_name: m.full_name.clone(),
                    name: pretty.clone(),
                    kind: "missingDep".into(),
                    detail: format!("Needs {dep_pretty} {min_ver} or newer (you have {})", d.version),
                    fix: Some("update".into()),
                    fix_target: Some(d.full_name.clone()),
                }),
                _ => {}
            }
        }
    }

    let Some(index) = index else { return out };
    for m in &profile.mods {
        if m.full_name.starts_with("ModHeim-") {
            continue;
        }
        let Some(p) = index.get(&m.full_name) else { continue };
        let pretty = m.name.replace('_', " ");
        if p.deprecated {
            out.push(ModIssue {
                full_name: m.full_name.clone(),
                name: pretty.clone(),
                kind: "deprecated".into(),
                detail: "Its author marked it deprecated; it may stop working or have a replacement".into(),
                fix: None,
                fix_target: None,
            });
        }
        if ts::is_newer(p.latest(), &m.version) {
            out.push(ModIssue {
                full_name: m.full_name.clone(),
                name: pretty.clone(),
                kind: "update".into(),
                detail: format!("Update available: {} → {}", m.version, p.latest()),
                fix: Some("update".into()),
                fix_target: Some(m.full_name.clone()),
            });
        } else if let Some((patch_ver, patch_time)) = patch {
            let updated = chrono::DateTime::parse_from_rfc3339(&p.date_updated).map(|d| d.timestamp()).unwrap_or(i64::MAX);
            if updated < patch_time && m.full_name != BEPINEX_PACK {
                out.push(ModIssue {
                    full_name: m.full_name.clone(),
                    name: pretty,
                    kind: "outdated".into(),
                    detail: format!("Not updated since Valheim {patch_ver}; usually fine, but check here if something breaks"),
                    fix: None,
                    fix_target: None,
                });
            }
        }
    }
    let order = |k: &str| match k {
        "missingDep" => 0,
        "disabledDep" => 1,
        "update" => 2,
        "deprecated" => 3,
        _ => 4,
    };
    out.sort_by_key(|i| order(&i.kind));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::InstalledMod;

    fn installed(full: &str, ver: &str, enabled: bool, deps: &[&str], files: &[&str]) -> InstalledMod {
        let (owner, name) = full.split_once('-').unwrap();
        InstalledMod {
            full_name: full.into(),
            owner: owner.into(),
            name: name.into(),
            version: ver.into(),
            enabled,
            icon: String::new(),
            description: String::new(),
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
            files: files.iter().map(|f| f.to_string()).collect(),
            installed_at: String::new(),
        }
    }

    fn profile() -> Profile {
        Profile {
            name: "P".into(),
            created: String::new(),
            mods: vec![
                installed("RandyKnapp-EpicLoot", "1.0.0", true, &["ValheimModding-Jotunn-2.0.0", "Gone-Lib-1.0.0"], &["BepInEx/plugins/RandyKnapp-EpicLoot/EpicLoot.dll"]),
                installed("ValheimModding-Jotunn", "1.5.0", true, &[], &["BepInEx/plugins/ValheimModding-Jotunn/Jotunn.dll"]),
                installed("A-Needy", "1.0.0", true, &["B-Off-1.0.0"], &[]),
                installed("B-Off", "1.0.0", false, &[], &[]),
            ],
        }
    }

    const LOG: &str = "[Info   :   BepInEx] Loading [Epic Loot 1.0.0]\n[Error  : Unity Log] NullReferenceException: Object reference not set\nStack trace:\nEpicLoot.MagicItem.Roll () (at <abc>:0)\nInventoryGui.Update () (at <def>:0)\n[Error  : Unity Log] NullReferenceException: Object reference not set\nStack trace:\nEpicLoot.MagicItem.Roll ()\n[Warning:    Jotunn] Something odd\n[Warning: Unity Log] Missing audio clip\n[Error  :   BepInEx] Could not load [Broken 1.0]\n";

    #[test]
    fn groups_and_attributes_log_problems() {
        let (issues, errors, warnings) = analyze_log(LOG, &profile());
        assert_eq!((errors, warnings), (3, 1)); // Unity warnings ignored
        let npe = issues.iter().find(|i| i.message.starts_with("NullReference")).unwrap();
        assert_eq!(npe.count, 2);
        assert_eq!(npe.mod_full_name.as_deref(), Some("RandyKnapp-EpicLoot"));
        assert!(npe.detail.contains("EpicLoot.MagicItem.Roll"));
        let warn = issues.iter().find(|i| i.level == "warning").unwrap();
        assert_eq!(warn.mod_full_name.as_deref(), Some("ValheimModding-Jotunn"));
        assert_eq!(issues[0].level, "error");
    }

    #[test]
    fn finds_dependency_problems() {
        let issues = check_mods(&profile(), None, None);
        let kinds: Vec<_> = issues.iter().map(|i| (i.kind.as_str(), i.fix_target.clone().unwrap_or_default())).collect();
        assert!(kinds.contains(&("missingDep", "Gone-Lib".to_string())));
        assert!(kinds.contains(&("missingDep", "ValheimModding-Jotunn".to_string()))); // too old
        assert!(kinds.contains(&("disabledDep", "B-Off".to_string())));
    }
}
