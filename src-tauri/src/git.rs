//! Read-only git inspection via libgit2.
//!
//! The cheap parts (branch, dirty count, ahead/behind, last five commits) run
//! on every scan. Tag history and the changelog are only built when the
//! "deep git analysis" setting is on, because they need a full revwalk.

use std::path::Path;
use std::process::Command;

use git2::{BranchType, Repository, RepositoryState, Sort, StatusOptions};

use crate::model::{Commit, GitInfo, RebaseReport, Release, SyncStatus};

/// Tags beyond this count are not resolved - some repos carry thousands.
const MAX_TAGS_RESOLVED: usize = 300;

fn fmt_date(secs: i64) -> String {
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

fn days_since(secs: i64) -> i64 {
    let now = crate::scan::now_secs();
    ((now - secs) / 86_400).max(0)
}

/// Turns a remote into the page a browser can open.
///
/// `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git` both
/// become `https://github.com/owner/repo`. Anything that is not an http or ssh
/// remote - a local path, a file:// URL - yields nothing, because there is no
/// page to open for it.
pub fn web_url(raw: &str) -> String {
    let raw = raw.trim().trim_end_matches('/');
    let raw = raw.strip_suffix(".git").unwrap_or(raw);

    // scp-like syntax: [user@]host:path
    let rest = if let Some(rest) = raw.strip_prefix("git@") {
        rest.replacen(':', "/", 1)
    } else if let Some(rest) = raw.strip_prefix("ssh://") {
        // ssh://git@host/owner/repo, and possibly a port to drop.
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        match rest.split_once('/') {
            Some((host, path)) => format!("{}/{path}", host.split(':').next().unwrap_or(host)),
            None => return String::new(),
        }
    } else if let Some(rest) = raw.strip_prefix("https://") {
        rest.split_once('@').map(|(_, r)| r.to_string()).unwrap_or_else(|| rest.to_string())
    } else if let Some(rest) = raw.strip_prefix("http://") {
        rest.to_string()
    } else {
        return String::new();
    };

    // A host *and* a path, or there is nothing to link to. Checking only for a
    // separator is not enough: `git@github.com:` leaves a bare host.
    let Some((host, path)) = rest.split_once('/') else { return String::new() };
    if host.is_empty() || path.is_empty() {
        return String::new();
    }
    format!("https://{host}/{path}")
}

/// The page for one tag on the hosting service.
///
/// GitHub gets its releases page, which is where a tag's notes and downloads
/// live. Everything else gets the tree view, which every host understands.
pub fn tag_url(remote: &str, tag: &str) -> String {
    if remote.is_empty() || tag.is_empty() || tag == "—" {
        return String::new();
    }
    let encoded = tag.replace('#', "%23").replace('?', "%3F").replace(' ', "%20");
    if remote.starts_with("https://github.com/") {
        format!("{remote}/releases/tag/{encoded}")
    } else {
        format!("{remote}/tree/{encoded}")
    }
}

pub fn inspect(root: &Path, deep: bool) -> GitInfo {
    let Ok(repo) = Repository::open(root) else {
        return GitInfo::default();
    };

    let mut info = GitInfo { is_repo: true, tag: "—".into(), ..Default::default() };

    // --- branch -----------------------------------------------------------
    let head = repo.head().ok();
    info.branch = head
        .as_ref()
        .and_then(|h| h.shorthand())
        .unwrap_or("HEAD")
        .to_string();

    // --- remote -----------------------------------------------------------
    // Whatever the branch tracks, falling back to origin.
    info.remote = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(web_url))
        .unwrap_or_default();

    info.fetch_days = fetch_days(&repo);

    // --- working tree state ----------------------------------------------
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(false);
    info.dirty = repo.statuses(Some(&mut opts)).map(|s| s.len()).unwrap_or(0);

    // --- ahead / behind ---------------------------------------------------
    if let Ok(branch) = repo.find_branch(&info.branch, BranchType::Local) {
        if let Ok(upstream) = branch.upstream() {
            if let (Some(local), Some(remote)) = (branch.get().target(), upstream.get().target()) {
                if let Ok((ahead, behind)) = repo.graph_ahead_behind(local, remote) {
                    info.ahead = ahead;
                    info.behind = behind;
                }
            }
        }
    }

    // --- recent commits ---------------------------------------------------
    let head_commit = head.as_ref().and_then(|h| h.peel_to_commit().ok());
    match head_commit {
        Some(ref c) => {
            let secs = c.time().seconds();
            info.days = days_since(secs);
            info.last_commit = fmt_date(secs);
        }
        None => {
            // Repository with no commits yet.
            info.days = -1;
            return info;
        }
    }

    if let Ok(mut walk) = repo.revwalk() {
        let _ = walk.push_head();
        let _ = walk.set_sorting(Sort::TIME);
        info.commits = walk
            .filter_map(Result::ok)
            .filter_map(|oid| repo.find_commit(oid).ok())
            .take(5)
            .map(|c| {
                let secs = c.time().seconds();
                Commit {
                    sha: c.id().to_string().chars().take(7).collect(),
                    msg: c.summary().unwrap_or("").to_string(),
                    days: days_since(secs),
                    date: fmt_date(secs),
                    author: c.author().name().unwrap_or("").to_string(),
                }
            })
            .collect();
    }

    // --- tags -------------------------------------------------------------
    let mut tags: Vec<(String, i64, git2::Oid)> = Vec::new();
    if let Ok(names) = repo.tag_names(None) {
        let all: Vec<String> = names.iter().flatten().map(str::to_string).collect();
        let slice = if all.len() > MAX_TAGS_RESOLVED {
            &all[all.len() - MAX_TAGS_RESOLVED..]
        } else {
            &all[..]
        };
        for name in slice {
            let Ok(obj) = repo.revparse_single(&format!("refs/tags/{name}")) else { continue };
            let Ok(commit) = obj.peel_to_commit() else { continue };
            tags.push((name.clone(), commit.time().seconds(), commit.id()));
        }
    }
    tags.sort_by(|a, b| b.1.cmp(&a.1));

    info.tags = tags.iter().take(4).map(|t| t.0.clone()).collect();
    if let Some(latest) = tags.first() {
        info.tag = latest.0.clone();
    }

    if !deep {
        return info;
    }

    // --- changelog from tag ranges ---------------------------------------
    for (i, (name, secs, oid)) in tags.iter().take(3).enumerate() {
        let mut notes = Vec::new();
        if let Ok(mut walk) = repo.revwalk() {
            let _ = walk.push(*oid);
            if let Some(prev) = tags.get(i + 1) {
                let _ = walk.hide(prev.2);
            }
            let _ = walk.set_sorting(Sort::TIME);
            notes = walk
                .filter_map(Result::ok)
                .filter_map(|o| repo.find_commit(o).ok())
                .take(6)
                .filter_map(|c| c.summary().map(str::to_string))
                .collect();
        }
        if notes.is_empty() {
            notes.push(name.clone());
        }
        info.releases.push(Release { ver: name.clone(), date: fmt_date(*secs), notes });
    }

    // --- first commit -----------------------------------------------------
    if let Ok(mut walk) = repo.revwalk() {
        let _ = walk.push_head();
        let _ = walk.set_sorting(Sort::TIME | Sort::REVERSE);
        if let Some(first) = walk
            .filter_map(Result::ok)
            .next()
            .and_then(|oid| repo.find_commit(oid).ok())
        {
            info.first_commit = fmt_date(first.time().seconds());
        }
    }

    info
}

