import type { CleanTarget, Lang, Rule } from "./types";
import type { T } from "./i18n";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Byte formatting that matches the design: "812 MB", "1.2 GB", "24 GB". */
export function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= GB) {
    const gb = bytes / GB;
    return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  }
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Thousands separator, following the design's `toLocaleString("hu-HU")`. */
export function num(value: number, lang: Lang): string {
  return value.toLocaleString(lang === "hu" ? "hu-HU" : "en-US");
}

export function ago(days: number, lang: Lang): string {
  if (days < 0) return "—";
  if (days === 0) return lang === "hu" ? "ma" : "today";
  if (days === 1) return lang === "hu" ? "1 napja" : "1 day ago";
  if (days < 60) return lang === "hu" ? `${days} napja` : `${days} days ago`;
  const months = Math.round(days / 30.4);
  if (months < 24) return lang === "hu" ? `${months} hónapja` : `${months} months ago`;
  const years = Math.round(months / 12);
  return lang === "hu" ? `${years} éve` : `${years} years ago`;
}

/** Relative time from a unix timestamp, down to minutes. */
export function since(unixSeconds: number, lang: Lang, now = Date.now()): string {
  const secs = Math.max(0, Math.round(now / 1000) - unixSeconds);
  if (secs < 90) return lang === "hu" ? "az imént" : "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return lang === "hu" ? `${mins} perce` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return lang === "hu" ? `${hours} órája` : `${hours} h ago`;
  return ago(Math.round(hours / 24), lang);
}

export interface DueInfo {
  label: string;
  bd: string;
  bg: string;
  fg: string;
}

/** Deadline badge colours, matching the design's `dueInfo`. */
export function dueInfo(due: string, t: T, now = new Date()): DueInfo {
  if (!due) {
    return { label: t.noDue, bd: "rgba(var(--wrgb),.14)", bg: "transparent", fg: "inherit" };
  }
  const target = new Date(`${due}T12:00:00`);
  if (Number.isNaN(target.getTime())) {
    return { label: t.noDue, bd: "rgba(var(--wrgb),.14)", bg: "transparent", fg: "inherit" };
  }

  const days = Math.round((target.getTime() - now.getTime()) / 864e5);
  if (days < 0) {
    return {
      label: `${t.overdue} ${Math.abs(days)}d`,
      bd: "rgba(var(--danrgb),.55)",
      bg: "rgba(var(--danrgb),.18)",
      fg: "var(--danTx2)",
    };
  }
  if (days === 0) {
    return {
      label: t.todayL,
      bd: "rgba(var(--accrgb),.5)",
      bg: "rgba(var(--accrgb),.16)",
      fg: "var(--accTx)",
    };
  }
  return {
    label: `${days} ${t.dueIn}`,
    bd: "rgba(var(--wrgb),.14)",
    bg: "transparent",
    fg: "inherit",
  };
}

export function isOverdue(due: string, now = new Date()): boolean {
  if (!due) return false;
  const target = new Date(`${due}T12:00:00`);
  return !Number.isNaN(target.getTime()) && target.getTime() < now.getTime();
}

/** Active / inactive chip colours. */
export function chip(active: boolean): { bg: string; fg: string } {
  return active
    ? { bg: "rgba(var(--wrgb),.11)", fg: "var(--t0)" }
    : { bg: "transparent", fg: "rgba(var(--trgb),.5)" };
}

export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Keeps the informative tail of a long path. CSS can only ellipsise at the
 * end, and the `direction: rtl` trick reorders the separators in a Windows
 * path, so the truncation happens here instead.
 */
export function tailPath(path: string, max = 46): string {
  return path.length <= max ? path : `…${path.slice(path.length - max + 1)}`;
}

/**
 * Identifies a running command. The working directory is part of the key so
 * `npm run dev` in a monorepo's frontend and backend stay independent.
 */
export function cmdKey(project: string, cmd: { cwd: string; cmd: string }): string {
  return `${project}|${cmd.cwd}|${cmd.cmd}`;
}

/** "1 project" / "25 projects" - Hungarian uses the same word for both. */
export function projectCount(n: number, t: T): string {
  return `${n} ${n === 1 ? t.statProject : t.statProjects}`;
}

/** Short manifest list shown next to a project in the Commands view. */
export function manifestLabel(manifests: string[]): string {
  return manifests.length ? manifests.slice(0, 3).join(" · ") : "—";
}

/** Deterministic id for locally created goals, features and notes. */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** `*` matches within a path segment, `**` matches across segments. */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // Expanded in one pass. An earlier version swapped `**` for a placeholder
    // character first, which a pattern could contain itself.
    .replace(/\*\*|\*|\?/g, (token) =>
      token === "**" ? ".*" : token === "*" ? "[^\\\\/]*" : ".",
    );
  return new RegExp(`^${body}$`, "i");
}

/** A rule scoped to one project reads `keep: <project>`. */
export function ruleProject(rule: Rule): string | null {
  const match = /^keep:\s*(.+)$/i.exec(rule.scope.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Exclusion rules keep a target out of the automatic selection. They never
 * hide it from the list - the user can still tick it by hand.
 */
export function isExcluded(target: CleanTarget, rules: Rule[]): boolean {
  const leaf = target.path.split(/[\\/]/).filter(Boolean).pop() ?? "";

  return rules.some((rule) => {
    const scoped = ruleProject(rule);
    if (scoped && scoped !== target.project) return false;
    const re = globToRegExp(rule.pattern);
    return re.test(target.cat) || re.test(leaf) || re.test(target.path);
  });
}
