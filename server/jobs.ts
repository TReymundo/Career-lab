import { db } from './db.ts';
import { inScope, readPrefs } from './scope.ts';

export interface IncomingJob {
  source: string;
  external_id?: string;
  company: string;
  title: string;
  location?: string;
  url?: string;
  posted_on?: string;
  description?: string;
  /** When a source already knows where the job is, that beats parsing the location text. */
  country?: string;
  city?: string;
  remote?: number;
}

/**
 * The unique index does the deduping; we just count what actually landed. The same posting
 * often arrives from two sources with different tracking links, so a second check matches on
 * company + title + city before inserting.
 */
export function insertJobs(rows: IncomingJob[]): { inserted: number; skipped: number } {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO job (source, external_id, company, title, location, url, posted_on, description, country, city, remote)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const twin = db.prepare('SELECT 1 FROM job WHERE lower(company) = lower(?) AND lower(title) = lower(?) AND (location = ? OR city = ?) LIMIT 1');
  let inserted = 0;
  const prefs = readPrefs();
  for (const r of rows) {
    if (!r.company && !r.title) continue;
    if (!inScope(r, prefs)) continue;
    const company = r.company.trim();
    const title = r.title.trim();
    const location = (r.location ?? '').trim();
    if (twin.get(company, title, location, (r.city ?? '').trim() || location)) continue;
    const info = stmt.run(
      r.source, r.external_id ?? '', company, title, location, (r.url ?? '').trim(), (r.posted_on ?? '').trim(),
      (r.description ?? '').trim(), (r.country ?? '').trim(), (r.city ?? '').trim(), r.remote ?? 0,
    );
    if (info.changes > 0) inserted++;
  }
  return { inserted, skipped: rows.length - inserted };
}

/** RFC-4180-ish: handles quoted fields, embedded commas, doubled quotes and CRLF. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const head = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const d = delimiter ?? (head.split('\t').length > head.split(',').length ? '\t' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === d) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const FIELD_ALIASES: Record<Exclude<keyof IncomingJob, 'country' | 'city' | 'remote'>, string[]> = {
  source: [],
  external_id: ['job id', 'jobid', 'posting id', 'requisition id'],
  company: ['company name', 'company', 'employer', 'organisation', 'organization', 'empresa'],
  title: ['job title', 'title', 'position', 'role', 'puesto', 'cargo'],
  location: ['location', 'job location', 'city', 'ubicacion', 'ubicación', 'ciudad'],
  url: ['job url', 'url', 'link', 'job link', 'posting url', 'enlace'],
  posted_on: ['posted', 'posted on', 'date', 'saved date', 'application date', 'fecha'],
  description: ['description', 'job description', 'descripcion', 'descripción'],
};

const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

/**
 * Exact match first, then whole-word containment. Substring matching was too eager: a
 * "SAVED_SEARCH_ID" column was being read as the job id, which is how an import of the wrong
 * file quietly reported "0 added" instead of saying what was wrong.
 */
function matchColumn(header: string[], aliases: string[]): number {
  const norm = header.map(normaliseHeader);
  for (const alias of aliases) {
    const at = norm.indexOf(alias);
    if (at >= 0) return at;
  }
  for (const alias of aliases) {
    const at = norm.findIndex((h) => new RegExp(`(^| )${alias}( |$)`).test(h));
    if (at >= 0) return at;
  }
  return -1;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  mapped: Record<string, string>;
  error?: string;
}

/**
 * Maps a header row onto our fields by name. Works with LinkedIn's own "Saved Jobs.csv" and
 * "Job Applications.csv" exports and with any spreadsheet you assemble yourself, without
 * needing an exact column order.
 */
export function importDelimited(text: string, source = 'linkedin-export'): ImportResult {
  const rows = parseDelimited(text);
  if (rows.length < 2) {
    return { inserted: 0, skipped: 0, mapped: {}, error: 'That file has no rows under its header.' };
  }

  const header = rows[0];
  const index: Partial<Record<keyof IncomingJob, number>> = {};
  const mapped: Record<string, string> = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [keyof IncomingJob, string[]][]) {
    if (!aliases.length) continue;
    const at = matchColumn(header, aliases);
    if (at >= 0) { index[field] = at; mapped[header[at]] = field; }
  }

  // Without a company or a title there is no job here, whatever else the file contains.
  if (index.company === undefined && index.title === undefined) {
    const looksLikeSearches = header.some((h) => /search/i.test(h));
    return {
      inserted: 0,
      skipped: rows.length - 1,
      mapped,
      error: looksLikeSearches
        ? 'That is “Saved Job Searches.csv”, which holds your saved search filters rather than any jobs. The file you want from the same archive is “Saved Jobs.csv” or “Job Applications.csv”.'
        : `No company or job-title column found. Its columns are: ${header.slice(0, 8).join(', ')}. The importer needs one column named something like “Company Name” and one like “Job Title”.`,
    };
  }

  const pick = (r: string[], f: keyof IncomingJob) => (index[f] !== undefined ? (r[index[f]!] ?? '').trim() : '');

  const jobs = rows.slice(1)
    .map((r) => ({
      source,
      external_id: pick(r, 'external_id'),
      company: pick(r, 'company'),
      title: pick(r, 'title'),
      location: pick(r, 'location'),
      url: pick(r, 'url'),
      posted_on: pick(r, 'posted_on').slice(0, 10),
      description: pick(r, 'description'),
    }))
    // A row with neither is blank padding, not a job that happens to be a duplicate.
    .filter((j) => j.company || j.title);

  const result = insertJobs(jobs);
  return {
    ...result,
    mapped,
    error: result.inserted === 0 && jobs.length === 0
      ? 'Every row was empty once the columns were matched. Check you exported the right file.'
      : undefined,
  };
}

