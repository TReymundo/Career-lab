import { db } from './db.ts';
import { insertJobs, type IncomingJob } from './jobs.ts';

/**
 * Google for Jobs, through JSearch on RapidAPI.
 *
 * Google already indexes postings from LinkedIn, Bumeran, Computrabajo, Indeed and company
 * careers sites, by country — which is the legitimate way to get local jobs in bulk, since
 * none of those sites offers a public search API of its own.
 *
 * The free plan is 200 requests a month, so every request is counted here and a run stops
 * well before the allowance is gone. The key lives in .env as JSEARCH_KEY.
 */

const MONTHLY_FREE = 200;
const HOST = 'jsearch.p.rapidapi.com';

export const jsearchConfigured = () => Boolean(process.env.JSEARCH_KEY);

function usage() {
  const month = new Date().toISOString().slice(0, 7);
  const row = db.prepare("SELECT value FROM setting WHERE key = 'jsearch_usage'").get() as { value: string } | undefined;
  try {
    const u = JSON.parse(row?.value ?? '') as { month: string; count: number };
    if (u.month === month) return u;
  } catch { /* first use, or a new month */ }
  return { month, count: 0 };
}

function count(n: number) {
  const u = usage();
  db.prepare("INSERT INTO setting (key, value) VALUES ('jsearch_usage', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ month: u.month, count: u.count + n }));
}

export const jsearchStatus = () => ({ configured: jsearchConfigured(), used: usage().count, limit: MONTHLY_FREE });

export interface JSearchQuery { query: string; country: string; language: string }

interface JSearchJob {
  job_id?: string; job_title?: string; employer_name?: string; job_apply_link?: string; job_description?: string;
  job_city?: string; job_state?: string; job_country?: string; job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string; job_publisher?: string;
}

/**
 * The full text of one posting, looked up by title and company — for jobs that arrived from an
 * alert email with no description. One search from the monthly allowance; the result is only
 * used if the employer clearly matches.
 */
export async function findPosting(title: string, company: string, country = 'ar'): Promise<string> {
  if (!jsearchConfigured()) return '';
  if (MONTHLY_FREE - 10 - usage().count <= 0) return '';
  const params = new URLSearchParams({ query: `${title} ${company}`, page: '1', num_pages: '1', country: country.toLowerCase() || 'ar' });
  try {
    const res = await fetch(`https://${HOST}/search-v2?${params}`, {
      headers: { 'x-rapidapi-key': process.env.JSEARCH_KEY!, 'x-rapidapi-host': HOST }, signal: AbortSignal.timeout(30000),
    });
    count(1);
    if (!res.ok) return '';
    const body = await res.json() as { data?: JSearchJob[] | { jobs?: JSearchJob[]; data?: JSearchJob[] } };
    const list = Array.isArray(body.data) ? body.data : (body.data?.jobs ?? body.data?.data ?? []);
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const want = norm(company).split(' ').filter((w) => w.length > 2);
    const hit = list.find((j) => { const e = norm(j.employer_name ?? ''); return want.some((w) => e.includes(w)); });
    return (hit?.job_description ?? '').slice(0, 6000);
  } catch { return ''; }
}

/** One request per query; the run stops early rather than spend the last of the month's allowance. */
export async function pullJSearch(queries: JSearchQuery[], maxRequests = 12) {
  if (!jsearchConfigured()) throw new Error('JSearch is not connected yet. Add your free RapidAPI key in Sources.');
  const left = Math.max(0, MONTHLY_FREE - 10 - usage().count);
  const run = queries.slice(0, Math.min(maxRequests, left));
  if (!run.length) throw new Error(`This month’s free JSearch allowance is used up (${usage().count}/${MONTHLY_FREE}). It resets on the 1st.`);

  const all: (IncomingJob & { country: string; city: string; remote: number })[] = [];
  const errors: string[] = [];

  for (const q of run) {
    const params = new URLSearchParams({ query: q.query, page: '1', num_pages: '1', date_posted: 'month' });
    if (q.country) params.set('country', q.country.toLowerCase());
    if (q.language) params.set('language', q.language);
    try {
      // /search was retired in favour of /search-v2 (same parameters; cursor-based paging).
      const res = await fetch(`https://${HOST}/search-v2?${params}`, {
        headers: { 'x-rapidapi-key': process.env.JSEARCH_KEY!, 'x-rapidapi-host': HOST },
        signal: AbortSignal.timeout(30000),
      });
      count(1);
      if (res.status === 401 || res.status === 403) throw new Error('RapidAPI rejected the key — check it, and that you subscribed to JSearch’s free plan.');
      if (res.status === 429) throw new Error('RapidAPI says the limit is reached for now.');
      if (!res.ok) throw new Error(`JSearch returned ${res.status}${res.status === 404 ? ' — the endpoint moved again; nothing more was spent' : ''}`);
      const body = await res.json() as { data?: JSearchJob[] | { jobs?: JSearchJob[]; data?: JSearchJob[] } };
      const list = Array.isArray(body.data) ? body.data : (body.data?.jobs ?? body.data?.data ?? []);
      for (const j of list) {
        all.push({
          source: `jsearch${j.job_publisher ? `:${j.job_publisher}` : ''}`,
          external_id: j.job_id ?? '',
          company: j.employer_name ?? '',
          title: j.job_title ?? '',
          location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || (j.job_is_remote ? 'Remote' : ''),
          url: j.job_apply_link ?? '',
          posted_on: (j.job_posted_at_datetime_utc ?? '').slice(0, 10),
          description: (j.job_description ?? '').slice(0, 4000),
          country: (j.job_country ?? '').toUpperCase().slice(0, 2),
          city: j.job_city ?? '',
          remote: j.job_is_remote ? 1 : 0,
        });
      }
    } catch (e) {
      // Any failure stops the run: a broken setup must never burn through the month's allowance.
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }

  const usable = all.filter((j) => j.company && j.title);
  const { inserted, skipped } = insertJobs(usable);
  return { inserted, skipped, fetched: usable.length, requests: run.length, used: usage().count, limit: MONTHLY_FREE, errors: [...new Set(errors)] };
}
