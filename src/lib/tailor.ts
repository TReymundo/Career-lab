import type { Application, Experience, Lang, Profile, Track } from './types.ts';
import { bulletsFor, keywordGap } from './templates.ts';

/**
 * Everything in this file is deterministic: it reads the posting and your own master CV and
 * rearranges what is already there. It never invents an achievement, because a bullet you
 * cannot defend in the interview is worse than a missing one. Where judgement is needed the
 * output asks you a question instead of guessing.
 */

const has = (text: string, ...needles: string[]) =>
  needles.some((n) => new RegExp(`\\b${n}`, 'i').test(text));

/** Bullets ranked by how much of the posting's vocabulary they already answer. */
export function rankBullets(jd: string, experience: Experience[], track: Track, lang: Lang) {
  const jdWords = new Set((jd.toLowerCase().match(/[a-zà-ÿñ][a-zà-ÿñ+#.]{3,}/g) ?? []));
  const rows: { org: string; text: string; hits: string[] }[] = [];

  for (const e of experience) {
    for (const b of bulletsFor(e, track)) {
      const text = (lang === 'es' && b.es) || b.text;
      const hits = [...new Set(text.toLowerCase().match(/[a-zà-ÿñ][a-zà-ÿñ+#.]{3,}/g) ?? [])]
        .filter((w) => jdWords.has(w));
      rows.push({ org: e.org, text, hits });
    }
  }
  return rows.sort((a, b) => b.hits.length - a.hits.length);
}

const COPY = {
  en: {
    leadWith: 'Lead with these — they already speak the posting’s language',
    noHits: 'None of your bullets overlap this posting yet. That is a signal about the role, not only the CV.',
    addTitle: 'Keywords the posting leans on that your CV never says',
    addHelp: 'For each one: if it is genuinely true of your work, fold it into the closest bullet below. If it is not, leave it out and be ready to say why.',
    closest: 'Closest bullet',
    nothingMissing: 'Your CV already covers the posting’s vocabulary.',
    checklist: 'Before you send',
  },
  es: {
    leadWith: 'Empezá con estos — ya hablan el idioma del aviso',
    noHits: 'Ninguno de tus bullets se cruza con este aviso todavía. Eso dice algo del puesto, no sólo del CV.',
    addTitle: 'Palabras clave del aviso que tu CV nunca dice',
    addHelp: 'Para cada una: si es cierto de tu trabajo, incorporala al bullet más cercano. Si no lo es, dejala afuera y prepará por qué.',
    closest: 'Bullet más cercano',
    nothingMissing: 'Tu CV ya cubre el vocabulario del aviso.',
    checklist: 'Antes de enviar',
  },
} as const;

/** A worksheet: what to lead with, what is missing, and where each missing word would go. */
export function tailoringPlan(app: Application, experience: Experience[], cvText: string, lang: Lang): string {
  const c = COPY[lang];
  const ranked = rankBullets(app.jd, experience, app.track, lang);
  const gaps = keywordGap(app.jd, cvText, 12);
  const withHits = ranked.filter((r) => r.hits.length > 0);

  const lead = withHits.length
    ? withHits.slice(0, 5).map((r) => `- **${r.org}** — ${r.text}\n  *(${r.hits.slice(0, 6).join(', ')})*`).join('\n')
    : `_${c.noHits}_`;

  const missing = gaps.length
    ? gaps.map((g) => {
        const near = ranked.find((r) => r.text.toLowerCase().includes(g.word.slice(0, 4)))
          ?? ranked[0];
        return `- **${g.word}** ×${g.count}\n  ${c.closest}: ${near ? `_${near.text.slice(0, 110)}…_` : '—'}`;
      }).join('\n')
    : `_${c.nothingMissing}_`;

  return [
    `# ${app.company} — ${app.role}`,
    '',
    `## ${c.leadWith}`,
    '',
    lead,
    '',
    `## ${c.addTitle}`,
    '',
    c.addHelp,
    '',
    missing,
  ].join('\n');
}

/** Three sentences. Any longer and a recruiter stops reading on a phone. */
export function coldOutreach(profile: Profile, app: Application, to: string, lang: Lang): string {
  const name = to.trim() || (lang === 'es' ? '[Nombre]' : '[Name]');
  const role = app.role || (lang === 'es' ? '[el puesto]' : '[the role]');
  const company = app.company || (lang === 'es' ? '[la empresa]' : '[the firm]');
  const me = profile.name || (lang === 'es' ? '[tu nombre]' : '[your name]');

  if (lang === 'es') {
    return [
      `Hola ${name}, soy ${me}, estudiante de Gestión de Negocios en el ITBA y actualmente pasante en reporting de riesgos en J.P. Morgan en Buenos Aires.`,
      `Vi la búsqueda de ${role} en ${company} y me interesa particularmente [una razón concreta: la mesa, el equipo, el producto].`,
      `¿Tendrías quince minutos esta semana o la próxima para contarme cómo es el equipo por dentro?`,
      '',
      `— ${me}`,
    ].join('\n');
  }
  return [
    `Hi ${name} — I’m ${me}, a Business Management student at ITBA and currently a risk reporting intern at J.P. Morgan in Buenos Aires.`,
    `I saw the ${role} opening at ${company} and I’m drawn to it specifically because [one concrete reason: the desk, the team, the product].`,
    `Would you have fifteen minutes this week or next to tell me what the team is actually like from the inside?`,
    '',
    `— ${me}`,
  ].join('\n');
}

interface QuestionSet { when: string[]; en: string[]; es: string[] }

/** Technical questions keyed off what the posting actually asks for. */
const TECHNICAL: QuestionSet[] = [
  {
    when: ['sql', 'query', 'database'],
    en: ['Walk me through a query with a window function you have actually written.', 'How would you find duplicate rows in a reporting table, and then prevent them?', 'Inner vs left join — give me a case from your own reporting where the difference changed a number.'],
    es: ['Contame una consulta con window function que hayas escrito de verdad.', '¿Cómo encontrarías filas duplicadas en una tabla de reporting, y cómo las evitarías?', 'Inner vs left join — dame un caso de tu propio reporting donde la diferencia cambió un número.'],
  },
  {
    when: ['python', 'pandas', 'automation', 'automat'],
    en: ['What did you automate, and what broke the first time you ran it in production?', 'How do you validate that an automated report matches the manual one it replaced?'],
    es: ['¿Qué automatizaste, y qué se rompió la primera vez que corrió en producción?', '¿Cómo validás que un reporte automatizado coincide con el manual que reemplazó?'],
  },
  {
    when: ['var', 'risk', 'exposure', 'sensitivit', 'riesgo'],
    en: ['Explain VaR to someone on the sales desk in two sentences, then tell me what it misses.', 'A limit breach appears at 7am. Walk me through your first thirty minutes.', 'What is the difference between historical and parametric VaR, and when does the choice matter?'],
    es: ['Explicá VaR a alguien de la mesa de ventas en dos frases, y después decime qué no captura.', 'Aparece un exceso de límite a las 7am. Contame tus primeros treinta minutos.', '¿Diferencia entre VaR histórico y paramétrico, y cuándo importa la elección?'],
  },
  {
    when: ['trading', 'markets', 'rates', 'fx', 'equit', 'derivativ'],
    en: ['Where are rates now versus six months ago, and what moved them?', 'Pitch me a trade. Any asset, but tell me the risk and where you are wrong.', 'What happens to a bond price when the curve steepens from the long end?'],
    es: ['¿Dónde están las tasas hoy respecto de hace seis meses, y qué las movió?', 'Pitcheame un trade. Cualquier activo, pero decime el riesgo y dónde te podés equivocar.', '¿Qué pasa con el precio de un bono cuando la curva se empina desde el tramo largo?'],
  },
  {
    when: ['valuation', 'dcf', 'model', 'm&a', 'banking', 'comps'],
    en: ['Walk me through a DCF in three minutes.', 'Which is higher, WACC or cost of equity, and why?', 'How does an extra $10m of depreciation flow through the three statements?', 'Why might comparable companies give a higher value than a DCF?'],
    es: ['Contame un DCF en tres minutos.', '¿Qué es más alto, el WACC o el costo del equity, y por qué?', '¿Cómo impactan $10m adicionales de depreciación en los tres estados?', '¿Por qué comparables podría dar un valor más alto que un DCF?'],
  },
  {
    when: ['consult', 'case', 'strategy', 'stakeholder'],
    en: ['Case: a Buenos Aires retailer’s margin fell 4 points in a year. How do you structure it?', 'Estimate the annual market for corporate credit cards in Argentina.', 'Tell me about a time you changed a stakeholder’s mind with analysis.'],
    es: ['Caso: un retailer porteño perdió 4 puntos de margen en un año. ¿Cómo lo estructurás?', 'Estimá el mercado anual de tarjetas corporativas en Argentina.', 'Contame una vez que cambiaste la opinión de un stakeholder con análisis.'],
  },
  {
    when: ['excel', 'vba', 'modelling', 'modeling'],
    en: ['Index-match versus vlookup — why do modellers prefer one?', 'How do you audit a spreadsheet you did not build?'],
    es: ['Index-match versus vlookup — ¿por qué los modeladores prefieren uno?', '¿Cómo auditás una planilla que no construiste vos?'],
  },
];

const BEHAVIOURAL = {
  en: [
    'Why this firm, and why this desk rather than the one next to it?',
    'You are a risk reporting intern applying to a front-office seat. Why should we believe the move?',
    'Tell me about a deadline you nearly missed. What did you do differently the next day?',
    'Describe a mistake in a report that reached someone senior. How did you handle it?',
    'You will be the most junior person in the room. How do you add value in month one?',
    'Tell me about a time you disagreed with someone more senior and were right.',
  ],
  es: [
    '¿Por qué esta firma, y por qué esta mesa y no la de al lado?',
    'Sos pasante en reporting de riesgos y te postulás a front office. ¿Por qué deberíamos creer en el cambio?',
    'Contame una fecha límite que casi no llegaste. ¿Qué hiciste distinto al día siguiente?',
    'Describí un error en un reporte que llegó a alguien senior. ¿Cómo lo manejaste?',
    'Vas a ser el más junior de la sala. ¿Cómo aportás en el primer mes?',
    'Contame una vez que no estuviste de acuerdo con alguien más senior y tenías razón.',
  ],
};

const ASK_THEM = {
  en: [
    'What does the person who succeeds in this seat do in their first ninety days that the average joiner does not?',
    'How much of the work is production versus analysis right now, and where is that heading?',
    'Who would I learn the most from on this team, and how does that happen day to day?',
    'What changed about this role in the last year?',
    'What would make you regret hiring someone into this seat?',
  ],
  es: [
    '¿Qué hace en sus primeros noventa días quien tiene éxito en este puesto, que el resto no hace?',
    '¿Cuánto del trabajo hoy es producción y cuánto análisis, y hacia dónde va eso?',
    '¿De quién aprendería más en este equipo, y cómo sucede eso en el día a día?',
    '¿Qué cambió en este rol durante el último año?',
    '¿Qué te haría lamentar haber contratado a alguien para esta posición?',
  ],
};

const PREP_COPY = {
  en: {
    research: 'Company research — do this yourself, the day before',
    researchHelp: 'The app does not fetch news, so these are the searches worth running and what to write down from each.',
    items: [
      'Latest results or funding round — the headline number and one line on what drove it.',
      'Any news in the last 90 days: leadership changes, a new product, a regulatory story, a layoff.',
      'What the desk or team actually does — find one person on LinkedIn and read their last two years.',
      'The single biggest risk to this business that a thoughtful outsider would name.',
    ],
    technical: 'Technical questions, drawn from this posting',
    behavioural: 'Behavioural — answer in STAR, out loud, timed to 90 seconds',
    star: 'Your STAR stories — write one line each, reuse them across interviews',
    starHelp: 'Pick four from your master CV. Each needs Situation, Task, Action, Result, and the Result needs a number.',
    ask: 'Ask them — pick three, never zero',
    logistics: 'Logistics',
    logisticsItems: ['Confirm the format: in person, video, panel, case.', 'Have the JD open in another tab.', 'Two-minute answer ready to “tell me about yourself”.'],
  },
  es: {
    research: 'Investigación de la empresa — hacelo vos, el día anterior',
    researchHelp: 'La app no trae noticias, así que estas son las búsquedas que vale la pena correr y qué anotar de cada una.',
    items: [
      'Últimos resultados o ronda de financiamiento — el número principal y una línea sobre qué lo explicó.',
      'Novedades de los últimos 90 días: cambios de management, producto nuevo, tema regulatorio, despidos.',
      'Qué hace realmente la mesa o el equipo — encontrá una persona en LinkedIn y leé sus últimos dos años.',
      'El mayor riesgo del negocio que un observador atento señalaría.',
    ],
    technical: 'Preguntas técnicas, derivadas de este aviso',
    behavioural: 'Comportamentales — respondé en STAR, en voz alta, en 90 segundos',
    star: 'Tus historias STAR — una línea cada una, reutilizables entre entrevistas',
    starHelp: 'Elegí cuatro de tu CV maestro. Cada una necesita Situación, Tarea, Acción y Resultado, y el Resultado necesita un número.',
    ask: 'Preguntales — elegí tres, nunca ninguna',
    logistics: 'Logística',
    logisticsItems: ['Confirmá el formato: presencial, video, panel, caso.', 'Tené el aviso abierto en otra pestaña.', 'Respuesta de dos minutos lista para “contame sobre vos”.'],
  },
} as const;

export function interviewPrep(app: Application, experience: Experience[], lang: Lang): string {
  const c = PREP_COPY[lang];
  const jd = `${app.role} ${app.jd}`.toLowerCase();

  const technical = TECHNICAL.filter((q) => has(jd, ...q.when)).flatMap((q) => q[lang]);
  const fallback = lang === 'es'
    ? ['El aviso no menciona herramientas concretas. Preparate igual sobre lo que ya sabés: SQL, Excel, y el reporte que producís todos los días.']
    : ['The posting names no specific tools. Prepare on what you already do anyway: SQL, Excel, and the report you produce daily.'];

  const stories = experience
    .flatMap((e) => bulletsFor(e, app.track).slice(0, 2).map((b) => `- ${e.org}: ${(lang === 'es' && b.es) || b.text}`))
    .slice(0, 6);

  const q = encodeURIComponent(app.company);
  const list = (xs: readonly string[]) => xs.map((x) => `- ${x}`).join('\n');

  return [
    `# ${app.company} — ${app.role}`,
    `*${lang === 'es' ? 'Hoja de preparación' : 'Prep sheet'} · ${new Date().toLocaleDateString(lang === 'es' ? 'es-AR' : 'en-GB')}*`,
    '',
    `## 1. ${c.research}`,
    '',
    c.researchHelp,
    '',
    list(c.items),
    '',
    `[Google News](https://news.google.com/search?q=${q}) · [LinkedIn](https://www.linkedin.com/search/results/companies/?keywords=${q})`,
    '',
    `## 2. ${c.technical}`,
    '',
    list(technical.length ? technical : fallback),
    '',
    `## 3. ${c.behavioural}`,
    '',
    list(BEHAVIOURAL[lang]),
    '',
    `## 4. ${c.star}`,
    '',
    c.starHelp,
    '',
    stories.length ? stories.join('\n') : '- —',
    '',
    `## 5. ${c.ask}`,
    '',
    list(ASK_THEM[lang]),
    '',
    `## 6. ${c.logistics}`,
    '',
    list(c.logisticsItems),
  ].join('\n');
}
