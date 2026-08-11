import * as api from "../api";
import { Chevron, Close, Minus, Monitor, Moon, Square, Sun } from "./Icons";
import type { App } from "../useApp";
import type { Theme } from "../types";

const CELL_ON = { bg: "rgba(var(--wrgb),.13)", fg: "var(--t0)" };
const CELL_OFF = { bg: "transparent", fg: "rgba(var(--trgb),.5)" };

export function TitleBar({ app }: { app: App }) {
  const { t, theme, view, current, projects } = app;
  const cell = (k: Theme) => (theme === k ? CELL_ON : CELL_OFF);

  const crumb =
    view === "detail" && current
      ? current.path
      : `${app.settings?.folders[0] ?? "—"} · ${projects.length} ${t.statProjects}`;

  const setTheme = (next: Theme) => app.patchSettings({ theme: next });

  return (
    <div
      style={{
        height: 40,
        flex: "0 0 40px",
        borderBottom: "1px solid rgba(var(--wrgb),.07)",
        display: "flex",
        alignItems: "stretch",
        position: "relative",
        zIndex: 2,
      }}
    >
      <div
        data-tauri-drag-region
        onDoubleClick={() => void app.toggleMax()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 12px",
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 19,
            height: 19,
            borderRadius: 6,
            background: "linear-gradient(140deg,var(--acc),#8fd12a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 19px",
            boxShadow: "0 0 18px rgba(var(--accrgb),.35)",
            color: "#14180a",
          }}
        >
          <Chevron size={11} strokeWidth={3} />
        </div>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: "-.01em",
            whiteSpace: "nowrap",
          }}
        >
          Ultimate Project Assister
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10.5,
            color: "rgba(var(--trgb),.52)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            paddingLeft: 2,
          }}
        >
          {crumb}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px" }}>
        <div
          style={{
            display: "flex",
            gap: 1,
            background: "rgba(var(--wrgb),.05)",
            border: "1px solid rgba(var(--wrgb),.07)",
            borderRadius: 9,
            padding: 2,
          }}
        >
          <button
            type="button"
            onClick={() => setTheme("auto")}
            title={t.themeAuto}
            style={{
              border: 0,
              borderRadius: 7,
              background: cell("auto").bg,
              color: cell("auto").fg,
              padding: "3px 7px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              transition: "all 140ms",
            }}
          >
            <Monitor size={12} />
            <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".04em" }}>
              {t.autoShort}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTheme("light")}
            title={t.themeLight}
            style={{
              border: 0,
              borderRadius: 7,
              background: cell("light").bg,
              color: cell("light").fg,
              padding: "3px 7px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              transition: "all 140ms",
            }}
          >
            <Sun size={13} />
          </button>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            title={t.themeDark}
            style={{
              border: 0,
              borderRadius: 7,
              background: cell("dark").bg,
              color: cell("dark").fg,
              padding: "3px 7px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              transition: "all 140ms",
            }}
          >
            <Moon size={13} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", paddingRight: 4 }}>
        <button
          type="button"
          title="Minimize"
          className="h-ghost"
          onClick={() => void api.minimizeWindow()}
          style={winButton}
        >
          <Minus size={11} />
        </button>
        <button
          type="button"
          title="Maximize"
          className="h-ghost"
          onClick={() => void app.toggleMax()}
          style={winButton}
        >
          <Square size={11} />
        </button>
        <button
          type="button"
          title="Close"
          className="h-close"
          onClick={() => void api.closeWindow()}
          style={winButton}
        >
          <Close size={11} />
        </button>
      </div>
    </div>
  );
}

const winButton = {
  width: 34,
  border: 0,
  background: "transparent",
  color: "rgba(var(--trgb),.55)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
} as const;
