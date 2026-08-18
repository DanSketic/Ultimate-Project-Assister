// Windows / macOS / Linux notifications, via the Tauri plugin.
//
// Kept apart from the in-app notices so the application never has to know
// whether the platform can post one: `send` is safe to call always and simply
// does nothing where it cannot work.

import { IS_TAURI } from "./api";

/** Cached so permission is asked for once, not on every notification. */
let allowed: boolean | null = null;

async function plugin() {
  return await import("@tauri-apps/plugin-notification");
}

/**
 * Whether the OS will accept a notification from us, asking the first time.
 *
 * A refusal is remembered for the session: asking again on every message would
 * be worse than not notifying at all.
 */
export async function ensurePermission(): Promise<boolean> {
  if (!IS_TAURI) return false;
  if (allowed !== null) return allowed;

  try {
    const { isPermissionGranted, requestPermission } = await plugin();
    allowed = (await isPermissionGranted()) || (await requestPermission()) === "granted";
  } catch {
    // No notification service on this machine; not an error worth reporting.
    allowed = false;
  }
  return allowed;
}

/** Posts a desktop notification. Silently does nothing when it cannot. */
export async function send(title: string, body: string): Promise<void> {
  if (!(await ensurePermission())) return;
  try {
    const { sendNotification } = await plugin();
    sendNotification({ title, body });
  } catch {
    // A failure here must never take down whatever was being reported.
  }
}
