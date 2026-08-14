// A small markdown renderer, enough for the README and changelog panels.
//
// Deliberately not a dependency: the app ships no runtime libraries beyond
// React and the Tauri bindings, and a README needs headings, lists, code,
// tables and emphasis - not a full CommonMark implementation.
//
// Nothing here builds HTML from the source text; every element is a React node,
// so a README with markup in it renders as text rather than as markup.

import { Fragment, type CSSProperties, type ReactNode } from "react";

/**
 * Inline spans, in the order they are tried.
 *
 * Underscore emphasis is deliberately absent. `snake_case_names` are everywhere
 * in the kind of README this reads, and treating the middle of one as italics
 * is a worse failure than not italicising the rare `_word_`.
 */
const INLINE = new RegExp(
  [
    "(`[^`]+`)", // code
    "(\\*\\*[^*]+\\*\\*)", // bold
    "(~~[^~]+~~)", // strikethrough
    "(\\*(?!\\s)[^*]+\\*)", // italic
    "(!?\\[[^\\]]*\\]\\([^)\\s]*[^)]*\\))", // link / image
    "(<https?://[^>]+>)", // angle autolink
    "(https?://[^\\s<>()\\[\\]]+)", // bare autolink
  ].join("|"),
  "g",
);

const code: CSSProperties = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: "0.88em",
  background: "rgba(var(--wrgb),.06)",
  border: "1px solid rgba(var(--wrgb),.08)",
  borderRadius: 5,
  padding: "1px 5px",
};

/**
 * A link is shown, not followed. The app has no business opening arbitrary
 * URLs out of a file it merely scanned, so the address goes in the tooltip and
 * the text stays put.
 */
