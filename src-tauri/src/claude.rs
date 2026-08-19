//! Reads the Claude Code session logs that sit next to the projects.
//!
//! Claude Code keeps one JSON-lines file per session under
//! `~/.claude/projects/<encoded path>/<session id>.jsonl`, and appends to the
//! one it is in. Nothing here writes: the logs are somebody else's file format
//! and this is a reader, so a shape that is not understood is skipped rather
//! than guessed at.
//!
//! The files get large - tens of megabytes for a long session - so a file is
//! parsed once and then only from where the last read stopped. What is kept
//! per file is a set of counters, not the conversation: the totals a session
//! contributes never change once its lines are past, so appending to a file
//! only ever costs the lines that were appended.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use serde_json::Value;

use crate::model::{ClaudeMessage, ClaudeSession, ClaudeStats, ClaudeTokens, ClaudeUse, Project};

/// How much of one message is carried to the transcript view. Long enough for
/// a prompt or an answer to be read, short enough that a session of a thousand
/// messages still crosses the IPC boundary as one response.
const MAX_TEXT: usize = 4000;
/// Messages returned for one session, newest end kept - a session longer than
/// this is a working log, not something anybody reads from the top.
const MAX_MESSAGES: usize = 1200;
/// Title length, when the title has to be taken from the first prompt.
const MAX_TITLE: usize = 90;

/// Writing to the cache costs a quarter more than plain input, reading from it
/// a tenth of it. Both are ratios of the model's own input price.
const CACHE_WRITE_RATE: f64 = 1.25;
const CACHE_READ_RATE: f64 = 0.1;

/// USD per million tokens, input and output, by model family.
///
/// The logs record a model id, not a price, so the cost shown anywhere in the
/// app is an estimate against Anthropic's published API rates - a subscription
/// is not billed this way. An unknown id is priced as an Opus, which is the
/// dearer guess of the two that matter.
fn price(model: &str) -> (f64, f64) {
    let id = model.to_ascii_lowercase();
    if id.contains("haiku") {
        (1.0, 5.0)
    } else if id.contains("sonnet") {
        (3.0, 15.0)
    } else if id.contains("fable") || id.contains("mythos") {
        (10.0, 50.0)
    } else {
        (5.0, 25.0)
    }
}

/// Where Claude Code keeps its sessions, honouring `CLAUDE_CONFIG_DIR`.
pub fn projects_root() -> Option<PathBuf> {
    let base = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => home()?.join(".claude"),
    };
    let root = base.join("projects");
    root.is_dir().then_some(root)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Everything one session file adds up to. Kept raw so the same numbers can be
/// re-bound to a project list that has since changed, without re-reading.
#[derive(Debug, Clone, Default)]
struct Acc {
    cwd: String,
    branch: String,
    /// The title Claude Code itself gave the session, when it gave one.
    title: String,
    first_prompt: String,
    started: String,
    ended: String,
    user_messages: usize,
    assistant_messages: usize,
    sidechains: usize,
    tool_calls: usize,
    errors: usize,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cost: f64,
    tools: HashMap<String, usize>,
    models: HashMap<String, usize>,
}

#[derive(Debug, Clone)]
struct Entry {
    modified: u64,
    size: u64,
    /// Byte offset of the first line not yet read. Only whole lines count, so
    /// a file caught mid-append is picked up from the last complete one.
    offset: u64,
    acc: Acc,
}

/// The parsed-so-far state of every session file seen this run. Cloning shares
/// that state, so a scan can be handed to a blocking thread and still be the
/// same index the next one continues from.
#[derive(Default, Clone)]
pub struct Index {
    files: Arc<Mutex<HashMap<PathBuf, Entry>>>,
}

