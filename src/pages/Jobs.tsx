import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, Badge, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api, today } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import JobFinder from '../components/JobFinder.tsx';
import Guide from '../components/Guide.tsx';
import JobGrid from '../components/JobGrid.tsx';
import { toast } from '../components/Toast.tsx';
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
  const t = useT();
  const ui = useUILang();
  const [track, setTrack] = useState<Track>('finance');
  const [lang, setLang] = useState<Lang>(ui);
  const [showImport, setShowImport] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  const [adapting, setAdapting] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const res = await api.searchJobs({ q: applied, starred: starredOnly, dismissed: showDismissed, limit: 500 });
    setRows(res.rows);
    setTotal(res.total);
  }, [applied, starredOnly, showDismissed]);

  useEffect(() => { void load(); }, [load]);

  // A first visit with an empty list should not require finding the import button.
  useEffect(() => {
    if (!autoOpened && total === 0 && rows.length === 0) { setShowImport(true); setAutoOpened(true); }
  }, [total, rows.length, autoOpened]);

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

  /**
    * One job in, a CV written for it out. The posting becomes an application, the AI rewrites
    * the profile paragraph around this employer using only what the CV already claims, and the
    * result is filed under Documents.
    */
  const adapt = async (job: Job) => {
    setAdapting(job.id);
    setNote('');
    try {
      const { application_id } = await api.promote(job.id, track);
      const base = buildCV(store.profile, store.experience, { track, lang, template: 'ats' });
      const { adaptation } = await api.aiAdapt({
        cv: base, company: job.company, role: job.title, jd: job.description, lang,
      });

      const heading = lang === 'es' ? 'Perfil' : 'Profile';
      const hasProfile = new RegExp(`## ${heading}`).test(base);
      const tailored = hasProfile
        ? base.replace(new RegExp(`(## ${heading}\\n\\n)([^\\n]*)`), `$1${adaptation.summary}`)
        : base.replace(/\n\n/, `\n\n## ${heading}\n\n${adaptation.summary}\n\n`);

      await api.create('document', {
        application_id,
        kind: 'cv',
        title: `CV — ${job.company} — ${job.title}`.slice(0, 120),
        body: tailored,
      });
      await api.update('application', application_id, { status: 'tailored', jd: job.description });
      await api.update('job', job.id, { tailored_at: today() });

      await Promise.all([load(), reload()]);
      setNote(adaptation.why);
      toast(
        t(`CV adapted for ${job.company}`, `CV adaptado para ${job.company}`),
        t('It is filed under Documents, and the job moved onto your board as Tailored.',
          'Quedó guardado en Documentos, y el aviso pasó a tu tablero como Adaptado.'),
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    setAdapting(null);
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
      <Guide
        id="jobs"
        store={store}
        reload={reload}
        title={t('This is where openings come in', 'Acá entran las búsquedas')}
        body={t('Nothing else works until there are jobs here. The fastest way is the first tab.',
                'Nada más funciona hasta que haya avisos acá. Lo más rápido es la primera pestaña.')}
        points={[
          t('Open “Import jobs” → “Find jobs with AI” and press Suggest. It reads your CV and gives you searches, employers and titles.',
            'Abrí “Importar avisos” → “Buscar avisos con IA” y apretá Sugerir. Lee tu CV y te da búsquedas, empresas y puestos.'),
          t('Anything you find elsewhere: copy it, paste it, and the AI pulls the openings out.',
            'Cualquier cosa que encuentres en otro lado: copiala, pegala, y la IA le saca los avisos.'),
          t('Then tick the good ones and press Generate CV — that is the next screen.',
            'Después marcá los buenos y apretá Generar CV — esa es la pantalla siguiente.'),
        ]}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t('Search — every term must match, "quoted phrases" stay together, -word excludes',
                   'Buscar — todos los términos deben coincidir, "frases entre comillas" van juntas, -palabra excluye')}
          placeholder={t('e.g. analyst "buenos aires" -senior', 'ej. analista "buenos aires" -senior')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setApplied(q); }}
          className="min-w-72 flex-1"
        />
        <Button variant="primary" onClick={() => setApplied(q)}>{t('Search', 'Buscar')}</Button>
        <Button onClick={() => setStarredOnly((v) => !v)} className={starredOnly ? 'text-brand-600' : ''}>
          {starredOnly ? t('★ Starred', '★ Favoritos') : t('☆ All', '☆ Todos')}
        </Button>
        <Button onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? t('Showing all', 'Mostrando todo') : t('Hide dismissed', 'Ocultar descartados')}</Button>
        <Button onClick={() => setShowImport((v) => !v)}>{showImport ? t('Close import', 'Cerrar importación') : t('Import jobs', 'Importar avisos')}</Button>
      </div>

      {showImport && <ImportPanel store={store} onDone={async () => { await Promise.all([load(), reload()]); }} />}

      <SavedSearches store={store} reload={reload} current={q} apply={(t) => { setQ(t); setApplied(t); }} />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-ink-700">
          <input
            type="checkbox"
            className="accent-brand-600"
            checked={checked.size > 0 && checked.size === scored.length}
            ref={(el) => { if (el) el.indeterminate = checked.size > 0 && checked.size < scored.length; }}
            onChange={(e) => setChecked(e.target.checked ? new Set(scored.map((j) => j.id)) : new Set())}
          />
          {checked.size ? t(`${checked.size} selected`, `${checked.size} seleccionados`) : t('Select all', 'Seleccionar todo')}
        </label>
        <span className="text-ink-400">·</span>
        <span className="text-ink-500">{t(`${scored.length} of ${total}`, `${scored.length} de ${total}`)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={track} onChange={(e) => setTrack(e.target.value as Track)} className="w-44">
            {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <Select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="w-32">
            <option value="es">{t('CV in Spanish', 'CV en español')}</option>
            <option value="en">{t('CV in English', 'CV en inglés')}</option>
          </Select>
          <Button variant="primary" disabled={!checked.size || busy} onClick={generate}>
            {busy ? t('Working…', 'Trabajando…') : t(`Generate CV${checked.size > 1 ? ` ×${checked.size}` : ''}`, `Generar CV${checked.size > 1 ? ` ×${checked.size}` : ''}`)}
          </Button>
          <Button disabled={!checked.size || busy} onClick={() => bulk({ starred: 1 })}>★</Button>
          <Button disabled={!checked.size || busy} onClick={() => bulk({ dismissed: 1 })}>{t('Dismiss', 'Descartar')}</Button>
        </div>
      </div>

      {note && (
        <p className="animate-fade rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">{note}</p>
      )}

      <JobGrid
        rows={scored}
        checked={checked}
        setChecked={setChecked}
        onStar={(j) => patchJob(j.id, { starred: j.starred ? 0 : 1 })}
        onAdapt={adapt}
        adapting={adapting}
      />
      <p className="text-xs text-ink-400">
        {t('Match % is the share of a posting’s distinctive words that already appear in your CV. It ranks a long list; it does not judge a single job. A 12% match on a job you want beats a 40% on one you don’t.',
           'La afinidad es el porcentaje de palabras distintivas del aviso que ya aparecen en tu CV. Sirve para ordenar una lista larga, no para juzgar un aviso. Un 12% en algo que querés vale más que un 40% en algo que no.')}
      </p>
    </div>
  );
}

