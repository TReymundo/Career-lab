import { db } from './db.ts';
import { readPrefs } from './scope.ts';

/**
 * How relevant a job is to you, 0–100, with the reasons — computed on this machine, instantly,
 * for any number of jobs, with no AI quota.
 *
 *   title vs your target roles   up to 60   (Spanish and English treated as the same words)
 *   level                        −30 … +15  (senior is pushed down hard)
 *   your skills in the posting   up to 20
 *   freshness                    up to 8
 *   your city                    4
 *   your saves and dismissals    −10 … +8   (title words you keep saving or hiding)
 *
 * Every number is explainable, which is the point: each card can say *why* it is near the top.
 */

const deaccent = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Spanish and English words for the same idea collapse into one token. */
const SYN: [RegExp, string][] = [
  [/\b(analista|analistas|analyst|analysts|analytics|analitica|analisis|analysis)\b/g, 'analyst'],
  [/\b(pasante|pasantes|pasantia|practicante|intern|internship|becari[oa]|trainee|aprendiz)\b/g, 'intern'],
  [/\b(junior|jr\.?|entry level|semi ?junior)\b/g, 'junior'],
  [/\b(finanzas|financier[oa]s?|finance|financial|fp&a|tesoreria|treasury)\b/g, 'finance'],
  [/\b(datos|data)\b/g, 'data'],
  [/\b(negocios?|business|comercial|commercial)\b/g, 'business'],
  [/\b(contable|contabilidad|contador[a]?|accounting|accountant)\b/g, 'accounting'],
  [/\b(ventas|sales|vendedor[a]?)\b/g, 'sales'],
  [/\b(proyectos?|projects?)\b/g, 'project'],
  [/\b(desarrollador[a]?|developer|programador[a]?)\b/g, 'developer'],
  [/\b(ingenier[oa]|engineer|engineering)\b/g, 'engineer'],
  [/\b(administrativ[oa]|administracion|administration)\b/g, 'admin'],
  [/\b(inteligencia de negocios|business intelligence|bi)\b/g, 'bi'],
  [/\b(estrategia|strategy|strategic)\b/g, 'strategy'],
  [/\b(operaciones|operations|ops)\b/g, 'operations'],
  [/\b(recursos humanos|rrhh|human resources|people|talent)\b/g, 'hr'],
  [/\b(riesgos?|risk)\b/g, 'risk'],
  [/\b(auditoria|auditor|audit)\b/g, 'audit'],
  [/\b(consultor[a]?|consultant|consulting|consultoria)\b/g, 'consulting'],
  [/\b(producto|product)\b/g, 'product'],
  [/\b(planeamiento|planning|planificacion)\b/g, 'planning'],
  [/\b(control de gestion|controlling|controller)\b/g, 'controlling'],
  [/\b(inversiones|investment|investments)\b/g, 'investment'],
  [/\b(credito|creditos|credit)\b/g, 'credit'],
  [/\b(precios|pricing)\b/g, 'pricing'],
];
const STOP = new Set(('de del la el los las y e en con para por a al un una the of and for in to with at on or').split(' '));
const LEVEL_WORDS = new Set(['junior', 'intern', 'senior', 'sr', 'ssr', 'semi', 'lead']);

