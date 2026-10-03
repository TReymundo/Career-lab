/**
 * Minimal Markdown → HTML, covering exactly what the generators emit. Shared so that the
 * preview, the celebration and the printed page are the same rendering, not three that drift.
 *
 * Beyond plain Markdown it reads the CV layout lines buildCV writes (and server/export.ts
 * reads the same way): `^ centred`, `---` rule, `> italic paragraph`, `### entry row` and
 * `left || right` rows.
 */
export function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const inline = (s: string) =>
    esc(s)
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/ {2}$/, '<br/>');
  const row = (s: string, cls: string) => {
    const [left, right = ''] = s.split(' || ');
    return `<div class="${cls}"><span>${inline(left)}</span>${right ? `<span class="md-right">${inline(right)}</span>` : ''}</div>`;
  };

  const out: string[] = [];
  let inList = false;
  for (const raw of md.split('\n')) {
    const l = raw.trimEnd();
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    if (l.startsWith('## ')) { closeList(); out.push(`<h2>${inline(l.slice(3))}</h2>`); }
    else if (l.startsWith('### ')) { closeList(); out.push(row(l.slice(4), 'md-row md-entry')); }
    else if (l.startsWith('# ')) { closeList(); out.push(`<h1>${inline(l.slice(2))}</h1>`); }
    else if (l.startsWith('^ ')) { closeList(); out.push(`<p class="md-center">${inline(l.slice(2))}</p>`); }
    else if (l === '---') { closeList(); out.push('<hr/>'); }
    else if (l.startsWith('> ')) { closeList(); out.push(`<p class="md-quote">${inline(l.slice(2))}</p>`); }
    else if (l.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(l.slice(2))}</li>`);
    } else if (!l.trim()) closeList();
    else if (l.includes(' || ')) { closeList(); out.push(row(l, 'md-row')); }
    else { closeList(); out.push(`<p>${inline(raw)}</p>`); }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}
