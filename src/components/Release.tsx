// Whether a version in the changelog ever reached GitHub.
//
// The app already reads `CHANGELOG.md` and the local tags; GitHub holds the
// third thing - the release itself. Putting the three side by side answers the
// question that actually comes up: is this written down but never shipped?

import { useEffect, useState } from "react";

import type { App } from "../useApp";
import type { ChangeEntry, Project } from "../types";

const mono = "'JetBrains Mono',monospace";

/** A changelog heading that is a version rather than a holding place. */
function isVersion(ver: string): boolean {
  return /^v?\d+\.\d+/.test(ver.trim());
}

/** The release matching a changelog version, with or without a `v`. */
function releaseFor(app: App, projectId: string, ver: string) {
  const want = ver.trim().replace(/^v/, "").toLowerCase();
  return (app.releases[projectId] ?? []).find(
    (release) => release.tag.replace(/^v/, "").toLowerCase() === want,
  );
}

export function ReleaseMark({
  project,
  entry,
  app,
}: {
  project: Project;
  entry: ChangeEntry;
  app: App;
}) {
  const { t } = app;
  const [armed, setArmed] = useState(false);
  const known = app.releases[project.id];

  // Asked for once per project, when the first section wants to know.
  useEffect(() => {
    if (known || !project.git.remote.includes("github")) return;
    void app.refreshReleases(project.id);
  }, [known, project.id, project.git.remote, app]);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!project.git.remote.includes("github") || !known) return null;

  const release = releaseFor(app, project.id, entry.ver);
  if (release) {
    return (
      <a
        href={release.url}
        target="_blank"
        rel="noreferrer"
        title={release.name || release.tag}
        style={{
          display: "inline-block",
          marginTop: 5,
          fontFamily: mono,
          fontSize: 9.5,
          fontWeight: 500,
          color: release.draft ? "rgba(var(--trgb),.55)" : "var(--accTx)",
          textDecoration: "none",
        }}
      >
        {release.draft ? t.relDraft : t.relPublished}
      </a>
    );
  }

  // A section with no version number - `Unreleased` and its like - is a place
  // to collect entries, not something a tag can be cut from.
  if (!isVersion(entry.ver)) {
    return (
      <div style={{ marginTop: 5, fontFamily: mono, fontSize: 9.5, color: "rgba(var(--trgb),.4)" }}>
        {t.relNone}
      </div>
    );
  }

  const busy = app.releaseBusy === entry.ver;
  return (
    <button
      type="button"
      className="h-accent"
      disabled={busy}
      title={t.relDraftTitle}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        void app.draftRelease(project.id, entry.ver);
      }}
      style={{
        marginTop: 5,
        border: "1px solid rgba(var(--accrgb),.4)",
        borderRadius: 8,
        background: "rgba(var(--accrgb),.1)",
        color: "var(--accTx)",
        padding: "2px 7px",
        cursor: busy ? "default" : "pointer",
        fontSize: 9.5,
        fontWeight: 600,
        opacity: busy ? 0.55 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {armed ? t.runSure : t.relDraftIt}
    </button>
  );
}
