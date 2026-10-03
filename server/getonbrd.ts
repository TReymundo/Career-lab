import { insertJobs, type IncomingJob } from './jobs.ts';

/**
 * Get on Board — Latin America's tech, data and business job board — through its public API.
 * No key, no account. Its fully-remote roles are open across the region, so they are labelled
 * "Remote · LATAM"; "remote_local" ones are remote but only within their own country.
 */

const SENIORITY: Record<string, string> = { '1': 'Internship', '2': 'Junior', '3': 'Semi Senior', '4': 'Senior', '5': 'Senior' };
const COUNTRY: Record<string, string> = {
  Argentina: 'AR', Chile: 'CL', Colombia: 'CO', Peru: 'PE', 'Perú': 'PE', Mexico: 'MX', 'México': 'MX', Uruguay: 'UY', Brazil: 'BR', Brasil: 'BR',
};

const strip = (s: string) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

interface GobJob {
  id: string;
  attributes: {
    title: string; description?: string; functions?: string; countries?: string[]; remote?: boolean; remote_modality?: string;
    published_at?: number; seniority?: { data?: { id?: number | string } }; company?: { data?: { attributes?: { name?: string } } };
  };
  links?: { public_url?: string };
}

export async function pullGetOnBoard(queries: string[]) {
  const all: IncomingJob[] = [];
  const errors: string[] = [];
  for (const q of queries.slice(0, 10)) {
    try {
      const url = `https://www.getonbrd.com/api/v0/search/jobs?query=${encodeURIComponent(q)}&per_page=60&page=1&expand=${encodeURIComponent('["company"]')}`;
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Get on Board returned ${res.status}`);
      const body = await res.json() as { data?: GobJob[] };
      for (const j of body.data ?? []) {
        const a = j.attributes;
        const countries = (a.countries ?? []).filter((c) => c !== 'Remote');
        const fully = a.remote && a.remote_modality === 'fully_remote';
        const seniority = SENIORITY[String(a.seniority?.data?.id ?? '')] ?? '';
        all.push({
          source: 'getonbrd',
          external_id: j.id,
          company: a.company?.data?.attributes?.name ?? '',
          // The seniority goes into the title only when the title does not already say it, so the level filter can read it.
          title: seniority && !new RegExp(seniority.split(' ')[0], 'i').test(a.title) && seniority !== 'Senior' ? `${a.title} (${seniority})` : a.title,
          location: fully ? 'Remote · LATAM' : [countries.join(', '), a.remote ? 'Remote' : ''].filter(Boolean).join(' · '),
          url: j.links?.public_url ?? `https://www.getonbrd.com/jobs/${j.id}`,
          posted_on: a.published_at ? new Date(a.published_at * 1000).toISOString().slice(0, 10) : '',
          description: strip(`${a.functions ?? ''} ${a.description ?? ''}`).slice(0, 4000),
          country: fully ? '' : (COUNTRY[countries[0] ?? ''] ?? ''),
          remote: a.remote ? 1 : 0,
        });
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const { inserted } = insertJobs(all.filter((j) => j.company && j.title));
  return { inserted, fetched: all.length, errors: [...new Set(errors)] };
}
