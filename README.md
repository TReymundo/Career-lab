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

## The five screens

| Screen | What it is for |
| --- | --- |
| **Dashboard** | What is due, where the funnel is stuck, how your effort splits across tracks. |
| **Pipeline** | Every target and application: stage, priority, next action with a date, pasted job description, activity log. |
| **Network** | Every person you speak to, with a follow-up date. Referrals move these processes more than applications do. |
| **Master CV** | Your identity block and every experience entry, with bullets tagged per track. |
| **Documents** | Generates the CV and cover letter, checks them, saves each version you send. |

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
  db.ts        schema + SQLite connection (node:sqlite, no native deps)
  index.ts     REST API — generic CRUD over a whitelist of tables
  seed.ts      one-time starting skeleton
src/
  lib/types.ts      shared types, tracks, statuses
  lib/api.ts        fetch client + the single store hook
  lib/templates.ts  the CV / cover-letter engine and the two checks
  pages/            Dashboard, Pipeline, Contacts, Profile, Documents
  components/ui.tsx the small component kit
```

The API takes `API_PORT` (not `PORT` — dev runners inject that for the web server).
