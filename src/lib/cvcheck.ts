import { parseBullets, type Store } from './types.ts';

/**
 * What a good CV has, as checks the app can actually run.
 *
 * Drawn from recruiter eye-tracking studies (the first scan is 6–11 seconds and lands on name,
 * titles, employers, dates and education), ATS formatting guidance, and Argentine job-board
 * advice for first CVs. Each check names the question that fixes it, so the review screen can
 * send you straight there instead of describing the problem.
 */

export type QuestionId = 'name' | 'contact' | 'target' | 'education' | 'experience' | 'skills';

export interface Check {
  id: string;
  ok: boolean;
  /** "must" blocks nothing, but is what a recruiter or a parser would reject on. */
  level: 'must' | 'tip';
  label: (t: T) => string;
  why: (t: T) => string;
  /** Where the fix lives: a question, the numbers pass, the AI polish, or the full CV editor. */
  fix?: QuestionId | 'numbers' | 'polish' | 'profile';
}

type T = (en: string, es: string) => string;

export const hasDigit = (s: string) => /\d/.test(s);

export function bulletRows(store: Store) {
  return store.experience.flatMap((e) =>
    parseBullets(e.bullets).map((b, index) => ({ expId: e.id, index, org: e.org, text: b.text })));
}

export function runChecks(store: Store): Check[] {
  const p = store.profile;
  const edu = store.experience.filter((e) => e.kind === 'education');
  const done = store.experience.filter((e) => e.kind !== 'education');
  const rows = bulletRows(store).filter((r) => done.some((e) => e.id === r.expId));
  const numbered = rows.filter((r) => hasDigit(r.text)).length;

  return [
    {
      id: 'name', level: 'must', ok: Boolean(p.name.trim()), fix: 'name',
      label: (t) => t('Your name', 'Tu nombre'),
      why: (t) => t('The first thing a recruiter reads.', 'Lo primero que lee un reclutador.'),
    },
    {
      id: 'email', level: 'must', ok: Boolean(p.email.trim()), fix: 'contact',
      label: (t) => t('An email address', 'Un email'),
      why: (t) => t('Without it nobody can reply.', 'Sin esto nadie te puede responder.'),
    },
    {
      id: 'phone', level: 'must', ok: Boolean(p.phone.trim()), fix: 'contact',
      label: (t) => t('A phone number', 'Un teléfono'),
      why: (t) => t('Many recruiters call or WhatsApp first.', 'Muchos reclutadores llaman o escriben por WhatsApp primero.'),
    },
    {
      id: 'location', level: 'must', ok: Boolean(p.location.trim()), fix: 'contact',
      label: (t) => t('Your city and country', 'Tu ciudad y país'),
      why: (t) => t('Filters often screen by location. City is enough — never your street address.',
                    'Los filtros suelen buscar por zona. Alcanza con la ciudad — nunca tu dirección.'),
    },
    {
      id: 'headline', level: 'must', ok: Boolean(p.headline.trim()), fix: 'target',
      label: (t) => t('The job you are going for', 'El puesto al que apuntás'),
      why: (t) => t('A headline under your name tells the reader where you fit in one glance.',
                    'Un título debajo de tu nombre le dice al lector dónde encajás de un vistazo.'),
    },
    {
      id: 'education', level: 'must', ok: edu.some((e) => e.org.trim()), fix: 'education',
      label: (t) => t('Your education', 'Tu formación'),
      why: (t) => t('One of the six things recruiters look at first.', 'Una de las seis cosas que los reclutadores miran primero.'),
    },
    {
      id: 'experience', level: 'must', ok: done.some((e) => parseBullets(e.bullets).length > 0), fix: 'experience',
      label: (t) => t('Something you have done, with at least one line', 'Algo que hayas hecho, con al menos una línea'),
      why: (t) => t('Jobs, projects, clubs, tutoring and volunteering all count.',
                    'Trabajos, proyectos, clubes, clases particulares y voluntariado: todo cuenta.'),
    },
    {
      id: 'dates', level: 'must', ok: done.length > 0 && done.every((e) => e.start_date.trim()), fix: 'profile',
      label: (t) => t('Dates on every entry', 'Fechas en cada entrada'),
      why: (t) => t('Recruiters read dates in the first seconds; missing ones look like a gap.',
                    'Los reclutadores miran las fechas en los primeros segundos; si faltan, parece un hueco.'),
    },
    {
      id: 'numbers', level: 'must', ok: rows.length > 0 && numbered / rows.length >= 0.5, fix: 'numbers',
      label: (t) => t(`A number in most lines (${numbered} of ${rows.length})`, `Un número en la mayoría de las líneas (${numbered} de ${rows.length})`),
      why: (t) => t('"Served customers" is a duty. "Served ~80 customers a day" is an achievement.',
                    '"Atendí clientes" es una tarea. "Atendí ~80 clientes por día" es un logro.'),
    },
    {
      id: 'skills', level: 'must', ok: Boolean(p.skills.trim()), fix: 'skills',
      label: (t) => t('Concrete skills and tools', 'Habilidades y herramientas concretas'),
      why: (t) => t('Automatic filters match these words against the job posting.',
                    'Los filtros automáticos comparan estas palabras con el aviso.'),
    },
    {
      id: 'languages', level: 'must', ok: Boolean(p.languages.trim()), fix: 'skills',
      label: (t) => t('Languages, with your level', 'Idiomas, con tu nivel'),
      why: (t) => t('Say the level — "English (B2)" — not just the language.', 'Decí el nivel — "Inglés (B2)" — no sólo el idioma.'),
    },
    {
      id: 'summary', level: 'tip', ok: Boolean(p.summary.trim()), fix: 'polish',
      label: (t) => t('A 2–3 line profile at the top', 'Un perfil de 2–3 líneas arriba'),
      why: (t) => t('About a quarter of a recruiter’s first look goes here. The AI polish can write it from your answers.',
                    'Cerca de un cuarto de la primera mirada va acá. El pulido con IA lo puede escribir a partir de tus respuestas.'),
    },
    {
      id: 'length', level: 'tip', ok: rows.length <= 20, fix: 'profile',
      label: (t) => t('Fits on one page', 'Entra en una página'),
      why: (t) => t('One page unless you have many years of experience. Keep 2–5 lines per entry.',
                    'Una página salvo que tengas muchos años de experiencia. Dejá 2–5 líneas por entrada.'),
    },
  ];
}
