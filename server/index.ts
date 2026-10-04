import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { db, dbPath } from './db.ts';
import { ATS, fetchAts, importDelimited, importLinkedInProfile, importPastedBlocks, insertJobs } from './jobs.ts';
import { applyProposal, emailConfigured, scanMailbox, type Proposal } from './email.ts';
import { DEFAULT_FEEDS, FEEDS, pullJobs, type FeedId } from './feeds.ts';
import { fileName, toDocx, toPdf } from './export.ts';
import { applyParsedCV, docxToText, parseCV } from './cvimport.ts';
import { adaptCV, draftCVFromInterview, extractJobs, groqConfigured, improveBullets, interviewTurn, judgeFit, suggestTitles, keyStatus, polishFields, readCV, reviewCV, suggestSources, translate, writeSummary, freeform } from './ai.ts';
import { normalizeJobs } from './normalize.ts';
import { scoreJobs } from './relevance.ts';
import { jsearchStatus, pullJSearch } from './jsearch.ts';
import { alertsConfigured, connectMail, disconnectMail, scanAlerts, startAlertWatcher } from './alerts.ts';
import { setEnv } from './env.ts';
import { pullGetOnBoard } from './getonbrd.ts';
import { addProvider, aiHealth, removeProvider, testProvider, type ProviderKind } from './llm.ts';
import { purgeOutOfScope } from './scope.ts';
import { rankJobs } from './rank.ts';
import { buildKit, getKit } from './kit.ts';
import { processStories, reprocessStories, storyStatus } from './stories.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Credentials live in .env and nowhere else — never in the database, never in the UI.
try { process.loadEnvFile(resolve(root, '.env')); } catch { /* no .env yet, which is fine */ }

const app = express();
app.use(express.json({ limit: '12mb' }));  // base64 CV uploads and full restores travel this way

/** Columns we allow writes to, per table. Anything else in a payload is ignored. */
const TABLES = {
  experience: ['kind', 'org', 'title', 'location', 'start_date', 'end_date', 'bullets', 'sort_order'],
  application: ['company','role','track','location','status','priority','source','url','deadline','applied_on','next_action','next_action_on','jd','notes'],
  contact: ['application_id','name','company','role','email','linkedin','how_met','last_touch','next_touch','notes'],
  event: ['application_id', 'on_date', 'kind', 'note'],
  document: ['application_id', 'kind', 'title', 'body'],
  job: ['source','external_id','company','title','location','url','posted_on','description','track','category','starred','dismissed','application_id','tailored_at'],
  saved_search: ['name', 'terms', 'exclude'],
  answer: ['slug','question','body','body_es','word_limit','company','track','times_used'],
  story: ['kind', 'title', 'body', 'shows', 'private', 'answer_id'],
  story_answer: ['question', 'answer', 'theme', 'processed'],
} as const;

type Table = keyof typeof TABLES;
const ORDER: Record<Table, string> = {
  experience: 'sort_order ASC, id DESC',
  application: 'priority ASC, id DESC',
  contact: 'name COLLATE NOCASE ASC',
  event: 'on_date DESC, id DESC',
  document: 'created_at DESC, id DESC',
  job: 'starred DESC, imported_at DESC, id DESC',
  saved_search: 'name COLLATE NOCASE ASC',
  answer: 'company ASC, slug ASC, id DESC',
  story: 'id DESC',
  story_answer: 'id ASC',
};

const isTable = (t: string): t is Table => Object.hasOwn(TABLES, t);

function pick(table: Table, body: Record<string, unknown>) {
  const cols = TABLES[table].filter((c) => body[c] !== undefined);
  const values = cols.map((c) => {
    const v = body[c];
    if (v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'object') return JSON.stringify(v);
    return v as string | number;
  });
  return { cols, values };
}

