import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, useStore, type JourneyStatus } from './lib/api.ts';
import { setUILang, useT, useUILang } from './lib/i18n.ts';
import { STEPS, stepIndex, stepStates } from './lib/journey.ts';
import { ToastHost } from './components/Toast.tsx';
import Journey, { Logo } from './components/Journey.tsx';
import Landing from './pages/Landing.tsx';
import Start from './pages/Start.tsx';
import Jobs from './pages/Jobs.tsx';
import Contacts from './pages/Contacts.tsx';
import ProfilePage from './pages/Profile.tsx';
import Answers from './pages/Answers.tsx';
import Inbox from './pages/Inbox.tsx';
import Apply from './pages/Apply.tsx';
import Track from './pages/Track.tsx';
import AiKeys from './pages/AiKeys.tsx';
import StoryPage from './pages/Story.tsx';
import Tour, { TOUR_KEY } from './components/Tour.tsx';

/**
 * The shell: the journey on the left, the page on the right.
 *
 * Every page belongs to one of four steps (My CV → Find jobs → Apply → Track) or to "More".
 * Moving forward through the steps slides the page in from the right, moving back slides it
 * from the left, so the order of things is something you feel, not just read.
 */
type T = (en: string, es: string) => string;

const EXTRA: Record<string, (t: T) => { title: string; sub: string }> = {
  '/answers': (t) => ({ title: t('Answer bank', 'Respuestas'), sub: t('The questions every form asks — write each once', 'Las preguntas que hace todo formulario — escribí cada una una vez') }),
  '/contacts': (t) => ({ title: t('Network', 'Contactos'), sub: t('People, and when to come back to them', 'Gente, y cuándo volver a escribirles') }),
  '/inbox': (t) => ({ title: t('Inbox sync', 'Correo'), sub: t('Recruiter emails in English and Spanish, proposed not applied', 'Mails de reclutadores en inglés y español, propuestos no aplicados') }),
  '/ai': (t) => ({ title: t('AI keys', 'Claves de IA'), sub: t('Several free AIs, rotated automatically — so nothing stops when one is busy', 'Varias IAs gratis, rotadas solas — así nada se frena cuando una está ocupada') }),
  '/profile': (t) => ({ title: t('Advanced CV editor', 'Editor avanzado de CV'), sub: t('Every field, track tags and Spanish versions', 'Cada campo, etiquetas por área y versiones en español') }),
};