impl Index {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every session on this machine, newest first, bound to the projects the
    /// app knows about.
    pub fn scan(&self, projects: &[Project]) -> ClaudeStats {
        let Some(root) = projects_root() else {
            return ClaudeStats::default();
        };

        let mut files: Vec<PathBuf> = Vec::new();
        if let Ok(dirs) = std::fs::read_dir(&root) {
            for dir in dirs.flatten() {
                if !dir.path().is_dir() {
                    continue;
                }
                let Ok(entries) = std::fs::read_dir(dir.path()) else {
                    continue;
                };
                for file in entries.flatten() {
                    let path = file.path();
                    if path.extension().is_some_and(|e| e == "jsonl") {
                        files.push(path);
                    }
                }
            }
        }

        let mut sessions: Vec<ClaudeSession> = files
            .iter()
            .filter_map(|path| {
                let acc = self.read(path)?;
                // A file with no conversation in it is a session that never
                // got started; listing it would only be noise.
                (acc.user_messages + acc.assistant_messages > 0)
                    .then(|| session(path, &acc, projects))
            })
            .collect();

        // Newest first: what was worked on last is what is being looked for.
        sessions.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));

        ClaudeStats {
            available: true,
            root: root.to_string_lossy().to_string(),
            sessions,
        }
    }

    /// The file a session id belongs to, as last seen by a scan. Session
    /// contents are only ever asked for by id, so a path from the frontend
    /// never reaches the filesystem.
    pub fn file_of(&self, id: &str) -> Option<PathBuf> {
        self.files
            .lock()
            .unwrap()
            .keys()
            .find(|path| path.file_stem().is_some_and(|stem| stem == id))
            .cloned()
    }

    /// Counters for one file, reading only what has not been read before.
    fn read(&self, path: &Path) -> Option<Acc> {
        let meta = std::fs::metadata(path).ok()?;
        let size = meta.len();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let previous = self.files.lock().unwrap().get(path).cloned();
        if let Some(entry) = &previous {
            if entry.size == size && entry.modified == modified {
                return Some(entry.acc.clone());
            }
        }

        // A file that shrank was rewritten rather than appended to, and what
        // was counted from it no longer describes what is in it.
        let (mut acc, from) = match previous {
            Some(entry) if size >= entry.offset => (entry.acc, entry.offset),
            _ => (Acc::default(), 0),
        };

        let mut reader = BufReader::new(File::open(path).ok()?);
        if from > 0 && reader.seek(SeekFrom::Start(from)).is_err() {
            return Some(acc);
        }

        let mut offset = from;
        let mut line: Vec<u8> = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) => break,
                Ok(read) => {
                    // A line without its newline is one still being written;
                    // leaving the offset where it is picks it up next time.
                    if line.last() != Some(&b'\n') {
                        break;
                    }
                    offset += read as u64;
                    if let Ok(text) = std::str::from_utf8(&line) {
                        absorb(&mut acc, text);
                    }
                }
                Err(_) => break,
            }
        }

        self.files.lock().unwrap().insert(
            path.to_path_buf(),
            Entry { modified, size, offset, acc: acc.clone() },
        );
        Some(acc)
    }
}

