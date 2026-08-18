//! Deletion of build junk.
//!
//! Deleting recursively is the one genuinely dangerous thing this app does, so
//! `validate` gates every removal behind three independent checks: the target
//! must resolve inside its project, it must not be the project root, and its
//! directory name must appear in `DELETABLE_NAMES`. A bug upstream therefore
//! cannot turn into a deleted source tree.

use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::model::CleanTarget;

/// Directory names the cleaner is ever allowed to remove.
const DELETABLE_NAMES: &[&str] = &[
    "node_modules",
    "target",
    "debug",
    "release",
    "incremental",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "_build",
    ".turbo",
    ".astro",
    ".svelte-kit",
    ".parcel-cache",
    ".vite",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "artifacts",
    "checkpoints",
    "wandb",
    "bin",
    "vendor",
    "bundle",
    ".dart_tool",
    "cache",
    "coverage",
    ".gradle",
    "cmake-build-debug",
    "cmake-build-release",
    "deps",
];

fn validate(path: &Path, project_root: &Path) -> Result<PathBuf, String> {
    let root = project_root
        .canonicalize()
        .map_err(|e| format!("project root unreadable: {e}"))?;
    let target = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;

    if !target.is_dir() {
        return Err(format!("{} is not a directory", target.display()));
    }
    if target == root {
        return Err("refusing to delete the project root".into());
    }
    if !target.starts_with(&root) {
        return Err(format!("{} is outside {}", target.display(), root.display()));
    }

    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if !DELETABLE_NAMES.contains(&name.as_str()) {
        return Err(format!("{name} is not a known build directory"));
    }

    Ok(target)
}

/// Directories that are buckets in their own right. A wildcard target must not
/// reach inside them: their bytes were attributed there, and they are removed
/// wholesale when that bucket is selected.
const COVERED_ELSEWHERE: &[&str] = &[
    "node_modules",
    "target",
    "build",
    "_build",
    "dist",
    ".next",
    ".venv",
    "venv",
    "vendor",
    ".dart_tool",
    ".turbo",
    ".gradle",
];

/// Expands a target into the concrete directories to remove. A path holding
/// `**` (for example `<root>\**\__pycache__`) fans out to every match.
fn resolve(target: &CleanTarget, project_root: &Path) -> Vec<PathBuf> {
    let raw = PathBuf::from(&target.path);

    if !target.path.contains("**") {
        return vec![raw];
    }

    let Some(name) = raw.file_name().map(|n| n.to_os_string()) else { return Vec::new() };
    WalkDir::new(project_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0 || !COVERED_ELSEWHERE.contains(&e.file_name().to_string_lossy().as_ref())
        })
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_dir() && e.file_name() == name)
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// Removes one clean target. Returns the number of bytes actually freed.
/// Removes a directory a file at a time, reporting as it goes.
///
/// `remove_dir_all` is one call that returns when it is finished, so a single
/// three-gigabyte `node_modules` left the progress bar frozen on one position
/// for the whole removal. Walking it means the caller can be told what has gone
/// so far, at the cost of a little speed.
fn remove_reporting(dir: &Path, on: &mut dyn FnMut(u64, &Path)) -> Result<u64, String> {
    let mut freed = 0u64;
    let mut since_report = 0u64;
    let mut errors: Vec<String> = Vec::new();

    // Contents first, so a directory is only removed once it is empty.
    for entry in WalkDir::new(dir).contents_first(true).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        let is_dir = entry.file_type().is_dir();
        let size = if is_dir { 0 } else { entry.metadata().map(|m| m.len()).unwrap_or(0) };

        let result = if is_dir { fs::remove_dir(path) } else { remove_file(path) };
        match result {
            Ok(()) => {
                freed += size;
                since_report += size;
            }
            // Something else removed it first; nothing to report or complain about.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => errors.push(format!("{}: {e}", path.display())),
        }

        // Reporting every file would flood the channel with a message per
        // 4 KB file; a few megabytes is enough to keep a bar moving.
        if since_report >= REPORT_EVERY {
            since_report = 0;
            on(freed, path);
        }
    }

    if errors.is_empty() {
        Ok(freed)
    } else {
        Err(errors.join("; "))
    }
}

