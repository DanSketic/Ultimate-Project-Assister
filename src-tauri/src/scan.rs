//! Project discovery and measurement.
//!
//! A scan happens in three stages:
//!   1. `discover` walks the watched folders looking for manifest files and
//!      stops descending as soon as a directory looks like a project root.
//!   2. `measure` walks each project exactly once, attributing every byte
//!      either to a cleanable bucket (`target/debug`, `node_modules`, ...) or
//!      to the source tree, where it also feeds language stats and line counts.
//!   3. `git::inspect` reads branch, dirty state, tags and history.
//!
//! Stage 2 and 3 run in parallel across projects via rayon.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use walkdir::WalkDir;

use crate::cmds;
use crate::git;
use crate::model::{CleanTarget, CommandDef, LangShare, Project, ProjectPart};
use crate::store::Settings;

/// How deep below a watched folder we look for project roots.
const MAX_DEPTH: usize = 4;
/// Files above this size are measured but never read for line counts.
const MAX_LOC_FILE: u64 = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const MANIFEST_FILES: &[&str] = &[
    "Cargo.toml",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "go.mod",
    "pubspec.yaml",
    "composer.json",
    "mix.exs",
    "CMakeLists.txt",
    "docker-compose.yml",
    "docker-compose.yaml",
    "kustomization.yaml",
    "Gemfile",
    "build.gradle",
    "build.gradle.kts",
    "pom.xml",
    "Makefile",
    "makefile",
];

/// Directories never descended into while looking for projects, and never
/// counted towards language statistics.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "env",
    // Elixir and Erlang keep whole dependency projects here, each with its own
    // manifest - descending would list every dependency as a project.
    "deps",
    "dist",
    "build",
    "_build",
    ".next",
    ".nuxt",
    ".turbo",
    ".astro",
    ".svelte-kit",
    ".parcel-cache",
    ".vite",
    "vendor",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".dart_tool",
    ".gradle",
    "obj",
    "coverage",
    ".cache",
    ".idea",
    ".tox",
    ".terraform",
    "Pods",
    "DerivedData",
];

fn is_skipped_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

fn is_manifest(name: &str) -> bool {
    MANIFEST_FILES.contains(&name)
}

/// How deep below a project root workspace members are looked for.
const MAX_MEMBER_DEPTH: usize = 3;

/// Files that declare "this directory owns the packages below it".
const WORKSPACE_MARKERS: &[&str] = &[
    "pnpm-workspace.yaml",
    "go.work",
    "lerna.json",
    "nx.json",
    "turbo.json",
    "rush.json",
];

/// What a single directory listing tells us about that directory.
struct Listing {
    subdirs: Vec<PathBuf>,
    files: Vec<String>,
    has_git: bool,
}

fn list(dir: &Path) -> Option<Listing> {
    let entries = fs::read_dir(dir).ok()?;
    let mut listing = Listing { subdirs: Vec::new(), files: Vec::new(), has_git: false };

    for entry in entries.flatten() {
        // `file_type` reports symlinks as symlinks, so linked directories are
        // skipped here - that keeps the walk free of cycles.
        let Ok(ft) = entry.file_type() else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if ft.is_dir() {
            if name == ".git" {
                listing.has_git = true;
            } else if !is_skipped_dir(&name) {
                listing.subdirs.push(entry.path());
            }
        } else if ft.is_file() {
            // A `.git` *file* is how git marks a worktree or submodule.
            if name == ".git" {
                listing.has_git = true;
            }
            listing.files.push(name);
        }
    }

    Some(listing)
}

/// A repository root is a project even with no manifest of its own - that is
/// the `frontend/` + `backend/` layout, where nothing sits at the top.
fn is_project_root(listing: &Listing) -> bool {
    listing.has_git
        || listing.files.iter().any(|f| is_manifest(f))
        || listing.files.iter().any(|f| WORKSPACE_MARKERS.contains(&f.as_str()))
}

/// Recursively finds project roots below `root`, pruning at each project.
fn discover_into(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Some(listing) = list(root) else { return };

    if is_project_root(&listing) {
        out.push(root.to_path_buf());
        return;
    }

    if depth < MAX_DEPTH {
        for dir in listing.subdirs {
            discover_into(&dir, depth + 1, out);
        }
    }
}

/// Collects the packages inside an already-identified project root.
///
/// Returns paths relative to `root`, deepest-last. A nested directory that is
/// its own repository is left alone: a submodule or a checked-out sibling repo
/// belongs to itself, not to this project.
fn members_of(root: &Path, depth: usize, rel: &Path, out: &mut Vec<PathBuf>) {
    if depth > MAX_MEMBER_DEPTH {
        return;
    }
    let Some(listing) = list(&root.join(rel)) else { return };

    for dir in listing.subdirs {
        let Ok(child_rel) = dir.strip_prefix(root) else { continue };
        let Some(child) = list(&dir) else { continue };

        if child.has_git {
            continue;
        }
        if child.files.iter().any(|f| is_manifest(f)) {
            out.push(child_rel.to_path_buf());
            // A member can still contain deeper packages (apps/web inside apps).
        }
        members_of(root, depth + 1, child_rel, out);
    }
}

