/**
 * Wipes every row so the app starts genuinely empty. There is no default content and no
 * example person: the guided path fills everything in from scratch.
 *
 * Your AI keys survive (Google and every provider added in AI keys) — they are configuration
 * you entered once, not job-search data, and losing them on every reset would be a small
 * cruelty. Gmail and Google for Jobs live in .env and are untouched. Pass --all to clear the
 * AI keys too.
 *
 *   npm run reset
 *   npm run reset -- --all
 */
import { db } from './db.ts';

const KEEP = ['google_api_key', 'ai_providers', 'jsearch_usage'];
const keep = process.argv.includes('--all')
  ? []
  : (db.prepare(`SELECT key, value FROM setting WHERE key IN (${KEEP.map(() => '?').join(',')})`).all(...KEEP) as { key: string; value: string }[]);

// ai_cache holds answers about you, so it goes too.
const TABLES = ['event', 'document', 'contact', 'application', 'job', 'saved_search', 'answer', 'experience', 'setting', 'story', 'story_answer', 'kit', 'ai_cache'];

let removed = 0;
for (const t of TABLES) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!exists) continue;
  removed += (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  db.prepare(`DELETE FROM ${t}`).run();
}

db.prepare(`UPDATE profile SET name='', headline='', email='', phone='', location='', linkedin='',
            summary='', languages='', skills='', headline_es='', summary_es='', skills_es='', languages_es=''
            WHERE id = 1`).run();

for (const s of keep) db.prepare('INSERT INTO setting (key, value) VALUES (?, ?)').run(s.key, s.value);

console.log(`[reset] cleared ${removed} rows.${keep.length ? ' Your AI keys were kept.' : ''}`);
console.log('[reset] open the app and start with your CV.');
