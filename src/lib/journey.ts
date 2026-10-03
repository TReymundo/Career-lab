import type { JourneyStatus } from './api.ts';
import { runChecks } from './cvcheck.ts';
import type { Store } from './types.ts';

/**
 * The four steps the whole app is organised around. Every page belongs to one of them (or to
 * "More"), and each step knows whether it is done and what to say about itself.
 */

type T = (en: string, es: string) => string;

export interface StepState { done: boolean; sub: string }

export const STEPS = [
  { n: 1, to: '/cv', match: ['/cv', '/start', '/profile', '/story'], label: (t: T) => t('My CV', 'Mi CV'),
    title: (t: T) => t('Your CV', 'Tu CV'), blurb: (t: T) => t('Build it once, properly. Everything else is built on it.', 'Armalo una vez, bien. Todo lo demás se construye sobre esto.') },
  { n: 2, to: '/jobs', match: ['/jobs'], label: (t: T) => t('Find jobs', 'Buscar avisos'),
    title: (t: T) => t('Jobs for you', 'Avisos para vos'), blurb: (t: T) => t('Every source in one list, kept to your places, ranked against your CV.', 'Todas las fuentes en una lista, sólo tus lugares, ordenada según tu CV.') },
  { n: 3, to: '/apply', match: ['/apply', '/dashboard', '/documents'], label: (t: T) => t('Apply', 'Postularte'),
    title: (t: T) => t('Apply', 'Postularte'), blurb: (t: T) => t('A CV and a letter written for each job you saved.', 'Un CV y una carta escritos para cada aviso que guardaste.') },
  { n: 4, to: '/track', match: ['/track', '/pipeline'], label: (t: T) => t('Track', 'Seguimiento'),
    title: (t: T) => t('Track', 'Seguimiento'), blurb: (t: T) => t('Where every application stands, and what to do next.', 'Dónde está cada postulación, y qué hacer después.') },
] as const;

export const stepIndex = (pathname: string) => STEPS.findIndex((s) => s.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)));

export function stepStates(store: Store, j: JourneyStatus | null, t: T): StepState[] {
  const checks = runChecks(store).filter((c) => c.level === 'must');
  const passed = checks.filter((c) => c.ok).length;
  const cvMade = store.document.some((d) => d.kind === 'cv' && d.application_id === null) || store.setting['celebrated:cv'] === 'done';
  const started = Boolean(store.profile.name.trim()) || store.experience.length > 0;
  return [
    { done: cvMade, sub: cvMade ? t(`Ready · ${passed}/${checks.length} checks`, `Listo · ${passed}/${checks.length} chequeos`) : started ? t(`${passed} of ${checks.length} checks`, `${passed} de ${checks.length} chequeos`) : t('Start here', 'Empezá acá') },
    { done: Boolean(j && j.jobs.saved > 0), sub: !j ? '…' : j.jobs.total ? t(`${j.jobs.foryou} for you · ${j.jobs.saved} saved`, `${j.jobs.foryou} para vos · ${j.jobs.saved} guardados`) : t('Set up your search', 'Configurá tu búsqueda') },
    { done: Boolean(j && j.apply.tailored > 0), sub: !j ? '…' : j.apply.tailored ? t(`${j.apply.tailored} tailored`, `${j.apply.tailored} adaptados`) : j.apply.saved ? t(`${j.apply.saved} saved to apply to`, `${j.apply.saved} guardados para postularte`) : t('Save jobs first', 'Primero guardá avisos') },
    { done: Boolean(j && j.track.applied > 0), sub: !j ? '…' : j.track.applied ? t(`${j.track.applied} applied · ${j.track.interviewing} interviewing`, `${j.track.applied} postulados · ${j.track.interviewing} entrevistas`) : t('Nothing sent yet', 'Nada enviado todavía') },
  ];
}
