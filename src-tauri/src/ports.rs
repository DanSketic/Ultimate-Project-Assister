//! Which port a command wants, and who already has it.
//!
//! Half a dozen projects on one machine all default to 3000 or 5173, so the
//! second `npm run dev` of the day dies with `EADDRINUSE` several seconds after
//! it looked like it started. This module reads the port a command is going to
//! ask for out of the project's own files, and checks whether anything is
//! already listening before the process is spawned.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};
use std::path::Path;
use std::process::Command;

use crate::model::{PortConflict, PortProcess, PortUser};

/// Ports below this are system services nothing here would start.
const MIN_PORT: u16 = 1024;

/// Sub-commands that build or check rather than serve, whatever tool runs them.
const NOT_A_SERVER: &[&str] =
    &["build", "lint", "test", "typecheck", "check", "format", "generate", "compile", "prepare"];

/// Default a framework listens on when nothing says otherwise. Only consulted
/// when the project declares no port of its own.
///
/// Matched on tokens rather than on substrings: `vite build` is not a server,
/// and `vitest` is not vite at all - both of which a `contains("vite")` test
/// gets wrong, and gets wrong silently.
fn default_port(cmd: &str, manifests: &[String]) -> Option<u16> {
    // Leading `PORT=3000`-style assignments are environment, not the program.
    let tokens: Vec<&str> = cmd.split_whitespace().skip_while(|t| t.contains('=')).collect();

    let program = tokens.first().copied().unwrap_or_default();
    // `node_modules/.bin/vite` is still vite.
    let program = program.rsplit(['/', '\\']).next().unwrap_or(program);
    let sub = tokens.get(1).copied().filter(|t| !t.starts_with('-')).unwrap_or_default();

    if NOT_A_SERVER.contains(&sub) {
        return None;
    }

    match (program, sub) {
        ("vite", "preview") => return Some(4173),
        ("vite", _) => return Some(5173),
        ("next", "dev" | "start") => return Some(3000),
        ("nuxt", "dev" | "start" | "preview") => return Some(3000),
        ("astro", "dev" | "preview") => return Some(4321),
        ("ng", "serve") => return Some(4200),
        ("remix", "dev") => return Some(3000),
        ("react-scripts", "start") => return Some(3000),
        ("storybook", _) => return Some(6006),
        ("uvicorn", _) => return Some(8000),
        ("flask", "run") => return Some(5000),
        ("rails", "s" | "server") => return Some(3000),
        _ => {}
    }

    // Forms that carry their own shape rather than a program name.
    if cmd.contains("manage.py runserver") {
        return Some(8000);
    }
    if cmd.contains("phx.server") {
        return Some(4000);
    }
    if cmd.contains("php -S") {
        return Some(8000);
    }

    // A bare `dev`/`start` script on a Node project whose body we could not
    // read: 3000 is the convention, and a wrong guess here only costs a
    // question that turns out not to have been needed.
    if (cmd.contains(" run dev") || cmd.contains(" run start"))
        && manifests.iter().any(|m| m == "package.json")
    {
        return Some(3000);
    }
    None
}

/// Pulls an explicit port out of a command line: `--port 5174`, `-p 8080`,
/// `--port=3001`, `PORT=4000 npm run dev`.
pub fn port_in_command(cmd: &str) -> Option<u16> {
    let tokens: Vec<&str> = cmd.split_whitespace().collect();
    for (i, token) in tokens.iter().enumerate() {
        let value = if let Some(v) = token.strip_prefix("--port=") {
            Some(v)
        } else if let Some(v) = token.strip_prefix("-p=") {
            Some(v)
        } else if let Some(v) = token.strip_prefix("PORT=") {
            Some(v)
        } else if *token == "--port" || *token == "-p" {
            tokens.get(i + 1).copied()
        } else {
            None
        };
        if let Some(port) = value.and_then(|v| v.trim().parse::<u16>().ok()) {
            if port >= MIN_PORT {
                return Some(port);
            }
        }
    }
    None
}

