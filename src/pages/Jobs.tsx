import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, Badge, Button, Card, Field, Select } from '../components/ui.tsx';
import { api, fmtDate, type BrowseJob, type BrowseResult, type Facet, type SourcesStatus } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import JobFinder from '../components/JobFinder.tsx';
import Tabs from '../components/Tabs.tsx';
import Dropdown, { Option } from '../components/Dropdown.tsx';
import { PrefsStep, SourcesStep } from '../components/JobSetup.tsx';
import { toast } from '../components/Toast.tsx';
import { buildCV, detectLang } from '../lib/templates.ts';
import { adaptJob } from '../lib/adapt.ts';
import { countryName, jsearchQueries, readPrefs, type JobPrefs } from '../lib/jobsearch.ts';
import type { Store, Track } from '../lib/types.ts';

/**
 * Finding jobs.
 *
 * First visit: what you are looking for (seeded from your CV), then where jobs come from.
 * After that, one list of everything your sources bring in — LinkedIn and other alert emails,
 * Get on Board, Google for Jobs, remote boards — kept to your places, de-duplicated, and ranked
 * on this machine against your CV with the reasons shown. Three views over it: a shortlist
 * ("For you"), what arrived since your last visit ("New"), and everything.
 */

type Step = { id: string; label: string; state: 'wait' | 'run' | 'done' | 'skip' | 'error'; detail: string };
type View = 'foryou' | 'new' | 'all' | 'saved' | 'hidden';

interface Filters {
  view: View;
  city: string;
  remote: 'include' | 'only' | 'exclude';
  levels: string[];
  lang: string;
  days: number;
  source: string;
  fit: string;
  q: string;
  sort: 'relevance' | 'newest';
}

const FILTER_KEY = 'career-lab-job-filters-v2';
const VISIT_KEY = 'career-lab-jobs-visit';

const defaults = (prefs: JobPrefs | null): Filters => ({
  view: 'foryou',
  city: '',
  remote: prefs?.remote === false ? 'exclude' : 'include',
  levels: [],
  lang: prefs && prefs.langs.length === 1 ? prefs.langs[0] : '',
  days: 0,
  source: '',
  fit: '',
  q: '',
  sort: 'relevance',
});