/// Folds one JSON line into the running totals. Anything unrecognised is
/// skipped: the format grows record types between releases, and a reader that
/// insisted on knowing them all would break on the next one.
fn absorb(acc: &mut Acc, line: &str) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("");

    // The title Claude Code shows for the session. A title the user typed wins
    // over the one that was generated for them.
    match kind {
        "custom-title" => {
            if let Some(title) = value.get("customTitle").and_then(Value::as_str) {
                acc.title = title.to_string();
            }
            return;
        }
        "ai-title" => {
            if acc.title.is_empty() {
                if let Some(title) = value.get("aiTitle").and_then(Value::as_str) {
                    acc.title = title.to_string();
                }
            }
            return;
        }
        "user" | "assistant" => {}
        _ => return,
    }

    if let Some(time) = value.get("timestamp").and_then(Value::as_str) {
        if acc.started.is_empty() || time < acc.started.as_str() {
            acc.started = time.to_string();
        }
        if time > acc.ended.as_str() {
            acc.ended = time.to_string();
        }
    }
    if acc.cwd.is_empty() {
        if let Some(cwd) = value.get("cwd").and_then(Value::as_str) {
            acc.cwd = cwd.to_string();
        }
    }
    if let Some(branch) = value.get("gitBranch").and_then(Value::as_str) {
        if !branch.is_empty() {
            acc.branch = branch.to_string();
        }
    }

    let sidechain = value.get("isSidechain").and_then(Value::as_bool).unwrap_or(false);
    if sidechain {
        acc.sidechains += 1;
    }

    let message = value.get("message");
    let content = message.and_then(|m| m.get("content"));

    if kind == "user" {
        // A user record is either something a person typed or a tool handing
        // its result back. Only the first is a message in the sense the counts
        // are about; the second is bookkeeping between two assistant turns.
        let mut is_tool_result = false;
        if let Some(blocks) = content.and_then(Value::as_array) {
            for block in blocks {
                if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                    is_tool_result = true;
                    if block.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
                        acc.errors += 1;
                    }
                }
            }
        }
        if !is_tool_result && !sidechain {
            acc.user_messages += 1;
            if acc.first_prompt.is_empty() {
                let text = first_text(content);
                if !text.is_empty() {
                    acc.first_prompt = text;
                }
            }
        }
        return;
    }

    // Assistant.
    if !sidechain {
        acc.assistant_messages += 1;
    }

    if let Some(model) = message.and_then(|m| m.get("model")).and_then(Value::as_str) {
        if !model.is_empty() && !model.starts_with('<') {
            *acc.models.entry(model.to_string()).or_default() += 1;
        }
    }

    if let Some(blocks) = content.and_then(Value::as_array) {
        for block in blocks {
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                acc.tool_calls += 1;
                if let Some(name) = block.get("name").and_then(Value::as_str) {
                    *acc.tools.entry(name.to_string()).or_default() += 1;
                }
            }
        }
    }

    let Some(usage) = message.and_then(|m| m.get("usage")) else {
        return;
    };
    let field = |name: &str| usage.get(name).and_then(Value::as_u64).unwrap_or(0);
    let input = field("input_tokens");
    let output = field("output_tokens");
    let cache_read = field("cache_read_input_tokens");
    let cache_write = field("cache_creation_input_tokens");

    acc.input += input;
    acc.output += output;
    acc.cache_read += cache_read;
    acc.cache_write += cache_write;

    let model = message
        .and_then(|m| m.get("model"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let (input_price, output_price) = price(model);
    acc.cost += (input as f64 * input_price
        + cache_write as f64 * input_price * CACHE_WRITE_RATE
        + cache_read as f64 * input_price * CACHE_READ_RATE
        + output as f64 * output_price)
        / 1_000_000.0;
}

/// The text of a message, whether it is a plain string or a block list.
fn first_text(content: Option<&Value>) -> String {
    first_text_of(content, MAX_TITLE)
}

fn first_text_of(content: Option<&Value>, max: usize) -> String {
    match content {
        Some(Value::String(text)) => trim(text, max),
        Some(Value::Array(blocks)) => {
            for block in blocks {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        return trim(text, max);
                    }
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

/// Cuts to a character count - not a byte count, which would split an accented
/// character in half and leave the string unusable.
fn trim(text: &str, max: usize) -> String {
    let clean = text.trim();
    if clean.chars().count() <= max {
        return clean.to_string();
    }
    let cut: String = clean.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

/// Turns the counters into the shape the frontend lists.
fn session(path: &Path, acc: &Acc, projects: &[Project]) -> ClaudeSession {
    let id = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let owner = owner_of(&acc.cwd, projects);
    let title = if !acc.title.is_empty() {
        acc.title.clone()
    } else if !acc.first_prompt.is_empty() {
        acc.first_prompt.clone()
    } else {
        id.clone()
    };

    ClaudeSession {
        id,
        title,
        project_id: owner.as_ref().map(|p| p.id.clone()).unwrap_or_default(),
        project: owner
            .as_ref()
            .map(|p| p.name.clone())
            .unwrap_or_else(|| folder_name(&acc.cwd)),
        path: acc.cwd.clone(),
        branch: acc.branch.clone(),
        started_at: acc.started.clone(),
        ended_at: acc.ended.clone(),
        messages: acc.user_messages + acc.assistant_messages,
        user_messages: acc.user_messages,
        sidechains: acc.sidechains,
        tool_calls: acc.tool_calls,
        errors: acc.errors,
        tokens: ClaudeTokens {
            input: acc.input,
            output: acc.output,
            cache_read: acc.cache_read,
            cache_write: acc.cache_write,
        },
        cost_usd: acc.cost,
        models: ranked(&acc.models),
        tools: ranked(&acc.tools),
        size_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
    }
}

fn ranked(counts: &HashMap<String, usize>) -> Vec<ClaudeUse> {
    let mut list: Vec<ClaudeUse> = counts
        .iter()
        .map(|(name, count)| ClaudeUse { name: name.clone(), count: *count })
        .collect();
    list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    list
}

/// The project a session was held in: the longest known project path the
/// session's working directory sits inside. A session run in a subdirectory
/// still belongs to the project above it.
fn owner_of<'a>(cwd: &str, projects: &'a [Project]) -> Option<&'a Project> {
    if cwd.is_empty() {
        return None;
    }
    let target = normalise(cwd);
    projects
        .iter()
        .filter(|p| {
            let root = normalise(&p.path);
            target == root || target.starts_with(&format!("{root}/"))
        })
        .max_by_key(|p| p.path.len())
}

/// Path comparison that does not care about slash direction or case, so a
/// session recorded as `C:\_DEV\x` matches a project scanned as `C:/_DEV/X`.
fn normalise(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn folder_name(path: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}

/// The conversation itself, trimmed for reading rather than for replaying.
///
/// Tool calls arrive as one line each rather than with their arguments: what a
/// transcript is being read for is the shape of the work, and a page of JSON
/// per call buries it.
pub fn transcript(path: &Path) -> Result<Vec<ClaudeMessage>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut messages: Vec<ClaudeMessage> = Vec::new();

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        if kind != "user" && kind != "assistant" {
            continue;
        }

        let time = value
            .get("timestamp")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let sidechain = value.get("isSidechain").and_then(Value::as_bool).unwrap_or(false);
        let content = value.get("message").and_then(|m| m.get("content"));

        let mut text = String::new();
        let mut tools: Vec<String> = Vec::new();
        let mut thinking = false;
        let mut tool_result = false;
        let mut error = false;

        match content {
            Some(Value::String(body)) => text = trim(body, MAX_TEXT),
            Some(Value::Array(blocks)) => {
                for block in blocks {
                    match block.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            if text.is_empty() {
                                if let Some(body) = block.get("text").and_then(Value::as_str) {
                                    text = trim(body, MAX_TEXT);
                                }
                            }
                        }
                        Some("thinking") => thinking = true,
                        Some("tool_use") => {
                            if let Some(name) = block.get("name").and_then(Value::as_str) {
                                tools.push(name.to_string());
                            }
                        }
                        Some("tool_result") => {
                            tool_result = true;
                            if block.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
                                error = true;
                                // A failure is kept, so what it said is worth
                                // keeping too - the label alone says nothing.
                                if text.is_empty() {
                                    text = first_text_of(block.get("content"), MAX_TEXT);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }

        // Tool results are the machine talking to itself; the call above them
        // already says what happened, so only a failure is worth a line.
        if tool_result && !error {
            continue;
        }
        if text.is_empty() && tools.is_empty() && !thinking && !error {
            continue;
        }

        // A turn that only calls tools belongs with the answer above it. Kept
        // apart they read as a ladder of empty rows, when what happened was
        // one assistant saying something and then doing several things.
        if kind == "assistant" && text.is_empty() && !error {
            if let Some(last) = messages.last_mut() {
                if last.role == "assistant" && last.sidechain == sidechain {
                    last.tools.append(&mut tools);
                    last.thinking |= thinking;
                    continue;
                }
            }
        }

        messages.push(ClaudeMessage {
            role: kind.to_string(),
            time,
            text,
            tools,
            thinking,
            error,
            sidechain,
        });
    }

    if messages.len() > MAX_MESSAGES {
        messages.drain(..messages.len() - MAX_MESSAGES);
    }
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
        let path = dir.join(name);
        let mut file = File::create(&path).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
        path
    }

    const PROMPT: &str = r#"{"type":"user","isSidechain":false,"timestamp":"2026-08-18T10:00:00.000Z","cwd":"C:\\proj","gitBranch":"main","message":{"role":"user","content":"do the thing"}}"#;
    const REPLY: &str = r#"{"type":"assistant","isSidechain":false,"timestamp":"2026-08-18T10:01:00.000Z","cwd":"C:\\proj","message":{"role":"assistant","model":"claude-opus-5","content":[{"type":"tool_use","name":"Read"}],"usage":{"input_tokens":1000,"output_tokens":100,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}"#;
    const TOOL_BACK: &str = r#"{"type":"user","isSidechain":false,"timestamp":"2026-08-18T10:02:00.000Z","message":{"role":"user","content":[{"type":"tool_result","is_error":true,"content":"nope"}]}}"#;

    #[test]
    fn a_session_counts_what_was_said_and_what_it_cost() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(dir.path(), "s1.jsonl", &[PROMPT, REPLY, TOOL_BACK]);

        let index = Index::new();
        let acc = index.read(&path).unwrap();

        assert_eq!(acc.user_messages, 1, "the tool result is not a message");
        assert_eq!(acc.assistant_messages, 1);
        assert_eq!(acc.tool_calls, 1);
        assert_eq!(acc.errors, 1);
        assert_eq!(acc.input, 1000);
        assert_eq!(acc.output, 100);
        // 1000 in at $5/Mtok plus 100 out at $25/Mtok.
        assert!((acc.cost - 0.0075).abs() < 1e-9, "cost was {}", acc.cost);
    }

    #[test]
    fn appending_to_a_session_only_reads_what_was_added() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(dir.path(), "s2.jsonl", &[PROMPT, REPLY]);

        let index = Index::new();
        let first = index.read(&path).unwrap();
        assert_eq!(first.assistant_messages, 1);

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{REPLY}").unwrap();
        drop(file);
        // The cached entry is keyed on size as well as time, so a same-second
        // append is still seen.
        let second = index.read(&path).unwrap();
        assert_eq!(second.assistant_messages, 2);
        assert_eq!(second.user_messages, 1, "the first lines were not counted twice");
    }

    #[test]
    fn a_half_written_line_is_read_on_the_next_pass() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(dir.path(), "s3.jsonl", &[PROMPT]);

        let index = Index::new();
        {
            let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            // No newline: the line is still being written.
            write!(file, "{REPLY}").unwrap();
        }
        assert_eq!(index.read(&path).unwrap().assistant_messages, 0);

        {
            let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            writeln!(file).unwrap();
        }
        assert_eq!(index.read(&path).unwrap().assistant_messages, 1);
    }

    #[test]
    fn a_session_belongs_to_the_deepest_project_it_sits_in() {
        let outer = Project { id: "a".into(), name: "outer".into(), path: "C:/dev/app".into(), ..Default::default() };
        let inner = Project { id: "b".into(), name: "inner".into(), path: "C:/dev/app/apps/api".into(), ..Default::default() };
        let projects = vec![outer, inner];

        let found = owner_of("C:\\dev\\app\\apps\\api\\src", &projects);
        assert_eq!(found.map(|p| p.id.as_str()), Some("b"));
        assert_eq!(owner_of("C:\\dev\\app", &projects).map(|p| p.id.as_str()), Some("a"));
        assert!(owner_of("C:\\dev\\elsewhere", &projects).is_none());
    }

    #[test]
    fn the_transcript_leaves_out_the_bookkeeping() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(dir.path(), "s4.jsonl", &[PROMPT, REPLY, TOOL_BACK]);

        let messages = transcript(&path).unwrap();
        assert_eq!(messages.len(), 3, "a failed tool result is kept");
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].tools, vec!["Read".to_string()]);
        assert!(messages[2].error);
        assert_eq!(messages[2].text, "nope", "a failure says what it said");
    }

    #[test]
    fn a_turn_that_only_calls_tools_joins_the_answer_above_it() {
        let dir = tempfile::tempdir().unwrap();
        let answer = REPLY.replace(
            r#""content":[{"type":"tool_use","name":"Read"}]"#,
            r#""content":[{"type":"text","text":"Looking now."}]"#,
        );
        let path = write(dir.path(), "s5.jsonl", &[PROMPT, &answer, REPLY, REPLY]);

        let messages = transcript(&path).unwrap();
        assert_eq!(messages.len(), 2, "the two tool turns joined the answer");
        assert_eq!(messages[1].text, "Looking now.");
        assert_eq!(messages[1].tools, vec!["Read".to_string(), "Read".to_string()]);
    }
}
