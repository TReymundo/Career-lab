import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Area, Badge, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api, fmtDate } from '../lib/api.ts';
import { TEMPLATES, buildCV, buildCover, keywordGap, missingTranslations, openPlaceholders, type TemplateId } from '../lib/templates.ts';
import { coldOutreach, interviewDebrief, interviewPrep, tailoringPlan } from '../lib/tailor.ts';
import { TRACKS, type Doc, type DocKind, type Lang, type Store, type Track } from '../lib/types.ts';

/** Minimal markdown → HTML for the preview. Handles exactly what the generators emit. */
function renderMarkdown(md: string): string {
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

const KINDS: { id: DocKind; label: string; es: string }[] = [
  { id: 'cv', label: 'CV', es: 'CV' },
  { id: 'cover', label: 'Cover letter', es: 'Carta de presentación' },
  { id: 'outreach', label: 'Cold outreach DM', es: 'Mensaje en frío' },
  { id: 'prep', label: 'Interview prep sheet', es: 'Hoja de entrevista' },
  { id: 'plan', label: 'Tailoring plan', es: 'Plan de adaptación' },
  { id: 'debrief', label: 'Interview debrief', es: 'Debrief de entrevista' },
];

const KIND_TONE: Record<string, string> = { cv: 'sky', cover: 'violet', outreach: 'amber', prep: 'emerald', plan: 'green', debrief: 'cyan' };
const PACK: DocKind[] = ['cv', 'cover', 'outreach', 'prep', 'plan'];

export default function Documents({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  // Jobs hands off through the URL: /documents?apps=3,4,5&lang=es&track=markets
  const [params] = useSearchParams();
  const queue = useMemo(
    () => (params.get('apps') ?? params.get('app') ?? '').split(',').map(Number).filter(Boolean),
    [params],
  );

  const [qIndex, setQIndex] = useState(0);
  const [appId, setAppId] = useState<number | ''>(queue[0] ?? store.application[0]?.id ?? '');
  const [kind, setKind] = useState<DocKind>('cv');
  const [lang, setLang] = useState<Lang>((params.get('lang') as Lang) ?? 'en');
  const [template, setTemplate] = useState<TemplateId>('ats');
  const [track, setTrack] = useState<Track>((params.get('track') as Track) ?? 'markets');
  const [hook, setHook] = useState('');
  const [proof, setProof] = useState('');
  const [contact, setContact] = useState('');
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);
  const [batchMsg, setBatchMsg] = useState('');
  const [exporting, setExporting] = useState('');
  const [exportMsg, setExportMsg] = useState('');

  const app = store.application.find((a) => a.id === appId) ?? null;

  useEffect(() => { if (app && !params.get('track')) setTrack(app.track); }, [app?.id]);

  const cvText = useMemo(
    () => buildCV(store.profile, store.experience, { track, lang, template }),
    [store.profile, store.experience, track, lang, template],
  );

  const build = (k: DocKind, target = app): string => {
    if (k === 'cv') return cvText;
    if (!target) return '';
    const a = { ...target, track };
    if (k === 'cover') return buildCover({ profile: store.profile, app: a, lang, hook, proof, contact });
    if (k === 'outreach') return coldOutreach(store.profile, a, contact, lang);
    if (k === 'prep') return interviewPrep(a, store.experience, lang);
    if (k === 'debrief') return interviewDebrief(a, lang);
    return tailoringPlan(a, store.experience, cvText, lang);
  };

  const generated = useMemo(
    () => build(kind),
    [kind, track, lang, template, app?.id, app?.jd, hook, proof, contact, store.profile, store.experience],
  );

  useEffect(() => { if (!touched) setBody(generated); }, [generated, touched]);

  const text = touched ? body : generated;
  const gaps = useMemo(() => keywordGap(app?.jd ?? '', text), [app?.jd, text]);
  const holes = openPlaceholders(text);
  const untranslated = useMemo(
    () => (lang === 'es' && kind === 'cv' ? missingTranslations(store.experience, track) : []),
    [lang, kind, store.experience, track],
  );
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const kindLabel = (k: DocKind) => {
    const row = KINDS.find((x) => x.id === k)!;
    return lang === 'es' ? row.es : row.label;
  };

  const saveOne = (k: DocKind, content: string, target = app) =>
    api.create<Doc>('document', {
      application_id: target?.id ?? null,
      kind: k,
      title: `${kindLabel(k)} (${lang.toUpperCase()}) — ${target ? target.company : TRACKS.find((t) => t.id === track)?.short} — ${new Date().toLocaleDateString('en-GB')}`,
      body: content,
    });

  const save = async () => {
    await saveOne(kind, text);
    await reload();
    setBatchMsg(`Saved ${kindLabel(kind)}.`);
  };

  /** The whole pack for one application, or for every application handed over from Jobs. */
  const generatePack = async (all: boolean) => {
    const targets = all && queue.length
      ? store.application.filter((a) => queue.includes(a.id))
      : app ? [app] : [];
    if (!targets.length) return;

    let n = 0;
    for (const t of targets) {
      for (const k of PACK) {
        const content = build(k, t);
        if (!content.trim()) continue;
        await saveOne(k, content, t);
        n++;
      }
      if (t.status === 'saved') await api.update('application', t.id, { status: 'tailored' });
    }
    await reload();
    setBatchMsg(`${n} documents saved across ${targets.length} application${targets.length > 1 ? 's' : ''}. Those rows moved to Tailored.`);
  };

  /** DOCX for forms, PDF for humans. Both come back named for a recruiter's download folder. */
  const download = async (format: 'pdf' | 'docx') => {
    setExporting(format);
    setExportMsg('');
    try {
      const name = await api.exportFile({
        markdown: text, format, kind, company: app?.company, lang, name: store.profile.name,
      });
      setExportMsg(`Saved ${name}`);
      await api.setSetting('step:export', 'done');
      await reload();
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    }
    setExporting('');
  };

  const stepTo = (i: number) => {
    const id = queue[i];
    if (!id) return;
    setQIndex(i);
    setAppId(id);
    setTouched(false);
  };

  return (
    <div className="space-y-6">
      {queue.length > 1 && (
        <Card className="flex flex-wrap items-center gap-3 border-brand-200 bg-brand-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-700">Batch from Jobs — {qIndex + 1} of {queue.length}</span>
          <Button disabled={qIndex === 0} onClick={() => stepTo(qIndex - 1)}>← Prev</Button>
          <Button disabled={qIndex >= queue.length - 1} onClick={() => stepTo(qIndex + 1)}>Next →</Button>
          <Button variant="primary" className="ml-auto" onClick={() => generatePack(true)}>
            Generate full pack for all {queue.length}
          </Button>
        </Card>
      )}

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Select label="Document" value={kind} onChange={(e) => { setKind(e.target.value as DocKind); setTouched(false); }}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{lang === 'es' ? k.es : k.label}</option>)}
          </Select>
          <Select label="For application" value={appId} onChange={(e) => { setAppId(e.target.value ? Number(e.target.value) : ''); setTouched(false); }}>
            <option value="">— none (generic) —</option>
            {store.application.map((a) => <option key={a.id} value={a.id}>{a.company} — {a.role || 'role TBD'}</option>)}
          </Select>
          <Select label="Track framing" value={track} onChange={(e) => { setTrack(e.target.value as Track); setTouched(false); }}>
            {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <Select label="Language / idioma" value={lang} onChange={(e) => { setLang(e.target.value as Lang); setTouched(false); }}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </Select>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Select label="Template" value={template} disabled={kind !== 'cv'}
                  onChange={(e) => { setTemplate(e.target.value as TemplateId); setTouched(false); }}>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label[lang]}</option>)}
          </Select>
          <p className="self-end pb-2 text-xs text-ink-500 md:col-span-2">
            {kind === 'cv' ? TEMPLATES.find((t) => t.id === template)?.note[lang] : ''}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Button onClick={() => { setTouched(false); setBody(generated); }}>Regenerate</Button>
            <Button variant="soft" onClick={save}>Save version</Button>
          </div>
        </div>

        {(kind === 'cover' || kind === 'outreach') && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {kind === 'cover' && (
              <>
                <Area label="Your hook — why this firm, specifically" rows={3} value={hook}
                      onChange={(e) => { setHook(e.target.value); setTouched(false); }}
                      placeholder="A desk, a deal, a person you spoke to. Anything a competitor could paste into their own letter is not a hook." />
                <Area label="Your strongest proof story" rows={3} value={proof}
                      onChange={(e) => { setProof(e.target.value); setTouched(false); }}
                      placeholder="Situation, what you personally did, the number that came out of it." />
              </>
            )}
            <Field label={kind === 'outreach' ? 'Send it to (name)' : 'Name of the person you spoke to (optional)'}
                   value={contact} onChange={(e) => { setContact(e.target.value); setTouched(false); }} />
          </div>
        )}

        {kind !== 'cv' && !app && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Pick an application — this document needs the company and role.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button variant="primary" disabled={!app} onClick={() => generatePack(false)}>
            Generate full pack for {app?.company ?? 'this application'}
          </Button>
          <span className="text-xs text-ink-500">CV · cover letter · outreach DM · prep sheet · tailoring plan, saved together.</span>
          {batchMsg && <span className="animate-fade ml-auto text-sm font-medium text-brand-700">{batchMsg}</span>}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <SectionTitle right={<span className="text-xs text-ink-400">{words} words</span>}>Draft</SectionTitle>
          <Area rows={24} value={text} onChange={(e) => { setTouched(true); setBody(e.target.value); }} className="font-mono text-[13px]" />
          <div className="no-print mt-2 flex flex-wrap gap-2">
            <Button onClick={() => navigator.clipboard.writeText(text)}>Copy</Button>
            <Button variant="primary" disabled={exporting !== ''} onClick={() => download('docx')}>
              {exporting === 'docx' ? 'Building…' : 'Download DOCX'}
            </Button>
            <Button variant="soft" disabled={exporting !== ''} onClick={() => download('pdf')}>
              {exporting === 'pdf' ? 'Building…' : 'Download PDF'}
            </Button>
            <Button onClick={() => {
              const blob = new Blob([text], { type: 'text/markdown' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${kind}-${app?.company ?? track}-${lang}.md`.replace(/\s+/g, '-').toLowerCase();
              a.click();
              URL.revokeObjectURL(a.href);
            }}>.md</Button>
            <Button onClick={() => window.print()}>Print</Button>
            {exportMsg && <span className="animate-fade self-center text-sm text-brand-700">{exportMsg}</span>}
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <SectionTitle>Checks</SectionTitle>
            <Card className="space-y-4 p-4 text-sm">
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">Unfilled placeholders</p>
                {holes.length === 0 ? <span className="text-emerald-700">None — nothing bracketed left.</span> : (
                  <ul className="space-y-1 text-amber-700">{holes.map((h, i) => <li key={i}>{h}</li>)}</ul>
                )}
              </div>

              {lang === 'es' && kind === 'cv' && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">Bullets sin traducir</p>
                  {untranslated.length === 0 ? <span className="text-emerald-700">Todo traducido.</span> : (
                    <>
                      <p className="text-amber-700">
                        {untranslated.length} bullet{untranslated.length > 1 ? 's' : ''} aparecen en inglés porque no tienen versión en español.
                      </p>
                      <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
                        {untranslated.slice(0, 5).map((u, i) => <li key={i} className="truncate">{u.org}: {u.text}</li>)}
                      </ul>
                      <p className="mt-1 text-xs text-ink-400">Añadí la versión ES en Master CV, campo “ES” de cada bullet.</p>
                    </>
                  )}
                </div>
              )}

              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                  ATS keywords the posting uses and your draft does not
                </p>
                {!app?.jd ? <span className="text-ink-500">Paste the job description on the application to run this check.</span>
                  : gaps.length === 0 ? <span className="text-emerald-700">Good coverage.</span> : (
                    <div className="flex flex-wrap gap-1.5">
                      {gaps.map((g) => <Badge key={g.word} tone="amber">{g.word} ×{g.count}</Badge>)}
                    </div>
                  )}
                <p className="mt-2 text-xs text-ink-400">
                  The <strong>Tailoring plan</strong> document shows which bullet each of these belongs in. Cover the ones that
                  are genuinely true of you — a keyword you cannot defend in the interview is worse than a missing one.
                </p>
              </div>
            </Card>
          </div>

          <div>
            <SectionTitle>Preview</SectionTitle>
            <div className="print-sheet max-h-[520px] overflow-auto rounded-xl border border-line bg-white p-8 text-[13px] leading-relaxed text-ink-900
                            [&_a]:text-brand-700 [&_a]:underline
                            [&_h1]:mb-1 [&_h1]:text-2xl [&_h1]:font-bold
                            [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-line [&_h2]:pb-1 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wider
                            [&_li]:mb-1 [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-1"
                 dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
          </div>
        </div>
      </div>

      <section className="no-print">
        <SectionTitle>Saved versions</SectionTitle>
        {store.document.length === 0 ? (
          <Empty>Save a version before each send — when a recruiter calls in six weeks you will want the exact document they read.</Empty>
        ) : (
          <Card className="stagger divide-y divide-line overflow-hidden">
            {store.document.slice(0, 20).map((d) => (
              <div key={d.id} className="flex items-center gap-4 px-4 py-2.5 text-sm transition hover:bg-brand-50">
                <Badge tone={KIND_TONE[d.kind] ?? 'slate'}>{d.kind}</Badge>
                <span className="min-w-0 flex-1 truncate text-ink-700">{d.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-400">{fmtDate(d.created_at.slice(0, 10))}</span>
                <button onClick={() => { setTouched(true); setBody(d.body); setKind(d.kind); }}
                        className="text-xs text-brand-600 hover:underline">load</button>
                <button onClick={async () => { await api.remove('document', d.id); await reload(); }}
                        className="text-xs text-ink-400 hover:text-rose-600">delete</button>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
