import { db } from './db.ts';
import { generate, providers, type CallOptions } from './llm.ts';

/**
 * Optional AI assistance through Google's Gemini API, using a key you supply.
 *
 * Two ways to provide it, both local to this machine:
 *   - GOOGLE_API_KEY in your .env file (preferred — it never touches the database), or
 *   - pasted into the app, which stores it in your local SQLite file in plain text.
 *
 * Nothing here runs unless you press a button, and every call sends only the text you are
 * working on.
 */

const MODEL = process.env.GOOGLE_MODEL ?? 'gemini-2.5-flash';

export function getKey(): string {
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const row = db.prepare("SELECT value FROM setting WHERE key = 'google_api_key'").get() as { value: string } | undefined;
  return row?.value ?? '';
}

export function keyStatus() {
  const key = getKey();
  return {
    // Any connected AI counts; reading PDFs additionally needs Google (see `google`).
    configured: providers().length > 0,
    google: providers().some((p) => p.kind === 'google'),
    source: process.env.GOOGLE_API_KEY ? 'env' : key ? 'app' : 'none',
    model: MODEL,
    // Never return the key itself — only enough to recognise which one is in use.
    hint: key ? `…${key.slice(-4)}` : '',
  };
}

type Schema = Record<string, unknown>;


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every text request goes through the router in llm.ts: all connected providers and models,
 * rotated on limits, cached. The name is kept because the whole file calls it.
 */
const callGemini = (prompt: string, opts: CallOptions) => generate(prompt, opts);

/** True when any non-Google backup is connected (the jobs screen uses it to offer AI features). */
export const groqConfigured = () => providers().some((p) => p.kind !== 'google');

/** Even with a schema, take a belt-and-braces pass at anything wrapped in prose or fences. */
function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch { /* fall through to the salvage attempt */ }

  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('did-not-return-json');
  const slice = candidate.slice(start);
  try {
    return JSON.parse(slice) as T;
  } catch {
    const end = Math.max(slice.lastIndexOf(']'), slice.lastIndexOf('}'));
    if (end < 0) throw new Error('did-not-return-json');
    return JSON.parse(slice.slice(0, end + 1)) as T;
  }
}

/**
 * JSON answers are checked by the router itself: an answer that does not parse counts as that
 * route failing, so the next model is asked — and the broken answer is never cached.
 */
/**
 * Models other than Gemini do not honour the response schema exactly: a list often comes back
 * wrapped in an object ({"items": [...]}, {"result": [...]}) or as a single bare object. This
 * brings the answer back to the shape the schema asked for, so the caller never sees the
 * difference. An answer that cannot be brought into shape counts as a failure of that model.
 */
function shape(value: unknown, schema?: Record<string, unknown>): unknown {
  if (!schema) return value;
  const wantArray = schema.type === 'array';
  if (wantArray && !Array.isArray(value) && value && typeof value === 'object') {
    const inner = Object.values(value as Record<string, unknown>).find(Array.isArray);
    if (inner) return inner;
    return [value]; // a single item, sent bare
  }
  if (!wantArray && Array.isArray(value) && value.length === 1 && typeof value[0] === 'object') return value[0];
  return value;
}

const fits = (schema?: Record<string, unknown>) => (text: string) => {
  try {
    const v = shape(parseJson(text), schema);
    return schema?.type === 'array' ? Array.isArray(v) : Boolean(v && typeof v === 'object' && !Array.isArray(v));
  } catch { return false; }
};

async function json<T>(prompt: string, opts: CallOptions): Promise<T> {
  const text = await callGemini(`${prompt}\n\nReturn ONLY the JSON.`, { ...opts, validate: fits(opts.schema) });
  return shape(parseJson(text), opts.schema) as T;
}

const LANG_NAME = { en: 'English', es: 'Latin American Spanish (voseo, as used in Argentina and Uruguay)' } as const;
export type Lang = keyof typeof LANG_NAME;

const houseRules = (lang: Lang) => `You help someone write their own CV. Absolute rules:
- Never invent facts, numbers, employers, dates or achievements. You may only work with what the user gives you.
- If something has no number, do not make one up. Leave a bracketed prompt like [how many?] exactly where the number belongs.
- Prefer plain, concrete language. No corporate filler: no "leveraged", "spearheaded", "synergies", "results-driven", "passionate".
- Keep every bullet to one sentence, starting with a strong verb.
- Write ALL of your output in ${LANG_NAME[lang]}, including every explanation and label, regardless of the language of the input.
- Fix spelling, accents and punctuation in names of companies and institutions when they are obviously wrong, but never change what the fact says.`;

