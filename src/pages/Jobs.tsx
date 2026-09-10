import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, Badge, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api, fmtDate } from '../lib/api.ts';
import { buildCV, matchScore } from '../lib/templates.ts';
import { TRACKS, type Job, type Lang, type SavedSearch, type Store, type Track } from '../lib/types.ts';

const SOURCE_TONE: Record<string, string> = {
  'linkedin-export': 'sky', greenhouse: 'emerald', lever: 'violet', ashby: 'cyan', paste: 'amber', manual: 'slate',
};

export default function Jobs({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [rows, setRows] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState<Track>('markets');
  const [lang, setLang] = useState<Lang>('es');
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    const res = await api.searchJobs({ q: applied, starred: starredOnly, dismissed: showDismissed, limit: 500 });
    setRows(res.rows);
    setTotal(res.total);
  }, [applied, starredOnly, showDismissed]);

  useEffect(() => { void load(); }, [load]);

  // Scored against your master CV, so the ranking reflects what you can actually evidence.
  const cvText = useMemo(
    () => buildCV(store.profile, store.experience, { track, lang: 'en', template: 'ats', maxBullets: 99 }),
    [store.profile, store.experience, track],
  );
  const scored = useMemo(
    () => rows.map((j) => ({ ...j, score: matchScore(`${j.title} ${j.description}`, cvText) }))
      .sort((a, b) => b.starred - a.starred || b.score - a.score),
    [rows, cvText],
  );

  const toggle = (id: number) =>
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const patchJob = async (id: number, body: Partial<Job>) => { await api.update('job', id, body); await load(); };

  /** Checked jobs become tracked applications, then the first one opens in the generator. */
  const generate = async () => {
    if (!checked.size) return;
    setBusy(true);
    const ids: number[] = [];
    for (const id of checked) {
      const { application_id } = await api.promote(id, track);
      ids.push(application_id);
    }
    await Promise.all([load(), reload()]);
    setBusy(false);
    setChecked(new Set());
    if (ids.length) navigate(`/documents?apps=${ids.join(',')}&lang=${lang}&track=${track}`);
  };

  const bulk = async (body: Partial<Job>) => {
    setBusy(true);
    for (const id of checked) await api.update('job', id, body);
    setChecked(new Set());
    await load();
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={'Search — terms are ANDed, "quoted phrases" stay together, -word excludes'}
          placeholder='e.g. sales trading "buenos aires" -senior'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setApplied(q); }}
          className="min-w-72 flex-1"
        />
        <Button variant="primary" onClick={() => setApplied(q)}>Search</Button>
        <Button onClick={() => setStarredOnly((v) => !v)} className={starredOnly ? 'text-brand-600' : ''}>
          {starredOnly ? '★ Starred' : '☆ All'}
        </Button>
        <Button onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? 'Hiding none' : 'Hide dismissed'}</Button>
        <Button onClick={() => setShowImport((v) => !v)}>{showImport ? 'Close import' : 'Import jobs'}</Button>
      </div>

      {showImport && <ImportPanel onDone={async () => { await Promise.all([load(), reload()]); }} />}

      <SavedSearches store={store} reload={reload} current={q} apply={(t) => { setQ(t); setApplied(t); }} />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm">
        <span className="text-ink-500">
          {checked.size ? `${checked.size} selected` : `${scored.length} shown of ${total}`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={track} onChange={(e) => setTrack(e.target.value as Track)} className="w-44">
            {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <Select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="w-32">
            <option value="es">CV español</option>
            <option value="en">CV English</option>
          </Select>
          <Button variant="primary" disabled={!checked.size || busy} onClick={generate}>
            {busy ? 'Working…' : `Generate CV${checked.size > 1 ? ` ×${checked.size}` : ''}`}
          </Button>
          <Button disabled={!checked.size || busy} onClick={() => bulk({ starred: 1 })}>★</Button>
          <Button disabled={!checked.size || busy} onClick={() => bulk({ dismissed: 1 })}>Dismiss</Button>
        </div>
      </div>

      {scored.length === 0 ? (
        <Empty>
          No jobs yet. Open <strong>Import jobs</strong> — paste LinkedIn’s saved-jobs export, paste a results page,
          or pull a company’s public board straight in.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked.size > 0 && checked.size === scored.length}
                    onChange={(e) => setChecked(e.target.checked ? new Set(scored.map((j) => j.id)) : new Set())}
                    className="accent-brand-600"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-left font-medium">Location</th>
                <th className="px-3 py-2 text-right font-medium">Match</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-right font-medium">Posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {scored.map((j) => (
                <tr key={j.id} className={`hover:bg-brand-50 ${checked.has(j.id) ? 'bg-brand-50' : ''} ${j.dismissed ? 'opacity-45' : ''}`}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" checked={checked.has(j.id)} onChange={() => toggle(j.id)} className="accent-brand-600" />
                  </td>
                  <td className="max-w-80 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => patchJob(j.id, { starred: j.starred ? 0 : 1 })}
                              className={j.starred ? 'text-brand-600' : 'text-ink-400 hover:text-brand-600'}>
                        {j.starred ? '★' : '☆'}
                      </button>
                      {j.url
                        ? <a href={j.url} target="_blank" rel="noreferrer" className="truncate font-medium text-ink-900 hover:text-brand-600 hover:underline">{j.title || '—'}</a>
                        : <span className="truncate font-medium text-ink-900">{j.title || '—'}</span>}
                    </div>
                    {j.application_id && <span className="ml-6 text-[11px] text-emerald-600">in pipeline</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-700">{j.company || '—'}</td>
                  <td className="max-w-48 truncate px-3 py-2.5 text-ink-500">{j.location || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className={j.score >= 25 ? 'text-emerald-600' : j.score >= 15 ? 'text-amber-600' : 'text-ink-500'}>
                      {j.score}%
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><Badge tone={SOURCE_TONE[j.source] ?? 'slate'}>{j.source}</Badge></td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-ink-500">{j.posted_on ? fmtDate(j.posted_on) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-xs text-ink-400">
        Match % is the share of a posting’s distinctive words that already appear somewhere in your master CV.
        It ranks a long list; it does not judge a single job. A 12% match on a desk you want beats a 40% match on one you don’t.
      </p>
    </div>
  );
}

function SavedSearches({ store, reload, current, apply }:
{ store: Store; reload: () => Promise<void>; current: string; apply: (terms: string) => void }) {
  const [name, setName] = useState('');
  const saved: SavedSearch[] = store.saved_search ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {saved.map((s) => (
        <button key={s.id} onClick={() => apply(s.terms)}
                className="group rounded-full border border-line px-3 py-1 text-xs text-ink-700 hover:border-brand-400 hover:text-brand-600">
          {s.name}
          <span onClick={async (e) => { e.stopPropagation(); await api.remove('saved_search', s.id); await reload(); }}
                className="ml-2 text-ink-400 group-hover:text-rose-600">×</span>
        </button>
      ))}
      {current.trim() && (
        <div className="flex items-center gap-1">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="save this search as…"
                 className="w-40 rounded-full border border-dashed border-line bg-transparent px-3 py-1 text-xs outline-none placeholder:text-ink-400 focus:border-brand-400" />
          <button
            disabled={!name.trim()}
            onClick={async () => { await api.create('saved_search', { name: name.trim(), terms: current }); setName(''); await reload(); }}
            className="text-xs text-brand-600 disabled:opacity-30"
          >
            save
          </button>
        </div>
      )}
    </div>
  );
}

function ImportPanel({ onDone }: { onDone: () => Promise<void> }) {
  const [tab, setTab] = useState<'file' | 'paste' | 'ats' | 'profile'>('file');
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [provider, setProvider] = useState('greenhouse');
  const [slug, setSlug] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFilename(file.name);
    setText(await file.text());
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try { setMsg(await fn()); }
    catch (e) { setMsg(String(e)); }
    setBusy(false);
    await onDone();
  };

  const TABS = [
    { id: 'file', label: 'LinkedIn export (CSV)' },
    { id: 'paste', label: 'Paste a results page' },
    { id: 'ats', label: 'Company job board' },
    { id: 'profile', label: 'Fill Master CV from LinkedIn' },
  ] as const;

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setMsg(''); }}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${tab === t.id ? 'bg-sunken text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'file' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            On LinkedIn: <span className="text-ink-900">Settings → Data privacy → Get a copy of your data</span>.
            The archive contains <code className="text-brand-600">Saved Jobs.csv</code> and <code className="text-brand-600">Job Applications.csv</code>.
            Drop either here — columns are matched by name, so the order does not matter.
          </p>
          <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => readFile(e.target.files?.[0])}
                 className="block w-full text-sm text-ink-500 file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-ink-900" />
          <Area rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste the CSV contents here" className="font-mono text-xs" />
          <Button variant="primary" disabled={busy || !text.trim()} onClick={() => run(async () => {
            const r = await api.importJobs(text, 'table', 'linkedin-export');
            return `${r.inserted} added, ${r.skipped} already there. Columns matched: ${Object.entries(r.mapped ?? {}).map(([k, v]) => `${k}→${v}`).join(', ') || 'none'}`;
          })}>Import</Button>
        </div>
      )}

      {tab === 'paste' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Select a search results page, copy, paste. One job per block, blank line between blocks:
            title, then company, then location, and any URL on its own line. Rough on purpose — fix the rows afterwards.
          </p>
          <Area rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
                placeholder={'Sales & Trading Analyst\nJ.P. Morgan\nBuenos Aires\nhttps://…\n\nBusiness Analyst\nBain & Company\nBuenos Aires'} />
          <Button variant="primary" disabled={busy || !text.trim()} onClick={() => run(async () => {
            const r = await api.importJobs(text, 'blocks', 'paste');
            return `${r.inserted} added, ${r.skipped} already there.`;
          })}>Import</Button>
        </div>
      )}

      {tab === 'ats' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Pulls a company’s live openings from the public job-board API its own careers page uses.
            The slug is the company name in its careers URL — <code className="text-brand-600">boards.greenhouse.io/<b>stripe</b></code>,
            <code className="text-brand-600"> jobs.lever.co/<b>palantir</b></code>. Most large banks run their own systems,
            so expect this to work for tech, fintech and startups rather than J.P. Morgan.
          </p>
          <div className="flex flex-wrap gap-2">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-44">
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
            </Select>
            <Field value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="company slug" className="w-56" />
            <Button variant="primary" disabled={busy || !slug.trim()} onClick={() => run(async () => {
              const r = await api.fetchAts(provider, slug.trim());
              return `${r.inserted} added, ${r.skipped} already there.`;
            })}>Fetch</Button>
          </div>
        </div>
      )}

      {tab === 'profile' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            From the same LinkedIn archive, drop <code className="text-brand-600">Positions.csv</code>,
            <code className="text-brand-600"> Education.csv</code>, <code className="text-brand-600">Skills.csv</code> or
            <code className="text-brand-600"> Languages.csv</code> to fill the Master CV. Each position’s description becomes
            bullets you then tag by track — so you type your history once and aim it many times.
          </p>
          <input type="file" accept=".csv" onChange={(e) => readFile(e.target.files?.[0])}
                 className="block w-full text-sm text-ink-500 file:mr-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-ink-900" />
          <div className="flex gap-2">
            <Field value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="filename (e.g. Positions.csv)" className="w-64" />
            <Button variant="primary" disabled={busy || !text.trim() || !filename} onClick={() => run(async () => {
              const r = await api.importLinkedInProfile(filename, text);
              return `Imported ${r.imported} rows into ${r.into}.`;
            })}>Import</Button>
          </div>
          <Area rows={4} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder="…or paste the CSV contents here" />
        </div>
      )}

      {msg && <p className="mt-3 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-700">{msg}</p>}
    </Card>
  );
}