/**
 * Loose parser for text copied straight off a job board results page: blank-line
 * separated blocks, first line the title, second the company, third the location.
 * Deliberately forgiving — you fix the rows in the table afterwards.
 */
export function importPastedBlocks(text: string, source = 'paste') {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const jobs: IncomingJob[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const urlLine = lines.find((l) => /^https?:\/\//.test(l)) ?? '';
    const rest = lines.filter((l) => l !== urlLine);
    jobs.push({
      source,
      title: rest[0] ?? '',
      company: rest[1] ?? '',
      location: rest[2] ?? '',
      url: urlLine,
      description: rest.slice(3).join('\n'),
    });
  }
  return insertJobs(jobs);
}

const stripHtml = (s: string) =>
  s.replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Public applicant-tracking-system job boards. These are the same JSON endpoints
 * the companies' own careers pages call, so this is reading a public board, not
 * scraping a login-walled site.
 */
export const ATS = {
  greenhouse: (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  lever: (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug: string) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

export async function fetchAts(provider: keyof typeof ATS, slug: string) {
  const res = await fetch(ATS[provider](slug), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${provider}/${slug} returned ${res.status}`);
  const data = await res.json() as any;

  let jobs: IncomingJob[] = [];
  if (provider === 'greenhouse') {
    jobs = (data.jobs ?? []).map((j: any) => ({
      source: 'greenhouse',
      external_id: String(j.id),
      company: j.company_name ?? slug,
      title: j.title ?? '',
      location: j.location?.name ?? '',
      url: j.absolute_url ?? '',
      posted_on: (j.updated_at ?? '').slice(0, 10),
      description: stripHtml(j.content ?? ''),
    }));
  } else if (provider === 'lever') {
    jobs = (Array.isArray(data) ? data : []).map((j: any) => ({
      source: 'lever',
      external_id: String(j.id),
      company: slug,
      title: j.text ?? '',
      location: j.categories?.location ?? '',
      url: j.hostedUrl ?? '',
      posted_on: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : '',
      description: stripHtml(j.descriptionPlain ?? j.description ?? ''),
    }));
  } else {
    jobs = (data.jobs ?? []).map((j: any) => ({
      source: 'ashby',
      external_id: String(j.id),
      company: data.name ?? slug,
      title: j.title ?? '',
      location: j.location ?? '',
      url: j.jobUrl ?? '',
      posted_on: (j.publishedAt ?? '').slice(0, 10),
      description: stripHtml(j.descriptionPlain ?? j.descriptionHtml ?? ''),
    }));
  }
  return insertJobs(jobs);
}

/**
 * LinkedIn's "Download your data" archive: Positions.csv, Education.csv, Skills.csv,
 * Languages.csv and Profile.csv. Fills the Master CV so you type your history once.
 */
export function importLinkedInProfile(filename: string, text: string) {
  const rows = parseDelimited(text);
  if (rows.length < 2) return { imported: 0, into: 'nothing' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const body = rows.slice(1);
  const name = filename.toLowerCase();

  const addExp = db.prepare(
    `INSERT INTO experience (kind, org, title, location, start_date, end_date, bullets, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const nextOrder = () =>
    ((db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM experience').get() as { n: number }).n) + 1;

  if (name.includes('position')) {
    const [c, t, l, s, e, d] = [col('company'), col('title'), col('location'), col('started'), col('finished'), col('description')];
    let n = 0;
    for (const r of body) {
      if (!r[c] && !r[t]) continue;
      const desc = (r[d] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
      addExp.run('work', r[c] ?? '', r[t] ?? '', r[l] ?? '', r[s] ?? '', r[e] ?? '',
        JSON.stringify(desc.map((text) => ({ text, tracks: [] }))), nextOrder());
      n++;
    }
    return { imported: n, into: 'experience' };
  }

  if (name.includes('education')) {
    const [s, deg, f, st, en] = [col('school'), col('degree'), col('notes', 'activities'), col('start'), col('end')];
    let n = 0;
    for (const r of body) {
      if (!r[s]) continue;
      addExp.run('education', r[s], r[deg] ?? '', '', r[st] ?? '', r[en] ?? '',
        JSON.stringify(r[f] ? [{ text: r[f], tracks: [] }] : []), nextOrder());
      n++;
    }
    return { imported: n, into: 'education' };
  }

  if (name.includes('skill') || name.includes('language')) {
    const values = body.map((r) => r[0]).filter(Boolean);
    const field = name.includes('skill') ? 'skills' : 'languages';
    const current = (db.prepare(`SELECT ${field} AS v FROM profile WHERE id = 1`).get() as { v: string }).v;
    const merged = [...new Set([...current.split(',').map((x) => x.trim()).filter(Boolean), ...values])].join(', ');
    db.prepare(`UPDATE profile SET ${field} = ? WHERE id = 1`).run(merged);
    return { imported: values.length, into: field };
  }

  return { imported: 0, into: 'nothing (unrecognised file — expected Positions, Education, Skills or Languages)' };
}
