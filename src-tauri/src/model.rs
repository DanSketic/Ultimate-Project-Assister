//! Types shared with the TypeScript frontend.
//!
//! Everything here is serialised as camelCase so the React side can use the
//! shapes directly without an adapter layer.

use serde::{Deserialize, Serialize};

/// Share of one language inside a project, by source bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LangShare {
    pub name: String,
    pub pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub msg: String,
    /// Whole days between the commit and "now".
    pub days: i64,
    pub date: String,
}

/// One changelog block, derived from an annotated or lightweight git tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub ver: String,
    pub date: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub is_repo: bool,
    pub branch: String,
    pub dirty: usize,
    pub ahead: usize,
    pub behind: usize,
    /// Days since the last commit. `-1` when the repo has no commits.
    pub days: i64,
    pub tag: String,
    pub tags: Vec<String>,
    pub commits: Vec<Commit>,
    pub releases: Vec<Release>,
    pub first_commit: String,
    pub last_commit: String,
}

/// A directory the cleaner is allowed to remove, with its measured size.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanTarget {
    /// `<project name>|<category>` - stable across rescans, used as a selection key.
    pub key: String,
    /// Identity of the owning project. Two projects can share a name, so
    /// anything that groups or selects must use this rather than `project`.
    pub project_id: String,
    /// Display name of the owning project.
    pub project: String,
    /// Package this directory belongs to, relative to the project root. Empty
    /// for a single-package project.
    pub part: String,
    pub cat: String,
    pub path: String,
    pub bytes: u64,
    /// Days since the newest file inside the target was written.
    pub age_days: i64,
}

/// A runnable command detected from the project's manifests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDef {
    /// `npm` | `cargo` | `docker` | `make` | `py` - drives the badge colour.
    pub kind: String,
    pub name: String,
    pub cmd: String,
    /// Directory to run in, relative to the project root. Empty means the root
    /// itself; in a monorepo this is `frontend`, `backend`, `apps/web`, ...
    #[serde(default)]
    pub cwd: String,
    /// Display label of the part this command belongs to.
    #[serde(default)]
    pub part: String,
}

/// One package inside a project. A single-package project has exactly one part
/// covering its root; a monorepo has one per workspace member.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPart {
    /// Directory name, or the project name for the root part.
    pub name: String,
    /// Path relative to the project root; empty for the root part.
    pub rel: String,
    pub path: String,
    pub stack: String,
    pub manifests: Vec<String>,
    pub size_bytes: u64,
    pub reclaim_bytes: u64,
    /// Bytes of source outside any cleanable directory - decides which part
    /// gives the project its headline stack.
    pub source_bytes: u64,
}

/// `default` lets a cache written by an older build still load: a field added
/// since then simply comes back empty instead of discarding the whole file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub stack: String,
    pub langs: Vec<LangShare>,
    pub files: u64,
    pub loc: u64,
    pub size_bytes: u64,
    pub reclaim_bytes: u64,
    pub version: String,
    pub desc: String,
    pub manifests: Vec<String>,
    /// Always at least one entry. More than one means a monorepo.
    pub parts: Vec<ProjectPart>,
    pub commands: Vec<CommandDef>,
    pub clean_targets: Vec<CleanTarget>,
    pub git: GitInfo,
    /// Unix seconds of the last successful scan of this project.
    pub scanned_at: i64,
}

/// Progress ticks emitted on `upa://scan-progress` while a scan runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: usize,
    pub total: usize,
    pub current: String,
}

/// Summary emitted on `upa://scan-done` and returned by `scan_projects`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub projects: Vec<Project>,
    pub elapsed_ms: u128,
    pub roots: Vec<String>,
}

/// One line of a running command's output.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub key: String,
    pub project: String,
    pub cmd: String,
    pub text: String,
    /// `cmd` (the echoed command line), `out`, `err` or `exit`.
    pub stream: String,
    pub time: String,
}

/// Emitted on `upa://clean-progress` while a cleanup runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanProgress {
    /// `delete` while directories are being removed, `rescan` while the
    /// affected projects are re-measured, `done` when everything is finished.
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub current: String,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub freed_bytes: u64,
    pub removed: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysStats {
    pub rss_bytes: u64,
}

/// Docker's own view of what it could reclaim, when the Docker toggle is on.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerUsage {
    pub available: bool,
    pub images_bytes: u64,
    pub build_cache_bytes: u64,
}
