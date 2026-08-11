//! Read-only git inspection via libgit2.
//!
//! The cheap parts (branch, dirty count, ahead/behind, last five commits) run
//! on every scan. Tag history and the changelog are only built when the
//! "deep git analysis" setting is on, because they need a full revwalk.

use std::path::Path;

use git2::{BranchType, Repository, Sort, StatusOptions};

use crate::model::{Commit, GitInfo, Release};

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
