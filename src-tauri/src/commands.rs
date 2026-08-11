//! The IPC surface exposed to the TypeScript frontend.
//!
//! Anything that touches the disk in bulk (scanning, deleting) runs on a
//! blocking thread so the webview stays responsive and the async runtime is
//! never parked on filesystem work.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use tauri::{AppHandle, Emitter, State};

use crate::model::{
    CleanProgress, DeleteReport, DockerUsage, Project, ScanProgress, ScanResult, SysStats,
};
use crate::store::{Goal, Note, Settings, Store};
use crate::{clean, platform, runner::Runner, scan, watcher::Watcher};

pub const SCAN_PROGRESS: &str = "upa://scan-progress";
pub const SCAN_DONE: &str = "upa://scan-done";
pub const CLEAN_PROGRESS: &str = "upa://clean-progress";

pub struct AppState {
    pub store: Store,
    pub projects: Mutex<Vec<Project>>,
    pub runner: Runner,
    pub watcher: Watcher,
    /// The view the user is looking at, and the sidebar width in logical
    /// pixels. The geometry watcher needs both to record a window width
    /// against the right view.
    pub view: Mutex<String>,
    pub nav_width: Mutex<u32>,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            projects: Mutex::new(Vec::new()),
            runner: Runner::new(),
            watcher: Watcher::new(),
            view: Mutex::new("projects".into()),
            nav_width: Mutex::new(214),
        }
    }

    fn project_by_id(&self, id: &str) -> Option<Project> {
        self.projects.lock().unwrap().iter().find(|p| p.id == id).cloned()
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn progress(app: &AppHandle, phase: &str, done: usize, total: usize, current: &str, freed: u64) {
    let _ = app.emit(
        CLEAN_PROGRESS,
        CleanProgress {
            phase: phase.to_string(),
            done,
            total,
            current: current.to_string(),
            freed_bytes: freed,
        },
    );
}

// ---------------------------------------------------------------------------
// Settings, goals, notes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.store.settings()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    state.store.set_settings(settings)?;
    Ok(state.store.settings())
}

/// Tells the geometry watcher which view is on screen, so a remembered width
/// is filed against the right one.
#[tauri::command]
pub fn set_window_context(state: State<'_, AppState>, view: String, nav_width: u32) {
    *state.view.lock().unwrap() = view;
    *state.nav_width.lock().unwrap() = nav_width;
}

#[tauri::command]
pub fn get_goals(state: State<'_, AppState>) -> Vec<Goal> {
    state.store.goals()
}

#[tauri::command]
pub fn save_goals(state: State<'_, AppState>, goals: Vec<Goal>) -> Result<(), String> {
    state.store.set_goals(goals)
}

#[tauri::command]
pub fn get_notes(state: State<'_, AppState>) -> Vec<Note> {
    state.store.notes()
}

#[tauri::command]
pub fn save_notes(state: State<'_, AppState>, notes: Vec<Note>) -> Result<(), String> {
    state.store.set_notes(notes)
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cached_projects(state: State<'_, AppState>) -> Vec<Project> {
    state.projects.lock().unwrap().clone()
}

#[tauri::command]
pub async fn scan_projects(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScanResult, String> {
    let settings = state.store.settings();
    let roots = settings.folders.clone();
    let progress_app = app.clone();

    let (projects, elapsed_ms) = tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let projects = scan::scan_all(&settings, |done, total, current| {
            let _ = progress_app.emit(
                SCAN_PROGRESS,
                ScanProgress { done, total, current: current.to_string() },
            );
        });
        (projects, started.elapsed().as_millis())
    })
    .await
    .map_err(|e| e.to_string())?;

    *state.projects.lock().unwrap() = projects.clone();

    if state.store.settings().toggles.watch_fs {
        let pairs = projects
            .iter()
            .map(|p| (p.id.clone(), PathBuf::from(&p.path)))
            .collect();
        let _ = state.watcher.rewatch(app.clone(), pairs);
    } else {
        state.watcher.stop();
    }

    let result = ScanResult { projects, elapsed_ms, roots };
    let _ = app.emit(SCAN_DONE, &result);
    Ok(result)
}

