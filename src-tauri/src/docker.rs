//! Docker: whether it is installed, whether the daemon is up, and what it holds.
//!
//! Every call here treats a missing Docker as ordinary rather than as an error.
//! Most projects do not use it, and the ones that do are frequently worked on
//! with Docker Desktop shut down - "installed but not running" is a normal
//! state that deserves its own answer, not a failure.
//!
//! Two things beyond the status: which project a container belongs to, and
//! Docker Desktop's virtual disk on Windows - a file that grows with every
//! image pulled and never gives the space back, however much is deleted inside.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::model::{CompactReport, Container, DockerStatus, Project, PruneReport};
use crate::procs::owning_project;

/// Docker output is tab-separated by our own `--format` strings, so a field
/// containing spaces (a status line, a port list) still parses.
const SEP: char = '\t';

/// Runs a program without a console window, keeping stderr for the error -
/// the reason something failed is the useful part of a failure.
fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    let err = String::from_utf8_lossy(&out.stderr).to_string();
    Err(if err.trim().is_empty() { String::from_utf8_lossy(&out.stdout).to_string() } else { err })
}

fn docker(args: &[&str]) -> Option<String> {
    run("docker", args).ok()
}

/// Same, but keeps the reason - why the daemon is unreachable is the useful
/// part of a failed `docker info`.
fn docker_err(args: &[&str]) -> Result<String, String> {
    run("docker", args)
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

/// What Docker holds and what it could reclaim, filled in only when the daemon
/// answers.
fn add_usage(status: &mut DockerStatus) {
    let Some(text) =
        docker(&["system", "df", "--format", "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}"])
    else {
        return;
    };
    apply_usage(status, &text);
}

fn apply_usage(status: &mut DockerStatus, text: &str) {
    for line in text.lines() {
        let fields: Vec<&str> = line.split(SEP).collect();
        let [kind, used, reclaimable] = fields[..] else { continue };
        // Docker appends a percentage: "4.9GB (100%)".
        let bytes = parse_human_size(reclaimable.split('(').next().unwrap_or(""));
        status.used_bytes += parse_human_size(used);
        match kind.trim() {
            "Images" => status.images_bytes = bytes,
            "Containers" => status.containers_bytes = bytes,
            "Build Cache" => status.build_cache_bytes = bytes,
            "Local Volumes" => status.volumes_bytes = bytes,
            _ => {}
        }
    }
}

pub fn status() -> DockerStatus {
    let mut status = DockerStatus::default();

    // The disk is a file, and its size is worth knowing with the daemon down -
    // that is exactly when it can be compacted.
    if let Some(disk) = desktop_disk() {
        status.disk_bytes = std::fs::metadata(&disk).map(|m| m.len()).unwrap_or(0);
        status.disk_path = disk.to_string_lossy().to_string();
    }

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

// ---------------------------------------------------------------------------
// Containers and the projects they belong to
// ---------------------------------------------------------------------------

/// Compose derives a project name from the directory it was started in:
/// lowercased, with anything outside `[a-z0-9_-]` dropped, and leading
/// separators trimmed. Matching that is the last resort for a container that
/// carries no path at all.
pub fn compose_project_name(dir_name: &str) -> String {
    dir_name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .trim_start_matches(['_', '-'])
        .to_string()
}

/// Every container Docker knows of - or only the running ones - each with the
/// project it belongs to, when it belongs to one.
pub fn containers(projects: &[Project], all: bool) -> Vec<Container> {
    let format = "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}\t{{.Label \"com.docker.compose.service\"}}";
    let mut args = vec!["ps", "--format", format];
    if all {
        args.push("-a");
    }
    let Some(text) = docker(&args) else { return Vec::new() };
    let mut list: Vec<Container> = text.lines().filter_map(parse_container).collect();
    if list.is_empty() {
        return list;
    }

    // `ps` cannot show the labels and mounts whole; `inspect` can, as JSON, in
    // one call for the lot.
    let mut inspect = vec!["inspect"];
    inspect.extend(list.iter().map(|c| c.id.as_str()));
    let details: HashMap<String, Value> = docker(&inspect)
        .and_then(|json| serde_json::from_str::<Vec<Value>>(&json).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|d| {
            let id: String = d["Id"].as_str()?.chars().take(12).collect();
            Some((id, d))
        })
        .collect();

    let now = chrono::Utc::now();
    for c in &mut list {
        let Some(d) = details.get(&c.id) else { continue };
        let facts = Facts::of(d);
        c.host_ports = facts.ports;
        if c.state == "running" {
            c.run_secs = chrono::DateTime::parse_from_rfc3339(&facts.started)
                .map(|t| (now - t.with_timezone(&chrono::Utc)).num_seconds().max(0) as u64)
                .unwrap_or(0);
        }
        if let Some((id, name)) = owner(&facts.labels, &facts.binds, projects) {
            c.project_id = id;
            c.project = name;
        }
    }
    list
}

/// The parts of `docker inspect` that say where a container came from.
#[derive(Default)]
struct Facts {
    labels: HashMap<String, String>,
    /// Host side of every bind mount, as Docker reports it.
    binds: Vec<String>,
    ports: Vec<u16>,
    started: String,
}

impl Facts {
    fn of(d: &Value) -> Facts {
        let labels = d["Config"]["Labels"]
            .as_object()
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        let binds = d["Mounts"]
            .as_array()
            .map(|mounts| {
                mounts
                    .iter()
                    .filter(|m| m["Type"] == "bind")
                    .filter_map(|m| m["Source"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        // `{"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "5432"}], "80/tcp": null}`
        let ports: BTreeSet<u16> = d["NetworkSettings"]["Ports"]
            .as_object()
            .map(|m| {
                m.values()
                    .filter_map(Value::as_array)
                    .flatten()
                    .filter_map(|b| b["HostPort"].as_str()?.parse().ok())
                    .collect()
            })
            .unwrap_or_default();

        Facts {
            labels,
            binds,
            ports: ports.into_iter().collect(),
            started: d["State"]["StartedAt"].as_str().unwrap_or("").to_string(),
        }
    }
}

/// The project a container belongs to.
///
/// A path says it best: compose records the directory it was started from, a
/// dev container records the folder it was opened on, and a bind mount names a
/// directory on the host. A compose file kept in `infra/docker` inside a
/// project still lands on that project, since the deepest project containing
/// the path wins. Only a container with no path at all falls back to its
/// compose project name.
fn owner(
    labels: &HashMap<String, String>,
    binds: &[String],
    projects: &[Project],
) -> Option<(String, String)> {
    let by_path = |raw: &String| host_path(raw).and_then(|p| owning_project(&p, projects));

    ["com.docker.compose.project.working_dir", "devcontainer.local_folder"]
        .iter()
        .filter_map(|key| labels.get(*key))
        .find_map(by_path)
        .or_else(|| binds.iter().find_map(by_path))
        .or_else(|| {
            let name = labels
                .get("com.docker.compose.project")
                .or_else(|| labels.get("com.supabase.cli.project"))?;
            // A name like `server` or `app` fits many directories; it only
            // counts when exactly one project has it.
            let mut fits = projects.iter().filter(|p| {
                let dir = Path::new(&p.path).file_name().map(|n| n.to_string_lossy());
                dir.is_some_and(|d| compose_project_name(&d) == *name)
            });
            match (fits.next(), fits.next()) {
                (Some(p), None) => Some((p.id.clone(), p.name.clone())),
                _ => None,
            }
        })
}

/// A host path as the projects are stored, from the way Docker reports it.
///
/// Docker Desktop hands back Windows paths as they were given, or as the VM
/// sees them: `/run/desktop/mnt/host/c/dev/shop` is `C:\dev\shop`. A path
/// that lives only inside a Linux distro has no host equivalent.
fn host_path(raw: &str) -> Option<String> {
    let raw = raw.trim();
    for prefix in ["/run/desktop/mnt/host/", "/mnt/host/", "/mnt/"] {
        if let Some(rest) = raw.strip_prefix(prefix) {
            let (drive, tail) = rest.split_once('/').unwrap_or((rest, ""));
            if drive.len() == 1 && drive.chars().all(|c| c.is_ascii_alphabetic()) {
                return Some(format!("{}:\\{}", drive.to_ascii_uppercase(), tail.replace('/', "\\")));
            }
            return None;
        }
    }
    let b = raw.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
        return Some(raw.replace('/', "\\"));
    }
    // Elsewhere the daemon runs on the host itself, and a path is a path.
    (!cfg!(windows) && raw.starts_with('/')).then(|| raw.to_string())
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
        ..Container::default()
    })
}

/// Stops one container and says which. Only an id is accepted, so nothing but
/// a container can be named here.
pub fn stop(id: &str) -> Result<String, String> {
    if id.len() < 12 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("not a container id".into());
    }
    let name = docker(&["inspect", "--format", "{{.Name}}", id])
        .map(|n| n.trim().trim_start_matches('/').to_string())
        .unwrap_or_else(|| id.to_string());
    docker_err(&["stop", id]).map_err(|e| first_meaningful_line(&e))?;
    Ok(name)
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

/// What each prune target runs, in the order they run: containers first, so
/// the images they were holding are unused by the time images are pruned.
///
/// Volumes are pruned without `--all`, which since Docker 23 leaves named
/// volumes alone - a database's data lives in one, and "unused" only means no
/// container is attached to it right now.
const PRUNES: &[(&str, &[&str])] = &[
    ("containers", &["container", "prune", "-f"]),
    ("images", &["image", "prune", "-f"]),
    ("images-all", &["image", "prune", "-a", "-f"]),
    ("cache", &["builder", "prune", "-a", "-f"]),
    ("volumes", &["volume", "prune", "-f"]),
];

/// Runs the asked-for prunes. Anything not in the list above is ignored, so
/// the frontend can only ever pick from these.
pub fn prune(targets: &[String]) -> PruneReport {
    let wants = |key: &str| targets.iter().any(|t| t == key);
    let mut report = PruneReport::default();

    for (key, args) in PRUNES {
        // Every unused image includes the dangling ones.
        if !wants(key) || (*key == "images" && wants("images-all")) {
            continue;
        }
        match docker_err(args) {
            Ok(out) => {
                report.freed_bytes += reclaimed(&out);
                report.done.push(key.to_string());
            }
            Err(e) => report.errors.push(format!("{key}: {}", first_meaningful_line(&e))),
        }
    }
    report
}

/// The total a prune reports: `Total reclaimed space: 1.2GB`, or `Total: 1.2GB`
/// from the builder.
fn reclaimed(out: &str) -> u64 {
    out.lines()
        .map(str::trim)
        .find(|l| l.to_lowercase().starts_with("total reclaimed space:") || l.starts_with("Total:"))
        .and_then(|l| l.rsplit(':').next())
        .map(parse_human_size)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Docker Desktop's disk
// ---------------------------------------------------------------------------

/// The virtual disk Docker Desktop keeps its images, containers and volumes on.
///
/// Newer installs keep it as `wsl\disk\docker_data.vhdx`; older ones as the
/// `docker-desktop-data` distro's `wsl\data\ext4.vhdx`. A disk moved in
/// Docker Desktop's settings is found under the folder it was moved to.
pub fn desktop_disk() -> Option<PathBuf> {
    let local = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Docker").join("wsl");
    let mut candidates = Vec::new();
    if let Some(dir) = custom_disk_dir() {
        candidates.extend(
            walkdir::WalkDir::new(dir)
                .max_depth(3)
                .into_iter()
                .flatten()
                .filter(|e| e.file_name() == "docker_data.vhdx")
                .map(|e| e.into_path()),
        );
    }
    candidates.push(local.join("disk").join("docker_data.vhdx"));
    candidates.push(local.join("data").join("ext4.vhdx"));
    candidates.into_iter().find(|p| p.is_file())
}

/// Where the user moved the disk, if they did.
fn custom_disk_dir() -> Option<PathBuf> {
    let docker = PathBuf::from(std::env::var_os("APPDATA")?).join("Docker");
    ["settings-store.json", "settings.json"].iter().find_map(|name| {
        let text = std::fs::read_to_string(docker.join(name)).ok()?;
        let json: Value = serde_json::from_str(&text).ok()?;
        let dir = json["CustomWslDistroDir"].as_str()?.trim();
        (!dir.is_empty()).then(|| PathBuf::from(dir))
    })
}

/// Shrinks Docker Desktop's disk to what is actually in it.
///
/// Deleting an image frees blocks inside the disk, not on the host: Docker
/// Desktop mounts its data filesystem without `discard`, so the file stays as
/// large as it has ever been. Giving the space back takes four steps:
///
/// 1. `fstrim` inside Docker's VM marks the free blocks as unused. It runs from
///    a throwaway privileged container while Docker is still up, and nothing
///    has been stopped if it fails.
/// 2. Docker Desktop is stopped, so the disk is let go.
/// 3. `diskpart` compacts the file. That needs administrator rights, so
///    Windows asks for them.
/// 4. Docker Desktop is started again - whatever happened in step 3 - and with
///    it every container that was running before.
///
/// `step` is told each step's name as it begins.
pub fn compact(step: impl Fn(&str)) -> Result<CompactReport, String> {
    if !cfg!(windows) {
        return Err("Docker Desktop's disk is only compacted on Windows".into());
    }
    let disk = desktop_disk().ok_or("Docker Desktop's disk was not found")?;
    let size = || std::fs::metadata(&disk).map(|m| m.len()).unwrap_or(0);
    let mut report = CompactReport { before_bytes: size(), ..CompactReport::default() };

    step("trim");
    report.trimmed = trim()?;

    // A container without a restart policy stays down when Docker Desktop
    // comes back, so what was running is noted now and started again after.
    let running: Vec<String> = docker(&["ps", "-q"])
        .map(|out| out.split_whitespace().map(String::from).collect())
        .unwrap_or_default();

    // From here on Docker Desktop is going down, and it is started again
    // whatever happens. `docker desktop stop` can give up on its timeout while
    // the shutdown is still finishing, so its error is not the verdict: the
    // disk being let go is.
    step("stop");
    let stopped = docker_err(&["desktop", "stop", "--timeout", "120"]);
    let compacted = (|| {
        step("detach");
        release(&disk).map_err(|e| match &stopped {
            Err(why) => format!("Docker Desktop did not stop: {}", first_meaningful_line(why)),
            Ok(_) => e,
        })?;
        step("compact");
        diskpart_compact(&disk)
    })();

    step("start");
    match docker_err(&["desktop", "start", "--timeout", "180"]) {
        Err(e) => report.restart_error = first_meaningful_line(&e),
        Ok(_) if !running.is_empty() => {
            let mut args = vec!["start"];
            args.extend(running.iter().map(String::as_str));
            if let Err(e) = docker_err(&args) {
                report.restart_error = first_meaningful_line(&e);
            }
        }
        Ok(_) => {}
    }

    compacted?;
    report.after_bytes = size();
    Ok(report)
}

/// Runs `fstrim` in Docker's VM from a privileged container that shares the
/// VM's process namespace. Uses an Alpine image already on the machine when
/// there is one, and removes it again when it had to be pulled.
fn trim() -> Result<String, String> {
    let local = docker(&["image", "ls", "alpine", "--format", "{{.Repository}}:{{.Tag}}"])
        .and_then(|out| out.lines().map(str::trim).find(|l| !l.contains("<none>")).map(String::from));
    let image = local.clone().unwrap_or_else(|| "alpine:3.20".into());

    let out = docker_err(&[
        "run", "--rm", "--privileged", "--pid=host", &image, "nsenter", "-t", "1", "-m", "--",
        "fstrim", "-av",
    ]);
    if local.is_none() {
        let _ = docker(&["image", "rm", &image]);
    }
    out.map(|text| text.trim().to_string())
        .map_err(|e| format!("fstrim did not run: {}", first_meaningful_line(&e)))
}

/// Waits for the disk to be let go once Docker Desktop is down. If WSL is
/// still holding it after that, WSL is shut down - which stops every running
/// distro, and is why it is only the second resort.
fn release(disk: &Path) -> Result<(), String> {
    let free_within = |limit: Duration| {
        let start = Instant::now();
        while start.elapsed() < limit {
            if !in_use(disk) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        !in_use(disk)
    };
    if free_within(Duration::from_secs(30)) {
        return Ok(());
    }
    let _ = run("wsl", &["--shutdown"]);
    if free_within(Duration::from_secs(30)) {
        return Ok(());
    }
    Err("the disk is still in use".into())
}

/// Whether something still has the file open: opening it with no sharing
/// allowed fails while anything else holds a handle.
#[cfg(windows)]
fn in_use(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    std::fs::OpenOptions::new().read(true).share_mode(0).open(path).is_err()
}

#[cfg(not(windows))]
fn in_use(_path: &Path) -> bool {
    false
}

/// Compacts the disk with `diskpart`, elevated. Windows shows its own
/// administrator prompt; declining it is reported as an error and changes
/// nothing.
fn diskpart_compact(disk: &Path) -> Result<(), String> {
    let script = std::env::temp_dir().join(format!("upa-docker-compact-{}.txt", std::process::id()));
    std::fs::write(
        &script,
        format!(
            "select vdisk file=\"{}\"\r\nattach vdisk readonly\r\ncompact vdisk\r\ndetach vdisk\r\nexit\r\n",
            disk.display()
        ),
    )
    .map_err(|e| e.to_string())?;

    let quoted = script.display().to_string().replace('\'', "''");
    let elevate = format!(
        "$p = Start-Process -FilePath diskpart.exe -ArgumentList '/s', '\"{quoted}\"' \
         -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode"
    );
    let result = run("powershell", &["-NoProfile", "-NonInteractive", "-Command", &elevate]);
    let _ = std::fs::remove_file(&script);
    result.map(|_| ()).map_err(|e| format!("diskpart: {}", first_meaningful_line(&e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: &str, path: &str) -> Project {
        Project { id: id.into(), name: id.into(), path: path.into(), ..Project::default() }
    }

    fn labels(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

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

    #[test]
    fn the_vm_view_of_a_windows_path_is_turned_back_into_one() {
        assert_eq!(
            host_path("/run/desktop/mnt/host/c/_DEV/shop/api").as_deref(),
            Some("C:\\_DEV\\shop\\api")
        );
        assert_eq!(host_path("C:\\_DEV\\shop").as_deref(), Some("C:\\_DEV\\shop"));
        assert_eq!(host_path("/mnt/d/work").as_deref(), Some("D:\\work"));
        assert_eq!(host_path("/mnt/wsl/docker-desktop-bind-mounts/x"), None);
    }

    #[test]
    fn a_compose_file_deep_inside_a_project_still_belongs_to_it() {
        // The stack is named `mefa-b2b`, nothing like the directory, and its
        // compose file sits two levels down - the path is what settles it.
        let projects = [project("mefa", "C:\\_DEV\\MEFA-Webshop-B2B"), project("gift", "C:\\_DEV\\GiftShare")];
        let l = labels(&[
            ("com.docker.compose.project", "mefa-b2b"),
            ("com.docker.compose.project.working_dir", "C:\\_DEV\\MEFA-Webshop-B2B\\infra\\docker"),
        ]);

        assert_eq!(owner(&l, &[], &projects).map(|o| o.0).as_deref(), Some("mefa"));
    }

    #[test]
    fn a_container_without_labels_is_placed_by_its_bind_mounts() {
        let projects = [project("gift", "C:\\_DEV\\GiftShare")];
        let binds = ["/run/desktop/mnt/host/c/_DEV/GiftShare/docker/init.sql".to_string()];

        assert_eq!(owner(&HashMap::new(), &binds, &projects).map(|o| o.0).as_deref(), Some("gift"));
    }

    #[test]
    fn a_sibling_directory_with_a_longer_name_is_not_inside_the_project() {
        let projects = [project("shop", "C:\\_DEV\\shop")];
        let l = labels(&[("com.docker.compose.project.working_dir", "C:\\_DEV\\shop-old")]);

        assert_eq!(owner(&l, &[], &projects), None);
    }

    #[test]
    fn with_no_path_at_all_the_compose_name_decides() {
        let projects = [project("srv", "C:\\_DEV\\browseline-server"), project("x", "C:\\_DEV\\other")];
        let l = labels(&[("com.supabase.cli.project", "browseline-server")]);

        assert_eq!(owner(&l, &[], &projects).map(|o| o.0).as_deref(), Some("srv"));
        assert_eq!(owner(&labels(&[("com.docker.compose.project", "nobody")]), &[], &projects), None);
    }

    #[test]
    fn a_compose_name_two_projects_share_decides_nothing() {
        let projects = [project("a", "C:\\one\\server"), project("b", "C:\\two\\server")];
        let l = labels(&[("com.docker.compose.project", "server")]);

        assert_eq!(owner(&l, &[], &projects), None);
    }

    #[test]
    fn inspect_output_yields_the_published_host_ports_once_each() {
        let d: Value = serde_json::from_str(
            r#"{"Config": {"Labels": {"a": "b"}},
                "Mounts": [{"Type": "volume", "Source": "/var/lib/x"}, {"Type": "bind", "Source": "C:\\p"}],
                "NetworkSettings": {"Ports": {
                    "5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "5432"}, {"HostIp": "::", "HostPort": "5432"}],
                    "80/tcp": null}},
                "State": {"StartedAt": "2026-11-09T08:17:33.123456789Z"}}"#,
        )
        .unwrap();
        let f = Facts::of(&d);

        assert_eq!(f.ports, vec![5432]);
        assert_eq!(f.binds, vec!["C:\\p".to_string()], "volumes are not paths on the host");
        assert_eq!(f.labels.get("a").map(String::as_str), Some("b"));
        assert!(chrono::DateTime::parse_from_rfc3339(&f.started).is_ok());
    }

    #[test]
    fn usage_adds_up_what_docker_holds_and_keeps_each_reclaimable_figure() {
        let mut s = DockerStatus::default();
        apply_usage(
            &mut s,
            "Images\t39.18GB\t11.97GB (30%)\nContainers\t780.7MB\t337MB (43%)\n\
             Local Volumes\t4.746GB\t951.3MB (20%)\nBuild Cache\t0B\t0B\n",
        );

        assert_eq!(s.images_bytes, parse_human_size("11.97GB"));
        assert_eq!(s.containers_bytes, parse_human_size("337MB"));
        assert_eq!(s.volumes_bytes, parse_human_size("951.3MB"));
        assert_eq!(
            s.used_bytes,
            parse_human_size("39.18GB") + parse_human_size("780.7MB") + parse_human_size("4.746GB")
        );
    }

    #[test]
    fn a_prune_reports_what_it_reclaimed_in_either_wording() {
        assert_eq!(
            reclaimed("Deleted Images:\nuntagged: x\n\nTotal reclaimed space: 1.5GB\n"),
            parse_human_size("1.5GB")
        );
        assert_eq!(reclaimed("ID\tRECLAIMABLE\nabc\t12MB\nTotal:\t12MB\n"), parse_human_size("12MB"));
        assert_eq!(reclaimed("nothing here"), 0);
    }

    #[test]
    fn only_known_prune_targets_ever_run() {
        // Nothing listed means nothing runs - not even a call to Docker.
        let report = prune(&["rm -rf /".to_string(), "system".to_string()]);
        assert!(report.done.is_empty() && report.errors.is_empty());
    }
}
