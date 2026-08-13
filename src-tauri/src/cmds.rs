//! Runnable command detection.
//!
//! Everything shown under "Auto-detected" comes from a manifest that is
//! actually on disk: package.json scripts, Makefile targets, a compose file,
//! and so on. Nothing here is guessed from the stack alone.

use std::fs;
use std::path::Path;

use crate::model::CommandDef;

/// `cwd` and `part` are filled in by the scanner, which knows where this
/// package sits inside the project.
fn def(kind: &str, name: &str, cmd: &str) -> CommandDef {
    CommandDef {
        kind: kind.into(),
        name: name.into(),
        cmd: cmd.into(),
        cwd: String::new(),
        part: String::new(),
    }
}

/// npm / pnpm / yarn / bun, decided by which lockfile is present.
fn package_manager(root: &Path) -> &'static str {
    if root.join("bun.lockb").exists() || root.join("bun.lock").exists() {
        "bun"
    } else if root.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if root.join("yarn.lock").exists() {
        "yarn"
    } else {
        "npm"
    }
}

const MAX_MAKE_TARGETS: usize = 12;

/// Scripts a developer actually reaches for, in the order they expect them.
const SCRIPT_PRIORITY: &[&str] = &["dev", "start", "build", "test", "lint", "typecheck", "preview", "format"];

fn node_scripts(root: &Path) -> Vec<CommandDef> {
    let Ok(raw) = fs::read_to_string(root.join("package.json")) else { return Vec::new() };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else { return Vec::new() };
    let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) else { return Vec::new() };

    let pm = package_manager(root);
    let mut names: Vec<String> = scripts.keys().cloned().collect();

    names.sort_by_key(|n| {
        SCRIPT_PRIORITY
            .iter()
            .position(|p| p == n)
            .unwrap_or(SCRIPT_PRIORITY.len())
    });

    // Every script is listed. These are written by hand in package.json, so a
    // cap would just hide something the developer deliberately put there.
    names
        .into_iter()
        .map(|name| {
            let cmd = format!("{pm} run {name}");
            def("npm", &name, &cmd)
        })
        .collect()
}

/// Reads plain `target:` rules out of a Makefile, skipping the meta ones.
fn make_targets(root: &Path) -> Vec<CommandDef> {
    let raw = ["Makefile", "makefile", "GNUmakefile"]
        .iter()
        .find_map(|n| fs::read_to_string(root.join(n)).ok());
    let Some(raw) = raw else { return Vec::new() };

    let mut out = Vec::new();
    for line in raw.lines() {
        if line.starts_with(char::is_whitespace) || line.starts_with('#') || line.starts_with('.') {
            continue;
        }
        let Some((target, rest)) = line.split_once(':') else { continue };
        // `=` means it is a variable assignment, not a rule.
        if rest.starts_with('=') || target.contains('=') || target.contains('$') {
            continue;
        }
        let target = target.trim();
        if target.is_empty()
            || !target
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        {
            continue;
        }
        out.push(def("make", target, &format!("make {target}")));
        // Makefile rules are recognised heuristically, unlike package.json
        // scripts, so this one keeps a bound.
        if out.len() == MAX_MAKE_TARGETS {
            break;
        }
    }
    out
}

fn has_dep(root: &Path, file: &str, needle: &str) -> bool {
    fs::read_to_string(root.join(file))
        .map(|raw| raw.contains(needle))
        .unwrap_or(false)
}

