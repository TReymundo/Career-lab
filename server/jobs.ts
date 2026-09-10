import { db } from './db.ts';

export interface IncomingJob {
  source: string;
  external_id?: string;
  company: string;
  title: string;
  location?: string;
  url?: string;
  posted_on?: string;
  description?: string;
}

/** The unique index does the deduping; we just count what actually landed. */
export function insertJobs(rows: IncomingJob[]): { inserted: number; skipped: number } {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO job (source, external_id, company, title, location, url, posted_on, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  for (const r of rows) {
    if (!r.company && !r.title) continue;
    const info = stmt.run(
      r.source, r.external_id ?? '', r.company.trim(), r.title.trim(),
      (r.location ?? '').trim(), (r.url ?? '').trim(), (r.posted_on ?? '').trim(),
      (r.description ?? '').trim(),
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

const FIELD_ALIASES: Record<keyof IncomingJob, string[]> = {
  source: [],
  external_id: ['job id', 'id', 'posting id'],
  company: ['company name', 'company', 'employer', 'organisation', 'organization', 'empresa'],
  title: ['job title', 'title', 'position', 'role', 'puesto', 'cargo'],
  location: ['location', 'job location', 'city', 'ubicaci', 'ciudad'],
  url: ['job url', 'url', 'link', 'job link', 'posting url', 'enlace'],
  posted_on: ['posted', 'date', 'saved date', 'application date', 'fecha'],
  description: ['description', 'job description', 'descripci'],
};

/**
 * Maps a header row onto our fields by fuzzy name. Works with LinkedIn's own
 * "Saved Jobs.csv" / "Job Applications.csv" exports and with any spreadsheet
 * you assemble yourself, without needing an exact column order.
 */
export function importDelimited(text: string, source = 'linkedin-export') {
  const rows = parseDelimited(text);
  if (rows.length < 2) return { inserted: 0, skipped: 0, mapped: {} as Record<string, string> };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index: Partial<Record<keyof IncomingJob, number>> = {};
  const mapped: Record<string, string> = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [keyof IncomingJob, string[]][]) {
    const at = header.findIndex((h) => aliases.some((a) => h.includes(a)));
    if (at >= 0) { index[field] = at; mapped[rows[0][at]] = field; }
  }
  if (index.company === undefined && index.title === undefined) {
    return { inserted: 0, skipped: rows.length - 1, mapped };
  }

  const pick = (r: string[], f: keyof IncomingJob) => (index[f] !== undefined ? (r[index[f]!] ?? '') : '');
  const jobs = rows.slice(1).map((r) => ({
    source,
    external_id: pick(r, 'external_id'),
    company: pick(r, 'company'),
    title: pick(r, 'title'),
    location: pick(r, 'location'),
    url: pick(r, 'url'),
    posted_on: pick(r, 'posted_on').slice(0, 10),
    description: pick(r, 'description'),
  }));
  return { ...insertJobs(jobs), mapped };
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
