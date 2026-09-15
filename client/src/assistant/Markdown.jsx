import { Fragment } from 'react';

/**
 * A deliberately small Markdown renderer for assistant replies.
 *
 * It builds React elements and never uses innerHTML, so nothing a model writes -
 * or a product name it quotes back - can inject markup or script into the page.
 * It covers what replies actually use: paragraphs, bullet and numbered lists,
 * simple tables, headings, bold, italic and inline code.
 */

function inline(text, keyPrefix) {
  const parts = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let match;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith('**')) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) {
      parts.push(
        <code key={key} className="rounded px-1 py-0.5 text-[0.85em]" style={{ background: 'var(--surface-sunken)' }}>
          {token.slice(1, -1)}
        </code>
      );
    } else parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export default function Markdown({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Table: a header row followed by a |---| separator.
    if (line.includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`t${i}`} className="my-2 overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--surface-sunken)' }}>
                {header.map((cell, c) => (
                  <th key={c} className="px-2.5 py-1.5 text-left font-medium">{inline(cell, `h${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} style={{ borderTop: '1px solid var(--border)' }}>
                  {row.map((cell, c) => (
                    <td key={c} className="px-2.5 py-1.5">{inline(cell, `c${r}-${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={`h${i}`} className="mb-1 mt-2 font-semibold first:mt-0">{inline(heading[2], `hd${i}`)}</p>
      );
      i++;
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        const depth = lines[i].match(/^\s*/)[0].length >= 2 ? 1 : 0;
        items.push({ depth, text: lines[i].replace(/^\s*[-*•]\s+/, '') });
        i++;
      }
      blocks.push(
        <ul key={`u${i}`} className="my-1.5 space-y-0.5">
          {items.map((item, n) => (
            <li key={n} className="flex gap-2" style={{ paddingLeft: item.depth ? '1rem' : 0 }}>
              <span className="subtle select-none">•</span>
              <span className="min-w-0">{inline(item.text, `li${i}-${n}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`o${i}`} className="my-1.5 space-y-0.5">
          {items.map((item, n) => (
            <li key={n} className="flex gap-2">
              <span className="subtle w-4 shrink-0 select-none text-right tabular-nums">{n + 1}.</span>
              <span className="min-w-0">{inline(item, `ol${i}-${n}`)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph: consecutive non-empty lines that aren't another block type.
    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !(lines[i].includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || ''))
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={`p${i}`} className="my-1.5 first:mt-0 last:mb-0">
        {paragraph.map((part, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(part, `p${i}-${n}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className="assistant-markdown">{blocks}</div>;
}
