//! Ultimate Project Assister - Tauri application entry point.

mod clean;
mod cmds;
mod commands;
mod docker;
mod geometry;
mod git;
mod model;
mod platform;
mod ports;
mod runner;
mod scan;
mod store;
mod tools;
mod watcher;

use tauri::Manager;

use commands::AppState;
use store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("ultimate-project-assister"));
            app.manage(AppState::new(Store::load(dir)));
            geometry::watch(app.handle().clone());
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
            commands::project_requirements,
            commands::install_tool,
            commands::check_port,
            commands::free_port,
            commands::run_command,
            commands::stop_command,
            commands::running_commands,
            commands::open_editor,
            commands::open_terminal,
            commands::reveal,
            commands::open_tag,
            commands::sys_stats,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the Tauri application")
        .run(|app, event| {
            // Never leave a dev server or compose stack running behind us, and
            // record where the window ended up.
            if let tauri::RunEvent::Exit = event {
                geometry::flush(app);
                if let Some(state) = app.try_state::<AppState>() {
                    state.runner.stop_all();
                    state.watcher.stop();
                    // Belt and braces: the cache is written after every scan
                    // anyway, but a session that only ever re-measured single
                    // projects should not lose that work on the way out.
                    let projects = state.projects.lock().unwrap().clone();
                    let _ = state.store.save_projects(&projects);
                }
            }
        });
}
