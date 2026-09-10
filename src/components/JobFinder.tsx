import { useState } from 'react';
import { Area, Badge, Button, Card, Field } from './ui.tsx';
import { api, type SourcePlan } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { buildCV } from '../lib/templates.ts';
import type { Store, Track } from '../lib/types.ts';

/**
 * Getting openings into the app is the slowest part of a job search, so this attacks it from
 * three directions at once.
 *
 * The AI here never produces a job posting. It produces *searches* and *company names* from
 * what you have already told the app — and the app then fetches the real openings from real
 * boards. A model inventing a vacancy and a URL is how you end up applying to nothing.
 */
export default function JobFinder({ store, onDone }: { store: Store; onDone: () => Promise<void> }) {
  const t = useT();
  const lang = useUILang();

  const [keywords, setKeywords] = useState('');
  const [plan, setPlan] = useState<SourcePlan | null>(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [fetched, setFetched] = useState<Record<string, string>>({});

  const tracks = (() => {
    try { return (JSON.parse(store.setting['tracks'] || '[]') as Track[]).join(', '); } catch { return ''; }
  })();

  const suggest = async () => {
    setBusy('plan'); setErr(''); setMsg('');
    try {
      const cv = buildCV(store.profile, store.experience, { track: 'other', lang, template: 'ats', maxBullets: 99 });
      const res = await api.aiSources({ cv, tracks, location: store.profile.location, keywords, lang });
      setPlan(res.plan);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };

  const extract = async () => {
    setBusy('extract'); setErr(''); setMsg('');
    try {
      const res = await api.aiExtractJobs({ text: paste, lang });
      setMsg(t(`Found ${res.jobs.length}, added ${res.inserted} (${res.skipped} already there).`,
               `Encontré ${res.jobs.length}, agregué ${res.inserted} (${res.skipped} ya estaban).`));
      setPaste('');
      await onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };

  const tryBoard = async (name: string, slug: string) => {
    setFetched((f) => ({ ...f, [name]: t('checking…', 'buscando…') }));
    try {
      const res = await api.fetchAts('auto', slug || name);
      setFetched((f) => ({ ...f, [name]: t(`${res.inserted} added`, `${res.inserted} agregados`) }));
      await onDone();
    } catch {
      setFetched((f) => ({ ...f, [name]: t('no public board', 'sin board público') }));
    }
  };

  const linkedinUrl = (q: { keywords: string; location: string }) =>
    `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q.keywords)}&location=${encodeURIComponent(q.location)}`;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
        <p className="text-sm font-medium text-ink-900">
          {t('Let the AI plan where to look', 'Que la IA planifique dónde buscar')}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {t('It reads your CV and suggests searches and employers. It cannot see live vacancies — the app fetches those itself.',
             'Lee tu CV y sugiere búsquedas y empresas. No puede ver vacantes en vivo — esas las trae la app.')}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field
            label={t('Anything you want included (optional)', 'Algo que quieras incluir (opcional)')}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder={t('remote, fintech, English-speaking, part-time…', 'remoto, fintech, en inglés, medio tiempo…')}
            className="min-w-64 flex-1"
          />
          <Button variant="primary" disabled={busy !== ''} onClick={suggest}>
            {busy === 'plan' ? t('Thinking…', 'Pensando…') : t('Suggest where to look', 'Sugerir dónde buscar')}
          </Button>
        </div>
      </div>

      {err && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{err}</p>}
      {msg && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{msg}</p>}

      {plan && (
        <div className="animate-rise space-y-4">
          {plan.titles?.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                {t('Titles you can apply for today', 'Puestos a los que podés aplicar hoy')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {plan.titles.map((title) => <Badge key={title} tone="green">{title}</Badge>)}
              </div>
            </div>
          )}

          {plan.queries?.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                {t('Searches — each opens LinkedIn ready to go', 'Búsquedas — cada una abre LinkedIn lista')}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {plan.queries.map((q, i) => (
                  <a key={i} href={linkedinUrl(q)} target="_blank" rel="noreferrer"
                     className="card-hover flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{q.label}</p>
                      <p className="truncate text-xs text-ink-500">{q.keywords} · {q.location}</p>
                    </div>
                    <span className="shrink-0 text-brand-600">↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {plan.companies?.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                {t('Employers worth checking — try each public board', 'Empresas para mirar — probá cada board público')}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {plan.companies.map((c) => (
                  <div key={c.name} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{c.name}</p>
                      <p className="truncate text-xs text-ink-500">{c.why}</p>
                    </div>
                    {fetched[c.name]
                      ? <Badge tone={fetched[c.name].includes('added') || fetched[c.name].includes('agregados') ? 'emerald' : 'slate'}>{fetched[c.name]}</Badge>
                      : <Button onClick={() => tryBoard(c.name, c.slug)}>{t('Try', 'Probar')}</Button>}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-400">
                {t('“No public board” is normal — most banks, consultancies and local employers run their own careers sites. Use the searches above for those.',
                   '“Sin board público” es normal — la mayoría de los bancos, consultoras y empresas locales tienen su propio sitio. Para esas, usá las búsquedas de arriba.')}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-line p-4">
        <p className="text-sm font-medium text-ink-900">{t('Or paste anything at all', 'O pegá cualquier cosa')}</p>
        <p className="mt-0.5 mb-2 text-xs text-ink-500">
          {t('A results page, one posting, a recruiter’s email, a list a friend sent you. The AI pulls the openings out of it.',
             'Una página de resultados, un aviso, el mail de un reclutador, una lista que te pasaron. La IA le saca los avisos.')}
        </p>
        <Area rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} className="font-mono text-xs"
              placeholder={t('Paste here — messy is fine.', 'Pegá acá — puede estar desordenado.')} />
        <div className="mt-2">
          <Button variant="primary" disabled={busy !== '' || !paste.trim()} onClick={extract}>
            {busy === 'extract' ? t('Reading…', 'Leyendo…') : t('Pull the jobs out of this', 'Sacar los avisos de acá')}
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <p className="text-sm font-medium text-ink-900">{t('Check one company by name', 'Buscar una empresa por nombre')}</p>
        <p className="mt-0.5 mb-2 text-xs text-ink-500">
          {t('Type the company. All three public board systems are tried automatically — you do not need to know which one they use.',
             'Escribí la empresa. Se prueban los tres sistemas de boards públicos — no necesitás saber cuál usan.')}
        </p>
        <ByName onDone={onDone} />
      </Card>
    </div>
  );
}

function ByName({ onDone }: { onDone: () => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field value={name} onChange={(e) => setName(e.target.value)} className="min-w-56 flex-1"
             placeholder={t('Company name, or paste their careers URL', 'Nombre de la empresa, o pegá el link de su página de empleos')} />
      <Button variant="primary" disabled={busy || !name.trim()} onClick={async () => {
        setBusy(true); setState('');
        try {
          const res = await api.fetchAts('auto', name.trim());
          setState(t(`${res.inserted} added from ${res.provider}${res.skipped ? `, ${res.skipped} already there` : ''}.`,
                     `${res.inserted} agregados desde ${res.provider}${res.skipped ? `, ${res.skipped} ya estaban` : ''}.`));
          setName('');
          await onDone();
        } catch (e) {
          setState(e instanceof Error ? e.message.replace(/^\d+\s*/, '') : String(e));
        }
        setBusy(false);
      }}>{busy ? t('Looking…', 'Buscando…') : t('Find their board', 'Buscar su board')}</Button>
      {state && <p className="w-full text-xs text-ink-500">{state}</p>}
    </div>
  );
}
