import type { ReactNode } from "react";

/**
 * Small markdown renderer for project documents: headings, paragraphs, lists, quotes,
 * fenced code, tables, inline code, bold, italic and links. Builds React elements
 * (no innerHTML), so document text can never inject markup.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{blocks(text.replace(/\r\n?/g, "\n"))}</div>;
}

function blocks(src: string): ReactNode[] {
  const lines = src.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => out.length;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(
        <pre key={key()} className="md-code" data-lang={fence[2] || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length + 2, 6);
      const Tag = `h${level}` as "h3";
      out.push(<Tag key={key()}>{inline(h[2].replace(/\s+#+\s*$/, ""))}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        <div key={key()} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={key()}>{blocks(body.join("\n"))}</blockquote>);
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+/;
    if (item.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        if (item.test(lines[i])) items.push(lines[i].replace(item, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key()}>
          {items.map((t, j) => (
            <li key={j}>{inline(t)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s|\|)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) para.push(lines[i++].trim());
    out.push(<p key={key()}>{inline(para.join(" "))}</p>);
  }
  return out;
}

const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = out.length;
    if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={k}>{inline(m[3] ?? m[4])}</strong>);
    else if (m[5] !== undefined) out.push(<em key={k}>{inline(m[5])}</em>);
    else {
      const href = m[7];
      const safe = /^(https?:|mailto:)/i.test(href);
      out.push(
        safe ? (
          <a key={k} href={href} target="_blank" rel="noreferrer">
            {m[6]}
          </a>
        ) : (
          <span key={k} className="md-link" title={href}>
            {m[6]}
          </span>
        ),
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
