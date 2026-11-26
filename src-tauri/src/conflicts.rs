//! Mod conflicts that don't show up as errors:
//!  - two mods replacing the same game method (Harmony prefixes that can skip it), or rewriting
//!    the same method's code (transpilers), so one mod silently cancels the other;
//!  - two mods (or a mod and the game) using the same hotkey.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::compat::{self, PatchKind};
use crate::modconfig;
use crate::profiles::{self, Profile};
use crate::thunderstore::BEPINEX_PACK;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatchUser {
    pub name: String,
    pub full_name: String,
    pub kinds: Vec<PatchKind>,
    pub can_skip: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatchConflict {
    /// "Player.UpdateTeleport"
    pub target: String,
    /// "likely" or "possible"
    pub level: &'static str,
    pub reason: String,
    pub mods: Vec<PatchUser>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyUse {
    /// Plugin name from the config header, or the file name.
    pub owner: String,
    pub file: String,
    pub section: String,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyConflict {
    pub shortcut: String,
    /// What the game itself uses this key for, when it's one of its defaults.
    pub game: Option<String>,
    pub uses: Vec<HotkeyUse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflicts {
    pub patches: Vec<PatchConflict>,
    pub hotkeys: Vec<HotkeyConflict>,
    /// Mods whose DLLs were scanned and how many game methods they patch in total.
    pub mods_scanned: usize,
    pub methods_patched: usize,
}

// ------------------------------------------------------------ patches

fn display_name(full_name: &str) -> String {
    full_name.split_once('-').map(|(_, n)| n).unwrap_or(full_name).replace('_', " ")
}

pub fn patch_conflicts(profile: &Profile, dir: &Path) -> (Vec<PatchConflict>, usize, usize) {
    // target -> mod -> (kinds, can_skip)
    let mut by_target: BTreeMap<String, BTreeMap<String, (Vec<PatchKind>, bool)>> = BTreeMap::new();
    let mut scanned = 0;
    for m in profile.mods.iter().filter(|m| m.enabled && m.full_name != BEPINEX_PACK) {
        let dlls: Vec<&String> = m.files.iter().filter(|f| f.to_ascii_lowercase().ends_with(".dll")).collect();
        if dlls.is_empty() {
            continue;
        }
        scanned += 1;
        for f in dlls {
            let path = f.split('/').fold(dir.to_path_buf(), |p, c| p.join(c));
            for p in compat::dll_patches(&path) {
                let e = by_target.entry(p.target).or_default().entry(m.full_name.clone()).or_default();
                if !e.0.contains(&p.kind) {
                    e.0.push(p.kind);
                }
                e.1 |= p.can_skip;
            }
        }
    }
    let methods = by_target.len();
    let mut out = Vec::new();
    for (target, users) in by_target {
        if users.len() < 2 {
            continue;
        }
        let skippers: Vec<&String> = users.iter().filter(|(_, (_, s))| *s).map(|(n, _)| n).collect();
        let transpilers: Vec<&String> = users.iter().filter(|(_, (k, _))| k.contains(&PatchKind::Transpiler)).map(|(n, _)| n).collect();
        let (level, reason) = if skippers.len() >= 2 {
            ("likely", format!("{} mods can each take over this game method; when both do, one mod's change is lost", skippers.len()))
        } else if skippers.len() == 1 && transpilers.iter().any(|t| *t != skippers[0]) {
            ("likely", format!("{} can skip this game method, which also skips the other mod's changes to it", display_name(skippers[0])))
        } else if transpilers.len() >= 2 {
            ("possible", "Two mods rewrite the code of this method; they usually cope, but this is a common source of odd bugs".to_string())
        } else {
            continue;
        };
        let mods = users
            .into_iter()
            .map(|(full, (mut kinds, can_skip))| {
                kinds.sort_by_key(|k| *k as u8);
                PatchUser { name: display_name(&full), full_name: full, kinds, can_skip }
            })
            .collect();
        out.push(PatchConflict { target, level, reason, mods });
    }
    out.sort_by(|a, b| a.level.cmp(b.level).reverse().then(a.target.cmp(&b.target)));
    (out, scanned, methods)
}

// ------------------------------------------------------------ hotkeys

const MODIFIERS: &[&str] = &["leftalt", "rightalt", "leftshift", "rightshift", "leftcontrol", "rightcontrol", "leftcommand", "rightcommand", "altgr"];

/// The game's own default keys a mod shouldn't take over.
const GAME_KEYS: &[(&str, &str)] = &[("e", "Use"), ("tab", "Inventory"), ("m", "Map"), ("space", "Jump"), ("escape", "Menu")];

/// "LeftControl + C" -> "c+leftcontrol" (main key first, modifiers sorted). None for unset keys.
fn normalize(value: &str) -> Option<String> {
    let v = value.trim();
    if v.is_empty() || v.eq_ignore_ascii_case("none") {
        return None;
    }
    let mut parts = v.split('+').map(|p| p.trim().to_ascii_lowercase()).filter(|p| !p.is_empty());
    let main = parts.next()?;
    let mut mods: Vec<String> = parts.collect();
    mods.sort();
    mods.dedup();
    Some(std::iter::once(main).chain(mods).collect::<Vec<_>>().join("+"))
}

pub fn hotkey_conflicts(profile: &str) -> Vec<HotkeyConflict> {
    let Ok(files) = modconfig::list(profile) else { return Vec::new() };
    let mut by_key: BTreeMap<String, Vec<HotkeyUse>> = BTreeMap::new();
    for f in files {
        let Ok(cfg) = modconfig::read(profile, &f.file) else { continue };
        let owner = cfg.plugin.clone().unwrap_or_else(|| f.file.trim_end_matches(".cfg").to_string());
        for s in &cfg.sections {
            for e in &s.entries {
                if !matches!(e.type_name.as_str(), "KeyboardShortcut" | "KeyCode") {
                    continue;
                }
                // modifier settings ("hold Alt while…") are meant to be shared
                if e.key.to_ascii_lowercase().contains("modifier") {
                    continue;
                }
                let Some(norm) = normalize(&e.value) else { continue };
                if MODIFIERS.contains(&norm.as_str()) {
                    continue;
                }
                by_key.entry(norm).or_default().push(HotkeyUse {
                    owner: owner.clone(),
                    file: f.file.clone(),
                    section: s.name.clone(),
                    key: e.key.clone(),
                    value: e.value.trim().to_string(),
                });
            }
        }
    }
    let mut out = Vec::new();
    for (norm, uses) in by_key {
        let game = GAME_KEYS.iter().find(|(k, _)| *k == norm).map(|(_, what)| what.to_string());
        let files: std::collections::HashSet<&str> = uses.iter().map(|u| u.file.as_str()).collect();
        if files.len() < 2 && game.is_none() {
            continue;
        }
        out.push(HotkeyConflict { shortcut: uses[0].value.clone(), game, uses });
    }
    out
}

pub fn check(profile_name: &str) -> crate::error::Result<Conflicts> {
    let profile = profiles::load(profile_name)?;
    let dir = profiles::dir(profile_name);
    let (patches, mods_scanned, methods_patched) = patch_conflicts(&profile, &dir);
    let hotkeys = hotkey_conflicts(profile_name);
    Ok(Conflicts { patches, hotkeys, mods_scanned, methods_patched })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_shortcuts() {
        // BepInEx writes the main key first, then its modifiers
        assert_eq!(normalize("LeftControl + C").as_deref(), Some("leftcontrol+c"));
        assert_eq!(normalize("C + LeftShift + LeftControl").as_deref(), Some("c+leftcontrol+leftshift"));
        assert_eq!(normalize("F10").as_deref(), Some("f10"));
        assert_eq!(normalize("None"), None);
        assert_eq!(normalize("  "), None);
    }

    /// MODHEIM_SCAN_PROFILE=Mods cargo test real_conflicts -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_conflicts() {
        let Ok(name) = std::env::var("MODHEIM_SCAN_PROFILE") else { return };
        let t = std::time::Instant::now();
        let c = check(&name).unwrap();
        println!("{} mods, {} methods patched, {:?}", c.mods_scanned, c.methods_patched, t.elapsed());
        for p in &c.patches {
            println!("[{}] {}: {:?}", p.level, p.target, p.mods.iter().map(|m| (&m.name, &m.kinds, m.can_skip)).collect::<Vec<_>>());
        }
        for h in &c.hotkeys {
            println!("{} {:?}: {:?}", h.shortcut, h.game, h.uses.iter().map(|u| format!("{}:{}", u.owner, u.key)).collect::<Vec<_>>());
        }
    }
}
