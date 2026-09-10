/**
 * Seeds a starting skeleton: your own profile shell, the JPM internship and ITBA
 * with template bullets to overwrite, and a few target rows so the pipeline is not
 * an empty screen. Numbers in brackets are placeholders — replace them with real ones.
 * Safe to run once; it refuses if the database already has content.
 */
import { db } from './db.ts';

const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

if (count('experience') > 0 || count('application') > 0) {
  console.log('[seed] database already has data — nothing to do.');
  process.exit(0);
}

db.prepare(
  `UPDATE profile SET name=?, headline=?, location=?, summary=?, skills=?, languages=?,
                      headline_es=?, summary_es=?, skills_es=?, languages_es=? WHERE id=1`,
).run(
  '[Your full name]',
  'Risk Reporting Intern, J.P. Morgan · ITBA Gestión de Negocios 2026',
  'Buenos Aires, Argentina',
  'Final-year Business Management student at ITBA, currently interning in risk reporting at J.P. Morgan, where I produce the daily reporting that sits under [desk/portfolio]. Looking to move from reporting the risk to taking the decision.',
  'Excel (advanced), SQL, Python (pandas), Bloomberg, [Tableau/Alteryx]',
  'Spanish (native), English ([C1]), [Portuguese (B1)]',
  'Pasante de Reporting de Riesgos, J.P. Morgan · ITBA Gestión de Negocios 2026',
  'Estudiante de último año de Gestión de Negocios en el ITBA, actualmente pasante en reporting de riesgos en J.P. Morgan, donde produzco el reporte diario de [mesa/cartera]. Busco pasar de reportar el riesgo a tomar la decisión.',
  'Excel (avanzado), SQL, Python (pandas), Bloomberg, [Tableau/Alteryx]',
  'Español (nativo), Inglés ([C1]), [Portugués (B1)]',
);

const exp = db.prepare(
  `INSERT INTO experience (kind, org, title, location, start_date, end_date, bullets, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
);

exp.run('work', 'J.P. Morgan', 'Risk Reporting Intern', 'Buenos Aires', 'Feb 2026', '', JSON.stringify([
  { text: 'Produce the daily risk reporting pack covering [product/portfolio, $X notional] for [N] desks, delivered before the [time] cut-off.', es: 'Elaboro el reporte diario de riesgo sobre [producto/cartera, USD X nocionales] para [N] mesas, entregado antes del corte de las [hora].', tracks: [] },
  { text: 'Automated [report] in SQL/Excel, cutting production from [X] to [Y] minutes and removing [N] manual steps.', es: 'Automaticé [reporte] en SQL/Excel, reduciendo su producción de [X] a [Y] minutos y eliminando [N] pasos manuales.', tracks: [] },
  { text: 'Investigate limit breaches and VaR exceptions with the desk, translating [N] daily exceptions into the commentary the front office reads.', tracks: ['markets'] },
  { text: 'Work daily with [rates/FX/equities] exposures — P&L attribution, sensitivities and the market moves behind them.', tracks: ['markets'] },
  { text: 'Rebuilt [process] end to end after mapping the workflow with [N] stakeholders across risk, technology and the business.', tracks: ['consulting', 'product'] },
  { text: 'Present weekly exposure summaries to [audience], including [VP/MD]-level review.', tracks: ['ib', 'consulting'] },
]), 0);

exp.run('education', 'Instituto Tecnológico de Buenos Aires (ITBA)', 'BSc Gestión de Negocios (Business Management)', 'Buenos Aires', '2022', 'Dec 2026', JSON.stringify([
  { text: 'GPA [X.X/10]. Relevant coursework: corporate finance, statistics, operations, financial markets.', tracks: [] },
  { text: 'Coursework in valuation and financial modelling — [DCF/comps project, describe it].', tracks: ['ib'] },
  { text: 'Capstone: [problem you solved, method, result].', tracks: ['consulting', 'product'] },
]), 1);

exp.run('extra', '[Club / case competition / volunteering]', '[Your role]', 'Buenos Aires', '[2024]', '[2025]', JSON.stringify([
  { text: '[What you organised or led, how many people, what came out of it.]', tracks: [] },
]), 2);

const app = db.prepare(
  `INSERT INTO application (company, role, track, location, status, priority, source, next_action, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
);

app.run('J.P. Morgan', 'Markets Analyst Programme (internal move)', 'markets', 'Buenos Aires / NY', 'networking', 1, 'internal',
  'Ask your manager about the internal mobility timeline and who runs Markets recruiting',
  'Internal moves usually need: time in seat, manager sign-off, and someone on the receiving desk who wants you. Work out all three before the grad cycle opens.');

app.run('J.P. Morgan', 'Investment Banking Analyst (internal move)', 'ib', 'Buenos Aires', 'target', 2, 'internal',
  'Find two analysts in the BA IB team and ask for coffee', '');

app.run('[Bank #2]', 'Sales & Trading Graduate Programme', 'markets', '[City]', 'target', 1, 'careers site',
  'Check when the graduate cycle opens for Dec-2026 graduates', '');

app.run('McKinsey / Bain / BCG', 'Business Analyst', 'consulting', 'Buenos Aires', 'target', 2, 'careers site',
  'Start case practice — one case per week with a partner from ITBA',
  'MBB in BA recruit heavily from ITBA. The bottleneck is the case, not the CV.');

console.log('[seed] done — open the app and replace every bracketed placeholder.');
