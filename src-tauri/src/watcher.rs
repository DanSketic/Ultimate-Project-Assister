//! Filesystem watching for live project state.
//!
//! Each project root and its `.git` directory is watched non-recursively.
//! That is deliberately shallow: it catches commits, branch switches and files
//! appearing or disappearing at the top level, without notify having to
//! register millions of `node_modules` paths.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};
use tauri::{AppHandle, Emitter};

pub const CHANGE_EVENT: &str = "upa://projects-changed";

/// Quiet period before a burst of filesystem events is reported.
const DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Default)]
pub struct Watcher {
    inner: Mutex<Option<RecommendedWatcher>>,
    /// Bumped on every `rewatch` so stale debounce threads retire themselves.
    generation: Arc<AtomicU64>,
}

impl Watcher {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.inner.lock().unwrap() = None;
    }

    /// Replaces the watch set with `projects`, given as `(id, root)` pairs.
    pub fn rewatch(&self, app: AppHandle, projects: Vec<(String, PathBuf)>) -> Result<(), String> {
        let my_generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.inner.lock().unwrap() = None;

        let (tx, rx) = channel::<PathBuf>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                for path in event.paths {
                    let _ = tx.send(path);
                }
            }
        })
        .map_err(|e| e.to_string())?;

        for (_, root) in &projects {
            let _ = watcher.watch(root, RecursiveMode::NonRecursive);
            let git = root.join(".git");
            if git.exists() {
                let _ = watcher.watch(&git, RecursiveMode::NonRecursive);
            }
        }

        *self.inner.lock().unwrap() = Some(watcher);

        let generation = Arc::clone(&self.generation);
        std::thread::spawn(move || {
            let mut pending: HashSet<String> = HashSet::new();
            loop {
                if generation.load(Ordering::SeqCst) != my_generation {
                    return;
                }
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(path) => {
                        if let Some(id) = owner_of(&path, &projects) {
                            pending.insert(id);
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if !pending.is_empty() {
                            let ids: Vec<String> = pending.drain().collect();
                            let _ = app.emit(CHANGE_EVENT, ids);
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        });

        Ok(())
    }
}

/// Longest matching project root wins, so nested roots resolve correctly.
fn owner_of(path: &Path, projects: &[(String, PathBuf)]) -> Option<String> {
    projects
        .iter()
        .filter(|(_, root)| path.starts_with(root))
        .max_by_key(|(_, root)| root.components().count())
        .map(|(id, _)| id.clone())
}
