import { createHash } from 'node:crypto';
import { db } from './db.ts';

/**
 * One way to ask an AI anything, over every free provider you have connected.
 *
 * Free tiers fail in two ways — "busy right now" and "too many this minute/day" — and a single
 * key fails with them. So every request walks a list: each Google key × each Gemini model it
 * can use (every model has its own separate free quota), then Groq, GitHub Models, Mistral and
 * OpenRouter. A route that fails with a limit is put to rest for a while and the next one
 * answers. Answers are cached, so the same question is never paid for twice.
 *
 * Keys live in this machine's database and are never sent back to the browser.
 */

type Schema = Record<string, unknown>;
export interface CallOptions {
  system: string;
  schema?: Schema;
  maxTokens?: number;
  files?: { mimeType: string; data: string }[];
  /** When given, an answer that fails this check counts as a failure of that route: the next one is tried. */
  validate?: (text: string) => boolean;
}

export type ProviderKind = 'google' | 'groq' | 'github' | 'mistral' | 'openrouter';
export interface Provider { id: string; kind: ProviderKind; key: string; label?: string }

/** OpenAI-compatible providers: where to send, and which free model to use. */
const OPENAI_LIKE: Record<Exclude<ProviderKind, 'google'>, { url: string; models: string[]; name: string }> = {
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'] },
  github: { name: 'GitHub Models', url: 'https://models.github.ai/inference/chat/completions', models: ['openai/gpt-4.1-mini', 'openai/gpt-4o-mini'] },
  mistral: { name: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', models: ['mistral-small-latest'] },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', models: ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3.1:free'] },
};
export const KIND_NAME: Record<ProviderKind, string> = { google: 'Google Gemini', groq: 'Groq', github: 'GitHub Models', mistral: 'Mistral', openrouter: 'OpenRouter' };

/* ------------------------------------------------------------------ providers */

const getSetting = (k: string) => (db.prepare('SELECT value FROM setting WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? '';
const putSetting = (k: string, v: string) =>
  db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

/** Everything connected: the original Google key and Groq key from earlier versions included. */
export function providers(): Provider[] {
  let list: Provider[] = [];
  try { list = JSON.parse(getSetting('ai_providers') || '[]'); } catch { /* none */ }
  const legacyGoogle = process.env.GOOGLE_API_KEY || getSetting('google_api_key');
  if (legacyGoogle && !list.some((p) => p.key === legacyGoogle)) list.unshift({ id: 'google-main', kind: 'google', key: legacyGoogle });
  if (process.env.GROQ_API_KEY && !list.some((p) => p.key === process.env.GROQ_API_KEY)) list.push({ id: 'groq-env', kind: 'groq', key: process.env.GROQ_API_KEY });
  return list;
}

export function addProvider(kind: ProviderKind, key: string) {
  let list: Provider[] = [];
  try { list = JSON.parse(getSetting('ai_providers') || '[]'); } catch { /* none */ }
  if (list.some((p) => p.key === key)) return;
  list.push({ id: `${kind}-${Date.now().toString(36)}`, kind, key });
  putSetting('ai_providers', JSON.stringify(list));
  googleModels.delete(key);
}

export function removeProvider(id: string) {
  if (id === 'google-main') { putSetting('google_api_key', ''); return; }
  let list: Provider[] = [];
  try { list = JSON.parse(getSetting('ai_providers') || '[]'); } catch { /* none */ }
  putSetting('ai_providers', JSON.stringify(list.filter((p) => p.id !== id)));
}

/* ------------------------------------------------------------------ Google models */

/**
 * Which Gemini models this key may use, best first. Each has its own free per-minute and
 * per-day allowance, which is what makes rotating between them worthwhile.
 */
const googleModels = new Map<string, { at: number; models: string[] }>();
const PREFERRED = [/^gemini-2\.5-flash$/, /^gemini-[3-9][\d.]*-flash$/, /^gemini-[3-9][\d.]*-flash-lite$/, /^gemini-2\.5-flash-lite$/, /^gemini-2\.0-flash$/, /^gemma-3-27b/];

async function modelsFor(key: string): Promise<string[]> {
  const cached = googleModels.get(key);
  if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.models;
  let names: string[] = [];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      names = (data.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
    }
  } catch { /* fall back to the known default below */ }
  const ordered: string[] = [];
  for (const re of PREFERRED) for (const n of names.filter((x) => re.test(x)).sort().reverse()) if (!ordered.includes(n)) ordered.push(n);
  const models = ordered.length ? ordered.slice(0, 5) : ['gemini-2.5-flash'];
  googleModels.set(key, { at: Date.now(), models });
  return models;
}

/**
 * OpenRouter's free models come and go, so they are read from its public catalogue (no key
 * needed) rather than written down — strongest general-purpose ones first.
 */
let freeOR: { at: number; models: string[] } | null = null;
const OR_PREFERRED = [/nemotron-3-(super|ultra)/i, /gemma-4-31b/i, /qwen3/i, /gemma-4/i, /deepseek/i, /llama-(3\.3-70b|4)/i, /gpt-oss/i, /mistral-(small|medium)/i, /inkling(?!-small)/i];
// Specialist or tiny models are no good for writing CVs and letters.
const OR_SKIP = /safety|guard|code|nano|tiny|lfm|preview|omni|-xs-|lightning/i;

async function openRouterModels(): Promise<string[]> {
  if (freeOR && Date.now() - freeOR.at < 6 * 3600_000) return freeOR.models;
  let ids: string[] = [];
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json() as { data?: { id: string; context_length?: number }[] };
      ids = (data.data ?? []).filter((m) => m.id.endsWith(':free') && (m.context_length ?? 0) >= 16000 && !OR_SKIP.test(m.id)).map((m) => m.id);
    }
  } catch { /* keep the fallback below */ }
  const ordered: string[] = [];
  for (const re of OR_PREFERRED) for (const id of ids.filter((x) => re.test(x))) if (!ordered.includes(id)) ordered.push(id);
  const models = (ordered.length ? ordered : ids).slice(0, 4);
  freeOR = { at: Date.now(), models: models.length ? models : OPENAI_LIKE.openrouter.models };
  return freeOR.models;
}