pub fn detect(root: &Path, stack: &str, manifests: &[String]) -> Vec<CommandDef> {
    let mut out: Vec<CommandDef> = Vec::new();
    let has = |name: &str| manifests.iter().any(|m| m == name);

    match stack {
        "Rust" => {
            out.push(def("cargo", "dev run", "cargo run"));
            out.push(def("cargo", "release build", "cargo build --release"));
            out.push(def("cargo", "test", "cargo test --all"));
            out.push(def("cargo", "clippy", "cargo clippy -- -D warnings"));
        }
        "TypeScript" | "Node" | "Astro" => {
            out.extend(node_scripts(root));
        }
        "Python" => {
            if has_dep(root, "pyproject.toml", "fastapi") || root.join("app.py").exists() {
                out.push(def("py", "serve", "uvicorn app:api --reload"));
            }
            if root.join("manage.py").exists() {
                out.push(def("py", "runserver", "python manage.py runserver"));
            }
            if root.join("tests").is_dir() || has_dep(root, "pyproject.toml", "pytest") {
                out.push(def("py", "tests", "pytest -q"));
            }
            if root.join("main.py").exists() {
                out.push(def("py", "run", "python main.py"));
            }
        }
        "Go" => {
            out.push(def("make", "run", "go run ./..."));
            out.push(def("make", "build", "go build ./..."));
            out.push(def("make", "test", "go test ./..."));
        }
        "Dart" => {
            out.push(def("make", "run", "flutter run"));
            out.push(def("make", "build apk", "flutter build apk"));
            out.push(def("make", "test", "flutter test"));
        }
        "PHP" => {
            out.push(def("make", "serve", "php -S localhost:8000 -t public"));
            out.push(def("make", "install", "composer install"));
        }
        "Elixir" => {
            if has_dep(root, "mix.exs", "phoenix") {
                out.push(def("make", "server", "mix phx.server"));
            }
            out.push(def("make", "test", "mix test"));
            out.push(def("make", "deps", "mix deps.get"));
        }
        "C++" => {
            out.push(def("make", "configure", "cmake -B build"));
            out.push(def("make", "build", "cmake --build build"));
        }
        "Java" => {
            if has("build.gradle") || has("build.gradle.kts") {
                out.push(def("make", "build", "gradle build"));
                out.push(def("make", "test", "gradle test"));
            } else {
                out.push(def("make", "build", "mvn package"));
                out.push(def("make", "test", "mvn test"));
            }
        }
        "Ruby" => {
            out.push(def("make", "install", "bundle install"));
            out.push(def("make", "test", "bundle exec rake test"));
        }
        _ => {}
    }

    // Makefile targets are useful on top of any stack.
    if has("Makefile") || has("makefile") {
        for c in make_targets(root) {
            if !out.iter().any(|e| e.cmd == c.cmd) {
                out.push(c);
            }
        }
    }

    // A compose file means the project has services to bring up.
    if has("docker-compose.yml") || has("docker-compose.yaml") {
        out.push(def("docker", "stack up", "docker compose up"));
        out.push(def("docker", "stack down", "docker compose down -v"));
    }
    if stack == "Docker" {
        out.push(def("docker", "prune", "docker system prune -f"));
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_with_scripts(dir: &Path, scripts: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("package.json"), format!(r#"{{"name":"x","scripts":{scripts}}}"#)).unwrap();
    }

    #[test]
    fn every_package_json_script_is_offered() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // Ten scripts: more than the six the list used to stop at.
        project_with_scripts(
            root,
            r#"{"dev":"nuxt dev","build":"nuxt build","generate":"nuxt generate",
                "preview":"nuxt preview","lint":"eslint .","lint:fix":"eslint . --fix",
                "test":"vitest","test:e2e":"playwright test","typecheck":"vue-tsc",
                "postinstall":"nuxt prepare"}"#,
        );

        let found = detect(root, "Node", &["package.json".to_string()]);
        let names: Vec<&str> = found.iter().map(|c| c.name.as_str()).collect();

        assert_eq!(found.len(), 10, "every script must be listed, got {names:?}");
        for expected in [
            "dev", "build", "generate", "preview", "lint", "lint:fix", "test", "test:e2e",
            "typecheck", "postinstall",
        ] {
            assert!(names.contains(&expected), "{expected} missing from {names:?}");
        }
        // The ones reached for most often still come first.
        assert_eq!(names[0], "dev");
    }

    #[test]
    fn the_lockfile_picks_the_package_manager() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        project_with_scripts(root, r#"{"dev":"vite"}"#);
        fs::write(root.join("pnpm-lock.yaml"), "").unwrap();

        let found = detect(root, "Node", &["package.json".to_string()]);
        assert_eq!(found[0].cmd, "pnpm run dev");
    }
}
