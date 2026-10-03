import { parseBullets, type Store } from './types.ts';

/**
 * What you are looking for, as the app remembers it: set once on the Jobs setup screen and
 * used to build every search, every alert link and the text jobs are ranked against.
 */
export interface JobPrefs {
  roles: string[];
  places: { label: string; country: string; city: string }[];
  remote: boolean;
  levels: ('intern' | 'junior' | 'mid')[];
  langs: ('es' | 'en')[];
  /** Where you want to go — which can differ from what your CV shows. */
  fields?: string[];
  /** How much experience you have: decides how hard senior roles are pushed away. */
  experience?: 'none' | 'some' | 'experienced';
}

/** The fields someone might want to move into, independent of their CV. */
export const FIELDS: { id: string; en: string; es: string }[] = [
  { id: 'finance', en: 'Finance & banking', es: 'Finanzas y banca' },
  { id: 'accounting', en: 'Accounting & audit', es: 'Contabilidad y auditoría' },
  { id: 'data', en: 'Data & analytics', es: 'Datos y analítica' },
  { id: 'consulting', en: 'Consulting & strategy', es: 'Consultoría y estrategia' },
  { id: 'marketing', en: 'Marketing & communication', es: 'Marketing y comunicación' },
  { id: 'sales', en: 'Sales & business development', es: 'Ventas y desarrollo comercial' },
  { id: 'operations', en: 'Operations & supply chain', es: 'Operaciones y logística' },
  { id: 'product', en: 'Product & project management', es: 'Producto y proyectos' },
  { id: 'tech', en: 'Software & IT', es: 'Software e IT' },
  { id: 'hr', en: 'People & HR', es: 'Personas y RRHH' },
  { id: 'legal', en: 'Legal', es: 'Legales' },
  { id: 'admin', en: 'Administration', es: 'Administración' },
];

/** The CV wizard's "which area?" answer, translated into fields, so nothing is asked twice. */
export const fieldsFromTracks = (tracks: string[]) => [...new Set(tracks.flatMap((t) => ({
  finance: ['finance'], ib: ['finance'], consulting: ['consulting'], data: ['data'], tech: ['tech'], product: ['product', 'marketing', 'operations'],
} as Record<string, string[]>)[t] ?? []))];

export const readPrefs = (store: Store): JobPrefs | null => {
  try {
    const p = JSON.parse(store.setting['job_prefs'] || 'null') as JobPrefs | null;
    return p && Array.isArray(p.roles) ? p : null;
  } catch { return null; }
};

/**
 * The text every posting is ranked against. Deliberately not the whole CV: the roles you want,
 * what you study and what you can do say far more about fit than bullet-point stories do.
 */
export function searchProfile(store: Store, prefs: JobPrefs | null): string {
  const p = store.profile;
  const edu = store.experience.filter((e) => e.kind === 'education').map((e) => [e.title, e.org].filter(Boolean).join(', '));
  const did = store.experience.filter((e) => e.kind !== 'education').map((e) => e.title || e.org).filter(Boolean);
  const levelWords: Record<string, string> = { intern: 'internship / pasantía', junior: 'junior / entry level / trainee', mid: 'semi-senior' };
  return [
    prefs?.roles.length ? `Job I am looking for: ${prefs.roles.join('; ')}.` : '',
    prefs?.levels.length ? `Level: ${prefs.levels.map((l) => levelWords[l]).join(', ')}.` : '',
    p.headline && `Headline: ${p.headline}.`,
    edu.length ? `Studies: ${edu.join('; ')}.` : '',
    p.skills && `Skills: ${p.skills.replace(/\n/g, '; ')}.`,
    did.length ? `Experience: ${did.join('; ')}.` : '',
    p.summary && `About me: ${p.summary.slice(0, 400)}`,
    !prefs && store.experience.flatMap((e) => parseBullets(e.bullets).map((b) => b.text)).slice(0, 4).join(' '),
  ].filter(Boolean).join('\n');
}

export const COUNTRY_CODES: { code: string; en: string; es: string; lang: 'es' | 'en' | 'pt' }[] = [
  { code: 'AR', en: 'Argentina', es: 'Argentina', lang: 'es' },
  { code: 'CO', en: 'Colombia', es: 'Colombia', lang: 'es' },
  { code: 'UY', en: 'Uruguay', es: 'Uruguay', lang: 'es' },
  { code: 'CL', en: 'Chile', es: 'Chile', lang: 'es' },
  { code: 'PE', en: 'Peru', es: 'Perú', lang: 'es' },
  { code: 'MX', en: 'Mexico', es: 'México', lang: 'es' },
  { code: 'BR', en: 'Brazil', es: 'Brasil', lang: 'pt' },
  { code: 'ES', en: 'Spain', es: 'España', lang: 'es' },
  { code: 'US', en: 'United States', es: 'Estados Unidos', lang: 'en' },
  { code: 'GB', en: 'United Kingdom', es: 'Reino Unido', lang: 'en' },
  { code: 'DE', en: 'Germany', es: 'Alemania', lang: 'en' },
  { code: 'CA', en: 'Canada', es: 'Canadá', lang: 'en' },
  { code: 'PT', en: 'Portugal', es: 'Portugal', lang: 'pt' },
  { code: 'NL', en: 'Netherlands', es: 'Países Bajos', lang: 'en' },
];

export const countryName = (code: string, lang: 'en' | 'es') =>
  COUNTRY_CODES.find((c) => c.code === code)?.[lang] ?? code;

/** JSearch searches: every role in every place, local language first, capped to the run budget. */
export function jsearchQueries(prefs: JobPrefs, max = 12) {
  const out: { query: string; country: string; language: string }[] = [];
  // Role first, then every place, so a small budget still covers every place for the top roles.
  for (const role of prefs.roles) {
    for (const place of prefs.places) {
      const c = COUNTRY_CODES.find((x) => x.code === place.country);
      out.push({ query: `${role} ${place.city || place.label}`.trim(), country: place.country, language: c?.lang ?? 'es' });
    }
  }
  return out.slice(0, max);
}

/**
 * Searches to save as alerts on each site. These open the site's own search with the role and
 * place filled in; from there one click ("Set alert", "Crear alerta") makes it email you daily.
 */
export function alertLinks(prefs: JobPrefs) {
  const out: { site: string; label: string; url: string }[] = [];
  const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const sub: Record<string, string> = { AR: 'ar', CO: 'co', CL: 'cl', PE: 'pe', MX: 'mx', UY: 'uy', ES: 'es' };
  for (const role of prefs.roles) {
    for (const place of prefs.places) {
      const where = place.city || place.label;
      const label = `${role} · ${where}`;
      out.push({ site: 'LinkedIn', label, url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(role)}&location=${encodeURIComponent(where)}` });
      const s = sub[place.country];
      if (s) {
        out.push({ site: 'Computrabajo', label, url: `https://${s}.computrabajo.com/trabajo-de-${slug(role)}${place.city ? `-en-${slug(place.city)}` : ''}` });
        out.push({ site: 'Indeed', label, url: `https://${s}.indeed.com/jobs?q=${encodeURIComponent(role)}&l=${encodeURIComponent(place.city)}` });
      }
      if (place.country === 'AR') {
        out.push({ site: 'Bumeran', label, url: `https://www.bumeran.com.ar/empleos-busqueda-${slug(role)}.html` });
      }
    }
    if (prefs.remote) {
      out.push({ site: 'LinkedIn', label: `${role} · Remote`, url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(role)}&f_WT=2` });
    }
  }
  return out;
}
