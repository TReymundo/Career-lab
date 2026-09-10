# Career Lab

A local job-search workbench: an application pipeline, a contact network, one master CV
you edit once, and a generator that produces track-specific CVs and cover letters from it.

Built around one idea: you keep **one** set of facts about yourself, tag each CV bullet with
the tracks it sells (Markets / IB / Consulting / Product), and the app assembles the right
document per application instead of you maintaining five diverging Word files.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5273. The API runs on 5274 and the web app proxies `/api` to it.

To load the starting skeleton (your profile shell, the JPM internship, ITBA, and a few
target rows), run once on an empty database:

```bash
npm run seed
```

Everything lives in `data/career-lab.db` — a single SQLite file. Back it up by copying it.
It is gitignored, so the database never leaves your machine.

## The six screens

| Screen | What it is for |
| --- | --- |
| **Dashboard** | Applications per week, response rate, funnel, top keywords, and what is due. |
| **Jobs** | The long list of openings: keyword search, match scores, checkboxes, and one button from checked jobs to a full document pack. |
| **Pipeline** | Kanban board and list: `Saved → Tailored → Applied → Interviewing → Offer / Rejected`, drag to move, bulk actions, activity log. |
| **Network** | Every person you speak to, with a follow-up date. Referrals move these processes more than applications do. |
| **Master CV** | Your identity block and every experience entry, bilingual, with bullets tagged per track. |
| **Documents** | Five artifacts per application: CV, cover letter, outreach DM, interview prep sheet, tailoring plan. |
| **Inbox sync** | Scans recruiter email over IMAP in English and Spanish and *proposes* status moves. |

## Getting jobs in — and why not straight from LinkedIn

LinkedIn has no public jobs API, and scraping the site breaks its terms of use and its
anti-bot defences. So this pulls from LinkedIn the ways LinkedIn actually allows, plus
sources that publish openings openly. All four live under **Jobs → Import jobs**:

| Route | What it gives you |
| --- | --- |
| **LinkedIn export (CSV)** | Settings → Data privacy → *Get a copy of your data*. The archive has `Saved Jobs.csv` and `Job Applications.csv`. Columns are matched by name, so order does not matter. |
| **Paste a results page** | Select a search results page, copy, paste. Blank line between jobs; title, company, location, URL. Rough on purpose. |
| **Company job board** | Live openings straight from a company's public Greenhouse / Lever / Ashby board — the same API its own careers page calls. Works for tech, fintech and startups; large banks run their own systems. |
| **Fill Master CV from LinkedIn** | `Positions.csv`, `Education.csv`, `Skills.csv`, `Languages.csv` from the same archive, straight into the Master CV. Each position's description becomes bullets you then tag by track. |

So the loop is: save jobs on LinkedIn as you browse → export once → import → search, filter
and rank them here → check the ones worth it → generate.

### Searching the list

The search box ANDs its terms, keeps `"quoted phrases"` together, and drops anything
matching a `-excluded` word. `sales trading "buenos aires" -senior` does what it looks like.
Name a search and it becomes a chip you can click again.

**Match %** is the share of a posting's distinctive words that already appear somewhere in
your master CV. It ranks a long list; it does not judge a single job. A 12% match on a desk
you want beats a 40% match on one you don't.

### From a checked job to a CV

Tick the jobs, pick a track and a language, press **Generate CV**. Each checked job becomes
a tracked application carrying its description across as the job description, and the first
one opens in the generator with the track, language and posting already loaded.

## Spanish, and the three templates

Every document generates in **English or Spanish**, in one of three templates:

- **Clásico / apto ATS** — one column, nothing a parser can mangle. For online forms.
- **Banca y Mercados** — education first, dense, one page.
- **Consultoría** — education and results first, leadership given its own weight.

Section headings, dates (*Actualidad* rather than *Present*) and the whole cover-letter
argument are written for each language rather than translated word for word.

Your own content is bilingual by field: the Master CV has a **Versión en español** block for
the headline, profile, skills and languages, and every bullet has an **ES** box beside the
English one. Anything left blank falls back to the English text, and the Spanish CV tells you
exactly which bullets are still untranslated rather than silently mixing languages.

## The pipeline

