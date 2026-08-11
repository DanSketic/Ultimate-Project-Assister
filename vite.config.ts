import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import pkg from "./package.json" with { type: "json" };

// Tauri drives this config: the dev server must stay on a fixed port and must
// never try to clear a terminal that the Rust side is already writing to.
export default defineConfig({
  plugins: [react()],
  // package.json is the single source of truth for the version; the status bar
  // reads it from here so the two can never drift apart.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // Tauri ships its own webview, so we can target a modern engine directly.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome110" : "safari15",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    outDir: "dist",
  },
});
