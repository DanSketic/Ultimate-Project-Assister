//! The tray icon, and what closing the window means.
//!
//! A dashboard is not a document: you close it the way you close a drawer, and
//! most of the time you want it back a minute later. So the window can be shut
//! without the app stopping - the scans, the running commands and the log
//! streams all outlive it - and the icon in the notification area is what
//! brings it back.
//!
//! Which of the two the close button does is the user's choice, in Settings.
//! Nothing here decides it: this module only carries it out.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::commands::AppState;

/// The id the tray icon is filed under, so its menu can be rebuilt later.
const TRAY_ID: &str = "upa-tray";

/// Labels for the tray menu. Not in `i18n.ts` with the rest: this menu is
/// drawn by the operating system, long before any webview exists to ask.
struct Labels {
    open: &'static str,
    quit: &'static str,
    tip: &'static str,
}

fn labels(lang: &str) -> Labels {
    if lang == "en" {
        Labels {
            open: "Open",
            quit: "Quit",
            tip: "Ultimate Project Assister",
        }
    } else {
        Labels {
            open: "Megnyitás",
            quit: "Kilépés",
            tip: "Ultimate Project Assister",
        }
    }
}

/// Puts the icon in the notification area.
///
/// The icon is there whether or not closing goes to the tray: it is also how
/// you find a window that was minimised, and how you leave for good without
/// hunting for the window first.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let lang = app.state::<AppState>().store.settings().lang;
    let text = labels(&lang);

    let menu = build_menu(app, &text)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        // The menu belongs to the right button; the left one shows the window,
        // which is what every other tray application does.
        .show_menu_on_left_click(false)
        .tooltip(text.tip)
        .on_menu_event(on_menu)
        .on_tray_icon_event(on_icon);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// Rebuilds the menu in the language now chosen. The operating system drew the
/// old one, so switching language has to reach it explicitly.
pub fn relabel(app: &AppHandle, lang: &str) {
    let text = labels(lang);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = build_menu(app, &text) {
            let _ = tray.set_menu(Some(menu));
        }
        let _ = tray.set_tooltip(Some(text.tip));
    }
}

fn build_menu(app: &AppHandle, text: &Labels) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", text.open, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", text.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &separator, &quit])
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        "open" => show(app),
        "quit" => quit(app),
        _ => {}
    }
}

fn on_icon(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } =
        event
    {
        show(tray.app_handle());
    }
}

/// Brings the window back, wherever it was left: hidden, minimised, or behind
/// something else.
pub fn show(app: &AppHandle) {
    let Some(window) = main_window(app) else { return };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Leaves for good.
///
/// The flag tells the close handler this one is not to be turned into a hide;
/// the windows are then closed, and the app ends when the last of them goes.
/// Asking the runtime to exit while it is dispatching an event of its own does
/// not always take, which is why this goes through the windows rather than
/// straight to `exit`.
pub fn quit(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        *state.quitting.lock().unwrap() = true;
    }
    // With the flag set, closing the windows is no longer turned into a hide,
    // and the close handler shuts the app down for us.
    for (_, window) in app.webview_windows() {
        let _ = window.close();
    }
    app.exit(0);
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Whether a close should hide the window instead of ending the app.
///
/// False once quitting has begun, whatever the setting says - otherwise the
/// tray's own Quit would be swallowed by the window it is closing.
pub fn close_hides(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };
    if *state.quitting.lock().unwrap() {
        return false;
    }
    state.store.settings().close_to_tray
}

/// Says, once ever, that the app is still running after its window closed.
///
/// A window that vanishes with the app still working is alarming exactly once;
/// after that it is the arrangement the user chose, and saying it again every
/// time would be nagging.
pub fn announce_once(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let settings = state.store.settings();
    if settings.tray_noticed {
        return;
    }

    let (title, body) = if settings.lang == "en" {
        (
            "Still running",
            "The window is closed, but the app is in the notification area. Click its icon to bring it back, or change this in Settings.",
        )
    } else {
        (
            "Tovább fut",
            "Az ablak bezárult, de az app a tálcán fut tovább. Az ikonjára kattintva jön vissza; a Beállításokban átállítható.",
        )
    };

    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();

    let mut next = settings;
    next.tray_noticed = true;
    let _ = state.store.set_settings(next);
}
