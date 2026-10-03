import { insertJobs, type IncomingJob } from './jobs.ts';

/**
 * Open job feeds — public APIs that hand back real, current postings in bulk.
 *
 * This is what makes "I need a lot of jobs" a button rather than an afternoon. Company job
 * boards return one employer at a time and only work for companies on Greenhouse, Lever or
 * Ashby; these return hundreds across every employer on them, filtered by whatever you search.
 *
 * All four are documented public endpoints that need no key and no account. They lean remote,
 * which is the point: remote listings are the ones a candidate anywhere can actually take.
 */

export type FeedId = 'remotive' | 'arbeitnow' | 'jobicy' | 'himalayas';

export const FEEDS: { id: FeedId; label: string; note: string }[] = [
  { id: 'remotive', label: 'Remotive', note: 'Remote roles across tech, finance, marketing and support' },
  { id: 'arbeitnow', label: 'Arbeitnow', note: 'European and remote roles, many English-speaking' },
  { id: 'jobicy', label: 'Jobicy', note: 'Remote roles with industry tags' },
  { id: 'himalayas', label: 'Himalayas', note: 'Remote-first companies' },
];

const stripHtml = (s: string) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const day = (v: unknown) => {
  const d = new Date(typeof v === 'number' ? v * 1000 : String(v ?? ''));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

interface Fetched extends IncomingJob { category?: string }

/**
 * Feeds mix real industry tags with contract types. "Full Time" is not an industry, and a
 * grid grouped by it tells you nothing, so those are dropped in favour of the next tag along.
 */
const NOT_A_CATEGORY = /^(full[\s-]?time|part[\s-]?time|contract|permanent|temporary|internship|freelance|experienced|entry|mid|senior|junior|remote|hybrid|on[\s-]?site)$/i;
const pickCategory = (...candidates: unknown[]): string => {
  for (const c of candidates.flat()) {
    const v = String(c ?? '').trim();
    if (v && !NOT_A_CATEGORY.test(v)) return v;
  }
  return '';
};

/**
 * Feeds without a server-side search are filtered here. Matching any word rather than the
 * whole phrase matters: "analista junior finanzas" as one string matches almost nothing,
 * while its words match plenty.
 */
function matches(query: string, ...fields: unknown[]) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return true;
  const hay = fields.map((f) => (Array.isArray(f) ? f.join(' ') : String(f ?? ''))).join(' ').toLowerCase();
  return words.some((w) => hay.includes(w));
}

