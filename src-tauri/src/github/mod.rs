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

use crate::model::{Deployment, GitHubStatus, RepoCi, WorkflowRun};

pub use gh::GhCli;

/// How long an answer is treated as fresh enough not to ask again. A run that
/// is in flight moves in seconds; everything else can wait a minute.
const RUNS_TTL: u64 = 45;
/// Runs kept per repository. Enough to see the last few pushes, not a history.
const RUNS_PER_REPO: usize = 8;
/// Environments and deployments move at the pace of releases, not of pushes.
const DEPLOY_TTL: u64 = 300;

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