/* ------------------------------------------------------------------ health */

interface Health { restUntil: number; fails: number; ok: number; lastError: string; lastUsed: number }
const health = new Map<string, Health>();
const h = (route: string) => {
  let x = health.get(route);
  if (!x) { x = { restUntil: 0, fails: 0, ok: 0, lastError: '', lastUsed: 0 }; health.set(route, x); }
  return x;
};

class RouteError extends Error {
  constructor(message: string, public rest: number, public fatal = false) { super(message); }
}

/**
 * Google's free daily quotas reset at midnight Pacific time (04:00–05:00 in Buenos Aires,
 * depending on daylight saving there). Worked out from the clock rather than guessed.
 */
function msUntilPacificMidnight(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const elapsed = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return Math.max(60_000, 24 * 3600_000 - elapsed + 60_000);
}

/** A provider that answers with something other than JSON (an outage page, a bare "OK") is down, not broken data. */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new RouteError(`unexpected reply (${text.replace(/\s+/g, ' ').slice(0, 40) || 'empty'}) — provider likely having an outage`, 5 * 60_000); }
}

/* ------------------------------------------------------------------ calls */

async function callGoogle(key: string, model: string, prompt: string, opts: CallOptions): Promise<string> {
  const { system, schema, maxTokens = 8192, files = [] } = opts;
  // Gemma takes no system instruction and no response schema: both go into the prompt instead.
  const gemma = /^gemma/.test(model);
  const text = gemma ? `${system}\n\n${prompt}${schema ? `\n\nReply with JSON only, matching this JSON schema:\n${JSON.stringify(schema)}` : ''}` : prompt;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      ...(gemma ? {} : { systemInstruction: { parts: [{ text: system }] } }),
      contents: [{ role: 'user', parts: [...files.map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } })), { text }] }],
      generationConfig: {
        temperature: 0.4,
        // Never starve a model: short answers still need room, and newer models count overhead.
        maxOutputTokens: Math.max(maxTokens, 2048),
        // Gemini models think by default and bill it against the output budget; answers would truncate.
        ...(/^gemini/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        ...(schema && !gemma ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      // Google says which limit was hit. A daily one lasts until its real reset; a per-minute one
      // comes with the exact wait ("retryDelay": "41s").
      if (/per ?day|daily|PerDay/i.test(body)) throw new RouteError('daily limit', msUntilPacificMidnight());
      const delay = Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1] ?? 60);
      throw new RouteError('per-minute limit', Math.ceil(delay) * 1000 + 1000);
    }
    if (res.status === 503 || res.status === 500) throw new RouteError('busy', 30_000);
    if (res.status === 400 && /API key not valid/i.test(body)) throw new RouteError('key rejected', 3600_000, true);
    if (res.status === 403) throw new RouteError('key refused', 3600_000, true);
    if (res.status === 404 || (res.status === 400 && /not (found|supported)|invalid argument/i.test(body))) throw new RouteError('model unavailable', 6 * 3600_000);
    throw new RouteError(`error ${res.status}`, 30_000);
  }
  const data = await readJson(res) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  if (data.promptFeedback?.blockReason) throw new Error(`Google blocked the request: ${data.promptFeedback.blockReason}`);
  const c = data.candidates?.[0];
  const out = c?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim() ?? '';
  if (!out) throw new RouteError(c?.finishReason === 'MAX_TOKENS' ? 'cut short' : 'empty answer', 5_000);
  return out;
}

