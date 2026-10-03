import { createHash } from 'node:crypto';
import { db } from './db.ts';
import { RateLimited, embed } from './ai.ts';

/**
 * How relevant each job is to you, as a 0–100 score.
 *
 * Every posting and the CV become embeddings (gemini-embedding-001, 256 numbers each), and
 * relevance is how close they sit. That is one cheap call per hundred postings, so it scales
 * to thousands — the expensive, careful AI read (judgeFit) is saved for the top few.
 *
 * Your own reactions then bend the ranking: jobs that resemble ones you saved move up, jobs
 * that resemble ones you marked "not for me" move down.
 */

const cosine = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
};

/**
 * Stored as raw similarity ×100. This model's similarities bunch together (most jobs land
 * between 70 and 90), so what the screen shows is a percentile over your whole list — "top
 * 5%" — which is the comparison that actually means something.
 */
const toScore = (cos: number) => Math.round(cos * 1000) / 10;

// The title carries most of the meaning; a long description drowns it in boilerplate.
const jobText = (j: { title: string; company: string; location: string; description: string }) =>
  `${j.title}\n${j.title} at ${j.company}\n${j.description.slice(0, 700)}`;

// Vectors made with an earlier model setting are not comparable with new ones: start over once.
const EMBED_VERSION = '3';
if ((db.prepare("SELECT value FROM setting WHERE key = 'embed_version'").get() as { value: string } | undefined)?.value !== EMBED_VERSION) {
  db.prepare("UPDATE job SET embedding = '', relevance = -1").run();
  db.prepare("DELETE FROM setting WHERE key = 'cv_embedding'").run();
  db.prepare("INSERT INTO setting (key, value) VALUES ('embed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(EMBED_VERSION);
}

function getSetting(key: string) {
  return (db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? '';
}
function putSetting(key: string, value: string) {
  db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** The CV vector, recomputed only when the CV text changes — and then every score is redone. */
async function cvVector(cv: string): Promise<number[]> {
  const hash = createHash('sha1').update(cv).digest('hex');
  try {
    const cached = JSON.parse(getSetting('cv_embedding')) as { hash: string; v: number[] };
    if (cached.hash === hash) return cached.v;
  } catch { /* none yet */ }
  const [v] = await embed([cv], 'RETRIEVAL_QUERY');
  putSetting('cv_embedding', JSON.stringify({ hash, v }));
  db.prepare('UPDATE job SET relevance = -1').run();
  return v;
}

/**
 * Scores up to `batches` hundred unscored jobs. The caller repeats until `remaining` is 0,
 * pausing when `wait` says so — that is how a list of thousands gets through a free quota.
 */
export async function scoreJobs(cv: string, batches = 1) {
  const remainingNow = () => (db.prepare("SELECT COUNT(*) AS n FROM job WHERE embedding = '' AND dismissed = 0").get() as { n: number }).n;
  let cvv: number[];
  try { cvv = await cvVector(cv); }
  catch (e) {
    if (e instanceof RateLimited) return { scored: 0, remaining: remainingNow(), wait: e.window === 'day' ? -1 : 60 };
    throw e;
  }
  const max = batches * 100;

  // Jobs that already have a vector only need the cheap part redone.
  const stale = db.prepare("SELECT id, embedding FROM job WHERE relevance < 0 AND embedding != ''").all() as { id: number; embedding: string }[];
  const setScore = db.prepare('UPDATE job SET relevance = ? WHERE id = ?');
  for (const r of stale) {
    try { setScore.run(toScore(cosine(cvv, JSON.parse(r.embedding))), r.id); } catch { /* bad row; re-embed below */ }
  }

  const todo = db.prepare("SELECT id, title, company, location, description FROM job WHERE embedding = '' AND dismissed = 0 ORDER BY id DESC LIMIT ?")
    .all(max) as { id: number; title: string; company: string; location: string; description: string }[];
  const setBoth = db.prepare('UPDATE job SET embedding = ?, relevance = ? WHERE id = ?');
  let done = 0;
  let wait = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    let vectors: number[][];
    try { vectors = await embed(batch.map(jobText)); }
    catch (e) {
      if (e instanceof RateLimited) { wait = e.window === 'day' ? -1 : 60; break; }
      throw e;
    }
    batch.forEach((j, k) => {
      const v = vectors[k];
      if (v) { setBoth.run(JSON.stringify(v), toScore(cosine(cvv, v)), j.id); done++; }
    });
  }
  const remaining = remainingNow();
  // A full batch just went through: the next one should wait out the minute anyway.
  return { scored: done + stale.length, remaining, wait: wait || (remaining > 0 ? 60 : 0) };
}

/** Where a raw relevance sits among all your scored jobs, as 0–100 ("top 5%" = 95). */
export function percentiles() {
  const vals = (db.prepare('SELECT relevance FROM job WHERE relevance >= 0 AND dismissed = 0 ORDER BY relevance').all() as { relevance: number }[])
    .map((r) => r.relevance);
  return (x: number) => {
    if (!vals.length || x < 0) return -1;
    let lo = 0;
    let hi = vals.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] < x) lo = mid + 1; else hi = mid; }
    return Math.round((lo / vals.length) * 100);
  };
}

/**
 * Personal ranking: base relevance, nudged towards what you saved and away from what you
 * dismissed. Only applies once you have reacted to at least a couple of jobs.
 */
export function personalBoost() {
  const centroid = (sql: string) => {
    const rows = db.prepare(sql).all() as { embedding: string }[];
    const vs = rows.map((r) => { try { return JSON.parse(r.embedding) as number[]; } catch { return null; } }).filter(Boolean) as number[][];
    if (vs.length < 2) return null;
    const c = vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);
    const n = Math.hypot(...c) || 1;
    return c.map((x) => x / n);
  };
  const liked = centroid("SELECT embedding FROM job WHERE starred = 1 AND embedding != '' LIMIT 200");
  const disliked = centroid("SELECT embedding FROM job WHERE dismissed = 1 AND embedding != '' ORDER BY id DESC LIMIT 200");

  return (embedding: string): number => {
    if ((!liked && !disliked) || !embedding) return 0;
    let v: number[];
    try { v = JSON.parse(embedding); } catch { return 0; }
    // In the same units as relevance (similarity ×100), where the whole pool spans ~20 points.
    return (liked ? (cosine(v, liked) - 0.7) * 15 : 0) - (disliked ? (cosine(v, disliked) - 0.7) * 15 : 0);
  };
}
