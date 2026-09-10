import type { Application, Experience, Lang, Profile, Track } from './types.ts';
import { parseBullets } from './types.ts';

/** Bullets with no track tags are universal; tagged ones only surface for their track. */
export function bulletsFor(exp: Experience, track: Track) {
  return parseBullets(exp.bullets).filter((b) => b.tracks.length === 0 || b.tracks.includes(track));
}

export type TemplateId = 'ats' | 'banking' | 'consulting';

export const TEMPLATES: { id: TemplateId; label: Record<Lang, string>; note: Record<Lang, string> }[] = [
  {
    id: 'ats',
    label: { en: 'Classic / ATS-safe', es: 'Clásico / apto ATS' },
    note: {
      en: 'Plain single column, no tables or columns a parser can mangle. Use it for any online application form.',
      es: 'Una sola columna, sin tablas ni columnas que un lector automático pueda romper. Úsalo en cualquier formulario online.',
    },
  },
  {
    id: 'banking',
    label: { en: 'Banking & Markets', es: 'Banca y Mercados' },
    note: {
      en: 'Education first, dense, one page. The order graduate recruiting at banks expects from a student.',
      es: 'Formación primero, denso, una página. El orden que espera el reclutamiento de graduados en bancos.',
    },
  },
  {
    id: 'consulting',
    label: { en: 'Consulting', es: 'Consultoría' },
    note: {
      en: 'Education and results first, leadership given its own weight — what MBB screening reads for.',
      es: 'Formación y resultados primero, liderazgo con peso propio — lo que mira el filtro de MBB.',
    },
  },
];

const T = {
  profile: { en: 'Profile', es: 'Perfil' },
  experience: { en: 'Experience', es: 'Experiencia profesional' },
  education: { en: 'Education', es: 'Formación académica' },
  extra: { en: 'Leadership & Extracurricular', es: 'Liderazgo y actividades' },
  skills: { en: 'Skills', es: 'Competencias y herramientas' },
  languages: { en: 'Languages', es: 'Idiomas' },
  present: { en: 'Present', es: 'Actualidad' },
} as const;

const ORDER: Record<TemplateId, ('profile' | 'work' | 'education' | 'extra' | 'skills' | 'languages')[]> = {
  ats: ['profile', 'work', 'education', 'extra', 'skills', 'languages'],
  banking: ['profile', 'education', 'work', 'extra', 'skills', 'languages'],
  consulting: ['profile', 'education', 'work', 'extra', 'skills', 'languages'],
};

const MAX_BULLETS: Record<TemplateId, number> = { ats: 5, banking: 4, consulting: 4 };

export interface CVOptions {
  track: Track;
  lang: Lang;
  template: TemplateId;
  maxBullets?: number;
}

