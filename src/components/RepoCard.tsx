// The housekeeping that is easy to leave undone and impossible to see from a
// checkout: whether the repository says what it is, whether anything guards
// the default branch, what secrets its workflows expect to find.
//
// Not a score out of ten. Each line is a fact, and the ones worth acting on
// are the ones said in the warning colour.

import { useEffect } from "react";

import { num } from "../format";
import type { App } from "../useApp";
import type { Project, RepoInfo } from "../types";

const mono = "'JetBrains Mono',monospace";

/** The things a repository is usually missing, in the order they matter. */
function gaps(info: RepoInfo, t: App["t"]): string[] {
  const out: string[] = [];
  if (info.archived) out.push(t.repoArchived);
  if (!info.description) out.push(t.repoNoDesc);
  if (!info.license && !info.private) out.push(t.repoNoLicence);
  if (info.topics.length === 0 && !info.private) out.push(t.repoNoTopics);
  if (info.protectedDefault === false) out.push(t.repoUnprotected);
  return out;
}

export function RepoBody({ project, app }: { project: Project; app: App }) {
  const { t, lang } = app;
  const info = app.repoInfo[project.id];

  useEffect(() => {
    if (info || !project.git.remote.includes("github")) return;
    void app.refreshRepoInfo(project.id);
  }, [info, project.id, project.git.remote, app]);

  if (!info) return <div style={note}>{t.checking}</div>;
  if (info.error) return <div style={note}>{info.error}</div>;

  const missing = gaps(info, t);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <a
          href={info.url}
          target="_blank"
          rel="noreferrer"
          style={{ fontFamily: mono, fontSize: 11, color: "var(--accTx)", textDecoration: "none" }}
        >
          {info.slug}
        </a>
        <Pill label={info.private ? t.repoPrivate : t.repoPublic} />
        {info.license && <Pill label={info.license} />}
        {info.protectedDefault === true && <Pill label={t.repoProtected} accent />}
      </div>

      {info.description && (
        <div style={{ fontSize: 12, color: "rgba(var(--trgb),.75)", lineHeight: 1.5 }}>
          {info.description}
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Fact label={t.repoStars} value={num(info.stars, lang)} />
        <Fact label={t.repoForks} value={num(info.forks, lang)} />
        <Fact label={t.repoIssues} value={num(info.openIssues, lang)} />
        <Fact label={t.branchL} value={info.defaultBranch || "—"} />
        {info.minutesIncluded > 0 && (
          <Fact
            label={t.repoMinutes}
            value={`${num(info.minutesUsed, lang)} / ${num(info.minutesIncluded, lang)}`}
          />
        )}
      </div>

      {info.topics.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {info.topics.slice(0, 10).map((topic) => (
            <Pill key={topic} label={topic} />
          ))}
        </div>
      )}

      {/* Names only. A secret's value is not readable through the API, and
          this app would not want it if it were. */}
      {info.secrets.length > 0 && (
        <div>
          <div style={label}>{t.repoSecrets}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
            {info.secrets.map((secret) => (
              <Pill key={secret} label={secret} />
            ))}
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {missing.map((gap) => (
            <div key={gap} style={{ fontSize: 11.5, color: "var(--warnTx)" }}>
              {gap}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const note = { fontSize: 11.5, color: "rgba(var(--trgb),.5)" } as const;

const label = {
  fontSize: 9.5,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "rgba(var(--trgb),.45)",
} as const;

function Fact({ label: name, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ display: "block", ...label }}>{name}</span>
      <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 500 }}>{value}</span>
    </span>
  );
}

function Pill({ label: text, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: 9.5,
        border: `1px solid ${accent ? "rgba(var(--accrgb),.4)" : "rgba(var(--wrgb),.12)"}`,
        background: accent ? "rgba(var(--accrgb),.1)" : "rgba(var(--wrgb),.03)",
        color: accent ? "var(--accTx)" : "rgba(var(--trgb),.7)",
        borderRadius: 99,
        padding: "1px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
