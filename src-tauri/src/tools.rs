//! What a project needs installed, and whether this machine has it.
//!
//! `npm run dev` fails with a confusing error when Node is simply absent, and
//! that is the most common reason a freshly cloned project will not start. This
//! module reads the requirement off the manifests already found by the scanner,
//! checks PATH, and - where the tool is packaged - offers the install command.
//!
//! Presence is decided by a PATH lookup rather than by running anything: it is
//! immediate, and a machine with twenty projects would otherwise spawn a
//! process per tool per project just to draw a card.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::model::{Project, ToolStatus};

struct Spec {
    id: &'static str,
    name: &'static str,
    /// Executable looked for on PATH.
    bin: &'static str,
    /// Arguments that make it print its version. Empty means "do not ask":
    /// `flutter --version` boots a whole SDK and takes seconds, and knowing it
    /// is installed is the part that matters here.
    version_args: &'static [&'static str],
    docs: &'static str,
}

const SPECS: &[Spec] = &[
    Spec { id: "node", name: "Node.js", bin: "node", version_args: &["--version"], docs: "https://nodejs.org" },
    Spec { id: "npm", name: "npm", bin: "npm", version_args: &["--version"], docs: "https://docs.npmjs.com" },
    Spec { id: "pnpm", name: "pnpm", bin: "pnpm", version_args: &["--version"], docs: "https://pnpm.io" },
    Spec { id: "yarn", name: "Yarn", bin: "yarn", version_args: &["--version"], docs: "https://yarnpkg.com" },
    Spec { id: "bun", name: "Bun", bin: "bun", version_args: &["--version"], docs: "https://bun.sh" },
    Spec { id: "cargo", name: "Rust (cargo)", bin: "cargo", version_args: &["--version"], docs: "https://rustup.rs" },
    Spec { id: "python", name: "Python", bin: "python", version_args: &["--version"], docs: "https://python.org" },
    Spec { id: "go", name: "Go", bin: "go", version_args: &["version"], docs: "https://go.dev/dl" },
    Spec { id: "docker", name: "Docker", bin: "docker", version_args: &["--version"], docs: "https://docs.docker.com/get-docker" },
    Spec { id: "git", name: "Git", bin: "git", version_args: &["--version"], docs: "https://git-scm.com" },
    Spec { id: "make", name: "GNU Make", bin: "make", version_args: &["--version"], docs: "https://www.gnu.org/software/make" },
    Spec { id: "cmake", name: "CMake", bin: "cmake", version_args: &["--version"], docs: "https://cmake.org" },
    // Booting the Flutter tool to ask its version is slow enough to be felt.
    Spec { id: "flutter", name: "Flutter", bin: "flutter", version_args: &[], docs: "https://docs.flutter.dev/get-started/install" },
    Spec { id: "php", name: "PHP", bin: "php", version_args: &["--version"], docs: "https://www.php.net/downloads" },
    Spec { id: "composer", name: "Composer", bin: "composer", version_args: &["--version"], docs: "https://getcomposer.org/download" },
    Spec { id: "elixir", name: "Elixir", bin: "elixir", version_args: &["--version"], docs: "https://elixir-lang.org/install.html" },
    Spec { id: "ruby", name: "Ruby", bin: "ruby", version_args: &["--version"], docs: "https://www.ruby-lang.org/en/downloads" },
    Spec { id: "java", name: "Java (JDK)", bin: "java", version_args: &["-version"], docs: "https://adoptium.net" },
    Spec { id: "gradle", name: "Gradle", bin: "gradle", version_args: &["--version"], docs: "https://gradle.org/install" },
    Spec { id: "maven", name: "Maven", bin: "mvn", version_args: &["--version"], docs: "https://maven.apache.org/install.html" },
    Spec { id: "dotnet", name: ".NET SDK", bin: "dotnet", version_args: &["--version"], docs: "https://dotnet.microsoft.com/download" },
];

fn spec(id: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.id == id)
}

// ---------------------------------------------------------------------------
// Install commands
// ---------------------------------------------------------------------------

