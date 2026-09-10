import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { db, dbPath } from './db.ts';
import { ATS, fetchAts, importDelimited, importLinkedInProfile, importPastedBlocks } from './jobs.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '2mb' }));

/** Columns we allow writes to, per table. Anything else in a payload is ignored. */
const TABLES = {
  experience: ['kind', 'org', 'title', 'location', 'start_date', 'end_date', 'bullets', 'sort_order'],
  application: ['company','role','track','location','status','priority','source','url','deadline','applied_on','next_action','next_action_on','jd','notes'],
  contact: ['application_id','name','company','role','email','linkedin','how_met','last_touch','next_touch','notes'],
  event: ['application_id', 'on_date', 'kind', 'note'],
  document: ['application_id', 'kind', 'title', 'body'],
  job: ['source','external_id','company','title','location','url','posted_on','description','track','starred','dismissed','application_id'],
  saved_search: ['name', 'terms', 'exclude'],
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
  });
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
    .all(...params, limit, offset);
  res.json({ total, rows });
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

app.post('/api/jobs/ats', async (req, res) => {
  const { provider, slug } = req.body ?? {};
  if (!provider || !slug || !(provider in ATS)) return res.status(400).json({ error: 'provider and slug required' });
  try {
    res.json(await fetchAts(provider as keyof typeof ATS, String(slug).trim()));
  } catch (e) {
    res.status(502).json({ error: `Could not reach that board. ${String(e)}` });
  }
});

app.post('/api/import/linkedin-profile', (req, res) => {
  const { filename, text } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'nothing to import' });
  try {
    res.json(importLinkedInProfile(String(filename ?? ''), text));
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

/** Promote a job row into a tracked application, carrying the description across as the JD. */
app.post('/api/jobs/:id/promote', (req, res) => {
  const job = db.prepare('SELECT * FROM job WHERE id = ?').get(Number(req.params.id)) as any;
  if (!job) return res.status(404).json({ error: 'no such job' });
  if (job.application_id) return res.json({ application_id: job.application_id, already: true });

  const info = db.prepare(
    `INSERT INTO application (company, role, track, location, status, source, url, jd)
     VALUES (?, ?, ?, ?, 'target', ?, ?, ?)`,
  ).run(job.company, job.title, job.track || String(req.body?.track ?? 'markets'), job.location, job.source, job.url, job.description);

  db.prepare('UPDATE job SET application_id = ? WHERE id = ?').run(info.lastInsertRowid as number, job.id);
  res.json({ application_id: info.lastInsertRowid, already: false });
});

const dist = resolve(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.API_PORT ?? 5274); // deliberately not PORT: dev runners inject that for the web server
app.listen(port, () => {
  console.log(`[career-lab] api on http://localhost:${port}  db: ${dbPath}`);
});
