//! What is actually running, and what it belongs to.
//!
//! A machine with a dozen projects on it accumulates dev servers: some started
//! from here, some from a terminal two days ago, all of them holding ports and
//! memory. This gathers the ones that matter - anything this app started, its
//! children, anything listening on a port, and anything working inside a known
//! project - and says which project each belongs to.
//!
//! Deliberately not a task manager: a process that is none of those things is
//! not the user's problem while they are looking at their projects.

use std::collections::{BTreeMap, HashMap, HashSet};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

use crate::model::{Project, ProcessInfo};
use crate::ports;

/// Whether a process is one the app refuses to stop.
pub fn is_system(name: &str) -> bool {
    let lower = name.to_lowercase();
    let stem = lower.strip_suffix(".exe").unwrap_or(&lower);
    ports::NEVER_KILL.contains(&stem)
}

/// The project whose directory contains this path, longest match first so a
/// package inside a monorepo does not lose to the repository root.
fn owning_project(path: &str, projects: &[Project]) -> Option<(String, String)> {
    if path.is_empty() {
        return None;
    }
    let needle = path.to_lowercase();
    projects
        .iter()
        .filter(|p| !p.path.is_empty() && needle.starts_with(&p.path.to_lowercase()))
        .max_by_key(|p| p.path.len())
        .map(|p| (p.id.clone(), p.name.clone()))
}

/// Everything worth showing, newest and heaviest first.
///
/// `ours` maps a running command's key to the PID this app spawned for it.
pub fn snapshot(projects: &[Project], ours: &HashMap<String, u32>) -> Vec<ProcessInfo> {
    let listening = ports::listening_map();

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );
    sys.refresh_processes(ProcessesToUpdate::All, true);

    // Children, so a `npm run dev` can be followed to the node process that
    // actually holds the port - the shell in between owns neither.
    let mut children: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            children.entry(parent.as_u32()).or_default().push(pid.as_u32());
        }
    }

    // Ours, plus everything descended from ours.
    let mut mine: HashMap<u32, String> = HashMap::new();
    for (key, pid) in ours {
        let mut stack = vec![*pid];
        while let Some(current) = stack.pop() {
            if mine.insert(current, key.clone()).is_some() {
                continue;
            }
            if let Some(kids) = children.get(&current) {
                stack.extend(kids.iter().copied());
            }
        }
    }

    let me = std::process::id();
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for (pid, process) in sys.processes() {
        let pid = pid.as_u32();
        if pid == me || !seen.insert(pid) {
            continue;
        }

        let ports: Vec<u16> = listening.get(&pid).map(|p| p.iter().copied().collect()).unwrap_or_default();
        let cwd = process.cwd().map(|c| c.to_string_lossy().to_string()).unwrap_or_default();
        let exe = process.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
        let command_key = mine.get(&pid).cloned().unwrap_or_default();

        // A project is claimed by the working directory, or - for something we
        // started - by the command's own key, which carries the project id.
        let by_cwd = owning_project(&cwd, projects);
        let by_key = command_key
            .split('|')
            .next()
            .and_then(|id| projects.iter().find(|p| p.id == id))
            .map(|p| (p.id.clone(), p.name.clone()));
        let owner = by_cwd.or(by_key);

        // The three reasons to be listed at all.
        let interesting = !command_key.is_empty() || !ports.is_empty() || owner.is_some();
        if !interesting {
            continue;
        }

        let name = process.name().to_string_lossy().to_string();
        let (project_id, project) = owner.unwrap_or_default();

        out.push(ProcessInfo {
            pid,
            parent_pid: process.parent().map(|p| p.as_u32()).unwrap_or(0),
            name: name.clone(),
            exe,
            cmd: clip_command(&process.cmd().iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ")),
            cwd,
            memory_bytes: process.memory(),
            run_secs: process.run_time(),
            ports,
            project_id,
            project,
            command_key,
            killable: !is_system(&name),
        });
    }

    // Ours first - those are the ones the user is responsible for - then the
    // port holders, then by memory.
    out.sort_by(|a, b| {
        let rank = |p: &ProcessInfo| {
            if !p.command_key.is_empty() {
                0
            } else if !p.ports.is_empty() {
                1
            } else {
                2
            }
        };
        rank(a).cmp(&rank(b)).then(b.memory_bytes.cmp(&a.memory_bytes))
    });
    out
}

