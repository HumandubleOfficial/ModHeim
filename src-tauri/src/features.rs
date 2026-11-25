//! Commands for mod settings, profile health, server status and modpacks.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use tauri::{AppHandle, State};

use crate::commands::{emit_done, emit_progress, install_one, install_with_deps, AppState, ImportResult};
use crate::error::{AppError, Result};
use crate::health::{self, HealthReport};
use crate::modconfig::{self, CfgChange, CfgFile, CfgSummary};
use crate::news;
use crate::profiles;
use crate::serverquery::{self, ServerStatus};
use crate::thunderstore::{self as ts, BEPINEX_PACK};

// ================================================================ mod settings

#[tauri::command]
pub fn list_mod_configs(profile: String) -> Result<Vec<CfgSummary>> {
    modconfig::list(&profile)
}

#[tauri::command]
pub fn read_mod_config(profile: String, file: String) -> Result<CfgFile> {
    modconfig::read(&profile, &file)
}

#[tauri::command]
pub async fn save_mod_config(
    state: State<'_, AppState>,
    profile: String,
    file: String,
    changes: Vec<CfgChange>,
) -> Result<CfgFile> {
    let _lock = state.ops.lock().await;
    modconfig::save(&profile, &file, &changes)
}

// ================================================================ health

#[tauri::command]
pub async fn profile_health(state: State<'_, AppState>, profile: String) -> Result<HealthReport> {
    let p = profiles::load(&profile)?;
    let log_path = profiles::dir(&profile).join("BepInEx").join("LogOutput.log");
    let index = state.index().ok();
    let news_items = news::load_cached();
    let patch = news_items
        .iter()
        .filter(|n| n.patch.is_some())
        .max_by_key(|n| ts::version_key(n.patch.as_deref().unwrap_or("")))
        .map(|n| (n.patch.clone().unwrap_or_default(), n.date));

    tokio::task::spawn_blocking(move || {
        let log = std::fs::read(&log_path).ok().map(|b| String::from_utf8_lossy(&b).to_string());
        let log_time = std::fs::metadata(&log_path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        let (log_issues, log_errors, log_warnings) = match &log {
            Some(text) => health::analyze_log(text, &p),
            None => (Vec::new(), 0, 0),
        };
        let mod_issues = health::check_mods(&p, index.as_deref(), patch.as_ref().map(|(v, t)| (v.as_str(), *t)));
        HealthReport { log_found: log.is_some(), log_time, log_errors, log_warnings, log_issues, mod_issues }
    })
    .await
    .map_err(|e| AppError::msg(format!("Health check failed: {e}")))
}

// ================================================================ servers

#[tauri::command]
pub async fn server_statuses(state: State<'_, AppState>) -> Result<Vec<ServerStatus>> {
    let servers = state.settings().servers;
    let checks = servers.iter().map(|s| serverquery::query(&s.id, &s.address));
    Ok(futures_util::future::join_all(checks).await)
}

// ================================================================ modpacks

/// Install a Thunderstore modpack as a brand-new profile: every mod at the version the pack
/// lists, the pack's own config files, then anything those mods still need.
#[tauri::command]
pub async fn install_modpack(
    app: AppHandle,
    state: State<'_, AppState>,
    full_name: String,
    name: Option<String>,
) -> Result<ImportResult> {
    let _lock = state.ops.lock().await;
    let result = install_modpack_inner(&app, &state, &full_name, name).await;
    emit_done(&app);
    result
}

async fn install_modpack_inner(
    app: &AppHandle,
    state: &AppState,
    full_name: &str,
    name: Option<String>,
) -> Result<ImportResult> {
    let index = state.index()?;
    let pack = index
        .get(full_name)
        .ok_or_else(|| AppError::msg(format!("{full_name} isn't on Thunderstore")))?
        .clone();
    let mut warnings = Vec::new();

    // What the pack asks for, at the versions it pins (falling back to latest if one is gone).
    let mut wanted: Vec<(ts::Package, String)> = Vec::new();
    for dep in &pack.dependencies {
        let Some((dep_name, ver)) = ts::split_dependency(dep) else { continue };
        let Some(p) = index.get(&dep_name) else {
            warnings.push(format!("{dep_name} is no longer on Thunderstore; skipped"));
            continue;
        };
        let ver = if p.has_version(&ver) {
            ver
        } else {
            warnings.push(format!("{} {ver} is gone; using {}", p.name, p.latest()));
            p.latest().to_string()
        };
        if !wanted.iter().any(|(w, _)| w.full_name == p.full_name) {
            wanted.push((p.clone(), ver));
        }
    }
    if !wanted.iter().any(|(p, _)| p.full_name == BEPINEX_PACK) {
        let bep = index.get(BEPINEX_PACK).ok_or_else(|| AppError::msg("BepInExPack is missing from the mod list"))?;
        wanted.insert(0, (bep.clone(), bep.latest().to_string()));
    }
    wanted.sort_by_key(|(p, _)| p.full_name != BEPINEX_PACK);
    wanted.push((pack.clone(), pack.latest().to_string())); // its configs go in last

    // Download four at a time; modpacks often have dozens of mods.
    let total = wanted.len();
    let done = Arc::new(AtomicUsize::new(0));
    emit_progress(app, &format!("Downloading {} ({} mods)", pack.name.replace('_', " "), total), 0, total, 0, 0);
    // Owned jobs: borrowed items inside buffer_unordered trip up the Send check on commands.
    let jobs: Vec<(usize, String, String)> =
        wanted.iter().enumerate().map(|(i, (p, v))| (i, p.full_name.clone(), v.clone())).collect();
    let label = pack.name.replace('_', " ");
    let downloads: Vec<(usize, Result<std::path::PathBuf>)> = futures_util::stream::iter(jobs)
        .map(|(i, full, v)| {
            let http = state.http.clone();
            let app = app.clone();
            let done = done.clone();
            let label = label.clone();
            async move {
                let r = ts::download_package(&http, &full, &v, |_, _| {}).await;
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                emit_progress(&app, &format!("Downloading {label}"), n, total, 0, 0);
                (i, r)
            }
        })
        .buffer_unordered(4)
        .collect()
        .await;
    let mut zips: Vec<Option<std::path::PathBuf>> = vec![None; total];
    for (i, r) in downloads {
        match r {
            Ok(z) => zips[i] = Some(z),
            Err(e) => warnings.push(format!("{}: {e}", wanted[i].0.name)),
        }
    }
    if zips[0].is_none() {
        return Err(AppError::msg("Couldn't download BepInEx, so the modpack can't be set up. Check your connection."));
    }

    let profile_name = profiles::free_name(name.as_deref().unwrap_or(&pack.name.replace('_', " ")));
    let mut profile = profiles::create(&profile_name)?;
    for (i, ((p, v), zip)) in wanted.iter().zip(zips.iter()).enumerate() {
        let Some(zip) = zip else { continue };
        emit_progress(app, &format!("Installing {}", p.name.replace('_', " ")), i + 1, total, 0, 0);
        let deps = if v == p.latest() { p.dependencies.clone() } else { Vec::new() };
        if let Err(e) = install_one(state, &mut profile, p, v, deps, zip) {
            warnings.push(format!("{}: {e}", p.name));
        }
    }

    // Anything the installed mods need that the pack didn't list.
    let installed: Vec<String> = profile.mods.iter().map(|m| m.full_name.to_ascii_lowercase()).collect();
    let mut missing: Vec<String> = profile
        .mods
        .iter()
        .flat_map(|m| m.dependencies.iter())
        .filter_map(|d| ts::split_dependency(d).map(|(n, _)| n))
        .filter(|n| !installed.contains(&n.to_ascii_lowercase()) && index.get(n).is_some())
        .collect();
    missing.sort();
    missing.dedup();
    for m in missing {
        if let Err(e) = install_with_deps(app, state, &profile_name, &m, None).await {
            warnings.push(format!("{m}: {e}"));
        }
    }
    let profile = profiles::load(&profile_name)?;
    Ok(ImportResult { installed: profile.mods.len(), name: profile_name, warnings })
}

// ================================================================ play-screen picture

const BG_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];
const BG_MAX: u64 = 40 * 1024 * 1024;

