import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, Badge, Button, Card, Field, Select } from '../components/ui.tsx';
import { api, type BulletSuggestion, type FieldEdit, type FieldItem } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { buildCV } from '../lib/templates.ts';
import { TRACKS, parseBullets, type Experience, type ParsedCV, type Store, type Track } from '../lib/types.ts';
import JobFinder from '../components/JobFinder.tsx';

/**
 * One path, top to bottom. Each step does its own work inline and ticks itself off when you
 * save, so the next move is never a guess. Nothing here assumes a particular university,
 * country, or that you have any work experience at all.
 */

interface Ctx {
  store: Store;
  reload: () => Promise<void>;
  done: (id: string) => void;
  next: () => void;
  t: (en: string, es: string) => string;
  lang: 'en' | 'es';
}

interface Step {
  id: string;
  title: (t: Ctx['t']) => string;
  help: (t: Ctx['t']) => string;
  optional?: boolean;
  auto?: (s: Store) => boolean;
  render: (ctx: Ctx) => React.ReactNode;
}

interface Phase {
  id: string;
  title: (t: Ctx['t']) => string;
  blurb: (t: Ctx['t']) => string;
  steps: Step[];
  /** Shown when every step in the phase is done: what you just earned, and where to go next. */
  done?: (t: Ctx['t']) => { headline: string; body: string; cta?: string; to?: string };
}

