//! What GitHub knows about the projects on this disk.
//!
//! The app already reads every repository locally; this is the half that only
//! the server can answer - whether the build passed, what is deployed where,
//! what is waiting for review. It is all read-only unless a command says
//! otherwise, and every request is built here from a project's own remote: the
//! frontend names a project, never a URL.
//!
//! Requests are conditional. GitHub allows five thousand an hour, and a
//! dashboard that asks about thirty projects would burn through that in an
//! afternoon - but an `If-None-Match` that comes back `304` costs nothing
//! against the limit, so the cache is what makes refreshing cheap.

mod gh;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::model::{
    Deployment, GitHubRelease, GitHubStatus, Project, PullRequest, RepoCi, WorkflowRun,
};

pub use gh::GhCli;

/// How long an answer is treated as fresh enough not to ask again. A run that
/// is in flight moves in seconds; everything else can wait a minute.
const RUNS_TTL: u64 = 45;
/// Runs kept per repository. Enough to see the last few pushes, not a history.
const RUNS_PER_REPO: usize = 8;
/// Environments and deployments move at the pace of releases, not of pushes.
const DEPLOY_TTL: u64 = 300;
/// Lines of a failed job's log kept for reading. What went wrong is at the
/// end; the beginning is the checkout and the cache restore.
const LOG_LINES: usize = 400;
/// A hard ceiling as well, since one line can be a minified stack trace.
const LOG_CHARS: usize = 60_000;

/// Search has an allowance of its own - thirty a minute - so it is asked
/// rarely and its answer held for longer.
const SEARCH_TTL: u64 = 120;

/// What is left of the hourly allowance.
#[derive(Debug, Clone, Copy, Default)]
pub struct Rate {
    pub limit: u32,
    pub remaining: u32,
    /// Unix seconds at which the allowance is refilled.
    pub reset: u64,
}

#[derive(Debug, Clone, Default)]
pub struct Response {
    pub status: u16,
    pub etag: String,
    pub rate: Rate,
    pub body: String,
}

/// The two things this app will ask GitHub to do to a run. Deliberately a
/// closed set: everything else about a run is somebody else's decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunAction {
    /// Run the jobs that failed again. Not the whole run: the green ones cost
    /// minutes to repeat and prove nothing.
    Rerun,
    Cancel,
}

/// A repository, as named by a remote. Only the three parts that address the
/// API - anything else about it comes from the API itself.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Repo {
    pub host: String,
    pub owner: String,
    pub name: String,
}

impl Repo {
    /// Reads a repository out of the browsable remote `git::web_url` produces.
    /// Anything that is not a `host/owner/repo` triple - a gist, a URL with a
    /// deeper path, a non-GitHub host - is not one.
    pub fn parse(remote: &str) -> Option<Repo> {
        let rest = remote
            .strip_prefix("https://")
            .or_else(|| remote.strip_prefix("http://"))?;
        let mut parts = rest.trim_end_matches('/').split('/');
        let host = parts.next()?.to_string();
        let owner = parts.next()?.to_string();
        let name = parts.next()?.trim_end_matches(".git").to_string();
        if parts.next().is_some() || owner.is_empty() || name.is_empty() {
            return None;
        }
        // GitHub Enterprise hosts are not github.com but speak the same API;
        // anything clearly another service is left alone.
        let known = host == "github.com" || host.contains("github");
        known.then(|| Repo { host, owner, name })
    }

    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

#[derive(Debug, Clone)]
struct Cached {
    etag: String,
    body: String,
    /// Unix seconds of the last time this answer was confirmed current.
    at: u64,
}

/// One error from the API, kept with its status so a caller can tell "this
/// repository has no Actions" from "the token cannot see this repository".
#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
}