function SavedSearches({ store, reload, current, apply }:
{ store: Store; reload: () => Promise<void>; current: string; apply: (terms: string) => void }) {
  const t = useT();
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('save this search as…', 'guardar esta búsqueda como…')}
                 className="w-40 rounded-full border border-dashed border-line bg-transparent px-3 py-1 text-xs outline-none placeholder:text-ink-400 focus:border-brand-400" />
          <button
            disabled={!name.trim()}
            onClick={async () => { await api.create('saved_search', { name: name.trim(), terms: current }); setName(''); await reload(); }}
            className="text-xs text-brand-600 disabled:opacity-30"
          >
            {t('save', 'guardar')}
          </button>
        </div>
      )}
    </div>
  );
}

function ImportPanel({ store, onDone }: { store: Store; onDone: () => Promise<void> }) {
  const t = useT();
  const [tab, setTab] = useState<'ai' | 'file' | 'paste' | 'ats' | 'profile'>('ai');
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [provider, setProvider] = useState('auto');
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
    { id: 'ai', label: t('Find jobs with AI', 'Buscar avisos con IA') },
    { id: 'file', label: t('LinkedIn export (CSV)', 'Exportación de LinkedIn (CSV)') },
    { id: 'paste', label: t('Paste a results page', 'Pegar resultados') },
    { id: 'ats', label: t('Company job board', 'Board de una empresa') },
    { id: 'profile', label: t('Fill my CV from LinkedIn', 'Llenar mi CV desde LinkedIn') },
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

      {tab === 'ai' && <JobFinder store={store} onDone={onDone} />}

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
          })}>{t('Import', 'Importar')}</Button>
        </div>
      )}

      {tab === 'paste' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Select a search results page, copy, paste. One job per block, blank line between blocks:
            title, then company, then location, and any URL on its own line. Rough on purpose — fix the rows afterwards.
          </p>
          <Area rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
                placeholder={'Junior Analyst\nAcme Corp\nBuenos Aires\nhttps://…\n\nGraduate Programme\nAnother Company\nRemote'} />
          <Button variant="primary" disabled={busy || !text.trim()} onClick={() => run(async () => {
            const r = await api.importJobs(text, 'blocks', 'paste');
            return `${r.inserted} added, ${r.skipped} already there.`;
          })}>{t('Import', 'Importar')}</Button>
        </div>
      )}

      {tab === 'ats' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            {t('Pulls a company’s live openings from the public board its own careers page uses. Just type the company name — the slug and the provider are worked out for you. Most banks, consultancies and local employers run their own careers sites, which this cannot read.',
               'Trae las búsquedas activas de una empresa desde el board público que usa su propia página de empleos. Escribí el nombre de la empresa — el resto se resuelve solo. La mayoría de los bancos, consultoras y empresas locales tienen su propio sitio, que esto no puede leer.')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-44">
              <option value="auto">{t('Try all three', 'Probar los tres')}</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
            </Select>
            <Field value={slug} onChange={(e) => setSlug(e.target.value)} className="w-64"
                   placeholder={t('Company name or careers URL', 'Nombre de la empresa o link de empleos')} />
            <Button variant="primary" disabled={busy || !slug.trim()} onClick={() => run(async () => {
              const r = await api.fetchAts(provider, slug.trim());
              return t(`${r.inserted} added from ${r.provider ?? provider}, ${r.skipped} already there.`,
                       `${r.inserted} agregados desde ${r.provider ?? provider}, ${r.skipped} ya estaban.`);
            })}>{t('Fetch', 'Traer')}</Button>
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
            })}>{t('Import', 'Importar')}</Button>
          </div>
          <Area rows={4} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder="…or paste the CSV contents here" />
        </div>
      )}

      {msg && <p className="mt-3 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-700">{msg}</p>}
    </Card>
  );
}
