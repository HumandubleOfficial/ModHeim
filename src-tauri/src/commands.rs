//! Everything the UI can call.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::doorstop::{self, DoorstopStatus};
use crate::error::{AppError, Result};
use crate::game::{self, GameInstall};
use crate::launch;
use crate::game_theme::{self, GameTheme, ThemeState};
use crate::mods;
use crate::news;
use crate::profiles::{self, InstalledMod, Profile, ProfileSummary};
use crate::settings::{LaunchMethod, Server, Settings};
use crate::thunderstore::{self as ts, BEPINEX_PACK, Index, Package, SearchPage, SearchQuery};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub index: RwLock<Option<Arc<Index>>>,
    /// Serializes anything that changes files on disk.
    pub ops: tokio::sync::Mutex<()>,
    pub http: reqwest::Client,
    pub running: AtomicBool,
    /// (game folder, writable?, when checked): checking means writing a probe file, so do it rarely.
    writable: Mutex<Option<(PathBuf, bool, std::time::Instant)>>,
}

impl AppState {
    pub fn new() -> AppState {
        AppState {
            settings: Mutex::new(Settings::load()),
            index: RwLock::new(None),
            ops: tokio::sync::Mutex::new(()),
            http: ts::http(),
            running: AtomicBool::new(false),
            writable: Mutex::new(None),
        }
    }

    pub(crate) fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub(crate) fn update_settings(&self, f: impl FnOnce(&mut Settings)) -> Result<Settings> {
        let mut s = self.settings.lock().unwrap();
        f(&mut s);
        s.save()?;
        Ok(s.clone())
    }

    pub(crate) fn index(&self) -> Result<Arc<Index>> {
        self.index
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| AppError::msg("The mod list hasn't loaded yet. Check your connection and refresh."))
    }

    pub(crate) fn game(&self) -> Result<GameInstall> {
        self.settings()
            .game
            .filter(|g| game::has_game_exe(&g.path))
            .ok_or_else(|| AppError::msg("Valheim isn't set up yet. Open Settings and choose the game folder."))
    }

    fn game_writable(&self, dir: &std::path::Path) -> bool {
        let mut cache = self.writable.lock().unwrap();
        if let Some((path, ok, at)) = cache.as_ref() {
            if path == dir && at.elapsed() < std::time::Duration::from_secs(300) {
                return *ok;
            }
        }
        let ok = game::is_writable(dir);
        *cache = Some((dir.to_path_buf(), ok, std::time::Instant::now()));
        ok
    }

    pub(crate) fn ensure_not_running(&self) -> Result<()> {
        if self.running.load(Ordering::Relaxed) {
            return Err(AppError::msg("Close Valheim first; its files are in use while it runs."));
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    label: String,
    step: usize,
    steps: usize,
    bytes: u64,
    total: u64,
    done: bool,
}

pub(crate) fn emit_progress(app: &AppHandle, label: &str, step: usize, steps: usize, bytes: u64, total: u64) {
    let _ = app.emit(
        "progress",
        Progress { label: label.to_string(), step, steps, bytes, total, done: false },
    );
}

pub(crate) fn emit_done(app: &AppHandle) {
    let _ = app.emit(
        "progress",
        Progress { label: String::new(), step: 0, steps: 0, bytes: 0, total: 0, done: true },
    );
}

// ================================================================ settings

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    theme: Option<String>,
    launch_method: Option<LaunchMethod>,
    extra_args: Option<String>,
    show_nsfw: Option<bool>,
    show_deprecated: Option<bool>,
    backdrop: Option<String>,
}