pub fn discover(roots: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in roots {
        let path = PathBuf::from(root);
        if path.is_dir() {
            discover_into(&path, 0, &mut out);
        }
    }
    out.sort();
    out.dedup();
    out
}

// ---------------------------------------------------------------------------
// Stack detection
// ---------------------------------------------------------------------------

/// The manifest file names found directly inside a project root.
struct Manifests {
    names: Vec<String>,
    root: PathBuf,
}

impl Manifests {
    fn read(root: &Path) -> Self {
        let mut names = Vec::new();
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                if entry.file_type().map(|f| f.is_file()).unwrap_or(false) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if is_manifest(&name) || name == "tsconfig.json" {
                        names.push(name);
                    }
                }
            }
        }
        names.sort();
        Self { names, root: root.to_path_buf() }
    }

    fn has(&self, name: &str) -> bool {
        self.names.iter().any(|n| n == name)
    }

    fn text(&self, name: &str) -> Option<String> {
        fs::read_to_string(self.root.join(name)).ok()
    }
}

/// Resolves the display label shown in the Stack column.
fn detect_stack(m: &Manifests) -> String {
    if m.has("Cargo.toml") {
        return "Rust".into();
    }
    if m.has("pubspec.yaml") {
        return "Dart".into();
    }
    if m.has("go.mod") {
        return "Go".into();
    }
    if m.has("mix.exs") {
        return "Elixir".into();
    }
    if m.has("composer.json") {
        return "PHP".into();
    }
    if m.has("package.json") {
        let pkg = m.text("package.json").unwrap_or_default();
        let json: serde_json::Value = serde_json::from_str(&pkg).unwrap_or(serde_json::Value::Null);
        let has_dep = |name: &str| {
            ["dependencies", "devDependencies"].iter().any(|section| {
                json.get(section).and_then(|d| d.get(name)).is_some()
            })
        };
        if has_dep("astro") {
            return "Astro".into();
        }
        if has_dep("typescript") || m.has("tsconfig.json") {
            return "TypeScript".into();
        }
        return "Node".into();
    }
    if m.has("pyproject.toml") || m.has("requirements.txt") || m.has("setup.py") {
        return "Python".into();
    }
    if m.has("CMakeLists.txt") {
        return "C++".into();
    }
    if m.has("pom.xml") || m.has("build.gradle") || m.has("build.gradle.kts") {
        return "Java".into();
    }
    if m.has("Gemfile") {
        return "Ruby".into();
    }
    if m.has("kustomization.yaml") {
        return "YAML".into();
    }
    if m.has("docker-compose.yml") || m.has("docker-compose.yaml") {
        return "Docker".into();
    }
    "Make".into()
}

/// Version string shown next to the project, falling back to the latest tag.
fn detect_version(m: &Manifests, stack: &str) -> String {
    let parsed = match stack {
        "Rust" => m.text("Cargo.toml").and_then(|raw| {
            toml::from_str::<toml::Value>(&raw)
                .ok()?
                .get("package")?
                .get("version")?
                .as_str()
                .map(str::to_string)
        }),
        "Python" => m.text("pyproject.toml").and_then(|raw| {
            let v: toml::Value = toml::from_str(&raw).ok()?;
            v.get("project")
                .and_then(|p| p.get("version"))
                .or_else(|| v.get("tool")?.get("poetry")?.get("version"))
                .and_then(|s| s.as_str())
                .map(str::to_string)
        }),
        "Dart" => m.text("pubspec.yaml").and_then(|raw| yaml_scalar(&raw, "version")),
        _ => m.text("package.json").and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw)
                .ok()?
                .get("version")?
                .as_str()
                .map(str::to_string)
        }),
    };

    parsed.unwrap_or_else(|| "—".into())
}

/// One-line project summary: manifest description first, README fallback.
fn detect_desc(m: &Manifests, stack: &str) -> String {
    let from_manifest = match stack {
        "Rust" => m.text("Cargo.toml").and_then(|raw| {
            toml::from_str::<toml::Value>(&raw)
                .ok()?
                .get("package")?
                .get("description")?
                .as_str()
                .map(str::to_string)
        }),
        "Python" => m.text("pyproject.toml").and_then(|raw| {
            toml::from_str::<toml::Value>(&raw)
                .ok()?
                .get("project")?
                .get("description")?
                .as_str()
                .map(str::to_string)
        }),
        "Dart" => m.text("pubspec.yaml").and_then(|raw| yaml_scalar(&raw, "description")),
        _ => m.text("package.json").and_then(|raw| {
            serde_json::from_str::<serde_json::Value>(&raw)
                .ok()?
                .get("description")?
                .as_str()
                .map(str::to_string)
        }),
    };

    if let Some(d) = from_manifest.filter(|d| !d.trim().is_empty()) {
        return d.trim().to_string();
    }
    readme_summary(&m.root).unwrap_or_default()
}

