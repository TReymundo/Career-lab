import { db } from './db.ts';
import { tailorCV, writeLetter, type Lang, type Tailoring } from './ai.ts';
import { findPosting } from './jsearch.ts';

/**
 * The application kit for one job: a CV rewritten for it and a cover letter that sounds like
 * the person, built from their CV *and* their story bank.
 *
 * Two AI calls: first the tailoring (what the job asks for, what in the CV proves it, how to
 * reword and reorder), then the letter (which stories to tell, given that tailoring). Nothing
 * here edits the master CV — the kit is a set of suggestions you accept or reject.
 */

interface Exp { id: number; kind: string; org: string; title: string; location: string; start_date: string; end_date: string; bullets: string }
interface Job { id: number; company: string; title: string; location: string; description: string; lang: string; application_id: number | null; url: string; source: string }

/** The CV as the model sees it: every entry and line addressable by id, so its edits can be applied exactly. */
export function cvForModel() {
  const p = db.prepare('SELECT * FROM profile WHERE id = 1').get() as Record<string, string>;
  const exps = db.prepare('SELECT * FROM experience ORDER BY sort_order, id').all() as unknown as Exp[];
  const lines = [
    `Name: ${p.name}`, `Headline: ${p.headline}`, `Profile: ${p.summary}`,
    `Skills: ${p.skills.replace(/\n/g, ' | ')}`, `Languages: ${p.languages}`, '',
  ];
  for (const e of exps) {
    lines.push(`[entry ${e.id}] (${e.kind}) ${e.org}${e.title ? ` — ${e.title}` : ''}${e.start_date ? ` (${e.start_date}–${e.end_date || 'now'})` : ''}`);
    let bullets: { text: string }[] = [];
    try { bullets = JSON.parse(e.bullets || '[]'); } catch { /* none */ }
    bullets.forEach((b, i) => lines.push(`  [line ${e.id}.${i}] ${b.text}`));
  }
  return lines.join('\n');
}

/** Only stories you have allowed: private ones help understand you but never reach a document. */
export function usableStories() {
  return (db.prepare("SELECT kind, title, body, shows FROM story WHERE private = 0 ORDER BY id DESC LIMIT 80").all() as { kind: string; title: string; body: string; shows: string }[])
    .map((s) => `- (${s.kind}) ${s.title}: ${s.body}${s.shows ? ` [shows: ${s.shows}]` : ''}`).join('\n');
}

export async function buildKit(jobId: number, uiLang: Lang) {
  const job = db.prepare('SELECT * FROM job WHERE id = ?').get(jobId) as unknown as Job | undefined;
  if (!job) throw new Error('No such job.');
  const existing = db.prepare('SELECT jd FROM kit WHERE job_id = ?').get(jobId) as { jd: string } | undefined;
  let jd = (existing?.jd || job.description || '').trim();
  // Alerts carry no posting text — only "From your LinkedIn alert …". Try to find the real
  // posting once (one Google for Jobs search); otherwise say so rather than pretend.
  const real = (s: string) => s.length > 200 && !/^From your LinkedIn alert/i.test(s);
  if (!real(jd)) {
    const found = await findPosting(job.title, job.company, (db.prepare('SELECT country FROM job WHERE id = ?').get(jobId) as { country: string }).country || 'ar');
    if (real(found)) {
      jd = found;
      db.prepare('UPDATE job SET description = ? WHERE id = ?').run(found, jobId);
    }
  }
  const hasPosting = real(jd);
  const lang: Lang = job.lang === 'es' || job.lang === 'en' ? job.lang : uiLang;

  const cv = cvForModel();
  const stories = usableStories();
  const tailoring: Tailoring = await tailorCV({ cv, stories, company: job.company, role: job.title, jd: hasPosting ? jd : '', lang });
  const letter = await writeLetter({ cv, stories, company: job.company, role: job.title, jd: hasPosting ? jd : '', tailoring, lang });

  const data = { ...tailoring, letter, lang, hasPosting, builtAt: new Date().toISOString() };
  db.prepare(`INSERT INTO kit (job_id, application_id, data, decisions) VALUES (?, ?, ?, '{}')
              ON CONFLICT(job_id) DO UPDATE SET data = excluded.data, decisions = '{}'`)
    .run(jobId, job.application_id, JSON.stringify(data));
  return getKit(jobId);
}

export function getKit(jobId: number) {
  const row = db.prepare('SELECT * FROM kit WHERE job_id = ?').get(jobId) as { id: number; job_id: number; application_id: number | null; data: string; decisions: string; jd: string } | undefined;
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data || '{}'), decisions: JSON.parse(row.decisions || '{}') };
}