/// `PORT=3001` out of a `.env`, ignoring comments.
fn port_in_env(dir: &Path) -> Option<u16> {
    for name in [".env", ".env.local", ".env.development"] {
        let Ok(raw) = fs::read_to_string(dir.join(name)) else { continue };
        for line in raw.lines() {
            let line = line.trim();
            if line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else { continue };
            if !matches!(key.trim(), "PORT" | "VITE_PORT" | "NUXT_PORT" | "SERVER_PORT") {
                continue;
            }
            let value = value.trim().trim_matches(['"', '\'']);
            if let Some(port) = value.parse::<u16>().ok().filter(|p| *p >= MIN_PORT) {
                return Some(port);
            }
        }
    }
    None
}

/// `port: 5174` out of a vite/nuxt/astro config. Deliberately a plain text
/// scan: these are JavaScript, and only a JavaScript engine could do better.
fn port_in_config(dir: &Path) -> Option<u16> {
    let names = [
        "vite.config.ts", "vite.config.js", "vite.config.mts",
        "nuxt.config.ts", "nuxt.config.js",
        "astro.config.mjs", "astro.config.ts",
        "next.config.js", "next.config.mjs",
    ];
    for name in names {
        let Ok(raw) = fs::read_to_string(dir.join(name)) else { continue };
        for line in raw.lines() {
            let line = line.trim();
            if line.starts_with("//") || line.starts_with('*') {
                continue;
            }
            let Some(rest) = line.split_once("port:").map(|(_, r)| r) else { continue };
            let digits: String = rest.trim().chars().take_while(char::is_ascii_digit).collect();
            if let Some(port) = digits.parse::<u16>().ok().filter(|p| *p >= MIN_PORT) {
                return Some(port);
            }
        }
    }
    None
}

/// Host-side ports out of a compose file's `ports:` entries - `"8080:80"`,
/// `- 3000:3000`. The half before the colon is what is taken on this machine.
pub fn ports_in_compose(raw: &str) -> BTreeSet<u16> {
    let mut out = BTreeSet::new();
    let mut in_ports = false;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("ports:") {
            in_ports = true;
            continue;
        }
        if !in_ports {
            continue;
        }
        // The block ends at the next key that is not a list item.
        if !trimmed.starts_with('-') {
            if !trimmed.is_empty() && !trimmed.starts_with('#') {
                in_ports = false;
            }
            continue;
        }
        let item = trimmed.trim_start_matches('-').trim().trim_matches(['"', '\'']);
        // `127.0.0.1:8080:80` -> the host port is the second-to-last field.
        let fields: Vec<&str> = item.split(':').collect();
        let host = if fields.len() >= 2 { fields[fields.len() - 2] } else { fields[0] };
        // A range such as `3000-3005` takes the first.
        let host = host.split('-').next().unwrap_or(host);
        if let Some(port) = host.trim().parse::<u16>().ok().filter(|p| *p >= MIN_PORT) {
            out.insert(port);
        }
    }
    out
}

/// What `npm run dev` actually runs, read out of package.json.
///
/// Without this, every script looks alike and the guess has to be the generic
/// 3000 - wrong for a Vite project, which serves on 5173. Resolving the script
/// turns `npm run dev` into `vite` and the guess into the right one.
fn script_body(dir: &Path, cmd: &str) -> Option<String> {
    let (_, rest) = cmd.split_once(" run ")?;
    let name = rest.split_whitespace().next()?;

    let raw = fs::read_to_string(dir.join("package.json")).ok()?;
    let json = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    let body = json.get("scripts")?.get(name)?.as_str()?.trim().to_string();

    (!body.is_empty()).then_some(body)
}

