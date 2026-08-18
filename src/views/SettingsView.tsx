import * as api from "../api";
import { ChipGroup } from "../components/Chips";
import { Folder, Plus } from "../components/Icons";
import { projectCount } from "../format";
import type { App } from "../useApp";
import type { Anchor, Lang, Toggles } from "../types";

const card = {
  border: "1px solid rgba(var(--wrgb),.08)",
  borderRadius: 14,
  background: "rgba(var(--wrgb),.022)",
  padding: "15px 17px",
} as const;

const cardTitle = {
  fontSize: 10.5,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "rgba(var(--trgb),.56)",
  marginBottom: 6,
} as const;

export function SettingsView({ app }: { app: App }) {
  const { t, settings, projects } = app;
  if (!settings) return null;

  const projectsIn = (folder: string) =>
    projects.filter((p) => p.path.toLowerCase().startsWith(folder.toLowerCase())).length;

  const addFolder = async () => {
    const picked = await api.pickFolder();
    if (!picked || settings.folders.includes(picked)) return;
    app.patchSettings({ folders: [...settings.folders, picked] });
    // A new root only shows up after a walk.
    void app.rescan({ ...settings, folders: [...settings.folders, picked] });
  };

  const removeFolder = (index: number) => {
    const folders = settings.folders.filter((_, i) => i !== index);
    app.patchSettings({ folders });
    void app.rescan({ ...settings, folders });
  };

  const toggleRows: Array<{ key: keyof Toggles; label: string; hint: string }> = [
    { key: "scanStart", label: t.scanStart, hint: t.scanStartH },
    { key: "watchFs", label: t.watchFs, hint: t.watchFsH },
    { key: "deepGit", label: t.deepGit, hint: t.deepGitH },
    { key: "docker", label: t.dockerL, hint: t.dockerH },
  ];

  return (
    <div
      style={{
        padding: "0 20px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        maxWidth: 740,
      }}
    >
      <div style={card}>
        <div style={cardTitle}>{t.watched}</div>

        {settings.folders.length === 0 && (
          <div style={{ fontSize: 12, color: "rgba(var(--trgb),.5)", padding: "8px 0" }}>
            {t.noFolders}
          </div>
        )}

        {settings.folders.map((folder, i) => (
          <div
            key={folder}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 0",
              borderTop: "1px solid rgba(var(--wrgb),.06)",
            }}
          >
            <Folder size={14} style={{ flex: "0 0 14px", color: "rgba(var(--trgb),.56)" }} />
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 12,
                flex: 1,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={folder}
            >
              {folder}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 10.5,
                color: "rgba(var(--trgb),.56)",
              }}
            >
              {projectCount(projectsIn(folder), t)}
            </span>
            <button
              type="button"
              className="h-folder-x"
              onClick={() => removeFolder(i)}
              style={{
                border: "1px solid rgba(var(--wrgb),.1)",
                borderRadius: 8,
                background: "transparent",
                padding: "4px 9px",
                cursor: "pointer",
                fontSize: 10.5,
                fontWeight: 500,
                color: "rgba(var(--trgb),.6)",
              }}
            >
              {t.removeL}
            </button>
          </div>
        ))}

        <button
          type="button"
          className="h-accent"
          onClick={() => void addFolder()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            border: "1px solid rgba(var(--wrgb),.1)",
            borderRadius: 9,
            background: "rgba(var(--wrgb),.03)",
            padding: "8px 12px",
            cursor: "pointer",
            fontSize: 11.5,
            fontWeight: 500,
            color: "rgba(var(--trgb),.8)",
          }}
        >
          <Plus size={13} />
          {t.addFolder}
        </button>
      </div>

      <div style={card}>
        <div style={cardTitle}>{t.scanOpts}</div>
        {toggleRows.map((row) => (
          <ToggleRow
            key={row.key}
            on={settings.toggles[row.key]}
            label={row.label}
            hint={row.hint}
            onToggle={() =>
              app.patchSettings({
                toggles: { ...settings.toggles, [row.key]: !settings.toggles[row.key] },
              })
            }
          />
        ))}
      </div>

      <div style={card}>
        <div style={cardTitle}>{t.notifyOpts}</div>
        <ToggleRow
          on={settings.osNotifications}
          label={t.osNotify}
          hint={t.osNotifyH}
          onToggle={() => void app.setOsNotifications(!settings.osNotifications)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 11 }}>{t.threshold}</div>
          <ChipGroup
            items={[7, 30, 90].map((d) => ({
              key: String(d),
              label: `${d} ${app.lang === "hu" ? "nap" : "days"}`,
            }))}
            active={String(settings.ageDays)}
            onPick={(k) => app.patchSettings({ ageDays: Number(k) })}
            mono
          />
          <div
            style={{
              fontSize: 11.5,
              color: "rgba(var(--trgb),.4)",
              marginTop: 10,
              maxWidth: "34ch",
            }}
          >
            {t.thresholdHint}
          </div>
        </div>

        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 11 }}>{t.anchorL}</div>
          <ChipGroup
            items={[
              { key: "left", label: t.anchorLeft },
              { key: "right", label: t.anchorRight },
            ]}
            active={settings.anchor}
            onPick={(k) => app.patchSettings({ anchor: k as Anchor })}
          />
          <div
            style={{
              fontSize: 11.5,
              color: "rgba(var(--trgb),.4)",
              marginTop: 10,
              maxWidth: "34ch",
            }}
          >
            {t.anchorHint}
          </div>
        </div>

        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 11 }}>{t.langL}</div>
          <div
            style={{
              display: "flex",
              gap: 3,
              background: "rgba(var(--wrgb),.035)",
              border: "1px solid rgba(var(--wrgb),.07)",
              borderRadius: 10,
              padding: 3,
              width: "fit-content",
            }}
          >
            {(
              [
                ["hu", "Magyar"],
                ["en", "English"],
              ] as Array<[Lang, string]>
            ).map(([code, label]) => {
              const on = settings.lang === code;
              return (
                <button
                  key={code}
                  type="button"
                  className="h-seg"
                  onClick={() => app.patchSettings({ lang: code })}
                  style={{
                    border: 0,
                    borderRadius: 7,
                    background: on ? "rgba(var(--wrgb),.13)" : "transparent",
                    color: on ? "var(--t0)" : "rgba(var(--trgb),.45)",
                    padding: "6px 14px",
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontWeight: 500,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "rgba(var(--trgb),.4)",
              marginTop: 10,
              maxWidth: "34ch",
            }}
          >
            {t.langHint}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The switch used by every settings toggle, so they cannot drift apart. */
function ToggleRow({
  on,
  label,
  hint,
  onToggle,
}: {
  on: boolean;
  label: string;
  hint: string;
  onToggle: () => void;
}) {
  return (
    <div
      role="switch"
      aria-checked={on}
      tabIndex={0}
      className="h-soft-3"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "10px 6px",
        borderTop: "1px solid rgba(var(--wrgb),.06)",
        borderRadius: 9,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 34,
          height: 19,
          borderRadius: 99,
          border: `1px solid ${on ? "var(--acc)" : "rgba(var(--wrgb),.14)"}`,
          background: on ? "var(--acc)" : "rgba(var(--wrgb),.06)",
          flex: "0 0 34px",
          display: "flex",
          alignItems: "center",
          padding: 2,
          justifyContent: on ? "flex-end" : "flex-start",
          transition: "all 180ms",
        }}
      >
        <div
          style={{
            width: 13,
            height: 13,
            borderRadius: 99,
            background: on ? "#14180a" : "rgba(var(--trgb),.45)",
            transition: "all 180ms",
          }}
        />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.4)", marginTop: 1 }}>{hint}</div>
      </div>
    </div>
  );
}