const hasDigit = (s: string) => /\d/.test(s);
const allBullets = (s: Store) => s.experience.flatMap((e) => parseBullets(e.bullets));
const firstTrack = (s: Store): Track => {
  try { return (JSON.parse(s.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other'; }
};

const PHASES: Phase[] = [
  {
    id: 'you',
    title: (t) => t('Who you are', 'Quién sos'),
    blurb: (t) => t('Two minutes. Everything else builds on this.', 'Dos minutos. Todo lo demás se construye sobre esto.'),
    done: (t) => ({
      headline: t('That’s you on file.', 'Listo, ya sos alguien en el sistema.'),
      body: t('Every document from here on carries these details. Next: your CV.',
              'Todos los documentos de acá en adelante llevan estos datos. Ahora: tu CV.'),
    }),
    steps: [
      {
        id: 'basics',
        title: (t) => t('Your name and contact details', 'Tu nombre y datos de contacto'),
        help: (t) => t(
          'These go at the top of every document. A CV without a phone number gets filtered out before a human sees it.',
          'Esto va arriba de todo en cada documento. Un CV sin teléfono se descarta antes de que lo vea una persona.'),
        auto: (s) => Boolean(s.profile.name.trim() && s.profile.email.trim()),
        render: (ctx) => <Basics {...ctx} />,
      },
      {
        id: 'target',
        title: (t) => t('What kind of work are you going for?', '¿Qué tipo de trabajo buscás?'),
        help: (t) => t(
          'Pick anything that fits — more than one is fine, and you can change it later. This decides how your CV gets framed.',
          'Elegí lo que te sirva — podés marcar más de uno y cambiarlo después. Esto define cómo se enfoca tu CV.'),
        auto: (s) => Boolean(s.setting['tracks']),
        render: (ctx) => <Target {...ctx} />,
      },
    ],
  },
  {
    id: 'cv',
    title: (t) => t('Build your CV', 'Armá tu CV'),
    blurb: (t) => t('Import one you already have, or make one from nothing. Both work.',
                    'Importá uno que ya tengas, o armalo desde cero. Las dos cosas funcionan.'),
    done: (t) => ({
      headline: t('Your CV exists.', 'Tu CV ya existe.'),
      body: t('You can open it, edit it and export it as a real file any time. Sharpening it with AI is next, and it is optional.',
              'Podés abrirlo, editarlo y exportarlo como archivo cuando quieras. Lo próximo es afinarlo con IA, y es opcional.'),
      cta: t('Open my CV', 'Abrir mi CV'),
      to: '/profile',
    }),
    steps: [
      {
        id: 'source',
        title: (t) => t('Do you already have a CV?', '¿Ya tenés un CV?'),
        help: (t) => t(
          'If you do, upload it and it fills everything in. If you do not, say so and the next steps build one.',
          'Si tenés, subilo y se completa solo. Si no, decilo y los pasos siguientes lo arman.'),
        auto: (s) => s.experience.length > 0 || s.setting['step:source'] === 'done',
        render: (ctx) => <CVSource {...ctx} />,
      },
      {
        id: 'education',
        title: (t) => t('Your education', 'Tu formación'),
        help: (t) => t(
          'University, tertiary, high school, a bootcamp, or still studying — all of it counts and belongs here.',
          'Universidad, terciario, secundario, un bootcamp, o si todavía estás cursando — todo cuenta y va acá.'),
        auto: (s) => s.experience.some((e) => e.kind === 'education' && e.org.trim()),
        render: (ctx) => <EducationStep {...ctx} />,
      },
      {
        id: 'experience',
        title: (t) => t('Your experience', 'Tu experiencia'),
        help: (t) => t(
          'Jobs and internships if you have them. If you have none at all, this step shows what else counts and helps you write it.',
          'Trabajos y pasantías si tenés. Si no tenés nada, este paso te muestra qué más cuenta y te ayuda a escribirlo.'),
        auto: (s) => s.experience.some((e) => e.kind !== 'education' && parseBullets(e.bullets).length > 0),
        render: (ctx) => <ExperienceStep {...ctx} />,
      },
      {
        id: 'extras',
        title: (t) => t('The things recruiters look for and rarely find', 'Lo que los reclutadores buscan y casi nunca encuentran'),
        help: (t) => t(
          'Skills, grades, coursework, projects, activities, LinkedIn. Each one is a box below — fill what is true and leave the rest.',
          'Habilidades, notas, materias, proyectos, actividades, LinkedIn. Cada una es un campo acá abajo — completá lo que sea cierto y dejá el resto.'),
        auto: (s) => Boolean(s.profile.skills.trim()) && s.setting['step:extras'] === 'done',
        render: (ctx) => <ExtrasStep {...ctx} />,
      },
      {
        id: 'numbers',
        title: (t) => t('Put a number in each line', 'Poné un número en cada línea'),
        help: (t) => t(
          'The single biggest improvement you can make. "Helped with events" is invisible; "ran 4 events for 300 people" is a fact.',
          'La mejora más grande que podés hacer. "Ayudé con eventos" es invisible; "organicé 4 eventos para 300 personas" es un hecho.'),
        auto: (s) => {
          const bs = allBullets(s);
          return bs.length >= 2 && bs.filter((b) => hasDigit(b.text)).length / bs.length >= 0.6;
        },
        render: (ctx) => <NumbersStep {...ctx} />,
      },
    ],
  },
  {
    id: 'ai',
    title: (t) => t('Sharpen it with AI', 'Afinalo con IA'),
    blurb: (t) => t('Optional, and it needs your own Google API key. Skip the phase if you would rather not.',
                    'Opcional, y necesita tu propia clave de Google. Saltealo si preferís.'),
    done: (t) => ({
      headline: t('Sharpened.', 'Afinado.'),
      body: t('Now the part that actually takes time: finding jobs worth applying to. The AI can plan that too.',
              'Ahora la parte que de verdad lleva tiempo: encontrar avisos que valgan la pena. La IA también puede planificar eso.'),
    }),
    steps: [
      {
        id: 'key',
        title: (t) => t('Connect your Google AI key', 'Conectá tu clave de Google AI'),
        help: (t) => t(
          'Free to create. Paste it here and the next steps light up. Nothing is sent anywhere until you press a button.',
          'Se crea gratis. Pegala acá y se habilitan los pasos siguientes. No se envía nada hasta que apretás un botón.'),
        optional: true,
        render: (ctx) => <AIKey {...ctx} />,
      },
      {
        id: 'rewrite',
        title: (t) => t('Rewrite your bullets', 'Reescribí tus líneas'),
        help: (t) => t(
          'The AI sharpens what you wrote. It may not invent numbers — where one is missing it asks you for it instead.',
          'La IA afina lo que escribiste. No puede inventar números: donde falta uno, te lo pregunta.'),
        optional: true,
        render: (ctx) => <AIBullets {...ctx} />,
      },
      {
        id: 'profile-para',
        title: (t) => t('Profile paragraph, review, and a final clean-up', 'Perfil, revisión y limpieza final'),
        help: (t) => t(
          'A paragraph for the top of the CV, an honest review, then a pass that fixes typos and weak wording — each change shown before it is applied.',
          'Un párrafo para el encabezado, una revisión honesta, y una pasada que corrige errores de tipeo y frases flojas — cada cambio se muestra antes de aplicarse.'),
        optional: true,
        render: (ctx) => <AIReview {...ctx} />,
      },
    ],
  },
  {
    id: 'jobs',
    title: (t) => t('Find jobs', 'Buscá avisos'),
    blurb: (t) => t('Get openings into the app so you can search and rank them.',
                    'Traé las búsquedas a la app para poder filtrarlas y ordenarlas.'),
    done: (t) => ({
      headline: t('You have jobs to work with.', 'Ya tenés avisos con qué trabajar.'),
      body: t('Search and rank them, then tick the good ones and generate a tailored set of documents for each.',
              'Filtralos y ordenalos, después marcá los buenos y generá documentos a medida para cada uno.'),
      cta: t('Go to Jobs', 'Ir a Avisos'),
      to: '/jobs',
    }),
    steps: [
      {
        id: 'linkedin',
        title: (t) => t('Open LinkedIn and collect some jobs', 'Abrí LinkedIn y juntá avisos'),
        help: (t) => t('Search, save what looks right, then bring them in. The buttons below do both halves.',
                       'Buscá, guardá lo que te sirva, y después traelos. Los botones de abajo hacen las dos mitades.'),
        auto: (s) => s.setting['step:linkedin'] === 'done' || false,
        render: (ctx) => <JobsStep {...ctx} />,
      },
    ],
  },
  {
    id: 'apply',
    title: (t) => t('Apply', 'Postulate'),
    blurb: (t) => t('Turn a job into a tailored set of documents you can actually send.',
                    'Convertí un aviso en documentos hechos a medida que podés mandar.'),
    done: (t) => ({
      headline: t('Documents done.', 'Documentos listos.'),
      body: t('Everything you generate is saved and exportable. What is left is keeping track of what you sent.',
              'Todo lo que generás queda guardado y exportable. Lo que falta es seguir la pista de lo que mandaste.'),
      cta: t('Open Documents', 'Abrir Documentos'),
      to: '/documents',
    }),
    steps: [
      {
        id: 'generate',
        title: (t) => t('Generate documents for a job', 'Generá los documentos para un aviso'),
        help: (t) => t(
          'Tick a job, press generate. You get a CV, a cover letter, a message to send someone, and interview prep for that posting.',
          'Marcá un aviso y generá. Salen un CV, una carta, un mensaje para mandarle a alguien, y preparación de entrevista para ese puesto.'),
        auto: (s) => s.document.length > 0,
        render: (ctx) => (
          <Steps to="/jobs" cta={ctx.t('Go to Jobs', 'Ir a Avisos')} points={[
            ctx.t('Tick a job in the list, choose your language, press Generate CV.',
                  'Marcá un aviso, elegí el idioma, apretá Generar CV.'),
            ctx.t('In the generator, press "Generate full pack" to write everything at once.',
                  'En el generador, apretá "Generar todo" para escribir todo junto.'),
            ctx.t('Then Download DOCX for application forms, or PDF to email.',
                  'Después descargá DOCX para formularios, o PDF para mandar por mail.'),
          ]} />
        ),
      },
      {
        id: 'answers',
        title: (t) => t('Write the answers forms keep asking for', 'Escribí las respuestas que todos los formularios piden'),
        help: (t) => t('Why this firm, a leadership story, a failure story. Write each once and reuse it for months.',
                       'Por qué esta empresa, una historia de liderazgo, una de fracaso. Escribilas una vez y reusalas meses.'),
        optional: true,
        auto: (s) => s.answer.filter((a) => !a.company && a.body.trim()).length >= 3,
        render: (ctx) => (
          <Steps to="/answers" cta={ctx.t('Open Answer bank', 'Abrir Respuestas')} points={[
            ctx.t('Start with the first three. Each has a word limit and a note on what a good answer does.',
                  'Empezá por las primeras tres. Cada una tiene límite de palabras y una nota sobre qué hace una buena respuesta.'),
          ]} />
        ),
      },
    ],
  },
  {
    id: 'track',
    title: (t) => t('Keep track', 'Seguí el hilo'),
    blurb: (t) => t('So nothing slips while you are busy.', 'Para que no se te escape nada mientras estás ocupado.'),
    done: (t) => ({
      headline: t('Setup is finished.', 'La configuración terminó.'),
      body: t('From here it is the work itself: search, generate, send, follow up. The board is where you live now.',
              'De acá en más es el trabajo en sí: buscar, generar, enviar, hacer seguimiento. El tablero es tu lugar ahora.'),
      cta: t('Open the board', 'Abrir el tablero'),
      to: '/pipeline',
    }),
    steps: [
      {
        id: 'pipeline',
        title: (t) => t('Move things across the board', 'Movelo por el tablero'),
        help: (t) => t('Every job you generate for lands on the board. Drag it as it moves; the dates and the log look after themselves.',
                       'Cada aviso para el que generás aparece en el tablero. Arrastralo a medida que avanza; las fechas y el historial se cuidan solos.'),
        auto: (s) => s.application.some((a) => a.status !== 'saved'),
        render: (ctx) => (
          <Steps to="/pipeline" cta={ctx.t('Open Pipeline', 'Abrir Tablero')} points={[
            ctx.t('Saved → Tailored → Applied → Interviewing → Offer or Rejected.',
                  'Guardado → Adaptado → Postulado → Entrevistas → Oferta o Rechazo.'),
            ctx.t('Give anything live a next action with a date.', 'Dale a cada proceso activo una próxima acción con fecha.'),
          ]} />
        ),
      },
      {
        id: 'backup',
        title: (t) => t('Back it up', 'Hacé una copia'),
        help: (t) => t('It all lives in one file on this laptop. Download a copy and put it somewhere else.',
                       'Todo vive en un archivo en esta computadora. Bajate una copia y guardala en otro lado.'),
        auto: (s) => s.setting['step:backup'] === 'done',
        render: (ctx) => <BackupStep {...ctx} />,
      },
    ],
  },
];

const ALL_STEPS = PHASES.flatMap((p) => p.steps);

export default function Start({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const t = useT();
  const lang = useUILang();

  const isDone = (s: Step) => store.setting[`step:${s.id}`] === 'done' || Boolean(s.auto?.(store));
  const state = useMemo(() => ALL_STEPS.map((s) => ({ step: s, done: isDone(s) })), [store]);

  const firstOpen = state.find((s) => !s.done)?.step.id ?? null;
  const active = openId ?? firstOpen;
  const doneCount = state.filter((s) => s.done).length;

  const done = (id: string) => { void api.setSetting(`step:${id}`, 'done').then(reload); };
  const next = () => {
    const i = ALL_STEPS.findIndex((s) => s.id === active);
    setOpenId(ALL_STEPS[i + 1]?.id ?? null);
  };
  const ctx = { store, reload, done, next, t, lang };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums text-ink-900">
              {doneCount}<span className="text-ink-400">/{ALL_STEPS.length}</span>
            </p>
            <p className="text-sm text-ink-500">
              {t('Work down the list. Each step saves, ticks itself off, and opens the next one.',
                 'Bajá por la lista. Cada paso se guarda, se tacha solo, y abre el siguiente.')}
            </p>
          </div>
          {doneCount === ALL_STEPS.length && <Badge tone="emerald">{t('All done — the rest is applying', 'Listo — lo que queda es postularse')}</Badge>}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${(doneCount / ALL_STEPS.length) * 100}%` }} />
        </div>
      </Card>

      {PHASES.map((phase, pi) => {
        const steps = state.filter((s) => phase.steps.some((p) => p.id === s.step.id));
        const phaseDone = steps.every((s) => s.done);
        return (
          <section key={phase.id}>
            <div className="mb-2 flex flex-wrap items-baseline gap-3">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                phaseDone ? 'bg-brand-500 text-white' : 'bg-sunken text-ink-500'}`}>
                {phaseDone ? '✓' : pi + 1}
              </span>
              <h2 className={`text-sm font-semibold uppercase tracking-wider ${phaseDone ? 'text-ink-400' : 'text-ink-900'}`}>
                {phase.title(t)}
              </h2>
              <p className="text-xs text-ink-500">{phase.blurb(t)}</p>
            </div>

            <div className="ml-3 space-y-2 border-l border-line pl-5">
              {steps.map(({ step, done: stepDone }) => {
                const isOpen = active === step.id;
                return (
                  <Card key={step.id} className={`overflow-hidden transition ${isOpen ? 'border-brand-300 shadow-[0_8px_24px_-18px_rgb(16_35_26/.5)]' : ''}`}>
                    <button onClick={() => setOpenId(isOpen ? '' : step.id)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-50">
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] transition ${
                        stepDone ? 'bg-brand-500 text-white' : 'border border-line-strong bg-surface text-ink-400'}`}>
                        {stepDone ? '✓' : ''}
                      </span>
                      <span className={`min-w-0 flex-1 text-sm font-medium transition ${
                        stepDone ? 'text-ink-400 line-through decoration-brand-400' : 'text-ink-900'}`}>
                        {step.title(t)}
                      </span>
                      {step.optional && <Badge tone="slate">{t('optional', 'opcional')}</Badge>}
                      <span className="text-ink-400">{isOpen ? '▾' : '▸'}</span>
                    </button>

                    {isOpen && (
                      <div className="animate-fade space-y-4 border-t border-line px-4 py-4">
                        <p className="text-sm leading-relaxed text-ink-700">{step.help(t)}</p>
                        {step.render(ctx)}
                        {!stepDone && (
                          <button onClick={() => { done(step.id); next(); }} className="text-xs text-ink-400 underline hover:text-ink-700">
                            {t('Skip this step', 'Saltear este paso')}
                          </button>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
              {phaseDone && phase.done && <PhaseDone {...phase.done(t)} />}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The "great, that's done — here is what it bought you" moment at the end of each phase. */
function PhaseDone({ headline, body, cta, to }: { headline: string; body: string; cta?: string; to?: string }) {
  return (
    <div className="animate-rise mt-1 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-500 text-sm text-white">✓</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-brand-900">{headline}</p>
        <p className="text-xs text-ink-700">{body}</p>
      </div>
      {cta && to && <Link to={to}><Button variant="primary">{cta}</Button></Link>}
    </div>
  );
}

function SaveBar({ label, disabled, onSave, extra }: {
  label: string; disabled?: boolean; onSave: () => Promise<void> | void; extra?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button variant="primary" disabled={disabled || busy} onClick={async () => { setBusy(true); await onSave(); setBusy(false); }}>
        {busy ? t('Saving…', 'Guardando…') : label}
      </Button>
      {extra}
    </div>
  );
}

function Steps({ points, to, cta }: { points: string[]; to?: string; cta?: string }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5 text-sm text-ink-700">
        {points.map((p, i) => <li key={i} className="flex gap-2"><span className="text-brand-500">→</span><span>{p}</span></li>)}
      </ul>
      {to && <Link to={to}><Button variant="primary">{cta}</Button></Link>}
    </div>
  );
}

function Basics({ store, reload, done, next, t }: Ctx) {
  const [d, setD] = useState(store.profile);
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('Full name', 'Nombre completo')} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('Your name', 'Tu nombre')} />
        <Field label={t('Email', 'Email')} value={d.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@email.com" />
        <Field label={t('Phone', 'Teléfono')} value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+54 …" />
        <Field label={t('City, country', 'Ciudad, país')} value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder={t('City, Country', 'Ciudad, País')} />
        <Field label={t('LinkedIn (optional)', 'LinkedIn (opcional)')} value={d.linkedin} onChange={(e) => set({ linkedin: e.target.value })} placeholder="linkedin.com/in/…" />
        <Field label={t('One line about you', 'Una línea sobre vos')} value={d.headline} onChange={(e) => set({ headline: e.target.value })}
               placeholder={t('Final-year business student', 'Estudiante de último año de negocios')} />
      </div>
      <SaveBar
        label={t('Save and continue', 'Guardar y continuar')}
        disabled={!d.name.trim() || !d.email.trim()}
        onSave={async () => {
          await api.saveProfile(d as unknown as Record<string, string>);
          await reload();
          done('basics');
          next();
        }}
      />
    </div>
  );
}

function Target({ store, reload, done, next, t }: Ctx) {
  const [picked, setPicked] = useState<Track[]>(() => {
    try { return JSON.parse(store.setting['tracks'] || '[]'); } catch { return []; }
  });
  const lang = useUILang();
  const LABELS: Record<Track, string> = {
    finance: t('Finance, markets & banking', 'Finanzas, mercados y banca'),
    ib: t('Investment banking / M&A', 'Banca de inversión / M&A'),
    consulting: t('Consulting & strategy', 'Consultoría y estrategia'),
    data: t('Data & analytics', 'Datos y analítica'),
    tech: t('Software & engineering', 'Software e ingeniería'),
    product: t('Product, marketing & operations', 'Producto, marketing y operaciones'),
    other: t('Other', 'Otro'),
  };
  void lang;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TRACKS.map((tr) => (
          <button key={tr.id} onClick={() => setPicked((p) => (p.includes(tr.id) ? p.filter((x) => x !== tr.id) : [...p, tr.id]))}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    picked.includes(tr.id) ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-700 hover:bg-sunken'}`}>
            {LABELS[tr.id]}
          </button>
        ))}
      </div>
      <SaveBar label={t('Save and continue', 'Guardar y continuar')} disabled={!picked.length} onSave={async () => {
        await api.setSetting('tracks', JSON.stringify(picked));
        await reload();
        done('target');
        next();
      }} />
    </div>
  );
}

function CVSource({ reload, done, next, t }: Ctx) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedCV | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (payload: { text?: string; base64?: string; filename?: string }) => {
    setBusy(true); setMsg('');
    try { setParsed((await api.parseCV(payload)).parsed); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    await run({ base64: btoa(bin), filename: file.name });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => fileRef.current?.click()}>{t('Upload my CV', 'Subir mi CV')}</Button>
        <Button onClick={() => { done('source'); next(); }}>{t('I don’t have one — build it with me', 'No tengo — armémoslo juntos')}</Button>
      </div>
      <input ref={fileRef} type="file" accept=".docx,.txt,.md" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      <p className="text-xs text-ink-500">
        {t('Word (.docx), text and Markdown are read directly. For a PDF: open it, select all, copy, and paste below.',
           'Word (.docx), texto y Markdown se leen directo. Para un PDF: abrilo, seleccioná todo, copiá y pegá abajo.')}
      </p>

      <details className="text-sm">
        <summary className="cursor-pointer text-brand-700">{t('Paste the text instead', 'Pegar el texto en su lugar')}</summary>
        <div className="mt-2 space-y-2">
          <Area rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
                placeholder={t('Paste your whole CV here.', 'Pegá todo tu CV acá.')} />
          <Button disabled={busy || !text.trim()} onClick={() => run({ text })}>
            {busy ? t('Reading…', 'Leyendo…') : t('Read it', 'Leerlo')}
          </Button>
        </div>
      </details>

      {msg && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{msg}</p>}

      {parsed && (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-medium text-ink-900">{t('Found this — check it before adding:', 'Encontré esto — revisalo antes de agregar:')}</p>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            {(['name', 'email', 'phone', 'linkedin'] as const).map((k) => (
              <div key={k} className="flex gap-2">
                <span className="w-16 shrink-0 text-xs uppercase tracking-wider text-ink-400">{k}</span>
                <span className={parsed[k] ? 'text-ink-900' : 'text-ink-400'}>{parsed[k] || '—'}</span>
              </div>
            ))}
          </div>
          {parsed.entries.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {parsed.entries.map((e, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
                  <Badge tone={e.kind === 'work' ? 'sky' : e.kind === 'education' ? 'violet' : 'amber'}>{e.kind}</Badge>
                  <span className="font-medium text-ink-900">{e.org || '—'}</span>
                  <span className="truncate text-ink-500">{e.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-ink-400">{e.bullets.length} {t('lines', 'líneas')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-700">
              {t('No entries recognised. It looks for headings like Experience / Education / Experiencia / Formación. You can skip this and type them in the next two steps instead.',
                 'No reconocí entradas. Busca títulos como Experiencia / Formación / Experience / Education. Podés saltear esto y cargarlas en los dos pasos siguientes.')}
            </p>
          )}
          <SaveBar label={t('Add these to my CV', 'Agregar esto a mi CV')} onSave={async () => {
            await api.applyCV(parsed, false);
            await reload();
            setParsed(null);
            done('source');
            next();
          }} />
        </Card>
      )}
    </div>
  );
}

function EducationStep({ store, reload, done, next, t }: Ctx) {
  const LEVELS = [
    { id: 'university', label: t('University / college', 'Universidad'), title: t('Degree in …', 'Licenciatura en …') },
    { id: 'tertiary', label: t('Tertiary / technical', 'Terciario / técnico'), title: t('Technical qualification in …', 'Tecnicatura en …') },
    { id: 'school', label: t('High school', 'Secundario'), title: t('Secondary school', 'Bachiller') },
    { id: 'bootcamp', label: t('Bootcamp / certificate', 'Bootcamp / certificado'), title: t('Certificate in …', 'Certificado en …') },
  ];
  const [level, setLevel] = useState(LEVELS[0].id);
  const [org, setOrg] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [studying, setStudying] = useState(true);

  const existing = store.experience.filter((e) => e.kind === 'education');

  return (
    <div className="space-y-3">
      {existing.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{existing.map((e) => <Badge key={e.id} tone="violet">{e.org}</Badge>)}</div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('Level', 'Nivel')} value={level} onChange={(e) => {
          setLevel(e.target.value);
          setTitle(LEVELS.find((l) => l.id === e.target.value)?.title ?? '');
        }}>
          {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </Select>
        <Field label={t('Institution name', 'Nombre de la institución')} value={org} onChange={(e) => setOrg(e.target.value)}
               placeholder={t('Your school or university', 'Tu colegio o universidad')} />
        <Field label={t('What you studied', 'Qué estudiaste')} value={title} onChange={(e) => setTitle(e.target.value)}
               placeholder={t('e.g. Business administration', 'ej. Administración de empresas')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('From', 'Desde')} value={start} onChange={(e) => setStart(e.target.value)} placeholder="2022" />
          <Field label={studying ? t('Expected finish', 'Fin estimado') : t('Finished', 'Terminado')} value={end}
                 onChange={(e) => setEnd(e.target.value)} placeholder="2026" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={studying} onChange={(e) => setStudying(e.target.checked)} className="accent-brand-600" />
        {t('I am still studying this', 'Todavía lo estoy cursando')}
      </label>

      <SaveBar
        disabled={!org.trim()}
        label={existing.length ? t('Add another', 'Agregar otro') : t('Save and continue', 'Guardar y continuar')}
        onSave={async () => {
          await api.create('experience', {
            kind: 'education', org: org.trim(), title: title.trim(), start_date: start, end_date: end,
            bullets: '[]', sort_order: store.experience.length,
          });
          setOrg(''); setStart(''); setEnd('');
          await reload();
          done('education');
        }}
        extra={<Button variant="ghost" onClick={next}>{t('Continue →', 'Continuar →')}</Button>}
      />
    </div>
  );
}

function ExperienceStep({ store, reload, done, next, t }: Ctx) {
  const EVIDENCE = [
    t('A job of any kind — retail, hospitality, delivery, admin, a shift anywhere', 'Cualquier trabajo — comercio, gastronomía, delivery, administración, un turno en cualquier lado'),
    t('A university or school project you can describe', 'Un trabajo práctico o proyecto de la facultad o del colegio'),
    t('A club, student union, society or team role', 'Un club, centro de estudiantes, sociedad o equipo'),
    t('Tutoring, teaching, coaching', 'Dar clases particulares, enseñar, entrenar'),
    t('A family business you helped run', 'Un negocio familiar en el que ayudaste'),
    t('Sport at any competitive level', 'Deporte en cualquier nivel competitivo'),
    t('Volunteering', 'Voluntariado'),
    t('Freelance work, a side project, a shop, a channel', 'Trabajo freelance, un proyecto propio, un emprendimiento, un canal'),
  ];

  const [org, setOrg] = useState('');
  const [role, setRole] = useState('');
  const [kind, setKind] = useState<Experience['kind']>('work');
  const [targetId, setTargetId] = useState<number | ''>('');
  const [verb, setVerb] = useState('');
  const [what, setWhat] = useState('');
  const [scale, setScale] = useState('');
  const [result, setResult] = useState('');

  const entries = store.experience.filter((e) => e.kind !== 'education');
  const target = store.experience.find((e) => e.id === targetId) ?? entries[0];

  const joiner = t('for', 'para');
  const bullet = [verb.trim(), what.trim(), scale.trim() && `${joiner} ${scale.trim()}`, result.trim() && `— ${result.trim()}`]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ');

  return (
    <div className="space-y-4">
      <details className="rounded-lg border border-line bg-sunken/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-ink-900">{t('I don’t have any work experience', 'No tengo experiencia laboral')}</summary>
        <p className="mt-2 text-ink-700">
          {t('Then you use one of these instead. All of them count, and all of them are normal on a first CV:',
             'Entonces usás alguna de estas. Todas cuentan, y todas son normales en un primer CV:')}
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {EVIDENCE.map((e) => <li key={e} className="text-xs text-ink-700">• {e}</li>)}
        </ul>
      </details>

      <div className="rounded-xl border border-line p-4">
        <p className="mb-3 text-sm font-medium text-ink-900">{t('1. Where did it happen?', '1. ¿Dónde pasó?')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('Place', 'Lugar')} value={org} onChange={(e) => setOrg(e.target.value)}
                 placeholder={t('Company, club, project…', 'Empresa, club, proyecto…')} />
          <Field label={t('Your role', 'Tu rol')} value={role} onChange={(e) => setRole(e.target.value)}
                 placeholder={t('Intern, volunteer, president…', 'Pasante, voluntario, presidente…')} />
          <Select label={t('Section', 'Sección')} value={kind} onChange={(e) => setKind(e.target.value as Experience['kind'])}>
            <option value="work">{t('Work experience', 'Experiencia laboral')}</option>
            <option value="extra">{t('Activities & leadership', 'Actividades y liderazgo')}</option>
          </Select>
        </div>
        <div className="mt-3">
          <Button variant="primary" disabled={!org.trim()} onClick={async () => {
            const created = await api.create<Experience>('experience', {
              kind, org: org.trim(), title: role.trim(), bullets: '[]', sort_order: store.experience.length,
            });
            setOrg(''); setRole('');
            await reload();
            setTargetId(created.id);
          }}>{t('Add it', 'Agregar')}</Button>
        </div>
        {entries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {entries.map((e) => <Badge key={e.id} tone={e.kind === 'work' ? 'sky' : 'amber'}>{e.org} · {parseBullets(e.bullets).length}</Badge>)}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
        <p className="mb-1 text-sm font-medium text-ink-900">{t('2. Now describe one thing you did there', '2. Ahora contá una cosa que hiciste ahí')}</p>
        <p className="mb-3 text-xs text-ink-500">{t('Fill what you can. The sentence builds itself underneath.', 'Completá lo que puedas. La frase se arma sola abajo.')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Doing word', 'Verbo')} value={verb} onChange={(e) => setVerb(e.target.value)}
                 placeholder={t('Organised / Sold / Built / Taught', 'Organicé / Vendí / Construí / Enseñé')} />
          <Field label={t('What', 'Qué')} value={what} onChange={(e) => setWhat(e.target.value)}
                 placeholder={t('the end-of-year event', 'el evento de fin de año')} />
          <Field label={t('How big', 'Qué tan grande')} value={scale} onChange={(e) => setScale(e.target.value)}
                 placeholder={t('200 people', '200 personas')} />
          <Field label={t('What came of it', 'Qué resultó')} value={result} onChange={(e) => setResult(e.target.value)}
                 placeholder={t('raised $4,000, double last year', 'recaudamos $4.000, el doble que el año anterior')} />
        </div>
        <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          {bullet ? <span className="text-ink-900">• {bullet}{bullet.endsWith('.') ? '' : '.'}</span>
                  : <span className="text-ink-400">{t('Your line appears here.', 'Tu línea aparece acá.')}</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Select label={t('Add to', 'Agregar a')} value={target?.id ?? ''} onChange={(e) => setTargetId(Number(e.target.value))} className="w-56">
            {entries.map((e) => <option key={e.id} value={e.id}>{e.org}</option>)}
          </Select>
          <Button variant="primary" disabled={!target || !bullet.trim()} onClick={async () => {
            if (!target) return;
            const bs = parseBullets(target.bullets);
            bs.push({ text: bullet.endsWith('.') ? bullet : `${bullet}.`, es: '', tracks: [] });
            await api.update('experience', target.id, { bullets: JSON.stringify(bs) });
            setVerb(''); setWhat(''); setScale(''); setResult('');
            await reload();
            done('experience');
          }}>{t('Add this line', 'Agregar esta línea')}</Button>
          <Button variant="ghost" onClick={() => { done('experience'); next(); }}>{t('Done adding →', 'Listo →')}</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The gaps a reviewer always names: skills, grades, coursework, projects, activities, LinkedIn.
 * Each is a box here rather than a note telling you to go and find one.
 */
function ExtrasStep({ store, reload, done, next, t }: Ctx) {
  const education = store.experience.filter((e) => e.kind === 'education');
  const [skills, setSkills] = useState(store.profile.skills);
  const [languages, setLanguages] = useState(store.profile.languages);
  const [linkedin, setLinkedin] = useState(store.profile.linkedin);
  const [eduId, setEduId] = useState<number | ''>(education[0]?.id ?? '');
  const [grade, setGrade] = useState('');
  const [courses, setCourses] = useState('');
  const [project, setProject] = useState('');
  const [activity, setActivity] = useState('');
  const [msg, setMsg] = useState('');

  const addEduBullet = async (text: string) => {
    const edu = store.experience.find((e) => e.id === eduId) ?? education[0];
    if (!edu || !text.trim()) return;
    const bs = parseBullets(edu.bullets);
    bs.push({ text: text.trim(), es: '', tracks: [] });
    await api.update('experience', edu.id, { bullets: JSON.stringify(bs) });
  };

  const save = async () => {
    await api.saveProfile({ skills, languages, linkedin });
    if (grade.trim()) await addEduBullet(grade);
    if (courses.trim()) await addEduBullet(t(`Relevant coursework: ${courses}`, `Materias relevantes: ${courses}`));
    if (project.trim()) {
      await api.create('experience', {
        kind: 'extra', org: t('Projects', 'Proyectos'), title: '', bullets: JSON.stringify([{ text: project.trim(), es: '', tracks: [] }]),
        sort_order: store.experience.length,
      });
    }
    if (activity.trim()) {
      await api.create('experience', {
        kind: 'extra', org: t('Activities', 'Actividades'), title: '', bullets: JSON.stringify([{ text: activity.trim(), es: '', tracks: [] }]),
        sort_order: store.experience.length + 1,
      });
    }
    setGrade(''); setCourses(''); setProject(''); setActivity('');
    await reload();
    done('extras');
    setMsg(t('Saved. Add more here any time, or edit it all on the My CV screen.',
             'Guardado. Podés agregar más acá cuando quieras, o editarlo todo en Mi CV.'));
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Area label={t('Skills and tools — the ones you would be happy to be asked about',
                       'Habilidades y herramientas — las que te bancarías que te pregunten')}
              rows={2} value={skills} onChange={(e) => setSkills(e.target.value)}
              placeholder={t('Excel, SQL, Python, Canva, Photoshop…', 'Excel, SQL, Python, Canva, Photoshop…')} />
        <Area label={t('Languages and level', 'Idiomas y nivel')} rows={2} value={languages} onChange={(e) => setLanguages(e.target.value)}
              placeholder={t('Spanish (native), English (B2)', 'Español (nativo), Inglés (B2)')} />

        <Field label={t('LinkedIn profile', 'Perfil de LinkedIn')} value={linkedin} onChange={(e) => setLinkedin(e.target.value)}
               placeholder="linkedin.com/in/…" />
        {education.length > 0 && (
          <Select label={t('Add the next two to', 'Agregar los dos siguientes a')} value={eduId}
                  onChange={(e) => setEduId(Number(e.target.value))}>
            {education.map((e) => <option key={e.id} value={e.id}>{e.org}</option>)}
          </Select>
        )}

        <Field label={t('Grade average, honours or awards — only if it helps you',
                        'Promedio, distinciones o premios — sólo si te suma')}
               value={grade} onChange={(e) => setGrade(e.target.value)}
               placeholder={t('GPA 8.4/10, top 10% of cohort', 'Promedio 8,4/10, primer 10% de la camada')} />
        <Field label={t('Relevant coursework', 'Materias relevantes')} value={courses} onChange={(e) => setCourses(e.target.value)}
               placeholder={t('Corporate finance, statistics, econometrics', 'Finanzas corporativas, estadística, econometría')} />

        <Area label={t('A project — academic or personal', 'Un proyecto — académico o personal')} rows={2} value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder={t('What it was, what you did, what came out of it.', 'Qué era, qué hiciste, qué salió de ahí.')} />
        <Area label={t('An activity — club, society, volunteering, sport', 'Una actividad — club, sociedad, voluntariado, deporte')}
              rows={2} value={activity} onChange={(e) => setActivity(e.target.value)}
              placeholder={t('Your role, how long, how many people.', 'Tu rol, cuánto tiempo, cuánta gente.')} />
      </div>

      <SaveBar label={t('Save and continue', 'Guardar y continuar')} onSave={save}
               extra={<Button variant="ghost" onClick={next}>{t('Continue →', 'Continuar →')}</Button>} />
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
    </div>
  );
}

function NumbersStep({ store, done, next, t }: Ctx) {
  const rows = store.experience.flatMap((e) => parseBullets(e.bullets).map((b) => ({ org: e.org, text: b.text, ok: hasDigit(b.text) })));
  const without = rows.filter((r) => !r.ok);

  return (
    <div className="space-y-3">
      {rows.length === 0 ? <p className="text-sm text-ink-500">{t('Nothing to check yet.', 'Todavía no hay nada que revisar.')}</p>
        : without.length === 0 ? <p className="text-sm text-emerald-700">{t('Every line has a number. That is rarer than you would think.', 'Todas las líneas tienen un número. Es más raro de lo que parece.')}</p>
        : (
          <>
            <p className="text-sm text-ink-700">
              {t(`${rows.length - without.length} of ${rows.length} lines have a number. These do not:`,
                 `${rows.length - without.length} de ${rows.length} líneas tienen un número. Estas no:`)}
            </p>
            <ul className="space-y-1">
              {without.slice(0, 8).map((r, i) => (
                <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-ink-700">
                  <span className="text-xs text-ink-500">{r.org}: </span>{r.text}
                </li>
              ))}
            </ul>
            <Link to="/profile"><Button variant="primary">{t('Edit them', 'Editarlas')}</Button></Link>
          </>
        )}
      <Button variant="ghost" onClick={() => { done('numbers'); next(); }}>{t('Continue →', 'Continuar →')}</Button>
    </div>
  );
}

function AIKey({ reload, done, next, t }: Ctx) {
  const [status, setStatus] = useState<{ configured: boolean; source: string; model: string; hint: string } | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { void api.aiStatus().then(setStatus).catch(() => setStatus(null)); }, []);

  return (
    <div className="space-y-3">
      {status?.configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="emerald">{t('connected', 'conectada')}</Badge>
          <span className="text-sm text-ink-700">
            {t('key ending', 'clave terminada en')} {status.hint} · {status.model} ·{' '}
            {status.source === 'env' ? t('from your .env file', 'desde tu archivo .env') : t('stored in this app', 'guardada en esta app')}
          </span>
        </div>
      ) : (
        <ol className="space-y-1.5 text-sm text-ink-700">
          <li className="flex gap-2"><span className="text-brand-500">1.</span>
            <span>{t('Go to', 'Andá a')} <a className="text-brand-700 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> {t('and create a key. It is free to make.', 'y creá una clave. Crearla es gratis.')}</span></li>
          <li className="flex gap-2"><span className="text-brand-500">2.</span><span>{t('Copy it and paste it below.', 'Copiala y pegala acá abajo.')}</span></li>
        </ol>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('Google AI API key', 'Clave de API de Google AI')} type="password" value={key}
               onChange={(e) => setKey(e.target.value)} placeholder={t('paste your key here', 'pegá tu clave acá')}
               className="min-w-64 flex-1" autoComplete="off" />
        <Button variant="primary" disabled={!key.trim()} onClick={async () => {
          setStatus(await api.aiSetKey(key.trim()));
          setKey('');
          setMsg(t('Saved. The next two steps now work.', 'Guardada. Los dos pasos siguientes ya funcionan.'));
          await reload();
          done('key');
        }}>{t('Save key', 'Guardar clave')}</Button>
        {status?.configured && (
          <Button variant="ghost" onClick={async () => { setStatus(await api.aiSetKey('')); setMsg(t('Key removed.', 'Clave eliminada.')); }}>
            {t('Remove', 'Eliminar')}
          </Button>
        )}
        <Button variant="ghost" onClick={next}>{t('Continue →', 'Continuar →')}</Button>
      </div>

      {msg && <p className="text-sm text-brand-700">{msg}</p>}
      <p className="text-xs text-ink-500">
        {t('Stored on this machine only. Google charges your own account for what you use, and this app only calls it when you press a button.',
           'Se guarda sólo en esta computadora. Google le cobra a tu propia cuenta lo que uses, y esta app sólo la llama cuando apretás un botón.')}
      </p>
    </div>
  );
}

function AIBullets({ store, reload, done, next, t, lang }: Ctx) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<BulletSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const rows = store.experience.flatMap((e) =>
    parseBullets(e.bullets).map((b, i) => ({ key: `${e.id}:${i}`, expId: e.id, index: i, org: e.org, text: b.text })));

  const run = async () => {
    const picked = rows.filter((r) => selected.has(r.key));
    if (!picked.length) return;
    setBusy(true); setErr('');
    try {
      const res = await api.aiBullets({ bullets: picked.map((p) => p.text), track: firstTrack(store), lang });
      setSuggestions(res.suggestions);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const accept = async (s: BulletSuggestion) => {
    const row = rows.find((r) => r.text === s.original);
    const exp = row && store.experience.find((e) => e.id === row.expId);
    if (!row || !exp) return;
    const bs = parseBullets(exp.bullets);
    bs[row.index] = { ...bs[row.index], text: s.improved };
    await api.update('experience', exp.id, { bullets: JSON.stringify(bs) });
    setSuggestions((list) => list.filter((x) => x !== s));
    await reload();
    done('rewrite');
  };

  if (!rows.length) return <p className="text-sm text-ink-500">{t('Add some lines to your CV first.', 'Primero agregá algunas líneas a tu CV.')}</p>;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {rows.map((r) => (
          <label key={r.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
            <input type="checkbox" checked={selected.has(r.key)} className="mt-0.5 accent-brand-600"
                   onChange={() => setSelected((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })} />
            <span className="text-ink-700"><span className="text-xs text-ink-400">{r.org}: </span>{r.text}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setSelected(new Set(rows.map((r) => r.key)))}>{t('Select all', 'Seleccionar todo')}</Button>
        <Button variant="primary" disabled={!selected.size || busy} onClick={run}>
          {busy ? t('Thinking…', 'Pensando…') : t(`Improve ${selected.size || ''} with AI`, `Mejorar ${selected.size || ''} con IA`)}
        </Button>
        <Button variant="ghost" onClick={() => { done('rewrite'); next(); }}>{t('Continue →', 'Continuar →')}</Button>
      </div>

      {err && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{err}</p>}

      {suggestions.map((s, i) => (
        <Card key={i} className="animate-rise space-y-2 p-3 text-sm">
          <p className="text-ink-400 line-through">{s.original}</p>
          <p className="font-medium text-ink-900">{s.improved}</p>
          <p className="text-xs text-ink-500">{s.why}</p>
          {s.needs?.length > 0 && <p className="text-xs text-amber-700">{t('It needs from you:', 'Necesita de vos:')} {s.needs.join(' · ')}</p>}
          <div className="flex gap-2">
            <Button variant="soft" onClick={() => accept(s)}>{t('Use this', 'Usar esta')}</Button>
            <Button variant="ghost" onClick={() => setSuggestions((l) => l.filter((x) => x !== s))}>{t('Keep mine', 'Dejar la mía')}</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function AIReview({ store, reload, done, next, t, lang }: Ctx) {
  const [summary, setSummary] = useState('');
  const [review, setReview] = useState<{ verdict: string; strengths: string[]; fixes: { problem: string; fix: string; where: string }[]; missing: string[] } | null>(null);
  const [edits, setEdits] = useState<FieldEdit[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const track = firstTrack(store);
  const cv = buildCV(store.profile, store.experience, { track, lang, template: 'ats', maxBullets: 99 });

  /** Every addressable field, so the model can return edits we can actually apply. */
  const fields = (): FieldItem[] => {
    const out: FieldItem[] = [
      { target: 'profile.name', label: t('Name', 'Nombre'), value: store.profile.name },
      { target: 'profile.headline', label: t('Headline', 'Encabezado'), value: store.profile.headline },
      { target: 'profile.summary', label: t('Profile paragraph', 'Párrafo de perfil'), value: store.profile.summary },
      { target: 'profile.skills', label: t('Skills', 'Habilidades'), value: store.profile.skills },
      { target: 'profile.languages', label: t('Languages', 'Idiomas'), value: store.profile.languages },
      { target: 'profile.location', label: t('Location', 'Ubicación'), value: store.profile.location },
    ].filter((f) => f.value.trim());

    for (const e of store.experience) {
      if (e.org.trim()) out.push({ target: `exp.${e.id}.org`, label: t('Organisation', 'Organización'), value: e.org });
      if (e.title.trim()) out.push({ target: `exp.${e.id}.title`, label: t('Job title', 'Puesto'), value: e.title });
      parseBullets(e.bullets).forEach((b, i) => {
        if (b.text.trim()) out.push({ target: `exp.${e.id}.bullet.${i}`, label: `${e.org} — ${t('line', 'línea')} ${i + 1}`, value: b.text });
      });
    }
    return out;
  };

  const call = async (what: 'summary' | 'review' | 'polish') => {
    setBusy(what); setErr('');
    try {
      if (what === 'summary') {
        const res = await api.aiSummary({
          headline: store.profile.headline,
          bullets: store.experience.flatMap((e) => parseBullets(e.bullets).map((b) => b.text)),
          track, lang,
        });
        setSummary(res.text);
      } else if (what === 'review') {
        setReview((await api.aiReview({ cv, track, lang })).review);
      } else {
        setEdits((await api.aiPolish({ fields: fields(), track, lang })).edits);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };

  /** Applies one returned edit to the field it names. */
  const apply = async (edit: FieldEdit) => {
    const [scope, a, b, c] = edit.target.split('.');
    if (scope === 'profile') {
      await api.saveProfile({ [a]: edit.to });
    } else if (scope === 'exp') {
      const exp = store.experience.find((e) => e.id === Number(a));
      if (!exp) return;
      if (b === 'bullet') {
        const bs = parseBullets(exp.bullets);
        const i = Number(c);
        if (!bs[i]) return;
        bs[i] = { ...bs[i], text: edit.to };
        await api.update('experience', exp.id, { bullets: JSON.stringify(bs) });
      } else {
        await api.update('experience', exp.id, { [b]: edit.to });
      }
    }
    setEdits((list) => list.filter((x) => x !== edit));
    await reload();
    done('profile-para');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy !== ''} onClick={() => call('summary')}>
          {busy === 'summary' ? t('Writing…', 'Escribiendo…') : t('Write my profile paragraph', 'Escribir mi párrafo de perfil')}
        </Button>
        <Button variant="soft" disabled={busy !== ''} onClick={() => call('review')}>
          {busy === 'review' ? t('Reading…', 'Leyendo…') : t('Review my whole CV', 'Revisar todo mi CV')}
        </Button>
        <Button variant="soft" disabled={busy !== ''} onClick={() => call('polish')}>
          {busy === 'polish' ? t('Checking…', 'Revisando…') : t('Fix typos and wording', 'Corregir errores y redacción')}
        </Button>
        <Button variant="ghost" onClick={() => { done('profile-para'); next(); }}>{t('Continue →', 'Continuar →')}</Button>
      </div>

      {err && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{err}</p>}

      {summary && (
        <Card className="animate-rise space-y-2 p-3">
          <Area rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <SaveBar label={t('Use this as my profile', 'Usar esto como mi perfil')} onSave={async () => {
            await api.saveProfile({ summary });
            await reload();
            done('profile-para');
          }} />
        </Card>
      )}

      {edits.length > 0 && (
        <Card className="animate-rise space-y-2 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-900">{t('Suggested corrections', 'Correcciones sugeridas')}</p>
            <Button variant="soft" onClick={async () => { for (const e of [...edits]) await apply(e); }}>
              {t('Apply all', 'Aplicar todas')}
            </Button>
          </div>
          {edits.map((e, i) => (
            <div key={i} className="rounded-lg border border-line px-3 py-2 text-sm">
              <p className="text-[11px] uppercase tracking-wider text-ink-400">{e.label}</p>
              <p className="text-ink-400 line-through">{e.from}</p>
              <p className="font-medium text-ink-900">{e.to}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-ink-500">{e.why}</span>
                <Button variant="soft" className="ml-auto" onClick={() => apply(e)}>{t('Apply', 'Aplicar')}</Button>
                <Button variant="ghost" onClick={() => setEdits((l) => l.filter((x) => x !== e))}>{t('Ignore', 'Ignorar')}</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {review && (
        <Card className="animate-rise space-y-3 p-4 text-sm">
          <p className="font-medium text-ink-900">{review.verdict}</p>
          {review.strengths?.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-500">{t('Working', 'Lo que funciona')}</p>
              <ul className="mt-1 space-y-0.5 text-emerald-700">{review.strengths.map((x, i) => <li key={i}>✓ {x}</li>)}</ul>
            </div>
          )}
          {review.fixes?.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-500">{t('Fix these', 'Corregí esto')}</p>
              <ul className="mt-1 space-y-2">
                {review.fixes.map((f, i) => (
                  <li key={i} className="rounded-lg border border-line px-3 py-2">
                    <p className="text-ink-900">{f.problem}</p>
                    <p className="text-ink-700">→ {f.fix}</p>
                    <p className="text-xs text-ink-400">{f.where}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-500">
                {t('“Fix typos and wording” above turns most of these into one-click corrections.',
                   '“Corregir errores y redacción”, arriba, convierte la mayoría de estas en correcciones de un clic.')}
              </p>
            </div>
          )}
          {review.missing?.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-500">{t('Missing', 'Falta')}</p>
              <ul className="mt-1 space-y-0.5 text-amber-700">{review.missing.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              <p className="mt-2 text-xs text-ink-500">
                {t('Most of these have a box in the earlier step “The things recruiters look for and rarely find”.',
                   'Casi todas tienen un campo en el paso anterior “Lo que los reclutadores buscan y casi nunca encuentran”.')}
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function JobsStep({ store, reload, done, next, t }: Ctx) {
  return (
    <div className="space-y-4">
      <JobFinder store={store} onDone={async () => { await reload(); done('linkedin'); }} />

      <details className="rounded-lg border border-line bg-sunken/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-ink-900">
          {t('Or do it by hand on LinkedIn', 'O hacelo a mano en LinkedIn')}
        </summary>
        <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <a href="https://www.linkedin.com/jobs/" target="_blank" rel="noreferrer">
          <Button variant="primary">{t('1. Open LinkedIn jobs ↗', '1. Abrir avisos de LinkedIn ↗')}</Button>
        </a>
        <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer">
          <Button variant="soft">{t('2. Request my LinkedIn data ↗', '2. Pedir mis datos de LinkedIn ↗')}</Button>
        </a>
        <Link to="/jobs"><Button>{t('3. Import them here', '3. Importarlos acá')}</Button></Link>
      </div>
      <ul className="space-y-1.5 text-sm text-ink-700">
        <li className="flex gap-2"><span className="text-brand-500">→</span>
          <span>{t('Search on LinkedIn and press Save on anything that looks right. Twenty is plenty to start.',
                   'Buscá en LinkedIn y guardá lo que te sirva. Con veinte alcanza para empezar.')}</span></li>
        <li className="flex gap-2"><span className="text-brand-500">→</span>
          <span>{t('Request your data export — it arrives by email, sometimes in minutes. The file you want is Saved Jobs.csv.',
                   'Pedí la exportación de tus datos — llega por mail, a veces en minutos. El archivo que querés es Saved Jobs.csv.')}</span></li>
        <li className="flex gap-2"><span className="text-brand-500">→</span>
          <span>{t('In a hurry? On the Jobs screen you can paste a search results page straight in.',
                   '¿Apurado? En Avisos podés pegar una página de resultados directamente.')}</span></li>
      </ul>
        </div>
      </details>

      <Button variant="ghost" onClick={() => { done('linkedin'); next(); }}>{t('I’ve got jobs in →', 'Ya tengo avisos →')}</Button>
    </div>
  );
}

function BackupStep({ reload, done, next, t }: Ctx) {
  const [msg, setMsg] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={async () => {
          const res = await fetch('/api/backup');
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `career-lab-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          await api.setSetting('step:backup', 'done');
          await reload();
          done('backup');
          setMsg(t('Downloaded. Put it somewhere that is not this laptop.', 'Descargado. Guardalo en algún lado que no sea esta computadora.'));
        }}>{t('Download a backup', 'Descargar una copia')}</Button>
        <Button variant="ghost" onClick={next}>{t('Continue →', 'Continuar →')}</Button>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
    </div>
  );
}
