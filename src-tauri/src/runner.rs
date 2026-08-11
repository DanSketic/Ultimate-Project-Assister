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

/// Identifies a running command. The working directory is part of the key so
/// that `npm run dev` in a monorepo's `frontend` and `backend` are distinct.
pub fn key_of(project: &str, cwd: &str, cmd: &str) -> String {
    format!("{project}|{cwd}|{cmd}")
}

fn now_hms() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
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

    pub fn start(
        &self,
        app: &AppHandle,
        project: &str,
        dir: &Path,
        rel: &str,
        cmd: &str,
    ) -> Result<(), String> {
        let key = key_of(project, rel, cmd);
        if self.is_running(&key) {
            return Err("already running".into());
        }
        if !dir.is_dir() {
            return Err(format!("{} no longer exists", dir.display()));
        }

        let mut child = shell(cmd)
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start `{cmd}`: {e}"))?;

        let pid = child.id();
        self.procs.lock().unwrap().insert(key.clone(), pid);

        emit(app, &key, project, cmd, &format!("$ {cmd}  ({project})"), "cmd");

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

    pub fn stop(&self, project: &str, rel: &str, cmd: &str) -> Result<(), String> {
        let key = key_of(project, rel, cmd);
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
            text: text.to_string(),
            stream: stream.to_string(),
            time: now_hms(),
        },
    );
}