export function buildCV(profile: Profile, experience: Experience[], opts: CVOptions): string {
  const { track, lang, template } = opts;
  const max = opts.maxBullets ?? MAX_BULLETS[template];
  const t = (k: keyof typeof T) => T[k][lang];
  const es = lang === 'es';

  const headline = (es && profile.headline_es) || profile.headline;
  const summary = (es && profile.summary_es) || profile.summary;
  const skills = (es && profile.skills_es) || profile.skills;
  const languages = (es && profile.languages_es) || profile.languages;

  const head = [
    `# ${profile.name || (es ? 'Tu nombre' : 'Your Name')}`,
    [headline, profile.location].filter(Boolean).join(' · '),
    [profile.email, profile.phone, profile.linkedin].filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n');

  const entries = (kind: Experience['kind']) => {
    const rows = experience.filter((e) => e.kind === kind);
    if (!rows.length) return '';
    return rows.map((e) => {
      // An ongoing role is written in whichever language the CV is in, however it was typed.
      const ongoing = !e.end_date.trim() || /^(present|current|now|actualidad|actual|presente|hoy)$/i.test(e.end_date.trim());
      const dates = [e.start_date, ongoing ? t('present') : e.end_date].filter(Boolean).join(' – ');
      const header = `**${e.org}**${e.title ? ` — ${e.title}` : ''}${e.location ? `, ${e.location}` : ''}`
        + (dates ? `  \n*${dates}*` : '');
      const bs = bulletsFor(e, track).slice(0, max)
        .map((b) => `- ${(es && b.es) || b.text}`).join('\n');
      return [header, bs].filter(Boolean).join('\n');
    }).join('\n\n');
  };

  const section = (heading: string, body: string) => (body ? `## ${heading}\n\n${body}` : '');

  const parts = ORDER[template].map((s) => {
    switch (s) {
      case 'profile': return section(t('profile'), summary);
      case 'work': return section(t('experience'), entries('work'));
      case 'education': return section(t('education'), entries('education'));
      case 'extra': return section(t('extra'), entries('extra'));
      case 'skills': return section(t('skills'), skills);
      case 'languages': return section(t('languages'), languages);
    }
  });

  return [head, ...parts].filter(Boolean).join('\n\n');
}

/** Bullets that would go on a Spanish CV but have no Spanish text yet. */
export function missingTranslations(experience: Experience[], track: Track) {
  const out: { org: string; text: string }[] = [];
  for (const e of experience) {
    for (const b of bulletsFor(e, track)) {
      if (!b.es?.trim()) out.push({ org: e.org, text: b.text });
    }
  }
  return out;
}

interface CoverInput {
  profile: Profile;
  app: Application;
  lang: Lang;
  hook: string;
  proof: string;
  contact: string;
}

const TRACK_PITCH: Record<Track, Record<Lang, { why: string; close: string }>> = {
  markets: {
    en: {
      why: 'I want to be on a trading floor because the feedback loop is immediate and the work is decided in real time — the opposite of the monthly reporting cycle I know well enough to want to leave behind.',
      close: 'I would welcome the chance to spend fifteen minutes on the phone talking about the desk and where a graduate can add value from day one.',
    },
    es: {
      why: 'Quiero estar en una mesa de operaciones porque la devolución es inmediata y las decisiones se toman en tiempo real — lo contrario del ciclo mensual de reporting que conozco lo suficiente como para querer dejarlo atrás.',
      close: 'Agradecería quince minutos para conversar sobre la mesa y sobre dónde puede aportar un graduado desde el primer día.',
    },
  },
  ib: {
    en: {
      why: 'Banking appeals to me because the analysis actually decides something — a price, a structure, a deal that either clears or does not — and I want to build that judgement early, alongside people who do it at scale.',
      close: 'I would be grateful for a short conversation about the group and what the strongest analysts in your class did in their first year.',
    },
    es: {
      why: 'La banca de inversión me atrae porque el análisis define algo concreto — un precio, una estructura, una operación que cierra o no — y quiero construir ese criterio temprano, junto a gente que lo hace a escala.',
      close: 'Agradecería una conversación breve sobre el equipo y sobre qué hicieron en su primer año los analistas más fuertes de su promoción.',
    },
  },
  consulting: {
    en: {
      why: 'Consulting attracts me because the problem changes every few months and the standard of structured thinking is set by the people around you. My degree at ITBA has been exactly that exercise, and I want to do it against real client stakes.',
      close: 'I would appreciate a short conversation about the office and the kind of cases a joiner from a finance background tends to be staffed on.',
    },
    es: {
      why: 'La consultoría me atrae porque el problema cambia cada pocos meses y el nivel de pensamiento estructurado lo marca la gente que tenés al lado. Mi carrera en el ITBA fue exactamente ese ejercicio, y quiero hacerlo con un cliente real en juego.',
      close: 'Agradecería una conversación breve sobre la oficina y sobre el tipo de proyectos en los que suele entrar alguien con perfil financiero.',
    },
  },
  product: {
    en: {
      why: 'I want to sit closer to the decision than reporting allows — where the data I already produce becomes the argument for what the business should actually do next.',
      close: 'I would welcome a short conversation about the team and the problems it is prioritising this year.',
    },
    es: {
      why: 'Quiero estar más cerca de la decisión de lo que permite el reporting — donde los datos que ya produzco se convierten en el argumento de qué debería hacer el negocio.',
      close: 'Agradecería una conversación breve sobre el equipo y sobre los problemas que está priorizando este año.',
    },
  },
  other: {
    en: {
      why: 'I am looking for a role where the analysis I do changes a decision rather than describing one after the fact.',
      close: 'I would welcome a short conversation about the team and the role.',
    },
    es: {
      why: 'Busco un rol donde el análisis que hago cambie una decisión, en lugar de describirla después de tomada.',
      close: 'Agradecería una conversación breve sobre el equipo y la posición.',
    },
  },
};

const COVER_COPY = {
  en: {
    intro: (role: string, company: string) => `I am writing to apply for the ${role} position at ${company}.`,
    introRef: (role: string, company: string, who: string) =>
      `I am writing to apply for the ${role} position at ${company}, following my conversation with ${who}.`,
    dear: 'Dear Hiring Team,',
    sign: 'Kind regards,',
    hookHole: (company: string) =>
      `[One specific, non-generic reason you want ${company} in particular — a desk, a deal, a person, a product.]`,
    proofHole: '[Your strongest concrete story: the situation, what you personally did, and the number or outcome that resulted. One paragraph, no adjectives you cannot defend.]',
    summaryHole: '[Two lines on what you bring: the technical base, the languages, the degree finishing this year.]',
  },
  es: {
    intro: (role: string, company: string) => `Me dirijo a ustedes para postularme a la posición de ${role} en ${company}.`,
    introRef: (role: string, company: string, who: string) =>
      `Me dirijo a ustedes para postularme a la posición de ${role} en ${company}, tras mi conversación con ${who}.`,
    dear: 'Estimado equipo de selección:',
    sign: 'Saludos cordiales,',
    hookHole: (company: string) =>
      `[Una razón concreta y no genérica por la que querés ${company} en particular — una mesa, una operación, una persona, un producto.]`,
    proofHole: '[Tu mejor historia concreta: la situación, qué hiciste vos, y el número o resultado que salió de ahí. Un párrafo, sin adjetivos que no puedas defender.]',
    summaryHole: '[Dos líneas sobre lo que aportás: la base técnica, los idiomas, la carrera que terminás este año.]',
  },
} as const;

export function buildCover({ profile, app, lang, hook, proof, contact }: CoverInput): string {
  const pitch = (TRACK_PITCH[app.track] ?? TRACK_PITCH.other)[lang];
  const c = COVER_COPY[lang];
  const company = app.company || '[Company]';
  const role = app.role || '[Role]';
  const summary = (lang === 'es' && profile.summary_es) || profile.summary;

  return [
    profile.name,
    [profile.email, profile.phone, profile.linkedin].filter(Boolean).join(' · '),
    '',
    `${company} — ${role}`,
    '',
    c.dear,
    '',
    `${contact ? c.introRef(role, company, contact) : c.intro(role, company)} ${hook || c.hookHole(company)}`,
    '',
    pitch.why,
    '',
    proof || c.proofHole,
    '',
    summary || c.summaryHole,
    '',
    pitch.close,
    '',
    c.sign,
    profile.name || '[…]',
  ].join('\n');
}

const STOP = new Set(('a an and are as at be by for from has have in is it its of on or that the to with will you your we our their they '
  + 'this these those who whom which what when where how role team work working experience candidate candidates ability able strong excellent '
  + 'good great new all any more most other such using use used within across including include includes must should may can '
  + 'de la el los las un una unos unas y o en con por para que se su sus del al es son ser como más este esta estos estas '
  + 'sobre entre desde hasta cuando donde quien cual sera será puesto equipo trabajo experiencia').split(' '));

/** Rough JD-vs-CV keyword gap: what the posting leans on that your document never says. */
export function keywordGap(jd: string, cv: string, limit = 14): { word: string; count: number }[] {
  if (!jd.trim()) return [];
  const words = (s: string) => s.toLowerCase().match(/[a-zà-ÿñ][a-zà-ÿñ+#.]{2,}/g) ?? [];
  const cvWords = new Set(words(cv));
  const counts = new Map<string, number>();
  for (const w of words(jd)) {
    if (STOP.has(w) || cvWords.has(w) || w.length < 4) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

/**
 * How well a posting matches what you can already evidence: the share of the posting's
 * distinctive words that appear somewhere in your master CV. Blunt on purpose — it ranks
 * a long list, it does not judge a single job.
 */
export function matchScore(jobText: string, cvText: string): number {
  const words = (s: string) => s.toLowerCase().match(/[a-zà-ÿñ][a-zà-ÿñ+#.]{2,}/g) ?? [];
  const jd = [...new Set(words(jobText))].filter((w) => w.length >= 4 && !STOP.has(w));
  if (jd.length === 0) return 0;
  const mine = new Set(words(cvText));
  return Math.round((jd.filter((w) => mine.has(w)).length / jd.length) * 100);
}

/** Anything still bracketed is a hole you have to fill before sending. */
export const openPlaceholders = (text: string) => text.match(/\[[^\]\n]{3,}\]/g) ?? [];
