//! Persistent user data: settings, goals and board notes.
//!
//! Everything lives as plain JSON next to the app config so it stays readable
//! and hand-editable. Writes are atomic (temp file + rename) so a crash mid
//! save cannot leave a truncated file behind.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::model::Project;

/// Bumped whenever `Project` changes shape. A cache written by an older build
/// is discarded rather than half-read.
const CACHE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectCache {
    version: u32,
    saved_at: i64,
    projects: Vec<Project>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Toggles {
    pub scan_start: bool,
    pub watch_fs: bool,
    pub deep_git: bool,
    pub docker: bool,
}

impl Default for Toggles {
    fn default() -> Self {
        Self { scan_start: true, watch_fs: true, deep_git: true, docker: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub pattern: String,
    pub scope: String,
}

/// Where the window was and how big it was when the app last closed.
///
/// The width is remembered per view, because each view asks for its own width:
/// storing a single number would fight the adaptive resizing rather than
/// preserve what the user chose.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub height: Option<u32>,
    pub maximized: bool,
    /// View name -> content width (the window width minus the sidebar), so a
    /// remembered width survives collapsing or expanding the sidebar.
    pub widths: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub lang: String,
    pub theme: String,
    pub nav_collapsed: bool,
    /// Which window edge stays put when a view asks for a different width:
    /// `left` (default) or `right`.
    pub anchor: String,
    pub folders: Vec<String>,
    pub toggles: Toggles,
    /// Build dirs newer than this are never auto-selected in the cleaner.
    pub age_days: i64,
    pub rules: Vec<Rule>,
    pub freed_bytes: u64,
    /// `YYYY-MM-DD` - `freed_bytes` resets when the date rolls over.
    pub freed_date: String,
    pub window: WindowState,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            lang: "hu".into(),
            theme: "auto".into(),
            nav_collapsed: false,
            anchor: "left".into(),
            folders: default_folders(),
            toggles: Toggles::default(),
            age_days: 30,
            rules: Vec::new(),
            freed_bytes: 0,
            freed_date: String::new(),
            window: WindowState::default(),
        }
    }
}