/// First real paragraph of the README, with headings and badges dropped.
fn readme_summary(root: &Path) -> Option<String> {
    let raw = ["README.md", "readme.md", "README.MD", "README.txt", "README"]
        .iter()
        .find_map(|name| fs::read_to_string(root.join(name)).ok())?;

    for para in raw.split("\n\n") {
        let line = para
            .lines()
            .map(str::trim)
            .filter(|l| {
                !l.is_empty()
                    && !l.starts_with('#')
                    && !l.starts_with("[!")
                    && !l.starts_with("![")
                    && !l.starts_with("<!--")
                    && !l.starts_with("---")
            })
            .collect::<Vec<_>>()
            .join(" ");
        let line = line.trim();
        if line.len() > 20 {
            let cut = line.chars().take(280).collect::<String>();
            return Some(cut);
        }
    }
    None
}

/// Minimal `key: value` reader - enough for pubspec's flat top-level keys.
fn yaml_scalar(raw: &str, key: &str) -> Option<String> {
    for line in raw.lines() {
        let Some(rest) = line.strip_prefix(key) else { continue };
        let Some(rest) = rest.strip_prefix(':') else { continue };
        let value = rest.trim().trim_matches('"').trim_matches('\'');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Cleanable buckets
// ---------------------------------------------------------------------------

struct CleanRule {
    cat: &'static str,
    /// Relative path from the project root, `/`-separated.
    rel: &'static str,
    /// When true, any directory with this name at any depth matches.
    any_depth: bool,
}

const fn rule(cat: &'static str, rel: &'static str) -> CleanRule {
    CleanRule { cat, rel, any_depth: false }
}
const fn deep(cat: &'static str, rel: &'static str) -> CleanRule {
    CleanRule { cat, rel, any_depth: true }
}

fn rules_for(stack: &str) -> Vec<CleanRule> {
    let mut out: Vec<CleanRule> = match stack {
        // Buckets must never nest. `target/debug/incremental` is deliberately
        // absent: deleting `target/debug` takes it along, so offering it as its
        // own row would free more than the size printed next to it.
        "Rust" => vec![
            rule("target/debug", "target/debug"),
            rule("target/release", "target/release"),
            rule("target/doc", "target/doc"),
            rule("build cache", "target/tmp"),
            rule("build cache", "target/package"),
        ],
        "TypeScript" | "Node" | "Astro" => vec![
            rule("node_modules", "node_modules"),
            rule("dist / .next", ".next"),
            rule("dist / .next", "dist"),
            rule(".turbo cache", ".turbo"),
            rule("build cache", ".astro"),
            rule("build cache", ".svelte-kit"),
            rule("build cache", ".parcel-cache"),
        ],
        "Python" => vec![
            rule(".venv", ".venv"),
            rule(".venv", "venv"),
            deep("__pycache__", "__pycache__"),
            deep("test cache", ".pytest_cache"),
            rule("test cache", ".mypy_cache"),
            rule("test cache", ".ruff_cache"),
            rule("checkpoints", "artifacts"),
            rule("checkpoints", "checkpoints"),
            rule("checkpoints", "wandb"),
        ],
        "Go" => vec![rule("build cache", "bin"), rule("vendor", "vendor")],
        "Dart" => vec![rule("build/", "build"), rule(".dart_tool", ".dart_tool")],
        "PHP" => vec![rule("vendor", "vendor"), rule("var/cache", "var/cache")],
        "Elixir" => vec![rule("build/", "_build"), rule("deps", "deps")],
        "C++" => vec![
            rule("build/", "build"),
            rule("build/", "cmake-build-debug"),
            rule("build/", "cmake-build-release"),
        ],
        "Java" => vec![rule("build/", "build"), rule("build/", "target"), rule("build cache", ".gradle")],
        "Ruby" => vec![rule("vendor", "vendor/bundle")],
        _ => vec![],
    };

    // Caches that show up regardless of the stack.
    out.push(rule("coverage", "coverage"));
    out
}

struct Bucket {
    cat: String,
    path: PathBuf,
    /// Components of the owning part, relative to the project root.
    prefix: Vec<String>,
    /// Components of the rule, relative to the part.
    comps: Vec<String>,
    any_depth: bool,
    part: usize,
}

/// Builds the cleanable buckets for every part of a project.
///
/// A bucket that would contain another part is dropped: removing it would take
/// a whole package with it, and free far more than the size shown next to it.
fn buckets_for(parts: &[PartSpec]) -> Vec<Bucket> {
    let part_comps: Vec<Vec<String>> = parts.iter().map(|p| components(&p.rel)).collect();
    let mut out: Vec<Bucket> = Vec::new();

    for (i, part) in parts.iter().enumerate() {
        let prefix = part_comps[i].clone();

        for r in rules_for(&part.stack) {
            let comps: Vec<String> = r.rel.split('/').map(str::to_string).collect();

            let swallows_a_part = part_comps.iter().enumerate().any(|(j, other)| {
                if i == j || other.len() <= prefix.len() + comps.len() {
                    return false;
                }
                let full: Vec<String> = prefix.iter().chain(comps.iter()).cloned().collect();
                other.starts_with(&full)
            });
            if swallows_a_part {
                continue;
            }

            if r.any_depth {
                // The concrete paths are only known per match; the bucket is
                // reported as `<part>\**\<name>` and fans out on delete.
                out.push(Bucket {
                    cat: r.cat.to_string(),
                    path: part.dir.join("**").join(r.rel),
                    prefix: prefix.clone(),
                    comps,
                    any_depth: true,
                    part: i,
                });
                continue;
            }

            let path = comps.iter().fold(part.dir.clone(), |acc, c| acc.join(c));
            if path.is_dir() {
                out.push(Bucket {
                    cat: r.cat.to_string(),
                    path,
                    prefix: prefix.clone(),
                    comps,
                    any_depth: false,
                    part: i,
                });
            }
        }
    }

    out
}

fn components(rel: &Path) -> Vec<String> {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .filter(|c| !c.is_empty())
        .collect()
}

/// Longest match wins, so a deeper part beats a shallower one and
/// `target/debug/incremental` would beat `target/debug`.
fn bucket_index(rel: &[String], buckets: &[Bucket]) -> Option<usize> {
    let mut best: Option<(usize, usize)> = None;

    for (i, b) in buckets.iter().enumerate() {
        if rel.len() <= b.prefix.len() || !rel.starts_with(&b.prefix) {
            continue;
        }
        let tail = &rel[b.prefix.len()..];

        let score = if b.any_depth {
            if tail.iter().any(|c| c == &b.comps[0]) {
                b.prefix.len() * 10 + 1
            } else {
                0
            }
        } else if tail.len() > b.comps.len() && tail.starts_with(&b.comps) {
            b.prefix.len() * 10 + b.comps.len() + 1
        } else {
            0
        };

        if score > 0 && best.map(|(s, _)| score > s).unwrap_or(true) {
            best = Some((score, i));
        }
    }

    best.map(|(_, i)| i)
}

/// Deepest part owning a file, so per-part sizes never double-count.
fn part_index(rel: &[String], part_comps: &[Vec<String>]) -> Option<usize> {
    part_comps
        .iter()
        .enumerate()
        .filter(|(_, comps)| comps.is_empty() || rel.starts_with(comps))
        .max_by_key(|(_, comps)| comps.len())
        .map(|(i, _)| i)
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

struct Walked {
    total_bytes: u64,
    loc: u64,
    source_files: u64,
    ext_bytes: HashMap<String, u64>,
    bucket_bytes: Vec<u64>,
    bucket_mtime: Vec<i64>,
    part_bytes: Vec<u64>,
    part_source_bytes: Vec<u64>,
}

fn mtime_secs(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn count_lines(path: &Path) -> u64 {
    match fs::read(path) {
        // A NUL byte in the first block means binary - skip it.
        Ok(bytes) if !bytes.iter().take(8000).any(|b| *b == 0) => {
            bytes.iter().filter(|b| **b == b'\n').count() as u64
        }
        _ => 0,
    }
}

fn walk(root: &Path, buckets: &[Bucket], part_comps: &[Vec<String>]) -> Walked {
    let mut w = Walked {
        total_bytes: 0,
        loc: 0,
        source_files: 0,
        ext_bytes: HashMap::new(),
        bucket_bytes: vec![0; buckets.len()],
        bucket_mtime: vec![0; buckets.len()],
        part_bytes: vec![0; part_comps.len()],
        part_source_bytes: vec![0; part_comps.len()],
    };

    for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let len = meta.len();

        w.total_bytes += len;

        let rel: Vec<String> = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(entry.path())
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect();

        let part = part_index(&rel, part_comps);
        if let Some(p) = part {
            w.part_bytes[p] += len;
        }

        if let Some(i) = bucket_index(&rel, buckets) {
            w.bucket_bytes[i] += len;
            let m = mtime_secs(&meta);
            if m > w.bucket_mtime[i] {
                w.bucket_mtime[i] = m;
            }
            continue;
        }

        // Anything left is source-ish. Hidden and vendored trees still get
        // skipped so language shares reflect what the developer wrote.
        if rel.iter().any(|c| is_skipped_dir(c)) {
            continue;
        }

        let ext = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();

        if let Some(lang) = language_for(&ext, &rel) {
            *w.ext_bytes.entry(lang.to_string()).or_insert(0) += len;
            w.source_files += 1;
            if let Some(p) = part {
                w.part_source_bytes[p] += len;
            }
            if counts_as_code(lang) && len <= MAX_LOC_FILE {
                w.loc += count_lines(entry.path());
            }
        }
    }

    w
}

/// Maps a file extension to the language shown in the detail view.
fn language_for(ext: &str, rel: &[String]) -> Option<&'static str> {
    let name = rel.last().map(String::as_str).unwrap_or("");
    let by_name = match name {
        "Dockerfile" => Some("Dockerfile"),
        "Makefile" | "makefile" => Some("Makefile"),
        _ => None,
    };
    if by_name.is_some() {
        return by_name;
    }

    Some(match ext {
        "rs" => "Rust",
        "ts" | "mts" | "cts" => "TypeScript",
        "tsx" => "TypeScript",
        "js" | "mjs" | "cjs" => "JavaScript",
        "jsx" => "JavaScript",
        "py" => "Python",
        "ipynb" => "Notebook",
        "go" => "Go",
        "dart" => "Dart",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "java" => "Java",
        "rb" => "Ruby",
        "php" => "PHP",
        "ex" | "exs" => "Elixir",
        "heex" | "eex" => "HEEx",
        "c" | "h" => "C",
        "cpp" | "cc" | "cxx" | "hpp" | "hh" => "C++",
        "cs" => "C#",
        "m" => "MATLAB",
        "sh" | "bash" | "zsh" | "ps1" => "Shell",
        "css" | "scss" | "sass" | "less" => "CSS",
        "html" | "htm" => "HTML",
        "astro" => "Astro",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "md" | "mdx" => "MDX",
        "sql" => "SQL",
        "yml" | "yaml" => "YAML",
        "toml" => "TOML",
        "json" => "JSON",
        "mjml" => "MJML",
        "wgsl" | "glsl" => "Shader",
        "dockerfile" => "Dockerfile",
        _ => return None,
    })
}

/// Data and prose still count towards the language breakdown, but not towards
/// "lines of code" - a long lockfile or README is not code the developer wrote.
fn counts_as_code(lang: &str) -> bool {
    !matches!(lang, "JSON" | "YAML" | "TOML" | "MDX")
}

fn top_languages(ext_bytes: &HashMap<String, u64>) -> Vec<LangShare> {
    let total: u64 = ext_bytes.values().sum();
    if total == 0 {
        return Vec::new();
    }

    let mut all: Vec<(&String, &u64)> = ext_bytes.iter().collect();
    all.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));

    all.into_iter()
        .take(4)
        .map(|(name, bytes)| LangShare {
            name: name.clone(),
            pct: (*bytes as f64 / total as f64 * 1000.0).round() / 10.0,
        })
        .filter(|l| l.pct >= 1.0)
        .collect()
}

