import { db } from './db.ts';
import { extractStories, type Lang } from './ai.ts';

/**
 * The story bank's background worker.
 *
 * The interview never waits for the AI: answers are saved the moment they are sent, and this
 * turns them into stories, facts and values afterwards — three answers per AI call. If every
 * AI is at its free limit it simply waits and tries again, so an answer can be delayed but
 * never lost.
 */

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastError = '';
let retryAt = 0;

export function storyStatus() {
  const pending = (db.prepare('SELECT COUNT(*) AS n FROM story_answer WHERE processed = 0').get() as { n: number }).n;
  return { pending, working: running, lastError: pending ? lastError : '', retryIn: retryAt > Date.now() ? Math.ceil((retryAt - Date.now()) / 1000) : 0 };
}

export function processStories(lang: Lang = 'en') {
  if (running) return;
  if (timer) { clearTimeout(timer); timer = null; }
  running = true;
  void (async () => {
    try {
      for (;;) {
        const batch = db.prepare('SELECT id, question, answer FROM story_answer WHERE processed = 0 ORDER BY id LIMIT 3').all() as { id: number; question: string; answer: string }[];
        if (!batch.length) { lastError = ''; break; }
        const known = (db.prepare('SELECT kind, title FROM story ORDER BY id DESC LIMIT 80').all() as { kind: string; title: string }[])
          .map((s) => `- (${s.kind}) ${s.title}`).join('\n');
        const items = await extractStories(batch.map((b, i) => ({ n: i + 1, question: b.question, answer: b.answer })), known, lang);
        const insert = db.prepare('INSERT INTO story (kind, title, body, shows, private, answer_id) VALUES (?, ?, ?, ?, ?, ?)');
        for (const it of items) {
          const src = batch[(it.answer ?? 1) - 1] ?? batch[0];
          if (it.title && it.body) insert.run(it.kind, it.title, it.body, it.shows ?? '', it.private ? 1 : 0, src.id);
        }
        const done = db.prepare('UPDATE story_answer SET processed = 1 WHERE id = ?');
        for (const b of batch) done.run(b.id);
        lastError = '';
      }
    } catch (e) {
      // Out of free AI for now: wait, then pick up exactly where it stopped.
      lastError = e instanceof Error ? e.message : String(e);
      const wait = /about (\d+)\s*min/.exec(lastError) ? Number(/about (\d+)\s*min/.exec(lastError)![1]) * 60_000 : 90_000;
      retryAt = Date.now() + wait;
      timer = setTimeout(() => processStories(lang), wait);
    } finally {
      running = false;
    }
  })();
}