// ---------------------------------------------------------------------------
// Remote state
// ---------------------------------------------------------------------------

/// How many commits from either side of a divergence the dialog lists. Enough
/// to see who has been working and on what; a hundred would just be a wall.
const MAX_LISTED: usize = 12;

/// A transfer that has stalled gives up rather than holding a thread open: a
/// remote behind a dead VPN would otherwise never answer at all.
const STALL: [&str; 4] = ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=20"];

/// Days since `FETCH_HEAD` was last written, or `None` when it never was.
///
/// This is what says whether `behind` was checked against the remote recently,
/// or has been carried forward untouched since the clone.
fn fetch_days(repo: &Repository) -> Option<i64> {
    let stamp = repo.path().join("FETCH_HEAD");
    let secs = std::fs::metadata(stamp)
        .and_then(|m| m.modified())
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    Some(days_since(secs))
}

/// The branch a stopped rebase started from, or `None` when none is running.
///
/// Git writes it into the rebase state directory and nowhere else, and while
/// the rebase is stopped HEAD itself is detached - so this is the only place
/// the name survives.
fn rebase_head_name(repo: &Repository) -> Option<String> {
    let git = repo.path();
    let raw = std::fs::read_to_string(git.join("rebase-merge").join("head-name"))
        .or_else(|_| std::fs::read_to_string(git.join("rebase-apply").join("head-name")))
        .ok()?;
    let name = raw.trim().trim_start_matches("refs/heads/").to_string();
    (!name.is_empty()).then_some(name)
}