/// Re-measures a single project, used after a filesystem change or a cleanup.
#[tauri::command]
pub async fn rescan_project(state: State<'_, AppState>, id: String) -> Result<Option<Project>, String> {
    let Some(existing) = state.project_by_id(&id) else { return Ok(None) };
    let settings = state.store.settings();
    let root = PathBuf::from(&existing.path);

    let updated = tauri::async_runtime::spawn_blocking(move || scan::measure(&root, &settings))
        .await
        .map_err(|e| e.to_string())?;

    if let Some(ref project) = updated {
        let mut cache = state.projects.lock().unwrap();
        if let Some(slot) = cache.iter_mut().find(|p| p.id == id) {
            *slot = project.clone();
        }
    }

    Ok(updated)
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn delete_targets(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: Vec<String>,
) -> Result<DeleteReport, String> {
    let projects = state.projects.lock().unwrap().clone();
    let settings = state.store.settings();

    // Pair every requested key with the project root that owns it.
    let jobs: Vec<(crate::model::CleanTarget, PathBuf)> = projects
        .iter()
        .flat_map(|p| {
            p.clean_targets
                .iter()
                .filter(|t| keys.contains(&t.key))
                .map(|t| (t.clone(), PathBuf::from(&p.path)))
                .collect::<Vec<_>>()
        })
        .collect();

    let touched: Vec<String> = jobs
        .iter()
        .map(|(t, _)| t.project.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();

    let total = jobs.len();
    let delete_app = app.clone();

    let report = tauri::async_runtime::spawn_blocking(move || {
        let mut report = DeleteReport { freed_bytes: 0, removed: Vec::new(), errors: Vec::new() };

        for (done, (target, root)) in jobs.into_iter().enumerate() {
            // Announce the directory before removing it: a multi-gigabyte
            // node_modules can take a while, and the UI should say which one.
            progress(&delete_app, "delete", done, total, &target.path, report.freed_bytes);

            match clean::delete_target(&target, &root) {
                Ok(freed) => {
                    report.freed_bytes += freed;
                    report.removed.push(target.path.clone());
                }
                Err(e) => report.errors.push(e),
            }
        }

        report
    })
    .await
    .map_err(|e| e.to_string())?;

    state.store.add_freed(report.freed_bytes, &today());

    // Refresh the affected projects so the sizes in the UI stay honest.
    let to_refresh: Vec<PathBuf> = projects
        .iter()
        .filter(|p| touched.contains(&p.name))
        .map(|p| PathBuf::from(&p.path))
        .collect();

    let rescan_total = to_refresh.len();
    let rescan_app = app.clone();
    let freed = report.freed_bytes;

    let refreshed = tauri::async_runtime::spawn_blocking(move || {
        to_refresh
            .iter()
            .enumerate()
            .filter_map(|(done, root)| {
                // Re-measuring is the other half of the wait, so it reports too.
                progress(&rescan_app, "rescan", done, rescan_total, &root.to_string_lossy(), freed);
                scan::measure(root, &settings)
            })
            .collect::<Vec<Project>>()
    })
    .await
    .map_err(|e| e.to_string())?;

    progress(&app, "done", rescan_total, rescan_total, "", freed);

    {
        let mut cache = state.projects.lock().unwrap();
        for project in refreshed {
            if let Some(slot) = cache.iter_mut().find(|p| p.id == project.id) {
                *slot = project;
            }
        }
    }

    Ok(report)
}

#[tauri::command]
pub async fn docker_usage() -> Result<DockerUsage, String> {
    tauri::async_runtime::spawn_blocking(clean::docker_usage)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Command runner
// ---------------------------------------------------------------------------

/// Resolves a command's working directory, refusing anything that would escape
/// the project root.
fn work_dir(project_path: &str, cwd: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_path);
    if cwd.is_empty() {
        return Ok(root);
    }
    if cwd.contains("..") {
        return Err("invalid working directory".into());
    }
    Ok(root.join(cwd.replace('/', std::path::MAIN_SEPARATOR_STR)))
}

#[tauri::command]
pub fn run_command(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    cmd: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let project = state.project_by_id(&project_id).ok_or("unknown project")?;
    let rel = cwd.unwrap_or_default();
    let dir = work_dir(&project.path, &rel)?;
    state.runner.start(&app, &project.name, &dir, &rel, &cmd)
}

#[tauri::command]
pub fn stop_command(
    state: State<'_, AppState>,
    project_id: String,
    cmd: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let project = state.project_by_id(&project_id).ok_or("unknown project")?;
    state.runner.stop(&project.name, &cwd.unwrap_or_default(), &cmd)
}

#[tauri::command]
pub fn running_commands(state: State<'_, AppState>) -> Vec<String> {
    state.runner.running_keys()
}

// ---------------------------------------------------------------------------
// Shell integration and stats
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_editor(path: String) -> Result<(), String> {
    platform::open_editor(Path::new(&path))
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    platform::open_terminal(Path::new(&path))
}

#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    platform::reveal(Path::new(&path))
}

#[tauri::command]
pub async fn sys_stats() -> Result<SysStats, String> {
    tauri::async_runtime::spawn_blocking(|| SysStats { rss_bytes: platform::rss_bytes() })
        .await
        .map_err(|e| e.to_string())
}
