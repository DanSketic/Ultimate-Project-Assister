//! The GitHub transport, spoken through the `gh` CLI.
//!
//! Using `gh` rather than an HTTP client of our own is a deliberate trade: the
//! token stays where the user already put it, this app never holds a secret,
//! and there is no OAuth dance to build. What it costs is a dependency on a
//! program being installed - which is an ordinary state the UI reports, the
//! same way it reports Docker being absent.

use std::process::Command;

use super::{Rate, Response};

/// Nothing here ever runs a command the caller composed: the path is built
/// from a project's own remote, and `gh` is invoked with an argument list, so
/// no shell parses any of it.
#[derive(Debug, Clone, Default)]
pub struct GhCli;

#[cfg(windows)]
fn command() -> Command {
    use std::os::windows::process::CommandExt;
    // `gh` on Windows is a .exe, but going through cmd covers a shim on PATH.
    let mut cmd = Command::new("gh");
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

#[cfg(not(windows))]
fn command() -> Command {
    Command::new("gh")
}

impl GhCli {
    /// Whether the CLI is on PATH at all.
    pub fn present() -> bool {
        command()
            .arg("--version")
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }

    /// A GET against the REST API, with the caller's ETag when it has one.
    ///
    /// `-i` keeps the status line and the headers, which is where the rate
    /// limit and the new ETag live. A 304 and a 404 are answers rather than
    /// failures, so the exit code is not consulted - the status line is.
    pub fn get(&self, host: &str, path: &str, etag: &str) -> Result<Response, String> {
        let mut cmd = command();
        cmd.arg("api").arg("-i");
        if !host.is_empty() && host != "github.com" {
            cmd.arg("--hostname").arg(host);
        }
        if !etag.is_empty() {
            cmd.arg("-H").arg(format!("If-None-Match: {etag}"));
        }
        cmd.arg(path);

        let out = cmd.output().map_err(|e| format!("gh: {e}"))?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        if text.is_empty() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() { "gh returned nothing".into() } else { err });
        }
        Ok(parse(&text))
    }

    /// A POST, for the few things this app is allowed to ask GitHub to do.
    pub fn post(&self, host: &str, path: &str, fields: &[(&str, &str)]) -> Result<Response, String> {
        let mut cmd = command();
        cmd.arg("api").arg("-i").arg("--method").arg("POST");
        if !host.is_empty() && host != "github.com" {
            cmd.arg("--hostname").arg(host);
        }
        for (key, value) in fields {
            cmd.arg("-f").arg(format!("{key}={value}"));
        }
        cmd.arg(path);

        let out = cmd.output().map_err(|e| format!("gh: {e}"))?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        if text.is_empty() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() { "gh returned nothing".into() } else { err });
        }
        Ok(parse(&text))
    }

    /// The log of the jobs that failed in one run.
    ///
    /// `gh run view --log-failed` rather than the REST API: logs come back as
    /// a zip archive that has to be unpacked and stitched, and gh already does
    /// exactly that. Only the failed jobs, because a green job's output is
    /// several thousand lines of things that went right.
    pub fn failed_log(&self, host: &str, slug: &str, run_id: u64) -> Result<String, String> {
        let mut cmd = command();
        cmd.arg("run")
            .arg("view")
            .arg(run_id.to_string())
            .arg("--repo")
            .arg(slug)
            .arg("--log-failed");
        if !host.is_empty() && host != "github.com" {
            cmd.env("GH_HOST", host);
        }

        let out = cmd.output().map_err(|e| format!("gh: {e}"))?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        if !text.trim().is_empty() {
            return Ok(text);
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { "that run has no failed job log".into() } else { err })
    }
}

/// Splits `gh api -i` output into a status, the headers worth keeping, and the
/// body. Header names are compared lowercase: HTTP does not promise a case.
fn parse(text: &str) -> Response {
    let mut status = 0;
    let mut etag = String::new();
    let mut rate = Rate::default();
    let mut body = String::new();
    let mut scopes: Vec<String> = Vec::new();
    let mut sso = String::new();

    let mut lines = text.lines();
    if let Some(first) = lines.next() {
        status = first
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
    }

    for line in lines.by_ref() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            break; // headers end, body begins
        }
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match name.to_ascii_lowercase().as_str() {
            "etag" => etag = value.to_string(),
            "x-ratelimit-remaining" => rate.remaining = value.parse().unwrap_or(0),
            "x-ratelimit-limit" => rate.limit = value.parse().unwrap_or(0),
            "x-ratelimit-reset" => rate.reset = value.parse().unwrap_or(0),
            // What the token is allowed to do, as GitHub sees it. Worth
            // keeping on every answer: it is how a refusal can be explained as
            // a missing permission rather than a missing repository.
            "x-oauth-scopes" => {
                scopes = value
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect()
            }
            // An organisation with single sign-on says here where the token
            // has to be authorised before it may see anything of theirs.
            "x-github-sso" => {
                sso = value
                    .split_once("url=")
                    .map(|(_, url)| url.trim().to_string())
                    .unwrap_or_else(|| value.to_string())
            }
            _ => {}
        }
    }

    for line in lines {
        body.push_str(line);
        body.push('\n');
    }

    Response { status, etag, rate, scopes, sso, body: body.trim().to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK: &str = "HTTP/2.0 200 OK\r\nEtag: W/\"abc\"\r\nX-RateLimit-Remaining: 4987\r\nX-RateLimit-Limit: 5000\r\nX-RateLimit-Reset: 1787586190\r\n\r\n{\"total_count\":1}";

    #[test]
    fn the_status_headers_and_body_come_apart() {
        let response = parse(OK);
        assert_eq!(response.status, 200);
        assert_eq!(response.etag, "W/\"abc\"");
        assert_eq!(response.rate.remaining, 4987);
        assert_eq!(response.rate.reset, 1787586190);
        assert_eq!(response.body, "{\"total_count\":1}");
    }

    #[test]
    fn the_token_scopes_and_an_sso_challenge_are_kept() {
        let response = parse(concat!(
            "HTTP/2.0 403 Forbidden\r\n",
            "X-OAuth-Scopes: gist, read:org, repo\r\n",
            "X-GitHub-SSO: required; url=https://github.com/orgs/acme/sso?return_to=%2Fx\r\n",
            "\r\n",
            "{\"message\":\"Resource protected by organization SAML enforcement\"}"
        ));
        assert_eq!(response.scopes, vec!["gist", "read:org", "repo"]);
        assert!(response.sso.starts_with("https://github.com/orgs/acme/sso"));
    }

    #[test]
    fn a_not_modified_answer_has_no_body_and_is_not_a_failure() {
        let response = parse("HTTP/2.0 304 Not Modified\r\nEtag: W/\"abc\"\r\n\r\n");
        assert_eq!(response.status, 304);
        assert!(response.body.is_empty());
    }

    #[test]
    fn a_body_holding_a_blank_line_survives() {
        let response = parse("HTTP/2.0 200 OK\r\n\r\n{\n\n  \"a\": 1\n}");
        assert!(response.body.contains("\"a\": 1"), "body was {:?}", response.body);
    }
}