/// The whole situation in one word, from the two counts that describe it.
fn classify(ahead: usize, behind: usize) -> &'static str {
    match (ahead > 0, behind > 0) {
        (true, true) => "diverged",
        (false, true) => "behind",
        (true, false) => "ahead",
        (false, false) => "ok",
    }
}

/// Runs git in a repository and hands back everything it said.
///
/// The command line tool rather than libgit2, because this is where the user's
/// own credential helper, ssh agent and proxy settings already live. A fetch
/// through libgit2 would have to reimplement all three and would still fail on
/// exactly the private repositories that make this feature worth having.
fn git_cli(root: &Path, args: &[&str]) -> Result<(bool, String), String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(root).args(args);
    // A missing credential must fail rather than park the process on a prompt
    // that has no terminal to appear in. A GUI helper still runs.
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    // A non-interactive rebase does not open an editor. If some configuration
    // makes it try anyway, it must not block waiting for one either.
    cmd.env("GIT_EDITOR", "true");
    cmd.env("GIT_SEQUENCE_EDITOR", "true");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let out = cmd.output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "git is not installed, or not on PATH".to_string(),
        _ => e.to_string(),
    })?;

    // Git says most of what matters on stderr - the progress, and the reason a
    // rebase stopped - so the two streams are kept together, in the order they
    // would have appeared in a terminal.
    let mut text = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(err.trim_end());
    }
    Ok((out.status.success(), text.trim().to_string()))
}

/// The first line that says something, for a message that has room for one.
fn first_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("git did not say why")
        .chars()
        .take(200)
        .collect()
}

/// Commits reachable from `from` but not from `hide`, newest first.
fn commits_between(repo: &Repository, from: git2::Oid, hide: git2::Oid) -> Vec<Commit> {
    let Ok(mut walk) = repo.revwalk() else { return Vec::new() };
    if walk.push(from).is_err() {
        return Vec::new();
    }
    let _ = walk.hide(hide);
    let _ = walk.set_sorting(Sort::TIME);

    walk.filter_map(Result::ok)
        .filter_map(|oid| repo.find_commit(oid).ok())
        .take(MAX_LISTED)
        .map(|c| {
            let secs = c.time().seconds();
            Commit {
                sha: c.id().to_string().chars().take(7).collect(),
                msg: c.summary().unwrap_or("").to_string(),
                days: days_since(secs),
                date: fmt_date(secs),
                author: c.author().name().unwrap_or("").to_string(),
            }
        })
        .collect()
}