export interface BulletSuggestion { original: string; improved: string; why: string; needs: string[] }

const BULLETS_SCHEMA: Schema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      original: { type: 'string' },
      improved: { type: 'string' },
      why: { type: 'string' },
      needs: { type: 'array', items: { type: 'string' } },
    },
    required: ['original', 'improved', 'why', 'needs'],
  },
};

export async function improveBullets(bullets: string[], ctx: { role: string; track: string; lang: Lang }) {
  const prompt = `These are CV bullet points from someone aiming at ${ctx.track || 'a graduate role'}${ctx.role ? ` (target role: ${ctx.role})` : ''}.

Rewrite each one to be sharper and more concrete. Where a bullet has no measurable result, keep it honest and insert a bracketed question asking the user for the missing figure.

Return one object per input bullet, in the same order. "why" is one short sentence on what you changed. "needs" lists any bracketed questions you inserted.

Bullets:
${bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;

  return json<BulletSuggestion[]>(prompt, { system: houseRules(ctx.lang), schema: BULLETS_SCHEMA });
}

export async function writeSummary(input: { headline: string; bullets: string[]; track: string; lang: Lang }) {
  const prompt = `Write a CV profile paragraph of at most 45 words for this person.

What they say about themselves: ${input.headline || '(nothing yet)'}
Target area: ${input.track}
Evidence from their CV:
${input.bullets.slice(0, 12).map((b) => `- ${b}`).join('\n') || '(no bullets yet)'}

It must be specific to this person and contain nothing they have not told you. Return the paragraph only — no preamble, no quotes, no heading.`;

  return callGemini(prompt, { system: houseRules(input.lang), maxTokens: 1024 });
}

export interface Review {
  verdict: string;
  strengths: string[];
  fixes: { problem: string; fix: string; where: string }[];
  missing: string[];
}

const REVIEW_SCHEMA: Schema = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { problem: { type: 'string' }, fix: { type: 'string' }, where: { type: 'string' } },
        required: ['problem', 'fix', 'where'],
      },
    },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'strengths', 'fixes', 'missing'],
};

export async function reviewCV(cv: string, ctx: { track: string; jd?: string; lang: Lang }) {
  const prompt = `Review this CV for someone applying to ${ctx.track || 'graduate roles'}.
${ctx.jd ? `\nThey are targeting this job posting:\n${ctx.jd.slice(0, 3000)}\n` : ''}
Be direct and specific. Point at actual lines. Do not pad with praise. At most six fixes and six missing items.

CV:
${cv.slice(0, 8000)}`;

  return json<Review>(prompt, { system: houseRules(ctx.lang), schema: REVIEW_SCHEMA });
}

/**
 * The editing pass: the model is handed the addressable fields of the CV and returns
 * replacements for specific ones. Every edit is shown to the user before it is written.
 */
export interface FieldEdit { target: string; label: string; from: string; to: string; why: string }

const EDIT_SCHEMA: Schema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      target: { type: 'string' },
      label: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      why: { type: 'string' },
    },
    required: ['target', 'label', 'from', 'to', 'why'],
  },
};

export interface FieldItem { target: string; label: string; value: string }

export async function polishFields(fields: FieldItem[], ctx: { track: string; lang: Lang }) {
  const prompt = `Below are the individual editable fields of a CV, each with an id. The person is applying to ${ctx.track || 'graduate roles'}.

Correct what is genuinely wrong: spelling, missing accents, mangled company or institution names, inconsistent capitalisation, headings that are too long, job titles that are too vague to be useful. Improve weak phrasing where you can do it without inventing anything.

Rules for your output:
- Return an entry ONLY for fields you are actually changing. Leave everything else out.
- "target" must be copied exactly from the id given.
- "label" is the human name of the field, as given.
- "from" is the current value, "to" is your corrected value.
- "why" is at most eight words.
- Never change a number, a date, or the meaning of a fact.

Fields:
${fields.map((f) => `[${f.target}] ${f.label}: ${f.value}`).join('\n')}`;

  return json<FieldEdit[]>(prompt, { system: houseRules(ctx.lang), schema: EDIT_SCHEMA });
}

/**
 * Reads an existing CV into the same shape the rule-based importer produces, but far more
 * reliably, and it can read a PDF directly. Extraction only: it copies, it never improves —
 * improving is a separate, visible step the user chooses later.
 */
export interface ReadCV {
  name: string; headline: string; email: string; phone: string; location: string; linkedin: string;
  summary: string; skills: string; languages: string;
  entries: { kind: 'work' | 'education' | 'extra'; org: string; title: string; location: string; start_date: string; end_date: string; bullets: string[] }[];
}

const S = { type: 'string' };
const READ_SCHEMA: Schema = {
  type: 'object',
  properties: {
    name: S, headline: S, email: S, phone: S, location: S, linkedin: S, summary: S, skills: S, languages: S,
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['work', 'education', 'extra'] },
          org: S, title: S, location: S, start_date: S, end_date: S,
          bullets: { type: 'array', items: S },
        },
        required: ['kind', 'org', 'title', 'location', 'start_date', 'end_date', 'bullets'],
      },
    },
  },
  required: ['name', 'headline', 'email', 'phone', 'location', 'linkedin', 'summary', 'skills', 'languages', 'entries'],
};

export async function readCV(input: { text?: string; file?: { mimeType: string; data: string } }) {
  const prompt = `Extract everything in this CV into the fields of the schema.

Rules:
- Copy what is written. Never invent, improve, translate or summarise. Keep the original language.
- A field the CV does not contain is an empty string.
- "headline": ONLY a short job title the person gives themselves right under their name, at most ten words (e.g. "Data Analyst"). A sentence or paragraph about the person is never the headline — it is the "summary". If there is no short title, leave "headline" empty.
- "summary": the profile / about-me paragraph, if any, copied in full.
- "location": the person's own city and country as written.
- "skills": if the CV groups skills under categories, one category per line as "Category - item, item" (keep each category's name). Otherwise comma-separated.
- "languages": comma-separated, keeping any level given, e.g. "English (C1)".
- "entries": one per job, degree, course, project, club, volunteering role, etc.
  kind "work" = paid jobs and internships, and work-like roles listed under experience; "education" = schools, degrees, courses, certificates; "extra" = projects, activities and everything else.
  "org" is the employer or institution (empty if none is named), "title" the role, qualification or project name, "location" the city of that entry if given.
  Dates as written (e.g. "2022 - 2026 (Previsto)"); "end_date" is empty if it is ongoing.
  "bullets" are the lines describing that entry, copied word for word without the bullet symbol.
${input.text ? `\nCV text:\n${input.text.slice(0, 20000)}` : ''}`;

  const read = await json<ReadCV>(prompt, {
    system: 'You extract data from CVs exactly as written. You never invent, embellish or correct anything.',
    schema: READ_SCHEMA,
    files: input.file ? [input.file] : [],
  });

  // Belt and braces: a paragraph that slipped into the headline belongs in the profile.
  if (read.headline.length > 90) {
    if (!read.summary.trim()) read.summary = read.headline;
    read.headline = '';
  }
  return read;
}

export async function translate(text: string, to: Lang) {
  const prompt = `Translate the following CV text into ${LANG_NAME[to]}.

Write it as a native speaker would write a CV, not as a literal translation. Preserve every number, company name, tool name and bracketed [placeholder] exactly. Return only the translation.

Text:
${text}`;

  return callGemini(prompt, { system: 'You are a professional translator working on CVs. Return only the translation.' });
}

export async function freeform(prompt: string, lang: Lang = 'en') {
  return callGemini(prompt, { system: houseRules(lang) });
}

/**
 * Where to look for jobs, derived from what you have already told the app.
 *
 * This deliberately does NOT produce job postings: a model inventing openings and URLs is
 * how you end up applying to something that does not exist. It produces search terms and
 * company names — the app then fetches the real postings from real boards.
 */
export interface SourcePlan {
  queries: { label: string; keywords: string; location: string }[];
  companies: { name: string; slug: string; why: string; board: boolean }[];
  titles: string[];
}

const SOURCE_SCHEMA: Schema = {
  type: 'object',
  properties: {
    queries: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, keywords: { type: 'string' }, location: { type: 'string' } },
        required: ['label', 'keywords', 'location'],
      },
    },
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          slug: { type: 'string' },
          why: { type: 'string' },
          board: { type: 'boolean' },
        },
        required: ['name', 'slug', 'why', 'board'],
      },
    },
    titles: { type: 'array', items: { type: 'string' } },
  },
  required: ['queries', 'companies', 'titles'],
};

export async function suggestSources(input: {
  cv: string; tracks: string; location: string; keywords: string; lang: Lang;
}) {
  const prompt = `This person is looking for work. Plan where they should look.

Their CV:
${input.cv.slice(0, 4000)}

Areas they are targeting: ${input.tracks || 'not specified'}
Where they are based: ${input.location || 'not specified'}
${input.keywords ? `Things they specifically want included: ${input.keywords}` : ''}

Produce all three of the following. None may be empty.

1. "queries" — 6 to 8 job-board searches, each a realistic keyword string someone would type, plus a location. Vary seniority wording (intern, junior, graduate, analyst, trainee, entry level) and vary the angle: some by role name, some by skill, some by industry. Include at least one remote-friendly search. Write labels in the user's language.
2. "companies" — 10 to 14 real, currently-operating employers who plausibly hire this profile in that location or remotely.
   - Include at least five technology, startup or fintech companies, because only those tend to publish machine-readable job boards.
   - Set "board" to true ONLY for companies you believe post on Greenhouse, Lever or Ashby — typically venture-backed technology companies. Set it to false for banks, consultancies, universities, government and traditional local employers, which run their own careers sites.
   - For "slug", give the lowercase single-word form most likely used in a careers URL (e.g. "Mercado Libre" → "mercadolibre").
   - "why" is at most ten words on why they fit this person.
3. "titles" — REQUIRED, never empty: 8 job titles this person is genuinely qualified to apply for today, given the experience shown. Short titles only, no company names.

Never invent a job posting, a URL, or a vacancy. Only search terms, company names and job titles.`;

  return json<SourcePlan>(prompt, { system: houseRules(input.lang), schema: SOURCE_SCHEMA });
}

/** Pulls structured job rows out of whatever the user pasted. Extraction only, never invention. */
export interface ExtractedJob { company: string; title: string; location: string; url: string; description: string }

const EXTRACT_SCHEMA: Schema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      company: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' },
      url: { type: 'string' }, description: { type: 'string' },
    },
    required: ['company', 'title', 'location', 'url', 'description'],
  },
};

export async function extractJobs(text: string, lang: Lang) {
  const prompt = `Pull every distinct job opening out of the text below. It may be a copied search results page, a single posting, an email, or a messy list.

Rules:
- One object per opening. If the same opening appears twice, return it once.
- Copy values from the text. Never guess a company, a location or a URL that is not there — use an empty string instead.
- "description" is whatever detail the text gives about that specific opening, or an empty string.
- If the text contains no job openings at all, return an empty array.

Text:
${text.slice(0, 12000)}`;

  // Copying, not writing: the house rules would translate titles into the UI language.
  void lang;
  return json<ExtractedJob[]>(prompt, {
    system: 'You extract job postings exactly as written. Never translate, invent, embellish or merge postings. Keep each link exactly as it appears in [brackets] next to the job.',
    schema: EXTRACT_SCHEMA,
  });
}

/** Job titles this person could apply for today — short, in both languages, for the setup chips. */
export async function suggestTitles(cv: string, lang: Lang, aim: { fields?: string[]; experience?: string } = {}) {
  const level = aim.experience === 'none'
    ? 'They have NO work experience: only internships ("pasantía"), trainee and graduate/young-professional programmes ("jóvenes profesionales"), and entry-level assistant or junior roles.'
    : aim.experience === 'experienced'
      ? 'They have a few years of experience: junior and semi-senior roles.'
      : 'They have a little experience: internships, trainee and junior roles.';
  const prompt = `List 12 short job titles this person should search for, as they appear in real job postings in Latin America. Mix Spanish and English (e.g. "Analista financiero Jr", "Data Analyst Jr", "Pasante de finanzas").
${aim.fields?.length ? `They WANT to work in: ${aim.fields.join(', ')}. Every title must be in these fields — even if the CV points somewhere else. Use the CV only to judge level and transferable skills.` : 'Use the CV to decide the field.'}
${level}
Titles only — no company names.

CV:
${cv.slice(0, 4000)}`;
  return json<string[]>(prompt, { system: houseRules(lang), schema: { type: 'array', items: S }, maxTokens: 600 });
}

/**
 * Real tailoring: what this job asks for, what in the CV (and the story bank) proves it, and
 * the concrete edits that make the CV read as written for it. Every edit is a suggestion the
 * person accepts or rejects, addressed by id so it applies exactly.
 */
export interface Tailoring {
  requirements: { text: string; covered: 'yes' | 'partly' | 'no'; evidence: string }[];
  headline: string;
  summary: string;
  edits: { target: string; to: string; why: string }[];
  order: number[];
  drop: number[];
  skills: string;
  gaps: { requirement: string; question: string }[];
  why: string;
}

const TAILOR_SCHEMA: Schema = {
  type: 'object',
  properties: {
    requirements: { type: 'array', items: { type: 'object', properties: { text: S, covered: { type: 'string', enum: ['yes', 'partly', 'no'] }, evidence: S }, required: ['text', 'covered', 'evidence'] } },
    headline: S, summary: S,
    edits: { type: 'array', items: { type: 'object', properties: { target: S, to: S, why: S }, required: ['target', 'to', 'why'] } },
    order: { type: 'array', items: { type: 'integer' } },
    drop: { type: 'array', items: { type: 'integer' } },
    skills: S,
    gaps: { type: 'array', items: { type: 'object', properties: { requirement: S, question: S }, required: ['requirement', 'question'] } },
    why: S,
  },
  required: ['requirements', 'headline', 'summary', 'edits', 'order', 'drop', 'skills', 'gaps', 'why'],
};

export async function tailorCV(input: { cv: string; stories: string; company: string; role: string; jd: string; lang: Lang }) {
  const prompt = `Tailor this person's CV to ONE job, the way a sharp career coach would — not by adding a sentence about the company, but by making the whole CV read as evidence for this role.

THE JOB: ${input.role} at ${input.company}
${input.jd ? `POSTING:\n${input.jd.slice(0, 5000)}` : '(The posting text is not available. Infer the usual requirements for this exact title at this kind of company, and keep them generic and realistic.)'}

THE CV (entries and lines have ids):
${input.cv.slice(0, 7000)}

WHAT THEY TOLD US ABOUT THEMSELVES (true, usable, not yet on the CV):
${input.stories.slice(0, 4000) || '(nothing yet)'}

Return:
1. "requirements": the 6–10 things this job really asks for, most important first. "covered": yes / partly / no based on the CV and the stories. "evidence": the line id(s) or story that proves it, or "" — in one short phrase.
2. "headline": a short headline for the top of the CV, aimed at this role (it may echo the job title only if the person genuinely fits it).
3. "summary": a 2–3 sentence profile written for this job, built ONLY from facts in the CV and the stories.
4. "edits": rewrites of existing lines, so their wording matches what this job values. "target" is "line ENTRY.INDEX" exactly as given (e.g. "line 12.0"). Keep every fact and number; you may reorder words, lead with the result, use the posting's vocabulary for things the person actually did, tighten. NEVER add a tool, number, responsibility or result that is not in the CV or the stories. Only lines that genuinely improve — usually 3–8.
5. "order": entry ids in the order they should appear within their sections (most relevant first).
6. "drop": ids of activity/project entries that are irrelevant to this job and only take space (never education, never the only work entry). Often empty.
7. "skills": the skills line rewritten with the ones this job needs first (only skills they have), groups kept.
8. "gaps": for each requirement marked "no" or "partly" that the person might well have but never mentioned, a short friendly question to ask them (max 3).
9. "why": one sentence, to the person, on what you emphasised.

Everything you write must be in ${LANG_NAME[input.lang]}.`;

  return json<Tailoring>(prompt, { system: houseRules(input.lang), schema: TAILOR_SCHEMA, maxTokens: 6000 });
}

/**
 * The cover letter, written from the person's own stories. Specific beats polished: one real
 * story that matches what the job needs is worth more than any number of adjectives.
 */
export async function writeLetter(input: { cv: string; stories: string; company: string; role: string; jd: string; tailoring: Tailoring; lang: Lang }) {
  const prompt = `Write a cover letter for ${input.role} at ${input.company}.

What the job needs most (from the analysis): ${input.tailoring.requirements.slice(0, 6).map((r) => r.text).join('; ')}
${input.jd ? `Posting:\n${input.jd.slice(0, 3000)}\n` : ''}
The CV:
${input.cv.slice(0, 5000)}

Their own stories (true; use one or two that best prove what this job needs — retell them concretely, with their details and numbers):
${input.stories.slice(0, 4000) || '(none yet — rely on the CV)'}

Rules:
- 220–320 words, 4 short paragraphs, plain text paragraphs separated by blank lines. No header, no address block, no date.
- The FIRST sentence must not contain "applying", "apply", "writing", "postular", "escribo" or the job title — open with something specific and human (what about this company/role pulls them, or a one-line hook from their story). No clichés ("passionate", "add value", "dynamic environment", "I am confident that", "me apasiona").
- No brackets and no placeholders of any kind. If a number is not known, write the sentence without it.
- Never upgrade a fact with adjectives they did not use ("advanced statistics", "expert in", "extensive"): say exactly what they did.
- The middle is one or two real stories from above or the CV, each tied explicitly to something the job needs.
- Honest about level: if they are a student or junior, own it as an asset (learning speed, fresh tools), never pretend to seniority.
- End with a short, confident close and "${input.lang === 'es' ? 'Saludos,' : 'Best regards,'}" followed by their name.
- Never mention romantic relationships, health, family conflict or anything intimate, even if hinted at — frame resilience through what they DID.
- Never invent a fact.
Write it in ${LANG_NAME[input.lang]}.`;

  // Not the house rules: those ask for [bracketed] prompts where numbers are missing, which a letter must never contain.
  const letter = await callGemini(prompt, {
    system: `You write cover letters for real people, in ${LANG_NAME[input.lang]}, from facts they gave you. You never invent facts and never leave placeholders.`,
    maxTokens: 3000,
  });
  return letter.replace(/\s*\[[^\]]{2,120}\]\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * One turn of the "get to know you" interview. The interviewer is a friend, not a recruiter:
 * it reacts to what you said like a person would, keeps what it learned as stories, facts,
 * values and traits, and asks at most one follow-up — the one that turns an anecdote into a
 * story with a result.
 */
export interface StoryItem { kind: 'story' | 'fact' | 'value' | 'trait'; title: string; body: string; shows: string; private: boolean }
export interface InterviewTurn { reaction: string; followUp: string; items: StoryItem[] }

const TURN_SCHEMA: Schema = {
  type: 'object',
  properties: {
    reaction: S,
    followUp: S,
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['story', 'fact', 'value', 'trait'] },
          title: S, body: S, shows: S, private: { type: 'boolean' },
        },
        required: ['kind', 'title', 'body', 'shows', 'private'],
      },
    },
  },
  required: ['reaction', 'followUp', 'items'],
};

export async function interviewTurn(input: { question: string; answer: string; isFollowUp: boolean; known: string; lang: Lang }) {
  const prompt = `You are a warm, curious friend getting to know someone — they are a student or young professional looking for work. You are NOT a recruiter. Talk like a friend from Buenos Aires would${input.lang === 'es' ? ' (voseo, casual Spanish)' : ' (casual English)'}.

You asked: "${input.question}"
They answered: "${input.answer}"

What you already know about them (do not ask again):
${input.known || '(nothing yet)'}

Return:
- "reaction": 1–2 short, genuine sentences reacting to what they said, like a friend would (empathy if it was hard, enthusiasm if it is cool, a light joke if it fits). No therapy-speak, no "great answer".
- "followUp": ${input.isFollowUp ? 'an empty string — move on.' : 'ONE short follow-up question that digs for a concrete story — what happened, what THEY did, what came of it (with a number if possible) — or the feeling/lesson behind it. Empty string if the answer was already complete or they clearly did not want to talk about it.'}
- "items": everything worth remembering from this answer, each as:
  - kind "story": something that happened, with situation → what they did → result. title = 4–8 words. body = 2–4 sentences in third person, keeping every concrete detail and number they gave. Never invent details.
  - kind "fact": a concrete fact (age, languages, instruments, sport, where they live, studies, tools they use…). body = one short sentence.
  - kind "value": something they care about. kind "trait": how they are (as shown by what they said, not flattery).
  - "shows": comma-separated qualities an employer would read into it (e.g. "resilience, discipline, analysis") — empty for facts.
  - "private": true for relationships, romance, family conflict, health, or anything intimate — those help understand the person but must never appear in a document. false otherwise.
  Return an empty list if there is nothing worth keeping.`;

  return json<InterviewTurn>(prompt, {
    system: `You write ALL output in ${LANG_NAME[input.lang]}. You never invent facts about the person.`,
    schema: TURN_SCHEMA,
    maxTokens: 2048,
  });
}

/**
 * The CV's experience, skills, languages and profile, drafted from the interview — so the
 * build-with-me path never needs a form for them. Only what the person said; nothing private.
 */
export interface CVDraft {
  entries: { kind: 'work' | 'extra' | 'education'; org: string; title: string; location: string; start_date: string; end_date: string; bullets: string[] }[];
  skills: string;
  languages: string;
  summary: string;
}

const DRAFT_SCHEMA: Schema = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['work', 'extra', 'education'] },
          org: S, title: S, location: S, start_date: S, end_date: S,
          bullets: { type: 'array', items: S },
        },
        required: ['kind', 'org', 'title', 'location', 'start_date', 'end_date', 'bullets'],
      },
    },
    skills: S, languages: S, summary: S,
  },
  required: ['entries', 'skills', 'languages', 'summary'],
};

export async function draftCVFromInterview(input: { answers: string; existing: string; lang: Lang }) {
  const prompt = `Someone answered open questions in a relaxed interview. Turn what they said into CV content.

ALREADY ON THEIR CV (do not repeat these entries):
${input.existing || '(nothing yet)'}

THE INTERVIEW:
${input.answers.slice(0, 16000)}

Return:
- "entries": every job, internship, freelance gig, family business, volunteering, club role, team captaincy or real project they described that is NOT already on the CV. kind "work" for anything paid or work-like, "extra" for projects/activities/volunteering, "education" only for a course or school not yet on the CV.
  org = where, title = their role or the project's name, location/dates only if they said them (else "").
  bullets = 1–4 CV lines each, starting with a verb, built ONLY from what they said; keep every number and tool they mentioned; if they gave no number, write the line without one. Never invent.
- "skills": concrete skills and tools they mentioned or clearly showed, grouped one group per line as "Category - item, item" (e.g. "Data - Excel, SQL, Power BI"). Empty string if none.
- "languages": languages with level as they described it, e.g. "Spanish (native), English (C1)". Empty string if they did not say.
- "summary": a 2–3 sentence CV profile in third-person-free style ("Business student who…"), built from what they said.
NEVER use anything about romance, relationships, health, family conflict or anything intimate — those stay private.
Many answers were DICTATED through speech recognition, which mishears words. Fix obvious mis-hearings from context before using them (e.g. "district reporting" from a finance student is "risk reporting"; "Jay Pee Morgan" is "J.P. Morgan"; "power by" is "Power BI"), but never invent anything beyond correcting a misheard word.
Write everything in ${LANG_NAME[input.lang]}.`;
  return json<CVDraft>(prompt, { system: houseRules(input.lang), schema: DRAFT_SCHEMA, maxTokens: 6000 });
}

/**
 * Turns interview answers into the story bank — several answers per call, so ten long answers
 * cost three or four requests instead of thirty. Extraction only: nothing invented.
 */
const EXTRACT_STORIES_SCHEMA: Schema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      answer: { type: 'integer' },
      kind: { type: 'string', enum: ['story', 'fact', 'value', 'trait'] },
      title: S, body: S, shows: S, private: { type: 'boolean' },
    },
    required: ['answer', 'kind', 'title', 'body', 'shows', 'private'],
  },
};

export async function extractStories(answers: { n: number; question: string; answer: string }[], known: string, lang: Lang) {
  const prompt = `These are answers someone gave in a relaxed "get to know you" chat. Pull out everything worth remembering, so it can later be used to write their CV and cover letters.

Already known (do not repeat):
${known || '(nothing yet)'}

${answers.map((a) => `ANSWER ${a.n}\nQuestion: ${a.question}\nThey said: ${a.answer}`).join('\n\n')}

Return a list. Each item has "answer" = the number of the answer it came from, and:
- kind "story": something that happened — situation, what they did, what came of it. title = 4–8 words. body = 2–5 sentences in third person (use "they"), keeping every concrete detail, name of place/tool, and number they gave. One item per distinct story — a long answer often holds several.
- kind "fact": a concrete fact (age, city, languages, studies, tools, instruments, sport and how often…). One short sentence.
- kind "value": something they care about or want. kind "trait": how they are, as shown by what they said (not flattery).
- "shows": comma-separated qualities an employer would read into it (e.g. "resilience, discipline, analysis") — empty for facts.
- "private": true for romance/relationships, health, family conflict or anything intimate — those help understand the person but must never appear in a document. false otherwise.
Never invent anything they did not say.
Many answers were DICTATED through speech recognition, which mishears words. Fix obvious mis-hearings from context before using them (e.g. "district reporting" from a finance student is "risk reporting"; "Jay Pee Morgan" is "J.P. Morgan"; "power by" is "Power BI"), but never invent anything beyond correcting a misheard word.
`;
  return json<(StoryItem & { answer: number })[]>(prompt, {
    system: `You write ALL output in ${LANG_NAME[lang]}. You never invent facts about the person.`,
    schema: EXTRACT_STORIES_SCHEMA,
    maxTokens: 6000,
  });
}

/**
 * The fit check: an honest read of a handful of real postings against the CV. It never sees
 * or produces a posting that is not in the list it was given.
 */
export interface FitVerdict { id: number; fit: 'great' | 'good' | 'stretch' | 'no'; why: string; gap: string }

const FIT_SCHEMA: Schema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      fit: { type: 'string', enum: ['great', 'good', 'stretch', 'no'] },
      why: S, gap: S,
    },
    required: ['id', 'fit', 'why', 'gap'],
  },
};

export async function judgeFit(cv: string, jobs: { id: number; title: string; company: string; location: string; description: string }[], lang: Lang) {
  const prompt = `Here is a candidate's CV, then job postings. For EACH posting, judge how well this candidate fits it today.

"fit":
- "great": they meet the core requirements and the level matches.
- "good": a reasonable application; one or two requirements are thin.
- "stretch": possible but clearly under-qualified, or a different field.
- "no": wrong level (e.g. senior), wrong field, or a hard requirement they cannot meet.
"why": one short sentence, specific to this posting, written TO the candidate in the second person ("You have…", "Tenés…") — never "the candidate".
"gap": the single most important thing the posting asks for that the CV does not show, or "" if none.
Return one object per posting, with its id. Be honest; do not flatter.

CV:
${cv.slice(0, 5000)}

Postings:
${jobs.map((j) => `[id ${j.id}] ${j.title} — ${j.company} — ${j.location}\n${j.description.slice(0, 1200)}`).join('\n\n')}`;

  return json<FitVerdict[]>(prompt, { system: houseRules(lang), schema: FIT_SCHEMA });
}

/**
 * Embeddings: a vector per text, so thousands of postings can be ranked against the CV in
 * milliseconds without an AI call each. Vectors are normalised here, because a truncated
 * gemini-embedding-001 vector is not unit length.
 */
export class RateLimited extends Error {
  constructor(public window: 'minute' | 'day') { super(`rate-limited:${window}`); }
}

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;

/**
 * Retrieval mode, not similarity: what you are looking for is the query, each posting is a
 * document. That asymmetry is what this model was trained for, and it ranks noticeably better.
 */
export async function embed(texts: string[], task: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' = 'RETRIEVAL_DOCUMENT', attempt = 0): Promise<number[][]> {
  const key = getKey();
  if (!key) throw new Error('No Google API key set. Add one in the AI step, or put GOOGLE_API_KEY in your .env file.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: text.slice(0, 6000) }] },
        taskType: task,
        outputDimensionality: EMBED_DIM,
      })),
    }),
  });
  if (!res.ok) {
    if (res.status === 503 && attempt < 2) { await sleep(2000); return embed(texts, task, attempt + 1); }
    const body = await res.text();
    // The free tier counts each text, about a hundred a minute: the caller waits and resumes.
    if (res.status === 429) throw new RateLimited(/per ?day|daily/i.test(body) ? 'day' : 'minute');
    throw new Error(`Google embeddings returned ${res.status}. ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  const data = await res.json() as { embeddings?: { values: number[] }[] };
  return (data.embeddings ?? []).map(({ values }) => {
    const n = Math.hypot(...values) || 1;
    return values.map((v) => Math.round((v / n) * 1e4) / 1e4);
  });
}

/**
 * Tailors the CV to one specific posting.
 *
 * It may only rearrange and re-emphasise what the CV already contains, plus name the company
 * and the role — those are facts from the posting. It may not add an achievement, a skill or
 * an interest the person never claimed.
 */
export interface Adaptation {
  summary: string;
  lead: string[];
  why: string;
}

const ADAPT_SCHEMA: Schema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    lead: { type: 'array', items: { type: 'string' } },
    why: { type: 'string' },
  },
  required: ['summary', 'lead', 'why'],
};

export async function adaptCV(input: {
  cv: string; company: string; role: string; jd: string; lang: Lang;
}) {
  const prompt = `Tailor this person's CV to one specific job.

The job: ${input.role} at ${input.company}
${input.jd ? `The posting says:\n${input.jd.slice(0, 2500)}\n` : '(No posting text was saved, so work from the job title and company alone.)'}

Their CV:
${input.cv.slice(0, 5000)}

Return:
- "summary": a profile paragraph of at most 45 words for the top of the CV, written for this job. It may name ${input.company} and the role. Every claim in it must already appear in the CV above. If the CV is thin, keep it short and honest rather than padding it.
- "lead": the two or three lines from their CV, copied word for word, that this employer should see first.
- "why": one sentence on what you emphasised and why, addressed to the candidate.

Invent nothing. No skill, tool, number or interest that is not already in the CV.`;

  return json<Adaptation>(prompt, { system: houseRules(input.lang), schema: ADAPT_SCHEMA });
}
