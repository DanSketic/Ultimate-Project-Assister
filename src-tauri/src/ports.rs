//! Which port a command wants, and who already has it.
//!
//! Half a dozen projects on one machine all default to 3000 or 5173, so the
//! second `npm run dev` of the day dies with `EADDRINUSE` several seconds after
//! it looked like it started. This module reads the port a command is going to
//! ask for out of the project's own files, and checks whether anything is
//! already listening before the process is spawned.

use std::collections::BTreeSet;
use std::fs;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::Path;
use std::process::Command;

use crate::model::{PortConflict, PortProcess, PortUser};

/// Ports below this are system services nothing here would start.
const MIN_PORT: u16 = 1024;

/// Default a framework listens on when nothing says otherwise. Only consulted
/// when the project declares no port of its own.
fn default_port(cmd: &str, manifests: &[String]) -> Option<u16> {
    let has = |m: &str| manifests.iter().any(|x| x == m);

    // Ordered most specific first: `next dev` is also an npm script.
    for (needle, port) in [
        ("vite", 5173u16),
        ("nuxt", 3000),
        ("next", 3000),
        ("astro", 4321),
        ("remix", 3000),
        ("ng serve", 4200),
        ("react-scripts", 3000),
        ("storybook", 6006),
        ("uvicorn", 8000),
        ("manage.py runserver", 8000),
        ("flask", 5000),
        ("rails", 3000),
        ("php -s", 8000),
        ("mix phx.server", 4000),
    ] {
        if cmd.contains(needle) {
            return Some(port);
        }
    }

    // A bare `dev`/`start` script on a Node project: 3000 is the convention.
    if (cmd.contains(" run dev") || cmd.contains(" run start")) && has("package.json") {
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
        .or_else(|| default_port(cmd, manifests))
}

/// Whether anything is listening on a TCP port.
///
/// Decided by trying to bind it, which is exactly the question the command
/// about to start will ask - no parsing of `netstat` output, and no false
/// negative from a listener the current user cannot see.
pub fn is_taken(port: u16) -> bool {
    // Both, because a server bound to 127.0.0.1 does not block 0.0.0.0 on
    // Windows and the reverse is true elsewhere.
    for addr in [Ipv4Addr::UNSPECIFIED, Ipv4Addr::LOCALHOST] {
        match TcpListener::bind(SocketAddrV4::new(addr, port)) {
            Ok(listener) => drop(listener),
            Err(_) => return true,
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
const NEVER_KILL: &[&str] = &[
    "system", "idle", "smss", "csrss", "wininit", "winlogon", "services", "lsass",
    "svchost", "explorer", "dwm", "fontdrvhost", "sihost", "runtimebroker",
    "systemd", "init", "launchd", "kernel_task", "windowserver", "loginwindow",
];

/// The PID listening on a TCP port, from the operating system's own tables.
#[cfg(windows)]
fn listening_pid(port: u16) -> Option<u32> {
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new("netstat");
    cmd.args(["-ano", "-p", "TCP"]);
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);

    let needle = format!(":{port}");
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        // Proto, local address, foreign address, [state], pid. The state word
        // is translated on a localised Windows, so it is never matched on -
        // only the local address and the trailing pid are read.
        if fields.len() < 4 {
            continue;
        }
        if !fields[1].ends_with(&needle) {
            continue;
        }
        if let Ok(pid) = fields[fields.len() - 1].parse::<u32>() {
            if pid > 4 {
                return Some(pid);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn listening_pid(port: u16) -> Option<u32> {
    let out = Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).lines().next()?.trim().parse().ok()
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
        let held = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = held.local_addr().unwrap().port();

        let free = free_near(port).expect("a free port near by");
        assert!(free > port, "the search goes upward from the wanted port");
        assert!(free <= port + 64);
        assert!(!is_taken(free));
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
