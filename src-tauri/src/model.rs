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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub msg: String,
    /// Whole days between the commit and "now".
    pub days: i64,
    pub date: String,
    /// Who wrote it. `default` so a cache written before this field existed
    /// still loads - the project simply comes back with the author blank
    /// instead of being dropped from the list.
    #[serde(default)]
    pub author: String,
}

/// One changelog block, derived from an annotated or lightweight git tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub ver: String,
    pub date: String,
    pub notes: Vec<String>,
}

/// One version section of a `CHANGELOG.md`. Unlike `Release`, which is built
/// from git tags, this keeps the author's own markdown so the UI can render it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChangeEntry {
    /// `0.10.0`, `Unreleased`, ... - whatever the heading names.
    pub ver: String,
    /// Trailing date on the heading, empty when there is none.
    pub date: String,
    /// The section body, still markdown.
    pub body: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    /// The remote as a browsable page, e.g. `https://github.com/owner/repo`.
    /// Empty when there is no remote, or none that has a web page.
    pub remote: String,
    /// Days since this repository was last fetched. `None` when it never was,
    /// and when a cache written before this field existed is loaded - both are
    /// "we do not know", which is what the UI has to say.
    ///
    /// `behind` is counted against the remote-tracking ref on disk, which only
    /// moves on a fetch. Without this the UI would report "up to date" with the
    /// same confidence whether the last look at the remote was a minute or a
    /// month ago.
    pub fetch_days: Option<i64>,
}

/// A directory the cleaner is allowed to remove, with its measured size.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanTarget {
    /// `<project id>|<category>|<path>` - stable across rescans, and the key
    /// the selection is remembered under.
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
    /// Manifest the command was read out of: `package.json`, `Cargo.toml`,
    /// `Makefile`, ... Commands are grouped by this, so the list says where
    /// each entry actually came from.
    #[serde(default)]
    pub source: String,
    /// A headline operation - the ones that start, build or check the project.
    /// Shown first inside its group and given the stronger styling.
    #[serde(default)]
    pub primary: bool,
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
    /// One-line summary for the lists.
    pub desc: String,
    /// The whole README, still markdown. Empty when the project has none.
    pub readme: String,
    /// `CHANGELOG.md` split into version sections, newest first.
    pub changelog: Vec<ChangeEntry>,
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
    /// Bytes the whole run expects to free, so the bar can move smoothly
    /// through one large directory instead of per completed directory.
    pub total_bytes: u64,
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

/// Whether Docker is installed, whether the daemon is up, and what it holds.
///
/// `installed` and `daemon_running` are separate on purpose: Docker Desktop
/// present but shut down is an ordinary state with an obvious remedy, and
/// collapsing it into "unavailable" would hide that.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerStatus {
    pub installed: bool,
    pub cli_version: String,
    pub daemon_running: bool,
    pub server_version: String,
    pub containers_running: u32,
    pub containers_total: u32,
    pub images: u32,
    pub images_bytes: u64,
    pub build_cache_bytes: u64,
    pub volumes_bytes: u64,
    /// Why the daemon could not be reached; empty when it could.
    pub error: String,
}

/// One container of a project's compose stack.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    pub id: String,
    pub name: String,
    pub image: String,
    /// `running`, `exited`, `created`, `paused`, ...
    pub state: String,
    /// Human status, e.g. `Up 3 hours (healthy)`.
    pub status: String,
    pub ports: String,
    /// Compose service name, when the container came from a compose file.
    pub service: String,
}

/// A command this app started that already holds the port.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortUser {
    /// Key of the running command, so the UI can offer to stop exactly it.
    pub key: String,
    pub project_id: String,
    pub project: String,
    pub cmd: String,
}

/// A process outside this app that is holding a port.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortProcess {
    pub pid: u32,
    pub name: String,
    pub exe: String,
    /// False for a system process, which will not be stopped whatever it holds.
    pub killable: bool,
}

/// The answer to "can this command have its port?".
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortConflict {
    /// 0 when the command serves nothing and no check applies.
    pub port: u16,
    pub taken: bool,
    /// Set when the holder is a command this app started - the case it can stop
    /// cleanly, through the runner that owns it.
    pub holder: Option<PortUser>,
    /// Set when the holder is something else, named from the OS process table.
    pub process: Option<PortProcess>,
    /// A free port next door, and the command rewritten to ask for it. Zero and
    /// empty when the port is not the command's to choose - a compose stack
    /// publishes what its file says.
    pub suggested_port: u16,
    pub suggested_cmd: String,
}

/// One running process worth showing next to the projects.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: u32,
    pub name: String,
    pub exe: String,
    pub cmd: String,
    pub cwd: String,
    pub memory_bytes: u64,
    /// Seconds since the process started.
    pub run_secs: u64,
    /// TCP ports it is listening on.
    pub ports: Vec<u16>,
    /// The project it is working inside, when it is inside one.
    pub project_id: String,
    pub project: String,
    /// Key of the command this app started, empty when it started elsewhere.
    pub command_key: String,
    /// False for a system process, which will not be stopped.
    pub killable: bool,
}

