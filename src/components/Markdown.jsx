import React from 'react';

/* --------------------------------------------------------------------------
   Lightweight markdown renderer for AI chat bubbles (web client).

   Mirrors PesaLens-MobileAPP/src/components/pl/Markdown.tsx so the assistant
   renders identically on both clients. Handles: # / ## / ### / ####, bold,
   italic, inline code, ---, bullet & ordered lists, pipe tables, paragraphs.

   Hand-rolled (no react-markdown) so the chat surface never gains heading
   anchors / external link rewriting we don't want.
   -------------------------------------------------------------------------- */

const inline = (text) => {
  const out = [];
  let buf = '';
  let key = 0;
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        out.push(
          <strong key={key++} className="font-semibold text-txt-1">
            {inline(text.slice(i + 2, end))}
          </strong>
        );
        i = end + 1;
        continue;
      }
    }
    if ((text[i] === '*' || text[i] === '_') && text[i + 1] && text[i + 1] !== ' ' && text[i + 1] !== text[i]) {
      const marker = text[i];
      const end = text.indexOf(marker, i + 1);
      if (end !== -1 && text[end - 1] !== ' ') {
        flush();
        out.push(
          <em key={key++} className="italic text-txt-1/90">
            {text.slice(i + 1, end)}
          </em>
        );
        i = end;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push(
          <code
            key={key++}
            className="font-mono text-[12px] bg-surface-4 text-txt-1 px-1.5 py-0.5 rounded-md border border-bdr/60"
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

const parse = (raw) => {
  const lines = (raw || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: Math.min(h[1].length, 4), text: h[2] });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    const sep = lines[i + 1];
    if (line.includes('|') && sep && /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(sep)) {
      const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push(m[1]);
          i++;
          continue;
        }
        if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += '\n' + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = /^\s*\d+\.\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push(m[1]);
          i++;
          continue;
        }
        if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += '\n' + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }
    const paraLines = [];
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
    blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
  }
  return blocks;
};

const HEADING = {
  1: 'text-lg font-bold tracking-tight text-txt-1 mt-2 first:mt-0',
  2: 'text-base font-bold tracking-tight text-txt-1 mt-2 first:mt-0',
  3: 'text-sm font-semibold text-txt-1 mt-1.5 first:mt-0',
  4: 'text-[12px] font-mono uppercase tracking-ticker text-txt-2 mt-1 first:mt-0',
};

const splitItem = (item) => {
  const [head, ...tail] = item.split('\n');
  return { head, tail };
};

export const Markdown = ({ text, className = '' }) => {
  const blocks = parse(text || '');
  return (
    <div className={`space-y-2.5 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const Tag = `h${b.level}`;
          return (
            <Tag key={i} className={HEADING[b.level]}>
              {inline(b.text)}
            </Tag>
          );
        }
        if (b.type === 'hr') {
          return <div key={i} className="divider-soft my-2" />;
        }
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag
              key={i}
              className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1.5 marker:text-txt-3`}
            >
              {b.items.map((raw, j) => {
                const { head, tail } = splitItem(raw);
                return (
                  <li key={j} className="text-sm text-txt-1 leading-relaxed">
                    {inline(head)}
                    {tail.length > 0 && (
                      <div className="mt-1 space-y-1 text-txt-2">
                        {tail.map((l, k) => (
                          <div key={k} className="text-[13px] leading-relaxed">
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
        if (b.type === 'table') {
          return (
            <div key={i} className="overflow-x-auto -mx-1 my-1 surface-inset rounded-lg">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th
                        key={j}
                        className="text-left text-[10px] uppercase tracking-ticker font-mono text-txt-3 px-3 py-2 border-b border-bdr"
                      >
                        {inline(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-b border-bdr/40 last:border-0">
                      {r.map((c, k) => (
                        <td
                          key={k}
                          className={`px-3 py-2 text-txt-1 align-top ${
                            k > 0 ? 'tabular text-right' : ''
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
        return (
          <p key={i} className="text-sm text-txt-1 leading-relaxed whitespace-pre-line">
            {inline(b.text)}
          </p>
        );
      })}
    </div>
  );
};
