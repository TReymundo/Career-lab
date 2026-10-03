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
      en: 'Education first, dense, one page. What graduate recruiting at banks and finance firms expects from a student.',
      es: 'Formación primero, denso, una página. El orden que esperan los programas de graduados en bancos y firmas financieras.',
    },
  },
  {
    id: 'consulting',
    label: { en: 'Consulting', es: 'Consultoría' },
    note: {
      en: 'Education and results first, leadership given its own weight — what consulting screening reads for.',
      es: 'Formación y resultados primero, liderazgo con peso propio — lo que mira el filtro de consultoría.',
    },
  },
];

const T = {
  profile: { en: 'Profile', es: 'Perfil' },
  experience: { en: 'Professional Experience', es: 'Experiencia profesional' },
  education: { en: 'Education', es: 'Educación' },
  extra: { en: 'Projects & Activities', es: 'Proyectos y actividades' },
  skills: { en: 'Skills', es: 'Habilidades' },
  languages: { en: 'Languages', es: 'Idiomas' },
  present: { en: 'Present', es: 'Actualidad' },
} as const;

/**
 * Which language the CV itself is written in, read from its content rather than from the
 * app's UI setting — a Spanish CV gets Spanish headings even while the app is in English.
 */
export function detectLang(profile: Profile, experience: Experience[]): Lang {
  const text = [profile.headline, profile.summary, profile.skills,
    ...experience.flatMap((e) => [e.title, ...parseBullets(e.bullets).map((b) => b.text)])].join(' ').toLowerCase();
  const es = (text.match(/\b(de|la|el|los|las|y|en|con|para|del|una|por)\b|ción|ñ/g) ?? []).length;
  const en = (text.match(/\b(the|and|of|to|with|for|in|a|an|by|on)\b/g) ?? []).length;
  if (es + en < 6) return profile.languages.toLowerCase().includes('nativ') && /espa|spanish/i.test(profile.languages) ? 'es' : 'en';
  return es > en ? 'es' : 'en';
}

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
  /** A tailored version: accepted rewrites laid over the master CV, which itself is never changed. */
  tailor?: Tailor;
}

export interface Tailor {
  headline?: string;
  summary?: string;
  /** "ENTRY.INDEX" → new wording for that line. */
  lines?: Record<string, string>;
  /** Entry ids, most relevant first. */
  order?: number[];
  /** Entry ids left out of this version. */
  drop?: number[];
  skills?: string;
}

