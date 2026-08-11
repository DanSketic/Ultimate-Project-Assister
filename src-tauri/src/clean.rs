//! Deletion of build junk, plus Docker's reclaimable numbers.
//!
//! Deleting recursively is the one genuinely dangerous thing this app does, so
//! `validate` gates every removal behind three independent checks: the target
//! must resolve inside its project, it must not be the project root, and its
//! directory name must appear in `DELETABLE_NAMES`. A bug upstream therefore
//! cannot turn into a deleted source tree.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use walkdir::WalkDir;

use crate::model::{CleanTarget, DockerUsage};

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

fn dir_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
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
pub fn delete_target(target: &CleanTarget, project_root: &Path) -> Result<u64, String> {
    let mut freed = 0u64;
    let mut errors: Vec<String> = Vec::new();

    for candidate in resolve(target, project_root) {
        match validate(&candidate, project_root) {
            Ok(safe) => {
                let size = dir_size(&safe);
                match fs::remove_dir_all(&safe) {
                    Ok(()) => freed += size,
                    Err(e) => errors.push(format!("{}: {e}", safe.display())),
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

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

/// Parses `4.9GB`, `812.4 MB`, `0B` into bytes.
fn parse_human_size(raw: &str) -> u64 {
    let raw = raw.trim();
    let split = raw
        .find(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(raw.len());
    let (num, unit) = raw.split_at(split);
    let Ok(value) = num.trim().parse::<f64>() else { return 0 };

    let mult = match unit.trim().to_ascii_lowercase().as_str() {
        "b" => 1.0,
        "kb" | "kib" => 1024.0,
        "mb" | "mib" => 1024.0 * 1024.0,
        "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 0.0,
    };
    (value * mult) as u64
}

/// Asks the Docker daemon what it could reclaim. Never fails loudly - Docker
/// simply not being installed is the common case.
pub fn docker_usage() -> DockerUsage {
    let mut cmd = Command::new("docker");
    cmd.args(["system", "df", "--format", "{{.Type}}\t{{.Reclaimable}}"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let Ok(out) = cmd.output() else { return DockerUsage::default() };
    if !out.status.success() {
        return DockerUsage::default();
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut usage = DockerUsage { available: true, ..Default::default() };

    for line in text.lines() {
        let Some((kind, reclaimable)) = line.split_once('\t') else { continue };
        // Docker appends a percentage: "4.9GB (100%)".
        let size = reclaimable.split('(').next().unwrap_or("").trim();
        let bytes = parse_human_size(size);
        match kind.trim() {
            "Images" => usage.images_bytes = bytes,
            "Build Cache" => usage.build_cache_bytes = bytes,
            _ => {}
        }
    }

    usage
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_docker_sizes() {
        assert_eq!(parse_human_size("0B"), 0);
        assert_eq!(parse_human_size("1KB"), 1024);
        assert_eq!(parse_human_size("2.5 MB"), 2_621_440);
    }

    #[test]
    fn refuses_paths_outside_the_project() {
        let tmp = std::env::temp_dir();
        assert!(validate(&tmp, Path::new(".")).is_err());
    }
}
