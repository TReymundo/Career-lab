import { Link } from 'react-router-dom';
import { Button } from '../components/ui.tsx';
import { setUILang, useT, useUILang } from '../lib/i18n.ts';
import { parseBullets, type Store } from '../lib/types.ts';

/**
 * The first thing anyone sees. One promise, three steps, one button.
 *
 * Someone arriving here has not decided to use this yet, so nothing is asked of them and
 * nothing is explained twice. Once there is real data the page changes its mind and offers
 * to carry on where they left off instead.
 */
export default function Landing({ store }: { store: Store }) {
  const t = useT();
  const lang = useUILang();

  const started = Boolean(store.profile.name.trim()) || store.experience.length > 0;
  const hasCV = store.experience.some((e) => parseBullets(e.bullets).length > 0);
  const hasJobs = store.application.length > 0;

  const STEPS = [
    {
      n: '1',
      title: t('Build your CV', 'Armá tu CV'),
      body: t('Upload one you already have, or make one from nothing — including if you have never had a job.',
              'Subí uno que ya tengas, o armalo desde cero — incluso si nunca trabajaste.'),
      done: hasCV,
    },
    {
      n: '2',
      title: t('Let AI find the jobs', 'Que la IA encuentre los avisos'),
      body: t('It reads your CV and plans where to look: searches to run, employers to check, titles you qualify for.',
              'Lee tu CV y planifica dónde buscar: búsquedas para hacer, empresas para mirar, puestos para los que calificás.'),
      done: hasJobs,
    },
    {
      n: '3',
      title: t('Apply and keep track', 'Postulate y seguí el hilo'),
      body: t('A tailored CV and cover letter per job, exported as a real file, and a board so nothing slips.',
              'Un CV y una carta a medida por aviso, exportados como archivo, y un tablero para que no se te escape nada.'),
      done: store.application.some((a) => a.status !== 'saved'),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex justify-end">
        <div className="flex overflow-hidden rounded-lg border border-line bg-surface text-xs">
          {(['en', 'es'] as const).map((l) => (
            <button key={l} onClick={() => setUILang(l)}
                    className={`px-2.5 py-1.5 font-medium transition ${lang === l ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-sunken'}`}>
              {l === 'en' ? 'EN' : 'ES'}
            </button>
          ))}
        </div>
      </div>

      <div className="animate-rise text-center">
        <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-lg font-bold text-white shadow-lg shadow-brand-600/20">
          CL
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          {t('Your job search, in one place', 'Tu búsqueda laboral, en un solo lugar')}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-ink-700">
          {t('Build a CV, let AI work out where to look, and apply with documents written for each job. Everything stays on this computer.',
             'Armá un CV, dejá que la IA calcule dónde buscar, y postulate con documentos escritos para cada aviso. Todo queda en esta computadora.')}
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link to="/start">
            <Button variant="primary" className="px-6 py-3 text-base">
              {started ? t('Carry on where I left off', 'Seguir donde lo dejé') : t('Start — it takes 15 minutes', 'Empezar — son 15 minutos')}
            </Button>
          </Link>
          {hasCV && (
            <Link to="/jobs">
              <Button className="px-5 py-3 text-base">{t('Go straight to jobs', 'Ir directo a los avisos')}</Button>
            </Link>
          )}
        </div>
        <p className="mt-3 text-xs text-ink-400">
          {t('No account, no sign-up, nothing uploaded anywhere.', 'Sin cuenta, sin registro, sin subir nada a ningún lado.')}
        </p>
      </div>

      <div className="stagger mt-12 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className={`card-hover rounded-xl border bg-surface p-4 ${s.done ? 'border-brand-300' : 'border-line'}`}>
            <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${
              s.done ? 'bg-brand-500 text-white' : 'bg-sunken text-ink-500'}`}>
              {s.done ? '✓' : s.n}
            </span>
            <p className="mt-2.5 text-sm font-medium text-ink-900">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{s.body}</p>
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-xs leading-relaxed text-ink-400">
        {t('Works with no work experience, any school or none, in English or Spanish. The AI part is optional and uses your own Google key.',
           'Funciona sin experiencia laboral, con cualquier estudio o ninguno, en inglés o español. La parte de IA es opcional y usa tu propia clave de Google.')}
      </p>
    </div>
  );
}
