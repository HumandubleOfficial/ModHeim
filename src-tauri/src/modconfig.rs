//! Reading and editing BepInEx `.cfg` files. Edits only touch the `Key = value` lines,
//! so comments, ordering and anything we don't understand are kept exactly as they were.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::profiles;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CfgEntry {
    pub section: String,
    pub key: String,
    pub value: String,
    pub description: String,
    /// bool | int | float | enum | flags | string
    pub kind: String,
    /// The raw "Setting type" BepInEx wrote, e.g. "Single" or "KeyboardShortcut".
    pub type_name: String,
    pub default: Option<String>,
    pub choices: Vec<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfgSection {
    pub name: String,
    pub entries: Vec<CfgEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfgFile {
    pub file: String,
    pub plugin: Option<String>,
    pub version: Option<String>,
    pub guid: Option<String>,
    pub sections: Vec<CfgSection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfgSummary {
    pub file: String,
    pub plugin: Option<String>,
    pub guid: Option<String>,
    pub entries: usize,
    pub modified: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CfgChange {
    pub section: String,
    pub key: String,
    pub value: String,
}

#[derive(Default)]
struct Pending {
    desc: Vec<String>,
    type_name: String,
    default: Option<String>,
    choices: Vec<String>,
    flags: bool,
    range: Option<(f64, f64)>,
}

fn kind_for(p: &Pending) -> &'static str {
    if p.flags {
        return "flags";
    }
    if !p.choices.is_empty() {
        return "enum";
    }
    match p.type_name.as_str() {
        "Boolean" => "bool",
        "Int32" | "Int64" | "Int16" | "UInt32" | "UInt64" | "UInt16" | "Byte" | "SByte" => "int",
        "Single" | "Double" | "Decimal" => "float",
        _ => "string",
    }
}

/// "From 0 to 100" / "From 0.5 to 2"
fn parse_range(s: &str) -> Option<(f64, f64)> {
    let rest = s.trim().strip_prefix("From ")?;
    let (a, b) = rest.split_once(" to ")?;
    Some((a.trim().parse().ok()?, b.trim().parse().ok()?))
}

pub fn parse(file: &str, text: &str) -> CfgFile {
    let mut out = CfgFile { file: file.to_string(), plugin: None, version: None, guid: None, sections: Vec::new() };
    let mut section: Option<CfgSection> = None;
    let mut p = Pending::default();

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(h) = line.strip_prefix("## Settings file was created by plugin ") {
            // "Name v1.2.3"
            match h.rsplit_once(" v") {
                Some((name, ver)) => {
                    out.plugin = Some(name.trim().to_string());
                    out.version = Some(ver.trim().to_string());
                }
                None => out.plugin = Some(h.trim().to_string()),
            }
            continue;
        }
        if let Some(g) = line.strip_prefix("## Plugin GUID:") {
            out.guid = Some(g.trim().to_string());
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            if let Some(s) = section.take() {
                out.sections.push(s);
            }
            section = Some(CfgSection { name: line[1..line.len() - 1].trim().to_string(), entries: Vec::new() });
            p = Pending::default();
            continue;
        }
        if let Some(d) = line.strip_prefix("##") {
            p.desc.push(d.trim().to_string());
            continue;
        }
        if let Some(meta) = line.strip_prefix('#') {
            let meta = meta.trim();
            if let Some(t) = meta.strip_prefix("Setting type:") {
                p.type_name = t.trim().to_string();
            } else if let Some(d) = meta.strip_prefix("Default value:") {
                p.default = Some(d.trim().to_string());
            } else if let Some(c) = meta.strip_prefix("Acceptable values:") {
                p.choices = c.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
            } else if let Some(r) = meta.strip_prefix("Acceptable value range:") {
                p.range = parse_range(r);
            } else if meta.starts_with("Multiple values can be set") {
                p.flags = true;
            }
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let sec = section.get_or_insert_with(|| CfgSection { name: String::new(), entries: Vec::new() });
            let kind = kind_for(&p).to_string();
            sec.entries.push(CfgEntry {
                section: sec.name.clone(),
                key: k.trim().to_string(),
                value: v.trim().to_string(),
                description: p.desc.join("\n").trim().to_string(),
                kind,
                type_name: std::mem::take(&mut p.type_name),
                default: p.default.take(),
                choices: std::mem::take(&mut p.choices),
                min: p.range.map(|r| r.0),
                max: p.range.map(|r| r.1),
            });
            p = Pending::default();
        }
    }
    if let Some(s) = section {
        out.sections.push(s);
    }
    out.sections.retain(|s| !s.entries.is_empty());
    out
}

/// Replace values in place. Unknown keys are an error so the UI never silently loses an edit.
pub fn apply_changes(text: &str, changes: &[CfgChange]) -> Result<String> {
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    for c in changes {
        let value = c.value.replace(['\r', '\n'], " ");
        let mut current = String::new();
        let mut done = false;
        for line in lines.iter_mut() {
            let t = line.trim();
            if t.starts_with('[') && t.ends_with(']') {
                current = t[1..t.len() - 1].trim().to_string();
                continue;
            }
            if t.starts_with('#') || current != c.section {
                continue;
            }
            if let Some((k, _)) = t.split_once('=') {
                if k.trim() == c.key {
                    *line = format!("{} = {}", k.trim(), value.trim());
                    done = true;
                    break;
                }
            }
        }
        if !done {
            return Err(AppError::msg(format!("Setting [{}] {} wasn't found in the file", c.section, c.key)));
        }
    }
    Ok(lines.join(newline) + newline)
}

fn config_dir(profile: &str) -> PathBuf {
    profiles::dir(profile).join("BepInEx").join("config")
}

/// Only plain `.cfg` file names inside the profile's config folder.
fn safe_path(profile: &str, file: &str) -> Result<PathBuf> {
    let ok = file.ends_with(".cfg")
        && !file.contains(['/', '\\', ':'])
        && !file.starts_with('.')
        && !file.contains("..");
    if !ok {
        return Err(AppError::msg("That isn't a config file"));
    }
    Ok(config_dir(profile).join(file))
}

pub fn list(profile: &str) -> Result<Vec<CfgSummary>> {
    let dir = config_dir(profile);
    let mut out = Vec::new();
    let Ok(read) = std::fs::read_dir(&dir) else { return Ok(out) };
    for e in read.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.ends_with(".cfg") || !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let text = std::fs::read_to_string(e.path()).unwrap_or_default();
        let parsed = parse(&name, &text);
        let modified = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push(CfgSummary {
            entries: parsed.sections.iter().map(|s| s.entries.len()).sum(),
            plugin: parsed.plugin,
            guid: parsed.guid,
            file: name,
            modified,
        });
    }
    out.sort_by(|a, b| {
        let key = |s: &CfgSummary| s.plugin.clone().unwrap_or_else(|| s.file.clone()).to_lowercase();
        key(a).cmp(&key(b))
    });
    Ok(out)
}