impl ApiError {
    fn from(response: &Response) -> Self {
        let message = serde_json::from_str::<Value>(&response.body)
            .ok()
            .and_then(|v| v.get("message").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| format!("HTTP {}", response.status));
        Self { status: response.status, message }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The client the rest of the app talks to. Cloning shares the cache, so it
/// can be handed to a blocking thread and still be the same client next time.
#[derive(Debug, Clone, Default)]
pub struct Client {
    transport: GhCli,
    cache: Arc<Mutex<HashMap<String, Cached>>>,
    rate: Arc<Mutex<Rate>>,
}

impl Client {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether the tooling is there and who it is speaking as. Costs one call
    /// the first time and is answered from the cache afterwards; `/rate_limit`
    /// is itself free of the limit it reports.
    pub fn status(&self) -> GitHubStatus {
        if !GhCli::present() {
            return GitHubStatus {
                available: false,
                error: "the GitHub CLI (gh) is not installed".into(),
                ..Default::default()
            };
        }

        let mut status = GitHubStatus { available: true, ..Default::default() };

        match self.get("github.com", "rate_limit", 60) {
            Ok(value) => {
                let core = value.get("resources").and_then(|r| r.get("core"));
                let number = |name: &str| {
                    core.and_then(|c| c.get(name)).and_then(Value::as_u64).unwrap_or(0)
                };
                status.authenticated = true;
                status.rate_limit = number("limit") as u32;
                status.rate_remaining = number("remaining") as u32;
                status.rate_reset = number("reset");
            }
            Err(e) => {
                status.error = if e.status == 401 {
                    "gh is installed but not logged in - run: gh auth login".into()
                } else {
                    e.message
                };
                return status;
            }
        }

        if let Ok(user) = self.get("github.com", "user", 3600) {
            status.login = user
                .get("login")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
        }
        status
    }

    /// The last few workflow runs of a repository, newest first.
    pub fn runs(&self, repo: &Repo) -> Result<Vec<WorkflowRun>, ApiError> {
        let path = format!(
            "repos/{}/{}/actions/runs?per_page={RUNS_PER_REPO}",
            repo.owner, repo.name
        );
        let value = self.get(&repo.host, &path, RUNS_TTL)?;
        Ok(value
            .get("workflow_runs")
            .and_then(Value::as_array)
            .map(|runs| runs.iter().map(run_from).collect())
            .unwrap_or_default())
    }

    /// The state of one project's Actions, in the shape the views list.
    ///
    /// A repository without Actions, or one the token cannot see, is not a
    /// failure: it comes back with `available: false` and a sentence.
    pub fn ci(&self, project_id: &str, project: &str, remote: &str) -> RepoCi {
        let mut out = RepoCi {
            project_id: project_id.to_string(),
            project: project.to_string(),
            checked_at: now(),
            ..Default::default()
        };

        let Some(repo) = Repo::parse(remote) else {
            out.error = "this project has no GitHub remote".into();
            return out;
        };
        out.repo = repo.slug();
        out.url = format!("https://{}/{}", repo.host, repo.slug());

        match self.runs(&repo) {
            Ok(runs) => {
                out.available = true;
                out.runs = runs;
                // Deployments are a second question, and a repository being
                // without them is not a failure of the first.
                out.deployments = self.deployments(&repo).unwrap_or_default();
            }
            Err(e) if e.status == 404 => {
                out.error = "no Actions on this repository, or it is not visible".into();
            }
            Err(e) => out.error = e.message,
        }
        out
    }

    /// The latest deployment to each environment, newest first.
    ///
    /// Asked in two steps on purpose: most repositories have no environments
    /// at all, and the first call says so for the price of one conditional
    /// request rather than a walk through every deployment ever made.
    pub fn deployments(&self, repo: &Repo) -> Result<Vec<Deployment>, ApiError> {
        let envs = match self.get(
            &repo.host,
            &format!("repos/{}/{}/environments", repo.owner, repo.name),
            DEPLOY_TTL,
        ) {
            Ok(value) => value,
            // A repository with Actions disabled, or one the token may read
            // but not inspect this far, simply has nothing to report here.
            Err(e) if e.status == 404 || e.status == 403 => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        if envs.get("total_count").and_then(Value::as_u64).unwrap_or(0) == 0 {
            return Ok(Vec::new());
        }

        let list = self.get(
            &repo.host,
            &format!("repos/{}/{}/deployments?per_page=30", repo.owner, repo.name),
            DEPLOY_TTL,
        )?;
        let Some(list) = list.as_array() else { return Ok(Vec::new()) };

        // The list is newest first, so the first entry for an environment is
        // the one that is live there.
        let mut seen: Vec<String> = Vec::new();
        let mut out: Vec<Deployment> = Vec::new();
        for value in list {
            let environment = value
                .get("environment")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if environment.is_empty() || seen.contains(&environment) {
                continue;
            }
            seen.push(environment.clone());

            let mut deployment = deployment_from(value, &environment);
            deployment.state = self.deployment_state(repo, deployment.id);
            out.push(deployment);
        }
        Ok(out)
    }

    /// The newest status of one deployment; empty when it has none yet.
    fn deployment_state(&self, repo: &Repo, id: u64) -> String {
        self.get(
            &repo.host,
            &format!("repos/{}/{}/deployments/{id}/statuses?per_page=1", repo.owner, repo.name),
            DEPLOY_TTL,
        )
        .ok()
        .and_then(|value| {
            value
                .as_array()
                .and_then(|list| list.first().cloned())
                .and_then(|first| first.get("state").and_then(Value::as_str).map(str::to_string))
        })
        .unwrap_or_default()
    }

    /// Open pull requests that are the user's own or are waiting on them.
    ///
    /// Two searches rather than one `involves:@me`: the difference between
    /// "mine" and "waiting for me" is the whole point of the list, and it is
    /// not in the results themselves.
    pub fn pulls(&self, projects: &[Project]) -> Result<Vec<PullRequest>, ApiError> {
        let mut out: Vec<PullRequest> = Vec::new();

        for (query, mine) in [
            ("is:open+is:pr+author:@me", true),
            ("is:open+is:pr+review-requested:@me", false),
        ] {
            let path = format!("search/issues?q={query}&per_page=30");
            let value = match self.get("github.com", &path, SEARCH_TTL) {
                Ok(value) => value,
                // A search that fails should not take the other one with it.
                Err(e) if e.status == 422 || e.status == 403 => continue,
                Err(e) => return Err(e),
            };

            for item in value.get("items").and_then(Value::as_array).into_iter().flatten() {
                let mut pull = pull_from(item, mine);
                bind(&mut pull, projects);
                // One pull request can answer both searches.
                match out.iter_mut().find(|p| p.url == pull.url) {
                    Some(existing) => {
                        existing.mine |= pull.mine;
                        existing.review_requested |= pull.review_requested;
                    }
                    None => out.push(pull),
                }
            }
        }

        // What somebody is waiting on you for comes first.
        out.sort_by(|a, b| {
            b.review_requested
                .cmp(&a.review_requested)
                .then_with(|| b.updated_at.cmp(&a.updated_at))
        });
        Ok(out)
    }

    /// Runs a failed run again, or stops one that is going.
    ///
    /// The run has to be one of this project's own - it is looked for among
    /// the runs the repository itself reports - so a caller cannot name a run
    /// id belonging to somebody else's repository and have it acted on.
    pub fn act_on_run(&self, remote: &str, run_id: u64, action: RunAction) -> Result<String, String> {
        let repo = Repo::parse(remote).ok_or("this project has no GitHub remote")?;
        let runs = self.runs(&repo).map_err(|e| e.message)?;
        let run = runs
            .into_iter()
            .find(|run| run.id == run_id)
            .ok_or("that run is not one of this project's")?;

        let (verb, path) = match action {
            RunAction::Rerun => (
                "rerun-failed-jobs",
                format!("repos/{}/{}/actions/runs/{run_id}/rerun-failed-jobs", repo.owner, repo.name),
            ),
            RunAction::Cancel => (
                "cancel",
                format!("repos/{}/{}/actions/runs/{run_id}/cancel", repo.owner, repo.name),
            ),
        };

        let response = self.transport.post(&repo.host, &path, &[])?;
        // The answers to both are empty; the status is the whole reply. 409 is
        // GitHub saying the run is not in a state this can be asked of.
        match response.status {
            200..=299 => {
                // What was cached about this repository's runs is now stale by
                // construction: it says the run is doing what it just stopped
                // doing.
                self.forget(&repo);
                Ok(format!("{} #{} - {verb}", run.name, run.number))
            }
            _ => Err(ApiError::from(&response).message),
        }
    }

    /// Drops what is held about one repository's runs, so the next look is a
    /// fresh one rather than the answer from before something was changed.
    fn forget(&self, repo: &Repo) {
        let prefix = format!("{}/repos/{}/{}/actions/runs", repo.host, repo.owner, repo.name);
        self.cache.lock().unwrap().retain(|key, _| !key.starts_with(&prefix));
    }

    /// Releases as GitHub holds them, newest first.
    pub fn releases(&self, repo: &Repo) -> Result<Vec<GitHubRelease>, ApiError> {
        let path = format!("repos/{}/{}/releases?per_page=30", repo.owner, repo.name);
        let value = match self.get(&repo.host, &path, DEPLOY_TTL) {
            Ok(value) => value,
            Err(e) if e.status == 404 => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        Ok(value
            .as_array()
            .map(|list| list.iter().map(release_from).collect())
            .unwrap_or_default())
    }

    /// Writes a changelog section to GitHub as a **draft** release.
    ///
    /// Draft on purpose: this app can prepare a release, but publishing one is
    /// an announcement, and an announcement is the user's to make. The draft
    /// lands on the releases page for them to read, edit and publish - or
    /// throw away, which costs nothing and tells nobody.
    pub fn draft_release(
        &self,
        remote: &str,
        tag: &str,
        title: &str,
        body: &str,
    ) -> Result<String, String> {
        let repo = Repo::parse(remote).ok_or("this project has no GitHub remote")?;
        if tag.trim().is_empty() {
            return Err("a release needs a tag".into());
        }
        // One draft per tag: a second press should not leave two.
        if let Ok(existing) = self.releases(&repo) {
            if let Some(release) = existing.iter().find(|r| r.tag == tag) {
                return Err(format!("{tag} already has a release: {}", release.url));
            }
        }

        let path = format!("repos/{}/{}/releases", repo.owner, repo.name);
        let response = self.transport.post(
            &repo.host,
            &path,
            &[("tag_name", tag), ("name", title), ("body", body), ("draft", "true")],
        )?;

        if !(200..=299).contains(&response.status) {
            return Err(ApiError::from(&response).message);
        }
        self.cache
            .lock()
            .unwrap()
            .retain(|key, _| !key.contains(&format!("repos/{}/{}/releases", repo.owner, repo.name)));

        serde_json::from_str::<Value>(&response.body)
            .ok()
            .and_then(|v| v.get("html_url").and_then(Value::as_str).map(str::to_string))
            .ok_or_else(|| "GitHub accepted it but said nothing back".to_string())
    }

    /// The tail of one run's failed-job log, for reading rather than archiving.
    ///
    /// The run is checked against the project's own repository first, and only
    /// the last few hundred lines are kept: what went wrong is at the end, and
    /// a whole CI log is megabytes of what went right.
    pub fn failed_log(&self, remote: &str, run_id: u64) -> Result<String, String> {
        let repo = Repo::parse(remote).ok_or("this project has no GitHub remote")?;
        let runs = self.runs(&repo).map_err(|e| e.message)?;
        if !runs.iter().any(|run| run.id == run_id) {
            return Err("that run is not one of this project's".into());
        }

        let whole = self.transport.failed_log(&repo.host, &repo.slug(), run_id)?;
        let lines: Vec<&str> = whole.lines().collect();
        let tail = lines[lines.len().saturating_sub(LOG_LINES)..].join("\n");
        Ok(tail.chars().take(LOG_CHARS).collect())
    }

    /// The page of one run of a project's own repository. Resolved from the
    /// runs already held, so a caller cannot name an address.
    pub fn run_url(&self, remote: &str, run_id: u64) -> Result<String, String> {
        let repo = Repo::parse(remote).ok_or("this project has no GitHub remote")?;
        let runs = self.runs(&repo).map_err(|e| e.message)?;
        runs.into_iter()
            .find(|run| run.id == run_id)
            .map(|run| run.url)
            .filter(|url| url.starts_with("https://"))
            .ok_or_else(|| "that run is not one of this project's".to_string())
    }

    /// The allowance as last reported by any call.
    pub fn rate(&self) -> Rate {
        *self.rate.lock().unwrap()
    }

    /// A GET whose answer may come from the cache, from a `304`, or from the
    /// network - in that order of preference.
    fn get(&self, host: &str, path: &str, ttl: u64) -> Result<Value, ApiError> {
        let key = format!("{host}/{path}");
        let cached = self.cache.lock().unwrap().get(&key).cloned();

        if let Some(entry) = &cached {
            if now().saturating_sub(entry.at) < ttl {
                return parse_body(&entry.body);
            }
        }

        let etag = cached.as_ref().map(|c| c.etag.as_str()).unwrap_or("");
        let response = self
            .transport
            .get(host, path, etag)
            .map_err(|message| ApiError { status: 0, message })?;

        if response.rate.limit > 0 {
            *self.rate.lock().unwrap() = response.rate;
        }

        match response.status {
            304 => {
                // Unchanged: the body we already hold is current, and this
                // exchange did not count against the hourly allowance.
                let mut cache = self.cache.lock().unwrap();
                if let Some(entry) = cache.get_mut(&key) {
                    entry.at = now();
                    return parse_body(&entry.body);
                }
                Err(ApiError { status: 304, message: "nothing cached to refresh".into() })
            }
            200..=299 => {
                let value = parse_body(&response.body)?;
                self.cache.lock().unwrap().insert(
                    key,
                    Cached { etag: response.etag, body: response.body, at: now() },
                );
                Ok(value)
            }
            _ => Err(ApiError::from(&response)),
        }
    }
}

fn parse_body(body: &str) -> Result<Value, ApiError> {
    serde_json::from_str(body).map_err(|e| ApiError { status: 0, message: e.to_string() })
}

/// One run, kept to the fields a list can show. `elapsed_secs` is worked out
/// here rather than in the UI: two timestamps are the API's way of saying it,
/// but a duration is what gets read.
fn run_from(value: &Value) -> WorkflowRun {
    let text = |name: &str| {
        value.get(name).and_then(Value::as_str).unwrap_or_default().to_string()
    };
    let started = text("run_started_at");
    let started = if started.is_empty() { text("created_at") } else { started };
    let updated = text("updated_at");

    WorkflowRun {
        id: value.get("id").and_then(Value::as_u64).unwrap_or(0),
        name: text("name"),
        title: text("display_title"),
        branch: text("head_branch"),
        event: text("event"),
        status: text("status"),
        conclusion: text("conclusion"),
        number: value.get("run_number").and_then(Value::as_u64).unwrap_or(0),
        attempt: value.get("run_attempt").and_then(Value::as_u64).unwrap_or(1),
        actor: value
            .get("actor")
            .and_then(|a| a.get("login"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        sha: text("head_sha").chars().take(7).collect(),
        url: text("html_url"),
        started_at: started.clone(),
        updated_at: updated.clone(),
        elapsed_secs: elapsed(&started, &updated),
    }
}

/// Seconds between two ISO timestamps; zero when either is missing or the
/// order is not what it should be.
fn elapsed(from: &str, to: &str) -> u64 {
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok().map(|t| t.timestamp());
    match (parse(from), parse(to)) {
        (Some(a), Some(b)) if b >= a => (b - a) as u64,
        _ => 0,
    }
}

/// One deployment, kept to what a row shows. The state is not in this payload
/// - it lives on the deployment's own statuses - so it is filled in after.
fn deployment_from(value: &Value, environment: &str) -> Deployment {
    let text = |name: &str| value.get(name).and_then(Value::as_str).unwrap_or_default().to_string();
    Deployment {
        id: value.get("id").and_then(Value::as_u64).unwrap_or(0),
        environment: environment.to_string(),
        ref_name: text("ref"),
        sha: text("sha").chars().take(7).collect(),
        state: String::new(),
        description: text("description"),
        created_at: text("created_at"),
        url: text("url"),
        creator: value
            .get("creator")
            .and_then(|c| c.get("login"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    }
}

/// One release, kept to what a chip and a link need.
fn release_from(value: &Value) -> GitHubRelease {
    let text = |name: &str| value.get(name).and_then(Value::as_str).unwrap_or_default().to_string();
    GitHubRelease {
        tag: text("tag_name"),
        name: text("name"),
        draft: value.get("draft").and_then(Value::as_bool).unwrap_or(false),
        prerelease: value.get("prerelease").and_then(Value::as_bool).unwrap_or(false),
        published_at: text("published_at"),
        url: text("html_url"),
    }
}

/// One pull request out of a search result.
fn pull_from(value: &Value, mine: bool) -> PullRequest {
    let text = |name: &str| value.get(name).and_then(Value::as_str).unwrap_or_default().to_string();
    // A search result names the repository as an API URL; its last two
    // segments are the slug everything else here is keyed by.
    let url = text("repository_url");
    let mut tail = url.rsplit('/');
    let name = tail.next().unwrap_or_default();
    let owner = tail.next().unwrap_or_default();

    PullRequest {
        number: value.get("number").and_then(Value::as_u64).unwrap_or(0),
        title: text("title"),
        repo: format!("{owner}/{name}"),
        project_id: String::new(),
        project: String::new(),
        author: value
            .get("user")
            .and_then(|u| u.get("login"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        draft: value.get("draft").and_then(Value::as_bool).unwrap_or(false),
        mine,
        review_requested: !mine,
        comments: value.get("comments").and_then(Value::as_u64).unwrap_or(0),
        updated_at: text("updated_at"),
        url: text("html_url"),
    }
}

/// Ties a pull request to a project on this disk, when one of them is that
/// repository. A pull request in a repository nobody has checked out here is
/// still worth listing - it simply has no project name to show.
fn bind(pull: &mut PullRequest, projects: &[Project]) {
    let wanted = pull.repo.to_lowercase();
    for project in projects {
        if let Some(repo) = Repo::parse(&project.git.remote) {
            if repo.slug().to_lowercase() == wanted {
                pull.project_id = project.id.clone();
                pull.project = project.name.clone();
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_remote_names_a_repository() {
        let repo = Repo::parse("https://github.com/DanSketic/TurtleFarm").unwrap();
        assert_eq!(repo.host, "github.com");
        assert_eq!(repo.slug(), "DanSketic/TurtleFarm");
    }

    #[test]
    fn what_is_not_a_github_repository_is_not_pretended_to_be_one() {
        assert!(Repo::parse("https://gitlab.com/owner/repo").is_none());
        assert!(Repo::parse("https://github.com/owner").is_none());
        assert!(Repo::parse("https://github.com/owner/repo/tree/main").is_none());
        assert!(Repo::parse("").is_none());
    }

    #[test]
    fn an_enterprise_host_still_speaks_the_api() {
        let repo = Repo::parse("https://github.acme.com/team/service").unwrap();
        assert_eq!(repo.host, "github.acme.com");
    }

    #[test]
    fn a_run_keeps_what_a_list_shows() {
        let value: Value = serde_json::from_str(
            r#"{"id":42,"name":"CI","display_title":"fix: a thing","head_branch":"main",
                "event":"push","status":"completed","conclusion":"success","run_number":7,
                "run_attempt":1,"actor":{"login":"dan"},"head_sha":"472c272ef33de565",
                "html_url":"https://github.com/o/r/actions/runs/42",
                "run_started_at":"2026-08-17T20:03:56Z","updated_at":"2026-08-17T20:04:12Z"}"#,
        )
        .unwrap();

        let run = run_from(&value);
        assert_eq!(run.id, 42);
        assert_eq!(run.sha, "472c272");
        assert_eq!(run.elapsed_secs, 16);
        assert_eq!(run.actor, "dan");
    }

    #[test]
    fn a_pull_request_knows_its_repository_and_who_it_waits_on() {
        let value: Value = serde_json::from_str(
            r#"{"number":16,"title":"feat: a thing","draft":false,"comments":2,
                "updated_at":"2026-08-24T14:58:09Z",
                "html_url":"https://github.com/Osszekoto/site-laravel-v2/pull/16",
                "repository_url":"https://api.github.com/repos/Osszekoto/site-laravel-v2",
                "user":{"login":"dan"}}"#,
        )
        .unwrap();

        let pull = pull_from(&value, false);
        assert_eq!(pull.repo, "Osszekoto/site-laravel-v2");
        assert_eq!(pull.number, 16);
        assert!(pull.review_requested);
        assert!(!pull.mine);
    }

    #[test]
    fn a_pull_request_finds_the_project_it_belongs_to() {
        let mut project = Project { id: "p1".into(), name: "site".into(), ..Default::default() };
        project.git.remote = "https://github.com/Osszekoto/site-laravel-v2".into();

        let mut pull =
            PullRequest { repo: "osszekoto/SITE-laravel-v2".into(), ..Default::default() };
        bind(&mut pull, &[project]);
        assert_eq!(pull.project, "site");
    }

    #[test]
    fn a_release_keeps_its_tag_and_page() {
        let value: Value = serde_json::from_str(
            r#"{"tag_name":"v1.6.0","name":"v1.6.0 - a thing","draft":false,"prerelease":false,
                "published_at":"2026-08-19T14:09:47Z",
                "html_url":"https://github.com/o/r/releases/tag/v1.6.0"}"#,
        )
        .unwrap();

        let release = release_from(&value);
        assert_eq!(release.tag, "v1.6.0");
        assert!(!release.draft);
        assert!(release.url.ends_with("v1.6.0"));
    }

    #[test]
    fn a_deployment_keeps_what_a_row_shows() {
        let value: Value = serde_json::from_str(
            r#"{"id":9,"ref":"main","sha":"9f9693aabbccdd","description":"release 1.6.0",
                "created_at":"2026-08-19T14:00:00Z","creator":{"login":"dan"}}"#,
        )
        .unwrap();

        let deployment = deployment_from(&value, "production");
        assert_eq!(deployment.environment, "production");
        assert_eq!(deployment.sha, "9f9693a");
        assert_eq!(deployment.creator, "dan");
        assert!(deployment.state.is_empty(), "the state comes from the statuses");
    }

    #[test]
    fn a_run_still_going_has_no_conclusion_and_no_length() {
        let value: Value = serde_json::from_str(
            r#"{"id":1,"status":"in_progress","run_started_at":"2026-08-17T20:03:56Z"}"#,
        )
        .unwrap();
        let run = run_from(&value);
        assert_eq!(run.status, "in_progress");
        assert!(run.conclusion.is_empty());
        assert_eq!(run.elapsed_secs, 0);
    }
}
