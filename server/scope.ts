import { db } from './db.ts';
import { parseLocation } from './normalize.ts';

/**
 * Which jobs belong in your list at all.
 *
 * Your places (from the Jobs setup, seeded from your CV) and — if you said yes to remote —
 * remote roles someone in those countries can actually take. A job in Berlin, or a remote
 * role restricted to the US or Europe, is dropped when it arrives rather than hidden later:
 * a list padded with jobs you cannot take is exactly what makes a job site useless.
 */

export interface Prefs {
  roles: string[];
  places: { label: string; country: string; city: string }[];
  remote: boolean;
  levels: string[];
  langs: string[];
  fields?: string[];
  experience?: 'none' | 'some' | 'experienced';
}

export function readPrefs(): Prefs | null {
  const row = db.prepare("SELECT value FROM setting WHERE key = 'job_prefs'").get() as { value: string } | undefined;
  try { const p = JSON.parse(row?.value ?? 'null') as Prefs | null; return p && Array.isArray(p.roles) ? p : null; } catch { return null; }
}

// Remote roles open to Latin America, or to anyone.
const OPEN = /\b(worldwide|anywhere|global|globally|latam|latin america|latinoam[eé]rica|south america|sudam[eé]rica|americas|lat\.?am|remote[- ]first|100% remote)\b/i;
// Remote roles closed to someone in Argentina.
const CLOSED = /\b(us|usa|u\.s\.|united states|canada|uk|united kingdom|europe|european|eu|emea|apac|asia|india|africa|australia|germany|deutschland|france|spain|netherlands|poland|portugal|italy|ireland|sweden|switzerland|austria|belgium|philippines|mexico only)\b/i;

export function inScope(job: { location?: string; title?: string; country?: string; remote?: number }, prefs: Prefs | null = readPrefs()) {
  if (!prefs) return true; // nothing chosen yet: keep everything
  const loc = parseLocation(job.location ?? '', job.title ?? '');
  const country = (job.country || loc.country).toUpperCase();
  const countries = new Set(prefs.places.map((p) => p.country));
  if (country && countries.has(country)) return true;
  const remote = Boolean(job.remote) || Boolean(loc.remote);
  if (!prefs.remote || !remote) return false;
  const where = `${job.location ?? ''}`;
  // Remote and explicitly open to the region, or with no restriction named at all.
  if (OPEN.test(where)) return true;
  if (country && !countries.has(country)) return false;
  return !CLOSED.test(where);
}

/** Drops everything already stored that is out of scope — except jobs you saved or applied to. */
export function purgeOutOfScope() {
  const prefs = readPrefs();
  if (!prefs) return 0;
  const rows = db.prepare('SELECT id, location, title, country, remote FROM job WHERE starred = 0 AND application_id IS NULL').all() as
    { id: number; location: string; title: string; country: string; remote: number }[];
  const del = db.prepare('DELETE FROM job WHERE id = ?');
  let n = 0;
  for (const r of rows) if (!inScope(r, prefs)) { del.run(r.id); n++; }
  return n;
}