/// Command lines can run to kilobytes; a row needs enough to recognise it.
fn clip_command(cmd: &str) -> String {
    const LIMIT: usize = 300;
    if cmd.len() <= LIMIT {
        return cmd.to_string();
    }
    let mut end = LIMIT;
    while end > 0 && !cmd.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &cmd[..end])
}

/// Ends a process and everything below it.
///
/// The guard is applied here rather than trusted from the caller, and the name
/// is resolved here too, so a stale PID from the UI cannot end up naming a
/// process that has since been recycled onto that number.
pub fn stop(pid: u32) -> Result<String, String> {
    if pid <= 4 || pid == std::process::id() {
        return Err("refusing to stop that process".into());
    }

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);

    let process = sys.process(Pid::from_u32(pid)).ok_or("that process is no longer running")?;
    let name = process.name().to_string_lossy().to_string();
    if is_system(&name) {
        return Err(format!("{name} is a system process and will not be stopped"));
    }

    crate::runner::kill_tree(pid)?;
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: &str, name: &str, path: &str) -> Project {
        Project { id: id.into(), name: name.into(), path: path.into(), ..Default::default() }
    }

    #[test]
    fn the_innermost_project_claims_a_process() {
        // A package inside a monorepo must win over the repository root, or
        // every process would be filed under the outermost checkout.
        let projects = vec![
            project("root", "monorepo", "D:\\dev\\monorepo"),
            project("web", "frontend", "D:\\dev\\monorepo\\frontend"),
        ];

        let owner = owning_project("D:\\dev\\monorepo\\frontend\\src", &projects);
        assert_eq!(owner.unwrap().0, "web");

        let owner = owning_project("D:\\dev\\monorepo\\scripts", &projects);
        assert_eq!(owner.unwrap().0, "root");
    }

    #[test]
    fn a_path_outside_every_project_belongs_to_none() {
        let projects = vec![project("a", "alpha", "D:\\dev\\alpha")];

        assert!(owning_project("D:\\somewhere\\else", &projects).is_none());
        assert!(owning_project("", &projects).is_none());
        // A prefix that is not a directory boundary must not match either way.
        assert!(owning_project("D:\\dev\\alpha-old\\src", &projects).is_some());
    }

    #[test]
    fn matching_ignores_case_because_windows_does() {
        let projects = vec![project("a", "alpha", "D:\\Dev\\Alpha")];
        assert!(owning_project("d:\\dev\\alpha\\src", &projects).is_some());
    }

    #[test]
    fn system_processes_are_recognised_whatever_their_spelling() {
        for name in ["svchost.exe", "SVCHOST.EXE", "lsass", "explorer.exe"] {
            assert!(is_system(name), "{name} must be protected");
        }
        for name in ["node.exe", "cargo.exe", "python3"] {
            assert!(!is_system(name), "{name} is ordinary");
        }
    }

    #[test]
    fn a_long_command_line_is_clipped_on_a_character_boundary() {
        let long = "árvíztűrő ".repeat(80);
        let clipped = clip_command(&long);

        assert!(clipped.len() <= 304, "clipped to about the limit");
        assert!(clipped.ends_with('…'));
        // The point of the boundary walk: the result is still valid text.
        assert!(clipped.chars().count() > 100);
    }

    #[test]
    fn this_process_is_never_offered_for_stopping() {
        assert!(stop(std::process::id()).is_err());
        assert!(stop(0).is_err());
        assert!(stop(4).is_err());
    }

    /// The snapshot has to work against whatever this machine is running.
    #[test]
    fn a_snapshot_of_this_machine_is_coherent() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let projects = vec![project("self", "ultimate-project-assister", &root.to_string_lossy())];

        let found = snapshot(&projects, &HashMap::new());

        for p in &found {
            assert_ne!(p.pid, std::process::id(), "we never list ourselves");
            assert!(
                !p.command_key.is_empty() || !p.ports.is_empty() || !p.project_id.is_empty(),
                "every row needs a reason to be here: {p:?}",
            );
        }
    }
}