/**
 * JSON mode on these providers must return an object, so a list is asked for as
 * {"items": [...]} — asked for as a bare list, models squeeze the answer down to one item.
 */
const wireSchema = (schema: Record<string, unknown>) => (schema.type === 'array' ? { type: 'object', properties: { items: schema }, required: ['items'] } : schema);

async function callOpenAI(kind: Exclude<ProviderKind, 'google'>, key: string, model: string, prompt: string, opts: CallOptions): Promise<string> {
  const p = OPENAI_LIKE[kind];
  const res = await fetch(p.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(kind === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:5273', 'X-Title': 'Career Lab' } : {}),
    },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: Math.min(opts.maxTokens ?? 8192, kind === 'github' ? 4000 : 8192),
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.schema ? `${prompt}\n\nReply with JSON only, matching this JSON schema:\n${JSON.stringify(wireSchema(opts.schema))}${opts.schema.type === 'array' ? '\nPut EVERY item in the "items" list — usually several, not one.' : ''}` : prompt },
      ],
      ...(opts.schema ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after') ?? 0);
      throw new RouteError(/day|daily/i.test(body) ? 'daily limit' : 'per-minute limit', after > 0 ? after * 1000 + 1000 : /day|daily/i.test(body) ? 3600_000 : 65_000);
    }
    if (res.status === 401 || res.status === 403) throw new RouteError('key rejected', 3600_000, true);
    if (res.status === 404 || res.status === 400) throw new RouteError(`model unavailable (${res.status})`, 6 * 3600_000);
    throw new RouteError(`error ${res.status}`, 30_000);
  }
  const data = await readJson(res) as { choices?: { message?: { content?: string } }[] };
  let text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new RouteError('empty answer', 5_000);
  // JSON mode returns an object; array schemas come back wrapped — unwrap the first array.
  if (opts.schema && (opts.schema as { type?: string }).type === 'array' && text.startsWith('{')) {
    try { const arr = Object.values(JSON.parse(text) as Record<string, unknown>).find(Array.isArray); if (arr) text = JSON.stringify(arr); } catch { /* caller parses */ }
  }
  return text;
}

/* ------------------------------------------------------------------ the router */

interface Route { id: string; provider: Provider; model: string; label: string }