/// The install command for a tool, or empty when there is no packaged one.
///
/// Every winget id below was checked against the public repository. Composer,
/// Elixir, Gradle and Maven are not packaged there at all, so they get no
/// command - offering the documentation is honest, where a command that fails
/// would just waste the user's time.
#[cfg(windows)]
pub fn install_command(id: &str) -> String {
    let pkg = match id {
        "node" | "npm" => "OpenJS.NodeJS.LTS",
        "bun" => "Oven-sh.Bun",
        "cargo" => "Rustlang.Rustup",
        "python" => "Python.Python.3.12",
        "go" => "GoLang.Go",
        "docker" => "Docker.DockerDesktop",
        "git" => "Git.Git",
        "make" => "GnuWin32.Make",
        "cmake" => "Kitware.CMake",
        "php" => "PHP.PHP.8.3",
        "ruby" => "RubyInstallerTeam.RubyWithDevKit.3.3",
        "java" => "EclipseAdoptium.Temurin.21.JDK",
        "dotnet" => "Microsoft.DotNet.SDK.8",
        _ => "",
    };
    if !pkg.is_empty() {
        return format!("winget install --exact --id {pkg} --accept-package-agreements --accept-source-agreements");
    }
    // These ship as npm packages, so they need Node rather than a system
    // installer. The card lists Node as a requirement of its own.
    match id {
        "pnpm" => "npm install --global pnpm".into(),
        "yarn" => "npm install --global yarn".into(),
        _ => String::new(),
    }
}

#[cfg(target_os = "macos")]
pub fn install_command(id: &str) -> String {
    let formula = match id {
        "node" | "npm" => "node",
        "bun" => "oven-sh/bun/bun",
        "cargo" => "rustup",
        "python" => "python",
        "go" => "go",
        "docker" => "--cask docker",
        "git" => "git",
        "make" => "make",
        "cmake" => "cmake",
        "php" => "php",
        "composer" => "composer",
        "elixir" => "elixir",
        "ruby" => "ruby",
        "java" => "openjdk",
        "gradle" => "gradle",
        "maven" => "maven",
        "dotnet" => "--cask dotnet-sdk",
        "flutter" => "--cask flutter",
        _ => "",
    };
    if formula.is_empty() {
        return match id {
            "pnpm" => "npm install --global pnpm".into(),
            "yarn" => "npm install --global yarn".into(),
            _ => String::new(),
        };
    }
    format!("brew install {formula}")
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn install_command(id: &str) -> String {
    // Distributions differ too much for a single command to be trustworthy, so
    // only the two that are genuinely package-manager independent are offered.
    match id {
        "pnpm" => "npm install --global pnpm".into(),
        "yarn" => "npm install --global yarn".into(),
        _ => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

/// Looks an executable up on PATH, without spawning anything.
pub fn which(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for candidate in candidates(&dir, bin) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn candidates(dir: &Path, bin: &str) -> Vec<PathBuf> {
    // Node's package managers land as `.cmd` shims, so the extension list
    // matters as much as the directory list.
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    exts.split(';')
        .filter(|e| !e.is_empty())
        .map(|e| dir.join(format!("{bin}{}", e.to_ascii_lowercase())))
        .collect()
}

#[cfg(unix)]
fn candidates(dir: &Path, bin: &str) -> Vec<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let file = dir.join(bin);
    let executable = file
        .metadata()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false);
    if executable { vec![file] } else { Vec::new() }
}

/// Pulls `1.22.5` out of `go version go1.22.5 windows/amd64`, `22.3.0` out of
/// `v22.3.0`, and so on. Anything without a dotted number yields nothing rather
/// than a guess.
pub fn first_version(text: &str) -> String {
    let bytes: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == '.') {
            i += 1;
        }
        let run: String = bytes[start..i].iter().collect();
        let run = run.trim_end_matches('.');
        // A bare integer is a build number or a year, not a version.
        if run.contains('.') {
            return run.to_string();
        }
    }
    String::new()
}

fn probe_version(bin: &str, args: &[&str]) -> String {
    if args.is_empty() {
        return String::new();
    }
    let mut cmd = Command::new(bin);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let Ok(out) = cmd.output() else { return String::new() };
    // `java -version` writes to stderr, and it is not alone in that.
    let text = if out.stdout.is_empty() {
        String::from_utf8_lossy(&out.stderr).to_string()
    } else {
        String::from_utf8_lossy(&out.stdout).to_string()
    };
    first_version(&text)
}