async function getJson(url: string, ms = 15000): Promise<unknown> {
  const stop = AbortSignal.timeout(ms);
  const res = await fetch(url, { signal: stop, headers: { accept: 'application/json', 'user-agent': 'career-lab/1.0' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function remotive(query: string): Promise<Fetched[]> {
  const url = `https://remotive.com/api/remote-jobs?limit=100${query ? `&search=${encodeURIComponent(query)}` : ''}`;
  const data = await getJson(url) as { jobs?: Record<string, unknown>[] };
  return (data.jobs ?? []).map((j) => ({
    source: 'remotive',
    external_id: String(j.id ?? ''),
    company: String(j.company_name ?? ''),
    title: String(j.title ?? ''),
    location: String(j.candidate_required_location ?? 'Remote'),
    url: String(j.url ?? ''),
    posted_on: day(j.publication_date),
    description: stripHtml(j.description as string).slice(0, 4000),
    category: pickCategory(j.category),
  }));
}

async function arbeitnow(query: string): Promise<Fetched[]> {
  // Two pages, because everything here is filtered client-side and one page is a thin pool.
  const pages = await Promise.all([1, 2].map((p) =>
    getJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`).catch(() => ({})) as Promise<{ data?: Record<string, unknown>[] }>));
  const rows = pages.flatMap((d) => d.data ?? []);
  return rows
    .filter((j) => matches(query, j.title, j.description, j.tags, j.job_types, j.company_name))
    .map((j) => ({
      source: 'arbeitnow',
      external_id: String(j.slug ?? ''),
      company: String(j.company_name ?? ''),
      title: String(j.title ?? ''),
      location: j.remote ? `Remote${j.location ? ` · ${j.location}` : ''}` : String(j.location ?? ''),
      url: String(j.url ?? ''),
      posted_on: day(j.created_at),
      description: stripHtml(j.description as string).slice(0, 4000),
      category: pickCategory(j.tags, j.job_types),
    }));
}

async function jobicy(query: string): Promise<Fetched[]> {
  const url = `https://jobicy.com/api/v2/remote-jobs?count=50${query ? `&tag=${encodeURIComponent(query)}` : ''}`;
  const data = await getJson(url) as { jobs?: Record<string, unknown>[] };
  return (data.jobs ?? []).map((j) => ({
    source: 'jobicy',
    external_id: String(j.id ?? ''),
    company: String(j.companyName ?? ''),
    title: String(j.jobTitle ?? ''),
    location: String(j.jobGeo ?? 'Remote'),
    url: String(j.url ?? ''),
    posted_on: day(j.pubDate),
    description: stripHtml((j.jobExcerpt ?? j.jobDescription) as string).slice(0, 4000),
    category: pickCategory(j.jobIndustry, j.jobType),
  }));
}

async function himalayas(query: string): Promise<Fetched[]> {
  const first = await getJson('https://himalayas.app/jobs/api?limit=100') as { jobs?: Record<string, unknown>[]; nextCursor?: string };
  const second = first.nextCursor
    ? await getJson(`https://himalayas.app/jobs/api?limit=100&cursor=${encodeURIComponent(first.nextCursor)}`)
        .catch(() => ({})) as { jobs?: Record<string, unknown>[] }
    : {};
  const rows = [...(first.jobs ?? []), ...(second.jobs ?? [])];
  return rows
    .filter((j) => matches(query, j.title, j.excerpt, j.categories, j.parentCategories, j.companyName, j.seniority))
    .map((j) => ({
      source: 'himalayas',
      external_id: String(j.guid ?? ''),
      company: String(j.companyName ?? ''),
      title: String(j.title ?? ''),
      location: (j.locationRestrictions as string[] ?? []).join(', ') || 'Remote',
      url: String(j.applicationLink ?? ''),
      posted_on: day(j.pubDate),
      description: stripHtml(j.excerpt as string).slice(0, 4000),
      category: pickCategory(j.parentCategories, j.categories),
    }));
}

const IMPLS: Record<FeedId, (q: string) => Promise<Fetched[]>> = { remotive, arbeitnow, jobicy, himalayas };

/** Arbeitnow is a German board — mostly on-site roles in Germany — so it is opt-in, not default. */
export const DEFAULT_FEEDS: FeedId[] = ['remotive', 'jobicy', 'himalayas'];

export interface PullReport {
  inserted: number;
  skipped: number;
  fetched: number;
  perFeed: { feed: string; fetched: number; error?: string }[];
}

/**
 * Runs every requested query against every requested feed and files everything that comes
 * back. Feeds are queried in parallel but queries run in sequence, so a long list of searches
 * does not open forty sockets at once.
 */
export async function pullJobs(queries: string[], feeds: FeedId[] = DEFAULT_FEEDS): Promise<PullReport> {
  const terms = queries.map((q) => q.trim()).filter(Boolean);
  const searches = terms.length ? terms : [''];
  const perFeed = new Map<string, { fetched: number; error?: string }>();
  const all: Fetched[] = [];

  for (const query of searches) {
    const results = await Promise.allSettled(feeds.map(async (f) => ({ feed: f, jobs: await IMPLS[f](query) })));
    for (const [i, r] of results.entries()) {
      const feed = feeds[i];
      const entry = perFeed.get(feed) ?? { fetched: 0 };
      if (r.status === 'fulfilled') {
        entry.fetched += r.value.jobs.length;
        all.push(...r.value.jobs);
      } else {
        entry.error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      }
      perFeed.set(feed, entry);
    }
  }

  // Remotive, Jobicy and Himalayas list nothing but remote roles; Arbeitnow says per posting.
  const usable = all.filter((j) => j.company && j.title)
    .map((j) => (j.source === 'arbeitnow' ? { ...j, remote: /^Remote/.test(j.location ?? '') ? 1 : 0 } : { ...j, remote: 1 }));
  const { inserted, skipped } = insertJobs(usable);

  // Categories arrive with the posting; storing them is what makes the grid groupable.
  const { db } = await import('./db.ts');
  const setCategory = db.prepare('UPDATE job SET category = ? WHERE url = ? AND category = \'\'');
  for (const j of usable) if (j.category && j.url) setCategory.run(j.category, j.url);

  return {
    inserted,
    skipped,
    fetched: usable.length,
    perFeed: [...perFeed.entries()].map(([feed, v]) => ({ feed, ...v })),
  };
}
