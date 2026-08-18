import { projectCount, since, size, tailPath } from "../format";
import type { App } from "../useApp";

export function StatusBar({ app }: { app: App }) {
  const { t, lang, projects, running, settings, scanning, scanNote, syncNote, elapsedMs, rss } = app;
  const clean = app.cleanProgress;

  // Measured in bytes: a single three-gigabyte directory is one step out of
  // `total`, and counting steps would hold the bar still for the whole removal.
  const cleanPct = clean?.totalBytes
    ? Math.min(100, Math.round((clean.freedBytes / clean.totalBytes) * 100))
    : clean?.total
      ? Math.round((clean.done / clean.total) * 100)
      : 0;

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
      {/* The cleanup runs behind the rest of the app, so this is where it
          reports - visible from every view, and in nobody's way. */}
      {clean && (
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ color: "var(--accTx)", whiteSpace: "nowrap" }}>
            {clean.phase === "rescan" ? t.cleaningRescan : t.cleaningDelete} {cleanPct}%
          </span>
          <span
            style={{
              width: 90,
              height: 4,
              borderRadius: 99,
              background: "rgba(var(--wrgb),.12)",
              overflow: "hidden",
              flex: "0 0 90px",
            }}
          >
            <span
              style={{
                display: "block",
                height: 4,
                borderRadius: 99,
                background: "var(--acc)",
                width: `${cleanPct}%`,
                transition: "width 200ms",
              }}
            />
          </span>
          <span style={{ color: "rgba(var(--trgb),.45)", whiteSpace: "nowrap" }}>
            {size(clean.freedBytes)}
            {clean.totalBytes > 0 && ` / ${size(clean.totalBytes)}`}
          </span>
          <span
            style={{
              color: "rgba(var(--trgb),.35)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 220,
            }}
            title={clean.current}
          >
            {clean.current ? tailPath(clean.current, 34) : ""}
          </span>
        </span>
      )}

      {/* Checking every remote takes a while and is worth watching, but it is
          not what the user is doing - so it reports here rather than in front
          of them. */}
      {syncNote && (
        <span style={{ color: "var(--accTx)", whiteSpace: "nowrap" }}>
          {t.syncCheckAll} · {syncNote}
        </span>
      )}

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
