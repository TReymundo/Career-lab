import { db } from './db.ts';

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
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export function getKey(): string {
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  const row = db.prepare("SELECT value FROM setting WHERE key = 'google_api_key'").get() as { value: string } | undefined;
  return row?.value ?? '';
}

export function keyStatus() {
  const key = getKey();
  return {
    configured: Boolean(key),
    source: process.env.GOOGLE_API_KEY ? 'env' : key ? 'app' : 'none',
    model: MODEL,
    // Never return the key itself — only enough to recognise which one is in use.
    hint: key ? `…${key.slice(-4)}` : '',
  };
}

type Schema = Record<string, unknown>;

interface CallOptions {
  system: string;
  /** When given, the model is constrained to emit JSON matching this shape. */
  schema?: Schema;
  maxTokens?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Google returns 503 when the model is busy and 429 when you are going too fast. Both are
 * temporary and both used to surface as a wall of raw JSON, so they are retried here with a
 * short backoff before anyone is told anything went wrong.
 */
async function callGemini(prompt: string, opts: CallOptions, attempt = 0): Promise<string> {
  const { system, schema, maxTokens = 8192 } = opts;
  const key = getKey();
  if (!key) throw new Error('No Google API key set. Add one in the AI step, or put GOOGLE_API_KEY in your .env file.');

  const res = await fetch(`${ENDPOINT(MODEL)}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: maxTokens,
        // 2.5 models think before answering, and that thinking is billed against the same
        // output budget. Left on, a long review silently truncates and comes back unparseable.
        thinkingConfig: { thinkingBudget: 0 },
        ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && /API key not valid/i.test(body)) throw new Error('That API key was rejected by Google. Check it and try again.');

    if ((res.status === 503 || res.status === 429) && attempt < 2) {
      await sleep(1500 * (attempt + 1));
      return callGemini(prompt, opts, attempt + 1);
    }
    if (res.status === 503) throw new Error('Google’s model is busy right now — that is on their side, not yours. Give it a minute and press the button again.');
    if (res.status === 429) throw new Error('Google is rate-limiting your key. Wait a minute and try again.');
    if (res.status === 403) throw new Error('Google refused the key. Check that the Generative Language API is enabled for it.');
    throw new Error(`Google returned ${res.status}. ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new Error(`Google blocked the request: ${data.promptFeedback.blockReason}`);

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) {
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('The response was cut short. Try again with fewer bullets selected.');
    throw new Error('Google returned an empty response. Try again.');
  }
  return text.trim();
}

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

/** One retry with a blunter instruction, because a single bad roll should not surface as an error. */
async function json<T>(prompt: string, opts: CallOptions): Promise<T> {
  try {
    return parseJson<T>(await callGemini(prompt, opts));
  } catch (e) {
    if (e instanceof Error && e.message !== 'did-not-return-json') throw e;
    const retry = await callGemini(`${prompt}\n\nReturn ONLY the JSON. No explanation, no code fence, nothing before or after it.`, opts);
    try {
      return parseJson<T>(retry);
    } catch {
      throw new Error('The model would not return usable JSON, twice. Try again, or with fewer items selected.');
    }
  }
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

  return json<ExtractedJob[]>(prompt, { system: houseRules(lang), schema: EXTRACT_SCHEMA });
}
