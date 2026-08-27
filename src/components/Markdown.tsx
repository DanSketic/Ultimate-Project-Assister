// A small markdown renderer, enough for the README and changelog panels.
//
// Deliberately not a dependency: the app ships no runtime libraries beyond
// React and the Tauri bindings, and a README needs headings, lists, code,
// tables and emphasis - not a full CommonMark implementation.
//
// Nothing here builds HTML from the source text; every element is a React node.
// A README does contain HTML - the centred logo and badge block at the top of
// half the repositories on GitHub - so a small, closed subset of it is
// understood: alignment, headings, line breaks, emphasis, links, images and
// collapsed sections. Everything else has its tags dropped and its text kept,
// because showing `<div align="center">` to the reader is worse than either
// rendering it or leaving it out.

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
    "(\\[!\\[[^\\]]*\\]\\([^)]*\\)\\]\\([^)]*\\))", // badge: an image inside a link
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

/**
 * Turns the inline HTML a README uses into the markdown it stands for, and
 * drops the rest of the tags.
 *
 * Deliberately a rewrite into markdown rather than a parse into elements: the
 * markdown path below is already written, already safe, and this way there is
 * one renderer rather than two. Nothing here can produce markup - the output is
 * text that the inline pass reads as text.
 */
function fromHtml(text: string): string {
  return (
    text
      // A link keeps its address; anything else about the anchor is dropped.
      .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
      .replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*")
      .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<(?:del|s|strike)>([\s\S]*?)<\/(?:del|s|strike)>/gi, "~~$1~~")
      // A line break is the one tag whose absence would be felt: without it
      // the words on either side would run together.
      .replace(/<br\s*\/?>/gi, " ")
      // Everything that is left is structure this renderer does not draw. The
      // text inside it is still the author's, so only the tags go.
      .replace(/<\/?[a-z][^>]*>/gi, "")
      // The entities a README actually writes. Anything rarer is left as it
      // stands rather than half-decoded.
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .trim()
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

    if (tok.startsWith("[![")) {
      // A badge: an image inside a link, which is neither a picture this can
      // show nor a link worth following. Its label is the whole of it.
      const alt = tok.slice(3, tok.indexOf("]("));
      if (alt) {
        out.push(
          <span
            key={key}
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: "0.82em",
              border: "1px solid rgba(var(--wrgb),.12)",
              borderRadius: 99,
              padding: "1px 7px",
              marginRight: 3,
              color: "rgba(var(--trgb),.6)",
              whiteSpace: "nowrap",
            }}
          >
            {alt}
          </span>,
        );
      }
    } else if (tok.startsWith("`")) {
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

/** `<img ... alt="X" ...>` -> `X`, the only part of an image that can be shown. */
function imgAlt(tag: string): string {
  return /alt=["']([^"']*)["']/i.exec(tag)?.[1]?.trim() ?? "";
}

/** The alignment an opening tag asks for, when it asks for one. */
function alignOf(tag: string): CSSProperties["textAlign"] {
  const value = /align=["']?(center|left|right)["']?/i.exec(tag)?.[1]?.toLowerCase();
  return value === "center" || value === "right" ? value : undefined;
}

/** A line that is nothing but one HTML tag - the shape a README block takes. */
const TAG_ONLY = /^<\/?[a-z][^>]*>$/i;

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
  // HTML comments are not content, and a README uses them for notes to the
  // next maintainer and for tool markers alike.
  const lines = source
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let n = 0;
  /**
   * Alignment asked for by an enclosing `<div align>` or `<p align>`, innermost
   * last. A stack rather than a flag: the centred block at the top of a README
   * usually holds another one.
   */
  const aligns: Array<CSSProperties["textAlign"]> = [];
  const alignment = () => [...aligns].reverse().find(Boolean);

  const flushPara = () => {
    if (para.length === 0) return;
    const key = `p${n++}`;
    out.push(
      <p key={key} style={{ margin: "0 0 9px", textAlign: alignment() }}>
        {inline(fromHtml(para.join(" ")), key)}
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

    // --- HTML ---------------------------------------------------------------
    //
    // Only the shapes a README actually uses, and only when the line is the tag
    // itself: a `<` in the middle of a sentence is a less-than sign.
    if (trimmed.startsWith("<")) {
      // An image cannot be shown - the path is relative to a folder the webview
      // does not serve, and a badge is a remote fetch this app does not make -
      // so what is left of it is what it was labelled.
      const img = /^<img\s[^>]*>$/i.exec(trimmed);
      if (img) {
        flushPara();
        const alt = imgAlt(trimmed);
        if (alt) {
          out.push(
            <div
              key={`m${n++}`}
              style={{
                margin: "0 0 8px",
                opacity: 0.55,
                fontStyle: "italic",
                textAlign: alignment(),
              }}
            >
              {alt}
            </div>,
          );
        }
        continue;
      }

      // `<h2>Text</h2>` on one line, which is how an HTML-formatted README
      // writes a heading inside a centred block.
      const head = /^<h([1-6])>([\s\S]*?)<\/h[1-6]>$/i.exec(trimmed);
      if (head) {
        flushPara();
        const depth = Number(head[1] ?? "1");
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
              textAlign: alignment(),
            }}
          >
            {inline(fromHtml(head[2] ?? ""), key)}
          </div>,
        );
        continue;
      }

      // A collapsed section: the summary is the part worth showing, since
      // there is nothing here to collapse it behind.
      const summary = /^<summary>([\s\S]*?)<\/summary>$/i.exec(trimmed);
      if (summary) {
        flushPara();
        const key = `s${n++}`;
        out.push(
          <div key={key} style={{ fontWeight: 600, margin: "8px 0 6px" }}>
            {inline(fromHtml(summary[1] ?? ""), key)}
          </div>,
        );
        continue;
      }

      if (TAG_ONLY.test(trimmed)) {
        // An opening tag that asks for alignment starts a block; its closing
        // tag ends one. Everything else - `<br>`, `<hr>`, `</sub>` - is
        // structure with no text of its own, and simply goes.
        if (!trimmed.startsWith("</")) {
          const align = alignOf(trimmed);
          if (/^<(?:div|p|center)\b/i.test(trimmed)) {
            flushPara();
            aligns.push(/^<center\b/i.test(trimmed) ? "center" : align);
          }
        } else if (/^<\/(?:div|p|center)>$/i.test(trimmed)) {
          flushPara();
          aligns.pop();
        }
        continue;
      }
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
            textAlign: alignment(),
          }}
        >
          {inline(fromHtml(head[2] ?? ""), key)}
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