async function routes(needsFiles: boolean): Promise<Route[]> {
  const out: Route[] = [];
  const list = providers();
  for (const p of list.filter((x) => x.kind === 'google')) {
    for (const m of await modelsFor(p.key)) out.push({ id: `${p.id}:${m}`, provider: p, model: m, label: `Google · ${m}` });
  }
  if (!needsFiles) {
    for (const p of list.filter((x) => x.kind !== 'google')) {
      const models = p.kind === 'openrouter' ? await openRouterModels() : OPENAI_LIKE[p.kind as Exclude<ProviderKind, 'google'>].models;
      for (const m of models) out.push({ id: `${p.id}:${m}`, provider: p, model: m, label: `${KIND_NAME[p.kind]} · ${m}` });
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cached answers, keyed by the exact request. Two weeks is long enough to matter, short enough to forget. */
db.exec('CREATE TABLE IF NOT EXISTS ai_cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)');
db.prepare('DELETE FROM ai_cache WHERE at < ?').run(Date.now() - 14 * 86_400_000);

export async function generate(prompt: string, opts: CallOptions): Promise<string> {
  const needsFiles = Boolean(opts.files?.length);
  // Bump CACHE_VERSION when the way answers are requested changes, so stale answers are not reused.
  const CACHE_VERSION = 2;
  const cacheKey = needsFiles ? '' : createHash('sha1').update(JSON.stringify([CACHE_VERSION, prompt, opts.system, opts.schema ?? null])).digest('hex');
  if (cacheKey) {
    const hit = db.prepare('SELECT v FROM ai_cache WHERE k = ?').get(cacheKey) as { v: string } | undefined;
    if (hit) return hit.v;
  }

  const all = await routes(needsFiles);
  if (!all.length) {
    throw new Error(needsFiles
      ? 'Reading a file needs a Google AI key. Add one in AI keys.'
      : 'No AI is connected yet. Add a free key in AI keys (Google, Groq, GitHub, Mistral or OpenRouter).');
  }

  for (let round = 0; round < 2; round++) {
    for (const r of all) {
      const st = h(r.id);
      if (st.restUntil > Date.now()) continue;
      st.lastUsed = Date.now();
      try {
        const text = r.provider.kind === 'google'
          ? await callGoogle(r.provider.key, r.model, prompt, opts)
          : await callOpenAI(r.provider.kind as Exclude<ProviderKind, 'google'>, r.provider.key, r.model, prompt, opts);
        if (opts.validate && !opts.validate(text)) throw new RouteError('unusable answer', 10_000);
        st.ok++; st.fails = 0; st.lastError = '';
        if (cacheKey) db.prepare('INSERT OR REPLACE INTO ai_cache (k, v, at) VALUES (?, ?, ?)').run(cacheKey, text, Date.now());
        return text;
      } catch (raw) {
        // Network errors, timeouts, odd replies: whatever went wrong, it is this route's problem — try the next.
        const e = raw instanceof RouteError ? raw : new RouteError(raw instanceof Error ? raw.message.slice(0, 120) : String(raw), 60_000);
        st.fails++;
        st.lastError = e.message;
        st.restUntil = Date.now() + e.rest;
        // A dead key takes all its models down with it.
        if (e.fatal) for (const other of all.filter((x) => x.provider.id === r.provider.id)) h(other.id).restUntil = Date.now() + e.rest;
      }
    }
    // Everything is resting: wait for the first one to come back, if that is soon.
    const soonest = Math.min(...all.map((r) => h(r.id).restUntil)) - Date.now();
    if (round === 0 && soonest > 0 && soonest <= 25_000) { await sleep(soonest + 250); continue; }
    break;
  }
  const soonest = Math.max(0, Math.ceil((Math.min(...all.map((r) => h(r.id).restUntil)) - Date.now()) / 1000));
  // Say what is actually wrong with each provider: a used-up free limit and an outage are different problems.
  const why = [...new Set(all.map((r) => {
    const err = h(r.id).lastError;
    const who = KIND_NAME[r.provider.kind];
    return /outage|unexpected reply|error 5\d\d|busy/i.test(err) ? `${who} is having trouble on their side`
      : /limit/i.test(err) ? `${who} is at its free limit`
      : /key/i.test(err) ? `${who} rejected the key` : `${who} is unavailable`;
  }))].join('; ');
  throw new Error(`No AI can answer right now (${why})${soonest ? ` — trying again is worth it in about ${soonest > 90 ? `${Math.ceil(soonest / 60)} min` : `${soonest}s`}` : ''}. Adding another free provider in AI keys makes this much rarer.`);
}

/** For the AI keys page: every route and how it is doing. Keys are reduced to their last four characters. */
export async function aiHealth() {
  const list = await routes(false);
  return {
    providers: providers().map((p) => ({ id: p.id, kind: p.kind, name: KIND_NAME[p.kind], hint: `…${p.key.slice(-4)}` })),
    routes: list.map((r) => {
      const st = h(r.id);
      const resting = Math.max(0, Math.ceil((st.restUntil - Date.now()) / 1000));
      // Ready means "will probably answer": not resting AND its last attempt did not fail.
      return { id: r.id, provider: r.provider.id, label: r.label, ok: st.ok, resting, until: resting ? new Date(st.restUntil).toISOString() : '', ready: !resting && !st.lastError, lastError: st.lastError };
    }),
  };
}

/** A one-line request to one provider, so a newly pasted key is confirmed before you rely on it. */
export async function testProvider(id: string) {
  const p = providers().find((x) => x.id === id);
  if (!p) throw new Error('No such key.');
  const model = p.kind === 'google' ? (await modelsFor(p.key))[0]
    : p.kind === 'openrouter' ? (await openRouterModels())[0] : OPENAI_LIKE[p.kind as Exclude<ProviderKind, 'google'>].models[0];
  try {
    const out = p.kind === 'google'
      ? await callGoogle(p.key, model, 'Reply with the single word OK.', { system: 'Be brief.', maxTokens: 20 })
      : await callOpenAI(p.kind as Exclude<ProviderKind, 'google'>, p.key, model, 'Reply with the single word OK.', { system: 'Be brief.', maxTokens: 20 });
    return { ok: true, model, reply: out.slice(0, 40) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, model, error: /outage|unexpected reply/i.test(msg) ? `${KIND_NAME[p.kind]} is not answering properly right now (an outage on their side). The key is saved — it will be used as soon as they recover.` : msg };
  }
}