#[tauri::command]
pub fn save_prefs(state: State<'_, AppState>, prefs: Prefs) -> Result<Settings> {
    state.update_settings(|s| {
        if let Some(t) = prefs.theme {
            s.theme = t;
        }
        if let Some(m) = prefs.launch_method {
            s.launch_method = m;
        }
        if let Some(a) = prefs.extra_args {
            s.extra_args = a;
        }
        if let Some(n) = prefs.show_nsfw {
            s.show_nsfw = n;
        }
        if let Some(d) = prefs.show_deprecated {
            s.show_deprecated = d;
        }
        if let Some(b) = prefs.backdrop.filter(|b| ["aurora", "forest", "embers", "plain"].contains(&b.as_str())) {
            s.backdrop = b;
        }
    })
}

// ================================================================ game

#[tauri::command]
pub async fn detect_games() -> Vec<GameInstall> {
    tokio::task::spawn_blocking(game::detect_all).await.unwrap_or_default()
}

#[tauri::command]
pub fn set_game(state: State<'_, AppState>, path: String) -> Result<GameInstall> {
    let g = game::from_path(&PathBuf::from(path))?;
    state.update_settings(|s| s.game = Some(g.clone()))?;
    Ok(g)
}

/// Doorstop is on but points somewhere ModHeim didn't set up (another mod manager, a manual install).
const FOREIGN_SETUP: &str = "another mod setup";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    install: Option<GameInstall>,
    exe_found: bool,
    writable: bool,
    doorstop: Option<DoorstopStatus>,
    running: bool,
    /// Profile folder doorstop currently points at, if mods are on.
    modded_profile: Option<String>,
}

#[tauri::command]
pub fn game_status(state: State<'_, AppState>) -> GameStatus {
    let install = state.settings().game.map(|mut g| {
        if let Some(v) = game::current_version(&g) {
            g.version = Some(v);
        }
        g
    });
    let (exe_found, writable, doorstop) = match &install {
        Some(g) => (
            game::has_game_exe(&g.path),
            state.game_writable(&g.path),
            Some(doorstop::status(&g.path)),
        ),
        None => (false, false, None),
    };
    let modded_profile = doorstop.as_ref().and_then(|d| {
        if d.enabled != Some(true) {
            return None;
        }
        let target = PathBuf::from(d.target.as_ref()?);
        let ours = target
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent()) // core -> BepInEx -> profile
            .filter(|p| p.parent() == Some(crate::settings::profiles_dir().as_path()));
        Some(match ours {
            Some(dir) => dir.file_name()?.to_string_lossy().to_string(),
            None => FOREIGN_SETUP.to_string(),
        })
    });
    GameStatus {
        install,
        exe_found,
        writable,
        doorstop,
        running: state.running.load(Ordering::Relaxed),
        modded_profile,
    }
}

// ================================================================ game news + updates

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsInfo {
    items: Vec<news::NewsItem>,
    installed_version: Option<String>,
    latest_patch: Option<String>,
    update_available: bool,
    /// true when the feed couldn't be reached and these are cached items
    offline: bool,
}

#[tauri::command]
pub async fn get_news(state: State<'_, AppState>, force: bool) -> Result<NewsInfo> {
    let age_ok = std::fs::metadata(crate::settings::cache_dir().join("news.json"))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|e| e.as_secs() < 30 * 60)
        .unwrap_or(false);
    let (items, offline) = if age_ok && !force {
        (news::load_cached(), false)
    } else {
        match news::fetch(&state.http).await {
            Ok(items) => (items, false),
            Err(e) => {
                let cached = news::load_cached();
                if cached.is_empty() {
                    return Err(e);
                }
                (cached, true)
            }
        }
    };
    let installed_version = state
        .settings()
        .game
        .and_then(|g| game::current_version(&g))
        .map(|v| news::short_version(&v));
    let latest_patch = news::latest_patch(&items);
    let update_available = match (&installed_version, &latest_patch) {
        (Some(have), Some(latest)) => ts::is_newer(latest, have),
        _ => false,
    };
    Ok(NewsInfo { items, installed_version, latest_patch, update_available, offline })
}

