//! Small OS-specific helpers: process memory and "open this folder in ..." .

use std::path::Path;
use std::process::Command;

/// Resident set size of this process, used by the status bar.
pub fn rss_bytes() -> u64 {
    use sysinfo::{Pid, System};

    // `new_all` is not cheap, but this is polled every few seconds at most and
    // it is the one call whose signature is stable across sysinfo releases.
    let sys = System::new_all();
    sys.process(Pid::from_u32(std::process::id()))
        .map(|p| p.memory())
        .unwrap_or(0)
}

#[cfg(windows)]
fn detached(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new(program);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

#[cfg(not(windows))]
fn detached(program: &str) -> Command {
    Command::new(program)
}

fn ok(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(format!("{} no longer exists", path.display()))
    }
}

/// Opens the project in VS Code, falling back to the system file manager.
pub fn open_editor(path: &Path) -> Result<(), String> {
    ok(path)?;
    let dir = path.to_string_lossy().to_string();

    #[cfg(windows)]
    let launched = detached("cmd").args(["/C", "code", &dir]).spawn().is_ok();
    #[cfg(not(windows))]
    let launched = Command::new("code").arg(&dir).spawn().is_ok();

    if launched {
        return Ok(());
    }
    reveal(path)
}

/// Opens a terminal already sitting in the project directory.
pub fn open_terminal(path: &Path) -> Result<(), String> {
    ok(path)?;
    let dir = path.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        // Windows Terminal first, then a plain console.
        if detached("cmd").args(["/C", "start", "", "wt", "-d", &dir]).spawn().is_ok() {
            return Ok(());
        }
        detached("cmd")
            .args(["/C", "start", "", "cmd", "/K", "cd", "/d", &dir])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", &dir])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for term in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
            if Command::new(term).current_dir(path).spawn().is_ok() {
                return Ok(());
            }
        }
        Err("no terminal emulator found".into())
    }
}

/// Shows the directory in the system file manager.
pub fn reveal(path: &Path) -> Result<(), String> {
    ok(path)?;
    let dir = path.to_string_lossy().to_string();

    #[cfg(windows)]
    let result = Command::new("explorer").arg(&dir).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&dir).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&dir).spawn();

    result.map(|_| ()).map_err(|e| e.to_string())
}