/// Use one of the user's own pictures (e.g. a game screenshot) behind the Play screen.
/// The file is copied into ModHeim's data folder so moving the original doesn't break it.
/// `None` goes back to the built-in scene.
#[tauri::command]
pub fn set_background(state: State<'_, AppState>, path: Option<String>) -> Result<crate::settings::Settings> {
    let data = crate::settings::data_dir();
    let old = state.settings().background;
    let new_name = match path {
        None => None,
        Some(p) => {
            let src = std::path::PathBuf::from(&p);
            let ext = src
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .filter(|e| BG_EXTS.contains(&e.as_str()))
                .ok_or_else(|| AppError::msg("Pick a PNG, JPG, WebP or BMP picture"))?;
            let len = std::fs::metadata(&src)?.len();
            if len > BG_MAX {
                return Err(AppError::msg("That picture is over 40 MB. Pick a smaller one."));
            }
            // A new name each time, so the UI never shows a stale cached copy.
            let name = format!("background-{}.{ext}", chrono::Utc::now().timestamp_millis());
            std::fs::create_dir_all(&data)?;
            std::fs::copy(&src, data.join(&name))?;
            Some(name)
        }
    };
    let settings = state.update_settings(|s| s.background = new_name.clone())?;
    if let Some(old) = old.filter(|o| Some(o) != new_name.as_ref()) {
        let _ = std::fs::remove_file(data.join(old));
    }
    Ok(settings)
}

/// The custom Play-screen picture as a data: URL, or None for the built-in scene.
#[tauri::command]
pub async fn get_background(state: State<'_, AppState>) -> Result<Option<String>> {
    use base64::Engine;
    let Some(name) = state.settings().background else { return Ok(None) };
    let path = crate::settings::data_dir().join(&name);
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    let mime = match name.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };
    Ok(Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
}

// ================================================================ other mod managers

#[tauri::command]
pub async fn list_external_profiles() -> Vec<crate::external::ExternalProfile> {
    tokio::task::spawn_blocking(crate::external::list).await.unwrap_or_default()
}

/// Copy an r2modman / Thunderstore Mod Manager profile into a new ModHeim profile.
#[tauri::command]
pub async fn import_external_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: Option<String>,
) -> Result<ImportResult> {
    let _lock = state.ops.lock().await;
    let dir = std::path::PathBuf::from(path);
    let parsed = tokio::task::spawn_blocking(move || crate::external::load(&dir))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    let r = crate::commands::import_parsed(&app, &state, parsed, name).await;
    emit_done(&app);
    r
}
