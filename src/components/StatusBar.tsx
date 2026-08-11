import { projectCount, since, size } from "../format";
import type { App } from "../useApp";

export function StatusBar({ app }: { app: App }) {
  const { t, lang, projects, running, settings, scanning, scanNote, elapsedMs, rss } = app;

  // Before the first scan of this session finishes, whatever is on screen came
  // out of the previous session's cache - say so rather than claiming a scan.
  const cachedAt = projects.reduce((newest, p) => Math.max(newest, p.scannedAt), 0);
  const scanLabel = scanning
    ? `${t.scanning} ${scanNote}`
    : elapsedMs
      ? `${t.statScan} · ${(elapsedMs / 1000).toFixed(1)} s`
      : cachedAt
        ? `${t.cachedL} · ${since(cachedAt, lang)}`
        : t.statScan;

  return (
    <div
      style={{
        flex: "0 0 30px",
        height: 30,
        borderTop: "1px solid rgba(var(--wrgb),.07)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 16px",
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 10,
        color: "rgba(var(--trgb),.56)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 99,
            background: "var(--acc)",
            boxShadow: "0 0 8px rgba(var(--accrgb),.8)",
            animation: scanning ? "upaPulse 1.2s infinite" : undefined,
          }}
        />
        {scanLabel}
      </span>
      <span>{projectCount(projects.length, t)}</span>
      <span>
        {running.size} {t.runningL}
      </span>
      <span style={{ marginLeft: "auto" }}>
        {size(settings?.freedBytes ?? 0)} {t.statFreed}
      </span>
      <span style={{ color: "rgba(var(--trgb),.44)" }}>rss {size(rss)}</span>
    </div>
  );
}