function Link({ text, href }: { text: string; href: string }) {
  return (
    <span style={{ color: "var(--accTx)", textDecoration: "underline", textUnderlineOffset: 2 }} title={href}>
      {text}
    </span>
  );
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;

  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    last = at + m[0].length;
    const key = `${keyPrefix}i${n++}`;
    const tok = m[0];

    if (tok.startsWith("`")) {
      out.push(
        <code key={key} style={code}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("~~")) {
      out.push(
        <span key={key} style={{ textDecoration: "line-through", opacity: 0.6 }}>
          {tok.slice(2, -2)}
        </span>,
      );
    } else if (tok.startsWith("*")) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("![")) {
      // Images cannot resolve: the paths are relative to a folder the webview
      // does not serve. The alt text is the part that carries meaning anyway.
      const alt = tok.slice(2, tok.indexOf("]"));
      if (alt) {
        out.push(
          <span key={key} style={{ opacity: 0.55, fontStyle: "italic" }}>
            {alt}
          </span>,
        );
      }
    } else if (tok.startsWith("[")) {
      const split = tok.indexOf("](");
      out.push(<Link key={key} text={tok.slice(1, split)} href={tok.slice(split + 2, -1)} />);
    } else if (tok.startsWith("<")) {
      out.push(<Link key={key} text={tok.slice(1, -1)} href={tok.slice(1, -1)} />);
    } else {
      out.push(<Link key={key} text={tok} href={tok} />);
    }
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEAD_SIZE = [17, 15, 13.5, 12.5, 12, 12];

/** `| a | b |` -> `["a", "b"]`, tolerating a missing trailing pipe. */
function cells(row: string): string[] {
  return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

function isDivider(row: string): boolean {
  const c = cells(row);
  return c.length > 0 && c.every((x) => /^:?-{2,}:?$/.test(x));
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let n = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const key = `p${n++}`;
    out.push(
      <p key={key} style={{ margin: "0 0 9px" }}>
        {inline(para.join(" "), key)}
      </p>,
    );
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      flushPara();
      continue;
    }

    // --- fenced code ------------------------------------------------------
    if (trimmed.startsWith("```")) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        body.push(lines[i] ?? "");
        i++;
      }
      out.push(
        <pre
          key={`c${n++}`}
          style={{
            margin: "0 0 10px",
            padding: "9px 11px",
            borderRadius: 9,
            border: "1px solid rgba(var(--wrgb),.08)",
            background: "rgba(var(--wrgb),.05)",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 11,
            lineHeight: 1.55,
            overflowX: "auto",
          }}
        >
          {body.join("\n")}
        </pre>,
      );
      continue;
    }

    // --- horizontal rule --------------------------------------------------
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      out.push(
        <div
          key={`h${n++}`}
          style={{ height: 1, background: "rgba(var(--wrgb),.1)", margin: "12px 0" }}
        />,
      );
      continue;
    }

    // --- heading ----------------------------------------------------------
    const head = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (head) {
      flushPara();
      const depth = (head[1] ?? "#").length;
      const key = `t${n++}`;
      out.push(
        <div
          key={key}
          style={{
            fontSize: HEAD_SIZE[depth - 1],
            fontWeight: depth <= 2 ? 650 : 600,
            letterSpacing: "-.01em",
            margin: out.length === 0 ? "0 0 8px" : "14px 0 7px",
            color: "var(--t0)",
          }}
        >
          {inline(head[2] ?? "", key)}
        </div>,
      );
      continue;
    }

    // --- table ------------------------------------------------------------
    if (trimmed.startsWith("|") && isDivider(lines[i + 1]?.trim() ?? "")) {
      flushPara();
      const header = cells(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        rows.push(cells((lines[i] ?? "").trim()));
        i++;
      }
      i--;
      const key = `b${n++}`;
      out.push(
        <div key={key} style={{ overflowX: "auto", margin: "0 0 11px" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "100%" }}>
            <thead>
              <tr>
                {header.map((h, x) => (
                  <th
                    key={x}
                    style={{
                      textAlign: "left",
                      fontWeight: 600,
                      padding: "5px 11px 5px 0",
                      borderBottom: "1px solid rgba(var(--wrgb),.14)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inline(h, `${key}h${x}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, y) => (
                <tr key={y}>
                  {r.map((c, x) => (
                    <td
                      key={x}
                      style={{
                        padding: "5px 11px 5px 0",
                        borderBottom: "1px solid rgba(var(--wrgb),.06)",
                        verticalAlign: "top",
                      }}
                    >
                      {inline(c, `${key}r${y}c${x}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // --- blockquote -------------------------------------------------------
    if (trimmed.startsWith("> ") || trimmed === ">") {
      flushPara();
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        body.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i++;
      }
      i--;
      const key = `q${n++}`;
      out.push(
        <div
          key={key}
          style={{
            borderLeft: "2px solid rgba(var(--accrgb),.45)",
            padding: "2px 0 2px 11px",
            margin: "0 0 10px",
            color: "rgba(var(--trgb),.72)",
          }}
        >
          {inline(body.join(" "), key)}
        </div>,
      );
      continue;
    }

    // --- list -------------------------------------------------------------
    const bullet = /^([-*+]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushPara();
      const ordered = !/^[-*+]$/.test(bullet[1] ?? "");
      const items: Array<{ depth: number; text: string }> = [];

      while (i < lines.length) {
        const raw = lines[i] ?? "";
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
        if (item) {
          items.push({
            depth: Math.min(2, Math.floor((item[1] ?? "").replace(/\t/g, "  ").length / 2)),
            text: item[3] ?? "",
          });
          i++;
          continue;
        }
        // An indented continuation belongs to the item above it.
        if (raw.trim() !== "" && /^\s{2,}/.test(raw) && items.length > 0) {
          const prev = items[items.length - 1];
          if (prev) prev.text += ` ${raw.trim()}`;
          i++;
          continue;
        }
        break;
      }
      i--;

      const key = `l${n++}`;
      out.push(
        <div key={key} style={{ margin: "0 0 10px", display: "flex", flexDirection: "column", gap: 3 }}>
          {items.map((item, x) => (
            <div
              key={x}
              style={{
                display: "flex",
                gap: 8,
                paddingLeft: item.depth * 15,
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  color: "rgba(var(--accrgb),.7)",
                  flex: "0 0 auto",
                  fontFamily: ordered ? "'JetBrains Mono',monospace" : undefined,
                  fontSize: ordered ? "0.85em" : undefined,
                }}
              >
                {ordered ? `${x + 1}.` : "•"}
              </span>
              <span style={{ minWidth: 0 }}>{inline(item.text, `${key}x${x}`)}</span>
            </div>
          ))}
        </div>,
      );
      continue;
    }

    para.push(trimmed);
  }

  flushPara();
  return <Fragment>{out}</Fragment>;
}