export default function App() {
  const { store, error, reload } = useStore();
  const { pathname } = useLocation();
  const t = useT();
  const [journey, setJourney] = useState<JourneyStatus | null>(null);
  // The welcome tour runs once, the first time someone is inside the app; the "?" replays it.
  const [tour, setTour] = useState(() => { try { return localStorage.getItem(TOUR_KEY) !== '1'; } catch { return false; } });

  // The step status follows every change to your data, and every page change.
  useEffect(() => { void api.journey().then(setJourney).catch(() => {}); }, [store, pathname]);

  // Direction of travel decides which way the page slides in.
  const here = stepIndex(pathname);
  const prev = useRef(here);
  const dir = here < 0 || prev.current < 0 ? 'page-up' : here > prev.current ? 'page-fwd' : here < prev.current ? 'page-back' : 'page-up';
  useEffect(() => { prev.current = here; }, [here]);

  if (error) {
    return (
      <div className="grid min-h-full place-items-center p-10">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm">
          <p className="mb-2 font-medium text-rose-700">{t('Can’t reach the API.', 'No puedo conectar con la API.')}</p>
          <p className="text-ink-700">{t('Start both processes with', 'Arrancá los dos procesos con')} <code className="rounded bg-white px-1 text-brand-700">npm run dev</code>.</p>
          <pre className="mt-3 overflow-x-auto text-xs text-ink-500">{error}</pre>
        </div>
      </div>
    );
  }

  if (store && pathname === '/') {
    return (
      <div className="min-h-full px-6 py-10 md:py-16">
        <Landing store={store} />
      </div>
    );
  }

  if (!store) {
    return (
      <div className="flex min-h-full">
        <div className="w-64 bg-forest-950" />
        <div className="flex-1 space-y-4 p-8">
          <div className="skeleton h-10 w-72 rounded-lg" />
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const states = stepStates(store, journey, t);
  const step = here >= 0 ? STEPS[here] : null;
  const extra = EXTRA[pathname]?.(t);

  return (
    <div className="flex min-h-full">
      <ToastHost />
      {tour && <Tour onClose={() => setTour(false)} />}
      <Journey states={states} />

      <div className="min-w-0 flex-1">
        <MobileBar states={states} />
        <PageHeader
          eyebrow={step ? t(`Step ${step.n} of 4`, `Paso ${step.n} de 4`) : t('More', 'Más')}
          title={pathname === '/story' ? t('Your story', 'Tu historia') : step ? step.title(t) : extra?.title ?? ''}
          sub={pathname === '/story' ? t('A chat, not a form. What you tell it makes every letter sound like you.', 'Una charla, no un formulario. Lo que cuentes hace que cada carta suene a vos.') : step ? step.blurb(t) : extra?.sub ?? ''}
          stepKey={pathname}
          onTour={() => setTour(true)}
        />

        <main key={pathname} className={`${dir} px-6 pb-16 pt-2 md:px-10`}>
          <Routes>
            <Route path="/cv" element={<Start store={store} reload={reload} />} />
            <Route path="/start" element={<Navigate to="/cv" replace />} />
            <Route path="/jobs" element={<Jobs store={store} reload={reload} />} />
            <Route path="/apply" element={<Apply store={store} reload={reload} tab="write" />} />
            <Route path="/dashboard" element={<Navigate to="/apply" replace />} />
            <Route path="/documents" element={<Apply store={store} reload={reload} tab="docs" />} />
            <Route path="/track" element={<Track store={store} reload={reload} />} />
            <Route path="/pipeline" element={<Navigate to="/track" replace />} />
            <Route path="/contacts" element={<Contacts store={store} reload={reload} />} />
            <Route path="/profile" element={<ProfilePage store={store} reload={reload} />} />
            <Route path="/answers" element={<Answers store={store} reload={reload} />} />
            <Route path="/inbox" element={<Inbox store={store} reload={reload} />} />
            <Route path="/ai" element={<AiKeys />} />
            <Route path="/story" element={<StoryPage store={store} reload={reload} />} />
            <Route path="*" element={<Navigate to="/cv" replace />} />
          </Routes>

          {here >= 0 && here < STEPS.length - 1 && states[here]?.done && (
            <NextStep to={STEPS[here + 1].to} label={STEPS[here + 1].label(t)} n={here + 2}
                      body={[
                        t('Your CV is ready. Now find the jobs to aim it at.', 'Tu CV está listo. Ahora buscá avisos a los que apuntarlo.'),
                        t('You have saved jobs. Write a CV and letter for each.', 'Tenés avisos guardados. Escribí un CV y una carta para cada uno.'),
                        t('Documents written. Send them, then track every application.', 'Documentos listos. Envialos, y seguí cada postulación.'),
                      ][here]} />
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * The title of every page: which step you are on, in big type, over a path that draws
 * itself each time you arrive — the same line as the logo.
 */
function PageHeader({ eyebrow, title, sub, stepKey, onTour }: { eyebrow: string; title: string; sub: string; stepKey: string; onTour: () => void }) {
  const lang = useUILang();
  const t = useT();
  return (
    <header className="no-print relative overflow-hidden px-6 pb-6 pt-8 md:px-10 md:pt-10">
      <svg key={stepKey} aria-hidden viewBox="0 0 600 120" preserveAspectRatio="none"
           className="pointer-events-none absolute -right-10 top-2 hidden h-28 w-[46%] opacity-60 md:block">
        <path d="M0 100 C 140 100, 160 40, 300 40 S 470 0, 600 8" fill="none" stroke="var(--color-brand-200)" strokeWidth="2" strokeLinecap="round"
              className="path-draw" style={{ ['--len' as string]: 700 }} />
        <circle cx="600" cy="8" r="5" fill="var(--color-lime-400)" />
      </svg>
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div key={stepKey} className="page-up min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600">{eyebrow}</p>
          <h1 className="mt-1.5 text-3xl font-semibold text-forest-900 md:text-[2.6rem] md:leading-[1.1]">{title}</h1>
          {sub && <p className="mt-2 max-w-2xl text-[15px] text-ink-500">{sub}</p>}
        </div>
        <div className="flex items-center gap-2">
        <button onClick={onTour} title={t('Show me around', 'Mostrame todo')}
                className="grid h-8 w-8 place-items-center rounded-full border border-line bg-surface text-sm font-semibold text-ink-500 shadow-sm transition hover:border-brand-300 hover:text-brand-700">?</button>
        <div className="flex overflow-hidden rounded-full border border-line bg-surface text-xs shadow-sm">
          {(['en', 'es'] as const).map((l) => (
            <button key={l} onClick={() => setUILang(l)}
                    className={`px-3 py-1.5 font-semibold transition ${lang === l ? 'bg-forest-900 text-lime-300' : 'text-ink-500 hover:bg-sunken'}`}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        </div>
      </div>
    </header>
  );
}

/** "You are done here — this is what comes next", once per finished step, at the foot of the page. */
function NextStep({ to, label, n, body }: { to: string; label: string; n: number; body: string }) {
  const t = useT();
  return (
    <Link to={to} className="group mt-12 flex items-center gap-5 overflow-hidden rounded-3xl bg-forest-900 p-6 text-white shadow-xl shadow-forest-900/15 transition hover:-translate-y-0.5 hover:shadow-2xl">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-lime-400 font-display text-2xl font-semibold text-forest-950 transition group-hover:scale-105">{n}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-300/80">{t('Next step', 'Siguiente paso')}</span>
        <span className="mt-0.5 block font-display text-2xl font-semibold">{label}</span>
        <span className="mt-0.5 block text-sm text-white/65">{body}</span>
      </span>
      <span className="text-3xl text-lime-400 transition group-hover:translate-x-1.5">→</span>
    </Link>
  );
}

/** On a phone the journey becomes a strip of four steps across the top. */
function MobileBar({ states }: { states: ReturnType<typeof stepStates> }) {
  const t = useT();
  const { pathname } = useLocation();
  const here = stepIndex(pathname);
  return (
    <div className="no-print sticky top-0 z-20 flex items-center gap-3 bg-forest-950 px-4 py-3 md:hidden">
      <Link to="/"><Logo size={28} /></Link>
      <nav className="flex flex-1 justify-around">
        {STEPS.map((s, i) => (
          <NavLink key={s.n} to={s.to} className="flex flex-col items-center gap-1">
            <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${
              states[i]?.done ? 'bg-lime-400 text-forest-950' : i === here ? 'bg-forest-800 text-lime-300 ring-2 ring-lime-400' : 'bg-white/10 text-white/60'}`}>
              {states[i]?.done ? '✓' : s.n}
            </span>
            <span className={`text-[10px] ${i === here ? 'text-white' : 'text-white/50'}`}>{s.label(t)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

