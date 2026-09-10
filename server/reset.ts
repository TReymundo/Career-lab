/**
 * Wipes every row so the app starts genuinely empty. There is no default content and no
 * example person: the guided path fills everything in from scratch.
 *
 * Your Google API key survives — it is configuration you entered once, not job-search data,
 * and losing it on every reset would be a small cruelty. Pass --all to clear that too.
 *
 *   npm run reset
 *   npm run reset -- --all
 */
import { db } from './db.ts';

const keepKey = !process.argv.includes('--all');
const saved = keepKey
  ? (db.prepare("SELECT value FROM setting WHERE key = 'google_api_key'").get() as { value: string } | undefined)?.value
  : undefined;

const TABLES = ['event', 'document', 'contact', 'application', 'job', 'saved_search', 'answer', 'experience', 'setting'];

let removed = 0;
for (const t of TABLES) {
  removed += (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  db.prepare(`DELETE FROM ${t}`).run();
}

db.prepare(`UPDATE profile SET name='', headline='', email='', phone='', location='', linkedin='',
            summary='', languages='', skills='', headline_es='', summary_es='', skills_es='', languages_es=''
            WHERE id = 1`).run();

if (saved) db.prepare("INSERT INTO setting (key, value) VALUES ('google_api_key', ?)").run(saved);

console.log(`[reset] cleared ${removed} rows.${saved ? ' Your Google API key was kept.' : ''}`);
console.log('[reset] open the app and work through "Start here".');