/// A toolchain a project needs, and whether this machine has it.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub name: String,
    pub found: bool,
    pub version: String,
    pub path: String,
    /// The manifests in this project that call for it.
    pub required_by: Vec<String>,
    /// Ready-to-run install command, empty when there is no packaged install.
    pub install: String,
    pub docs: String,
}

/// Where a project's branch stands against the branch it tracks.
///
/// Built from refs on disk, so it costs nothing and can be asked for whenever
/// the UI needs it. Only `fetch` goes to the network, and what it changes is
/// the remote-tracking ref this is then read from.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub project_id: String,
    pub project: String,
    /// `ok` | `behind` | `ahead` | `diverged` | `detached` | `no-upstream` |
    /// `no-remote` | `not-a-repo` | `unborn` | `rebasing` | `merging`.
    ///
    /// One word for the whole situation, because every part of the UI that
    /// reacts to it - the badge, the dialog's headline, which button is
    /// offered - is answering the same question.
    pub state: String,
    pub branch: String,
    /// `origin/main`, or empty when the branch tracks nothing.
    pub upstream: String,
    pub ahead: usize,
    pub behind: usize,
    /// Uncommitted changes in the working tree. A rebase has to move these out
    /// of the way first, which is the one part of the answer that changes what
    /// the button does.
    pub dirty: usize,
    /// Commits on the upstream that this checkout does not have - what somebody
    /// else pushed while it was not looking.
    pub incoming: Vec<Commit>,
    /// Local commits that a rebase would replay on top of them.
    pub outgoing: Vec<Commit>,
    /// Everyone who wrote the incoming commits, most recent first.
    pub authors: Vec<String>,
    /// Days since the last fetch; `None` when the repository has never been
    /// fetched, so the counts above have never been checked against a remote.
    pub fetch_days: Option<i64>,
    /// Files git reports as conflicted. Non-empty only after a rebase stopped.
    pub conflicts: Vec<String>,
    /// Why the last remote check failed; empty when it did not.
    pub error: String,
}

/// What a rebase did, in the terms the dialog has to report it.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseReport {
    /// `up-to-date` | `fast-forward` | `rebased` | `conflict` | `aborted` |
    /// `stash-conflict` | `failed`.
    pub outcome: String,
    /// Git's own output, kept whole. When a rebase stops, what git printed is
    /// the instruction the user needs, and paraphrasing it would lose it.
    pub output: String,
    pub conflicts: Vec<String>,
    /// The state after the attempt, so the dialog never has to guess.
    pub status: SyncStatus,
}

// ---------------------------------------------------------------------------
// Claude Code session history
// ---------------------------------------------------------------------------

/// What one session spent, in tokens. Cached reads and writes are kept apart
/// from plain input because they are priced apart: most of a long session's
/// input is the same context being read back at a tenth of the price.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

/// A model or a tool, and how often the session reached for it.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUse {
    pub name: String,
    pub count: usize,
}

/// One Claude Code session, summarised from its log file.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSession {
    /// The session id, which is also the log file's name.
    pub id: String,
    pub title: String,
    /// The project it was held in; empty when the directory is not one the app
    /// knows about - an old checkout, or a folder outside the watched roots.
    pub project_id: String,
    /// Display name of that project, or the working directory's own name.
    pub project: String,
    pub path: String,
    pub branch: String,
    /// ISO timestamps of the first and last message.
    pub started_at: String,
    pub ended_at: String,
    /// User turns plus assistant turns. Tool results are not messages.
    pub messages: usize,
    pub user_messages: usize,
    /// Messages belonging to a subagent rather than to the conversation.
    pub sidechains: usize,
    pub tool_calls: usize,
    /// Tool results that came back as failures.
    pub errors: usize,
    pub tokens: ClaudeTokens,
    /// Estimated against published API rates - a subscription is not billed
    /// this way, so this is a size, not an invoice.
    pub cost_usd: f64,
    pub models: Vec<ClaudeUse>,
    pub tools: Vec<ClaudeUse>,
    pub size_bytes: u64,
}

/// Every session found on this machine. `available` is false when Claude Code
/// has never run here, which is an ordinary state rather than a failure.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStats {
    pub available: bool,
    pub root: String,
    pub sessions: Vec<ClaudeSession>,
}

/// One turn of a conversation, trimmed for reading.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMessage {
    /// `user` or `assistant`.
    pub role: String,
    pub time: String,
    /// The message text, cut to a readable length.
    pub text: String,
    /// Tools this turn called, by name.
    pub tools: Vec<String>,
    /// Whether the turn included thinking. The thinking itself is not kept.
    pub thinking: bool,
    /// A tool result that came back as a failure.
    pub error: bool,
    /// Part of a subagent's conversation rather than of the main one.
    pub sidechain: bool,
}