app.get('/api/:table', (req, res, next) => {
  const { table } = req.params;
  // Fall through so the named routes below (/api/profile, /api/all) still get their turn.
  if (!isTable(table)) return next();
  res.json(db.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER[table]}`).all());
});

app.post('/api/:table', (req, res, next) => {
  const { table } = req.params;
  // Same fall-through as the GET: /api/jobs/* and /api/import/* are handled further down.
  if (!isTable(table)) return next();
  const { cols, values } = pick(table, req.body ?? {});
  if (!cols.length) return res.status(400).json({ error: 'no writable fields' });
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const info = db.prepare(sql).run(...values);
  res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid as number));
});

app.patch('/api/:table/:id', (req, res) => {
  const { table, id } = req.params;
  if (!isTable(table)) return res.status(404).json({ error: 'unknown table' });
  const { cols, values } = pick(table, req.body ?? {});
  if (!cols.length) return res.status(400).json({ error: 'no writable fields' });
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...values, Number(id));
  res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)));
});

app.delete('/api/:table/:id', (req, res) => {
  const { table, id } = req.params;
  if (!isTable(table)) return res.status(404).json({ error: 'unknown table' });
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(id));
  res.json({ ok: true });
});

app.get('/api/profile', (_req, res) => {
  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

app.patch('/api/profile', (req, res) => {
  const cols = ['name','headline','email','phone','location','linkedin','summary','languages','skills',
                'headline_es','summary_es','skills_es','languages_es']
    .filter((c) => req.body?.[c] !== undefined);
  if (cols.length) {
    db.prepare(`UPDATE profile SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`)
      .run(...cols.map((c) => req.body[c] as string));
  }
  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

/** Everything in one shot — the UI is small enough that one payload beats five round trips. */
app.get('/api/all', (_req, res) => {
  res.json({
    profile: db.prepare('SELECT * FROM profile WHERE id = 1').get(),
    experience: db.prepare(`SELECT * FROM experience ORDER BY ${ORDER.experience}`).all(),
    application: db.prepare(`SELECT * FROM application ORDER BY ${ORDER.application}`).all(),
    contact: db.prepare(`SELECT * FROM contact ORDER BY ${ORDER.contact}`).all(),
    event: db.prepare(`SELECT * FROM event ORDER BY ${ORDER.event}`).all(),
    document: db.prepare(`SELECT * FROM document ORDER BY ${ORDER.document}`).all(),
    saved_search: db.prepare(`SELECT * FROM saved_search ORDER BY ${ORDER.saved_search}`).all(),
    answer: db.prepare(`SELECT * FROM answer ORDER BY ${ORDER.answer}`).all(),
    story: db.prepare(`SELECT * FROM story ORDER BY ${ORDER.story}`).all(),
    story_answer: db.prepare(`SELECT id, question, theme, created_at FROM story_answer ORDER BY ${ORDER.story_answer}`).all(),
    setting: Object.fromEntries(
      (db.prepare('SELECT key, value FROM setting').all() as { key: string; value: string }[])
        .map((r) => [r.key, r.value]),
    ),
  });
});

app.put('/api/setting/:key', (req, res) => {
  db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(req.params.key, String(req.body?.value ?? ''));
  res.json({ ok: true });
});


/** AI assistance. Nothing here runs unless the user presses a button in the AI step. */
app.get('/api/ai/status', (_req, res) => res.json(keyStatus()));

app.put('/api/ai/key', (req, res) => {
  const value = String(req.body?.key ?? '').trim();
  db.prepare("INSERT INTO setting (key, value) VALUES ('google_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(value);
  res.json(keyStatus());
});

/**
 * The interview's answers: saved instantly, turned into stories in the background (see
 * stories.ts). No AI in the way of the conversation.
 */
app.post('/api/story/answer', (req, res) => {
  const { question, answer, theme } = req.body ?? {};
  if (!question || !String(answer ?? '').trim()) return res.status(400).json({ error: 'question and answer required' });
  db.prepare('INSERT INTO story_answer (question, answer, theme) VALUES (?, ?, ?)').run(String(question), String(answer), String(theme ?? ''));
  processStories(req.body?.lang === 'es' ? 'es' : 'en');
  res.json(storyStatus());
});
app.get('/api/story/status', (_req, res) => res.json(storyStatus()));

/**
 * "Add this to my CV": experience, skills, languages and a profile drafted from the interview.
 * New entries are added; profile fields are only filled where they are still empty, so nothing
 * you typed or edited is overwritten.
 */
app.post('/api/cv/from-story', async (req, res) => {
  const lang = req.body?.lang === 'es' ? 'es' : 'en';
  const answers = (db.prepare("SELECT question, answer FROM story_answer WHERE theme != 'gap' ORDER BY id").all() as { question: string; answer: string }[])
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');
  if (!answers.trim()) return res.status(400).json({ error: 'Answer a few interview questions first.' });
  const exps = db.prepare('SELECT kind, org, title FROM experience').all() as { kind: string; org: string; title: string }[];
  const existing = exps.map((e) => `- (${e.kind}) ${e.org}${e.title ? ` — ${e.title}` : ''}`).join('\n');
  try {
    const draft = await draftCVFromInterview({ answers, existing, lang });
    const base = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM experience').get() as { n: number }).n + 1;
    const insert = db.prepare('INSERT INTO experience (kind, org, title, location, start_date, end_date, bullets, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const seen = new Set(exps.map((e) => `${e.org}|${e.title}`.toLowerCase()));
    let added = 0;
    for (const e of draft.entries ?? []) {
      const key = `${e.org}|${e.title}`.toLowerCase();
      if (!(e.org || e.title) || seen.has(key)) continue;
      seen.add(key);
      insert.run(e.kind, e.org || e.title, e.org ? e.title : '', e.location ?? '', e.start_date ?? '', e.end_date ?? '',
        JSON.stringify((e.bullets ?? []).filter(Boolean).map((text) => ({ text, es: '', tracks: [] }))), base + added);
      added++;
    }
    const p = db.prepare('SELECT skills, languages, summary FROM profile WHERE id = 1').get() as { skills: string; languages: string; summary: string };
    const fill: Record<string, string> = {};
    if (!p.skills.trim() && draft.skills?.trim()) fill.skills = draft.skills.trim();
    if (!p.languages.trim() && draft.languages?.trim()) fill.languages = draft.languages.trim();
    if (!p.summary.trim() && draft.summary?.trim()) fill.summary = draft.summary.trim();
    const cols = Object.keys(fill);
    if (cols.length) db.prepare(`UPDATE profile SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`).run(...cols.map((c) => fill[c]));
    res.json({ added, filled: cols });
  } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : String(e) }); }
});
app.post('/api/story/reprocess', (req, res) => { reprocessStories(req.body?.lang === 'es' ? 'es' : 'en'); res.json(storyStatus()); });
app.post('/api/story/process', (req, res) => { processStories(req.body?.lang === 'es' ? 'es' : 'en'); res.json(storyStatus()); });

/** One answer with an instant AI turn — still used for the quick gap questions inside a kit. */
app.post('/api/story/turn', async (req, res) => {
  const { question, answer, theme, isFollowUp } = req.body ?? {};
  if (!question || !String(answer ?? '').trim()) return res.status(400).json({ error: 'question and answer required' });
  const lang = req.body?.lang === 'es' ? 'es' : 'en';
  const info = db.prepare('INSERT INTO story_answer (question, answer, theme) VALUES (?, ?, ?)').run(String(question), String(answer), String(theme ?? ''));
  const answerId = Number(info.lastInsertRowid);
  const known = (db.prepare('SELECT kind, title FROM story ORDER BY id DESC LIMIT 60').all() as { kind: string; title: string }[])
    .map((s) => `- (${s.kind}) ${s.title}`).join('\n');
  try {
    const turn = await interviewTurn({ question: String(question), answer: String(answer), isFollowUp: Boolean(isFollowUp), known, lang });
    const insert = db.prepare('INSERT INTO story (kind, title, body, shows, private, answer_id) VALUES (?, ?, ?, ?, ?, ?)');
    const saved = (turn.items ?? []).filter((i) => i.title && i.body).map((i) => {
      const r = insert.run(i.kind, i.title, i.body, i.shows ?? '', i.private ? 1 : 0, answerId);
      return { ...i, id: Number(r.lastInsertRowid) };
    });
    res.json({ reaction: turn.reaction ?? '', followUp: isFollowUp ? '' : (turn.followUp ?? ''), items: saved });
  } catch (e) {
    // The answer is kept; the AI can process it later. The interview simply carries on.
    res.json({ reaction: '', followUp: '', items: [], error: e instanceof Error ? e.message : String(e) });
  }
});

/** Application kits: build (or rebuild) one job's tailored CV and letter; read; record your decisions. */
app.get('/api/kit/:jobId', (req, res) => res.json({ kit: getKit(Number(req.params.jobId)) }));
app.post('/api/kit/:jobId/build', async (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM job WHERE id = ?').get(Number(req.params.jobId)) as { id: number; application_id: number | null } | undefined;
    if (!job) return res.status(404).json({ error: 'no such job' });
    // The job becomes a tracked application the moment a kit is made for it.
    if (!job.application_id) {
      const j = db.prepare('SELECT * FROM job WHERE id = ?').get(job.id) as Record<string, string>;
      const info = db.prepare("INSERT INTO application (company, role, location, status, source, url, jd) VALUES (?, ?, ?, 'tailored', ?, ?, ?)")
        .run(j.company, j.title, j.location, j.source, j.url, j.description);
      db.prepare('UPDATE job SET application_id = ? WHERE id = ?').run(info.lastInsertRowid as number, job.id);
    }
    if (typeof req.body?.jd === 'string' && req.body.jd.trim()) {
      db.prepare("INSERT INTO kit (job_id, jd) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET jd = excluded.jd").run(job.id, req.body.jd.trim());
    }
    res.json({ kit: await buildKit(job.id, req.body?.lang === 'es' ? 'es' : 'en') });
  } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : String(e) }); }
});
app.put('/api/kit/:jobId/decisions', (req, res) => {
  db.prepare('UPDATE kit SET decisions = ? WHERE job_id = ?').run(JSON.stringify(req.body?.decisions ?? {}), Number(req.params.jobId));
  res.json({ ok: true });
});
app.get('/api/kits', (_req, res) => {
  res.json({ kits: (db.prepare('SELECT job_id, application_id, created_at FROM kit WHERE data != \'{}\'').all()) });
});

/** AI keys: several free providers, rotated by the router in llm.ts. Keys never come back out. */
app.get('/api/ai/health', async (_req, res) => res.json(await aiHealth()));
app.post('/api/ai/providers', async (req, res) => {
  const kind = String(req.body?.kind ?? '') as ProviderKind;
  const key = String(req.body?.key ?? '').trim();
  if (!['google', 'groq', 'github', 'mistral', 'openrouter'].includes(kind) || !key) return res.status(400).json({ error: 'kind and key required' });
  addProvider(kind, key);
  const added = (await aiHealth()).providers.find((p) => p.hint === `…${key.slice(-4)}` && p.kind === kind);
  res.json(added ? await testProvider(added.id) : { ok: false, error: 'not saved' });
});
app.post('/api/ai/providers/:id/test', async (req, res) => res.json(await testProvider(req.params.id)));
app.post('/api/ai/providers/:id/remove', (req, res) => { removeProvider(req.params.id); res.json({ ok: true }); });

app.post('/api/ai/:action', async (req, res) => {
  const { action } = req.params;
  const lang = req.body?.lang === 'es' ? 'es' : 'en';
  try {
    if (action === 'bullets') {
      const { bullets, role, track } = req.body ?? {};
      if (!Array.isArray(bullets) || !bullets.length) return res.status(400).json({ error: 'no bullets sent' });
      return res.json({ suggestions: await improveBullets(bullets.slice(0, 20), { role: role ?? '', track: track ?? '', lang }) });
    }
    if (action === 'summary') {
      const { headline, bullets, track } = req.body ?? {};
      return res.json({ text: await writeSummary({ headline: headline ?? '', bullets: bullets ?? [], track: track ?? '', lang }) });
    }
    if (action === 'review') {
      const { cv, track, jd } = req.body ?? {};
      if (!cv) return res.status(400).json({ error: 'no cv sent' });
      return res.json({ review: await reviewCV(String(cv), { track: track ?? '', jd, lang }) });
    }
    if (action === 'polish') {
      const { fields, track } = req.body ?? {};
      if (!Array.isArray(fields) || !fields.length) return res.status(400).json({ error: 'no fields sent' });
      return res.json({ edits: await polishFields(fields.slice(0, 60), { track: track ?? '', lang }) });
    }
    if (action === 'sources') {
      const { cv, tracks, location, keywords } = req.body ?? {};
      return res.json({ plan: await suggestSources({ cv: cv ?? '', tracks: tracks ?? '', location: location ?? '', keywords: keywords ?? '', lang }) });
    }
    if (action === 'extract-jobs') {
      const { text } = req.body ?? {};
      if (!text) return res.status(400).json({ error: 'nothing to read' });
      const jobs = await extractJobs(String(text), lang);
      return res.json({ jobs, ...insertJobs(jobs.map((j) => ({ ...j, source: 'ai' }))) });
    }
    if (action === 'adapt') {
      const { cv, company, role, jd } = req.body ?? {};
      if (!cv || !company) return res.status(400).json({ error: 'cv and company required' });
      return res.json({ adaptation: await adaptCV({ cv, company, role: role ?? '', jd: jd ?? '', lang }) });
    }
    if (action === 'translate') {
      const { text, to } = req.body ?? {};
      if (!text) return res.status(400).json({ error: 'no text sent' });
      return res.json({ text: await translate(String(text), to === 'en' ? 'en' : 'es') });
    }
    if (action === 'titles') {
      const { cv } = req.body ?? {};
      if (!cv) return res.status(400).json({ error: 'no cv sent' });
      const { fields, experience } = req.body ?? {};
      return res.json({ titles: await suggestTitles(String(cv), lang, { fields: Array.isArray(fields) ? fields : [], experience }) });
    }
    if (action === 'freeform') {
      const { prompt } = req.body ?? {};
      if (!prompt) return res.status(400).json({ error: 'no prompt sent' });
      return res.json({ text: await freeform(String(prompt), lang) });
    }
    return res.status(404).json({ error: 'unknown action' });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Real files, because no application form accepts Markdown. */
app.post('/api/export', async (req, res) => {
  const { markdown, format, kind, company, lang, name } = req.body ?? {};
  if (typeof markdown !== 'string' || !markdown.trim()) return res.status(400).json({ error: 'nothing to export' });
  const ext = format === 'pdf' ? 'pdf' : 'docx';
  try {
    const buf = ext === 'pdf' ? await toPdf(markdown) : await toDocx(markdown);
    const filename = fileName({ name: String(name ?? ''), kind: String(kind ?? 'cv'), company: String(company ?? ''), lang: String(lang ?? 'en'), ext });
    res.setHeader('Content-Type', ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Parse an existing CV. Returns what it found; nothing is written until you confirm.
 *
 * The text is taken out of the file on this computer first (Word, PDF, plain text), so ANY
 * connected AI can read it — not only Google. Only a scanned PDF (an image, no text inside)
 * needs Google, which can read images. With no AI at all, the rule-based reader still runs.
 */
async function pdfToText(buf: Buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
  return String(text ?? '').trim();
}

app.post('/api/cv/parse', async (req, res) => {
  const { text, base64, filename } = req.body ?? {};
  const name = String(filename ?? '').toLowerCase();
  const ai = keyStatus().configured;
  try {
    let raw = typeof text === 'string' ? text : '';
    if (!raw && typeof base64 === 'string') {
      const buf = Buffer.from(base64, 'base64');
      raw = name.endsWith('.docx') ? await docxToText(buf)
        : name.endsWith('.pdf') ? await pdfToText(buf).catch(() => '')
        : buf.toString('utf8');

      // A PDF with (almost) no text inside is a scan: only a model that reads images can help.
      if (name.endsWith('.pdf') && raw.length < 120) {
        if (!keyStatus().google) {
          return res.status(400).json({ error: 'This PDF is a scanned image with no text inside. Reading it needs the Google AI key — or open it, copy the text and paste it below.' });
        }
        const parsed = await readCV({ file: { mimeType: 'application/pdf', data: base64 } });
        return res.json({ parsed: { ...parsed, unmatched: [] }, chars: 0, via: 'ai' });
      }
    }
    if (!raw.trim()) return res.status(400).json({ error: 'nothing to read' });

    if (ai) {
      try {
        const parsed = await readCV({ text: raw });
        return res.json({ parsed: { ...parsed, unmatched: [] }, chars: raw.length, via: 'ai' });
      } catch { /* every AI is busy: the rules still get a go */ }
    }
    res.json({ parsed: parseCV(raw), chars: raw.length, via: 'rules' });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/cv/apply', (req, res) => {
  const { parsed, replaceExisting } = req.body ?? {};
  if (!parsed) return res.status(400).json({ error: 'nothing to apply' });
  res.json(applyParsedCV(parsed, Boolean(replaceExisting)));
});

/** One JSON file with everything, so a dead laptop is an inconvenience and not a disaster. */
app.get('/api/backup', (_req, res) => {
  const tables = ['profile','experience','application','contact','event','document','job','saved_search','answer','setting','story','story_answer'];
  const data = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="career-lab-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify({ version: 3, exported_at: new Date().toISOString(), data }, null, 2));
});

app.post('/api/restore', (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'not a backup file' });
  const counts: Record<string, number> = {};
  try {
    for (const [table, rows] of Object.entries(data as Record<string, Record<string, unknown>[]>)) {
      if (!Array.isArray(rows) || !rows.length) continue;
      if (table === 'profile') {
        const p = rows[0];
        const cols = Object.keys(p).filter((c) => c !== 'id');
        db.prepare(`UPDATE profile SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`).run(...cols.map((c) => p[c] as string));
        counts.profile = 1;
        continue;
      }
      db.prepare(`DELETE FROM ${table}`).run();
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const row of rows) stmt.run(...cols.map((c) => (row[c] ?? null) as string | number | null));
      counts[table] = rows.length;
    }
    res.json({ restored: counts });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Jobs are paged separately from /api/all: the list is meant to run to thousands of rows,
 * and the client filters server-side so a keyword search stays fast as it grows.
 */
app.get('/api/jobs/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const showDismissed = req.query.dismissed === '1';
  const starredOnly = req.query.starred === '1';
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const offset = Number(req.query.offset ?? 0);

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!showDismissed) where.push('dismissed = 0');
  if (starredOnly) where.push('starred = 1');

  // Space-separated terms are ANDed; "quoted phrases" stay together; a leading - excludes.
  for (const raw of q.match(/"[^"]+"|\S+/g) ?? []) {
    const negated = raw.startsWith('-');
    const term = raw.replace(/^-/, '').replace(/^"|"$/g, '').trim();
    if (!term) continue;
    where.push(`(company || ' ' || title || ' ' || location || ' ' || description) ${negated ? 'NOT LIKE' : 'LIKE'} ?`);
    params.push(`%${term}%`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM job ${clause}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM job ${clause} ORDER BY ${ORDER.job} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];
  res.json({ total, rows: rows.map(lean) });
});

/** Vectors are for the server's ranking; the browser never needs 256 numbers per row. */
const lean = ({ embedding: _e, ...rest }: Record<string, unknown>) => rest;

/**
 * The job list: filtered in SQL, ranked here (relevance plus your saves and dismissals), with
 * counts per country, city, level, language and source so every filter shows what it holds.
 */
app.get('/api/jobs/browse', (req, res) => {
  normalizeJobs();
  const q = (k: string) => String(req.query[k] ?? '').trim();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (q('saved') === '1') where.push('starred = 1');
  else if (q('dismissed') === '1') where.push('dismissed = 1');
  else where.push('dismissed = 0');

  const base = [...where];
  const baseParams = [...params];

  const countries = q('country').split(',').filter(Boolean);
  if (countries.length) {
    // Remote jobs stay visible inside a country filter: you can take them from there.
    where.push(`(country IN (${countries.map(() => '?').join(',')})${q('remote') === 'include' ? ' OR remote = 1' : ''})`);
    params.push(...countries);
  }
  if (q('city')) { where.push('city = ?'); params.push(q('city')); }
  if (q('remote') === 'only') where.push('remote = 1');
  if (q('remote') === 'exclude') where.push('remote = 0');
  const levels = q('levels').split(',').filter(Boolean);
  if (levels.length) {
    where.push(`(level IN (${levels.map(() => '?').join(',')}))`);
    params.push(...levels.map((l) => (l === 'any' ? '' : l)));
  }
  if (q('lang')) { where.push("(lang = ? OR lang = '')"); params.push(q('lang')); }
  if (q('source')) { where.push('source LIKE ?'); params.push(`${q('source')}%`); }
  if (q('fit')) { where.push(`fit IN (${q('fit').split(',').map(() => '?').join(',')})`); params.push(...q('fit').split(',')); }
  if (Number(q('days')) > 0) { where.push("(posted_on = '' OR posted_on >= date('now', ?))"); params.push(`-${Number(q('days'))} days`); }
  for (const raw of q('q').match(/"[^"]+"|\S+/g) ?? []) {
    const neg = raw.startsWith('-');
    const term = raw.replace(/^-/, '').replace(/^"|"$/g, '');
    if (!term) continue;
    where.push(`(company || ' ' || title || ' ' || location || ' ' || description) ${neg ? 'NOT LIKE' : 'LIKE'} ?`);
    params.push(`%${term}%`);
  }

  const rows = db.prepare(`SELECT * FROM job WHERE ${where.join(' AND ')}`).all(...params) as Record<string, unknown>[];
  const score = rankJobs();
  const all: (Record<string, unknown> & { match: number; rank: number; reasons: string[] })[] = rows.map((r) => {
    const { score: match, reasons } = score(r as never);
    return { ...r, match, rank: match, reasons };
  });

  // Three views over the same filtered set: a shortlist, what is new since you last looked, and everything.
  const FOR_YOU = 45;
  const since = q('since');
  const isNew = (r: Record<string, unknown>) => Boolean(since) && String(r.imported_at) > since;
  const isForYou = (r: { match: number; level?: unknown }) => r.match >= FOR_YOU && r.level !== 'senior';
  const views = { foryou: all.filter(isForYou).length, new: all.filter(isNew).length, all: all.length };
  const view = q('view');
  const ranked = view === 'foryou' ? all.filter(isForYou) : view === 'new' ? all.filter(isNew) : all;

  const sort = q('sort') || 'relevance';
  ranked.sort((a, b) => sort === 'newest'
    ? String(b.posted_on || b.imported_at).localeCompare(String(a.posted_on || a.imported_at))
    : (Number(b.starred) - Number(a.starred)) || (b.match - a.match) || String(b.posted_on).localeCompare(String(a.posted_on)));

  const offset = Number(q('offset') || 0);
  const limit = Math.min(Number(q('limit') || 50), 200);

  // Facets are counted over everything not dismissed, so a filter never hides its own options.
  const facet = (col: string) => db.prepare(`SELECT ${col} AS v, COUNT(*) AS n FROM job WHERE ${base.join(' AND ')} GROUP BY ${col} ORDER BY n DESC`).all(...baseParams);
  // Everything stored is already inside your places, so cities are counted across all of it.
  const cities = db.prepare(`SELECT city AS v, COUNT(*) AS n FROM job WHERE ${base.join(' AND ')} AND city != ''${countries.length ? ` AND country IN (${countries.map(() => '?').join(',')})` : ''} GROUP BY city ORDER BY n DESC LIMIT 30`)
    .all(...baseParams, ...countries);
  const sources = db.prepare(`SELECT CASE WHEN source LIKE 'jsearch%' THEN 'jsearch' WHEN source LIKE 'alert:%' THEN source ELSE source END AS v, COUNT(*) AS n FROM job WHERE ${base.join(' AND ')} GROUP BY v ORDER BY n DESC`).all(...baseParams);
  const counts = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN relevance < 0 THEN 1 ELSE 0 END) AS unscored,
    SUM(starred) AS saved, (SELECT COUNT(*) FROM job WHERE dismissed = 1) AS dismissed FROM job WHERE dismissed = 0`).get();

  res.json({
    total: ranked.length,
    rows: ranked.slice(offset, offset + limit).map(lean),
    facets: { country: facet('country'), city: cities, level: facet('level'), lang: facet('lang'), source: sources, remote: facet('remote') },
    counts,
    views,
  });
});

