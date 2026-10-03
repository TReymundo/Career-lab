import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui.tsx';
import { Logo, Wordmark } from '../components/Journey.tsx';
import { setUILang, useT, useUILang } from '../lib/i18n.ts';
import { parseBullets, type Store } from '../lib/types.ts';

/**
 * The first thing anyone sees. One promise, one picture of it working, one button.
 *
 * Someone arriving here has not decided to use this yet, so nothing is asked of them. Once
 * there is real data the page changes its mind and offers to carry on where they left off.
 */
export default function Landing({ store }: { store: Store }) {
  const t = useT();
  const lang = useUILang();

  const started = Boolean(store.profile.name.trim()) || store.experience.length > 0;
  const hasCV = store.experience.some((e) => parseBullets(e.bullets).length > 0);
  const hasJobs = store.application.length > 0;

  const STEPS = [
    {
      n: '1', done: hasCV,
      title: t('Your CV, done right', 'Tu CV, bien hecho'),
      body: t('Upload the one you have, or answer a few questions and build it — no experience needed. Checked against what recruiters actually look at.',
              'Subí el que tenés, o respondé unas preguntas y armalo — sin experiencia también. Revisado contra lo que de verdad miran los reclutadores.'),
    },
    {
      n: '2', done: hasJobs,
      title: t('Jobs that fit it', 'Avisos que le calzan'),
      body: t('Pull real openings from open job boards and see which ones match what your CV can prove.',
              'Traé avisos reales de bolsas abiertas y mirá cuáles coinciden con lo que tu CV puede demostrar.'),
    },
    {
      n: '3', done: store.application.some((a) => a.status !== 'saved'),
      title: t('Apply and keep track', 'Postulate y seguí el hilo'),
      body: t('A tailored CV and cover letter per job, as real PDF or Word files, and a board so nothing slips.',
              'Un CV y una carta a medida por aviso, en PDF o Word, y un tablero para que no se te escape nada.'),
    },
  ];

  return (
    <div className="relative overflow-x-clip">
      {/* Soft colour drifting behind the hero. Decorative only. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 -z-0 h-[520px] overflow-hidden">
        <div className="hero-blob absolute -left-20 top-0 h-80 w-80 rounded-full bg-brand-200/50 blur-3xl" />
        <div className="hero-blob absolute right-0 top-24 h-72 w-72 rounded-full bg-brand-100/80 blur-3xl" style={{ animationDelay: '-7s' }} />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <div className="mb-10 flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <Logo />
            <Wordmark light={false} />
          </span>
          <div className="flex overflow-hidden rounded-lg border border-line bg-surface text-xs">
            {(['en', 'es'] as const).map((l) => (
              <button key={l} onClick={() => setUILang(l)}
                      className={`px-2.5 py-1.5 font-medium transition ${lang === l ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-sunken'}`}>
                {l === 'en' ? 'EN' : 'ES'}
              </button>
            ))}
          </div>
        </div>

        <section className="grid items-center gap-12 md:grid-cols-[1.05fr_1fr]">
          <div className="animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-surface/80 px-3 py-1 text-xs font-medium text-brand-700">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              {t('Free · private · English & Spanish', 'Gratis · privado · español e inglés')}
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-ink-900 sm:text-5xl">
              {t('Your CV, done right.', 'Tu CV, bien hecho.')}
              <br />
              <span className="italic text-brand-600">{t('Then the jobs that fit it.', 'Después, los avisos que le calzan.')}</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-700">
              {t('Upload the CV you have, or build one by answering a few simple questions. Career Lab checks it against what recruiters actually look for, then helps you find jobs to aim it at.',
                 'Subí el CV que tenés, o armalo respondiendo unas preguntas simples. Career Lab lo revisa contra lo que de verdad buscan los reclutadores, y después te ayuda a encontrar avisos a los que apuntarlo.')}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/cv">
                <Button variant="primary" className="group px-7 py-3.5 text-base">
                  {started ? t('Carry on where I left off', 'Seguir donde lo dejé') : t('Start my CV', 'Empezar mi CV')}
                  <span className="ml-2 inline-block transition group-hover:translate-x-0.5">→</span>
                </Button>
              </Link>
              {hasCV && (
                <Link to="/jobs"><Button className="px-5 py-3.5 text-base">{t('Go to jobs', 'Ir a los avisos')}</Button></Link>
              )}
            </div>
            <p className="mt-4 text-xs text-ink-400">
              {t('No account, no sign-up. Everything stays on this computer.', 'Sin cuenta, sin registro. Todo queda en esta computadora.')}
            </p>
          </div>

          <HeroAnimation />
        </section>

        <section className="stagger mt-20 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className={`card-hover rounded-2xl border bg-surface p-5 ${s.done ? 'border-brand-300' : 'border-line'}`}>
              <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-semibold ${
                s.done ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700'}`}>
                {s.done ? '✓' : s.n}
              </span>
              <p className="mt-3 text-sm font-semibold text-ink-900">{s.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">{s.body}</p>
            </div>
          ))}
        </section>

        <p className="mt-12 pb-4 text-center text-xs leading-relaxed text-ink-400">
          {t('Works with no work experience and any education. The AI parts are optional and use your own free Google key.',
             'Funciona sin experiencia laboral y con cualquier formación. Las partes con IA son opcionales y usan tu propia clave gratis de Google.')}
        </p>
      </div>
    </div>
  );
}

const d = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

/**
 * The product in one picture, on a loop: a CV writes itself line by line, a number lands in a
 * bullet, the checks tick, and matching jobs slide in. Pure CSS — see the hero-* keyframes.
 */
function HeroAnimation() {
  const t = useT();
  const jobs = [
    { title: t('Sales Assistant', 'Vendedor/a'), co: 'Retail Co.', match: 92 },
    { title: t('Junior Analyst', 'Analista Jr.'), co: 'Fintech SA', match: 86 },
    { title: t('Customer Support', 'Atención al cliente'), co: 'Tienda Online', match: 81 },
  ];
  const line = (w: string, delay: number, cls = 'bg-line-strong') => (
    <div className={`hero-line h-1.5 rounded-full ${cls}`} style={{ width: w, ...d(delay) }} />
  );

  return (
    <div aria-hidden className="relative mx-auto h-[400px] w-full max-w-[440px] select-none">
      {/* The page */}
      <div className="hero-sheet absolute left-0 top-6 w-[250px] rounded-xl bg-white p-5 shadow-[0_30px_60px_-25px_rgb(16_35_26/.45)] ring-1 ring-line sm:w-[270px]">
        <div className="hero-line h-3 w-32 rounded bg-ink-900" style={d(0)} />
        <div className="mt-2 hero-line h-2 w-36 rounded bg-brand-400" style={d(0.15)} />
        <div className="mt-2">{line('80%', 0.3)}</div>

        <div className="mt-5 hero-line h-1.5 w-16 rounded bg-ink-700" style={d(0.45)} />
        <div className="mt-1.5 h-px bg-line" />
        <div className="mt-3 space-y-2.5">
          <div className="hero-line h-2 w-28 rounded bg-ink-500" style={d(0.55)} />
          <div className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-ink-400" />{line('62%', 0.7)}</div>
          <div className="relative flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-ink-400" />{line('48%', 0.85)}
            <span className="hero-pop absolute right-0 rounded-md bg-brand-500 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow" style={d(0)}>
              ~80 / {t('day', 'día')}
            </span>
          </div>
          <div className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-ink-400" />{line('70%', 1)}</div>
        </div>

        <div className="mt-5 hero-line h-1.5 w-14 rounded bg-ink-700" style={d(1.1)} />
        <div className="mt-1.5 h-px bg-line" />
        <div className="mt-3 space-y-2">
          <div className="hero-line h-2 w-24 rounded bg-ink-500" style={d(1.2)} />
          {line('55%', 1.3)}
        </div>

        <span className="hero-pop absolute -bottom-3 left-5 rounded-full bg-ink-900 px-2.5 py-1 text-[10px] font-medium text-white shadow-lg" style={d(0.6)}>
          ✓ {t('Recruiter-ready', 'Listo para reclutadores')}
        </span>
      </div>

      {/* The checks */}
      <div className="absolute right-2 top-0 w-[150px] rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        {[t('Contact', 'Contacto'), t('Dates', 'Fechas'), t('Numbers', 'Números')].map((label, i) => (
          <div key={label} className="flex items-center gap-2 py-0.5 text-[11px] text-ink-700">
            <span className="hero-pop grid h-4 w-4 place-items-center rounded-full bg-brand-500 text-[8px] text-white" style={d(0.25 + i * 0.25)}>✓</span>
            {label}
          </div>
        ))}
      </div>

      {/* The jobs */}
      <div className="absolute bottom-0 right-0 w-[220px] space-y-2">
        {jobs.map((j, i) => (
          <div key={j.title} className="hero-card flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-md" style={d(i * 0.3)}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-semibold text-brand-700">{j.co[0]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-ink-900">{j.title}</span>
              <span className="block truncate text-[10px] text-ink-400">{j.co}</span>
            </span>
            <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-brand-700">{j.match}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