export function tokens(text: string): Set<string> {
  let s = deaccent(text);
  for (const [re, to] of SYN) s = s.replace(re, ` ${to} `);
  return new Set(s.split(/[^a-z0-9&+#]+/).filter((w) => w.length > 1 && !STOP.has(w)));
}

/** Words (after the Spanish/English merge above) that mark a job as belonging to a field. */
const FIELD_WORDS: Record<string, string[]> = {
  finance: ['finance', 'investment', 'credit', 'pricing', 'controlling', 'banco', 'banca', 'banking', 'bank', 'fp&a', 'treasury', 'valuation', 'valuacion', 'm&a', 'equity', 'fondos', 'funds'],
  accounting: ['accounting', 'audit', 'tax', 'impuestos', 'impositivo', 'payable', 'receivable', 'cuentas', 'facturacion', 'billing'],
  data: ['data', 'bi', 'sql', 'python', 'reporting', 'dashboards', 'insights', 'scientist', 'science'],
  consulting: ['consulting', 'strategy', 'advisory', 'transformation'],
  marketing: ['marketing', 'brand', 'marca', 'digital', 'growth', 'content', 'contenido', 'communication', 'comunicacion', 'community', 'seo', 'media'],
  sales: ['sales', 'account', 'kam', 'comercial', 'business'],
  operations: ['operations', 'supply', 'logistics', 'logistica', 'compras', 'procurement', 'purchasing', 'abastecimiento'],
  product: ['product', 'project', 'pmo', 'owner', 'scrum'],
  tech: ['developer', 'engineer', 'software', 'it', 'sistemas', 'devops', 'qa', 'frontend', 'backend'],
  hr: ['hr', 'recruiter', 'recruiting', 'seleccion', 'payroll', 'nomina', 'talent'],
  legal: ['legal', 'abogado', 'abogada', 'lawyer', 'compliance', 'paralegal'],
  admin: ['admin', 'assistant', 'asistente', 'recepcionista', 'secretaria'],
};
const FIELD_NAMES: Record<string, string> = {
  finance: 'Finance', accounting: 'Accounting', data: 'Data', consulting: 'Consulting', marketing: 'Marketing', sales: 'Sales',
  operations: 'Operations', product: 'Product', tech: 'Tech', hr: 'HR', legal: 'Legal', admin: 'Administration',
};
const FIELD_LABEL = (fields: string[], title: Set<string>) =>
  FIELD_NAMES[fields.find((f) => (FIELD_WORDS[f] ?? []).some((w) => title.has(w))) ?? ''] ?? '';

interface Rankable {
  title: string; description: string; level: string; city: string; posted_on: string; imported_at: string; [k: string]: unknown;
}

export function rankJobs() {
  const prefs = readPrefs();
  const profile = db.prepare('SELECT skills FROM profile WHERE id = 1').get() as { skills: string } | undefined;

  // The field you want to move into counts on its own — a tech CV aiming at finance gets finance jobs.
  const fieldWords = new Set((prefs?.fields ?? []).flatMap((f) => FIELD_WORDS[f] ?? []));
  const exp = prefs?.experience ?? 'some';

  const roles = (prefs?.roles ?? []).map((r) => ({ label: r, set: new Set([...tokens(r)].filter((t) => !LEVEL_WORDS.has(t))) }))
    .filter((r) => r.set.size);
  const levels = new Set(prefs?.levels ?? ['intern', 'junior']);
  const cities = new Set((prefs?.places ?? []).map((p) => deaccent(p.city)).filter(Boolean));

  // "Análisis de Datos - SQL, Python, Power BI" → SQL, Python, Power BI (and the category too).
  // Level words ("básico", "advanced") are not skills.
  const NOT_SKILL = /^(b[aá]sico|basic|intermedio|intermediate|avanzado|advanced|nativo|native|fluido|fluent)$/i;
  const skills = [...new Set((profile?.skills ?? '').split(/[,;\n]|\s[-–]\s|\(|\)/).map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 25 && !NOT_SKILL.test(s)))]
    .map((s) => ({ label: s, re: new RegExp(`(^|[^a-z0-9])${deaccent(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`) }));

  // What you keep saving or hiding teaches the ranking which title words matter to you.
  const weight = new Map<string, number>();
  const learn = (sql: string, w: number) => {
    for (const r of db.prepare(sql).all() as { title: string }[]) for (const t of tokens(r.title)) weight.set(t, (weight.get(t) ?? 0) + w);
  };
  learn('SELECT title FROM job WHERE starred = 1 LIMIT 300', 1);
  learn('SELECT title FROM job WHERE dismissed = 1 ORDER BY id DESC LIMIT 300', -1);

  const now = Date.now();

  return (j: Rankable) => {
    const title = tokens(j.title);
    const reasons: string[] = [];

    // A role that boils down to one word ("Trainee de Operaciones" → operations) matches far too
    // much on its own, so it is worth less than a fuller match ("data" + "analyst").
    let best = 0;
    let bestRole = '';
    let bestWeight = 0;
    for (const r of roles) {
      let hit = 0;
      for (const t of r.set) if (title.has(t)) hit++;
      const share = hit / r.set.size;
      const weight = share * (r.set.size >= 2 ? 55 : 30) + (share === 1 && r.set.size >= 2 ? 5 : 0);
      if (weight > bestWeight) { bestWeight = weight; best = share; bestRole = r.label; }
    }
    let score = bestWeight;
    if (best >= 0.5) reasons.push(bestRole);

    const hay = deaccent(`${j.title} ${j.description}`);
    if (fieldWords.size) {
      const inTitle = [...title].some((w) => fieldWords.has(w));
      const inText = !inTitle && [...tokens(j.description.slice(0, 1500))].some((w) => fieldWords.has(w));
      score += inTitle ? 12 : inText ? 4 : -6;
      const label = inTitle && best < 0.5 ? FIELD_LABEL(prefs?.fields ?? [], title) : '';
      if (label) reasons.push(label);
    }

    // A job from one of your own alerts already passed a search you wrote yourself.
    if (String(j.source ?? '').startsWith('alert:')) { score += 6; if (!reasons.length) reasons.push('Your alert'); }

    // With no experience, senior is out of reach and semi-senior a stretch; trainee schemes are gold.
    const lvl = j.level;
    if (lvl === 'senior') score -= exp === 'none' ? 45 : 30;
    else if (lvl === 'mid' && exp === 'none') score -= 15;
    else if (lvl && levels.has(lvl)) score += exp === 'none' && lvl === 'intern' ? 18 : 15;
    else if (!lvl) score += 7;
    const found = skills.filter((s) => s.re.test(hay)).map((s) => s.label);
    score += Math.min(found.length, 5) * 4;
    if (found.length) reasons.push(found.slice(0, 3).join(', '));

    const city = deaccent(j.city || '');
    if (city && cities.has(city)) { score += 4; reasons.push(j.city); }

    const when = Date.parse(j.posted_on || j.imported_at.replace(' ', 'T'));
    const days = Number.isNaN(when) ? 99 : (now - when) / 86_400_000;
    score += days <= 3 ? 8 : days <= 7 ? 5 : days <= 30 ? 2 : 0;

    // Once the AI has read a posting, its verdict outranks the word counting.
    const fit = String(j.fit ?? '');
    score += fit === 'great' ? 12 : fit === 'good' ? 6 : fit === 'stretch' ? -12 : fit === 'no' ? -40 : 0;

    let personal = 0;
    for (const t of title) personal += weight.get(t) ?? 0;
    score += Math.max(-10, Math.min(8, personal * 2));

    return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
  };
}
