import { db } from './db.ts';

/**
 * Optional AI assistance through Google's Gemini API, using a key you supply.
 *
 * Two ways to provide it, both local to this machine:
 *   - GOOGLE_API_KEY in your .env file (preferred — it never touches the database), or
 *   - pasted into the app, which stores it in your local SQLite file in plain text.
 *
 * Nothing here runs unless you press a button. Every call sends only the text you are
 * working on: a bullet, a summary, a job description. It is never called in the background
 * and there is no usage of it anywhere else in the app.
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

async function generate(prompt: string, system: string): Promise<string> {
  const key = getKey();
  if (!key) throw new Error('No Google API key set. Add one in the AI step, or put GOOGLE_API_KEY in your .env file.');

  const res = await fetch(`${ENDPOINT(MODEL)}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && /API key not valid/i.test(body)) throw new Error('That API key was rejected by Google. Check it and try again.');
    if (res.status === 429) throw new Error('Google rate-limited the request. Wait a minute and try again.');
    throw new Error(`Google returned ${res.status}. ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new Error(`Google blocked the request: ${data.promptFeedback.blockReason}`);

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error('Google returned an empty response.');
  return text.trim();
}

/** Models like to wrap JSON in prose or fences; take the first array or object we can parse. */
function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('The model did not return JSON.');
  const slice = candidate.slice(start);
  try {
    return JSON.parse(slice) as T;
  } catch {
    const lastArray = slice.lastIndexOf(']');
    const lastObject = slice.lastIndexOf('}');
    const end = Math.max(lastArray, lastObject);
    if (end < 0) throw new Error('The model did not return JSON.');
    return JSON.parse(slice.slice(0, end + 1)) as T;
  }
}

const HOUSE_RULES = `You help someone write their own CV. Absolute rules:
- Never invent facts, numbers, employers, dates or achievements. You may only rewrite what the user gives you.
- If a bullet has no number, do not make one up. Instead, ask the user for the specific figure by leaving a bracketed prompt like [how many?] exactly where the number belongs.
- Prefer plain, concrete language. No corporate filler: no "leveraged", "spearheaded", "synergies", "results-driven", "passionate".
- Keep every bullet to one sentence, starting with a strong past-tense verb (or present tense if the role is current).
- Write in the same language as the input.`;

export interface BulletSuggestion {
  original: string;
  improved: string;
  why: string;
  needs: string[];
}

export async function improveBullets(bullets: string[], context: { role: string; track: string; lang: string }) {
  const prompt = `Here are CV bullet points from someone aiming at ${context.track || 'a graduate role'}${context.role ? ` (target role: ${context.role})` : ''}.

Rewrite each one to be sharper and more concrete, following the rules exactly. Where a bullet lacks a measurable result, keep the sentence honest and insert a bracketed question asking the user for the missing figure.

Return ONLY a JSON array, one object per input bullet, in the same order:
[{"original": "...", "improved": "...", "why": "one short sentence on what you changed and why", "needs": ["any bracketed questions you inserted"]}]

Bullets:
${bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;

  const raw = await generate(prompt, HOUSE_RULES);
  return extractJson<BulletSuggestion[]>(raw);
}

export async function writeSummary(input: { headline: string; bullets: string[]; track: string; lang: string }) {
  const prompt = `Write a CV profile paragraph of at most 45 words for this person, in ${input.lang === 'es' ? 'Spanish' : 'English'}.

What they say about themselves: ${input.headline || '(nothing yet)'}
Target area: ${input.track}
Evidence from their CV:
${input.bullets.slice(0, 12).map((b) => `- ${b}`).join('\n') || '(no bullets yet)'}

It must be specific to this person and contain nothing they have not told you. Return the paragraph only, no preamble, no quotes.`;

  return generate(prompt, HOUSE_RULES);
}

export interface Review {
  verdict: string;
  strengths: string[];
  fixes: { problem: string; fix: string; where: string }[];
  missing: string[];
}

export async function reviewCV(cv: string, context: { track: string; jd?: string }) {
  const prompt = `Review this CV for someone applying to ${context.track || 'graduate roles'}.
${context.jd ? `\nThey are targeting this job posting:\n${context.jd.slice(0, 3000)}\n` : ''}
Be direct and specific. Point at actual lines. Do not pad with praise.

Return ONLY JSON:
{"verdict":"two sentences, honest","strengths":["..."],"fixes":[{"problem":"what is wrong, quoting the line","fix":"the concrete change to make","where":"which section"}],"missing":["things a reviewer would expect to see and cannot find"]}

CV:
${cv.slice(0, 8000)}`;

  const raw = await generate(prompt, HOUSE_RULES);
  return extractJson<Review>(raw);
}

export async function translate(text: string, to: 'es' | 'en') {
  const prompt = `Translate the following CV text into ${to === 'es' ? 'natural Latin American Spanish (voseo where natural, as used in Argentina and Uruguay)' : 'natural British English'}.

Keep it as a CV would be written by a native speaker — not a literal translation. Preserve every number, company name, tool name and bracketed [placeholder] exactly. Return only the translation.

Text:
${text}`;

  return generate(prompt, 'You are a professional translator working on CVs. Return only the translation.');
}

export async function freeform(prompt: string) {
  return generate(prompt, HOUSE_RULES);
}