/// The port a command is expected to take, or none when it does not serve.
pub fn port_for(cmd: &str, dir: &Path, manifests: &[String]) -> Option<u16> {
    // A compose stack publishes whatever the file says, whichever command
    // brings it up.
    if cmd.contains("compose up") {
        for name in ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] {
            if let Ok(raw) = fs::read_to_string(dir.join(name)) {
                if let Some(first) = ports_in_compose(&raw).into_iter().next() {
                    return Some(first);
                }
            }
        }
        return None;
    }

    // Anything spelled out on the command line wins over every guess.
    port_in_command(cmd)
        .or_else(|| port_in_env(dir))
        .or_else(|| port_in_config(dir))
        // What the script runs decides the default, when it can be read: a
        // `dev` script is only generic until you look at what is inside it.
        .or_else(|| script_body(dir, cmd).and_then(|body| port_in_command(&body)))
        .or_else(|| {
            let body = script_body(dir, cmd)?;
            default_port(&body, manifests)
        })
        .or_else(|| default_port(cmd, manifests))
}

/// Whether anything is listening on a TCP port.
///
/// Decided by trying to bind it, which is exactly the question the command
/// about to start will ask - no parsing of `netstat` output, and no false
/// negative from a listener the current user cannot see.
///
/// All four addresses, and IPv6 is not optional: Node resolves `localhost` to
/// `::1` first, so a Vite dev server listens on IPv6 loopback alone. Checking
/// only the IPv4 addresses found them genuinely free and reported the port
/// available while the server was plainly running on it.
pub fn is_taken(port: u16) -> bool {
    let addresses = [
        SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)),
        SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
        SocketAddr::from((Ipv6Addr::UNSPECIFIED, port)),
    ];

    for addr in addresses {
        match TcpListener::bind(addr) {
            Ok(listener) => drop(listener),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => return true,
            // Any other refusal says this address family is unusable here - no
            // IPv6 stack, a privileged port - which is not evidence that
            // somebody is holding the port.
            Err(_) => continue,
        }
    }
    false
}

/// The first free port at or above `wanted`, searched over a small window.
///
/// Adjacent rather than random: 5174 next to 5173 is recognisable as "the same
/// dev server, moved", where a port plucked out of the ephemeral range is not.
pub fn free_near(wanted: u16) -> Option<u16> {
    (wanted.saturating_add(1)..=wanted.saturating_add(64)).find(|p| *p >= MIN_PORT && !is_taken(*p))
}

/// Rewrites a command so it asks for a different port.
///
/// Returns `None` when the port is not the command's to choose - a compose
/// stack publishes what its file says, and quietly rewriting that would be
/// lying about what is running.
pub fn with_port(cmd: &str, port: u16) -> Option<String> {
    if cmd.contains("compose up") || cmd.contains("compose down") {
        return None;
    }

    // An explicit port already on the line is replaced in place, whatever form
    // it took, so a command never ends up carrying two different ports.
    if port_in_command(cmd).is_some() {
        return Some(replace_port(cmd, port));
    }

    // `php -S localhost:8000` carries its port inside the address.
    if cmd.contains("php -S") {
        return Some(rewrite_host_port(cmd, port));
    }

    // Django takes a bare address, not a flag.
    if cmd.contains("manage.py runserver") {
        return Some(format!("{cmd} {port}"));
    }
    // Rails and a few others spell it `-p`.
    if cmd.contains("rails s") {
        return Some(format!("{cmd} -p {port}"));
    }

    // npm insists on `--` before arguments meant for the script itself. The
    // other package managers forward them either way.
    if cmd.starts_with("npm run ") {
        return Some(format!("{cmd} -- --port {port}"));
    }
    if cmd.starts_with("pnpm run ")
        || cmd.starts_with("yarn ")
        || cmd.starts_with("bun run ")
        || cmd.starts_with("vite")
        || cmd.contains("next dev")
        || cmd.contains("nuxt dev")
        || cmd.contains("astro dev")
        || cmd.contains("ng serve")
        || cmd.contains("uvicorn")
        || cmd.contains("flask run")
    {
        return Some(format!("{cmd} --port {port}"));
    }

    // Anything else: the environment variable is the only lever we have, and
    // the runner sets it regardless. Saying so beats appending a flag the
    // command would reject.
    None
}