/// Where this checkout stands against the branch it tracks.
///
/// Reads refs on disk only, so it is instant and safe to ask for whenever the
/// UI needs it. The counts are as old as the last fetch, which is exactly why
/// `fetch_days` travels with them.
pub fn sync_status(root: &Path) -> SyncStatus {
    let mut status = SyncStatus::default();

    let Ok(repo) = Repository::open(root) else {
        status.state = "not-a-repo".into();
        return status;
    };
    status.fetch_days = fetch_days(&repo);

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(false);
    if let Ok(entries) = repo.statuses(Some(&mut opts)) {
        status.dirty = entries.len();
        status.conflicts = entries
            .iter()
            .filter(|e| e.status().is_conflicted())
            .filter_map(|e| e.path().map(str::to_string))
            .collect();
    }

    // An unfinished rebase or merge outranks everything below it: until that is
    // carried through or undone, no other answer is one the user can act on.
    let interrupted = match repo.state() {
        RepositoryState::Clean => "",
        RepositoryState::Merge => "merging",
        RepositoryState::Rebase | RepositoryState::RebaseInteractive | RepositoryState::RebaseMerge => "rebasing",
        _ => "busy",
    };

    let has_remote = repo.remotes().map(|r| !r.is_empty()).unwrap_or(false);

    let Ok(head) = repo.head() else {
        status.state = "unborn".into();
        return status;
    };

    // A rebase parks HEAD on a detached commit while it replays, and records
    // the branch it started from nowhere else. Reading that first is what keeps
    // a rebase that stopped from being reported as a detached checkout - which
    // is true, and useless.
    let replaying = rebase_head_name(&repo);
    status.branch = replaying
        .clone()
        .or_else(|| head.shorthand().map(str::to_string))
        .unwrap_or_else(|| "HEAD".into());

    if replaying.is_none() && repo.head_detached().unwrap_or(false) {
        status.state = "detached".into();
        return status;
    }

    // The branch ref rather than HEAD: mid-rebase they are different, and the
    // branch is the one the counts are about.
    let Some(branch) = repo.find_branch(&status.branch, BranchType::Local).ok() else {
        status.state = if interrupted.is_empty() { "detached" } else { interrupted }.into();
        return status;
    };
    let Some(local) = branch.get().target() else {
        status.state = "unborn".into();
        return status;
    };

    // No upstream is two situations with two different remedies: a repository
    // with no remote at all, and a branch that has never been pushed. Which one
    // it is happens to be the whole of the help that can be given here.
    let Some(upstream) = branch.upstream().ok() else {
        status.state = if has_remote { "no-upstream" } else { "no-remote" }.into();
        return status;
    };

    status.upstream = upstream.name().ok().flatten().unwrap_or_default().to_string();

    let Some(remote) = upstream.get().target() else {
        status.state = "no-upstream".into();
        return status;
    };

    if let Ok((ahead, behind)) = repo.graph_ahead_behind(local, remote) {
        status.ahead = ahead;
        status.behind = behind;
    }

    status.incoming = commits_between(&repo, remote, local);
    status.outgoing = commits_between(&repo, local, remote);

    // Who has been working here while this checkout was not looking. The order
    // is the commit order, so the first name is the most recent one.
    for commit in &status.incoming {
        if !commit.author.is_empty() && !status.authors.contains(&commit.author) {
            status.authors.push(commit.author.clone());
        }
    }

    status.state = if interrupted.is_empty() {
        classify(status.ahead, status.behind).into()
    } else {
        interrupted.into()
    };
    status
}

/// Updates the remote-tracking refs. Touches nothing in the working tree.
///
/// This is the only part of the feature that goes to the network, and the only
/// reason `behind` is ever more than a guess: it is counted against a ref that
/// moves on a fetch and at no other time.
pub fn fetch(root: &Path) -> Result<String, String> {
    let mut args = STALL.to_vec();
    args.extend(["fetch", "--prune", "--quiet"]);

    match git_cli(root, &args)? {
        (true, text) => Ok(text),
        (false, text) => Err(first_line(&text)),
    }
}

