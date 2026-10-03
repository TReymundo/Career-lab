import { useEffect, useState, type ReactNode } from 'react';
import { Button, Field } from './ui.tsx';
import { api } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { hasDigit } from '../lib/cvcheck.ts';
import { TRACKS, parseBullets, type Experience, type Store, type Track } from '../lib/types.ts';

/**
 * The questions the CV is built from, one per screen.
 *
 * Both paths use the same components: building from nothing asks all of them in order, and
 * an uploaded CV asks only the ones it could not answer. Every answer is saved the moment you
 * move on, so closing the tab never loses anything.
 */

export interface QProps {
  store: Store;
  reload: () => Promise<void>;
  onDone: () => void;
}

/** The frame every question sits in: one big question, one line of why, then the answer. */
export function Question({ title, hint, children, footer }: {
  title: string; hint?: ReactNode; children: ReactNode; footer: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{title}</h2>
        {hint && <p className="mt-2 text-sm leading-relaxed text-ink-500">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
      <div className="flex flex-wrap items-center gap-3 pt-2">{footer}</div>
    </div>
  );
}

const big = 'w-full rounded-xl border border-line bg-surface px-4 py-3.5 text-lg text-ink-900 outline-none transition ' +
  'placeholder:text-ink-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100';

function Skip({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button onClick={onClick} className="text-sm text-ink-400 underline-offset-2 transition hover:text-ink-700 hover:underline">
      {t('Skip for now', 'Saltear por ahora')}
    </button>
  );
}

function Save({ disabled, onClick, children }: { disabled?: boolean; onClick: () => Promise<void> | void; children?: ReactNode }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="primary" className="px-6 py-3 text-base" disabled={disabled || busy}
            onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>
      {busy ? t('Saving…', 'Guardando…') : children ?? t('Continue →', 'Continuar →')}
    </Button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
            className={`rounded-full border px-3.5 py-2 text-sm transition active:scale-[.97] ${
              on ? 'border-brand-400 bg-brand-50 font-medium text-brand-700' : 'border-line bg-surface text-ink-700 hover:border-line-strong hover:bg-sunken'}`}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- name */

export function NameQ({ store, reload, onDone }: QProps) {
  const t = useT();
  const [name, setName] = useState(store.profile.name);
  const save = async () => { await api.saveProfile({ name: name.trim() }); await reload(); onDone(); };

  return (
    <Question title={t('First, what’s your name?', 'Primero, ¿cómo te llamás?')}
              hint={t('Exactly as you want it at the top of the page.', 'Tal como lo querés arriba de la hoja.')}
              footer={<><Save disabled={!name.trim()} onClick={save} /><Skip onClick={onDone} /></>}>
      <input autoFocus className={big} value={name} onChange={(e) => setName(e.target.value)}
             onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void save(); }}
             placeholder={t('Full name', 'Nombre y apellido')} />
    </Question>
  );
}

/* ---------------------------------------------------------------- contact */

export function ContactQ({ store, reload, onDone }: QProps) {
  const t = useT();
  const [d, setD] = useState({
    email: store.profile.email, phone: store.profile.phone, location: store.profile.location, linkedin: store.profile.linkedin,
  });
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const save = async () => { await api.saveProfile(d); await reload(); onDone(); };

  return (
    <Question
      title={t('How can employers reach you?', '¿Cómo te contacta un empleador?')}
      hint={t('Leave out your ID number, street address, age and marital status — employers don’t need them, and many advise against it.',
              'No pongas DNI, CUIL, dirección, edad ni estado civil — no hacen falta, y se recomienda no incluirlos.')}
      footer={<><Save disabled={!d.email.trim()} onClick={save} /><Skip onClick={onDone} /></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Email', 'Email')} type="email" autoFocus value={d.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@email.com" />
        <Field label={t('Phone', 'Teléfono')} value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+54 9 11 …" />
        <Field label={t('City, country', 'Ciudad, país')} value={d.location} onChange={(e) => set({ location: e.target.value })}
               placeholder={t('Buenos Aires, Argentina', 'Buenos Aires, Argentina')} />
        <Field label={t('LinkedIn (if you have one)', 'LinkedIn (si tenés)')} value={d.linkedin} onChange={(e) => set({ linkedin: e.target.value })}
               placeholder="linkedin.com/in/…" />
      </div>
      {d.email.trim() && !d.phone.trim() && (
        <p className="animate-fade rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {t('Worth adding a phone: plenty of recruiters call or WhatsApp before they email.',
             'Conviene poner un teléfono: muchos reclutadores llaman o escriben por WhatsApp antes que por mail.')}
        </p>
      )}
    </Question>
  );
}

