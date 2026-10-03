import { db } from './db.ts';
import { insertJobs } from './jobs.ts';
import { extractJobs } from './ai.ts';
import { setEnv } from './env.ts';

/**
 * Job-alert emails, read from your inbox.
 *
 * This is how LinkedIn, Bumeran, Computrabajo, Indeed and the rest get into the app without
 * anyone scraping them: you create alerts on those sites, they email you matches every day,
 * and this reads those emails — and only those — and files every job in them with its link.
 *
 * Read-only IMAP (Gmail via an app password). Only messages from the senders below are
 * opened; everything else in the mailbox is never fetched. Credentials live in .env.
 */

const SENDERS = [
  'jobalerts-noreply@linkedin.com', 'jobs-noreply@linkedin.com', 'jobs-listings@linkedin.com',
  'bumeran', 'zonajobs', 'computrabajo', 'indeed.com', 'glassdoor', 'laborum', 'getonbrd', 'jooble', 'elempleo', 'magneto365',
];

const sourceOf = (from: string) => {
  if (/linkedin/i.test(from)) return 'alert:linkedin';
  const site = SENDERS.find((s) => !s.includes('@') && from.toLowerCase().includes(s));
  return `alert:${(site ?? 'other').replace('.com', '')}`;
};

export const alertsConfigured = () => Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);

async function client() {
  const { ImapFlow } = await import('imapflow');
  return new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });
}

/** Tries the login first and only then saves it, so a typo never ends up in .env. */
export async function connectMail(user: string, password: string, host = 'imap.gmail.com') {
  const { ImapFlow } = await import('imapflow');
  const pass = password.replace(/\s+/g, '');
  const test = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false });
  try {
    await test.connect();
    await test.logout();
  } catch {
    throw new Error('Gmail refused that login. Use an app password (16 letters, from your Google account → Security → App passwords), not your normal password.');
  }
  setEnv({ IMAP_HOST: host, IMAP_PORT: '993', IMAP_USER: user, IMAP_PASSWORD: pass });
  return { configured: true, user };
}

export function disconnectMail() {
  setEnv({ IMAP_HOST: '', IMAP_PORT: '', IMAP_USER: '', IMAP_PASSWORD: '' });
}

/** Email HTML → plain text that keeps every link next to the words it was attached to. */
function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return label ? ` ${label} [${href}] ` : ' ';
    })
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/td)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * LinkedIn alert emails, read without any AI: their plain-text part is one block per job —
 * title, company, location, an optional "1 connection" line, then "View job: <link>" — split by
 * a dashed rule. Fast, free, and it cannot be stopped by a busy model.
 */
export function parseLinkedInAlert(text: string) {
  const jobs: { title: string; company: string; location: string; url: string; description: string }[] = [];
  // "Your job alert for junior in Buenos Aires Province" — the search you wrote, kept with each job.
  const query = text.match(/(?:job alert for|alerta de empleo (?:para|de))\s+(.+?)(?:\s+(?:in|en)\s+[^\n]+)?\n/i)?.[1]?.trim() ?? '';
  for (const block of text.split(/\n-{10,}\s*\n/)) {
    const m = block.match(/View job:\s*(\S*linkedin\.com\/(?:comm\/)?jobs\/view\/\d+\S*)/i);
    if (!m) continue;
    const lines = block.slice(0, m.index).split('\n').map((l) => l.trim()).filter(Boolean)
      // Drop the email's header lines and LinkedIn's social hints under each job.
      .filter((l) => !/^(your job alert|tu alerta|\d+\+? new jobs?|\d+\+? empleos? nuevos?|this company is actively hiring|esta empresa|actively recruiting|\d+ (connection|connections|company alum|school alum|alumni|contacto|contactos|ex alumnos?)|easy apply|solicitud sencilla|promoted|promocionado|be an early applicant|s[eé] de los primeros)/i.test(l));
    const [title, company, location] = lines.slice(-3);
    if (title && company) jobs.push({ title, company, location: location ?? '', url: cleanUrl(m[1]), description: query ? `From your LinkedIn alert “${query}”.` : '' });
  }
  return jobs;
}

/** Tracking links → the posting's real address, so the same job from two emails dedupes. */
export function cleanUrl(url: string) {
  const li = url.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
  if (li) return `https://www.linkedin.com/jobs/view/${li[1]}`;
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|trk|tracking|refid|ref|midtoken|midsig|eid|otptoken|lipi|trackingid)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch { return url; }
}