/** The four steps' live status for the sidebar: one cheap call instead of four pages' worth. */
app.get('/api/journey', (_req, res) => {
  normalizeJobs();
  const score = rankJobs();
  const jobs = db.prepare('SELECT title, description, level, city, posted_on, imported_at, starred, source FROM job WHERE dismissed = 0').all() as never[];
  let foryou = 0;
  let saved = 0;
  for (const j of jobs as { level: string; starred: number }[]) {
    if (j.starred) saved++;
    const s = score(j as never);
    if (s.score >= 45 && j.level !== 'senior') foryou++;
  }
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  res.json({
    jobs: { total: jobs.length, foryou, saved },
    apply: { tailored: one('SELECT COUNT(*) AS n FROM document WHERE application_id IS NOT NULL'), saved },
    track: {
      applied: one("SELECT COUNT(*) AS n FROM application WHERE status IN ('applied','interviewing','offer')"),
      interviewing: one("SELECT COUNT(*) AS n FROM application WHERE status = 'interviewing'"),
    },
  });
});

/** Relevance for every job not scored yet. Needs the CV text, which the browser builds. */
app.post('/api/jobs/score', async (req, res) => {
  const cv = String(req.body?.cv ?? '');
  if (!cv.trim()) return res.status(400).json({ error: 'no cv sent' });
  try { normalizeJobs(); res.json(await scoreJobs(cv)); }
  catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : String(e) }); }
});

