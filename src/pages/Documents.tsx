import { useEffect, useMemo, useState } from 'react';
import { Area, Badge, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api, fmtDate } from '../lib/api.ts';
import { buildCV, buildCover, keywordGap, openPlaceholders } from '../lib/templates.ts';
import { TRACKS, type Doc, type Store, type Track } from '../lib/types.ts';

/** Minimal markdown → HTML for the CV preview. Handles exactly what buildCV emits. */
function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const inline = (s: string) =>
    esc(s)
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

export default function Documents({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const [appId, setAppId] = useState<number | ''>(store.application[0]?.id ?? '');
  const [kind, setKind] = useState<'cv' | 'cover'>('cv');
  const [track, setTrack] = useState<Track>('markets');
  const [hook, setHook] = useState('');
  const [proof, setProof] = useState('');
  const [contact, setContact] = useState('');
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);

  const app = store.application.find((a) => a.id === appId) ?? null;

  useEffect(() => { if (app) setTrack(app.track); }, [app?.id]);

  const generated = useMemo(() => {
    if (kind === 'cv') return buildCV(store.profile, store.experience, track);
    if (!app) return '';
    return buildCover({ profile: store.profile, app: { ...app, track }, hook, proof, contact });
  }, [kind, track, app?.id, hook, proof, contact, store.profile, store.experience]);

  useEffect(() => { if (!touched) setBody(generated); }, [generated, touched]);

  const text = touched ? body : generated;
  const gaps = useMemo(() => keywordGap(app?.jd ?? '', text), [app?.jd, text]);
  const holes = openPlaceholders(text);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const save = async () => {
    await api.create<Doc>('document', {
      application_id: app?.id ?? null,
      kind,
      title: `${kind === 'cv' ? 'CV' : 'Cover letter'} — ${app ? app.company : TRACKS.find((t) => t.id === track)?.short} — ${new Date().toLocaleDateString('en-GB')}`,
      body: text,
    });
    await reload();
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Select label="Document" value={kind} onChange={(e) => { setKind(e.target.value as 'cv' | 'cover'); setTouched(false); }}>
            <option value="cv">CV</option>
            <option value="cover">Cover letter</option>
          </Select>
          <Select label="For application" value={appId} onChange={(e) => { setAppId(e.target.value ? Number(e.target.value) : ''); setTouched(false); }}>
            <option value="">— none (generic) —</option>
            {store.application.map((a) => <option key={a.id} value={a.id}>{a.company} — {a.role || 'role TBD'}</option>)}
          </Select>
          <Select label="Track framing" value={track} onChange={(e) => { setTrack(e.target.value as Track); setTouched(false); }}>
            {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <div className="flex items-end gap-2">
            <Button onClick={() => { setTouched(false); setBody(generated); }}>Regenerate</Button>
            <Button variant="primary" onClick={save}>Save version</Button>
          </div>
        </div>

        {kind === 'cover' && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Area label="Your hook — why this firm, specifically" rows={3} value={hook} onChange={(e) => { setHook(e.target.value); setTouched(false); }}
                  placeholder="A desk, a deal, a person you spoke to. Anything a competitor could copy into their own letter is not a hook." />
            <Area label="Your strongest proof story" rows={3} value={proof} onChange={(e) => { setProof(e.target.value); setTouched(false); }}
                  placeholder="Situation, what you personally did, the number that came out of it." />
            <Field label="Name of the person you spoke to (optional)" value={contact} onChange={(e) => { setContact(e.target.value); setTouched(false); }} />
          </div>
        )}

        {kind === 'cover' && !app && (
          <p className="mt-3 text-sm text-amber-300">Pick an application — a cover letter needs the company and role.</p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <SectionTitle right={<span className="text-xs text-slate-500">{words} words</span>}>Draft</SectionTitle>
          <Area rows={26} value={text} onChange={(e) => { setTouched(true); setBody(e.target.value); }} className="font-mono text-[13px]" />
          <div className="no-print mt-2 flex gap-2">
            <Button onClick={() => navigator.clipboard.writeText(text)}>Copy</Button>
            <Button onClick={() => {
              const blob = new Blob([text], { type: 'text/markdown' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${kind}-${app?.company ?? track}.md`.replace(/\s+/g, '-').toLowerCase();
              a.click();
              URL.revokeObjectURL(a.href);
            }}>Download .md</Button>
            <Button onClick={() => window.print()}>Print / PDF</Button>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <SectionTitle>Checks</SectionTitle>
            <Card className="space-y-3 p-4 text-sm">
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">Unfilled placeholders</div>
                {holes.length === 0 ? <span className="text-emerald-300">None — nothing bracketed left.</span> : (
                  <ul className="space-y-1 text-amber-300">{holes.map((h, i) => <li key={i}>{h}</li>)}</ul>
                )}
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">
                  Words in the posting your draft never uses
                </div>
                {!app?.jd ? <span className="text-slate-500">Paste the job description on the application to run this check.</span>
                  : gaps.length === 0 ? <span className="text-emerald-300">Good coverage.</span> : (
                    <div className="flex flex-wrap gap-1.5">
                      {gaps.map((g) => <Badge key={g.word} tone="amber">{g.word} ×{g.count}</Badge>)}
                    </div>
                  )}
                <p className="mt-2 text-xs text-slate-600">
                  Cover the ones that are genuinely true of you. Stuffing keywords you cannot defend in an interview is worse than missing them.
                </p>
              </div>
            </Card>
          </div>

          {kind === 'cv' && (
            <div>
              <SectionTitle>Preview</SectionTitle>
              <div className="print-sheet max-h-[520px] overflow-auto rounded-lg border border-ink-800 bg-white p-8 text-[13px] leading-relaxed text-slate-900
                              [&_h1]:mb-1 [&_h1]:text-2xl [&_h1]:font-bold
                              [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-slate-300 [&_h2]:pb-1 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wider
                              [&_li]:mb-1 [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-1"
                   dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
            </div>
          )}
        </div>
      </div>

      <section className="no-print">
        <SectionTitle>Saved versions</SectionTitle>
        {store.document.length === 0 ? (
          <Empty>Save a version before each send — when a recruiter calls in six weeks you will want the exact document they read.</Empty>
        ) : (
          <Card className="divide-y divide-ink-800">
            {store.document.map((d) => (
              <div key={d.id} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                <Badge tone={d.kind === 'cv' ? 'sky' : 'violet'}>{d.kind}</Badge>
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{fmtDate(d.created_at.slice(0, 10))}</span>
                <button onClick={() => { setTouched(true); setBody(d.body); setKind(d.kind); }}
                        className="text-xs text-accent hover:underline">load</button>
                <button onClick={async () => { await api.remove('document', d.id); await reload(); }}
                        className="text-xs text-slate-600 hover:text-rose-300">delete</button>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