/// Best-effort guess at where the user keeps code, used on first launch only.
fn default_folders() -> Vec<String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    let Some(home) = home else { return Vec::new() };

    let mut out = Vec::new();
    for candidate in ["dev", "Projects", "projects", "source/repos", "src", "code", "Code"] {
        let p = home.join(candidate);
        if p.is_dir() {
            out.push(p.to_string_lossy().to_string());
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub est: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub project: String,
    pub title: String,
    #[serde(default)]
    pub sub: String,
    #[serde(default)]
    pub features: Vec<Feature>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub project: String,
    pub text: String,
    /// `YYYY-MM-DD`, or empty for "no deadline".
    #[serde(default)]
    pub due: String,
    /// `paper` | `accent` | `ink`
    pub color: String,
    pub z: i64,
}

/// Owns the on-disk state. Every field is independently locked so a note drag
/// never blocks a settings write.
pub struct Store {
    dir: PathBuf,
    pub settings: Mutex<Settings>,
    pub goals: Mutex<Vec<Goal>>,
    pub notes: Mutex<Vec<Note>>,
}

impl Store {
    pub fn load(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let settings: Settings = read_json(&dir.join("settings.json")).unwrap_or_default();
        let goals: Vec<Goal> = read_json(&dir.join("goals.json")).unwrap_or_default();
        let notes: Vec<Note> = read_json(&dir.join("notes.json")).unwrap_or_default();

        Self { dir, settings: Mutex::new(settings), goals: Mutex::new(goals), notes: Mutex::new(notes) }
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    /// The window geometry is owned by the backend watcher, so whatever the
    /// frontend sends for it is ignored - otherwise a settings change made
    /// while the window is being dragged would write back a stale position.
    pub fn set_settings(&self, next: Settings) -> Result<(), String> {
        let mut current = self.settings.lock().unwrap();
        let merged = Settings { window: current.window.clone(), ..next };
        *current = merged.clone();
        drop(current);
        write_json(&self.dir.join("settings.json"), &merged)
    }

    /// Records where the window is now. No-op when nothing actually moved.
    pub fn set_window(&self, window: WindowState) -> Result<(), String> {
        let mut current = self.settings.lock().unwrap();
        if current.window == window {
            return Ok(());
        }
        current.window = window;
        let snapshot = current.clone();
        drop(current);
        write_json(&self.dir.join("settings.json"), &snapshot)
    }

    pub fn goals(&self) -> Vec<Goal> {
        self.goals.lock().unwrap().clone()
    }

    pub fn set_goals(&self, next: Vec<Goal>) -> Result<(), String> {
        *self.goals.lock().unwrap() = next.clone();
        write_json(&self.dir.join("goals.json"), &next)
    }

    pub fn notes(&self) -> Vec<Note> {
        self.notes.lock().unwrap().clone()
    }

    pub fn set_notes(&self, next: Vec<Note>) -> Result<(), String> {
        *self.notes.lock().unwrap() = next.clone();
        write_json(&self.dir.join("notes.json"), &next)
    }

    /// Last session's scan results, so the window has something to show the
    /// moment it opens instead of an empty list.
    ///
    /// Projects whose directory has since disappeared are dropped here rather
    /// than shown as ghosts until the rescan catches up.
    pub fn load_projects(&self) -> Vec<Project> {
        let Some(cache) = read_json::<ProjectCache>(&self.dir.join("projects.json")) else {
            return Vec::new();
        };
        if cache.version != CACHE_VERSION {
            return Vec::new();
        }
        cache
            .projects
            .into_iter()
            .filter(|p| Path::new(&p.path).is_dir())
            .collect()
    }

    pub fn save_projects(&self, projects: &[Project]) -> Result<(), String> {
        let cache = ProjectCache {
            version: CACHE_VERSION,
            saved_at: crate::scan::now_secs(),
            projects: projects.to_vec(),
        };
        write_json(&self.dir.join("projects.json"), &cache)
    }

    /// Adds to the running "freed today" counter, rolling it over at midnight.
    pub fn add_freed(&self, bytes: u64, today: &str) -> Settings {
        let mut s = self.settings.lock().unwrap();
        if s.freed_date != today {
            s.freed_date = today.to_string();
            s.freed_bytes = 0;
        }
        s.freed_bytes += bytes;
        let snapshot = s.clone();
        drop(s);
        let _ = write_json(&self.dir.join("settings.json"), &snapshot);
        snapshot
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let raw = fs::read_to_string(path).ok()?;
    // These files are meant to be hand-editable, and plenty of Windows editors
    // save UTF-8 with a BOM - which serde_json would otherwise reject, silently
    // resetting the user's settings to defaults.
    serde_json::from_str(raw.strip_prefix('\u{feff}').unwrap_or(&raw)).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| format!("{}: {e}", path.display()))?;
    // rename() replaces the destination on both Windows and unix.
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WITHOUT_ANCHOR: &str = r#"{
        "lang": "en", "theme": "dark", "navCollapsed": true,
        "folders": ["D:\\dev"],
        "toggles": {"scanStart": false, "watchFs": true, "deepGit": true, "docker": true},
        "ageDays": 90, "rules": [], "freedBytes": 0, "freedDate": ""
    }"#;

    fn load_with(body: &str) -> Settings {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("settings.json"), body).unwrap();
        Store::load(tmp.path().to_path_buf()).settings()
    }

    #[test]
    fn window_is_anchored_left_by_default() {
        assert_eq!(Settings::default().anchor, "left");
    }

    #[test]
    fn settings_written_before_the_anchor_existed_still_load() {
        let s = load_with(WITHOUT_ANCHOR);

        // The missing key falls back to the default rather than wiping the file.
        assert_eq!(s.anchor, "left");
        assert_eq!(s.lang, "en");
        assert_eq!(s.age_days, 90);
        assert_eq!(s.folders, vec!["D:\\dev".to_string()]);
    }

    #[test]
    fn a_utf8_bom_does_not_reset_settings() {
        // Windows editors love writing a BOM; serde_json rejects it outright,
        // which used to look like "the app forgot my settings".
        let s = load_with(&format!("\u{feff}{WITHOUT_ANCHOR}"));

        assert_eq!(s.lang, "en");
        assert_eq!(s.folders, vec!["D:\\dev".to_string()]);
        assert!(s.toggles.docker);
    }

    #[test]
    fn window_state_is_empty_until_the_window_is_moved() {
        let s = load_with(WITHOUT_ANCHOR);

        assert_eq!(s.window.x, None);
        assert_eq!(s.window.height, None);
        assert!(!s.window.maximized);
        assert!(s.window.widths.is_empty());
    }

    fn placed() -> WindowState {
        let mut w = WindowState {
            x: Some(-40), // a monitor to the left of the primary
            y: Some(120),
            height: Some(880),
            maximized: false,
            widths: BTreeMap::new(),
        };
        w.widths.insert("board".into(), 1740);
        w.widths.insert("projects".into(), 1180);
        w
    }

    #[test]
    fn window_position_and_size_survive_a_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();

        Store::load(dir.clone()).set_window(placed()).unwrap();

        // A fresh Store is what the next launch sees.
        let reloaded = Store::load(dir).settings();

        assert_eq!(reloaded.window.x, Some(-40));
        assert_eq!(reloaded.window.y, Some(120));
        assert_eq!(reloaded.window.height, Some(880));
        assert_eq!(reloaded.window.widths.get("board"), Some(&1740));
        assert_eq!(reloaded.window.widths.get("projects"), Some(&1180));
    }

    #[test]
    fn changing_a_setting_does_not_move_the_window() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::load(tmp.path().to_path_buf());
        store.set_window(placed()).unwrap();

        // The frontend round-trips the whole struct, and its copy of the
        // geometry is stale the moment the window moves.
        let stale = Settings { lang: "en".into(), ..Settings::default() };
        store.set_settings(stale).unwrap();

        let reloaded = Store::load(tmp.path().to_path_buf()).settings();
        assert_eq!(reloaded.lang, "en", "the real change must still apply");
        assert_eq!(reloaded.window, placed(), "geometry must survive untouched");
    }

    fn project_at(path: &str) -> Project {
        Project { id: "x".into(), name: "demo".into(), path: path.into(), ..Default::default() }
    }

    #[test]
    fn the_last_scan_is_available_on_the_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        let live = tempfile::tempdir().unwrap(); // a directory that still exists

        Store::load(dir.path().to_path_buf())
            .save_projects(&[project_at(&live.path().to_string_lossy())])
            .unwrap();

        let reloaded = Store::load(dir.path().to_path_buf()).load_projects();

        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].name, "demo");
    }

    #[test]
    fn a_cached_project_whose_folder_is_gone_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::load(dir.path().to_path_buf());
        store.save_projects(&[project_at("Z:\\definitely\\not\\here")]).unwrap();

        assert!(Store::load(dir.path().to_path_buf()).load_projects().is_empty());
    }

    #[test]
    fn a_cache_from_an_older_format_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("projects.json"),
            r#"{"version": 0, "savedAt": 1, "projects": [{"id":"x","name":"old"}]}"#,
        )
        .unwrap();

        assert!(Store::load(dir.path().to_path_buf()).load_projects().is_empty());
    }

    #[test]
    fn a_corrupt_file_falls_back_instead_of_panicking() {
        let s = load_with("{ this is not json");
        assert_eq!(s.lang, Settings::default().lang);
    }
}
