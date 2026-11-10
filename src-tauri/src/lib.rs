//! Ultimate Project Assister - Tauri application entry point.

mod claude;
mod clean;
mod cmds;
mod commands;
mod docker;
mod geometry;
mod git;
mod github;
mod model;
mod platform;
mod ports;
mod procs;
mod runner;
mod scan;
mod store;
mod tools;
mod tray;
mod watcher;

use tauri::Manager;

use commands::AppState;
use store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Launching the app while it is already running - from the Start menu,
        // or by double-clicking the exe while it sits in the tray - brings the
        // window back instead of starting a second copy over the same files.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("ultimate-project-assister"));
            app.manage(AppState::new(Store::load(dir)));
            geometry::watch(app.handle().clone());
            // The icon is installed whether or not closing goes to the tray:
            // it is also how a minimised window is found again.
            if let Err(e) = tray::install(app.handle()) {
                eprintln!("the tray icon could not be created: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::set_window_context,
            commands::get_goals,
            commands::save_goals,
            commands::get_notes,
            commands::save_notes,
            commands::cached_projects,
            commands::scan_projects,
            commands::rescan_project,
            commands::delete_targets,
            commands::docker_status,
            commands::project_containers,
            commands::running_containers,
            commands::stop_container,
            commands::all_containers,
            commands::container_action,
            commands::container_logs,
            commands::docker_prune,
            commands::docker_compact,
            commands::project_requirements,
            commands::install_tool,
            commands::check_port,
            commands::free_port,
            commands::run_command,
            commands::stop_command,
            commands::running_commands,
            commands::running_processes,
            commands::stop_process,
            commands::open_editor,
            commands::open_terminal,
            commands::reveal,
            commands::open_tag,
            commands::git_sync_status,
            commands::git_fetch,
            commands::git_fetch_all,
            commands::git_rebase,
            commands::git_rebase_abort,
            commands::sys_stats,
            commands::quit_app,
            commands::claude_stats,
            commands::claude_session,
            commands::github_status,
            commands::github_ci,
            commands::github_open_run,
            commands::github_pulls,
            commands::github_run_action,
            commands::github_run_log,
            commands::github_repo,
            commands::github_releases,
            commands::github_draft_release,
        ])
        // Closing the window is not the same as leaving. Which one it is comes
        // from Settings, and a close that is really a hide keeps every scan,
        // command and log stream alive behind it.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if tray::close_hides(app) {
                    api.prevent_close();
                    let _ = window.hide();
                    tray::announce_once(app);
                } else {
                    // Closing means leaving. Letting the window go is not
                    // enough: the tray icon keeps the event loop alive, and
                    // the app would carry on with nothing on screen. So the
                    // tidying up happens here and the process ends with it.
                    shutdown(app);
                    std::process::exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                shutdown(app);
            }
        });
}

/// Everything that has to happen before the app is gone.
///
/// Never leave a dev server or a compose stack running behind us, and record
/// where the window ended up. Called from the ordinary exit and from a close
/// that means leaving - which does not go through the ordinary exit, because
/// the tray icon keeps the loop alive after the last window.
fn shutdown(app: &tauri::AppHandle) {
    geometry::flush(app);
    if let Some(state) = app.try_state::<AppState>() {
        state.runner.stop_all();
        state.watcher.stop();
        // Belt and braces: the cache is written after every scan anyway, but a
        // session that only ever re-measured single projects should not lose
        // that work on the way out.
        let projects = state.projects.lock().unwrap().clone();
        let _ = state.store.save_projects(&projects);
    }
}
