import type { Lang, Track } from './types.ts';

/**
 * The questions graduate application forms actually ask, in the order they usually ask them.
 * You write each answer once and adapt it per firm — that is where the hours go, not the CV.
 */

export interface StandardQuestion {
  slug: string;
  en: string;
  es: string;
  limit: number;          // typical word limit on the form
  perFirm: boolean;       // true when the answer must be rewritten for every company
  coach: { en: string; es: string };
  tracks?: Track[];
}

export const QUESTIONS: StandardQuestion[] = [
  {
    slug: 'why-firm',
    en: 'Why do you want to work for this firm?',
    es: '¿Por qué querés trabajar en esta empresa?',
    limit: 300,
    perFirm: true,
    coach: {
      en: 'Name something only this firm has: a desk, a deal, a client, a person you spoke to. If your answer would survive a find-and-replace of the company name, it is not an answer yet.',
      es: 'Nombrá algo que sólo tenga esta firma: una mesa, una operación, un cliente, alguien con quien hablaste. Si tu respuesta sobrevive a un buscar-y-reemplazar del nombre, todavía no es una respuesta.',
    },
  },
  {
    slug: 'why-division',
    en: 'Why this division or programme rather than another?',
    es: '¿Por qué esta división o programa y no otro?',
    limit: 300,
    perFirm: true,
    coach: {
      en: 'Show you know the difference. Say what the work is day to day, and what specifically attracts you to it over the neighbouring desk you also considered.',
      es: 'Demostrá que conocés la diferencia. Contá cómo es el trabajo día a día y qué te atrae de él frente a la mesa de al lado que también consideraste.',
    },
  },
  {
    slug: 'why-you',
    en: 'Why should we choose you?',
    es: '¿Por qué deberíamos elegirte a vos?',
    limit: 250,
    perFirm: false,
    coach: {
      en: 'Three claims, each with evidence and a number. Nothing you could not defend in a follow-up question.',
      es: 'Tres afirmaciones, cada una con evidencia y un número. Nada que no puedas defender ante una repregunta.',
    },
  },
  {
    slug: 'leadership',
    en: 'Describe a time you led a team or took initiative.',
    es: 'Contá una vez que lideraste un equipo o tomaste la iniciativa.',
    limit: 250,
    perFirm: false,
    coach: {
      en: 'STAR. The Action is where the marks are — say what *you* did, not what the team did. End on a result with a number.',
      es: 'STAR. La acción es donde están los puntos — contá qué hiciste *vos*, no el equipo. Cerrá con un resultado con número.',
    },
  },
  {
    slug: 'failure',
    en: 'Tell us about a time you failed or made a mistake.',
    es: 'Contanos una vez que fallaste o cometiste un error.',
    limit: 250,
    perFirm: false,
    coach: {
      en: 'Pick a real one with a real cost, own it in the first sentence, and spend most of the answer on what you changed afterwards. A disguised humblebrag reads as evasion.',
      es: 'Elegí uno real con un costo real, asumilo en la primera frase, y dedicá la mayor parte a qué cambiaste después. Un falso defecto se lee como evasión.',
    },
  },
  {
    slug: 'achievement',
    en: 'What is your greatest achievement?',
    es: '¿Cuál es tu mayor logro?',
    limit: 250,
    perFirm: false,
    coach: {
      en: 'It does not have to be work. It has to be something you drove, that was hard, and that you can quantify.',
      es: 'No tiene que ser laboral. Tiene que ser algo que impulsaste vos, que fue difícil, y que puedas cuantificar.',
    },
  },
  {
    slug: 'teamwork',
    en: 'Describe working with a difficult person or a conflict in a team.',
    es: 'Describí un conflicto en un equipo o el trabajo con alguien difícil.',
    limit: 250,
    perFirm: false,
    coach: {
      en: 'Do not villainise anyone. Show that you understood their position before you moved, and say what the working relationship looked like afterwards.',
      es: 'No demonices a nadie. Mostrá que entendiste su posición antes de actuar, y contá cómo quedó la relación después.',
    },
  },
  {
    slug: 'pressure',
    en: 'A time you worked under pressure or to a hard deadline.',
    es: 'Una vez que trabajaste bajo presión o con una fecha límite dura.',
    limit: 250,
    perFirm: false,
    coach: {
      en: 'An exam week, a launch, a shift, a deadline at work — all fine. Say what you did to protect the deadline, not just that you met it.',
      es: 'Una semana de finales, un lanzamiento, un turno, una entrega en el trabajo — todo sirve. Contá qué hiciste para proteger la fecha, no sólo que la cumpliste.',
    },
  },
  {
    slug: 'strength-weakness',
    en: 'What is your greatest strength and your greatest weakness?',
    es: '¿Cuál es tu mayor fortaleza y tu mayor debilidad?',
    limit: 200,
    perFirm: false,
    coach: {
      en: 'The weakness must be a real cost to you, with the specific thing you now do about it. "I work too hard" fails.',
      es: 'La debilidad tiene que costarte algo real, con lo concreto que hacés al respecto. “Trabajo demasiado” no sirve.',
    },
  },
  {
    slug: 'market-view',
    en: 'What market or company are you following, and what is your view?',
    es: '¿Qué mercado o empresa seguís, y cuál es tu visión?',
    limit: 300,
    perFirm: false,
    tracks: ['finance', 'ib'],
    coach: {
      en: 'Have a position, not a summary. Name the level, what moved it, what you think happens next, and what would prove you wrong.',
      es: 'Tené una posición, no un resumen. Nombrá el nivel, qué lo movió, qué creés que pasa después, y qué te probaría equivocado.',
    },
  },
  {
    slug: 'motivation',
    en: 'Anything else you want us to know / open motivation statement.',
    es: 'Algo más que quieras contarnos / carta de motivación abierta.',
    limit: 400,
    perFirm: true,
    coach: {
      en: 'Use it for the thing your CV cannot show: why you want this kind of work, in your own words, especially if your background points somewhere else.',
      es: 'Usalo para lo que el CV no puede mostrar: por qué querés este tipo de trabajo, en tus palabras, sobre todo si tu perfil apunta a otro lado.',
    },
  },
];

export const questionText = (q: StandardQuestion, lang: Lang) => (lang === 'es' ? q.es : q.en);
export const coachText = (q: StandardQuestion, lang: Lang) => (lang === 'es' ? q.coach.es : q.coach.en);
export const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