/// Open the store page where the game update is installed (Xbox app / Microsoft Store / Steam).
#[tauri::command]
pub fn open_game_updates(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let platform = state.game()?.platform;
    let mut last_err = String::new();
    for url in game::update_page_urls(platform) {
        match app.opener().open_url(&url, None::<&str>) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(AppError::msg(format!("Couldn't open the store page: {last_err}")))
}

// ================================================================ index

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    loaded: bool,
    count: usize,
    fetched_at: String,
}

fn index_info(state: &AppState) -> IndexInfo {
    match state.index.read().unwrap().as_ref() {
        Some(i) => IndexInfo { loaded: true, count: i.packages.len(), fetched_at: i.fetched_at.clone() },
        None => IndexInfo { loaded: false, count: 0, fetched_at: String::new() },
    }
}

#[tauri::command]
pub fn get_index_info(state: State<'_, AppState>) -> IndexInfo {
    index_info(&state)
}

/// Load the cached index, and download a fresh one if it's missing, stale, or `force`d.
#[tauri::command]
pub async fn refresh_index(app: AppHandle, state: State<'_, AppState>, force: bool) -> Result<IndexInfo> {
    if state.index.read().unwrap().is_none() {
        if let Some(cached) = tokio::task::spawn_blocking(ts::load_cached).await.ok().flatten() {
            *state.index.write().unwrap() = Some(Arc::new(cached));
        }
    }
    let fresh = ts::cache_age_minutes().map(|m| m < 60).unwrap_or(false);
    if state.index.read().unwrap().is_some() && fresh && !force {
        return Ok(index_info(&state));
    }
    let app2 = app.clone();
    let result = ts::fetch_index(&state.http, move |bytes| {
        emit_progress(&app2, "Downloading mod list", 0, 0, bytes, 0);
    })
    .await;
    emit_done(&app);
    match result {
        Ok(Some(idx)) => *state.index.write().unwrap() = Some(Arc::new(idx)),
        Ok(None) => {
            if state.index.read().unwrap().is_none() {
                if let Some(c) = ts::load_cached() {
                    *state.index.write().unwrap() = Some(Arc::new(c));
                }
            }
        }
        // offline: keep using the cached copy if we have one
        Err(e) if state.index.read().unwrap().is_none() => return Err(e),
        Err(_) => {}
    }
    Ok(index_info(&state))
}

#[tauri::command]
pub fn search_packages(state: State<'_, AppState>, query: SearchQuery) -> Result<SearchPage> {
    Ok(ts::search(&*state.index()?, &query))
}

#[tauri::command]
pub fn get_categories(state: State<'_, AppState>) -> Result<Vec<String>> {
    Ok(state.index()?.categories())
}

#[tauri::command]
pub fn get_package(state: State<'_, AppState>, full_name: String) -> Result<Package> {
    state
        .index()?
        .get(&full_name)
        .cloned()
        .ok_or_else(|| AppError::msg(format!("{full_name} isn't on Thunderstore")))
}

#[tauri::command]
pub async fn get_readme(state: State<'_, AppState>, full_name: String, version: String) -> Result<String> {
    ts::fetch_readme(&state.http, &full_name, &version).await
}

// ================================================================ profiles

#[tauri::command]
pub fn list_profiles() -> Result<Vec<ProfileSummary>> {
    profiles::list()
}

#[tauri::command]
pub fn get_profile(name: String) -> Result<Profile> {
    profiles::load(&name)
}

#[tauri::command]
pub fn set_active_profile(state: State<'_, AppState>, name: String) -> Result<Settings> {
    if !profiles::exists(&name) {
        return Err(AppError::msg(format!("Profile \"{name}\" doesn't exist")));
    }
    state.update_settings(|s| s.active_profile = name)
}

#[tauri::command]
pub async fn create_profile(app: AppHandle, state: State<'_, AppState>, name: String) -> Result<Profile> {
    let _lock = state.ops.lock().await;
    let p = profiles::create(&name)?;
    let result = install_with_deps(&app, &state, &p.name, BEPINEX_PACK, None).await;
    emit_done(&app);
    result
}

