import { db } from './db.ts';

/**
 * Turns the free-text location, title and description every source sends into fields you can
 * filter on: a country code, a city, remote or not, a seniority level and a language.
 *
 * Rules, not a model: it runs over thousands of rows on every import and must be instant and
 * free. Anything it cannot place is left blank and still shows up under "any".
 */

const PLACES: [RegExp, string, string][] = [
  // [pattern, country code, canonical city ('' when the pattern is the country itself)]
  [/\b(caba|capital federal|ciudad aut[oó]noma de buenos aires|buenos aires)\b/i, 'AR', 'Buenos Aires'],
  [/\bc[oó]rdoba,? (argentina|ar)\b|\bc[oó]rdoba capital\b/i, 'AR', 'Córdoba'],
  [/\brosario\b/i, 'AR', 'Rosario'], [/\bmendoza\b/i, 'AR', 'Mendoza'], [/\bla plata\b/i, 'AR', 'La Plata'],
  [/\b(gba|zona norte|zona sur|zona oeste|vicente l[oó]pez|san isidro|tigre|pilar|mar del plata|tucum[aá]n|neuqu[eé]n|salta)\b/i, 'AR', ''],
  [/\bargentin[ae]\b/i, 'AR', ''],
  [/\bbogot[aá]\b/i, 'CO', 'Bogotá'], [/\bmedell[ií]n\b/i, 'CO', 'Medellín'], [/\bcali\b/i, 'CO', 'Cali'],
  [/\bbarranquilla\b/i, 'CO', 'Barranquilla'], [/\bcolombia\b/i, 'CO', ''],
  [/\bmontevideo\b/i, 'UY', 'Montevideo'], [/\buruguay\b/i, 'UY', ''],
  [/\bsantiago,? (de )?chile\b|\bsantiago, (rm|regi[oó]n metropolitana)\b/i, 'CL', 'Santiago'], [/\bchile\b/i, 'CL', ''],
  [/\blima\b/i, 'PE', 'Lima'], [/\bper[uú]\b/i, 'PE', ''],
  [/\b(cdmx|ciudad de m[eé]xico|mexico city)\b/i, 'MX', 'Ciudad de México'], [/\bguadalajara\b/i, 'MX', 'Guadalajara'],
  [/\bmonterrey\b/i, 'MX', 'Monterrey'], [/\bm[eé]xico\b/i, 'MX', ''],
  [/\bs[aã]o paulo\b/i, 'BR', 'São Paulo'], [/\b(brasil|brazil)\b/i, 'BR', ''],
  [/\bmadrid\b/i, 'ES', 'Madrid'], [/\bbarcelona\b/i, 'ES', 'Barcelona'], [/\b(espa[ñn]a|spain)\b/i, 'ES', ''],
  [/\blondon\b/i, 'GB', 'London'], [/\b(united kingdom|uk)\b/i, 'GB', ''],
  [/\bberlin\b/i, 'DE', 'Berlin'], [/\bmunich|m[uü]nchen\b/i, 'DE', 'Munich'], [/\b(germany|deutschland)\b/i, 'DE', ''],
  [/\b(new york|nyc)\b/i, 'US', 'New York'], [/\bmiami\b/i, 'US', 'Miami'], [/\bsan francisco\b/i, 'US', 'San Francisco'],
  [/\b(united states|usa|us only|u\.s\.)\b/i, 'US', ''],
  [/\bcanada\b/i, 'CA', ''], [/\b(portugal|lisbon|lisboa)\b/i, 'PT', ''], [/\b(netherlands|amsterdam)\b/i, 'NL', ''],
];

const REMOTE = /\b(remote|remoto|teletrabajo|home ?office|trabajo desde casa|100% virtual|anywhere|worldwide|work from home|wfh)\b/i;

export const COUNTRY_NAMES: Record<string, { en: string; es: string }> = {
  AR: { en: 'Argentina', es: 'Argentina' }, CO: { en: 'Colombia', es: 'Colombia' }, UY: { en: 'Uruguay', es: 'Uruguay' },
  CL: { en: 'Chile', es: 'Chile' }, PE: { en: 'Peru', es: 'Perú' }, MX: { en: 'Mexico', es: 'México' },
  BR: { en: 'Brazil', es: 'Brasil' }, ES: { en: 'Spain', es: 'España' }, GB: { en: 'United Kingdom', es: 'Reino Unido' },
  DE: { en: 'Germany', es: 'Alemania' }, US: { en: 'United States', es: 'Estados Unidos' }, CA: { en: 'Canada', es: 'Canadá' },
  PT: { en: 'Portugal', es: 'Portugal' }, NL: { en: 'Netherlands', es: 'Países Bajos' },
};