/** "4 min ago" / "hace 4 min". */
const ago = (iso: string, lang: 'en' | 'es') => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return lang === 'es' ? 'recién' : 'just now';
  if (m < 60) return lang === 'es' ? `hace ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? (lang === 'es' ? `hace ${h} h` : `${h} h ago`) : (lang === 'es' ? `hace ${Math.round(h / 24)} d` : `${Math.round(h / 24)} d ago`);
};

/** The same clock format SQLite writes into imported_at, so "new since" compares correctly. */
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const firstTrack = (s: Store): Track => {
  try { return (JSON.parse(s.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other'; }
};

export default function Jobs({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const prefs = readPrefs(store);
  const [setup, setSetup] = useState<null | 'prefs' | 'sources'>(prefs ? null : 'prefs');
  const [status, setStatus] = useState<SourcesStatus | null>(null);
  const [autoFind, setAutoFind] = useState(false);

  useEffect(() => { void api.sourcesStatus().then(setStatus).catch(() => {}); }, [setup]);

  if (setup === 'prefs') {
    return <PrefsStep store={store} initial={prefs} onDone={async () => { await api.rescopeJobs(); await reload(); setSetup('sources'); }} />;
  }
  if (setup === 'sources' && prefs) {
    return <SourcesStep prefs={prefs} status={status} setStatus={setStatus} onDone={() => { setSetup(null); setAutoFind(true); }} />;
  }
  if (!prefs) return null;
  return <JobList store={store} reload={reload} prefs={prefs} status={status} autoFind={autoFind}
                  onEditPrefs={() => setSetup('prefs')} onEditSources={() => setSetup('sources')} />;
}

/* ---------------------------------------------------------------- the list */

function JobList({ store, reload, prefs, status, autoFind, onEditPrefs, onEditSources }: {
  store: Store; reload: () => Promise<void>; prefs: JobPrefs; status: SourcesStatus | null; autoFind: boolean;
  onEditPrefs: () => void; onEditSources: () => void;
}) {
  const t = useT();
  const ui = useUILang();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(() => {
    try { return { ...defaults(prefs), ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') }; } catch { return defaults(prefs); }
  });
  // "New" means new since the previous visit; this visit becomes the next one's mark.
  const [since] = useState(() => {
    let prev = '';
    try { prev = localStorage.getItem(VISIT_KEY) ?? ''; localStorage.setItem(VISIT_KEY, sqlNow()); } catch { /* private window */ }
    return prev;
  });
  const [data, setData] = useState<BrowseResult | null>(null);
  const [limit, setLimit] = useState(40);
  const [steps, setSteps] = useState<Step[]>([]);
  const [showMore, setShowMore] = useState(false);

  const set = (p: Partial<Filters>) => setFilters((f) => {
    const next = { ...f, ...p };
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(next)); } catch { /* private window */ }
    return next;
  });

  const load = useCallback(async () => {
    const f = filters;
    setData(await api.browseJobs({
      view: f.view === 'saved' || f.view === 'hidden' ? undefined : f.view,
      saved: f.view === 'saved' ? 1 : undefined, dismissed: f.view === 'hidden' ? 1 : undefined,
      since, city: f.city, remote: f.remote, levels: f.levels.join(','), lang: f.lang, days: f.days || undefined,
      source: f.source, fit: f.fit, q: f.q, sort: f.sort, limit,
    }));
  }, [filters, limit, since]);
  useEffect(() => { void load(); }, [load]);

  /** One press: every connected source in turn. Ranking is instant, so there is nothing to wait for after. */
  const find = useCallback(async () => {
    const remoteOn = prefs.remote;
    const list: Step[] = [
      { id: 'alerts', label: t('Job alerts in Gmail (LinkedIn & more)', 'Alertas en Gmail (LinkedIn y más)'), state: status?.gmail.configured ? 'wait' : 'skip', detail: status?.gmail.configured ? '' : t('not connected', 'sin conectar') },
      { id: 'gob', label: 'Get on Board', state: 'wait', detail: '' },
      { id: 'jsearch', label: t('Google for Jobs', 'Google for Jobs'), state: status?.jsearch.configured ? 'wait' : 'skip', detail: status?.jsearch.configured ? '' : t('not connected', 'sin conectar') },
      { id: 'feeds', label: t('Remote job boards', 'Bolsas de trabajo remoto'), state: remoteOn ? 'wait' : 'skip', detail: remoteOn ? '' : t('remote not selected', 'remoto no elegido') },
    ];
    setSteps(list);
    const upd = (id: string, p: Partial<Step>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const run = async (id: string, fn: () => Promise<string>) => {
      if (list.find((x) => x.id === id)?.state === 'skip') return;
      upd(id, { state: 'run', detail: t('searching…', 'buscando…') });
      try { upd(id, { state: 'done', detail: await fn() }); }
      catch (e) { upd(id, { state: 'error', detail: e instanceof Error ? e.message : String(e) }); }
      await load();
    };
    const nw = (n: number) => t(`${n} new`, `${n} nuevos`);
    await run('alerts', async () => {
      const r = await api.scanAlerts(60);
      return r.emails
        ? `${nw(r.inserted)} · ${t(`${r.emails} emails read`, `${r.emails} mails leídos`)}${r.errors.length ? ` · ${r.errors[0]}` : ''}`
        : t('no new alert emails — create more alerts in Sources', 'no hay mails de alertas nuevos — creá más alertas en Fuentes');
    });
    await run('gob', async () => {
      const r = await api.pullGetOnBoard(prefs.roles);
      return nw(r.inserted) + (r.errors.length ? ` · ${r.errors[0]}` : '');
    });
    await run('jsearch', async () => {
      // A few searches per run: the free plan is 200 a month, so this stays useful all month.
      const r = await api.pullJSearch(jsearchQueries(prefs, 6));
      return `${nw(r.inserted)} · ${t(`${r.used}/${r.limit} searches this month`, `${r.used}/${r.limit} búsquedas este mes`)}${r.errors.length ? ` · ${r.errors[0]}` : ''}`;
    });
    await run('feeds', async () => nw((await api.pullJobs(prefs.roles)).inserted));
    await reload();
  }, [prefs, status, load, reload, t]);

  useEffect(() => { if (autoFind && status) void find(); }, [autoFind, status]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "I want to apply": the job slides out of the list and joins step 3. */
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const wantToApply = async (j: BrowseJob) => {
    if (j.starred) { navigate('/apply'); return; }
    setLeaving((s) => new Set(s).add(j.id));
    await api.update('job', j.id, { starred: 1 });
    setTimeout(() => { void load(); void loadPicks(); void reload(); }, 520);
    toast(t('Added to Apply', 'Agregado a Postularte'), t(`${j.title} — step 3 writes the CV and letter for it.`, `${j.title} — el paso 3 escribe el CV y la carta.`));
  };
  const hide = async (j: BrowseJob) => {
    setLeaving((s) => new Set(s).add(j.id));
    await api.update('job', j.id, { dismissed: j.dismissed ? 0 : 1 });
    setTimeout(() => { void load(); void loadPicks(); }, 520);
  };

  /**
   * The AI's top 10: the instant score narrows everything down to the best ~24 in your current
   * filters, the AI reads those carefully, and the ten it rates highest sit in their own panel.
   */
  const [picks, setPicks] = useState<BrowseJob[] | null>(null);
  const [picking, setPicking] = useState(false);
  const scope = { city: filters.city, remote: filters.remote, levels: filters.levels.join(','), lang: filters.lang, days: filters.days || undefined, source: filters.source, q: filters.q };
  const loadPicks = useCallback(async () => {
    const r = await api.browseJobs({ ...scope, view: 'foryou', fit: 'great,good', limit: 30, sort: 'relevance' });
    const rank = (j: BrowseJob) => (j.fit === 'great' ? 2 : 1) * 1000 + j.match;
    setPicks(r.rows.filter((j) => !j.dismissed).sort((a, b) => rank(b) - rank(a)).slice(0, 10));
  }, [JSON.stringify(scope)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadPicks(); }, [loadPicks]);

  const runPicks = async () => {
    setPicking(true);
    try {
      const top = await api.browseJobs({ ...scope, view: 'foryou', limit: 24, sort: 'relevance' });
      const ids = top.rows.filter((r) => !r.fit).map((r) => r.id);
      if (ids.length) await api.fitJobs(ids, buildCV(store.profile, store.experience, { track: 'other', lang: ui, template: 'ats', maxBullets: 99 }), ui);
      await Promise.all([loadPicks(), load()]);
    } catch (e) { toast(t('The AI could not read them now', 'La IA no pudo leerlos ahora'), e instanceof Error ? e.message : String(e)); }
    setPicking(false);
  };

  const finding = steps.some((s) => s.state === 'run');
  const counts = data?.counts;
  const places = prefs.places.map((p) => p.label).join(' · ') + (prefs.remote ? ` · ${t('remote', 'remoto')}` : '');
  const pickIds = new Set((filters.view === 'foryou' ? picks ?? [] : []).map((p) => p.id));
  const rows = (data?.rows ?? []).filter((r) => !pickIds.has(r.id));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold text-forest-900">{prefs.roles.slice(0, 3).join(' · ')}{prefs.roles.length > 3 ? ` +${prefs.roles.length - 3}` : ''}</p>
            <p className="mt-0.5 text-sm text-ink-500">
              {places} · <button onClick={onEditPrefs} className="text-brand-700 hover:underline">{t('change', 'cambiar')}</button>
              {' · '}<button onClick={onEditSources} className="text-brand-700 hover:underline">{t('sources', 'fuentes')}</button>
            </p>
            {status?.gmail.configured && status.gmail.last && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-400">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                {t(`LinkedIn alerts checked ${ago(status.gmail.last, 'en')}`, `Alertas de LinkedIn revisadas ${ago(status.gmail.last, 'es')}`)}
              </p>
            )}
          </div>
          <Button variant="primary" className="px-5 py-2.5" disabled={finding} onClick={() => void find()}>
            {finding ? t('Searching…', 'Buscando…') : t('Find new jobs', 'Buscar avisos nuevos')}
          </Button>
        </div>
        {steps.length > 0 && (
          <div className="border-t border-line bg-sunken/40 px-5 py-3">
            <ul className="space-y-1.5">
              {steps.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <StepDot state={s.state} />
                  <span className={`shrink-0 ${s.state === 'skip' ? 'text-ink-400' : 'text-ink-900'}`}>{s.label}</span>
                  <span className={`truncate text-xs ${s.state === 'error' ? 'text-amber-700' : 'text-ink-500'}`}>{s.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filters.view === 'hidden' ? 'all' : filters.view} onChange={(v) => { set({ view: v as View }); setLimit(40); }} tabs={[
          { key: 'foryou', label: t('For you', 'Para vos'), count: filters.view === 'saved' ? undefined : data?.views.foryou },
          { key: 'new', label: t('New', 'Nuevos'), count: filters.view === 'saved' ? undefined : data?.views.new },
          { key: 'all', label: t('Everything', 'Todo'), count: filters.view === 'saved' ? undefined : data?.views.all },
          { key: 'saved', label: t('Want to apply', 'Para postularme'), count: counts?.saved ?? 0 },
        ]} />
        {counts && counts.saved > 0 && (
          <Button variant="primary" className="ml-auto" onClick={() => navigate('/apply')}>
            {t(`Apply to ${counts.saved} →`, `Postularme a ${counts.saved} →`)}
          </Button>
        )}
      </div>

      {filters.view === 'foryou' && (
        <TopPicks picks={picks} picking={picking} canRun={Boolean(status?.ai || status?.groq)} onRun={runPicks}
                  leaving={leaving} onApply={wantToApply} onHide={hide} />
      )}

      <FiltersRow filters={filters} set={set} data={data} prefs={prefs} />

      {data && (
        <div className="flex flex-wrap items-baseline gap-3 text-sm">
          <span className="font-medium text-ink-700">
            {filters.view === 'foryou' && picks?.length ? t('More for you', 'Más para vos') : t(`${data.total.toLocaleString()} jobs`, `${data.total.toLocaleString()} avisos`)}
          </span>
          {filters.view === 'foryou' && data.views.all > data.views.foryou && (
            <button onClick={() => set({ view: 'all' })} className="text-xs text-ink-400 hover:text-brand-700">
              {t(`${data.views.all - data.views.foryou} more below your bar →`, `${data.views.all - data.views.foryou} más por debajo de tu filtro →`)}
            </button>
          )}
          {filters.view !== 'hidden' && (counts?.dismissed ?? 0) > 0 && (
            <button onClick={() => set({ view: 'hidden' })} className="ml-auto text-xs text-ink-400 hover:text-ink-900">{t(`Hidden (${counts?.dismissed})`, `Ocultos (${counts?.dismissed})`)}</button>
          )}
          {filters.view === 'hidden' && <button onClick={() => set({ view: 'foryou' })} className="ml-auto text-xs text-brand-700">{t('← Back to For you', '← Volver a Para vos')}</button>}
        </div>
      )}

      <div className="stagger space-y-2.5">
        {rows.map((j) => (
          <JobCard key={j.id} j={j} isNew={Boolean(since) && j.imported_at > since} leaving={leaving.has(j.id)}
                   onApply={() => wantToApply(j)} onHide={() => hide(j)} />
        ))}
      </div>

      {data && data.rows.length === 0 && (
        <div className="rounded-3xl border border-dashed border-line-strong bg-surface/60 p-12 text-center">
          <p className="font-display text-xl font-semibold text-forest-900">
            {filters.view === 'new' ? t('Nothing new since your last visit', 'Nada nuevo desde tu última visita')
              : filters.view === 'saved' ? t('Nothing here yet', 'Todavía nada acá')
              : counts?.total ? t('Nothing matches these filters', 'Nada coincide con estos filtros') : t('No jobs yet', 'Todavía no hay avisos')}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {filters.view === 'saved' ? t('Tap “I want to apply” on a job and it lands here.', 'Tocá “Quiero postularme” en un aviso y aparece acá.')
              : counts?.total ? t('Loosen a filter, or look under Everything.', 'Aflojá algún filtro, o mirá en Todo.')
              : t('Press “Find new jobs” to pull them from your sources.', 'Tocá “Buscar avisos nuevos” para traerlos de tus fuentes.')}
          </p>
        </div>
      )}

      {data && data.total > data.rows.length && (
        <div className="text-center">
          <Button onClick={() => setLimit((l) => l + 40)}>{t('Show more', 'Ver más')}</Button>
        </div>
      )}

      <div className="pt-4">
        <button onClick={() => setShowMore((v) => !v)} className="text-sm text-ink-400 hover:text-ink-900">
          {showMore ? '▾' : '▸'} {t('Add a job by hand — paste anything, a company’s board, a LinkedIn export', 'Agregar un aviso a mano — pegar cualquier cosa, el board de una empresa, una exportación de LinkedIn')}
        </button>
        {showMore && <div className="mt-3"><ImportPanel store={store} onDone={async () => { await Promise.all([load(), reload()]); }} /></div>}
      </div>
    </div>
  );
}

function StepDot({ state }: { state: Step['state'] }) {
  if (state === 'run') return <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />;
  const cls = { wait: 'bg-line', done: 'bg-brand-500', skip: 'bg-line', error: 'bg-amber-400' }[state];
  return <span className={`h-3 w-3 shrink-0 rounded-full ${cls}`} />;
}

/* ---------------------------------------------------------------- the AI's top 10 */

const FIT: Record<string, { tone: string; dot: string; en: string; es: string }> = {
  great: { tone: 'text-brand-700', dot: 'bg-lime-400', en: 'Great fit', es: 'Ideal' },
  good: { tone: 'text-brand-700', dot: 'bg-brand-400', en: 'Worth applying', es: 'Vale la pena' },
  stretch: { tone: 'text-amber-700', dot: 'bg-amber-400', en: 'Stretch', es: 'Exigente' },
  no: { tone: 'text-rose-700', dot: 'bg-rose-400', en: 'Not a fit', es: 'No encaja' },
};

function TopPicks({ picks, picking, canRun, onRun, leaving, onApply, onHide }: {
  picks: BrowseJob[] | null; picking: boolean; canRun: boolean; onRun: () => void;
  leaving: Set<number>; onApply: (j: BrowseJob) => void; onHide: (j: BrowseJob) => void;
}) {
  const t = useT();
  const ui = useUILang();
  return (
    <section className="relative overflow-hidden rounded-3xl bg-forest-900 p-5 text-white shadow-xl shadow-forest-900/15 sm:p-6">
      <div aria-hidden className="float-slow pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-lime-400/15 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-300/80">✨ {t('Read by the AI', 'Leídos por la IA')}</p>
          <h2 className="mt-1 text-2xl font-semibold">{t('Your top 10', 'Tus 10 mejores')}</h2>
        </div>
        {canRun && (
          <button onClick={onRun} disabled={picking}
                  className="rounded-full bg-lime-400 px-4 py-2 text-sm font-semibold text-forest-950 transition hover:bg-lime-300 disabled:opacity-60">
            {picking ? t('Reading the best 24…', 'Leyendo los mejores 24…') : picks?.length ? t('Read more', 'Leer más') : t('Pick my top 10', 'Elegir mis 10 mejores')}
          </button>
        )}
      </div>

      {picking && (
        <div className="relative mt-4 grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[.06]" style={{ animationDelay: `${i * 120}ms` }} />)}
        </div>
      )}

      {!picking && !picks?.length && (
        <p className="relative mt-3 max-w-xl text-sm text-white/65">
          {canRun
            ? t('The AI reads the best jobs in your list against your CV and puts the ten it would actually apply to right here, with why — and what you are missing.',
                'La IA lee los mejores avisos de tu lista contra tu CV y pone acá los diez a los que de verdad se postularía, con el porqué — y lo que te falta.')
            : t('Connect a free AI in AI keys to get your top 10.', 'Conectá una IA gratis en Claves de IA para tener tus 10 mejores.')}
        </p>
      )}

      {!picking && (picks?.length ?? 0) > 0 && (
        <div className="stagger relative mt-4 grid gap-2.5 sm:grid-cols-2">
          {picks!.map((j, i) => {
            const fit = FIT[j.fit];
            const where = [j.city, j.remote ? t('Remote', 'Remoto') : ''].filter(Boolean).join(' · ');
            return (
              <div key={j.id} className={`group rounded-2xl bg-white/[.07] p-4 ring-1 ring-white/10 transition hover:bg-white/[.1] ${leaving.has(j.id) ? 'job-leave' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="font-display text-2xl font-semibold leading-none text-lime-300/90">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <a href={j.url || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium text-white hover:underline">{j.title}</a>
                    <p className="mt-0.5 truncate text-xs text-white/55">{j.company}{where && ` · ${where}`}</p>
                  </div>
                </div>
                {fit && (
                  <p className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-lime-300">
                    <span className={`h-1.5 w-1.5 rounded-full ${fit.dot}`} />{fit[ui]}
                  </p>
                )}
                {j.fit_why && <p className="mt-1 line-clamp-2 text-xs text-white/70">{j.fit_why}</p>}
                {j.fit_gap && <p className="mt-1 line-clamp-1 text-xs text-amber-200/80">{t('Missing', 'Falta')}: {j.fit_gap}</p>}
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => onApply(j)}
                          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${j.starred ? 'bg-white/15 text-lime-300' : 'bg-lime-400 text-forest-950 hover:bg-lime-300'}`}>
                    {j.starred ? t('✓ In Apply', '✓ En Postularte') : t('I want to apply →', 'Quiero postularme →')}
                  </button>
                  <button onClick={() => onHide(j)} className="rounded-full px-2.5 py-1.5 text-xs text-white/40 transition hover:bg-white/10 hover:text-white" title={t('Not for me', 'No es para mí')}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- filters */

const n = (facets: Facet[] | undefined, v: string | number) => facets?.find((f) => String(f.v) === String(v))?.n ?? 0;

function FiltersRow({ filters: f, set, data, prefs }: { filters: Filters; set: (p: Partial<Filters>) => void; data: BrowseResult | null; prefs: JobPrefs }) {
  const t = useT();
  const [q, setQ] = useState(f.q);
  const fc = data?.facets;
  const cities = useMemo(() => (fc?.city ?? []).filter((c) => String(c.v)), [fc]);
  const LEVELS: [string, string][] = [['intern', t('Internship', 'Pasantía')], ['junior', 'Junior'], ['mid', 'Semi-senior'], ['senior', 'Senior'], ['any', t('Not stated', 'Sin indicar')]];
  const sourceLabel = (s: string) => s === 'jsearch' ? 'Google for Jobs' : s === 'getonbrd' ? 'Get on Board' : s === 'alert:linkedin' ? 'LinkedIn' : s.startsWith('alert:') ? s.slice(6) : s;
  const where = f.remote === 'only' ? t('Remote only', 'Sólo remotos') : f.city || t('All my places', 'Todos mis lugares');
  const levelLabel = f.levels.length ? f.levels.map((l) => LEVELS.find((x) => x[0] === l)?.[1]).join(', ') : t('Any', 'Cualquiera');
  const moreCount = [f.lang, f.days, f.source, f.sort !== 'relevance'].filter(Boolean).length;

  // Every active filter, shown once as a chip you can remove — the only tags on the page.
  const chips: { label: string; clear: () => void }[] = [
    ...(f.q ? [{ label: `“${f.q}”`, clear: () => { setQ(''); set({ q: '' }); } }] : []),
    ...(f.city ? [{ label: f.city, clear: () => set({ city: '', remote: prefs.remote ? 'include' : 'exclude' }) }] : []),
    ...(f.remote === 'only' ? [{ label: t('Remote only', 'Sólo remotos'), clear: () => set({ remote: 'include' }) }] : []),
    ...f.levels.map((l) => ({ label: LEVELS.find((x) => x[0] === l)?.[1] ?? l, clear: () => set({ levels: f.levels.filter((x) => x !== l) }) })),
    ...(f.lang ? [{ label: f.lang === 'es' ? t('In Spanish', 'En español') : t('In English', 'En inglés'), clear: () => set({ lang: '' }) }] : []),
    ...(f.days ? [{ label: t(`Last ${f.days} days`, `Últimos ${f.days} días`), clear: () => set({ days: 0 }) }] : []),
    ...(f.source ? [{ label: sourceLabel(f.source), clear: () => set({ source: '' }) }] : []),
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q }); }} onBlur={() => set({ q })}
                 placeholder={t('Search a company or a word', 'Buscar una empresa o una palabra')}
                 className="w-full rounded-full border border-line bg-surface py-2 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100" />
        </div>

        <Dropdown label={t('Where', 'Dónde')} value={where} active={Boolean(f.city) || f.remote === 'only'}>
          {(close) => (
            <>
              <Option on={!f.city && f.remote !== 'only'} onClick={() => { set({ city: '', remote: prefs.remote ? 'include' : 'exclude' }); close(); }}>{t('All my places', 'Todos mis lugares')}</Option>
              {cities.slice(0, 10).map((c) => (
                <Option key={String(c.v)} on={f.city === String(c.v)} count={c.n} onClick={() => { set({ city: String(c.v), remote: 'exclude' }); close(); }}>{String(c.v)}</Option>
              ))}
              {prefs.remote && <Option on={f.remote === 'only'} count={n(fc?.remote, 1)} onClick={() => { set({ remote: 'only', city: '' }); close(); }}>{t('Remote only', 'Sólo remotos')}</Option>}
            </>
          )}
        </Dropdown>

        <Dropdown label={t('Level', 'Nivel')} value={levelLabel} active={f.levels.length > 0}>
          {LEVELS.map(([v, label]) => (
            <Option key={v} multi on={f.levels.includes(v)} count={n(fc?.level, v === 'any' ? '' : v)}
                    onClick={() => set({ levels: f.levels.includes(v) ? f.levels.filter((x) => x !== v) : [...f.levels, v] })}>{label}</Option>
          ))}
        </Dropdown>

        <Dropdown label={t('More', 'Más')} value={moreCount ? String(moreCount) : undefined} active={moreCount > 0} align="right" width="w-72">
          <div className="space-y-3 p-2">
            <Select label={t('Sort', 'Orden')} value={f.sort} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })}>
              <option value="relevance">{t('Best match', 'Mejor coincidencia')}</option>
              <option value="newest">{t('Newest', 'Más nuevos')}</option>
            </Select>
            <Select label={t('Language of the posting', 'Idioma del aviso')} value={f.lang} onChange={(e) => set({ lang: e.target.value })}>
              <option value="">{t('Any', 'Cualquiera')}</option>
              <option value="es">{t('Spanish', 'Español')} ({n(fc?.lang, 'es')})</option>
              <option value="en">{t('English', 'Inglés')} ({n(fc?.lang, 'en')})</option>
            </Select>
            <Select label={t('Posted', 'Publicado')} value={String(f.days)} onChange={(e) => set({ days: Number(e.target.value) })}>
              <option value="0">{t('Any time', 'Cuando sea')}</option>
              <option value="3">{t('Last 3 days', 'Últimos 3 días')}</option>
              <option value="7">{t('Last week', 'Última semana')}</option>
              <option value="30">{t('Last month', 'Último mes')}</option>
            </Select>
            <Select label={t('Source', 'Fuente')} value={f.source} onChange={(e) => set({ source: e.target.value })}>
              <option value="">{t('Every source', 'Todas')}</option>
              {(fc?.source ?? []).map((s) => <option key={String(s.v)} value={String(s.v)}>{sourceLabel(String(s.v))} ({s.n})</option>)}
            </Select>
          </div>
        </Dropdown>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c.label} onClick={c.clear} className="animate-fade group flex items-center gap-1.5 rounded-full bg-forest-900 px-3 py-1 text-xs text-lime-300 transition hover:bg-forest-800">
              {c.label}<span className="text-white/50 group-hover:text-white">✕</span>
            </button>
          ))}
          <button onClick={() => { setQ(''); set({ ...defaults(prefs), view: f.view }); }} className="text-xs text-ink-400 hover:text-ink-900">{t('Clear all', 'Limpiar todo')}</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- one job */

function JobCard({ j, isNew, leaving, onApply, onHide }: {
  j: BrowseJob; isNew: boolean; leaving: boolean; onApply: () => void; onHide: () => void;
}) {
  const t = useT();
  const ui = useUILang();
  const [open, setOpen] = useState(false);
  const age = j.posted_on ? fmtDate(j.posted_on) : '';
  const tags = [j.remote ? t('Remote', 'Remoto') : '', j.level === 'intern' ? t('Internship', 'Pasantía') : j.level === 'junior' ? 'Junior' : ''].filter(Boolean);
  const source = j.source.startsWith('jsearch') ? 'Google' : j.source === 'getonbrd' ? 'Get on Board' : j.source === 'alert:linkedin' ? 'LinkedIn' : j.source.replace('alert:', '');
  const fit = FIT[j.fit];

  return (
    <div className={`card-hover rounded-2xl border bg-surface px-5 py-4 ${j.starred ? 'border-lime-400 bg-lime-300/10' : 'border-line'} ${leaving ? 'job-leave' : ''}`}>
      <div className="flex items-start gap-4">
        <MatchMeter match={j.match} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={j.url || undefined} target="_blank" rel="noreferrer" className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">{j.title}</a>
            {isNew && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">{t('New', 'Nuevo')}</span>}
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            {j.company}{(j.city || j.country) && ` · ${j.city || countryName(j.country, ui)}`}{age && ` · ${age}`}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
            {tags.map((tag) => <span key={tag} className="rounded-full bg-sunken px-2 py-0.5 text-ink-600">{tag}</span>)}
            {j.reasons?.length > 0 && <span className="text-brand-700">✓ {j.reasons.join(' · ')}</span>}
            {fit && <span className={fit.tone}>· {fit[ui]}</span>}
            <span>· {source}</span>
            {j.description && <button onClick={() => setOpen((o) => !o)} className="underline-offset-2 hover:text-ink-900 hover:underline">{open ? t('less', 'menos') : t('details', 'detalle')}</button>}
          </p>
          {open && <p className="animate-fade mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-500">{j.fit_why && <span className="mb-1 block text-ink-700">{j.fit_why}</span>}{j.description.slice(0, 1200)}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={onApply}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 ${j.starred ? 'bg-lime-300/60 text-forest-900' : 'bg-forest-900 text-lime-300 hover:bg-forest-800'}`}>
            {j.starred ? t('✓ Applying', '✓ Postulándome') : t('I want to apply →', 'Quiero postularme →')}
          </button>
          <button onClick={onHide} title={j.dismissed ? t('Show again', 'Mostrar de nuevo') : t('Not for me', 'No es para mí')}
                  className="grid h-9 w-9 place-items-center rounded-full text-ink-400 transition hover:bg-rose-50 hover:text-rose-600">
            {j.dismissed ? '↺' : '✕'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** How well the job matches what you are looking for, 0–100. */
function MatchMeter({ match }: { match: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const tone = match >= 70 ? 'var(--color-brand-500)' : match >= 45 ? 'var(--color-brand-300)' : 'var(--color-line-strong)';
  return (
    <div className="relative grid h-11 w-11 shrink-0 place-items-center">
      <svg width="44" height="44" viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--color-sunken)" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - match / 100)}
                style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.22,.9,.3,1)' }} />
      </svg>
      <span className={`relative text-xs font-semibold tabular-nums ${match >= 70 ? 'text-brand-700' : 'text-ink-600'}`}>{match}</span>
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
