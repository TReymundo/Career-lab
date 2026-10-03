import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from './ui.tsx';
import CVSheet from './CVSheet.tsx';
import Tabs from './Tabs.tsx';
import { toast } from './Toast.tsx';
import { api, today, type Kit, type KitDecisions } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { buildCV, type Tailor } from '../lib/templates.ts';
import { parseBullets, type Job, type Store, type Track } from '../lib/types.ts';

/**
 * Step 3: one application kit per job you want — a CV rewritten for it and a cover letter
 * written from your own stories. Kits build side by side (two at a time), each with its own
 * progress; open one to see what the job asks for, what changed and why, and accept or reject
 * every change before downloading.
 */

const firstTrack = (s: Store): Track => {
  try { return (JSON.parse(s.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other'; }
};

export default function ApplyKits({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const ui = useUILang();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ready, setReady] = useState<Set<number>>(new Set());
  const [building, setBuilding] = useState<Set<number>>(new Set());
  const [failed, setFailed] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<number | null>(null);
  const queue = useRef<number[]>([]);
  const active = useRef(0);

  const load = async () => {
    const [j, k] = await Promise.all([api.searchJobs({ starred: true, limit: 500 }), api.kits()]);
    setJobs(j.rows);
    setReady(new Set(k.kits.map((x) => x.job_id)));
  };
  useEffect(() => { void load(); }, [store.application.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Two kits at a time: fast enough, and gentle on the free AI limits. Every job keeps its own spinner. */
  const pump = () => {
    while (active.current < 2 && queue.current.length) {
      const id = queue.current.shift()!;
      active.current++;
      void api.buildKit(id, ui)
        .then(() => { setReady((r) => new Set(r).add(id)); setFailed((f) => { const n = { ...f }; delete n[id]; return n; }); })
        .catch((e) => setFailed((f) => ({ ...f, [id]: e instanceof Error ? e.message : String(e) })))
        .finally(() => {
          active.current--;
          setBuilding((b) => { const n = new Set(b); n.delete(id); return n; });
          void reload();
          pump();
        });
    }
  };
  const build = (ids: number[]) => {
    const fresh = ids.filter((id) => !building.has(id) && !queue.current.includes(id));
    if (!fresh.length) return;
    setBuilding((b) => { const n = new Set(b); fresh.forEach((id) => n.add(id)); return n; });
    queue.current.push(...fresh);
    pump();
  };

  if (open !== null) {
    const job = jobs.find((j) => j.id === open);
    if (job) return <KitView job={job} store={store} reload={reload} onBack={() => { setOpen(null); void load(); }} />;
  }

  if (!jobs.length) {
    return (
      <div className="rounded-3xl border border-dashed border-line-strong bg-surface/60 p-12 text-center">
        <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-2xl text-brand-600">→</span>
        <p className="font-display text-xl font-semibold text-forest-900">{t('No jobs here yet', 'Todavía no hay avisos acá')}</p>
        <p className="mt-1 text-sm text-ink-500">{t('In step 2, press “I want to apply” on the jobs you like. They line up here.', 'En el paso 2, tocá “Quiero postularme” en los avisos que te gusten. Aparecen acá.')}</p>
        <Link to="/jobs" className="mt-4 inline-block"><Button variant="primary">{t('← Find jobs', '← Buscar avisos')}</Button></Link>
      </div>
    );
  }

  const notStarted = jobs.filter((j) => !ready.has(j.id) && !building.has(j.id)).map((j) => j.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-ink-500">
          {t(`${jobs.length} jobs you want · ${ready.size} kits ready`, `${jobs.length} avisos que querés · ${ready.size} kits listos`)}
          {store.story.length === 0 && <> · <Link to="/story" className="text-brand-700 hover:underline">{t('tell your story first for much better letters', 'contá tu historia primero para cartas mucho mejores')}</Link></>}
        </p>
        {notStarted.length > 0 && (
          <Button variant="primary" onClick={() => build(notStarted)}>{t(`Build ${notStarted.length} kits`, `Armar ${notStarted.length} kits`)}</Button>
        )}
      </div>

      <div className="stagger space-y-2.5">
        {jobs.map((j) => {
          const state = building.has(j.id) ? 'building' : ready.has(j.id) ? 'ready' : failed[j.id] ? 'failed' : 'new';
          return (
            <div key={j.id} className={`flex items-center gap-4 rounded-2xl border bg-surface px-5 py-4 transition ${state === 'ready' ? 'border-lime-400' : 'border-line'}`}>
              <KitBadge state={state} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink-900">{j.title}</p>
                <p className="truncate text-sm text-ink-500">{j.company}{j.city ? ` · ${j.city}` : ''}</p>
                {state === 'building' && <p className="mt-1 text-xs text-brand-700">{t('Reading the job, matching your CV and stories, writing…', 'Leyendo el aviso, cruzando tu CV y tus historias, escribiendo…')}</p>}
                {state === 'failed' && <p className="mt-1 line-clamp-1 text-xs text-amber-700">{failed[j.id]}</p>}
              </div>
              {state === 'ready' && <Button variant="primary" onClick={() => setOpen(j.id)}>{t('Open kit →', 'Abrir kit →')}</Button>}
              {(state === 'new' || state === 'failed') && <Button onClick={() => build([j.id])}>{state === 'failed' ? t('Try again', 'Reintentar') : t('Build kit', 'Armar kit')}</Button>}
              <button onClick={async () => { await api.update('job', j.id, { starred: 0 }); await load(); await reload(); }}
                      title={t('Remove from Apply', 'Sacar de Postularte')} className="grid h-9 w-9 place-items-center rounded-full text-ink-400 transition hover:bg-rose-50 hover:text-rose-600">✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KitBadge({ state }: { state: 'new' | 'building' | 'ready' | 'failed' }) {
  if (state === 'building') return <span className="orb orb-think h-10 w-10 shrink-0 rounded-full" />;
  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold ${
      state === 'ready' ? 'bg-lime-400 text-forest-950' : state === 'failed' ? 'bg-amber-100 text-amber-700' : 'bg-sunken text-ink-400'}`}>
      {state === 'ready' ? '✓' : state === 'failed' ? '!' : '·'}
    </span>
  );
}

/* ---------------------------------------------------------------- one kit */

function KitView({ job, store, reload, onBack }: { job: Job; store: Store; reload: () => Promise<void>; onBack: () => void }) {
  const t = useT();
  const ui = useUILang();
  const [kit, setKit] = useState<Kit | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [letter, setLetter] = useState('');
  const [view, setView] = useState<'cv' | 'letter'>('cv');
  const [busy, setBusy] = useState('');
  const [jd, setJd] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    void api.getKit(job.id).then(({ kit: k }) => {
      setKit(k);
      setRejected(new Set(k?.decisions.rejected ?? []));
      setLetter(k?.decisions.letter ?? k?.data.letter ?? '');
    });
  }, [job.id]);

  // Your decisions are saved as you make them.
  const first = useRef(true);
  useEffect(() => {
    if (!kit) return;
    if (first.current) { first.current = false; return; }
    const d: KitDecisions = { rejected: [...rejected], letter };
    const id = setTimeout(() => void api.saveKitDecisions(job.id, d), 500);
    return () => clearTimeout(id);
  }, [rejected, letter]); // eslint-disable-line react-hooks/exhaustive-deps

  const lang = kit?.data.lang ?? ui;
  const tailor: Tailor | undefined = useMemo(() => {
    if (!kit) return undefined;
    const d = kit.data;
    const lines: Record<string, string> = {};
    for (const e of d.edits) {
      const key = e.target.replace(/^line\s*/i, '').trim();
      if (!rejected.has(`edit:${key}`)) lines[key] = e.to;
    }
    return {
      headline: rejected.has('headline') ? undefined : d.headline,
      summary: rejected.has('summary') ? undefined : d.summary,
      skills: rejected.has('skills') ? undefined : d.skills,
      order: rejected.has('order') ? undefined : d.order,
      drop: d.drop.filter((id) => !rejected.has(`drop:${id}`)),
      lines,
    };
  }, [kit, rejected]);

  if (!kit) return <div className="skeleton h-96 rounded-3xl" />;
  const d = kit.data;
  const markdown = buildCV(store.profile, store.experience, { track: firstTrack(store), lang, template: 'ats', tailor });
  const letterMd = [`# ${store.profile.name}`, `^ ${[store.profile.location, store.profile.email, store.profile.phone].filter(Boolean).join(' • ')}`, '---', '',
    ...letter.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).flatMap((p) => [p, ''])].join('\n');

  const score = d.requirements.reduce((s, r) => s + (r.covered === 'yes' ? 1 : r.covered === 'partly' ? 0.5 : 0), 0);
  const pct = d.requirements.length ? Math.round((score / d.requirements.length) * 100) : 0;
  const toggle = (key: string) => setRejected((r) => { const n = new Set(r); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const lineText = (key: string) => {
    const [id, i] = key.split('.').map(Number);
    return parseBullets(store.experience.find((e) => e.id === id)?.bullets ?? '[]')[i]?.text ?? '';
  };

  const rebuild = async (extra?: string) => {
    setBusy('rebuild');
    try {
      const { kit: k } = await api.buildKit(job.id, ui, extra);
      setKit(k); setRejected(new Set()); setLetter(k.data.letter);
      toast(t('Kit rebuilt', 'Kit rearmado'), t('With everything new it knows about you.', 'Con todo lo nuevo que sabe de vos.'));
    } catch (e) { toast(t('Could not rebuild', 'No se pudo rearmar'), e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };

  const answerGaps = async () => {
    setBusy('gaps');
    for (const [i, a] of Object.entries(answers)) {
      if (a.trim()) await api.storyTurn({ question: d.gaps[Number(i)].question, answer: a, theme: 'gap', isFollowUp: true, lang: ui }).catch(() => {});
    }
    setAnswers({});
    await reload();
    await rebuild();
  };

  const download = async (which: 'cv' | 'letter', format: 'pdf' | 'docx') => {
    setBusy(`${which}-${format}`);
    try {
      const name = await api.exportFile({ markdown: which === 'cv' ? markdown : letterMd, format, kind: which === 'cv' ? 'cv' : 'cover', company: job.company, lang, name: store.profile.name });
      toast(t('Downloaded', 'Descargado'), name);
    } catch (e) { toast(t('Could not export', 'No se pudo exportar'), e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };

  const applied = async () => {
    setBusy('applied');
    const appId = kit.application_id ?? job.application_id;
    if (appId) {
      await api.create('document', { application_id: appId, kind: 'cv', title: `CV — ${job.company} — ${job.title}`.slice(0, 120), body: markdown });
      await api.create('document', { application_id: appId, kind: 'cover', title: `${t('Cover letter', 'Carta')} — ${job.company}`.slice(0, 120), body: letterMd });
      await api.update('application', appId, { status: 'applied', applied_on: today() });
    }
    await reload();
    setBusy('');
    toast(t('Marked as applied 🎉', 'Marcado como postulado 🎉'), t('Both documents are filed, and the job moved to Track.', 'Los dos documentos quedaron guardados, y el aviso pasó a Seguimiento.'));
  };

  const ReqIcon = ({ c }: { c: string }) => (
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${c === 'yes' ? 'bg-brand-500 text-white' : c === 'partly' ? 'bg-lime-300 text-forest-900' : 'bg-amber-100 text-amber-700'}`}>
      {c === 'yes' ? '✓' : c === 'partly' ? '½' : '!'}
    </span>
  );

  return (
    <div className="page-fwd space-y-5">
      <button onClick={onBack} className="text-sm text-ink-500 hover:text-ink-900">← {t('All jobs', 'Todos los avisos')}</button>

      <div className="relative overflow-hidden rounded-3xl bg-forest-900 p-6 text-white">
        <div aria-hidden className="float-slow pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-lime-400/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <Ring pct={pct} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-300/80">{t('Application kit', 'Kit de postulación')}</p>
            <h2 className="mt-1 text-2xl font-semibold">{job.title}</h2>
            <p className="text-sm text-white/60">{job.company}{job.url && <> · <a href={job.url} target="_blank" rel="noreferrer" className="text-lime-300 hover:underline">{t('open posting', 'ver aviso')} ↗</a></>}</p>
            <p className="mt-2 max-w-2xl text-sm text-white/75">{d.why}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)] xl:items-start">
        <div className="space-y-4">
          {!d.hasPosting && (
            <Card className="border-amber-200 bg-amber-50/60 p-4">
              <p className="text-sm font-medium text-ink-900">{t('Built from the job title only', 'Armado sólo con el título del aviso')}</p>
              <p className="mt-1 text-xs text-ink-600">{t('The posting text was not available. Paste it here for a much sharper kit.', 'No estaba el texto del aviso. Pegalo acá para un kit mucho más preciso.')}</p>
              <textarea rows={4} value={jd} onChange={(e) => setJd(e.target.value)} placeholder={t('Paste the job description…', 'Pegá la descripción del aviso…')}
                        className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400" />
              <Button variant="primary" className="mt-2" disabled={!jd.trim() || busy !== ''} onClick={() => rebuild(jd)}>{busy === 'rebuild' ? t('Rebuilding…', 'Rearmando…') : t('Rebuild with it', 'Rearmar con esto')}</Button>
            </Card>
          )}

          <Card className="p-5">
            <p className="font-display text-lg font-semibold text-forest-900">{t('What they want', 'Lo que buscan')}</p>
            <ul className="stagger mt-3 space-y-2.5">
              {d.requirements.map((r, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <ReqIcon c={r.covered} />
                  <span className="min-w-0"><span className="text-ink-900">{r.text}</span>{r.evidence && <span className="block text-xs text-ink-400">{r.evidence}</span>}</span>
                </li>
              ))}
            </ul>
          </Card>

          {d.gaps.length > 0 && (
            <Card className="p-5">
              <p className="font-display text-lg font-semibold text-forest-900">{t('Quick questions', 'Preguntas rápidas')}</p>
              <p className="mt-0.5 text-xs text-ink-500">{t('Answer what is true. It joins your story bank and the kit is rebuilt with it.', 'Respondé lo que sea cierto. Se suma a tu banco de historias y el kit se rearma con eso.')}</p>
              <div className="mt-3 space-y-3">
                {d.gaps.map((g, i) => (
                  <div key={i}>
                    <p className="text-sm text-ink-800">{g.question}</p>
                    <textarea rows={2} value={answers[i] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400" placeholder={t('Your answer (or leave empty)', 'Tu respuesta (o dejalo vacío)')} />
                  </div>
                ))}
                <Button variant="primary" disabled={!Object.values(answers).some((a) => a.trim()) || busy !== ''} onClick={answerGaps}>
                  {busy === 'gaps' || busy === 'rebuild' ? t('Learning and rebuilding…', 'Aprendiendo y rearmando…') : t('Save answers & rebuild', 'Guardar y rearmar')}
                </Button>
              </div>
            </Card>
          )}

          <Card className="p-5">
            <p className="font-display text-lg font-semibold text-forest-900">{t('What changed', 'Qué cambió')}</p>
            <p className="mt-0.5 text-xs text-ink-500">{t('Everything is on. Switch off what you don’t want — the page updates.', 'Todo está activado. Apagá lo que no quieras — la página se actualiza.')}</p>
            <div className="mt-3 space-y-2">
              <Change on={!rejected.has('headline')} onToggle={() => toggle('headline')} label={t('Headline', 'Título')} from={store.profile.headline} to={d.headline} />
              <Change on={!rejected.has('summary')} onToggle={() => toggle('summary')} label={t('Profile', 'Perfil')} from={store.profile.summary} to={d.summary} />
              {d.edits.map((e) => {
                const key = e.target.replace(/^line\s*/i, '').trim();
                return <Change key={key} on={!rejected.has(`edit:${key}`)} onToggle={() => toggle(`edit:${key}`)} label={e.why} from={lineText(key)} to={e.to} />;
              })}
              <Change on={!rejected.has('skills')} onToggle={() => toggle('skills')} label={t('Skills, most relevant first', 'Habilidades, las relevantes primero')} from={store.profile.skills} to={d.skills} />
              <Change on={!rejected.has('order')} onToggle={() => toggle('order')} label={t('Most relevant entries first', 'Lo más relevante primero')} />
              {d.drop.map((id) => {
                const e = store.experience.find((x) => x.id === id);
                return e ? <Change key={id} on={!rejected.has(`drop:${id}`)} onToggle={() => toggle(`drop:${id}`)} label={t(`Leave out “${e.title || e.org}” for this job`, `Dejar afuera “${e.title || e.org}” para este aviso`)} /> : null;
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-3 xl:sticky xl:top-6">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={view} onChange={setView} tabs={[{ key: 'cv', label: t('Tailored CV', 'CV a medida') }, { key: 'letter', label: t('Cover letter', 'Carta') }]} />
            <div className="ml-auto flex gap-1.5">
              <Button disabled={busy !== ''} onClick={() => download(view, 'pdf')}>PDF ↓</Button>
              <Button disabled={busy !== ''} onClick={() => download(view, 'docx')}>Word ↓</Button>
            </div>
          </div>
          <div key={view} className="page-up rounded-3xl bg-gradient-to-br from-sunken to-brand-50/60 p-4 sm:p-6">
            {view === 'cv' ? <CVSheet markdown={markdown} /> : (
              <div className="space-y-3">
                <textarea rows={16} value={letter} onChange={(e) => setLetter(e.target.value)}
                          className="w-full rounded-2xl border border-line bg-white px-5 py-4 font-[Georgia,serif] text-[15px] leading-relaxed text-ink-900 outline-none focus:border-brand-400" />
                <p className="text-xs text-ink-500">{t('Edit freely — your version is kept. It was written from your CV and your story bank, never from private stories.', 'Editá lo que quieras — se guarda tu versión. Se escribió desde tu CV y tu banco de historias, nunca desde historias privadas.')}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" className="flex-1 py-3 text-base" disabled={busy !== ''} onClick={applied}>
              {busy === 'applied' ? t('Filing…', 'Guardando…') : t('I sent it — mark as applied ✓', 'Lo envié — marcar como postulado ✓')}
            </Button>
            <Button variant="ghost" disabled={busy !== ''} onClick={() => rebuild()}>{busy === 'rebuild' ? t('Rebuilding…', 'Rearmando…') : t('Rebuild', 'Rearmar')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Change({ on, onToggle, label, from, to }: { on: boolean; onToggle: () => void; label: string; from?: string; to?: string }) {
  return (
    <button onClick={onToggle} className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${on ? 'border-brand-200 bg-brand-50/50' : 'border-line bg-surface opacity-60'}`}>
      <span className="flex items-start gap-2.5">
        <span className={`mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition ${on ? 'bg-brand-500' : 'bg-line-strong'}`}>
          <span className={`block h-3 w-3 rounded-full bg-white transition ${on ? 'translate-x-3' : ''}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-ink-500">{label}</span>
          {from && to && on && <span className="mt-1 block text-xs text-ink-400 line-through decoration-ink-300">{from.slice(0, 220)}</span>}
          {to && <span className={`mt-0.5 block ${on ? 'text-ink-900' : 'text-ink-500'}`}>{to.slice(0, 320)}</span>}
        </span>
      </span>
    </button>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-20 w-20 shrink-0 place-items-center">
      <svg width="80" height="80" viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgb(255 255 255 / .12)" strokeWidth="8" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-lime-400)" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
                style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.22,.9,.3,1)' }} />
      </svg>
      <span className="relative text-center leading-none">
        <span className="block font-display text-xl font-semibold text-white">{pct}%</span>
        <span className="text-[9px] uppercase tracking-wider text-white/50">match</span>
      </span>
    </div>
  );
}