pub fn read(profile: &str, file: &str) -> Result<CfgFile> {
    let path = safe_path(profile, file)?;
    let text = std::fs::read_to_string(&path).map_err(|_| AppError::msg(format!("{file} doesn't exist")))?;
    Ok(parse(file, &text))
}

pub fn save(profile: &str, file: &str, changes: &[CfgChange]) -> Result<CfgFile> {
    let path = safe_path(profile, file)?;
    let text = std::fs::read_to_string(&path)?;
    let updated = apply_changes(&text, changes)?;
    let tmp = path.with_extension("cfg.tmp");
    std::fs::write(&tmp, &updated)?;
    std::fs::rename(&tmp, &path)?;
    Ok(parse(file, &updated))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "## Settings file was created by plugin Epic Loot v0.15.6\r\n## Plugin GUID: randyknapp.mods.epicloot\r\n\r\n[Balance]\r\n\r\n## Chance a creature drops magic loot.\r\n## Second line.\r\n# Setting type: Single\r\n# Default value: 1\r\n# Acceptable value range: From 0 to 10\r\nDropChance = 1.5\r\n\r\n## Turn it on\r\n# Setting type: Boolean\r\n# Default value: true\r\nEnabled = false\r\n\r\n[Logging]\r\n\r\n# Setting type: LogChannel\r\n# Default value: Warn, Error\r\n# Acceptable values: None, Info, Warn, Error\r\n# Multiple values can be set at the same time by separating them with , (e.g. Debug, Warning)\r\nChannels = Warn, Error\r\n\r\n# Setting type: Mode\r\n# Default value: Fast\r\n# Acceptable values: Fast, Slow\r\nMode = Slow\r\n\r\n# Setting type: KeyboardShortcut\r\n# Default value: F5\r\nHotkey = F5 + LeftShift\r\n";

    #[test]
    fn parses_bepinex_cfg() {
        let f = parse("epic.cfg", SAMPLE);
        assert_eq!(f.plugin.as_deref(), Some("Epic Loot"));
        assert_eq!(f.version.as_deref(), Some("0.15.6"));
        assert_eq!(f.guid.as_deref(), Some("randyknapp.mods.epicloot"));
        assert_eq!(f.sections.len(), 2);
        let drop = &f.sections[0].entries[0];
        assert_eq!((drop.key.as_str(), drop.value.as_str(), drop.kind.as_str()), ("DropChance", "1.5", "float"));
        assert_eq!((drop.min, drop.max), (Some(0.0), Some(10.0)));
        assert_eq!(drop.description, "Chance a creature drops magic loot.\nSecond line.");
        assert_eq!(f.sections[0].entries[1].kind, "bool");
        let log = &f.sections[1].entries;
        assert_eq!(log[0].kind, "flags");
        assert_eq!(log[1].kind, "enum");
        assert_eq!(log[1].choices, vec!["Fast", "Slow"]);
        assert_eq!(log[2].kind, "string");
        assert_eq!(log[2].type_name, "KeyboardShortcut");
        assert_eq!(log[2].value, "F5 + LeftShift");
    }

    #[test]
    fn edits_only_value_lines() {
        let out = apply_changes(
            SAMPLE,
            &[
                CfgChange { section: "Balance".into(), key: "Enabled".into(), value: "true".into() },
                CfgChange { section: "Logging".into(), key: "Mode".into(), value: "Fast\nInjected = 1".into() },
            ],
        )
        .unwrap();
        assert!(out.contains("Enabled = true\r\n"));
        assert!(out.contains("Mode = Fast Injected = 1\r\n"));
        assert!(out.contains("## Chance a creature drops magic loot.\r\n"));
        assert_eq!(out.lines().count(), SAMPLE.lines().count());
        assert!(apply_changes(SAMPLE, &[CfgChange { section: "Nope".into(), key: "Enabled".into(), value: "x".into() }]).is_err());
    }

    #[test]
    fn rejects_paths_outside_config() {
        assert!(safe_path("P", "../profile.json").is_err());
        assert!(safe_path("P", "sub\\x.cfg").is_err());
        assert!(safe_path("P", "ModHeim.GameTheme.theme").is_err());
        assert!(safe_path("P", "mod.cfg").is_ok());
    }
}