export function buildCV(profile: Profile, experienceIn: Experience[], opts: CVOptions): string {
  const { track, lang, template, tailor } = opts;
  if (tailor) {
    profile = { ...profile, headline: tailor.headline ?? profile.headline, summary: tailor.summary ?? profile.summary, skills: tailor.skills ?? profile.skills };
  }
  // Tailoring: drop, reorder, and swap in reworded lines — on copies, never on the master CV.
  let experience = tailor?.drop?.length ? experienceIn.filter((e) => !tailor.drop!.includes(e.id)) : experienceIn;
  if (tailor?.order?.length) {
    const rank = (id: number) => { const i = tailor.order!.indexOf(id); return i < 0 ? 999 : i; };
    experience = [...experience].sort((a, b) => rank(a.id) - rank(b.id));
  }
  if (tailor?.lines && Object.keys(tailor.lines).length) {
    experience = experience.map((e) => {
      const bs = parseBullets(e.bullets);
      if (!bs.some((_, i) => tailor.lines![`${e.id}.${i}`])) return e;
      return { ...e, bullets: JSON.stringify(bs.map((b, i) => ({ ...b, text: tailor.lines![`${e.id}.${i}`] ?? b.text, es: tailor.lines![`${e.id}.${i}`] ? '' : b.es }))) };
    });
  }
  const max = opts.maxBullets ?? MAX_BULLETS[template];
  const t = (k: keyof typeof T) => T[k][lang];
  const es = lang === 'es';

  const headline = (es && profile.headline_es) || profile.headline;
  const summary = (es && profile.summary_es) || profile.summary;
  const skills = (es && profile.skills_es) || profile.skills;
  const languages = (es && profile.languages_es) || profile.languages;

  /*
   * The layout is the classic one-column CV recruiters expect, written in a few Markdown
   * extensions every renderer here understands (screen, PDF and Word):
   *   ^ text        a centred line
   *   ---           a full-width rule
   *   > text        an italic paragraph
   *   ### a || b    the first row of an entry: bold left, right-aligned b
   *   a || b        any row with a right-aligned part
   */
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
  const head = [
    `# ${profile.name || (es ? 'Tu nombre' : 'Your Name')}`,
    headline && `^ ${oneLine(headline)}`,
    `^ ${[profile.location, profile.linkedin, profile.phone, profile.email].filter(Boolean).join(' • ')}`,
    '---',
    summary && `> ${oneLine(summary)}`,
  ].filter(Boolean).join('\n');

  const entries = (kind: Experience['kind']) => {
    const rows = experience.filter((e) => e.kind === kind);
    if (!rows.length) return '';
    return rows.map((e) => {
      // An ongoing role is written in whichever language the CV is in, however it was typed —
      // and only once there is a start date, or a lone "Present" reads as a mistake.
      // Not for education either, where a lone year is a graduation year, nor when the start
      // field already holds a whole range ("Año de graduación - 2021").
      const end = e.end_date.trim();
      const start = e.start_date.trim();
      const saysPresent = /^(present|current|now|actualidad|actual|presente|hoy)$/i.test(end);
      const ongoing = Boolean(start) && (saysPresent || (!end && kind !== 'education' && !/\s[-–]\s/.test(start)));
      const dates = [e.start_date.trim(), ongoing ? t('present') : end].filter(Boolean).join(' – ');

      // Projects read "What – Where"; jobs and schools read "Where" over "What".
      const projectStyle = kind === 'extra' && e.title.trim() && e.org.trim();
      const lead = projectStyle ? `${e.title.trim()} – ${e.org.trim()}` : (e.org.trim() || e.title.trim());
      const sub = projectStyle || !e.org.trim() ? '' : e.title.trim();
      const loc = e.location.trim();

      const lines = [
        `### **${lead}**${loc ? ` || **${loc}**` : dates ? ` || *${dates}*` : ''}`,
        (sub || (loc && dates)) && `${sub}${loc && dates ? ` || *${dates}*` : ''}`,
        ...bulletsFor(e, track).slice(0, max).map((b) => `- ${(es && b.es) || b.text}`),
      ];
      return lines.filter(Boolean).join('\n');
    }).join('\n\n');
  };

  /** "Data analysis - SQL, Python" per line becomes a bullet with the category in bold. */
  const skillBlock = (raw: string) => {
    const lines = raw.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
    if (lines.length < 2) return raw.trim();
    return lines.map((l) => {
      const m = l.match(/^([^:–-]{2,40}?)\s*[:–-]\s+(.+)$/);
      return m ? `- **${m[1]}** - ${m[2]}` : `- ${l}`;
    }).join('\n');
  };

  const section = (heading: string, body: string) => (body ? `## ${heading}\n\n${body}` : '');

  const parts = ORDER[template].map((s) => {
    switch (s) {
      case 'profile': return ''; // the profile sits under the header, in italics, with no heading
      case 'work': return section(t('experience'), entries('work'));
      case 'education': return section(t('education'), entries('education'));
      case 'extra': return section(t('extra'), entries('extra'));
      case 'skills': return section(t('skills'), skillBlock(skills));
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
  finance: {
    en: {
      why: '[Say why finance, in one honest sentence — what about the work itself appeals to you, not what it pays or what it leads to.]',
      close: 'I would welcome fifteen minutes on the phone to talk about the team and where someone joining can add value early.',
    },
    es: {
      why: '[Decí por qué finanzas, en una frase honesta: qué te atrae del trabajo en sí, no lo que paga ni a dónde lleva.]',
      close: 'Agradecería quince minutos para conversar sobre el equipo y dónde puede aportar alguien que recién se suma.',
    },
  },
  ib: {
    en: {
      why: '[Say why banking specifically — the analysis deciding something real, the pace, the exposure. In your words, not a brochure\u2019s.]',
      close: 'I would be grateful for a short conversation about the group and what the strongest analysts in your class did in their first year.',
    },
    es: {
      why: '[Decí por qué banca de inversión en particular: el análisis que define algo concreto, el ritmo, la exposición. En tus palabras.]',
      close: 'Agradecería una conversación breve sobre el equipo y sobre qué hicieron en su primer año los analistas más fuertes.',
    },
  },
  consulting: {
    en: {
      why: '[Say why consulting — the problem changing every few months, the standard of thinking around you, the range of industries.]',
      close: 'I would appreciate a short conversation about the office and the kind of cases someone with my background tends to be staffed on.',
    },
    es: {
      why: '[Decí por qué consultoría: el problema que cambia cada pocos meses, el nivel de pensamiento estructurado, la variedad de industrias.]',
      close: 'Agradecería una conversación breve sobre la oficina y el tipo de proyectos en los que suele entrar alguien con mi perfil.',
    },
  },
  data: {
    en: {
      why: '[Say why data — what you want the analysis to change, and the kind of question you find worth answering.]',
      close: 'I would welcome a short conversation about the team and the problems it is working on this year.',
    },
    es: {
      why: '[Decí por qué datos: qué querés que cambie el análisis, y qué tipo de pregunta te parece que vale la pena responder.]',
      close: 'Agradecería una conversación breve sobre el equipo y los problemas en los que está trabajando este año.',
    },
  },
  tech: {
    en: {
      why: '[Say why this kind of engineering — what you have built, and what you want to build next that you cannot build alone.]',
      close: 'I would welcome a short conversation about the team, the stack and what a new joiner ships in their first months.',
    },
    es: {
      why: '[Decí por qué este tipo de ingeniería: qué construiste, y qué querés construir después que no podés hacer solo.]',
      close: 'Agradecería una conversación breve sobre el equipo, el stack y qué entrega alguien nuevo en sus primeros meses.',
    },
  },
  product: {
    en: {
      why: '[Say why product or operations — what decision you want to be close to, and why describing it is not enough for you.]',
      close: 'I would welcome a short conversation about the team and the problems it is prioritising this year.',
    },
    es: {
      why: '[Decí por qué producto u operaciones: a qué decisión querés estar cerca, y por qué describirla no te alcanza.]',
      close: 'Agradecería una conversación breve sobre el equipo y los problemas que está priorizando este año.',
    },
  },
  other: {
    en: {
      why: '[Say what draws you to this kind of work, concretely enough that a competitor could not copy the sentence.]',
      close: 'I would welcome a short conversation about the team and the role.',
    },
    es: {
      why: '[Decí qué te atrae de este tipo de trabajo, de forma concreta: algo que otro candidato no podría copiar.]',
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
    summaryHole: '[Two lines on what you bring: what you can already do, the tools you know, what you are finishing or have just finished.]',
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
    summaryHole: '[Dos líneas sobre lo que aportás: qué sabés hacer, qué herramientas manejás, qué estás terminando o acabás de terminar.]',
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
