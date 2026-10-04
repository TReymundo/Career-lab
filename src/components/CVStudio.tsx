import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, Button, Card, Field } from './ui.tsx';
import CVSheet from './CVSheet.tsx';
import CVReveal from './CVReveal.tsx';
import Polish from './Polish.tsx';
import { AddToCV } from '../pages/Story.tsx';
import { toast } from './Toast.tsx';
import { api } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { buildCV, detectLang } from '../lib/templates.ts';
import { runChecks, type Check } from '../lib/cvcheck.ts';
import { parseBullets, type Experience, type Profile, type Store, type Track } from '../lib/types.ts';

/**
 * My CV — the studio.
 *
 * The page itself is always in view, on the right, exactly as it will print. On the left: a
 * score, then the CV's sections. Click one and it opens for editing right there; every change
 * saves itself and the page updates under your eyes. No long forms, no separate editor.
 */

type Section = 'header' | 'profile' | 'work' | 'education' | 'extra' | 'skills';

const firstTrack = (s: Store): Track => {
  try { return (JSON.parse(s.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other'; }
};

/** Saves a value a moment after you stop typing, so editing feels instant and never loses work. */
function useAutosave<V>(value: V, save: (v: V) => Promise<void>, delay = 600) {
  // Compared by content, not by "first run": only a real edit saves anything.
  const saved = useRef(JSON.stringify(value));
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  useEffect(() => {
    const now = JSON.stringify(value);
    if (now === saved.current) return;
    saved.current = now;
    setState('saving');
    const id = setTimeout(async () => { await save(value); setState('saved'); }, delay);
    return () => clearTimeout(id);
  }, [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function Saved({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  const t = useT();
  if (state === 'idle') return null;
  return <span className={`animate-fade text-xs ${state === 'saving' ? 'text-ink-400' : 'text-brand-600'}`}>{state === 'saving' ? t('Saving…', 'Guardando…') : `✓ ${t('Saved', 'Guardado')}`}</span>;
}

export default function CVStudio({ store, reload, onFix, onRestart, onUpload }: {
  store: Store; reload: () => Promise<void>; onFix: (c: Check) => void; onRestart: () => void; onUpload: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<Section | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const [showPolish, setShowPolish] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState('');

  const lang = detectLang(store.profile, store.experience);
  const markdown = buildCV(store.profile, store.experience, { track: firstTrack(store), lang, template: 'ats' });
  const checks = runChecks(store);
  const must = checks.filter((c) => c.level === 'must');
  const passed = must.filter((c) => c.ok).length;
  const made = store.setting['celebrated:cv'] === 'done';
  const noExperience = !store.experience.some((e) => e.kind !== 'education' && parseBullets(e.bullets).length);

  const open = (c: Check) => {
    const map: Record<string, Section> = { name: 'header', contact: 'header', target: 'header', education: 'education', experience: 'work', numbers: 'work', skills: 'skills', polish: 'profile', profile: 'work' };
    if (c.fix && map[c.fix]) setEditing(map[c.fix]); else onFix(c);
  };

  const create = async () => {
    setBusy('create');
    const already = store.document.some((d) => d.kind === 'cv' && d.application_id === null && d.body.trim() === markdown.trim());
    if (!already) {
      await api.create('document', { application_id: null, kind: 'cv', title: `CV (${lang.toUpperCase()}) — ${new Date().toLocaleDateString('en-GB')}`, body: markdown });
    }
    if (!made) {
      await api.setSetting('celebrated:cv', 'done');
      toast(t('Step 1 done', 'Paso 1 listo'), t('Your CV is saved. Step 2 — finding jobs — is open.', 'Tu CV quedó guardado. Se abrió el paso 2 — buscar avisos.'));
    }
    await reload();
    setBusy('');
    setReveal(true);
  };

  const download = async (format: 'pdf' | 'docx') => {
    setBusy(format);
    try { toast(t('Downloaded', 'Descargado'), await api.exportFile({ markdown, format, kind: 'cv', lang, name: store.profile.name })); }
    catch (e) { toast(t('Could not export', 'No se pudo exportar'), e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };

  const ofKind = (k: Experience['kind']) => store.experience.filter((e) => e.kind === k);
  const sectionChecks: Record<Section, string[]> = {
    header: ['name', 'email', 'phone', 'location', 'headline'], profile: ['summary'], work: ['experience', 'dates', 'numbers'],
    education: ['education'], extra: [], skills: ['skills', 'languages'],
  };
  const todo = (s: Section) => checks.filter((c) => sectionChecks[s].includes(c.id) && !c.ok).length;

  const SECTIONS: { key: Section; title: string; peek: string }[] = [
    { key: 'header', title: t('Name & contact', 'Nombre y contacto'), peek: [store.profile.name, store.profile.headline].filter(Boolean).join(' — ') || t('Empty', 'Vacío') },
    { key: 'profile', title: t('Profile', 'Perfil'), peek: store.profile.summary || t('A 2–3 line summary at the top', 'Un resumen de 2–3 líneas arriba') },
    { key: 'work', title: t('Experience', 'Experiencia'), peek: ofKind('work').map((e) => e.org || e.title).join(' · ') || t('Comes from your interview', 'Sale de tu entrevista') },
    { key: 'education', title: t('Education', 'Educación'), peek: ofKind('education').map((e) => e.org).join(' · ') || t('Nothing yet', 'Nada todavía') },
    { key: 'extra', title: t('Projects & activities', 'Proyectos y actividades'), peek: ofKind('extra').map((e) => e.title || e.org).join(' · ') || t('Optional', 'Opcional') },
    { key: 'skills', title: t('Skills & languages', 'Habilidades e idiomas'), peek: [store.profile.skills.split('\n')[0], store.profile.languages].filter(Boolean).join(' · ') || t('Nothing yet', 'Nada todavía') },
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:items-start">
      {reveal && <CVReveal store={store} onClose={() => setReveal(false)} />}

      <div className="space-y-4">
        <ScoreCard passed={passed} total={must.length} onToggle={() => setShowChecks((v) => !v)} open={showChecks}>
          {showChecks && (
            <ul className="stagger mt-3 space-y-1 border-t border-line pt-3">
              {checks.map((c) => (
                <li key={c.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm">
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${c.ok ? 'bg-brand-500 text-white' : c.level === 'must' ? 'bg-amber-100 text-amber-700' : 'bg-sunken text-ink-400'}`}>{c.ok ? '✓' : c.level === 'must' ? '!' : '·'}</span>
                  <span className={`min-w-0 flex-1 ${c.ok ? 'text-ink-500' : 'text-ink-900'}`} title={c.why(t)}>{c.label(t)}</span>
                  {!c.ok && c.fix && <button onClick={() => open(c)} className="text-xs font-medium text-brand-700 hover:underline">{t('Fix', 'Arreglar')}</button>}
                </li>
              ))}
            </ul>
          )}
        </ScoreCard>

        {/* The interview: where experience and skills come from in the build-with-me path. */}
        <div className="relative overflow-hidden rounded-3xl bg-forest-900 p-5 text-white shadow-lg shadow-forest-900/10">
          <div aria-hidden className="float-slow pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-lime-400/20 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <span className="orb h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-semibold">{store.story_answer.length ? t('Your story', 'Tu historia') : t('Let’s get to know you', 'Conozcámonos')}</p>
              <p className="text-xs text-white/65">
                {store.story_answer.length
                  ? t(`${store.story_answer.length} answers · ${store.story.length} things it knows about you`, `${store.story_answer.length} respuestas · ${store.story.length} cosas que sabe de vos`)
                  : noExperience
                    ? t('Your experience and skills come from here: ten open questions — just talk.', 'Tu experiencia y tus habilidades salen de acá: diez preguntas abiertas — sólo hablá.')
                    : t('A short chat — your answers make every cover letter sound like you.', 'Una charla corta — tus respuestas hacen que cada carta suene a vos.')}
              </p>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap items-center gap-2">
            <Link to="/story" className="rounded-full bg-lime-400 px-4 py-2 text-sm font-semibold text-forest-950 transition hover:bg-lime-300">
              {store.story_answer.length ? t('Keep talking →', 'Seguir charlando →') : t('Start the chat →', 'Empezar la charla →')}
            </Link>
            {store.story_answer.length > 0 && noExperience && <span className="text-xs text-white/60">{t('then add it to your CV', 'después agregalo a tu CV')}</span>}
          </div>
          {store.story_answer.length > 0 && noExperience && <AddToCV className="relative mt-3" />}
        </div>

        {/* Upload: for a CV that already exists as a file — added to what is here, or replacing it. */}
        <button onClick={onUpload}
                className="group flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 px-4 py-3.5 text-left transition hover:border-brand-400 hover:bg-brand-50">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-lime-400 text-lg font-bold text-forest-950 transition group-hover:-translate-y-0.5">↑</span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink-900">{t('Upload a CV file', 'Subir un CV')}</span>
            <span className="block text-xs text-ink-500">{t('PDF or Word. Anything it has gets added here — you check it first.', 'PDF o Word. Lo que tenga se suma acá — lo revisás antes.')}</span>
          </span>
          <span className="text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600">→</span>
        </button>

        {editing ? (
          <Card key={editing} className="page-fwd p-5">
            <button onClick={() => { setEditing(null); }} className="mb-4 text-sm text-ink-500 hover:text-ink-900">← {t('All sections', 'Todas las secciones')}</button>
            {editing === 'header' && <HeaderEditor profile={store.profile} reload={reload} />}
            {editing === 'profile' && <ProfileEditor store={store} reload={reload} />}
            {(editing === 'work' || editing === 'education' || editing === 'extra') && <EntriesEditor kind={editing} store={store} reload={reload} />}
            {editing === 'skills' && <SkillsEditor profile={store.profile} reload={reload} />}
          </Card>
        ) : (
          <div className="stagger space-y-2">
            {SECTIONS.map((s) => (
              <button key={s.key} onClick={() => setEditing(s.key)}
                      className="card-hover group flex w-full items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${todo(s.key) ? 'bg-amber-400' : 'bg-brand-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink-900">{s.title}</span>
                  <span className="block truncate text-xs text-ink-500">{s.peek}</span>
                </span>
                {todo(s.key) > 0 && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{todo(s.key)} {t('to fix', 'por arreglar')}</span>}
                <span className="shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600">→</span>
              </button>
            ))}
          </div>
        )}

        <Card className="overflow-hidden">
          <button onClick={() => setShowPolish((v) => !v)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime-300/60 text-lg">✨</span>
            <span className="flex-1">
              <span className="block font-medium text-ink-900">{t('Polish it with AI', 'Pulilo con IA')}</span>
              <span className="block text-xs text-ink-500">{t('Typos, weak wording, your profile line. You approve each change.', 'Errores, frases flojas, tu perfil. Aprobás cada cambio.')}</span>
            </span>
            <span className={`text-ink-400 transition ${showPolish ? 'rotate-90' : ''}`}>▸</span>
          </button>
          {showPolish && <div className="animate-fade border-t border-line p-1"><Polish store={store} reload={reload} /></div>}
        </Card>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!made
            ? <Button variant="primary" className="flex-1 py-3 text-base" disabled={busy !== '' || !store.profile.name.trim()} onClick={create}>
                {busy === 'create' ? t('Saving…', 'Guardando…') : t('Save my CV — finish step 1', 'Guardar mi CV — terminar el paso 1')}
              </Button>
            : <Button variant="soft" onClick={() => setReveal(true)}>{t('See it full size', 'Verlo en grande')}</Button>}
          <Button disabled={busy !== ''} onClick={() => download('pdf')}>{busy === 'pdf' ? '…' : 'PDF ↓'}</Button>
          <Button disabled={busy !== ''} onClick={() => download('docx')}>{busy === 'docx' ? '…' : 'Word ↓'}</Button>
        </div>
        <button onClick={onRestart} className="text-xs text-ink-400 hover:text-ink-900">
          {t('Start again — upload a CV or answer the questions', 'Empezar de nuevo — subir un CV o responder las preguntas')}
        </button>
      </div>

      {/* The page: always visible, always current. */}
      <div className="lg:sticky lg:top-6">
        <div className="rounded-3xl bg-gradient-to-br from-sunken to-brand-50/60 p-4 sm:p-7">
          <CVSheet markdown={markdown} className="sheet sheet-in" />
        </div>
      </div>
    </div>
  );
}

/** The score as a ring that fills — the one number that says how ready the CV is. */
function ScoreCard({ passed, total, onToggle, open, children }: { passed: number; total: number; onToggle: () => void; open: boolean; children: ReactNode }) {
  const t = useT();
  const r = 26;
  const c = 2 * Math.PI * r;
  const share = total ? passed / total : 0;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0 -rotate-90">
          <circle cx="34" cy="34" r={r} fill="none" stroke="var(--color-sunken)" strokeWidth="7" />
          <circle cx="34" cy="34" r={r} fill="none" stroke={share === 1 ? 'var(--color-lime-500)' : 'var(--color-brand-500)'} strokeWidth="7" strokeLinecap="round"
                  strokeDasharray={c} strokeDashoffset={c * (1 - share)} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.22,.9,.3,1)' }} />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl font-semibold text-forest-900">{passed}<span className="text-base text-ink-400"> / {total}</span></p>
          <p className="text-sm text-ink-500">{share === 1 ? t('Everything a recruiter looks for is here.', 'Está todo lo que busca un reclutador.') : t('What a good CV has', 'Lo que tiene un buen CV')}</p>
        </div>
        <button onClick={onToggle} className="text-xs font-medium text-brand-700 hover:underline">{open ? t('Hide', 'Ocultar') : t('Details', 'Detalle')}</button>
      </div>
      {children}
    </Card>
  );
}

/* ---------------------------------------------------------------- editors */

function HeaderEditor({ profile, reload }: { profile: Profile; reload: () => Promise<void> }) {
  const t = useT();
  const [d, setD] = useState({ name: profile.name, headline: profile.headline, email: profile.email, phone: profile.phone, location: profile.location, linkedin: profile.linkedin });
  const state = useAutosave(d, async (v) => { await api.saveProfile(v); await reload(); });
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between"><h3 className="font-display text-xl font-semibold text-forest-900">{t('Name & contact', 'Nombre y contacto')}</h3><Saved state={state} /></div>
      <Field label={t('Full name', 'Nombre completo')} value={d.name} onChange={(e) => set({ name: e.target.value })} />
      <Field label={t('Headline — the job you are going for', 'Título — el puesto al que apuntás')} value={d.headline} onChange={(e) => set({ headline: e.target.value })} placeholder={t('e.g. Junior Financial Analyst', 'ej. Analista Financiero Jr')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
        <Field label={t('Phone', 'Teléfono')} value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
        <Field label={t('City, country', 'Ciudad, país')} value={d.location} onChange={(e) => set({ location: e.target.value })} />
        <Field label="LinkedIn" value={d.linkedin} onChange={(e) => set({ linkedin: e.target.value })} />
      </div>
    </div>
  );
}

function ProfileEditor({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const lang = useUILang();
  const [text, setText] = useState(store.profile.summary);
  const [busy, setBusy] = useState(false);
  const state = useAutosave(text, async (v) => { await api.saveProfile({ summary: v }); await reload(); });
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between"><h3 className="font-display text-xl font-semibold text-forest-900">{t('Profile', 'Perfil')}</h3><Saved state={state} /></div>
      <p className="text-sm text-ink-500">{t('Two or three lines: who you are, what you can do, what you want. It sits in italics under your name.', 'Dos o tres líneas: quién sos, qué sabés hacer, qué buscás. Va en cursiva debajo de tu nombre.')}</p>
      <Area rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <Button variant="soft" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await api.aiSummary({ headline: store.profile.headline, bullets: store.experience.flatMap((e) => parseBullets(e.bullets).map((b) => b.text)), track: firstTrack(store), lang });
          setText(r.text);
        } catch (e) { toast(t('AI unavailable', 'IA no disponible'), e instanceof Error ? e.message : String(e)); }
        setBusy(false);
      }}>{busy ? t('Writing…', 'Escribiendo…') : t('✨ Write it from my CV', '✨ Escribirlo a partir de mi CV')}</Button>
    </div>
  );
}

function SkillsEditor({ profile, reload }: { profile: Profile; reload: () => Promise<void> }) {
  const t = useT();
  const [d, setD] = useState({ skills: profile.skills, languages: profile.languages });
  const state = useAutosave(d, async (v) => { await api.saveProfile(v); await reload(); });
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between"><h3 className="font-display text-xl font-semibold text-forest-900">{t('Skills & languages', 'Habilidades e idiomas')}</h3><Saved state={state} /></div>
      <Area label={t('Skills — one group per line, e.g. “Data analysis - SQL, Python, Power BI”', 'Habilidades — un grupo por línea, ej. “Análisis de datos - SQL, Python, Power BI”')}
            rows={5} value={d.skills} onChange={(e) => setD({ ...d, skills: e.target.value })} />
      <Field label={t('Languages, with level', 'Idiomas, con nivel')} value={d.languages} onChange={(e) => setD({ ...d, languages: e.target.value })} placeholder="Español (nativo), Inglés (C1)" />
    </div>
  );
}

function EntriesEditor({ kind, store, reload }: { kind: Experience['kind']; store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const entries = store.experience.filter((e) => e.kind === kind);
  const [openId, setOpenId] = useState<number | null>(entries.length === 1 ? entries[0].id : null);
  const title = { work: t('Experience', 'Experiencia'), education: t('Education', 'Educación'), extra: t('Projects & activities', 'Proyectos y actividades') }[kind];

  return (
    <div className="space-y-3">
      <h3 className="font-display text-xl font-semibold text-forest-900">{title}</h3>
      {entries.map((e) => (
        openId === e.id
          ? <EntryEditor key={e.id} entry={e} reload={reload} onClose={() => setOpenId(null)} />
          : (
            <button key={e.id} onClick={() => setOpenId(e.id)} className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left text-sm transition hover:border-brand-300">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-900">{e.org || e.title || t('Untitled', 'Sin título')}</span>
                <span className="block truncate text-xs text-ink-500">{[e.title, [e.start_date, e.end_date].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-xs text-ink-400">{parseBullets(e.bullets).length} {t('lines', 'líneas')}</span>
            </button>
          )
      ))}
      <Button onClick={async () => {
        const created = await api.create<Experience>('experience', { kind, org: '', title: '', bullets: '[]', sort_order: store.experience.length });
        await reload();
        setOpenId(created.id);
      }}>{t('+ Add', '+ Agregar')}</Button>
    </div>
  );
}

function EntryEditor({ entry, reload, onClose }: { entry: Experience; reload: () => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [d, setD] = useState({
    org: entry.org, title: entry.title, location: entry.location, start_date: entry.start_date, end_date: entry.end_date,
    bullets: parseBullets(entry.bullets),
  });
  const state = useAutosave(d, async (v) => {
    await api.update('experience', entry.id, { ...v, bullets: JSON.stringify(v.bullets.filter((b) => b.text.trim())) });
    await reload();
  });
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const setLine = (i: number, text: string) => set({ bullets: d.bullets.map((b, j) => (j === i ? { ...b, text } : b)) });
  const move = (i: number, by: number) => {
    const bs = [...d.bullets];
    const [x] = bs.splice(i, 1);
    bs.splice(Math.max(0, Math.min(bs.length, i + by)), 0, x);
    set({ bullets: bs });
  };

  return (
    <div className="animate-rise space-y-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-center justify-between">
        <Saved state={state} />
        <button onClick={onClose} className="ml-auto text-xs text-ink-500 hover:text-ink-900">{t('Done', 'Listo')}</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('Where (company, school…)', 'Dónde (empresa, institución…)')} value={d.org} onChange={(e) => set({ org: e.target.value })} />
        <Field label={t('Role / what', 'Rol / qué')} value={d.title} onChange={(e) => set({ title: e.target.value })} />
        <Field label={t('City', 'Ciudad')} value={d.location} onChange={(e) => set({ location: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('From', 'Desde')} value={d.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          <Field label={t('To', 'Hasta')} value={d.end_date} onChange={(e) => set({ end_date: e.target.value })} placeholder={t('Present', 'Actualidad')} />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-500">{t('Lines', 'Líneas')}</p>
        {d.bullets.map((b, i) => (
          <div key={i} className="group flex gap-2">
            <span className="pt-2 text-brand-500">•</span>
            <textarea rows={2} value={b.text} onChange={(e) => setLine(i, e.target.value)}
                      className="min-w-0 flex-1 resize-y rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100" />
            <div className="flex flex-col gap-0.5 opacity-40 transition group-hover:opacity-100">
              <button onClick={() => move(i, -1)} className="text-xs text-ink-500 hover:text-ink-900" title={t('Up', 'Subir')}>↑</button>
              <button onClick={() => move(i, 1)} className="text-xs text-ink-500 hover:text-ink-900" title={t('Down', 'Bajar')}>↓</button>
              <button onClick={() => set({ bullets: d.bullets.filter((_, j) => j !== i) })} className="text-xs text-ink-500 hover:text-rose-600" title={t('Delete', 'Borrar')}>✕</button>
            </div>
          </div>
        ))}
        <button onClick={() => set({ bullets: [...d.bullets, { text: '', es: '', tracks: [] }] })} className="text-sm font-medium text-brand-700 hover:underline">
          {t('+ Add a line', '+ Agregar una línea')}
        </button>
      </div>
      <button onClick={async () => { if (confirm(t('Delete this entry?', '¿Borrar esta entrada?'))) { await api.remove('experience', entry.id); await reload(); onClose(); } }}
              className="text-xs text-ink-400 hover:text-rose-600">{t('Delete entry', 'Borrar entrada')}</button>
    </div>
  );
}