/// Swaps the number in whichever port token the line already carries.
fn replace_port(cmd: &str, port: u16) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut replace_next = false;

    for token in cmd.split_whitespace() {
        if replace_next {
            replace_next = false;
            out.push(port.to_string());
            continue;
        }
        let swapped = ["--port=", "-p=", "PORT="]
            .iter()
            .find_map(|prefix| token.strip_prefix(prefix).map(|_| format!("{prefix}{port}")));
        match swapped {
            Some(t) => out.push(t),
            None => {
                if token == "--port" || token == "-p" {
                    replace_next = true;
                }
                out.push(token.to_string());
            }
        }
    }
    out.join(" ")
}

/// `php -S localhost:8000 -t public` -> the same with a new port.
fn rewrite_host_port(cmd: &str, port: u16) -> String {
    cmd.split_whitespace()
        .map(|token| match token.rsplit_once(':') {
            Some((host, tail)) if tail.chars().all(|c| c.is_ascii_digit()) && !tail.is_empty() => {
                format!("{host}:{port}")
            }
            _ => token.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Processes that must never be killed to free a port, whatever they are
/// listening on. Some of these genuinely do hold ports, and ending one takes
/// the session or the machine with it.
pub const NEVER_KILL: &[&str] = &[
    "system", "idle", "smss", "csrss", "wininit", "winlogon", "services", "lsass",
    "svchost", "explorer", "dwm", "fontdrvhost", "sihost", "runtimebroker",
    "systemd", "init", "launchd", "kernel_task", "windowserver", "loginwindow",
];

/// Every process holding a listening TCP port, and which ports it holds.
///
/// One pass over the OS tables, shared by the port check and the process
/// overview so the two can never disagree about who has what.
#[cfg(windows)]
pub fn listening_map() -> BTreeMap<u32, BTreeSet<u16>> {
    use std::os::windows::process::CommandExt;

    let mut out: BTreeMap<u32, BTreeSet<u16>> = BTreeMap::new();
    let mut cmd = Command::new("netstat");
    // No `-p TCP`: on Windows that means IPv4 only, and a dev server listening
    // on `[::1]` would not appear at all. Unfiltered output carries both
    // families, with the protocol in the first column.
    cmd.args(["-ano"]);
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let Ok(result) = cmd.output() else { return out };
    let text = String::from_utf8_lossy(&result.stdout);

    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        // Proto, local address, foreign address, [state], pid. The state word
        // is translated on a localised Windows, so it is never matched on: a
        // wildcard foreign address is what marks a listening socket, in every
        // language.
        if fields.len() < 5 || !fields[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        if !matches!(fields[2], "0.0.0.0:0" | "[::]:0" | "*:*") {
            continue;
        }
        let Some(port) = local_port(fields[1]) else { continue };
        let Ok(pid) = fields[fields.len() - 1].parse::<u32>() else { continue };
        if pid > 4 && port >= MIN_PORT {
            out.entry(pid).or_default().insert(port);
        }
    }
    out
}

#[cfg(not(windows))]
pub fn listening_map() -> BTreeMap<u32, BTreeSet<u16>> {
    let mut out: BTreeMap<u32, BTreeSet<u16>> = BTreeMap::new();
    let Ok(result) = Command::new("lsof").args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]).output()
    else {
        return out;
    };

    // `-F` output is one field per line: `p<pid>` then `n<addr>` for each.
    let mut pid = 0u32;
    for line in String::from_utf8_lossy(&result.stdout).lines() {
        match line.split_at(1) {
            ("p", rest) => pid = rest.parse().unwrap_or(0),
            ("n", rest) => {
                if let Some(port) = local_port(rest) {
                    if pid > 0 && port >= MIN_PORT {
                        out.entry(pid).or_default().insert(port);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// `127.0.0.1:1420`, `[::1]:1420` and `*:1420` all yield 1420.
fn local_port(address: &str) -> Option<u16> {
    address.rsplit(':').next()?.parse().ok()
}

/// The PID listening on one port.
fn listening_pid(port: u16) -> Option<u32> {
    listening_map()
        .into_iter()
        .find_map(|(pid, ports)| ports.contains(&port).then_some(pid))
}

/// Names the process holding a port, so the user can see what they are about to
/// stop rather than being shown a bare number.
pub fn holder_process(port: u16) -> Option<PortProcess> {
    use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

    let pid = listening_pid(port)?;
    if pid == std::process::id() {
        return None; // us; nothing useful to offer
    }

    let sys = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );
    let process = sys.process(Pid::from_u32(pid));

    let name = process
        .map(|p| p.name().to_string_lossy().to_string())
        .unwrap_or_else(|| format!("pid {pid}"));
    let exe = process
        .and_then(|p| p.exe().map(|e| e.to_string_lossy().to_string()))
        .unwrap_or_default();

    let stem = name.to_lowercase();
    let stem = stem.strip_suffix(".exe").unwrap_or(&stem);
    Some(PortProcess { pid, name, exe, killable: !NEVER_KILL.contains(&stem) })
}

/// Ends whatever is holding a port, with the guards that decide whether it may
/// be ended at all applied here rather than trusted from the caller.
pub fn free(port: u16) -> Result<String, String> {
    let holder = holder_process(port).ok_or_else(|| format!("nothing is listening on {port}"))?;
    if !holder.killable {
        return Err(format!("{} is a system process and will not be stopped", holder.name));
    }
    kill_tree(holder.pid)?;

    // Confirm rather than assume: a process can refuse to die, and reporting
    // success while the port is still held would send the command straight
    // back into the error it was started to avoid.
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if !is_taken(port) {
            return Ok(holder.name);
        }
    }
    Err(format!("{} did not release port {port}", holder.name))
}

fn kill_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c.creation_flags(0x0800_0000);
        let out = c.output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output()
            .map_err(|e: std::io::Error| e.to_string())?;
        Ok(())
    }
}

/// Who holds a port. A command this app started is identified exactly, by its
/// own bookkeeping; anything else is looked up in the OS tables so it can be
/// named and, if it is safe to, offered up for stopping.
pub fn conflict_for(port: u16, cmd: &str, mine: Option<PortUser>) -> PortConflict {
    let taken = is_taken(port);
    if !taken {
        return PortConflict { port, taken, ..Default::default() };
    }

    let process = if mine.is_none() { holder_process(port) } else { None };
    // Moving aside is usually the answer nobody has to think about: it takes
    // nothing away from whoever already has the port.
    let (suggested_port, suggested_cmd) = match free_near(port) {
        Some(free) => match with_port(cmd, free) {
            Some(line) => (free, line),
            None => (0, String::new()),
        },
        None => (0, String::new()),
    };

    PortConflict { port, taken, holder: mine, process, suggested_port, suggested_cmd }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_port_beats_every_guess() {
        assert_eq!(port_in_command("npm run dev -- --port 5174"), Some(5174));
        assert_eq!(port_in_command("vite --port=4001"), Some(4001));
        assert_eq!(port_in_command("next dev -p 3005"), Some(3005));
        assert_eq!(port_in_command("PORT=4200 npm start"), Some(4200));
    }

    #[test]
    fn a_privileged_or_nonsense_port_is_not_taken_as_one() {
        // `-p` on docker means something else entirely, and 80 is not ours.
        assert_eq!(port_in_command("docker run -p 80"), None);
        assert_eq!(port_in_command("npm run build"), None);
        assert_eq!(port_in_command("cargo test -- -p mycrate"), None);
    }

    #[test]
    fn compose_host_ports_are_read_not_container_ports() {
        let raw = r#"
services:
  web:
    image: nginx
    ports:
      - "8080:80"
      - 3000:3000
  db:
    image: postgres
    ports:
      - "127.0.0.1:5433:5432"
    environment:
      POSTGRES_PASSWORD: x
"#;
        let ports = ports_in_compose(raw);
        assert!(ports.contains(&8080), "host side of 8080:80");
        assert!(ports.contains(&3000));
        assert!(ports.contains(&5433), "host side of an addressed mapping");
        assert!(!ports.contains(&80), "80 is inside the container");
        assert!(!ports.contains(&5432));
    }

    #[test]
    fn the_ports_block_ends_where_the_next_key_begins() {
        let raw = "services:\n  web:\n    ports:\n      - 8080:80\n    image: nginx\n    expose:\n      - 9999\n";
        let ports = ports_in_compose(raw);

        assert!(ports.contains(&8080));
        assert!(!ports.contains(&9999), "expose: is a different key");
    }

    #[test]
    fn a_config_file_supplies_the_port_when_the_command_does_not() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("vite.config.ts"), "export default {\n  server: { port: 5174 },\n}\n").unwrap();

        assert_eq!(port_for("npm run dev", tmp.path(), &["package.json".into()]), Some(5174));
    }

    #[test]
    fn an_env_file_beats_the_framework_default() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".env"), "# comment\nPORT=4321\n").unwrap();

        assert_eq!(port_for("npm run dev", tmp.path(), &["package.json".into()]), Some(4321));
    }

    #[test]
    fn the_script_body_decides_the_default_not_the_script_name() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"dev":"vite","serve":"next dev","api":"uvicorn app:api"}}"#,
        )
        .unwrap();
        let manifests = vec!["package.json".to_string()];

        // Vite serves on 5173, not the generic 3000 a bare `dev` would suggest.
        assert_eq!(port_for("npm run dev", tmp.path(), &manifests), Some(5173));
        assert_eq!(port_for("npm run serve", tmp.path(), &manifests), Some(3000));
        assert_eq!(port_for("npm run api", tmp.path(), &manifests), Some(8000));
    }

    #[test]
    fn a_tool_that_merely_looks_like_a_server_is_not_one() {
        let tmp = tempfile::tempdir().unwrap();
        // `vitest` contains "vite" and is not a dev server; matching on
        // substrings got both of these wrong, and got them wrong quietly.
        assert_eq!(port_for("vitest", tmp.path(), &[]), None);
        assert_eq!(port_for("vitest run", tmp.path(), &[]), None);
        assert_eq!(port_for("vite build", tmp.path(), &[]), None);
        assert_eq!(port_for("next build", tmp.path(), &[]), None);
        // But the real ones still resolve, including through a bin path.
        assert_eq!(port_for("node_modules/.bin/vite", tmp.path(), &[]), Some(5173));
        assert_eq!(port_for("vite preview", tmp.path(), &[]), Some(4173));
    }

    #[test]
    fn a_port_inside_the_script_is_found() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"dev":"vite --port 4300"}}"#,
        )
        .unwrap();

        assert_eq!(
            port_for("npm run dev", tmp.path(), &["package.json".to_string()]),
            Some(4300),
            "the script's own --port is what the server will use",
        );
    }

    #[test]
    fn a_script_that_serves_nothing_still_has_no_port() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"lint":"eslint .","build":"vite build"}}"#,
        )
        .unwrap();
        let manifests = vec!["package.json".to_string()];

        assert_eq!(port_for("npm run lint", tmp.path(), &manifests), None);
        assert_eq!(port_for("npm run build", tmp.path(), &manifests), None, "a build does not listen");
    }

    #[test]
    fn a_framework_default_is_the_last_resort() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(port_for("npm run dev -- --host", tmp.path(), &["package.json".into()]), Some(3000));
        assert_eq!(port_for("vite", tmp.path(), &[]), Some(5173));
        assert_eq!(port_for("uvicorn app:api --reload", tmp.path(), &[]), Some(8000));
    }

    #[test]
    fn a_command_that_serves_nothing_has_no_port() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(port_for("cargo build --release", tmp.path(), &[]), None);
        assert_eq!(port_for("npm run lint", tmp.path(), &["package.json".into()]), None);
        assert_eq!(port_for("cargo test --all", tmp.path(), &[]), None);
    }

    /// Diagnostic, run by hand against a live dev server:
    /// `cargo test --lib probe_live_port -- --ignored --nocapture`
    #[test]
    #[ignore = "depends on what is running on this machine right now"]
    fn probe_live_port() {
        for port in [1420u16, 1421] {
            println!("port {port}: is_taken={} holder={:?}", is_taken(port), holder_process(port));
            println!("  listening_pid={:?}", listening_pid(port));
        }
    }

    /// Walks the real project exactly as the app does - scan it, take the
    /// command the user actually presses, and ask for its port with the same
    /// directory and manifests `check_port` would pass.
    #[test]
    fn the_real_npm_run_dev_of_this_project_resolves_to_a_port() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let project = crate::scan::measure(root, &crate::store::Settings::default())
            .expect("this repository must scan as a project");

        println!("parts:");
        for part in &project.parts {
            println!("  rel={:?} stack={} manifests={:?}", part.rel, part.stack, part.manifests);
        }
        println!("commands:");
        for c in &project.commands {
            println!("  name={:?} cmd={:?} cwd={:?}", c.name, c.cmd, c.cwd);
        }

        let dev = project
            .commands
            .iter()
            .find(|c| c.cmd == "npm run dev")
            .expect("`npm run dev` must be offered for this project");

        let dir = if dev.cwd.is_empty() { root.to_path_buf() } else { root.join(&dev.cwd) };
        let manifests = project
            .parts
            .iter()
            .find(|p| p.rel == dev.cwd)
            .map(|p| p.manifests.clone())
            .unwrap_or_else(|| project.manifests.clone());

        let port = port_for(&dev.cmd, &dir, &manifests);
        println!("cwd={:?} dir={} -> port={:?}", dev.cwd, dir.display(), port);

        assert_eq!(port, Some(1420), "the command the user presses must resolve to 1420");
    }

    /// This repository is its own fixture: a Vite config pinning 1420, and an
    /// `npm run dev` that has to be recognised as wanting that port.
    #[test]
    fn this_project_is_detected_as_wanting_1420() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        assert!(root.join("vite.config.ts").is_file(), "fixture moved: {}", root.display());

        let manifests = vec!["package.json".to_string()];
        for cmd in ["npm run dev", "npm run dev:vite"] {
            assert_eq!(
                port_for(cmd, root, &manifests),
                Some(1420),
                "`{cmd}` must be recognised as wanting the port vite.config.ts pins",
            );
        }
    }

    #[test]
    fn a_command_can_be_moved_to_another_port() {
        // npm needs the separator; the others forward arguments as they are.
        assert_eq!(with_port("npm run dev", 5174).unwrap(), "npm run dev -- --port 5174");
        assert_eq!(with_port("pnpm run dev", 5174).unwrap(), "pnpm run dev --port 5174");
        assert_eq!(with_port("vite", 5174).unwrap(), "vite --port 5174");
        assert_eq!(with_port("uvicorn app:api --reload", 8001).unwrap(), "uvicorn app:api --reload --port 8001");
        // Django takes a bare address.
        assert_eq!(
            with_port("python manage.py runserver", 8001).unwrap(),
            "python manage.py runserver 8001",
        );
    }

    #[test]
    fn an_existing_port_is_replaced_rather_than_doubled() {
        // Otherwise the line would carry two ports and the later one would win
        // by accident rather than by intent.
        assert_eq!(with_port("vite --port 5173", 5174).unwrap(), "vite --port 5174");
        assert_eq!(with_port("next dev -p 3000", 3001).unwrap(), "next dev -p 3001");
        assert_eq!(with_port("vite --port=5173", 5174).unwrap(), "vite --port=5174");
        assert_eq!(with_port("PORT=3000 npm start", 3001).unwrap(), "PORT=3001 npm start");

        assert_eq!(port_in_command(&with_port("npm run dev -- --port 5173", 5174).unwrap()), Some(5174));
    }

    #[test]
    fn php_carries_its_port_inside_the_address() {
        assert_eq!(
            with_port("php -S localhost:8000 -t public", 8001).unwrap(),
            "php -S localhost:8001 -t public",
        );
    }

    #[test]
    fn a_compose_stack_is_never_quietly_moved() {
        // The published ports are in the file; rewriting the command would be
        // claiming something that is not true.
        assert_eq!(with_port("docker compose up", 8081), None);
        assert_eq!(with_port("docker compose up -d db redis", 8081), None);
    }

    #[test]
    fn the_offered_port_is_next_door_and_actually_free() {
        // Held in a fixed range below Windows' dynamic start (49152). Searching
        // upward from an ephemeral port would land in the range the sibling
        // tests are binding, and the answer could be taken before it is used.
        let port = (45_200..45_300).find(|p| !is_taken(*p)).expect("a port to hold");
        let _held = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).unwrap();

        let free = free_near(port).expect("a free port near by");

        assert!(free > port, "the search goes upward from the wanted port");
        assert!(free <= port + 64);
        assert!(!is_taken(free), "the offered port has to actually be free");
    }

    #[test]
    fn a_free_port_has_nothing_to_suggest() {
        // A fixed range below Windows' dynamic start (49152), so the sibling
        // tests binding ephemeral ports in parallel cannot take it back between
        // the check and the call.
        let port = (45_000..45_100).find(|p| !is_taken(*p)).expect("a free port to test with");

        let conflict = conflict_for(port, "npm run dev", None);

        assert!(!conflict.taken);
        assert_eq!(conflict.suggested_port, 0, "nothing to move aside from");
        assert_eq!(conflict.suggested_cmd, "");
    }

    #[test]
    fn a_taken_port_comes_back_with_somewhere_to_go() {
        let held = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = held.local_addr().unwrap().port();

        let conflict = conflict_for(port, "npm run dev", None);

        assert!(conflict.taken);
        assert!(conflict.suggested_port > port);
        assert_eq!(
            conflict.suggested_cmd,
            format!("npm run dev -- --port {}", conflict.suggested_port),
        );
    }

    #[test]
    fn a_system_process_is_never_offered_up() {
        // The guard is a name test, so it is worth pinning the shape of it.
        for name in ["System", "svchost.exe", "LSASS.EXE", "explorer.exe", "systemd"] {
            let stem = name.to_lowercase();
            let stem = stem.strip_suffix(".exe").unwrap_or(&stem);
            assert!(NEVER_KILL.contains(&stem), "{name} must not be killable");
        }
        for name in ["node.exe", "cargo.exe", "python.exe", "Docker Desktop.exe"] {
            let stem = name.to_lowercase();
            let stem = stem.strip_suffix(".exe").unwrap_or(&stem);
            assert!(!NEVER_KILL.contains(&stem), "{name} is ordinary and may be stopped");
        }
    }

    #[test]
    fn the_process_holding_a_port_is_found_and_named() {
        // Bind a port in this very process, then ask the OS who has it. The
        // answer has to come back as us, which proves the table is being read
        // correctly on this platform rather than silently returning nothing.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        assert_eq!(
            listening_pid(port),
            Some(std::process::id()),
            "the listening pid for a port we hold must be our own",
        );
        // `holder_process` deliberately returns nothing for ourselves.
        assert!(holder_process(port).is_none());
    }

    #[test]
    fn freeing_a_port_nobody_holds_says_so() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        assert!(free(port).is_err(), "there is nothing to free");
    }

    /// The bug this whole feature failed on: Node resolves `localhost` to `::1`
    /// first, so a Vite dev server holds IPv6 loopback and nothing else. The
    /// check looked only at IPv4, found it free, and waved the command straight
    /// into `EADDRINUSE`.
    #[test]
    fn a_server_on_ipv6_loopback_alone_reads_as_taken() {
        let Ok(listener) = TcpListener::bind((Ipv6Addr::LOCALHOST, 0)) else {
            eprintln!("no IPv6 stack here; nothing to assert");
            return;
        };
        let port = listener.local_addr().unwrap().port();

        // The IPv4 addresses really are free - that is exactly why this was
        // missed - so a check that only looked there would say "not taken".
        assert!(
            TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok(),
            "fixture is only meaningful while IPv4 is free",
        );

        assert!(is_taken(port), "a server on ::1 alone must still count as holding the port");
        assert_eq!(listening_pid(port), Some(std::process::id()), "and must be findable");
    }

    #[test]
    fn a_port_we_are_holding_reads_as_taken() {
        // Bind one, then ask - the answer must be the one the next process gets.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        assert!(is_taken(port), "a bound port must read as taken");
        drop(listener);
        assert!(!is_taken(port), "and free again once released");
    }
}
