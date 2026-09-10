/**
 * Wipes every row so the app starts genuinely empty. There is no default content and no
 * example person: the guided path fills everything in from scratch.
 *
 *   npm run reset
 */
import { db } from './db.ts';

const TABLES = ['event', 'document', 'contact', 'application', 'job', 'saved_search', 'answer', 'experience', 'setting'];

let removed = 0;
for (const t of TABLES) {
  const before = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  db.prepare(`DELETE FROM ${t}`).run();
  removed += before;
}

db.prepare(`UPDATE profile SET name='', headline='', email='', phone='', location='', linkedin='',
            summary='', languages='', skills='', headline_es='', summary_es='', skills_es='', languages_es=''
            WHERE id = 1`).run();

console.log(`[reset] cleared ${removed} rows. Open the app and work through "Start here".`);