/// Replays the local commits on top of what the remote has.
///
/// `--autostash` because refusing over one unsaved file is the reason people
/// give up on this and go and do it by hand. Nothing here is interactive: it
/// either finishes, or it stops on a conflict and says so, and both outcomes
/// are reported rather than left in git's output for somebody to find.
pub fn rebase(root: &Path) -> RebaseReport {
    let before = sync_status(root);
    let mut report = RebaseReport { status: before.clone(), ..Default::default() };

    if !matches!(before.state.as_str(), "ok" | "behind" | "ahead" | "diverged") {
        report.outcome = "failed".into();
        report.output = format!("cannot rebase while the repository is {}", before.state);
        return report;
    }
    if before.upstream.is_empty() {
        report.outcome = "failed".into();
        report.output = "this branch tracks no remote branch".into();
        return report;
    }
    if before.behind == 0 {
        report.outcome = "up-to-date".into();
        return report;
    }

    // Nothing of our own to replay means this is a fast-forward, which is worth
    // keeping hold of: it is the outcome with no way to go wrong.
    let fast_forward = before.outgoing.is_empty();

    let text = match git_cli(root, &["rebase", "--autostash", &before.upstream]) {
        Ok((_, text)) => text,
        Err(e) => {
            report.outcome = "failed".into();
            report.output = e;
            return report;
        }
    };

    let after = sync_status(root);
    report.output = text;
    report.conflicts = after.conflicts.clone();
    // Read from the repository rather than from the exit code: a rebase that
    // stopped, and one that finished but could not put the stashed changes
    // back, are different things to be told to do next.
    report.outcome = if after.state == "rebasing" {
        "conflict"
    } else if !after.conflicts.is_empty() {
        "stash-conflict"
    } else if after.behind == 0 {
        if fast_forward {
            "fast-forward"
        } else {
            "rebased"
        }
    } else {
        "failed"
    }
    .into();
    report.status = after;
    report
}