The board runs `Saved → Tailored → Applied → Interviewing → Offer / Rejected`. Drag a card
between columns, or change status inline in list view; either way the move is written to that
application's activity log, and dropping into **Applied** stamps today's date if there isn't
one. Tick several cards and the bulk bar moves them all at once.

## Documents: five artifacts per application

Everything the generator produces is **deterministic** — it reads the posting and your master
CV and rearranges what is already there. It never invents an achievement, because a bullet you
cannot defend in an interview is worse than a missing one. Where judgement is needed the output
asks you a question instead of guessing.

| Artifact | What it is |
| --- | --- |
| **CV** | Track-filtered, in one of three templates, EN or ES. |
| **Cover letter** | Track-specific argument, your hook and proof story slotted in. |
| **Cold outreach DM** | Three sentences. Any longer and a recruiter stops reading on a phone. |
| **Interview prep sheet** | Technical questions drawn from this posting's own vocabulary, STAR behaviourals, your stories pulled from the master CV, five questions to ask them, and a research checklist. |
| **Tailoring plan** | Which of your bullets already speak the posting's language, which ATS keywords are missing, and the closest bullet each missing one belongs in. |

**Generate full pack** writes all five at once and moves the application to Tailored. Coming
from Jobs with several checked, the batch bar steps through them or generates every pack in one go.

The prep sheet does **not** fetch company news — nothing in this app calls a news API. It gives
you the four searches worth running and what to write down from each, with the links.

## Inbox sync

Point it at a mailbox over IMAP and it matches recruiter emails to companies in your pipeline,
classifies them in English and Spanish, and **proposes** status changes for you to accept or
reject. It never applies them on its own: silently marking a live process rejected because an
automated acknowledgement used the wrong phrase is exactly the failure worth avoiding. Statuses
only ever move forward, and every applied change writes an entry in the activity log.

`Gracias por postularte` is treated as an acknowledgement, not a rejection — it only ever moves
a row to Applied.

**Credentials never touch the app.** There is no password field in the interface and nothing is
stored in the database. Copy `.env.example` to `.env` and fill it in; only the API process on
your machine reads it. For Gmail use an app password (Google Account → Security → 2-Step
Verification → App passwords), never your account password.

## How the track tagging works

On **Master CV**, each bullet has track chips. A bullet with **no** chips appears on every
version. A bullet tagged `S&T` only appears when you generate a Markets CV. So the same
J.P. Morgan role can say "worked daily with rates exposures, P&L attribution and the moves
behind them" on a trading application and "rebuilt the process after mapping the workflow
with N stakeholders" on a consulting one — both true, differently aimed.

## The two checks on generated documents

- **Unfilled placeholders** — anything still in `[brackets]`. The seed deliberately plants
  these so you cannot send a document with a hole in it by accident.
- **Words in the posting your draft never uses** — a rough gap check against the job
  description you pasted on the application. Cover the ones that are genuinely true of you;
  a keyword you cannot defend in an interview is worse than a missing one.

`Print / PDF` prints just the document, on A4, without the app chrome around it.

## Layout

```
server/
  db.ts        schema + SQLite connection (node:sqlite, no native deps) + migrations
  index.ts     REST API — generic CRUD over a whitelist of tables, job search, import, email
  jobs.ts      CSV/TSV parsing, LinkedIn archive import, public ATS board fetching
  email.ts     IMAP scanning, EN/ES recruiter-email rules, proposal application
  seed.ts      one-time starting skeleton
src/
  lib/types.ts      shared types, tracks, statuses
  lib/api.ts        fetch client + the single store hook
  lib/templates.ts  the CV / cover-letter engine, templates, EN/ES copy, match scoring
  lib/tailor.ts     tailoring plan, cold outreach, interview prep generation
  pages/            Dashboard, Jobs, Pipeline, Contacts, Profile, Documents, Inbox
  components/ui.tsx the component kit, drawer, and the two chart shapes
```

Tables: `job` (the openings list), `profile` + `experience` (the master CV), `application`,
`contact`, `document` (every generated artifact, `kind` = cv/cover/outreach/prep/plan),
`event` (the activity log), `saved_search`. CV templates live in code, in
`src/lib/templates.ts`, rather than in a table — they are layout logic, not data.

The API takes `API_PORT` (not `PORT` — dev runners inject that for the web server).