/** The careful read, for the handful you ask about: eight postings per call. */
app.post('/api/jobs/fit', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 24) as number[];
  const cv = String(req.body?.cv ?? '');
  const lang = req.body?.lang === 'es' ? 'es' : 'en';
  if (!ids.length || !cv) return res.status(400).json({ error: 'ids and cv required' });
  const jobs = db.prepare(`SELECT id, title, company, location, description FROM job WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: number; title: string; company: string; location: string; description: string }[];
  const set = db.prepare('UPDATE job SET fit = ?, fit_why = ?, fit_gap = ? WHERE id = ?');
  try {
    let judged = 0;
    for (let i = 0; i < jobs.length; i += 8) {
      const verdicts = await judgeFit(cv, jobs.slice(i, i + 8), lang);
      for (const v of verdicts) {
        if (jobs.some((j) => j.id === v.id)) { set.run(v.fit, v.why, v.gap, v.id); judged++; }
      }
    }
    res.json({ judged });
  } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : String(e) }); }
});

/** Where jobs come from, and whether each source is connected. Never returns a secret. */
app.get('/api/sources/status', (_req, res) => {
  res.json({
    gmail: {
      configured: alertsConfigured(), user: process.env.IMAP_USER ?? '',
      last: (db.prepare("SELECT value FROM setting WHERE key = 'alerts_last'").get() as { value: string } | undefined)?.value ?? '',
    },
    jsearch: jsearchStatus(),
    ai: keyStatus().configured,
    groq: groqConfigured(),
  });
});

app.post('/api/sources/gmail', async (req, res) => {
  const { user, password } = req.body ?? {};
  if (!user || !password) return res.status(400).json({ error: 'email and app password required' });
  try { res.json(await connectMail(String(user).trim(), String(password))); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
});
// Not DELETE: the generic DELETE /api/:table/:id above would claim the path first.
app.post('/api/sources/gmail/disconnect', (_req, res) => { disconnectMail(); res.json({ configured: false }); });

app.put('/api/sources/jsearch', (req, res) => {
  setEnv({ JSEARCH_KEY: String(req.body?.key ?? '').trim() });
  res.json(jsearchStatus());
});

app.post('/api/jobs/jsearch', async (req, res) => {
  const queries = Array.isArray(req.body?.queries) ? req.body.queries : [];
  try { const r = await pullJSearch(queries, Number(req.body?.max ?? 12)); normalizeJobs(); res.json(r); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
});

app.post('/api/jobs/getonbrd', async (req, res) => {
  const queries = Array.isArray(req.body?.queries) ? (req.body.queries as string[]) : [];
  try { const r = await pullGetOnBoard(queries); normalizeJobs(); res.json(r); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
});

app.post('/api/sources/groq', (req, res) => {
  setEnv({ GROQ_API_KEY: String(req.body?.key ?? '').trim() });
  res.json({ configured: groqConfigured() });
});

/** Your places changed: drop what no longer belongs (saved and applied jobs are always kept). */
app.post('/api/jobs/rescope', (_req, res) => { res.json({ removed: purgeOutOfScope() }); });

app.post('/api/alerts/scan', async (req, res) => {
  try { const r = await scanAlerts(Number(req.body?.days ?? 30)); normalizeJobs(); res.json(r); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
});

/** Bulk acquisition: many searches across many open feeds, in one press. */
app.get('/api/jobs/feeds', (_req, res) => res.json({ feeds: FEEDS }));

app.post('/api/jobs/pull', async (req, res) => {
  const queries = Array.isArray(req.body?.queries) ? (req.body.queries as string[]).slice(0, 12) : [];
  const feeds = Array.isArray(req.body?.feeds) && req.body.feeds.length
    ? (req.body.feeds as FeedId[])
    : DEFAULT_FEEDS;
  try {
    const report = await pullJobs(queries, feeds);
    normalizeJobs();
    res.json(report);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/jobs/import', (req, res) => {
  const { text, mode, source } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'nothing to import' });
  try {
    const result = mode === 'blocks'
      ? importPastedBlocks(text, source ?? 'paste')
      : importDelimited(text, source ?? 'linkedin-export');
    res.json(result);
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

/**
 * One company name, three boards tried. Typing "Mercado Libre" should not require knowing
 * which applicant-tracking system they happen to use, or what their URL slug looks like.
 */
app.post('/api/jobs/ats', async (req, res) => {
  const { provider, slug } = req.body ?? {};
  const raw = String(slug ?? '').trim();
  if (!raw) return res.status(400).json({ error: 'company name required' });

  // "Mercado Libre" → mercadolibre; "J.P. Morgan" → jpmorgan; a pasted URL → its slug.
  const fromUrl = raw.match(/(?:greenhouse\.io|lever\.co|ashbyhq\.com)\/([^/?#]+)/i)?.[1];
  const candidates = [...new Set([
    fromUrl,
    raw.toLowerCase().replace(/[^a-z0-9]/g, ''),
    raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  ].filter(Boolean))] as string[];

  const providers = provider && provider !== 'auto' ? [provider as keyof typeof ATS] : (Object.keys(ATS) as (keyof typeof ATS)[]);
  const tried: string[] = [];

  for (const p of providers) {
    for (const c of candidates) {
      try {
        const result = await fetchAts(p, c);
        if (result.inserted > 0 || result.skipped > 0) return res.json({ ...result, provider: p, slug: c });
      } catch {
        tried.push(`${p}/${c}`);
      }
    }
  }
  res.status(404).json({
    error: `No public job board found for “${raw}”. Tried ${tried.length} combinations. Most large banks, consultancies and local employers run their own careers sites, which this cannot read — use the LinkedIn import or the AI paste for those.`,
  });
});

app.post('/api/import/linkedin-profile', (req, res) => {
  const { filename, text } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'nothing to import' });
  try {
    res.json(importLinkedInProfile(String(filename ?? ''), text));
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

app.get('/api/email/status', (_req, res) => {
  res.json({
    configured: emailConfigured(),
    user: process.env.IMAP_USER ?? '',
    host: process.env.IMAP_HOST ?? '',
  });
});

app.post('/api/email/scan', async (req, res) => {
  try {
    res.json({ proposals: await scanMailbox(Number(req.body?.days ?? 30), String(req.body?.mailbox ?? 'INBOX')) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/email/apply', (req, res) => {
  const proposals = (req.body?.proposals ?? []) as Proposal[];
  if (!Array.isArray(proposals) || !proposals.length) return res.status(400).json({ error: 'nothing to apply' });
  res.json({ applied: proposals.map((p) => applyProposal(p)) });
});

/** Promote a job row into a tracked application, carrying the description across as the JD. */
app.post('/api/jobs/:id/promote', (req, res) => {
  const job = db.prepare('SELECT * FROM job WHERE id = ?').get(Number(req.params.id)) as any;
  if (!job) return res.status(404).json({ error: 'no such job' });
  if (job.application_id) return res.json({ application_id: job.application_id, already: true });

  const info = db.prepare(
    `INSERT INTO application (company, role, track, location, status, source, url, jd)
     VALUES (?, ?, ?, ?, 'target', ?, ?, ?)`,
  ).run(job.company, job.title, job.track || String(req.body?.track ?? 'finance'), job.location, job.source, job.url, job.description);

  db.prepare('UPDATE job SET application_id = ? WHERE id = ?').run(info.lastInsertRowid as number, job.id);
  res.json({ application_id: info.lastInsertRowid, already: false });
});

const dist = resolve(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

startAlertWatcher(() => normalizeJobs());
// Answers left unprocessed (the AI was out of quota, or the app was closed) are picked up on start.
setTimeout(() => processStories(), 20_000);

const port = Number(process.env.API_PORT ?? 5274); // deliberately not PORT: dev runners inject that for the web server
app.listen(port, () => {
  console.log(`[career-lab] api on http://localhost:${port}  db: ${dbPath}`);
});
