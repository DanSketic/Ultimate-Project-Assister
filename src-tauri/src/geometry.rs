//! Remembers where the window is and how big the user made it.
//!
//! The geometry is owned by the backend rather than the webview: it is read
//! straight from the window handle, it keeps working while the frontend is busy
//! scanning, and it can be flushed one last time on shutdown.
//!
//! A sample is only written once two consecutive reads agree, which means the
//! window has come to rest - mid-drag and mid-animation positions are never
//! recorded. The frontend contributes only the current view name, so a
//! remembered width is filed against the view it was measured on.

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::commands::AppState;
use crate::store::WindowState;

const SAMPLE_EVERY: Duration = Duration::from_millis(600);

/// Reads the current geometry, expressed in logical pixels.
pub fn capture(app: &AppHandle) -> Option<WindowState> {
    let window = app.get_webview_window("main")?;
    let state = app.try_state::<AppState>()?;
    let stored = state.store.settings().window;

    // A maximized window says nothing about the size to restore later, so only
    // the flag moves.
    if window.is_maximized().unwrap_or(false) {
        return Some(WindowState { maximized: true, ..stored });
    }

    let scale = window.scale_factor().unwrap_or(1.0);
    let size = window.inner_size().ok()?;
    let position = window.outer_position().ok()?;
    let logical = |v: f64| (v / scale).round();

    let width = logical(size.width as f64) as u32;
    let nav_width = *state.nav_width.lock().unwrap();
    let view = state.view.lock().unwrap().clone();

    let mut widths = stored.widths;
    widths.insert(view, width.saturating_sub(nav_width));

    Some(WindowState {
        x: Some(logical(position.x as f64) as i32),
        y: Some(logical(position.y as f64) as i32),
        height: Some(logical(size.height as f64) as u32),
        maximized: false,
        widths,
    })
}

/// Persists the geometry immediately. Used on shutdown.
pub fn flush(app: &AppHandle) {
    if let (Some(current), Some(state)) = (capture(app), app.try_state::<AppState>()) {
        let _ = state.store.set_window(current);
    }
}

/// Starts the background sampler.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut previous: Option<WindowState> = None;
        loop {
            std::thread::sleep(SAMPLE_EVERY);

            let Some(current) = capture(&app) else { continue };
            if previous.as_ref() == Some(&current) {
                if let Some(state) = app.try_state::<AppState>() {
                    let _ = state.store.set_window(current.clone());
                }
            }
            previous = Some(current);
        }
    });
}