/// Reinstall BepInEx into a profile (and the game folder's proxy).
#[tauri::command]
pub async fn repair_profile(app: AppHandle, state: State<'_, AppState>, name: String) -> Result<Profile> {
    let _lock = state.ops.lock().await;
    state.ensure_not_running()?;
    let result = install_with_deps(&app, &state, &name, BEPINEX_PACK, None).await;
    emit_done(&app);
    result
}

#[tauri::command]
pub async fn rename_profile(state: State<'_, AppState>, old: String, new: String) -> Result<()> {
    let _lock = state.ops.lock().await;
    profiles::rename(&old, &new)?;
    let new = profiles::validate_name(&new)?;
    // keep settings pointing at the renamed profile
    let was_active = state.settings().active_profile == old;
    let modded_here = state
        .settings()
        .game
        .map(|g| doorstop::status(&g.path))
        .and_then(|d| d.target)
        .map(|t| t.contains(&*profiles::dir(&old).to_string_lossy()))
        .unwrap_or(false);
    state.update_settings(|s| {
        if was_active {
            s.active_profile = new.clone();
        }
        for srv in s.servers.iter_mut() {
            if srv.profile.as_deref() == Some(old.as_str()) {
                srv.profile = Some(new.clone());
            }
        }
    })?;
    // if the Xbox app would launch the old path, re-point it
    if modded_here {
        if let Ok(g) = state.game() {
            let _ = doorstop::configure(&g.path, Some(&profiles::dir(&new)));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn clone_profile(state: State<'_, AppState>, src: String, new: String) -> Result<()> {
    let _lock = state.ops.lock().await;
    profiles::clone(&src, &new)
}

#[tauri::command]
pub async fn delete_profile(state: State<'_, AppState>, name: String) -> Result<Settings> {
    let _lock = state.ops.lock().await;
    state.ensure_not_running()?;
    // don't leave the game pointing at a folder in the Recycle Bin
    if let Ok(g) = state.game() {
        let target = doorstop::status(&g.path).target.unwrap_or_default();
        if target.contains(&*profiles::dir(&name).to_string_lossy()) {
            doorstop::configure(&g.path, None)?;
        }
    }
    profiles::delete(&name)?;
    let remaining = profiles::list()?;
    let fallback = remaining.first().map(|p| p.name.clone());
    state.update_settings(|s| {
        if s.active_profile == name {
            s.active_profile = fallback.unwrap_or_else(|| "Default".to_string());
        }
        for srv in s.servers.iter_mut() {
            if srv.profile.as_deref() == Some(name.as_str()) {
                srv.profile = None;
            }
        }
    })
}

// ================================================================ mods

/// Download + install a package and whatever it needs that the profile lacks.
pub(crate) async fn install_with_deps(
    app: &AppHandle,
    state: &AppState,
    profile_name: &str,
    full_name: &str,
    version: Option<&str>,
) -> Result<Profile> {
    let index = state.index()?;
    let mut profile = profiles::load(profile_name)?;
    // The cache only keeps the newest version's dependency list; ask Thunderstore for an older one.
    let root_deps = match (version, index.get(full_name)) {
        (Some(v), Some(p)) if v != p.latest() => Some(ts::fetch_version_deps(&state.http, &p.full_name, v).await?),
        _ => None,
    };
    let plan = ts::resolve(&index, full_name, version, root_deps.as_deref(), &profile.installed_versions())?;
    let steps = plan.len();
    for (i, item) in plan.iter().enumerate() {
        let pkg = index.get(&item.full_name).expect("resolved from index");
        let label = format!("{} {}", pkg.name, item.version);
        emit_progress(app, &format!("Downloading {label}"), i + 1, steps, 0, 0);
        let app2 = app.clone();
        let l2 = label.clone();
        let zip = ts::download_package(&state.http, &pkg.full_name, &item.version, move |got, total| {
            emit_progress(&app2, &format!("Downloading {l2}"), i + 1, steps, got, total);
        })
        .await?;
        emit_progress(app, &format!("Installing {label}"), i + 1, steps, 0, 0);
        install_one(state, &mut profile, pkg, &item.version, item.dependencies.clone(), &zip)?;
    }
    Ok(profile)
}

pub(crate) fn install_one(
    state: &AppState,
    profile: &mut Profile,
    pkg: &Package,
    version: &str,
    dependencies: Vec<String>,
    zip: &std::path::Path,
) -> Result<()> {
    let dir = profiles::dir(&profile.name);
    let previous = profile.find(&pkg.full_name).cloned();
    if let Some(old) = &previous {
        mods::remove_files(&dir, &old.files)?;
    }
    let files = mods::install_zip(&dir, &pkg.full_name, zip)?;
    let enabled = previous.as_ref().map(|p| p.enabled).unwrap_or(true);
    if !enabled {
        mods::set_enabled(&dir, &files, false)?;
    }
    if pkg.full_name == BEPINEX_PACK {
        if let Ok(g) = state.game() {
            if !state.running.load(Ordering::Relaxed) {
                doorstop::install_proxy_from_pack(&g.path, zip)?;
            }
        }
    }
    profile.upsert(InstalledMod {
        full_name: pkg.full_name.clone(),
        owner: pkg.owner.clone(),
        name: pkg.name.clone(),
        version: version.to_string(),
        enabled,
        icon: pkg.icon.clone(),
        description: pkg.description.clone(),
        dependencies,
        files,
        installed_at: chrono::Utc::now().to_rfc3339(),
    });
    profiles::save(profile)
}

#[tauri::command]
pub async fn install_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    full_name: String,
    version: Option<String>,
) -> Result<Profile> {
    let _lock = state.ops.lock().await;
    state.ensure_not_running()?;
    let result = install_with_deps(&app, &state, &profile, &full_name, version.as_deref()).await;
    emit_done(&app);
    result
}

#[tauri::command]
pub async fn update_mods(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
    full_names: Vec<String>,
) -> Result<Profile> {
    let _lock = state.ops.lock().await;
    state.ensure_not_running()?;
    let mut last = profiles::load(&profile)?;
    for name in full_names {
        match install_with_deps(&app, &state, &profile, &name, None).await {
            Ok(p) => last = p,
            Err(e) => {
                emit_done(&app);
                return Err(e);
            }
        }
    }
    emit_done(&app);
    Ok(last)
}

#[tauri::command]
pub async fn uninstall_mod(state: State<'_, AppState>, profile: String, full_name: String) -> Result<Profile> {
    let _lock = state.ops.lock().await;
    state.ensure_not_running()?;
    if full_name == BEPINEX_PACK {
        return Err(AppError::msg("BepInEx is what loads every mod, so it can't be removed from a profile."));
    }
    let mut p = profiles::load(&profile)?;
    let m = p
        .find(&full_name)
        .cloned()
        .ok_or_else(|| AppError::msg(format!("{full_name} isn't installed")))?;
    mods::remove_files(&profiles::dir(&profile), &m.files)?;
    p.mods.retain(|x| x.full_name != m.full_name);
    profiles::save(&p)?;
    Ok(p)
}

#[tauri::command]
pub async fn set_mod_enabled(
    state: State<'_, AppState>,
    profile: String,
    full_name: String,
    enabled: bool,
) -> Result<Profile> {
    let _lock = state.ops.lock().await;
    state.ensure_not_running()?;
    if full_name == BEPINEX_PACK && !enabled {
        return Err(AppError::msg("To play without mods, use the Vanilla button instead."));
    }
    let mut p = profiles::load(&profile)?;
    let dir = profiles::dir(&profile);
    let m = p
        .find_mut(&full_name)
        .ok_or_else(|| AppError::msg(format!("{full_name} isn't installed")))?;
    mods::set_enabled(&dir, &m.files, enabled)?;
    m.enabled = enabled;
    profiles::save(&p)?;
    Ok(p)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    full_name: String,
    current: String,
    latest: String,
}

#[tauri::command]
pub fn check_updates(state: State<'_, AppState>, profile: String) -> Result<Vec<UpdateInfo>> {
    let Ok(index) = state.index() else { return Ok(Vec::new()) };
    let p = profiles::load(&profile)?;
    Ok(p.mods
        .iter()
        .filter_map(|m| {
            let latest = index.get(&m.full_name)?.latest();
            ts::is_newer(latest, &m.version).then(|| UpdateInfo {
                full_name: m.full_name.clone(),
                current: m.version.clone(),
                latest: latest.to_string(),
            })
        })
        .collect())
}

// ================================================================ export / import / share

#[tauri::command]
pub fn export_profile(name: String, dest: String) -> Result<()> {
    std::fs::write(dest, profiles::export_bytes(&name)?)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub(crate) name: String,
    pub(crate) installed: usize,
    pub(crate) warnings: Vec<String>,
}

async fn import_bytes(app: &AppHandle, state: &AppState, bytes: Vec<u8>, name: Option<String>) -> Result<ImportResult> {
    import_parsed(app, state, profiles::parse_export(&bytes)?, name).await
}

/// Create a new profile from a mod list (+ config files): downloads every mod at the listed
/// version, keeps each mod's on/off state, then writes the configs over the defaults.
pub(crate) async fn import_parsed(
    app: &AppHandle,
    state: &AppState,
    parsed: profiles::ParsedExport,
    name: Option<String>,
) -> Result<ImportResult> {
    let index = state.index()?;
    let name = profiles::free_name(name.as_deref().unwrap_or(&parsed.r2x.profile_name));
    let mut profile = profiles::create(&name)?;
    let mut warnings = Vec::new();

    let mut wanted: Vec<(String, String, bool)> = parsed
        .r2x
        .mods
        .iter()
        .map(|m| (m.name.clone(), m.version_string(), m.enabled))
        .collect();
    if !wanted.iter().any(|(n, _, _)| n == BEPINEX_PACK) {
        let latest = index
            .get(BEPINEX_PACK)
            .map(|p| p.latest().to_string())
            .ok_or_else(|| AppError::msg("BepInExPack is missing from the mod list"))?;
        wanted.insert(0, (BEPINEX_PACK.to_string(), latest, true));
    }
    // BepInEx first so the game proxy is in place
    wanted.sort_by_key(|(n, _, _)| n != BEPINEX_PACK);

    let steps = wanted.len();
    for (i, (full_name, version, enabled)) in wanted.iter().enumerate() {
        if full_name.starts_with("ModHeim-") {
            continue; // launcher-provided (e.g. the game theme); re-apply it from Game Themes
        }
        let Some(pkg) = index.get(full_name) else {
            warnings.push(format!("{full_name} is no longer on Thunderstore; skipped"));
            continue;
        };
        let version = if pkg.has_version(version) {
            version.clone()
        } else {
            warnings.push(format!(
                "{} {version} is gone; installed {} instead",
                pkg.name,
                pkg.latest()
            ));
            pkg.latest().to_string()
        };
        let label = format!("{} {version}", pkg.name);
        emit_progress(app, &format!("Downloading {label}"), i + 1, steps, 0, 0);
        let app2 = app.clone();
        let l2 = label.clone();
        let zip = match ts::download_package(&state.http, &pkg.full_name, &version, move |g, t| {
            emit_progress(&app2, &format!("Downloading {l2}"), i + 1, steps, g, t)
        })
        .await
        {
            Ok(z) => z,
            Err(e) => {
                warnings.push(format!("{}: {e}", pkg.name));
                continue;
            }
        };
        emit_progress(app, &format!("Installing {label}"), i + 1, steps, 0, 0);
        // only the newest version's dependency list is cached; it's used for warnings only
        let deps = if version == pkg.latest() { pkg.dependencies.clone() } else { Vec::new() };
        if let Err(e) = install_one(state, &mut profile, pkg, &version, deps, &zip) {
            warnings.push(format!("{}: {e}", pkg.name));
            continue;
        }
        if !enabled && pkg.full_name != BEPINEX_PACK {
            if let Some(m) = profile.find_mut(&pkg.full_name) {
                mods::set_enabled(&profiles::dir(&name), &m.files, false)?;
                m.enabled = false;
            }
            profiles::save(&profile)?;
        }
    }
    profiles::write_configs(&name, &parsed.configs)?;
    Ok(ImportResult { installed: profile.mods.len(), name, warnings })
}

#[tauri::command]
pub async fn import_profile_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: Option<String>,
) -> Result<ImportResult> {
    let _lock = state.ops.lock().await;
    let bytes = std::fs::read(path)?;
    let r = import_bytes(&app, &state, bytes, name).await;
    emit_done(&app);
    r
}

#[tauri::command]
pub async fn share_profile(state: State<'_, AppState>, name: String) -> Result<String> {
    let bytes = profiles::export_bytes(&name)?;
    profiles::upload_share(&state.http, bytes).await
}

#[tauri::command]
pub async fn import_profile_code(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
    name: Option<String>,
) -> Result<ImportResult> {
    let _lock = state.ops.lock().await;
    let bytes = profiles::download_share(&state.http, &code).await?;
    let r = import_bytes(&app, &state, bytes, name).await;
    emit_done(&app);
    r
}

// ================================================================ in-game themes

#[tauri::command]
pub fn get_game_theme(profile: String) -> Result<ThemeState> {
    game_theme::state(&profile)
}

/// Install ModHeim's theme plugin into the profile if needed and write the theme.
/// If Valheim is running with this profile, the plugin picks the change up live.
#[tauri::command]
pub async fn apply_game_theme(state: State<'_, AppState>, profile: String, theme: GameTheme) -> Result<ThemeState> {
    let _lock = state.ops.lock().await;
    game_theme::require_bepinex(&profile)?;
    let mut p = profiles::load(&profile)?;
    game_theme::ensure_plugin(&mut p, state.running.load(Ordering::Relaxed))?;
    game_theme::write_theme(&profile, &theme)?;
    game_theme::state(&profile)
}

/// Back to Valheim's own look (the plugin stays installed but does nothing).
#[tauri::command]
pub async fn turn_off_game_theme(state: State<'_, AppState>, profile: String) -> Result<ThemeState> {
    let _lock = state.ops.lock().await;
    if let Some(mut t) = game_theme::state(&profile)?.theme {
        t.enabled = false;
        game_theme::write_theme(&profile, &t)?;
    }
    game_theme::state(&profile)
}

// ================================================================ servers

#[tauri::command]
pub fn save_server(state: State<'_, AppState>, server: Server) -> Result<Settings> {
    if server.name.trim().is_empty() || server.address.trim().is_empty() {
        return Err(AppError::msg("A server needs a name and an address (host:port)"));
    }
    state.update_settings(|s| {
        let mut server = server;
        if server.id.is_empty() {
            server.id = format!("{:x}", chrono::Utc::now().timestamp_micros());
        }
        match s.servers.iter_mut().find(|x| x.id == server.id) {
            Some(existing) => *existing = server,
            None => s.servers.push(server),
        }
    })
}

#[tauri::command]
pub fn delete_server(state: State<'_, AppState>, id: String) -> Result<Settings> {
    state.update_settings(|s| s.servers.retain(|x| x.id != id))
}

// ================================================================ launch

#[tauri::command]
pub async fn launch_game(
    app: AppHandle,
    state: State<'_, AppState>,
    vanilla: bool,
    server_id: Option<String>,
) -> Result<()> {
    let _lock = state.ops.lock().await;
    let game = state.game()?;
    state.ensure_not_running()?;
    let settings = state.settings();
    let server = server_id
        .as_ref()
        .map(|id| {
            settings
                .servers
                .iter()
                .find(|s| &s.id == id)
                .cloned()
                .ok_or_else(|| AppError::msg("That server was removed"))
        })
        .transpose()?;
    let vanilla = vanilla || server.as_ref().map(|s| s.vanilla).unwrap_or(false);

    if vanilla {
        if game.path.join(doorstop::CONFIG_FILE).is_file() {
            doorstop::configure(&game.path, None)?;
        }
    } else {
        let profile_name = server
            .as_ref()
            .and_then(|s| s.profile.clone())
            .filter(|p| profiles::exists(p))
            .unwrap_or_else(|| settings.active_profile.clone());
        let profile = profiles::load(&profile_name)?;
        // Make sure the game folder has the Doorstop proxy for this profile's BepInEx.
        let pack = profile
            .find(BEPINEX_PACK)
            .ok_or_else(|| AppError::msg("This profile has no BepInEx. Repair it on the Profiles page."))?;
        if !doorstop::status(&game.path).proxy_installed {
            let app2 = app.clone();
            let zip = ts::download_package(&state.http, BEPINEX_PACK, &pack.version, move |g, t| {
                emit_progress(&app2, "Downloading BepInEx", 1, 1, g, t)
            })
            .await;
            emit_done(&app);
            doorstop::install_proxy_from_pack(&game.path, &zip?)?;
        }
        doorstop::configure(&game.path, Some(&profiles::dir(&profile_name)))?;
    }

    let args = launch::build_args(server.as_ref(), &settings.extra_args);
    launch::start(&game, settings.launch_method, &args)
}

/// Switch the game folder back to vanilla without launching.
#[tauri::command]
pub fn disable_mods_in_game(state: State<'_, AppState>) -> Result<()> {
    let game = state.game()?;
    state.ensure_not_running()?;
    doorstop::configure(&game.path, None)
}

// ================================================================ folders

#[tauri::command]
pub fn open_folder(app: AppHandle, state: State<'_, AppState>, kind: String, profile: Option<String>) -> Result<()> {
    let profile_dir = || {
        profiles::dir(profile.as_deref().unwrap_or(&state.settings().active_profile))
    };
    let path = match kind.as_str() {
        "game" => state.game()?.path,
        "profile" => profile_dir(),
        "config" => profile_dir().join("BepInEx").join("config"),
        "plugins" => profile_dir().join("BepInEx").join("plugins"),
        "log" => profile_dir().join("BepInEx").join("LogOutput.log"),
        "data" => crate::settings::data_dir(),
        _ => return Err(AppError::msg("Unknown folder")),
    };
    if !path.exists() {
        if kind == "log" {
            return Err(AppError::msg("No log yet. Launch the game modded once to create it."));
        }
        std::fs::create_dir_all(&path)?;
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::msg("Only web links can be opened"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub fn clear_download_cache() -> Result<u64> {
    let dir = crate::settings::package_cache_dir();
    let mut freed = 0;
    if dir.is_dir() {
        for e in walkdir::WalkDir::new(&dir).into_iter().flatten() {
            if e.file_type().is_file() {
                freed += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(freed)
}

/// Background loop: tell the UI when Valheim starts/stops.
pub fn spawn_game_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        use tauri::Manager;
        let mut sys = sysinfo::System::new();
        let mut last = false;
        loop {
            let now = launch::is_running(&mut sys);
            if now != last {
                last = now;
                if let Some(state) = app.try_state::<AppState>() {
                    state.running.store(now, Ordering::Relaxed);
                }
                let _ = app.emit("game-running", now);
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}