/// Checks one tool. `required_by` is filled in by the caller.
pub fn check(id: &str) -> Option<ToolStatus> {
    let spec = spec(id)?;
    let found = which(spec.bin);

    Some(ToolStatus {
        id: spec.id.into(),
        name: spec.name.into(),
        version: found.as_ref().map(|_| probe_version(spec.bin, spec.version_args)).unwrap_or_default(),
        path: found.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        found: found.is_some(),
        required_by: Vec::new(),
        install: install_command(spec.id),
        docs: spec.docs.into(),
    })
}

// ---------------------------------------------------------------------------
// What a project asks for
// ---------------------------------------------------------------------------

/// The package manager a Node package uses, decided by its lockfile - the same
/// rule the command detector applies, so the two never disagree.
fn package_manager(dir: &Path) -> &'static str {
    if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else {
        "npm"
    }
}

/// Maps a manifest to the tools it implies. Returned as ids so the caller can
/// gather the manifests that each tool was asked for by.
fn tools_for_manifest(manifest: &str) -> &'static [&'static str] {
    match manifest {
        "Cargo.toml" => &["cargo"],
        "pyproject.toml" | "requirements.txt" | "setup.py" => &["python"],
        "go.mod" => &["go"],
        "pubspec.yaml" => &["flutter"],
        "composer.json" => &["php", "composer"],
        "mix.exs" => &["elixir"],
        "CMakeLists.txt" => &["cmake"],
        "docker-compose.yml" | "docker-compose.yaml" | "Dockerfile" => &["docker"],
        "Gemfile" => &["ruby"],
        "build.gradle" | "build.gradle.kts" => &["java", "gradle"],
        "pom.xml" => &["java", "maven"],
        "Makefile" | "makefile" => &["make"],
        _ => &[],
    }
}

