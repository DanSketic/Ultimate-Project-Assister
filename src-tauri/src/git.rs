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
    fn nothing_is_linked_without_a_remote_or_a_tag() {
        assert_eq!(tag_url("", "v1.0.0"), "");
        assert_eq!(tag_url("https://github.com/o/r", ""), "");
        // The placeholder the UI shows when a repo carries no tags.
        assert_eq!(tag_url("https://github.com/o/r", "—"), "");
    }
}
