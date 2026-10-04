# Career Lab

A local job-search workbench: build a CV, find jobs, generate tailored documents, and track
every application — all on your own machine, in one SQLite file that never leaves it.

It assumes nothing about you. No particular university, country, field or amount of
experience. If you have never had a job, the guided path builds your first CV from what you
*have* done.

## Opening it

Double-click **`Open Career Lab.bat`** in this folder. It starts everything and opens your
browser at http://localhost:5273. Keep the black window open while you use the app; closing it
stops the app. On a first run it installs what it needs — including Node.js itself, if the
computer does not have it — which takes a few minutes.

**On another laptop:** unzip `CareerLab.zip` anywhere (e.g. Documents), double-click
`Open Career Lab.bat`, and accept the installer prompt if Windows shows one. It starts empty:
add your AI keys in **More → AI keys**, and to carry your data over, download a backup on the
old computer (**Track → Download a backup**) and restore it on the new one.

Or, from a terminal:

```bash
npm install
npm run dev
```

### On a new machine (after cloning from GitHub)

The repository holds the code only. Two things live outside it on purpose and need setting
up once per machine:

- **Your data** — `data/career-lab.db` is not committed. A fresh clone starts empty; restore a
  backup from **Track → Download a backup** on the old machine if you want to carry it over.
- **Your AI keys and connections** — add AI keys again in **More → AI keys**; Gmail and Google for
  Jobs are reconnected in **Find jobs → Sources** (they are saved to a local `.env`). None of it
  is ever committed.

Then `npm install`, `npm run dev`, and open http://localhost:5273.

Either way, open http://localhost:5273 and follow **Start here**. That is the whole instruction.

`npm run reset` empties everything if you want to begin again from scratch.

## How it is laid out

The work is split so that each screen is one idea, and screens appear only when you reach them.

**Start here** is you and your CV, and nothing else — three phases of short steps that save,
cross themselves off, and open the next one:

| Phase | What happens |
| --- | --- |
| **1 · Who you are** | Name, contact details, and what kind of work you are going for. |
| **2 · Build your CV** | Upload a CV you already have, or build one from nothing — then the things recruiters look for, then a number in every line. |
| **3 · Sharpen it with AI** | Optional, with your own Google key: rewrite lines, write your profile paragraph, review and correct the whole CV. |

Everything after that has its own screen, each opening with a short guide that dismisses once
you know it: **Jobs** for finding openings, **Documents** for generating what you send,
**Pipeline** for tracking it. The sidebar shows only what you have reached; locked entries say
what opens them, and one toggle reveals everything for good.

### If you have no experience

Step "Your experience" opens with the list of things that count on a first CV: any job at all,
a school or university project, a club or team role, tutoring, a family business, sport,
volunteering, a side project. Then a builder turns one into a proper line — **doing word →
what → how big → what came of it** — assembling the sentence as you type.

### If you already have a CV

Upload a `.docx`, or paste the text. It reads your name, email, phone, LinkedIn, and every job
and education entry with its dates and bullets, in English or Spanish. It shows you what it
found and writes nothing until you confirm. (For a PDF: open it, select all, copy, paste.)

## The AI step

Optional and entirely under your control. Create a free key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey), paste it into the AI step,
and three things become available: rewriting bullets, writing your profile paragraph, and an
honest review of your CV against the kind of role you picked.

The model is instructed never to invent a fact, a number, an employer or a date. When a bullet
has no measurable result it leaves a bracketed question asking *you* for the figure rather than
making one up. Nothing is ever sent in the background — every call happens because you pressed
a button, and only the text you are working on goes with it.

Your key is stored on this machine only: in the local database, or in a `.env` file as
`GOOGLE_API_KEY` if you would rather keep it out of the database entirely. Google bills your
own account for what you use.

## The screens, once they unlock

