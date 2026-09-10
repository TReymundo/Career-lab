import { db } from './db.ts';

/**
 * Recruiter-email scanning over IMAP (Gmail included, via an app password).
 *
 * Credentials never pass through the app's UI or its database — they are read from the
 * environment only, so the only place your password exists is your own .env file:
 *
 *   IMAP_HOST=imap.gmail.com
 *   IMAP_PORT=993
 *   IMAP_USER=you@gmail.com
 *   IMAP_PASSWORD=your-16-character-app-password   # Google → Security → App passwords
 *
 * A scan proposes status changes; it does not apply them until you say so. Silent mutation
 * of a pipeline off a keyword match is how you end up marking a live process rejected
 * because an automated acknowledgement used the wrong phrase.
 */

export interface Proposal {
  application_id: number;
  company: string;
  role: string;
  from: string;
  subject: string;
  date: string;
  current: string;
  proposed: string;
  matched: string;
  confidence: 'high' | 'medium';
}

type Rule = { status: string; confidence: 'high' | 'medium'; patterns: RegExp[] };

/** English and Spanish, because plenty of processes run in both. */
const RULES: Rule[] = [
  {
    status: 'offer', confidence: 'high',
    patterns: [
      /pleased to (?:make you |extend )?an? offer/i, /offer letter/i, /we would like to offer you/i,
      /nos complace ofrecerte/i, /carta de oferta/i, /te queremos hacer una oferta/i, /oferta laboral/i,
    ],
  },
  {
    status: 'interviewing', confidence: 'high',
    patterns: [
      /invite you to (?:an? )?(?:interview|conversation|call)/i, /schedule (?:an? )?(?:interview|call|chat)/i,
      /next (?:round|stage|step) of (?:the |our )?(?:interview|process)/i, /assessment cent(?:re|er)/i,
      /(?:te )?invitamos a (?:una |la )?entrevista/i, /coordinar (?:una )?(?:entrevista|llamada|reunión)/i,
      /agendar (?:una )?(?:entrevista|llamada)/i, /pasaste a la siguiente etapa/i, /siguiente instancia/i,
    ],
  },
  {
    status: 'rejected', confidence: 'high',
    patterns: [
      /we (?:have )?decided (?:to )?(?:move forward|proceed) with other/i, /not (?:be )?(?:moving|progressing) (?:forward|ahead) with your/i,
      /unfortunately[^.]{0,60}(?:not|unable)/i, /we will not be progressing/i, /your application (?:was|has been) unsuccessful/i,
      /decidimos (?:continuar|avanzar) con otros?/i, /no (?:vamos a |vamos)?(?:avanzar|continuar) con tu (?:candidatura|postulación|perfil)/i,
      /tu (?:candidatura|postulación) no (?:fue|ha sido) seleccionada/i, /en esta oportunidad no/i,
    ],
  },
  {
    // Acknowledgements confirm the application landed. "Gracias por postularte" on its own is
    // almost always this, not a rejection — so it only ever moves Saved/Tailored → Applied.
    status: 'applied', confidence: 'medium',
    patterns: [
      /thank you for (?:your interest|applying)/i, /we (?:have )?received your application/i, /application received/i,
      /gracias por (?:postularte|tu postulación|aplicar)/i, /recibimos tu (?:postulación|candidatura|aplicación)/i,
      /hemos recibido tu/i,
    ],
  },
];

const ORDER = ['saved', 'tailored', 'applied', 'interviewing', 'offer', 'rejected'];

/** Only ever move forward through the funnel; rejection may land from anywhere. */
function isForward(current: string, proposed: string) {
  if (proposed === 'rejected') return current !== 'rejected';
  return ORDER.indexOf(proposed) > ORDER.indexOf(current);
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Company name in the from-address or subject; "Acme Corp" also matches "acmecorp.com". */
function matchApplication(from: string, subject: string, apps: { id: number; company: string; role: string; status: string }[]) {
  const haystack = normalise(`${from} ${subject}`);
  const squashed = haystack.replace(/ /g, '');
  return apps.find((a) => {
    const name = normalise(a.company);
    if (!name || name.length < 3) return false;
    return haystack.includes(name) || squashed.includes(name.replace(/ /g, ''));
  }) ?? null;
}

export function classify(text: string): { status: string; confidence: 'high' | 'medium'; matched: string } | null {
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      const m = text.match(p);
      if (m) return { status: rule.status, confidence: rule.confidence, matched: m[0].slice(0, 80) };
    }
  }
  return null;
}

export function emailConfigured() {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
}

export async function scanMailbox(days = 30, mailbox = 'INBOX'): Promise<Proposal[]> {
  if (!emailConfigured()) {
    throw new Error('IMAP is not configured. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD in your .env file, then restart the API.');
  }
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });

  const apps = db.prepare('SELECT id, company, role, status FROM application').all() as
    { id: number; company: string; role: string; status: string }[];

  const since = new Date(Date.now() - days * 86_400_000);
  const proposals: Proposal[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      for await (const msg of client.fetch({ since }, { envelope: true, bodyStructure: false, source: false })) {
        const subject = msg.envelope?.subject ?? '';
        const from = msg.envelope?.from?.map((f) => `${f.name ?? ''} <${f.address ?? ''}>`).join(' ') ?? '';
        const app = matchApplication(from, subject, apps);
        if (!app) continue;

        const verdict = classify(`${subject} ${from}`);
        if (!verdict || !isForward(app.status, verdict.status)) continue;

        proposals.push({
          application_id: app.id,
          company: app.company,
          role: app.role,
          from,
          subject,
          date: new Date(msg.envelope?.date ?? Date.now()).toISOString().slice(0, 10),
          current: app.status,
          proposed: verdict.status,
          matched: verdict.matched,
          confidence: verdict.confidence,
        });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }

  // Newest proposal per application wins; one email is enough to move a row.
  const seen = new Set<number>();
  return proposals
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((p) => (seen.has(p.application_id) ? false : (seen.add(p.application_id), true)));
}

/** Applying a proposal always writes an event, so the pipeline never changes without a trace. */
export function applyProposal(p: Proposal) {
  db.prepare('UPDATE application SET status = ? WHERE id = ?').run(p.proposed, p.application_id);
  db.prepare('INSERT INTO event (application_id, on_date, kind, note) VALUES (?, ?, ?, ?)')
    .run(p.application_id, p.date, 'email', `${p.current} → ${p.proposed} from email “${p.subject}” (matched: ${p.matched})`);
  return db.prepare('SELECT * FROM application WHERE id = ?').get(p.application_id);
}
