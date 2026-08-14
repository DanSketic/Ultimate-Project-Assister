//! Docker: whether it is installed, whether the daemon is up, and what it holds.
//!
//! Every call here treats a missing Docker as ordinary rather than as an error.
//! Most projects do not use it, and the ones that do are frequently worked on
//! with Docker Desktop shut down - "installed but not running" is a normal
//! state that deserves its own answer, not a failure.

use std::process::Command;

use crate::model::{Container, DockerStatus};

/// Docker output is tab-separated by our own `--format` strings, so a field
/// containing spaces (a status line, a port list) still parses.
const SEP: char = '\t';

fn docker(args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("docker");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Same, but keeps stderr - the reason the daemon is unreachable is the useful
/// part of a failed `docker info`.
fn docker_err(args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("docker");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    Err(String::from_utf8_lossy(&out.stderr).to_string())
}

/// Docker's errors run to several lines of advice. The first line that says
/// something is what belongs on a status chip.
fn first_meaningful_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("See "))
        .unwrap_or("Docker did not answer")
        .trim_start_matches("error during connect: ")
        .chars()
        .take(160)
        .collect()
}

/// Parses `4.9GB`, `812.4 MB`, `0B` into bytes.
pub fn parse_human_size(raw: &str) -> u64 {
    let raw = raw.trim();
    let split = raw
        .find(|c: char| !c.is_ascii_digit() && c != '.' && c != ',')
        .unwrap_or(raw.len());
    let (value, unit) = raw.split_at(split);
    let Ok(value) = value.replace(',', ".").parse::<f64>() else { return 0 };

    let mult = match unit.trim().to_ascii_lowercase().as_str() {
        "b" | "" => 1.0,
        "kb" | "kib" => 1024.0,
        "mb" | "mib" => 1024.0 * 1024.0,
        "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 0.0,
    };
    (value * mult) as u64
}

/// What Docker could reclaim, filled in only when the daemon answers.
fn add_usage(status: &mut DockerStatus) {
    let Some(text) = docker(&["system", "df", "--format", "{{.Type}}\t{{.Reclaimable}}"]) else {
        return;
    };
    for line in text.lines() {
        let Some((kind, reclaimable)) = line.split_once(SEP) else { continue };
        // Docker appends a percentage: "4.9GB (100%)".
        let size = reclaimable.split('(').next().unwrap_or("").trim();
        let bytes = parse_human_size(size);
        match kind.trim() {
            "Images" => status.images_bytes = bytes,
            "Build Cache" => status.build_cache_bytes = bytes,
            "Local Volumes" => status.volumes_bytes = bytes,
            _ => {}
        }
    }
}

pub fn status() -> DockerStatus {
    let mut status = DockerStatus::default();

    // `docker --version` is answered by the CLI alone, so it separates "not
    // installed" from "installed, daemon down" before anything slow is tried.
    let Some(version) = docker(&["--version"]) else {
        status.error = "Docker is not installed".into();
        return status;
    };
    status.installed = true;
    status.cli_version = crate::tools::first_version(&version);

    let info = docker_err(&[
        "info",
        "--format",
        "{{.ServerVersion}}\t{{.ContainersRunning}}\t{{.Containers}}\t{{.Images}}",
    ]);

    match info {
        Ok(text) => {
            let fields: Vec<&str> = text.trim().split(SEP).collect();
            status.daemon_running = true;
            status.server_version = fields.first().unwrap_or(&"").trim().to_string();
            status.containers_running = fields.get(1).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
            status.containers_total = fields.get(2).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
            status.images = fields.get(3).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
            add_usage(&mut status);
        }
        Err(e) => status.error = first_meaningful_line(&e),
    }

    status
}

/// Compose derives a project name from the directory it was started in:
/// lowercased, with anything outside `[a-z0-9_-]` dropped, and leading
/// separators trimmed. Matching that is what lets a project's own containers be
/// picked out of everything running on the machine.
pub fn compose_project_name(dir_name: &str) -> String {
    dir_name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .trim_start_matches(['_', '-'])
        .to_string()
}

/// Containers belonging to one project's compose stack, running or not.
pub fn containers_for(project_dir_name: &str) -> Vec<Container> {
    let name = compose_project_name(project_dir_name);
    if name.is_empty() {
        return Vec::new();
    }
    let filter = format!("label=com.docker.compose.project={name}");
    let format = "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}\t{{.Label \"com.docker.compose.service\"}}";

    let Some(text) = docker(&["ps", "-a", "--filter", &filter, "--format", format]) else {
        return Vec::new();
    };
    text.lines().filter_map(parse_container).collect()
}

fn parse_container(line: &str) -> Option<Container> {
    let f: Vec<&str> = line.split(SEP).collect();
    if f.len() < 5 || f[0].trim().is_empty() {
        return None;
    }
    Some(Container {
        id: f[0].trim().chars().take(12).collect(),
        name: f[1].trim().to_string(),
        image: f[2].trim().to_string(),
        state: f[3].trim().to_lowercase(),
        status: f[4].trim().to_string(),
        ports: f.get(5).unwrap_or(&"").trim().to_string(),
        service: f.get(6).unwrap_or(&"").trim().to_string(),
    })
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
    fn a_compose_project_name_matches_what_compose_would_pick() {
        assert_eq!(compose_project_name("shopflow-web"), "shopflow-web");
        assert_eq!(compose_project_name("Shopflow Web"), "shopflowweb");
        assert_eq!(compose_project_name("_private.api"), "privateapi");
        assert_eq!(compose_project_name("árvíztűrő"), "rvztr");
    }

    #[test]
    fn a_container_line_parses_with_spaces_in_the_fields() {
        let line = "abc123def4567\tshop-db-1\tpostgres:16\trunning\tUp 3 hours (healthy)\t0.0.0.0:5432->5432/tcp\tdb";
        let c = parse_container(line).unwrap();

        assert_eq!(c.id, "abc123def456", "the id is shortened for display");
        assert_eq!(c.name, "shop-db-1");
        assert_eq!(c.state, "running");
        assert_eq!(c.status, "Up 3 hours (healthy)");
        assert_eq!(c.ports, "0.0.0.0:5432->5432/tcp");
        assert_eq!(c.service, "db");
    }

    #[test]
    fn a_container_with_no_ports_still_parses() {
        let c = parse_container("abc\tworker-1\tnode:22\texited\tExited (0) 2 minutes ago\t\tworker")
            .unwrap();

        assert_eq!(c.state, "exited");
        assert_eq!(c.ports, "");
        assert_eq!(c.service, "worker");
    }

    #[test]
    fn a_blank_line_is_not_a_container() {
        assert!(parse_container("").is_none());
        assert!(parse_container("\t\t\t\t").is_none());
    }

    #[test]
    fn the_reason_the_daemon_is_unreachable_is_kept_short() {
        let raw = "error during connect: Get \"http://…/version\": open //./pipe/docker_engine: \
                   The system cannot find the file specified.\nSee 'docker --help'.";

        let line = first_meaningful_line(raw);
        assert!(line.starts_with("Get "), "the connect prefix is noise: {line}");
        assert!(line.len() <= 160);
    }
}