/// Everything the project needs, checked, with the missing ones first.
pub fn requirements(project: &Project) -> Vec<ToolStatus> {
    // Ordered map so the result is stable between calls; the value is the set
    // of manifests that asked for the tool.
    let mut wanted: BTreeMap<&'static str, Vec<String>> = BTreeMap::new();
    let mut want = |id: &'static str, why: String| {
        let reasons = wanted.entry(id).or_default();
        if !reasons.contains(&why) {
            reasons.push(why);
        }
    };

    for part in &project.parts {
        let label = |m: &str| {
            if part.rel.is_empty() { m.to_string() } else { format!("{}/{m}", part.rel) }
        };

        for manifest in &part.manifests {
            if manifest == "package.json" {
                want("node", label(manifest));
                let pm = package_manager(Path::new(&part.path));
                want(pm, label(manifest));
                continue;
            }
            for id in tools_for_manifest(manifest) {
                want(id, label(manifest));
            }
        }

        // A Dockerfile is not in the manifest list - it declares no project of
        // its own - but it still means the project expects Docker.
        if Path::new(&part.path).join("Dockerfile").exists() {
            want("docker", label("Dockerfile"));
        }
    }

    if project.git.is_repo {
        want("git", ".git".into());
    }

    let mut out: Vec<ToolStatus> = wanted
        .into_iter()
        .filter_map(|(id, why)| {
            let mut status = check(id)?;
            status.required_by = why;
            Some(status)
        })
        .collect();

    // Missing first: those are the ones with something to do about them.
    out.sort_by(|a, b| a.found.cmp(&b.found).then_with(|| a.name.cmp(&b.name)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ProjectPart;

    #[test]
    fn a_version_is_pulled_out_of_whatever_the_tool_prints() {
        assert_eq!(first_version("v22.3.0"), "22.3.0");
        assert_eq!(first_version("go version go1.22.5 windows/amd64"), "1.22.5");
        assert_eq!(first_version("Docker version 27.1.1, build 6312585"), "27.1.1");
        assert_eq!(first_version("cargo 1.79.0 (ffa9cf99a 2024-06-03)"), "1.79.0");
        assert_eq!(first_version("Python 3.12.4"), "3.12.4");
        assert_eq!(first_version("git version 2.45.1.windows.1"), "2.45.1");
        assert_eq!(first_version("openjdk version \"21.0.3\" 2024-04-16"), "21.0.3");
    }

    #[test]
    fn a_bare_number_is_not_a_version() {
        // Otherwise a build number or a year would be reported as one.
        assert_eq!(first_version("build 6312585"), "");
        assert_eq!(first_version("no version here"), "");
    }

    fn part(rel: &str, path: &Path, manifests: &[&str]) -> ProjectPart {
        ProjectPart {
            name: rel.to_string(),
            rel: rel.to_string(),
            path: path.to_string_lossy().to_string(),
            stack: String::new(),
            manifests: manifests.iter().map(|m| m.to_string()).collect(),
            size_bytes: 0,
            reclaim_bytes: 0,
            source_bytes: 0,
        }
    }

    fn project_with(parts: Vec<ProjectPart>) -> Project {
        Project { parts, ..Default::default() }
    }

    #[test]
    fn a_node_package_asks_for_node_and_its_own_package_manager() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("pnpm-lock.yaml"), "").unwrap();

        let found = requirements(&project_with(vec![part("", tmp.path(), &["package.json"])]));
        let ids: Vec<&str> = found.iter().map(|t| t.id.as_str()).collect();

        assert!(ids.contains(&"node"));
        assert!(ids.contains(&"pnpm"), "the lockfile decides, got {ids:?}");
        assert!(!ids.contains(&"npm"));
    }

    #[test]
    fn each_package_of_a_monorepo_contributes_its_own_tools() {
        let tmp = tempfile::tempdir().unwrap();
        let web = tmp.path().join("frontend");
        let api = tmp.path().join("backend");
        std::fs::create_dir_all(&web).unwrap();
        std::fs::create_dir_all(&api).unwrap();

        let found = requirements(&project_with(vec![
            part("frontend", &web, &["package.json"]),
            part("backend", &api, &["Cargo.toml", "docker-compose.yml"]),
        ]));
        let by_id = |id: &str| found.iter().find(|t| t.id == id);

        assert!(by_id("node").is_some());
        assert!(by_id("cargo").is_some());
        // The reason names the package, so a monorepo says which half needs it.
        assert_eq!(by_id("cargo").unwrap().required_by, ["backend/Cargo.toml"]);
        assert_eq!(by_id("node").unwrap().required_by, ["frontend/package.json"]);
        assert_eq!(by_id("docker").unwrap().required_by, ["backend/docker-compose.yml"]);
    }

    #[test]
    fn a_dockerfile_counts_even_though_it_declares_no_project() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("Dockerfile"), "FROM scratch\n").unwrap();

        let found = requirements(&project_with(vec![part("", tmp.path(), &["Cargo.toml"])]));

        let docker = found.iter().find(|t| t.id == "docker").expect("Dockerfile implies Docker");
        assert_eq!(docker.required_by, ["Dockerfile"]);
    }

    #[test]
    fn a_tool_that_is_present_reports_where_it_came_from() {
        // Cargo is running this test, so it is certainly installed.
        let cargo = check("cargo").unwrap();

        assert!(cargo.found);
        assert!(!cargo.path.is_empty());
        assert!(!cargo.version.is_empty(), "a found tool should report a version");
    }

    #[test]
    fn an_unpackaged_tool_offers_documentation_rather_than_a_broken_command() {
        // Verified against the winget repository: these are simply not there.
        for id in ["composer", "elixir", "gradle", "maven"] {
            let tool = check(id).unwrap();
            #[cfg(windows)]
            assert!(tool.install.is_empty(), "{id} must not offer a command that would fail");
            assert!(tool.docs.starts_with("https://"), "{id} needs somewhere to point");
        }
    }

    #[test]
    fn every_tool_a_manifest_can_ask_for_is_a_tool_we_know() {
        let manifests = [
            "Cargo.toml", "pyproject.toml", "requirements.txt", "setup.py", "go.mod",
            "pubspec.yaml", "composer.json", "mix.exs", "CMakeLists.txt", "docker-compose.yml",
            "docker-compose.yaml", "Dockerfile", "Gemfile", "build.gradle", "build.gradle.kts",
            "pom.xml", "Makefile", "makefile",
        ];
        for manifest in manifests {
            for id in tools_for_manifest(manifest) {
                assert!(spec(id).is_some(), "{manifest} asks for unknown tool {id}");
            }
        }
        // And the package-manager branch, which does not go through the map.
        for id in ["node", "npm", "pnpm", "yarn", "bun"] {
            assert!(spec(id).is_some(), "unknown package manager {id}");
        }
    }
}