/// Puts the branch back exactly where it was before a rebase stopped.
pub fn rebase_abort(root: &Path) -> RebaseReport {
    let mut report = RebaseReport::default();

    let text = match git_cli(root, &["rebase", "--abort"]) {
        Ok((_, text)) => text,
        Err(e) => {
            report.outcome = "failed".into();
            report.output = e;
            report.status = sync_status(root);
            return report;
        }
    };

    let after = sync_status(root);
    report.output = text;
    report.conflicts = after.conflicts.clone();
    report.outcome = if after.state == "rebasing" { "failed" } else { "aborted" }.into();
    report.status = after;
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shape_of_remote_becomes_the_same_page() {
        let want = "https://github.com/DanSketic/Ultimate-Project-Assister";
        for raw in [
            "git@github.com:DanSketic/Ultimate-Project-Assister.git",
            "https://github.com/DanSketic/Ultimate-Project-Assister.git",
            "https://github.com/DanSketic/Ultimate-Project-Assister",
            "https://token@github.com/DanSketic/Ultimate-Project-Assister.git",
            "ssh://git@github.com/DanSketic/Ultimate-Project-Assister.git",
            "https://github.com/DanSketic/Ultimate-Project-Assister/",
        ] {
            assert_eq!(web_url(raw), want, "from {raw}");
        }
    }

    #[test]
    fn a_remote_with_no_page_yields_nothing() {
        for raw in ["", "D:\\mirrors\\repo.git", "file:///srv/git/repo.git", "git@github.com:"] {
            assert_eq!(web_url(raw), "", "from {raw:?}");
        }
    }

    #[test]
    fn github_tags_point_at_the_release_and_others_at_the_tree() {
        let gh = "https://github.com/owner/repo";
        assert_eq!(tag_url(gh, "v1.1.0"), "https://github.com/owner/repo/releases/tag/v1.1.0");

        let gl = "https://gitlab.com/owner/repo";
        assert_eq!(tag_url(gl, "v1.1.0"), "https://gitlab.com/owner/repo/tree/v1.1.0");
    }

    #[test]
    fn the_two_counts_name_the_situation() {
        assert_eq!(classify(0, 0), "ok");
        assert_eq!(classify(0, 3), "behind");
        assert_eq!(classify(2, 0), "ahead");
        // The one case a plain pull cannot answer on its own.
        assert_eq!(classify(2, 3), "diverged");
    }

    #[test]
    fn nothing_is_linked_without_a_remote_or_a_tag() {
        assert_eq!(tag_url("", "v1.0.0"), "");
        assert_eq!(tag_url("https://github.com/o/r", ""), "");
        // The placeholder the UI shows when a repo carries no tags.
        assert_eq!(tag_url("https://github.com/o/r", "—"), "");
    }

    // -----------------------------------------------------------------------
    // Against a real pair of repositories
    //
    // The counts this feature is built on come out of libgit2, the operations
    // out of the git command line, and the interesting cases only exist when
    // two checkouts of one repository have both moved. None of that can be
    // checked without actually building that situation, so these tests do.
    // -----------------------------------------------------------------------

    use std::path::PathBuf;

    /// A scratch directory of our own, removed when the test finishes.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join("upa-git-tests")
                .join(format!("{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch dir");
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            // Windows keeps pack files open for a moment after git exits, so a
            // failure to clean up is not worth failing a passing test over.
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Runs git, and fails the test with its own words when it will not.
    fn git(dir: &Path, args: &[&str]) -> String {
        let (ok, text) = git_cli(dir, args).expect("git should be installed to run these tests");
        assert!(ok, "git {args:?} failed in {}: {text}", dir.display());
        text
    }

    /// Commits a file, with an identity so the author can be asserted on.
    fn commit(dir: &Path, file: &str, body: &str, who: &str) {
        std::fs::write(dir.join(file), body).expect("write");
        git(dir, &["add", "."]);
        git(
            dir,
            &[
                "-c",
                &format!("user.name={who}"),
                "-c",
                &format!("user.email={}@example.invalid", who.to_lowercase()),
                "commit",
                "-m",
                &format!("{who}: {file}"),
            ],
        );
    }

    /// A bare origin with one commit, and a clone of it sitting on `main`.
    fn origin_and_clone(name: &str) -> (Scratch, PathBuf, PathBuf) {
        let scratch = Scratch::new(name);
        let root = scratch.0.clone();
        let origin = root.join("origin.git");
        let first = root.join("first");
        let work = root.join("work");

        git(&root, &["init", "--bare", "--initial-branch=main", "origin.git"]);
        git(&root, &["clone", origin.to_str().unwrap(), "first"]);
        commit(&first, "readme.md", "one\n", "Anna");
        git(&first, &["push", "origin", "main"]);
        git(&root, &["clone", origin.to_str().unwrap(), "work"]);

        (scratch, first, work)
    }

    #[test]
    fn a_fresh_clone_is_level_with_its_remote() {
        let (_scratch, _first, work) = origin_and_clone("level");

        let status = sync_status(&work);
        assert_eq!(status.state, "ok");
        assert_eq!(status.branch, "main");
        assert_eq!(status.upstream, "origin/main");
        assert_eq!((status.ahead, status.behind), (0, 0));
    }

    #[test]
    fn somebody_elses_push_shows_up_as_behind_once_fetched() {
        let (_scratch, first, work) = origin_and_clone("behind");

        commit(&first, "feature.md", "theirs\n", "Bence");
        git(&first, &["push", "origin", "main"]);

        // Until the fetch, the clone has no way of knowing: this is the whole
        // reason the feature has a fetch in it at all.
        assert_eq!(sync_status(&work).behind, 0);

        fetch(&work).expect("fetch");
        let status = sync_status(&work);
        assert_eq!(status.state, "behind");
        assert_eq!(status.behind, 1);
        assert_eq!(status.incoming.len(), 1);
        assert_eq!(status.authors, vec!["Bence".to_string()]);
        // Nothing of ours to replay, so this is the fast-forward case.
        assert!(status.outgoing.is_empty());
    }

    #[test]
    fn a_fast_forward_leaves_the_branch_level() {
        let (_scratch, first, work) = origin_and_clone("ff");

        commit(&first, "feature.md", "theirs\n", "Bence");
        git(&first, &["push", "origin", "main"]);
        fetch(&work).expect("fetch");

        let report = rebase(&work);
        assert_eq!(report.outcome, "fast-forward", "{}", report.output);
        assert_eq!(report.status.state, "ok");
        assert!(work.join("feature.md").exists());
    }

    #[test]
    fn work_on_both_sides_diverges_and_rebase_replays_ours() {
        let (_scratch, first, work) = origin_and_clone("diverged");

        commit(&first, "theirs.md", "theirs\n", "Bence");
        git(&first, &["push", "origin", "main"]);
        commit(&work, "ours.md", "ours\n", "Anna");
        fetch(&work).expect("fetch");

        let status = sync_status(&work);
        assert_eq!(status.state, "diverged");
        assert_eq!((status.ahead, status.behind), (1, 1));
        assert_eq!(status.outgoing.len(), 1);

        let report = rebase(&work);
        assert_eq!(report.outcome, "rebased", "{}", report.output);
        // Both sides of the work survive, and the branch is level again.
        assert!(work.join("ours.md").exists());
        assert!(work.join("theirs.md").exists());
        assert_eq!(report.status.behind, 0);
        assert_eq!(report.status.ahead, 1);
    }

    #[test]
    fn an_uncommitted_file_is_stashed_and_put_back() {
        let (_scratch, first, work) = origin_and_clone("autostash");

        commit(&first, "theirs.md", "theirs\n", "Bence");
        git(&first, &["push", "origin", "main"]);
        std::fs::write(work.join("scratch.txt"), "not committed\n").expect("write");
        git(&work, &["add", "scratch.txt"]);
        fetch(&work).expect("fetch");

        assert_eq!(sync_status(&work).dirty, 1);
        let report = rebase(&work);
        assert_eq!(report.outcome, "fast-forward", "{}", report.output);
        // The point of --autostash: the unfinished work is still there. Trimmed,
        // because a round trip through the index is where git's line endings
        // become the platform's.
        assert_eq!(
            std::fs::read_to_string(work.join("scratch.txt")).unwrap().trim(),
            "not committed"
        );
    }

    #[test]
    fn a_conflicting_rebase_stops_and_can_be_undone() {
        let (_scratch, first, work) = origin_and_clone("conflict");

        // The same file, changed differently on both sides.
        commit(&first, "readme.md", "theirs\n", "Bence");
        git(&first, &["push", "origin", "main"]);
        commit(&work, "readme.md", "ours\n", "Anna");
        fetch(&work).expect("fetch");

        let report = rebase(&work);
        assert_eq!(report.outcome, "conflict", "{}", report.output);
        assert_eq!(report.conflicts, vec!["readme.md".to_string()]);
        assert_eq!(report.status.state, "rebasing");

        let undone = rebase_abort(&work);
        assert_eq!(undone.outcome, "aborted", "{}", undone.output);
        assert_eq!(undone.status.state, "diverged");
        // Exactly where it was: our version of the file, and our commit.
        // Trimmed because a checkout is where git's line endings become the
        // platform's.
        assert_eq!(std::fs::read_to_string(work.join("readme.md")).unwrap().trim(), "ours");
    }

    #[test]
    fn a_branch_that_tracks_nothing_says_so_rather_than_guessing() {
        let (_scratch, _first, work) = origin_and_clone("no-upstream");

        git(&work, &["checkout", "-b", "local-only"]);
        let status = sync_status(&work);
        assert_eq!(status.state, "no-upstream");
        assert_eq!(status.branch, "local-only");
        assert_eq!(status.upstream, "");
    }

    #[test]
    fn a_directory_that_is_not_a_repository_is_not_an_error() {
        let scratch = Scratch::new("plain");
        let status = sync_status(&scratch.0);
        assert_eq!(status.state, "not-a-repo");
        assert_eq!(status.fetch_days, None);
    }
}
