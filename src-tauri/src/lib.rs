mod backups;
mod commands;
mod compat;
mod discord;
mod conflicts;
mod doorstop;
mod error;
mod external;
mod features;
mod game;
mod game_graphics;
mod game_theme;
mod guard;
mod health;
mod launch;
mod modconfig;
mod mods;
mod news;
mod profiles;
mod serverquery;
mod settings;
mod snapshots;
mod stats;
mod thunderstore;

use commands::*;
use features::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new();
    thunderstore::remove_old_caches();

    // First run: pick up the game automatically if we can find it.
    {
        let mut s = state.settings.lock().unwrap();
        if s.game.as_ref().map(|g| !game::has_game_exe(&g.path)).unwrap_or(true) {
            if let Some(found) = game::detect_all().into_iter().next() {
                s.game = Some(found);
                let _ = s.save();
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .setup(|app| {
            build_tray(app)?;
            spawn_game_watcher(app.handle().clone());
            // index the game's DLLs in the background so the first launch check is instant
            if let Some(g) = settings::Settings::load().game {
                std::thread::spawn(move || {
                    let _ = compat::game_index(&g.path);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_prefs,
            detect_games,
            set_game,
            game_status,
            get_news,
            open_game_updates,
            get_index_info,
            refresh_index,
            search_packages,
            get_categories,
            get_package,
            get_readme,
            list_profiles,
            get_profile,
            set_active_profile,
            create_profile,
            repair_profile,
            rename_profile,
            clone_profile,
            delete_profile,
            install_mod,
            update_mods,
            uninstall_mod,
            set_mod_enabled,
            check_updates,
            export_profile,
            import_profile_file,
            share_profile,
            import_profile_code,
            get_game_theme,
            apply_game_theme,
            turn_off_game_theme,
            save_server,
            delete_server,
            launch_game,
            disable_mods_in_game,
            open_folder,
            open_url,
            clear_download_cache,
            list_mod_configs,
            read_mod_config,
            save_mod_config,
            profile_health,
            server_statuses,
            install_modpack,
            set_background,
            get_background,
            list_external_profiles,
            import_external_profile,
            launch_check,
            profile_conflicts,
            mod_changelog,
            play_stats,
            get_graphics,
            apply_graphics,
            read_log,
            crash_report,
            save_text_file,
            list_snapshots,
            create_snapshot,
            restore_snapshot,
            delete_snapshot,
            list_backups,
            create_backup,
            delete_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn show_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Tray icon: click to open ModHeim, right-click for Open / Quit.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Open ModHeim", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ModHeim", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").tooltip("ModHeim").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, e| match e.id.as_ref() {
        "open" => show_main(app),
        "quit" => app.exit(0),
        _ => {}
    })
    .on_tray_icon_event(|tray, e| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show_main(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}
