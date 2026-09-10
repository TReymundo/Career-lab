/**
 * Minimal Markdown → HTML, covering exactly what the generators emit. Shared so that the
 * preview, the celebration and the printed page are the same rendering, not three that drift.
 */
export function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const inline = (s: string) =>
    esc(s)
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/ {2}$/, '<br/>');

  const out: string[] = [];
  let inList = false;
  for (const raw of md.split('\n')) {
    const l = raw.trimEnd();
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    if (l.startsWith('## ')) { closeList(); out.push(`<h2>${inline(l.slice(3))}</h2>`); }
    else if (l.startsWith('# ')) { closeList(); out.push(`<h1>${inline(l.slice(2))}</h1>`); }
    else if (l.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(l.slice(2))}</li>`);
    } else if (!l.trim()) closeList();
    else { closeList(); out.push(`<p>${inline(raw)}</p>`); }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