export function parseLocation(location: string, title = '') {
  const text = location || '';
  let country = '';
  let city = '';
  for (const [re, code, c] of PLACES) {
    if (re.test(text)) { country = code; city = c; break; }
  }
  // A two-letter country code on its own ("Bogotá, CO" / JSearch's "AR").
  if (!country) {
    const code = text.match(/(?:^|,\s*)([A-Z]{2})\s*$/)?.[1];
    if (code && COUNTRY_NAMES[code]) country = code;
  }
  return { country, city, remote: REMOTE.test(`${text} ${title}`) ? 1 : 0 };
}

/** Seniority from the title. Order matters: "Senior Analyst Intern" does not exist; "Jr Analyst" does. */
export function levelOf(title: string): string {
  const t = title.toLowerCase();
  if (/\b(intern|internship|pasant[ií]a|pasante|trainee|becari[oa]|practicante|pr[aá]cticas|estudiante)\b/.test(t)) return 'intern';
  // An explicit "Junior" wins over role words ("Junior Technical Project Manager" is junior);
  // semi-senior before senior, or "semi senior" reads as senior; senior before weak junior
  // words, or "Senior Operations Associate" reads as junior.
  if (/\b(semi[ -]?senior|ssr)\b/.test(t)) return 'mid';
  if (/\b(junior|jr\.?|entry[ -]level|graduate|grad|sin experiencia)\b/.test(t)) return 'junior';
  if (/\b(senior|sr\.?|lead|leader|l[ií]der|head|principal|staff|director|directora|manager|gerente|jefe|jefa|vp|chief|architect)\b/.test(t)) return 'senior';
  if (/\b(ayudante|asistente|assistant|associate)\b/.test(t)) return 'junior';
  if (/\b(mid|intermediate|ii)\b/.test(t)) return 'mid';
  return '';
}

export function langOf(text: string): string {
  const s = text.toLowerCase().slice(0, 1500);
  const es = (s.match(/\b(de|la|el|los|las|y|en|con|para|del|una|por|que|experiencia|empresa)\b/g) ?? []).length;
  const en = (s.match(/\b(the|and|of|to|with|for|in|you|we|our|experience|team|will)\b/g) ?? []).length;
  if (es + en < 4) return '';
  return es > en ? 'es' : 'en';
}

/** Bump when the rules above change, so existing rows are re-read once. */
const RULES_VERSION = '5';

/** Fills the filter fields on every row that has not been through here yet. Cheap; safe to call often. */
export function normalizeJobs() {
  const v = (db.prepare("SELECT value FROM setting WHERE key = 'normalize_version'").get() as { value: string } | undefined)?.value;
  if (v !== RULES_VERSION) {
    db.prepare('UPDATE job SET normalized = 0').run();
    db.prepare("UPDATE job SET remote = 1 WHERE source IN ('remotive', 'jobicy', 'himalayas')").run();
    db.prepare("INSERT INTO setting (key, value) VALUES ('normalize_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(RULES_VERSION);
  }
  const rows =db.prepare('SELECT id, title, location, description FROM job WHERE normalized = 0').all() as
    { id: number; title: string; location: string; description: string }[];
  const set = db.prepare(`UPDATE job SET country = CASE WHEN country = '' THEN ? ELSE country END,
    city = CASE WHEN city = '' THEN ? ELSE city END, remote = MAX(remote, ?), level = ?, lang = ?, normalized = 1 WHERE id = ?`);
  // A source's own city name gets the same spelling as everything else ("Cdad. Autónoma de Buenos Aires" → Buenos Aires).
  const fixCity = db.prepare('UPDATE job SET city = ? WHERE id = ?');
  for (const r of rows) {
    const loc = parseLocation(r.location, r.title);
    set.run(loc.country, loc.city, loc.remote, levelOf(r.title), langOf(`${r.title} ${r.description}`), r.id);
    const own = (db.prepare('SELECT city FROM job WHERE id = ?').get(r.id) as { city: string }).city;
    const canonical = own ? parseLocation(own.replace(/^cdad\.?/i, 'ciudad')).city : '';
    if (canonical && canonical !== own) fixCity.run(canonical, r.id);
  }
  return rows.length;
}
