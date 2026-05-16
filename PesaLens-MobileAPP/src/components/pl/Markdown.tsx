import { ReactNode } from "react";

/* --------------------------------------------------------------------------
   Lightweight markdown renderer for AI chat bubbles.

   Handles the subset the assistant actually emits — headings (#..####),
   bold, italic, inline code, horizontal rules, bullet/ordered lists, and
   pipe tables — and renders each block with PesaLens design tokens so the
   bubbles never expose raw `##`, `**`, `---`, or `|`.

   Why hand-rolled and not react-markdown? The whole component compresses
   to ~3 KB, has zero deps, and never adds heading anchors / external links
   we don't want inside a chat surface.
   -------------------------------------------------------------------------- */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "paragraph"; text: string };

/* Inline pass — runs **bold**, *italic*, _italic_, `code` over a single
   string and returns ReactNode[] without recursion explosions. */
const inline = (text: string): ReactNode[] => {
  const out: ReactNode[] = [];
  let buf = "";
  let key = 0;
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = "";
    }
  };
  for (let i = 0; i < text.length; i++) {
    // **bold**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        out.push(
          <strong key={key++} className="font-semibold text-foreground">
            {inline(text.slice(i + 2, end))}
          </strong>
        );
        i = end + 1;
        continue;
      }
    }
    // *italic* or _italic_  (require non-space after the marker)
    if ((text[i] === "*" || text[i] === "_") && text[i + 1] && text[i + 1] !== " " && text[i + 1] !== text[i]) {
      const marker = text[i];
      const end = text.indexOf(marker, i + 1);
      if (end !== -1 && text[end - 1] !== " ") {
        flush();
        out.push(
          <em key={key++} className="italic text-foreground/90">
            {text.slice(i + 1, end)}
          </em>
        );
        i = end;
        continue;
      }
    }
    // `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        out.push(
          <code
            key={key++}
            className="font-mono-tab text-[12px] bg-surface-3 text-txt-1 px-1.5 py-0.5 rounded-md border border-border/60"
          >
            {text.slice(i + 1, end)}
          </code>
        );
        i = end;
        continue;
      }
    }
    buf += text[i];
  }
  flush();
  return out;
};

/* Block parser — line-driven, single pass. */
const parse = (raw: string): Block[] => {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // skip blank lines (they only separate blocks)
    if (!line.trim()) {
      i++;
      continue;
    }

    // heading: # .. ####
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: "heading", level: Math.min(h[1].length, 4), text: h[2] });
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // pipe table — header row + separator row of `---` / `:--:`
    const sep = lines[i + 1];
    if (
      line.includes("|") &&
      sep &&
      /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(sep)
    ) {
      const splitRow = (l: string) =>
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push(m[1]);
          i++;
          continue;
        }
        // continuation line (indented under previous bullet)
        if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += "\n" + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*\d+\.\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push(m[1]);
          i++;
          continue;
        }
        if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += "\n" + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // paragraph — collect contiguous non-block lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      const next = lines[i];
      if (
        /^(#{1,6})\s+/.test(next) ||
        /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(next) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next)
      )
        break;
      paraLines.push(next);
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join("\n") });
  }
  return blocks;
};

const HEADING_CLASSES: Record<number, string> = {
  1: "text-[18px] font-bold tracking-tight text-foreground mt-2 first:mt-0",
  2: "text-[16px] font-bold tracking-tight text-foreground mt-2 first:mt-0",
  3: "text-[14px] font-semibold text-foreground mt-1.5 first:mt-0",
  4: "text-[13px] font-semibold text-txt-2 uppercase tracking-wide mt-1 first:mt-0",
};

/* Split a list item into its first line (bullet body) and any continuation
   lines that should render below as muted sub-text. */
const splitItem = (item: string) => {
  const [first, ...rest] = item.split("\n");
  return { head: first, tail: rest };
};

export const Markdown = ({ text, className = "" }: { text: string; className?: string }) => {
  const blocks = parse(text || "");
  return (
    <div className={`space-y-2.5 ${className}`} data-no-translate-target>
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const Tag = (`h${b.level}` as unknown) as keyof JSX.IntrinsicElements;
          return (
            <Tag key={i} className={HEADING_CLASSES[b.level]}>
              {inline(b.text)}
            </Tag>
          );
        }
        if (b.type === "hr") {
          return <hr key={i} className="border-0 h-px bg-border my-1.5" />;
        }
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag
              key={i}
              className={`${b.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1.5 marker:text-txt-3`}
            >
              {b.items.map((raw, j) => {
                const { head, tail } = splitItem(raw);
                return (
                  <li key={j} className="text-[13px] text-txt-1 leading-relaxed">
                    {inline(head)}
                    {tail.length > 0 && (
                      <div className="mt-1 space-y-1 text-txt-2">
                        {tail.map((l, k) => (
                          <div key={k} className="text-[12.5px] leading-relaxed">
                            {inline(l)}
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </Tag>
          );
        }
        if (b.type === "table") {
          return (
            <div key={i} className="overflow-x-auto -mx-1 my-1 scroll-hide">
              <table className="w-full text-[12.5px] border-collapse">
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th
                        key={j}
                        className="text-left text-[10px] uppercase tracking-ticker font-mono-tab text-txt-3 px-2.5 py-1.5 border-b border-border bg-surface-3/40 first:rounded-tl-md last:rounded-tr-md"
                      >
                        {inline(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-b border-border/40 last:border-0">
                      {r.map((c, k) => (
                        <td
                          key={k}
                          className={`px-2.5 py-1.5 text-foreground align-top ${
                            k > 0 ? "tabular font-mono-tab text-right" : ""
                          }`}
                        >
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        // paragraph — preserve hard line breaks within
        return (
          <p key={i} className="text-[13px] text-foreground leading-relaxed whitespace-pre-line">
            {inline(b.text)}
          </p>
        );
      })}
    </div>
  );
};