/// How much has to be freed before the caller is told again.
const REPORT_EVERY: u64 = 8 * 1024 * 1024;

/// Removes one file, clearing the read-only attribute if that is what stopped
/// it. Package managers and build tools leave read-only files behind often
/// enough that failing on them would leave junk the cleaner claims to remove.
fn remove_file(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            let mut perms = fs::metadata(path)?.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            perms.set_readonly(false);
            fs::set_permissions(path, perms)?;
            fs::remove_file(path)
        }
        other => other,
    }
}

/// Deletes one cleanup target, reporting bytes freed as it works.
///
/// `on_progress` is handed the running total for this target and the path being
/// removed at the time.
pub fn delete_target(
    target: &CleanTarget,
    project_root: &Path,
    on_progress: &mut dyn FnMut(u64, &Path),
) -> Result<u64, String> {
    let mut freed = 0u64;
    let mut errors: Vec<String> = Vec::new();

    for candidate in resolve(target, project_root) {
        match validate(&candidate, project_root) {
            Ok(safe) => {
                let base = freed;
                // The callback is given the target's running total, not this
                // directory's, so several wildcard matches read as one job.
                let mut relay = |so_far: u64, path: &Path| on_progress(base + so_far, path);
                match remove_reporting(&safe, &mut relay) {
                    Ok(size) => freed += size,
                    Err(e) => errors.push(e),
                }
            }
            // A path that vanished between the scan and the delete is fine.
            Err(e) if e.contains("os error 2") || e.contains("os error 3") => {}
            Err(e) => errors.push(e),
        }
    }

    if errors.is_empty() {
        Ok(freed)
    } else if freed > 0 {
        // Partial success still reports what was freed, with the failures.
        Err(format!("{} ({} freed)", errors.join("; "), freed))
    } else {
        Err(errors.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;


    /// The point of walking rather than calling `remove_dir_all`: the caller
    /// hears about it while it happens.
    #[test]
    fn removal_reports_progress_and_leaves_nothing_behind() {
        let tmp = tempfile::tempdir().unwrap();
        let victim = tmp.path().join("node_modules");
        fs::create_dir_all(victim.join("pkg/deep")).unwrap();

        // Enough bytes to cross the reporting threshold several times over.
        let chunk = vec![b'x'; 3 * 1024 * 1024];
        for i in 0..8 {
            fs::write(victim.join(format!("pkg/deep/file{i}.bin")), &chunk).unwrap();
        }

        let mut ticks: Vec<u64> = Vec::new();
        let mut on = |so_far: u64, _p: &Path| ticks.push(so_far);
        let freed = remove_reporting(&victim, &mut on).unwrap();

        assert_eq!(freed, 8 * 3 * 1024 * 1024, "every byte is accounted for");
        assert!(!victim.exists(), "the directory itself goes too");
        assert!(ticks.len() > 1, "progress was reported during the walk, not just at the end");
        assert!(ticks.windows(2).all(|w| w[1] >= w[0]), "the running total never goes backwards");
        assert!(ticks.last().unwrap() <= &freed);
    }

    #[test]
    fn a_read_only_file_is_still_removed() {
        // Build tools leave these behind; failing on them would leave junk the
        // cleaner claims to have removed.
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("target");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("locked.bin");
        fs::write(&file, b"hello").unwrap();

        let mut perms = fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&file, perms).unwrap();

        let mut on = |_: u64, _: &Path| {};
        remove_reporting(&dir, &mut on).unwrap();

        assert!(!dir.exists());
    }

    #[test]
    fn refuses_paths_outside_the_project() {
        let tmp = std::env::temp_dir();
        assert!(validate(&tmp, Path::new(".")).is_err());
    }
}
