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

use crate::model::{PortConflict, PortUser};

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

/// Who holds a port, as far as we can tell without elevated privileges.
///
/// A command this app started is identified exactly, by its own bookkeeping.
/// Anything else is reported as an unknown holder rather than guessed at: the
/// PID behind a socket is not readable for another user's process, and a wrong
/// name here would be worse than none.
pub fn conflict_for(
    port: u16,
    mine: Option<PortUser>,
) -> PortConflict {
    PortConflict { port, taken: is_taken(port), holder: mine }
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
    fn a_port_we_are_holding_reads_as_taken() {
        // Bind one, then ask - the answer must be the one the next process gets.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        assert!(is_taken(port), "a bound port must read as taken");
        drop(listener);
        assert!(!is_taken(port), "and free again once released");
    }
}