/* ---------------------------------------------------------------- target */

export function TargetQ({ store, reload, onDone }: QProps) {
  const t = useT();
  const [title, setTitle] = useState(store.profile.headline);
  const [picked, setPicked] = useState<Track[]>(() => {
    try { return JSON.parse(store.setting['tracks'] || '[]'); } catch { return []; }
  });
  const LABELS: Record<Track, string> = {
    finance: t('Finance & banking', 'Finanzas y banca'),
    ib: t('Investment banking', 'Banca de inversión'),
    consulting: t('Consulting', 'Consultoría'),
    data: t('Data & analytics', 'Datos y analítica'),
    tech: t('Software & tech', 'Software y tecnología'),
    product: t('Marketing, sales & operations', 'Marketing, ventas y operaciones'),
    other: t('Something else', 'Otra cosa'),
  };
  const save = async () => {
    await api.saveProfile({ headline: title.trim() });
    await api.setSetting('tracks', JSON.stringify(picked.length ? picked : ['other']));
    await reload();
    onDone();
  };

  return (
    <Question
      title={t('What kind of work are you looking for?', '¿Qué tipo de trabajo estás buscando?')}
      hint={t('This becomes the headline under your name, and it steers the job search later. You can change it any time.',
              'Esto va como título debajo de tu nombre, y orienta la búsqueda después. Lo podés cambiar cuando quieras.')}
      footer={<><Save disabled={!title.trim() && !picked.length} onClick={save} /><Skip onClick={onDone} /></>}
    >
      <input autoFocus className={big} value={title} onChange={(e) => setTitle(e.target.value)}
             placeholder={t('e.g. Sales assistant, Junior data analyst, Barista', 'ej. Vendedor/a, Analista de datos junior, Barista')} />
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">{t('Which area? Pick any', '¿Qué área? Elegí las que quieras')}</p>
        <div className="flex flex-wrap gap-2">
          {TRACKS.map((tr) => (
            <Chip key={tr.id} on={picked.includes(tr.id)}
                  onClick={() => setPicked((p) => (p.includes(tr.id) ? p.filter((x) => x !== tr.id) : [...p, tr.id]))}>
              {LABELS[tr.id]}
            </Chip>
          ))}
        </div>
      </div>
    </Question>
  );
}

/* ---------------------------------------------------------------- entries list */

