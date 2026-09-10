import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.CAREER_LAB_DB ?? resolve(root, 'data', 'career-lab.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  languages TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS experience (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'work',          -- work | education | extra
  org TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  bullets TEXT NOT NULL DEFAULT '[]',         -- JSON array of {text, tracks:[]}
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS application (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  track TEXT NOT NULL DEFAULT 'markets',      -- markets | ib | consulting | product | other
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'target',      -- target|networking|applied|screen|interview|final|offer|rejected|withdrawn
  priority INTEGER NOT NULL DEFAULT 2,        -- 1 high, 2 medium, 3 low
  source TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  applied_on TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_on TEXT NOT NULL DEFAULT '',
  jd TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES application(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  how_met TEXT NOT NULL DEFAULT '',
  last_touch TEXT NOT NULL DEFAULT '',
  next_touch TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES application(id) ON DELETE CASCADE,
  on_date TEXT NOT NULL DEFAULT (date('now')),
  kind TEXT NOT NULL DEFAULT 'note',          -- note|applied|call|interview|email|referral|offer|reject
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS document (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES application(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'cover',         -- cv | cover
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

db.exec(`INSERT OR IGNORE INTO profile (id) VALUES (1);`);
export { dbPath };

/** --- Job board: the searchable list of openings, kept separate from applications. --- */
db.exec(`
CREATE TABLE IF NOT EXISTS job (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'manual',      -- linkedin-export | greenhouse | lever | ashby | paste | manual
  external_id TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  posted_on TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  track TEXT NOT NULL DEFAULT '',
  starred INTEGER NOT NULL DEFAULT 0,
  dismissed INTEGER NOT NULL DEFAULT 0,
  application_id INTEGER REFERENCES application(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS job_dedupe ON job (company, title, location, url);
CREATE INDEX IF NOT EXISTS job_company ON job (company);

CREATE TABLE IF NOT EXISTS saved_search (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  terms TEXT NOT NULL DEFAULT '[]',           -- JSON array of keywords, OR-matched
  exclude TEXT NOT NULL DEFAULT '[]',         -- JSON array of keywords that disqualify
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** Spanish counterparts, added after v1 — existing databases get them here rather than in the CREATE. */
const profileCols = new Set(
  (db.prepare('PRAGMA table_info(profile)').all() as { name: string }[]).map((c) => c.name),
);
for (const col of ['headline_es', 'summary_es', 'skills_es', 'languages_es']) {
  if (!profileCols.has(col)) db.exec(`ALTER TABLE profile ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
}

/**
 * v2 pipeline: Saved → Tailored → Applied → Interviewing → Offer / Rejected.
 * Old rows are mapped onto the new columns rather than dropped.
 */
const STATUS_MIGRATION: Record<string, string> = {
  target: 'saved', networking: 'saved', screen: 'interviewing',
  interview: 'interviewing', final: 'interviewing', withdrawn: 'rejected',
};
for (const [from, to] of Object.entries(STATUS_MIGRATION)) {
  db.prepare('UPDATE application SET status = ? WHERE status = ?').run(to, from);
}