| Screen | What it is for |
| --- | --- |
| **My CV** | Your history, written once, bilingual, with each line taggable by the kind of role it sells. |
| **Jobs** | Import from LinkedIn or a public job board, search with a real query grammar, rank by match, generate from checked rows. |
| **Documents** | CV, cover letter, cold outreach message, interview prep sheet, tailoring plan, interview debrief — exported as DOCX or PDF. |
| **Pipeline** | A drag-and-drop board: Saved → Tailored → Applied → Interviewing → Offer / Rejected. |
| **Answer bank** | The eleven questions application forms keep asking, with word limits and coaching notes. |
| **Network** | People you speak to, and when to come back to them. |
| **Dashboard** | Applications per week, response rate, funnel, and what is due. |
| **Inbox sync** | Scans recruiter email over IMAP in English and Spanish and *proposes* status changes. |

## Getting jobs in

LinkedIn has no public jobs API, and scraping it breaks their terms. So this pulls from
LinkedIn the ways LinkedIn allows, plus sources that publish openings openly:

- **LinkedIn export** — Settings → Data privacy → *Get a copy of your data*, then import
  `Saved Jobs.csv` or `Job Applications.csv`. Columns are matched by name.
- **Paste a results page** — copy a search results page and paste it. Works immediately.
- **Public job boards** — live openings from a company's Greenhouse, Lever or Ashby board.
- **Master CV import** — `Positions.csv`, `Education.csv`, `Skills.csv` from the same archive.

Search supports `AND` terms, `"quoted phrases"` and `-exclusions`:
`analyst "buenos aires" -senior`. Save a search and it becomes a chip you can click again.

## Two languages

Every document generates in English or Spanish, in one of three templates (ATS-safe, banking,
consulting). Headings and dates are written for each language rather than translated. Your own
content is bilingual by field: a Spanish block on your CV and an ES box beside every bullet.
Anything left blank falls back to English, and the Spanish CV tells you exactly which lines are
still untranslated instead of silently mixing the two.

## Exporting

**DOCX** for application forms — most parsers read Word more reliably than PDF. **PDF** for
anything you email. Files are named `Surname_Name_CV_Company_EN.docx`, with accents
transliterated because filenames travel through systems that mangle them.

## Inbox sync

Point it at a mailbox over IMAP and it matches recruiter emails to companies in your pipeline,
reads them in English and Spanish, and **proposes** status changes for you to accept or reject.
It never applies them on its own. Statuses only move forward, and every applied change writes
an entry in the activity log. `Gracias por postularte` is treated as an acknowledgement, not a
rejection.

Credentials never touch the interface: copy `.env.example` to `.env` and fill it in. For Gmail
use an app password, never your account password.

## Backup

**Start here → Back it up** downloads every table as one JSON file, and restores from one.
Everything otherwise lives in a single file on a single laptop.

## Layout

```
server/
  db.ts        schema, SQLite connection (node:sqlite, no native deps), migrations
  index.ts     REST API — CRUD, job search, import, export, AI, email
  jobs.ts      CSV/TSV parsing, LinkedIn archive import, public job-board fetching
  cvimport.ts  reads an existing CV (.docx / text) into your CV
  export.ts    Markdown → DOCX and PDF, plus file naming
  ai.ts        optional Google Gemini calls, with strict no-inventing rules
  email.ts     IMAP scanning and EN/ES recruiter-email rules
  reset.ts     empties everything
src/
  lib/types.ts      shared types, tracks, statuses
  lib/api.ts        fetch client + the single store hook
  lib/templates.ts  the CV / cover-letter engine, templates, EN/ES copy, match scoring
  lib/tailor.ts     tailoring plan, outreach, interview prep and debrief
  lib/questions.ts  the standard application-form questions
  pages/            Start, Profile, Jobs, Documents, Pipeline, Answers, Contacts, Dashboard, Inbox
  components/ui.tsx the component kit, drawer, charts
```

Tables: `job`, `profile` + `experience` (your CV), `application`, `contact`, `document`,
`event` (the activity log), `saved_search`, `answer`, `setting`. CV templates live in code
rather than in a table — they are layout logic, not data.

The API reads `API_PORT` (not `PORT` — dev runners inject that for the web server).