function EntryList({ entries, reload }: { entries: Experience[]; reload: () => Promise<void> }) {
  const t = useT();
  if (!entries.length) return null;
  return (
    <ul className="stagger space-y-2">
      {entries.map((e) => {
        const n = parseBullets(e.bullets).length;
        return (
          <li key={e.id} className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-2.5 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500 text-xs text-white">✓</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-ink-900">{e.org}</span>
              {e.title && <span className="text-ink-500"> — {e.title}</span>}
              {e.kind !== 'education' && <span className="text-ink-400"> · {n} {n === 1 ? t('line', 'línea') : t('lines', 'líneas')}</span>}
            </span>
            <button onClick={async () => { await api.remove('experience', e.id); await reload(); }}
                    className="rounded px-1.5 text-ink-400 transition hover:bg-rose-50 hover:text-rose-600" title={t('Remove', 'Quitar')}>✕</button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- education */

export function EducationQ({ store, reload, onDone }: QProps) {
  const t = useT();
  const LEVELS = [
    { id: 'university', label: t('University', 'Universidad') },
    { id: 'tertiary', label: t('Tertiary / technical', 'Terciario / técnico') },
    { id: 'school', label: t('High school', 'Secundario') },
    { id: 'course', label: t('Course / bootcamp', 'Curso / bootcamp') },
  ];
  const existing = store.experience.filter((e) => e.kind === 'education');
  const [open, setOpen] = useState(existing.length === 0);
  const [level, setLevel] = useState('university');
  const [org, setOrg] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [studying, setStudying] = useState(false);

  const add = async () => {
    await api.create('experience', {
      kind: 'education', org: org.trim(), title: title.trim(), start_date: start.trim(),
      end_date: studying ? (end.trim() ? `${end.trim()} (${t('expected', 'estimado')})` : '') : end.trim(),
      bullets: '[]', sort_order: store.experience.length,
    });
    setOrg(''); setTitle(''); setStart(''); setEnd(''); setStudying(false);
    setOpen(false);
    await reload();
  };

  return (
    <Question
      title={existing.length ? t('Anything else you’ve studied?', '¿Estudiaste algo más?')
                             : t('What have you studied?', '¿Qué estudiaste?')}
      hint={t('Newest first. Unfinished counts — say when you expect to finish. High school, courses and bootcamps all belong here.',
              'Lo más reciente primero. Si no terminaste también cuenta — poné cuándo pensás terminar. Secundario, cursos y bootcamps también van.')}
      footer={open
        ? <><Save disabled={!org.trim()} onClick={add}>{t('Add it', 'Agregar')}</Save>
            {existing.length > 0 ? <Button variant="ghost" onClick={() => setOpen(false)}>{t('Cancel', 'Cancelar')}</Button> : <Skip onClick={onDone} />}</>
        : <><Save onClick={onDone} /><Button onClick={() => setOpen(true)}>{t('+ Add another', '+ Agregar otro')}</Button></>}
    >
      <EntryList entries={existing} reload={reload} />
      {open && (
        <div className="animate-rise space-y-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => <Chip key={l.id} on={level === l.id} onClick={() => setLevel(l.id)}>{l.label}</Chip>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Where', 'Dónde')} autoFocus value={org} onChange={(e) => setOrg(e.target.value)}
                   placeholder={level === 'school' ? t('Name of your school', 'Nombre del colegio') : t('University, institute, platform…', 'Universidad, instituto, plataforma…')} />
            <Field label={t('What', 'Qué')} value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder={level === 'school' ? t('Secondary school diploma', 'Bachiller en …') : t('e.g. Business administration', 'ej. Administración de empresas')} />
            <Field label={t('From (year)', 'Desde (año)')} value={start} onChange={(e) => setStart(e.target.value)} placeholder="2022" />
            <Field label={studying ? t('Expected to finish', 'Fin estimado') : t('Finished (year)', 'Terminé (año)')} value={end}
                   onChange={(e) => setEnd(e.target.value)} placeholder="2026" />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={studying} onChange={(e) => setStudying(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            {t('I’m still studying this', 'Todavía lo estoy cursando')}
          </label>
        </div>
      )}
    </Question>
  );
}

/* ---------------------------------------------------------------- experience */

const NUMBER_IDEAS = (t: (en: string, es: string) => string) => [
  t('people served', 'personas atendidas'), t('per day / week', 'por día / semana'), t('sales or money', 'ventas o plata'),
  t('team size', 'tamaño del equipo'), t('hours', 'horas'), t('% better', '% de mejora'), t('grade or ranking', 'nota o puesto'),
];

/** Joins "what you did" and "the number" into one line that reads like a person wrote it. */
function composeLine(what: string, num: string) {
  const w = what.trim().replace(/\.$/, '');
  if (!w) return '';
  const cap = w.charAt(0).toUpperCase() + w.slice(1);
  return `${cap}${num.trim() ? ` — ${num.trim().replace(/\.$/, '')}` : ''}.`;
}

export function ExperienceQ({ store, reload, onDone }: QProps) {
  const t = useT();
  const entries = store.experience.filter((e) => e.kind !== 'education');
  // place → describe the place; line → add a line to it; menu → what next.
  const [stage, setStage] = useState<'place' | 'line' | 'menu'>(entries.length ? 'menu' : 'place');
  const [currentId, setCurrentId] = useState<number | null>(null);

  const [kind, setKind] = useState<'work' | 'extra'>('work');
  const [org, setOrg] = useState('');
  const [role, setRole] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [ongoing, setOngoing] = useState(false);

  const [what, setWhat] = useState('');
  const [num, setNum] = useState('');

  const current = store.experience.find((e) => e.id === currentId);
  const currentLines = current ? parseBullets(current.bullets) : [];
  const line = composeLine(what, num);

  const addPlace = async () => {
    const created = await api.create<Experience>('experience', {
      kind, org: org.trim(), title: role.trim(), start_date: start.trim(), end_date: ongoing ? '' : end.trim(),
      bullets: '[]', sort_order: store.experience.length,
    });
    setOrg(''); setRole(''); setStart(''); setEnd(''); setOngoing(false);
    await reload();
    setCurrentId(created.id);
    setStage('line');
  };

  const addLine = async () => {
    if (!current || !line) return;
    const bs = parseBullets(current.bullets);
    bs.push({ text: line, es: '', tracks: [] });
    await api.update('experience', current.id, { bullets: JSON.stringify(bs) });
    setWhat(''); setNum('');
    await reload();
  };

  const OTHER = [
    t('a school or uni project', 'un proyecto del colegio o la facu'), t('a club or team role', 'un rol en un club o equipo'),
    t('tutoring or coaching', 'clases particulares o entrenar'), t('a family business', 'un negocio familiar'),
    t('volunteering', 'voluntariado'), t('freelance or a side project', 'freelance o un emprendimiento'),
  ];

  if (stage === 'place') {
    return (
      <Question
        title={entries.length ? t('Where else?', '¿Dónde más?') : t('Tell me about something you’ve done.', 'Contame algo que hayas hecho.')}
        hint={t('A job of any kind counts. No jobs yet? Projects, clubs, tutoring, sport and volunteering are normal on a first CV.',
                'Cualquier trabajo cuenta. ¿Todavía no trabajaste? Proyectos, clubes, clases, deporte y voluntariado son normales en un primer CV.')}
        footer={<><Save disabled={!org.trim()} onClick={addPlace}>{t('Next →', 'Siguiente →')}</Save>
                  {entries.length ? <Button variant="ghost" onClick={() => setStage('menu')}>{t('Cancel', 'Cancelar')}</Button> : <Skip onClick={onDone} />}</>}
      >
        <div className="flex flex-wrap gap-2">
          <Chip on={kind === 'work'} onClick={() => setKind('work')}>{t('A job or internship', 'Un trabajo o pasantía')}</Chip>
          <Chip on={kind === 'extra'} onClick={() => setKind('extra')}>{t('Something else', 'Otra cosa')}</Chip>
        </div>
        {kind === 'extra' && (
          <p className="animate-fade text-sm text-ink-500">{t('For example', 'Por ejemplo')}: {OTHER.join(' · ')}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === 'work' ? t('Company', 'Empresa') : t('Where / what', 'Dónde / qué')} autoFocus value={org}
                 onChange={(e) => setOrg(e.target.value)}
                 placeholder={kind === 'work' ? t('e.g. Café Martínez', 'ej. Café Martínez') : t('e.g. School student council', 'ej. Centro de estudiantes')} />
          <Field label={t('Your role', 'Tu rol')} value={role} onChange={(e) => setRole(e.target.value)}
                 placeholder={kind === 'work' ? t('e.g. Barista', 'ej. Barista') : t('e.g. Treasurer', 'ej. Tesorero/a')} />
          <Field label={t('From (month and year)', 'Desde (mes y año)')} value={start} onChange={(e) => setStart(e.target.value)}
                 placeholder={t('Mar 2024', 'Mar 2024')} />
          <Field label={t('Until', 'Hasta')} value={ongoing ? '' : end} disabled={ongoing} onChange={(e) => setEnd(e.target.value)}
                 placeholder={ongoing ? t('Present', 'Actualidad') : t('Dec 2024', 'Dic 2024')} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          {t('I still do this', 'Todavía lo hago')}
        </label>
      </Question>
    );
  }

  if (stage === 'line' && current) {
    return (
      <Question
        title={currentLines.length ? t(`Anything else you did at ${current.org}?`, `¿Qué más hiciste en ${current.org}?`)
                                   : t(`What did you do at ${current.org}?`, `¿Qué hiciste en ${current.org}?`)}
        hint={t('One thing at a time, starting with a doing word. Then put a number on it if you can — that is what turns a duty into an achievement.',
                'Una cosa a la vez, empezando con un verbo. Después ponele un número si podés — eso convierte una tarea en un logro.')}
        footer={<>
          <Save disabled={!line} onClick={addLine}>{t('Add this line', 'Agregar esta línea')}</Save>
          {currentLines.length > 0 && <Button onClick={() => setStage('menu')}>{t('Done with this one', 'Listo con esta')}</Button>}
          {currentLines.length === 0 && <Skip onClick={() => setStage('menu')} />}
        </>}
      >
        {currentLines.length > 0 && (
          <ul className="space-y-1.5">
            {currentLines.map((b, i) => (
              <li key={i} className="animate-rise flex gap-2 text-sm text-ink-700">
                <span className="text-brand-500">•</span>
                <span>{b.text}</span>
                {!hasDigit(b.text) && <span className="shrink-0 text-xs text-amber-600">{t('no number', 'sin número')}</span>}
              </li>
            ))}
          </ul>
        )}
        <textarea autoFocus rows={2} className={`${big} resize-none text-base`} value={what} onChange={(e) => setWhat(e.target.value)}
                  placeholder={t('e.g. Served customers and handled the till', 'ej. Atendí clientes y manejé la caja')} />
        <div>
          <Field label={t('Any number for that?', '¿Algún número para eso?')} value={num} onChange={(e) => setNum(e.target.value)}
                 placeholder={t('e.g. about 80 customers a day', 'ej. unos 80 clientes por día')} />
          <p className="mt-1.5 text-xs text-ink-400">{t('Ideas', 'Ideas')}: {NUMBER_IDEAS(t).join(' · ')}</p>
        </div>
        <div className={`rounded-xl border px-4 py-3 text-sm transition ${line ? 'border-brand-200 bg-brand-50/50' : 'border-dashed border-line'}`}>
          {line ? <span className="text-ink-900">• {line}</span>
                : <span className="text-ink-400">{t('Your line appears here as you type.', 'Tu línea aparece acá mientras escribís.')}</span>}
          {line && !hasDigit(line) && (
            <span className="mt-1 block text-xs text-amber-600">{t('Tip: a number makes this stand out.', 'Tip: un número hace que se destaque.')}</span>
          )}
        </div>
      </Question>
    );
  }

  return (
    <Question
      title={t('Anything else to add?', '¿Algo más para agregar?')}
      hint={t('Most first CVs have two to four entries. They appear on the CV in the order you add them, so start with the most recent.',
              'La mayoría de los primeros CVs tienen de dos a cuatro entradas. Aparecen en el orden en que las cargás, así que empezá por la más reciente.')}
      footer={<>
        <Save onClick={onDone}>{t('That’s everything →', 'Eso es todo →')}</Save>
        <Button onClick={() => setStage('place')}>{t('+ Another place or activity', '+ Otro lugar o actividad')}</Button>
      </>}
    >
      <EntryList entries={entries} reload={reload} />
      {entries.some((e) => parseBullets(e.bullets).length === 0) && (
        <p className="text-sm text-amber-700">
          {t('Entries without lines are thin. Click “Add lines” to describe what you did.',
             'Las entradas sin líneas quedan flojas. Tocá “Agregar líneas” para contar qué hiciste.')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {entries.map((e) => (
          <Button key={e.id} variant="soft" onClick={() => { setCurrentId(e.id); setStage('line'); }}>
            {t('Add lines', 'Agregar líneas')}: {e.org}
          </Button>
        ))}
      </div>
    </Question>
  );
}

/* ---------------------------------------------------------------- skills */

export function SkillsQ({ store, reload, onDone }: QProps) {
  const t = useT();
  const [skills, setSkills] = useState(store.profile.skills);
  const [languages, setLanguages] = useState(store.profile.languages);
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', t('native', 'nativo')];
  const save = async () => { await api.saveProfile({ skills: skills.trim(), languages: languages.trim() }); await reload(); onDone(); };

  return (
    <Question
      title={t('Last one: your skills and languages.', 'Última: tus habilidades e idiomas.')}
      hint={t('Concrete things you could be tested on — tools, software, certificates, a till, a forklift licence. Skip “hard-working” and “team player”; show those in your lines instead.',
              'Cosas concretas que te podrían evaluar — herramientas, programas, certificados, manejo de caja, carnet. Evitá “responsable” y “trabajo en equipo”; eso se muestra en tus líneas.')}
      footer={<><Save disabled={!skills.trim() && !languages.trim()} onClick={save} /><Skip onClick={onDone} /></>}
    >
      <Field label={t('Skills and tools, separated by commas', 'Habilidades y herramientas, separadas por comas')} autoFocus value={skills}
             onChange={(e) => setSkills(e.target.value)} placeholder={t('Excel, Canva, cash handling, customer service', 'Excel, Canva, manejo de caja, atención al cliente')} />
      <div>
        <Field label={t('Languages, with your level', 'Idiomas, con tu nivel')} value={languages} onChange={(e) => setLanguages(e.target.value)}
               placeholder={t('Spanish (native), English (B2)', 'Español (nativo), Inglés (B2)')} />
        <p className="mt-1.5 text-xs text-ink-400">{t('Levels', 'Niveles')}: {LEVELS.join(' · ')}</p>
      </div>
    </Question>
  );
}

/* ---------------------------------------------------------------- one line, one number */

/** Used after an upload: one line at a time that has no number, so you can give it one. */
export function NumberQ({ store, reload, onDone, expId, index }: QProps & { expId: number; index: number }) {
  const t = useT();
  const exp = store.experience.find((e) => e.id === expId);
  const bullets = exp ? parseBullets(exp.bullets) : [];
  const [text, setText] = useState(bullets[index]?.text ?? '');
  const missing = !exp || !bullets[index];

  // The line was deleted or edited elsewhere since the list was made: nothing to ask.
  useEffect(() => { if (missing) onDone(); }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!exp || missing) return null;

  const save = async () => {
    const bs = parseBullets(exp.bullets);
    bs[index] = { ...bs[index], text: text.trim() };
    await api.update('experience', exp.id, { bullets: JSON.stringify(bs) });
    await reload();
    onDone();
  };

  return (
    <Question
      title={t('Can you put a number on this?', '¿Le podés poner un número a esto?')}
      hint={<>{t('From', 'De')} <strong className="text-ink-700">{exp.org}</strong>. {t('How many, how much, how often, how big? An honest estimate with “about” is fine.',
             '¿Cuántos, cuánto, cada cuánto, qué tan grande? Una estimación honesta con “unos” está bien.')}</>}
      footer={<><Save disabled={!text.trim()} onClick={save} /><Skip onClick={onDone} /></>}
    >
      <p className="rounded-xl bg-sunken px-4 py-3 text-sm text-ink-500 line-through decoration-ink-400/40">{bullets[index].text}</p>
      <textarea autoFocus rows={3} className={`${big} resize-none text-base`} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="text-xs text-ink-400">{t('Ideas', 'Ideas')}: {NUMBER_IDEAS(t).join(' · ')}</p>
      {hasDigit(text) && <p className="animate-fade text-sm text-brand-700">✓ {t('That has a number now.', 'Ahora tiene un número.')}</p>}
    </Question>
  );
}
