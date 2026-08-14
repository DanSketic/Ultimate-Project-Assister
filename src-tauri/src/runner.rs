//! Spawning project commands and streaming their output to the UI.
//!
//! Each command runs through the platform shell inside the project directory.
//! stdout and stderr are read on their own threads and forwarded line by line
//! as `upa://log` events; a third thread waits for the exit code.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

use crate::model::LogLine;

pub const LOG_EVENT: &str = "upa://log";
pub const EXIT_EVENT: &str = "upa://cmd-exit";

/// Identifies a running command.
///
/// Keyed by project *id*, not name: two checkouts can both be called `server`,
/// and starting a command in one must not mark the other as running. The
/// working directory is part of the key too, so a monorepo's `frontend` and
/// `backend` stay distinct.
pub fn key_of(project_id: &str, cwd: &str, cmd: &str) -> String {
    format!("{project_id}|{cwd}|{cmd}")
}

fn now_hms() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

const ESC: char = '\u{1b}';
const BEL: char = '\u{7}';

/// Strips ANSI escape sequences from a line of output.
///
/// Dev servers colour their own output, and those codes have no meaning in the
/// log panel - it applies its own colours - so without this they show up as
/// literal `[90m` noise around every word.
fn strip_ansi(line: &str) -> String {
    if !line.contains(ESC) {
        return line.to_string();
    }

    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars();

    while let Some(c) = chars.next() {
        if c != ESC {
            out.push(c);
            continue;
        }
        match chars.next() {
            // CSI: parameter bytes, then a final byte in the '@'..='~' range.
            Some('[') => {
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            // OSC (window titles and hyperlinks): ends at BEL or ESC \.
            Some(']') => {
                while let Some(c) = chars.next() {
                    if c == BEL {
                        break;
                    }
                    if c == ESC {
                        chars.next();
                        break;
                    }
                }
            }
            // Any other two-character escape is dropped whole.
            _ => {}
        }
    }

    out
}

#[cfg(windows)]
fn shell(cmd: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new("cmd");
    c.arg("/C").arg(cmd);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

#[cfg(not(windows))]
fn shell(cmd: &str) -> Command {
    use std::os::unix::process::CommandExt;
    let mut c = Command::new("sh");
    c.arg("-lc").arg(cmd);
    // Own process group, so stopping kills the children too.
    c.process_group(0);
    c
}

/// Kills a process and everything it spawned.
fn kill_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c.creation_flags(0x0800_0000);
        c.output().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        // Negative pid targets the whole process group.
        Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .output()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[derive(Default)]
pub struct Runner {
    /// key -> os pid of the shell we spawned.
    procs: Arc<Mutex<HashMap<String, u32>>>,
}

impl Runner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn running_keys(&self) -> Vec<String> {
        self.procs.lock().unwrap().keys().cloned().collect()
    }

    pub fn is_running(&self, key: &str) -> bool {
        self.procs.lock().unwrap().contains_key(key)
    }

    /// Spawns a command and streams its output.
    ///
    /// `cmd` is what the command is filed under; `line` is what actually runs.
    /// The two differ only when the command has been moved to another port, so
    /// the row the user pressed still shows as the one running. `port`, when
    /// given, is exported as `PORT` and friends for the servers that read the
    /// environment rather than a flag.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &self,
        app: &AppHandle,
        project_id: &str,
        project: &str,
        dir: &Path,
        rel: &str,
        cmd: &str,
        line: &str,
        port: Option<u16>,
    ) -> Result<(), String> {
        let key = key_of(project_id, rel, cmd);
        if self.is_running(&key) {
            return Err("already running".into());
        }
        if !dir.is_dir() {
            return Err(format!("{} no longer exists", dir.display()));
        }

        let mut spawn = shell(line);
        if let Some(port) = port {
            let value = port.to_string();
            for key in ["PORT", "VITE_PORT", "NUXT_PORT", "SERVER_PORT"] {
                spawn.env(key, &value);
            }
        }

        let mut child = spawn
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start `{cmd}`: {e}"))?;

        let pid = child.id();
        self.procs.lock().unwrap().insert(key.clone(), pid);

        // The echo shows what actually ran, so a command that was moved to
        // another port says so in its own log rather than only in a toast.
        emit(app, &key, project, cmd, &format!("$ {line}  ({project})"), "cmd");

        // stdout / stderr pumps.
        if let Some(pipe) = child.stdout.take() {
            pump(app.clone(), key.clone(), project.to_string(), cmd.to_string(), pipe, "out");
        }
        if let Some(pipe) = child.stderr.take() {
            pump(app.clone(), key.clone(), project.to_string(), cmd.to_string(), pipe, "err");
        }

        // Exit watcher.
        let procs = Arc::clone(&self.procs);
        let app_exit = app.clone();
        let (key_exit, project_exit, cmd_exit) = (key.clone(), project.to_string(), cmd.to_string());
        std::thread::spawn(move || {
            let status = child.wait();
            procs.lock().unwrap().remove(&key_exit);

            let text = match status {
                Ok(s) => match s.code() {
                    Some(0) => "process finished (exit 0)".to_string(),
                    Some(code) => format!("process exited with code {code}"),
                    None => "process terminated".to_string(),
                },
                Err(e) => format!("process error: {e}"),
            };
            emit(&app_exit, &key_exit, &project_exit, &cmd_exit, &text, "exit");
            let _ = app_exit.emit(EXIT_EVENT, key_exit);
        });

        Ok(())
    }

    pub fn stop(&self, project_id: &str, rel: &str, cmd: &str) -> Result<(), String> {
        let key = key_of(project_id, rel, cmd);
        let pid = self.procs.lock().unwrap().get(&key).copied();
        match pid {
            Some(pid) => kill_tree(pid),
            None => Err("not running".into()),
        }
    }

    /// Called on shutdown so no orphaned dev servers survive the app.
    pub fn stop_all(&self) {
        let pids: Vec<u32> = self.procs.lock().unwrap().values().copied().collect();
        for pid in pids {
            let _ = kill_tree(pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_is_left_alone() {
        assert_eq!(strip_ansi("ready in 412 ms"), "ready in 412 ms");
        assert_eq!(strip_ansi(""), "");
    }

    #[test]
    fn nuxt_style_colouring_is_removed() {
        // Exactly the shape a Nuxt dev server emits.
        let line = "\u{1b}[90m[\u{1b}[90mnuxt:tailwindcss\u{1b}[90m]\u{1b}[39m \u{1b}[36mi\u{1b}[39m Using default Tailwind CSS file";
        assert_eq!(strip_ansi(line), "[nuxt:tailwindcss] i Using default Tailwind CSS file");
    }

    #[test]
    fn vite_check_marks_survive_their_colouring() {
        let line = "\u{1b}[32m\u{221a}\u{1b}[39m Vite client built in 55ms";
        assert_eq!(strip_ansi(line), "\u{221a} Vite client built in 55ms");
    }

    #[test]
    fn underline_and_link_sequences_are_removed() {
        let line = "Tailwind Viewer: \u{1b}[4m\u{1b}[33mhttp://localhost:3005/\u{1b}[39m\u{1b}[24m";
        assert_eq!(strip_ansi(line), "Tailwind Viewer: http://localhost:3005/");
    }

    #[test]
    fn window_title_sequences_are_removed() {
        // OSC terminated by BEL, and by ESC backslash.
        assert_eq!(strip_ansi("a\u{1b}]0;my title\u{7}b"), "ab");
        assert_eq!(strip_ansi("a\u{1b}]0;my title\u{1b}\\b"), "ab");
    }

    #[test]
    fn a_truncated_sequence_does_not_eat_the_line() {
        // A sequence cut off mid-line must not swallow everything after it.
        assert_eq!(strip_ansi("done\u{1b}"), "done");
    }
}

/// Forwards one pipe of a child process, line by line, until it closes.
fn pump<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    key: String,
    project: String,
    cmd: String,
    pipe: R,
    stream: &'static str,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            emit(&app, &key, &project, &cmd, &line, stream);
        }
    });
}

fn emit(app: &AppHandle, key: &str, project: &str, cmd: &str, text: &str, stream: &str) {
    let _ = app.emit(
        LOG_EVENT,
        LogLine {
            key: key.to_string(),
            project: project.to_string(),
            cmd: cmd.to_string(),
            text: strip_ansi(text),
            stream: stream.to_string(),
            time: now_hms(),
        },
    );
}