const seenIds = (): Set<string> => {
  const row = db.prepare("SELECT value FROM setting WHERE key = 'alerts_seen'").get() as { value: string } | undefined;
  try { return new Set(JSON.parse(row?.value ?? '[]') as string[]); } catch { return new Set(); }
};
const saveSeen = (ids: Set<string>) =>
  db.prepare("INSERT INTO setting (key, value) VALUES ('alerts_seen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify([...ids].slice(-3000)));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Part { type?: string; part?: string; childNodes?: Part[] }
const findPart = (node: Part | undefined, type: string): string | undefined => {
  if (!node) return undefined;
  if (node.type === type) return node.part ?? '1';
  for (const c of node.childNodes ?? []) { const p = findPart(c, type); if (p) return p; }
  return undefined;
};

/**
 * Reads new alert emails from the last `days` days. Emails are batched into as few AI calls as
 * fit, and calls are spaced out to stay inside the free tier's per-minute limit.
 */
export async function scanAlerts(days = 60, maxAiEmails = 30) {
  if (!alertsConfigured()) throw new Error('Gmail is not connected yet. Connect it in Sources.');
  // Emails read by the first, AI-only version lost most of their jobs: read them all again once.
  if ((db.prepare("SELECT value FROM setting WHERE key = 'alerts_reader'").get() as { value: string } | undefined)?.value !== '2') {
    db.prepare("DELETE FROM setting WHERE key = 'alerts_seen'").run();
    db.prepare("INSERT INTO setting (key, value) VALUES ('alerts_reader', '2') ON CONFLICT(key) DO UPDATE SET value = '2'").run();
  }
  const seen = seenIds();
  const since = new Date(Date.now() - days * 86_400_000);
  const c = await client();
  const emails: { id: string; source: string; subject: string; text: string }[] = [];
  let direct = 0;
  let directEmails = 0;

  await c.connect();
  try {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const uids = new Set<number>();
      for (const s of SENDERS) {
        const found = await c.search({ from: s, since }, { uid: true });
        for (const u of found || []) uids.add(u);
      }
      const read = async (uid: number, part: string) => {
        const { content } = await c.download(String(uid), part, { uid: true });
        const chunks: Buffer[] = [];
        for await (const chunk of content) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks).toString('utf8');
      };
      // Newest first, so a long backlog fills with this week's jobs before last month's.
      for (const uid of [...uids].sort((a, b) => b - a)) {
        const msg = await c.fetchOne(String(uid), { envelope: true, bodyStructure: true }, { uid: true });
        if (!msg) continue;
        const id = msg.envelope?.messageId ?? `uid:${uid}`;
        if (seen.has(id)) continue;
        const from = msg.envelope?.from?.map((f) => f.address ?? '').join(' ') ?? '';
        const source = sourceOf(from);
        const plain = findPart(msg.bodyStructure as Part, 'text/plain');
        const html = findPart(msg.bodyStructure as Part, 'text/html');

        // LinkedIn: read directly, every job, no AI.
        if (source === 'alert:linkedin' && plain) {
          const jobs = parseLinkedInAlert(await read(uid, plain));
          if (jobs.length) {
            direct += insertJobs(jobs.map((j) => ({ ...j, source }))).inserted;
            directEmails++;
            seen.add(id);
            continue;
          }
        }
        // Anything else goes to the AI, a limited number per run; the rest waits for the next one.
        if (emails.length >= maxAiEmails) continue;
        const part = html ?? plain;
        if (!part) { seen.add(id); continue; }
        const raw = await read(uid, part);
        emails.push({ id, source, subject: msg.envelope?.subject ?? '', text: /<html|<table|<div/i.test(raw) ? htmlToText(raw) : raw });
      }
      saveSeen(seen);
    } finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }

  // Group emails into batches of ~11k characters, one site per batch: one AI call each.
  const batches: typeof emails[] = [];
  let cur: typeof emails = [];
  let size = 0;
  for (const e of emails.sort((a, b) => a.source.localeCompare(b.source))) {
    const text = e.text.slice(0, 9000);
    if (cur.length && (size + text.length > 11000 || cur[0].source !== e.source)) { batches.push(cur); cur = []; size = 0; }
    cur.push({ ...e, text });
    size += text.length;
  }
  if (cur.length) batches.push(cur);

  let inserted = 0;
  let found = 0;
  const errors: string[] = [];
  for (const [i, batch] of batches.entries()) {
    if (i > 0) await sleep(6500); // the free tier allows about ten calls a minute
    try {
      const text = batch.map((e) => `=== Email from ${e.source} — ${e.subject} ===\n${e.text}`).join('\n\n');
      const jobs = await extractJobs(text, 'es');
      const source = batch[0].source;
      found += jobs.length;
      inserted += insertJobs(jobs.map((j) => ({ ...j, url: cleanUrl(j.url), source }))).inserted;
      for (const e of batch) seen.add(e.id);
      saveSeen(seen);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      if (/key|limit|quota/i.test(errors.at(-1)!)) break;
    }
  }
  db.prepare("INSERT INTO setting (key, value) VALUES ('alerts_last', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
  return { emails: emails.length + directEmails, found: found + direct, inserted: inserted + direct, errors: [...new Set(errors)] };
}

/**
 * Keeps the list fresh on its own: a quiet check of the inbox shortly after the app starts and
 * every half hour while it runs. LinkedIn emails need no AI, so this costs nothing; other
 * senders wait for the AI only a few at a time. Never two scans at once.
 */
let scanning = false;
export function startAlertWatcher(after: () => void) {
  const tick = async () => {
    if (scanning || !alertsConfigured()) return;
    scanning = true;
    try { const r = await scanAlerts(14, 8); if (r.inserted) after(); }
    catch { /* a failed background check just waits for the next one */ }
    finally { scanning = false; }
  };
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), 30 * 60_000);
}