/// FNV-1a over the lowercased path - stable across runs and machines.
fn project_id(path: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_string_lossy().to_lowercase().bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn days_since(secs: i64) -> i64 {
    if secs <= 0 {
        return 0;
    }
    ((now_secs() - secs) / 86_400).max(0)
}

/// One package of a project, before it has been measured.
struct PartSpec {
    name: String,
    rel: PathBuf,
    dir: PathBuf,
    stack: String,
    manifests: Manifests,
}

/// Splits a project root into its packages. A plain single-package project
/// yields exactly one part covering the root.
fn parts_of(root: &Path, project_name: &str) -> Vec<PartSpec> {
    let mut out: Vec<PartSpec> = Vec::new();

    let root_manifests = Manifests::read(root);
    let root_has_manifest = root_manifests.names.iter().any(|n| is_manifest(n));

    let mut members = Vec::new();
    members_of(root, 0, Path::new(""), &mut members);
    members.sort();

    // The root is a part when it carries a manifest of its own, and also when
    // nothing else does - a repo with no manifests anywhere is still a project.
    if root_has_manifest || members.is_empty() {
        out.push(PartSpec {
            name: project_name.to_string(),
            rel: PathBuf::new(),
            dir: root.to_path_buf(),
            stack: detect_stack(&root_manifests),
            manifests: root_manifests,
        });
    }

    for rel in members {
        let dir = root.join(&rel);
        let manifests = Manifests::read(&dir);
        out.push(PartSpec {
            name: rel.to_string_lossy().replace('\\', "/"),
            stack: detect_stack(&manifests),
            rel,
            dir,
            manifests,
        });
    }

    out
}

/// Measures one already-discovered project root.
pub fn measure(root: &Path, settings: &Settings) -> Option<Project> {
    let name = root.file_name()?.to_string_lossy().to_string();
    let id = project_id(root);
    let specs = parts_of(root, &name);
    let part_comps: Vec<Vec<String>> = specs.iter().map(|p| components(&p.rel)).collect();

    let buckets = buckets_for(&specs);
    let walked = walk(root, &buckets, &part_comps);

    let clean_targets: Vec<CleanTarget> = buckets
        .iter()
        .enumerate()
        .filter(|(i, _)| walked.bucket_bytes[*i] > 0)
        .map(|(i, b)| CleanTarget {
            key: format!("{id}|{}|{}", b.cat, b.path.display()),
            project_id: id.clone(),
            project: name.clone(),
            part: specs[b.part].rel.to_string_lossy().replace('\\', "/"),
            cat: b.cat.clone(),
            path: b.path.to_string_lossy().to_string(),
            bytes: walked.bucket_bytes[i],
            age_days: days_since(walked.bucket_mtime[i]),
        })
        .collect();

    let mut part_reclaim = vec![0u64; specs.len()];
    for (i, b) in buckets.iter().enumerate() {
        part_reclaim[b.part] += walked.bucket_bytes[i];
    }

    let parts: Vec<ProjectPart> = specs
        .iter()
        .enumerate()
        .map(|(i, spec)| ProjectPart {
            name: spec.name.clone(),
            rel: spec.rel.to_string_lossy().replace('\\', "/"),
            path: spec.dir.to_string_lossy().to_string(),
            stack: spec.stack.clone(),
            manifests: spec.manifests.names.iter().filter(|n| is_manifest(n)).cloned().collect(),
            size_bytes: walked.part_bytes[i],
            reclaim_bytes: part_reclaim[i],
            source_bytes: walked.part_source_bytes[i],
        })
        .collect();

    // The part carrying the most source gives the project its headline stack.
    let lead = (0..specs.len()).max_by_key(|i| walked.part_source_bytes[*i]).unwrap_or(0);
    let lead_spec = &specs[lead];

    let commands: Vec<CommandDef> = specs
        .iter()
        .flat_map(|spec| {
            let rel = spec.rel.to_string_lossy().replace('\\', "/");
            cmds::detect(&spec.dir, &spec.stack, &spec.manifests.names)
                .into_iter()
                .map(move |mut c| {
                    c.cwd = rel.clone();
                    c.part = spec.name.clone();
                    c
                })
        })
        .collect();

    let mut manifests: Vec<String> = parts.iter().flat_map(|p| p.manifests.clone()).collect();
    manifests.dedup();

    let git = git::inspect(root, settings.toggles.deep_git);

    let version = {
        let v = detect_version(&lead_spec.manifests, &lead_spec.stack);
        if v == "—" && !git.tag.is_empty() && git.tag != "—" {
            git.tag.trim_start_matches('v').to_string()
        } else {
            v
        }
    };

    let desc = {
        let d = detect_desc(&lead_spec.manifests, &lead_spec.stack);
        // A monorepo's README lives at the root, not inside the lead package.
        if d.is_empty() { readme_summary(root).unwrap_or_default() } else { d }
    };

    Some(Project {
        id,
        name,
        path: root.to_string_lossy().to_string(),
        stack: lead_spec.stack.clone(),
        langs: top_languages(&walked.ext_bytes),
        files: walked.source_files,
        loc: walked.loc,
        size_bytes: walked.total_bytes,
        reclaim_bytes: clean_targets.iter().map(|t| t.bytes).sum(),
        version,
        desc,
        manifests,
        parts,
        commands,
        clean_targets,
        git,
        scanned_at: now_secs(),
    })
}

/// Full scan of every watched folder.
pub fn scan_all<F>(settings: &Settings, on_progress: F) -> Vec<Project>
where
    F: Fn(usize, usize, &str) + Send + Sync,
{
    let roots = discover(&settings.folders);
    let total = roots.len();
    let done = std::sync::atomic::AtomicUsize::new(0);

    let mut projects: Vec<Project> = roots
        .par_iter()
        .filter_map(|root| {
            let project = measure(root, settings);
            let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            on_progress(n, total, &root.to_string_lossy());
            project
        })
        .collect();

    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    projects
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Lays down a small but realistic Rust project on disk.
    fn fixture(root: &Path) {
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("target/debug/incremental")).unwrap();
        fs::create_dir_all(root.join("target/release")).unwrap();

        fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.7.3\"\ndescription = \"A fixture crate.\"\n",
        )
        .unwrap();

        // 40 lines of "source".
        let source = "fn main() {}\n".repeat(40);
        fs::write(root.join("src/main.rs"), &source).unwrap();

        fs::write(root.join("target/debug/blob.bin"), vec![0u8; 4096]).unwrap();
        fs::write(root.join("target/debug/incremental/inc.bin"), vec![0u8; 2048]).unwrap();
        fs::write(root.join("target/release/rel.bin"), vec![0u8; 1024]).unwrap();
    }

    #[test]
    fn measures_a_rust_project() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("fixture");
        fixture(&root);

        let project = measure(&root, &Settings::default()).expect("project");

        assert_eq!(project.stack, "Rust");
        assert_eq!(project.name, "fixture");
        assert_eq!(project.version, "0.7.3");
        assert_eq!(project.desc, "A fixture crate.");
        assert_eq!(project.loc, 40);
        assert!(project.langs.iter().any(|l| l.name == "Rust"));
        assert!(project.commands.iter().any(|c| c.cmd == "cargo run"));
        assert!(project.manifests.contains(&"Cargo.toml".to_string()));

        let by_cat = |cat: &str| {
            project
                .clean_targets
                .iter()
                .find(|t| t.cat == cat)
                .unwrap_or_else(|| panic!("missing bucket {cat}"))
        };

        // `target/debug` owns everything below it, incremental included, so the
        // number shown is exactly what deleting it frees.
        assert_eq!(by_cat("target/debug").bytes, 4096 + 2048);
        assert_eq!(by_cat("target/release").bytes, 1024);
        assert!(project.clean_targets.iter().all(|t| t.cat != "incremental"));
        assert_eq!(project.reclaim_bytes, 4096 + 2048 + 1024);
        assert!(project.size_bytes > project.reclaim_bytes);
    }

    #[test]
    fn discovery_stops_at_the_project_root() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("fixture");
        fixture(&root);

        // A vendored crate inside target/ must never surface as its own project.
        fs::create_dir_all(root.join("target/debug/nested")).unwrap();
        fs::write(root.join("target/debug/nested/Cargo.toml"), "[package]\n").unwrap();

        let found = discover(&[tmp.path().to_string_lossy().to_string()]);

        assert_eq!(found, vec![root]);
    }

    /// `repo/` with no manifest of its own, holding a TS frontend and a Rust
    /// backend - the layout the user described.
    fn monorepo(root: &Path) {
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("README.md"), "# Repo\n\nA frontend and a backend.\n").unwrap();

        fs::create_dir_all(root.join("frontend/src")).unwrap();
        fs::create_dir_all(root.join("frontend/node_modules/left-pad")).unwrap();
        fs::write(
            root.join("frontend/package.json"),
            r#"{"name":"web","version":"2.1.0","scripts":{"dev":"vite","build":"vite build"},"devDependencies":{"typescript":"^5"}}"#,
        )
        .unwrap();
        fs::write(root.join("frontend/src/app.ts"), "export const a = 1;\n".repeat(10)).unwrap();
        fs::write(root.join("frontend/node_modules/left-pad/index.js"), vec![0u8; 8192]).unwrap();

        fs::create_dir_all(root.join("backend/src")).unwrap();
        fs::create_dir_all(root.join("backend/target/debug")).unwrap();
        fs::write(
            root.join("backend/Cargo.toml"),
            "[package]\nname = \"api\"\nversion = \"0.3.0\"\n",
        )
        .unwrap();
        fs::write(root.join("backend/src/main.rs"), "fn main() {}\n".repeat(60)).unwrap();
        fs::write(root.join("backend/target/debug/api.exe"), vec![0u8; 4096]).unwrap();
    }

    #[test]
    fn a_repo_with_frontend_and_backend_is_one_project() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("shopflow");
        monorepo(&root);

        // The repo root has no manifest, so it is only found because of .git.
        assert_eq!(discover(&[tmp.path().to_string_lossy().to_string()]), vec![root.clone()]);

        let project = measure(&root, &Settings::default()).expect("project");

        assert_eq!(project.name, "shopflow");
        let names: Vec<&str> = project.parts.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["backend", "frontend"]);

        let part = |n: &str| project.parts.iter().find(|p| p.name == n).unwrap();
        assert_eq!(part("frontend").stack, "TypeScript");
        assert_eq!(part("backend").stack, "Rust");

        // Backend carries more source, so it names the project's stack.
        assert_eq!(project.stack, "Rust");
        assert_eq!(project.version, "0.3.0");
        assert!(project.desc.contains("frontend and a backend"));

        // Each part's junk is measured against that part, not the repo root.
        let target = |cat: &str| {
            project
                .clean_targets
                .iter()
                .find(|t| t.cat == cat)
                .unwrap_or_else(|| panic!("missing {cat}"))
        };
        assert_eq!(target("node_modules").bytes, 8192);
        assert!(target("node_modules").path.contains("frontend"));
        assert_eq!(target("target/debug").bytes, 4096);
        assert!(target("target/debug").path.contains("backend"));
        assert_eq!(part("frontend").reclaim_bytes, 8192);
        assert_eq!(part("backend").reclaim_bytes, 4096);

        // Commands know which directory they belong to.
        let dev = project.commands.iter().find(|c| c.cmd == "npm run dev").expect("npm run dev");
        assert_eq!(dev.cwd, "frontend");
        assert_eq!(dev.part, "frontend");
        let run = project.commands.iter().find(|c| c.cmd == "cargo run").expect("cargo run");
        assert_eq!(run.cwd, "backend");
    }

    /// The shape this very repository has: a manifest at the root plus a
    /// nested package, so the root is a part alongside its member.
    #[test]
    fn a_root_manifest_and_a_nested_package_are_both_parts() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("assister");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/react")).unwrap();
        fs::create_dir_all(root.join("src-tauri/src")).unwrap();
        fs::create_dir_all(root.join("src-tauri/target/debug")).unwrap();

        fs::write(
            root.join("package.json"),
            r#"{"name":"assister","version":"0.4.2","scripts":{"dev":"tauri dev"},"devDependencies":{"typescript":"^5"}}"#,
        )
        .unwrap();
        fs::write(root.join("src/App.tsx"), "export const App = () => null;\n".repeat(8)).unwrap();
        fs::write(root.join("node_modules/react/index.js"), vec![0u8; 3072]).unwrap();
        fs::write(root.join("src-tauri/Cargo.toml"), "[package]\nname = \"upa\"\nversion = \"0.4.2\"\n").unwrap();
        fs::write(root.join("src-tauri/src/lib.rs"), "pub fn run() {}\n".repeat(30)).unwrap();
        fs::write(root.join("src-tauri/target/debug/upa.exe"), vec![0u8; 9000]).unwrap();

        let project = measure(&root, &Settings::default()).unwrap();

        let names: Vec<&str> = project.parts.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["assister", "src-tauri"]);
        assert_eq!(project.parts[0].rel, "");
        assert_eq!(project.parts[0].stack, "TypeScript");
        assert_eq!(project.parts[1].rel, "src-tauri");
        assert_eq!(project.parts[1].stack, "Rust");

        // The root's node_modules belongs to the root, the target dir to the
        // nested crate - neither swallows the other.
        let by_cat = |c: &str| project.clean_targets.iter().find(|t| t.cat == c).unwrap();
        assert_eq!(by_cat("node_modules").bytes, 3072);
        assert_eq!(by_cat("target/debug").bytes, 9000);
        assert_eq!(project.parts[0].reclaim_bytes, 3072);
        assert_eq!(project.parts[1].reclaim_bytes, 9000);

        assert!(project
            .commands
            .iter()
            .any(|c| c.cmd == "npm run dev" && c.cwd.is_empty()));
        assert!(project
            .commands
            .iter()
            .any(|c| c.cmd == "cargo run" && c.cwd == "src-tauri"));
    }

    #[test]
    fn a_single_package_project_still_has_exactly_one_part() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("fixture");
        fixture(&root);

        let project = measure(&root, &Settings::default()).unwrap();

        assert_eq!(project.parts.len(), 1);
        assert_eq!(project.parts[0].rel, "");
        assert_eq!(project.parts[0].name, "fixture");
        assert!(project.commands.iter().all(|c| c.cwd.is_empty()));
    }

    /// Two checkouts can easily hold a `server` each. Nothing that selects or
    /// groups may treat them as the same project.
    #[test]
    fn projects_sharing_a_name_stay_distinct() {
        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("alpha/server");
        let second = tmp.path().join("beta/server");
        fixture(&first);
        fixture(&second);

        let a = measure(&first, &Settings::default()).unwrap();
        let b = measure(&second, &Settings::default()).unwrap();

        assert_eq!(a.name, b.name, "the fixture is only interesting if the names collide");
        assert_ne!(a.id, b.id, "identity must come from the path, not the name");

        // Cleanup rows must not collapse into one another either.
        let keys_a: Vec<&str> = a.clean_targets.iter().map(|t| t.key.as_str()).collect();
        assert!(!a.clean_targets.is_empty());
        assert!(
            b.clean_targets.iter().all(|t| !keys_a.contains(&t.key.as_str())),
            "clean target keys collided between same-named projects",
        );
        assert!(a.clean_targets.iter().all(|t| t.project_id == a.id));
        assert!(b.clean_targets.iter().all(|t| t.project_id == b.id));
    }

    #[test]
    fn cleaning_never_covers_another_bucket() {
        // Two buckets where one contains the other would free more than the
        // size shown next to it, so no rule set may nest.
        for stack in ["Rust", "TypeScript", "Python", "Go", "Dart", "PHP", "Elixir", "C++", "Java"] {
            let rules = rules_for(stack);
            for a in &rules {
                for b in &rules {
                    if std::ptr::eq(a, b) || a.any_depth || b.any_depth {
                        continue;
                    }
                    let outer: Vec<&str> = a.rel.split('/').collect();
                    let inner: Vec<&str> = b.rel.split('/').collect();
                    assert!(
                        !(inner.len() > outer.len() && inner.starts_with(&outer[..])),
                        "{stack}: bucket {} contains {}",
                        a.rel,
                        b.rel
                    );
                }
            }
        }
    }
}
