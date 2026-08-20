# LeaseLens

**Upload your lease. Ask it what it actually says.**

Every answer quotes the governing clause and cites the page. When the lease
genuinely doesn't cover something, LeaseLens says so instead of telling you what
leases usually say.

[![ci](https://github.com/OWNER/leaselens/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## The demo worth watching

Ask *"can my landlord keep my deposit for normal wear and tear?"* and you get
the clause, quoted, with a page number.

Then ask *"am I allowed to keep a python?"* of a lease whose pet clause covers
cats and dogs:

> This lease does not address reptiles. Clause 8 permits up to two cats or dogs
> under 25 pounds with written consent [1]; it says nothing about other animals,
> so the lease neither permits nor prohibits a python.

That abstention is the hard part of RAG, and it's the metric the eval harness
exists to measure.

---

## Architecture

One Next.js app. The chat UI and the API are the same deployment, the same
origin, and the same `git push`.

```
┌──────────────────────────────────────────────────────────────────┐
│  Next.js App (Vercel)  —  one origin, one deployment             │
│                                                                  │
│  Frontend (App Router)          Backend (Route Handlers)         │
│  ┌───────────────────┐          ┌─────────────────────────────┐  │
│  │ Upload dropzone   │ ───────► │ /api/documents              │  │
│  │                   │          │   parse → chunk → embed     │  │
│  │ Chat + citations  │ ───────► │ /api/chats/[id]/messages    │  │
│  │                   │ ◄─SSE─── │   rewrite→retrieve→rerank   │  │
│  │ Sidebar (history) │          │   →grade→answer             │  │
│  │ Pipeline stats    │ ───────► │ /api/admin                  │  │
│  └───────────────────┘          │ /api/auth/*                 │  │
│         │                       └──────────────┬──────────────┘  │
│         └── session cookie ────────────────────┘                 │
│             httpOnly · Secure · SameSite=Lax · Path=/            │
└──────────────────────────────────────┬───────────────────────────┘
                                        │
              ┌─────────────────────────┴────────────────────────┐
              ▼                                                   ▼
┌───────────────────────────────┐                ┌───────────────────────────────┐
│ Neon Postgres + pgvector       │                │ Google AI Studio (Gemini)      │
│  users · documents · chunks    │                │  chat: 3.7-flash /             │
│  (vector, tsvector)            │                │        3.1-flash-lite          │
│  chats · messages              │                │  embeddings:                   │
│  usage · traces                │                │    gemini-embedding-001        │
└───────────────────────────────┘                └───────────────────────────────┘
```

One provider for every model call — free tier, no card on file. `GOOGLE_API_KEY`
is the only model credential in the app.

### The pipeline

| Stage | Model | What it does |
| --- | --- | --- |
| Rewrite | Gemini 3.1 Flash-Lite | *"what about two of them?"* → a standalone query. Skipped on the first message. |
| Retrieve | — | pgvector cosine **and** `tsvector` keyword, two SQL statements, fused by **RRF** (k=60) |
| Rerank | Gemini 3.1 Flash-Lite | scores the 25 fused candidates against the question, keeps 5 |
| Grade | Gemini 3.1 Flash-Lite | *do these clauses actually answer it?* If not, widen and retry — **once** |
| Answer | Gemini 3.7 Flash | streamed over SSE, every claim cited |

Dense retrieval finds the paraphrase (*"snake"* → *"animals of any kind"*).
Keyword retrieval finds the defined term that only means something inside this
lease. Legal prose needs both, and RRF fuses them without pretending cosine
distance and `ts_rank_cd` are on the same scale.

---

## Multi-tenancy

The governing rule: **the authenticated identity determines the tenant; request
ids only select resources within that tenant.** Never the other way round.

Enforced by three overlapping mechanisms, because one is a single point of
failure:

1. **`session()`** ([lib/auth/session.ts](lib/auth/session.ts)) is the only place
   a user identity enters the system. No handler reads a user id from a body, a
   query string, or a header.
2. **`tq()`** ([lib/db/client.ts](lib/db/client.ts)) refuses at runtime to run any
   statement touching a tenant table without a `user_id` predicate — it throws
   `TenancyViolation` rather than returning rows.
3. **`tests/tenant-guard.test.ts`** applies the identical rule to
   `lib/db/queries.ts` **as source text**, so a missing filter fails CI in
   milliseconds without a database. It carries its own negative control, so it
   can't pass by matching nothing.

Plus [`tests/isolation.test.ts`](tests/isolation.test.ts): twelve distinct
cross-tenant attacks, each a different route, all expecting **404 — not 403**. A
403 would confirm the resource exists and belongs to someone.

`middleware.ts` is redirects only. Delete it and the app is still secure; it
would just show signed-out users an empty screen instead of the login page.
Middleware that guards data puts the whole boundary one matcher typo away from a
leak.

---

## Running it

```bash
cp .env.example .env.local     # DATABASE_URL, SESSION_SECRET, GOOGLE_API_KEY
npm install
npm run migrate                # idempotent; safe to re-run
npm run seed                   # generates two synthetic leases and ingests them
npm run dev
```

`npm test` needs none of that — Postgres runs in-process via PGlite, and the
model calls are faked. No Docker, no service container in CI.

| Command | |
| --- | --- |
| `npm run dev` | the app |
| `npm test` | 82 tests, ~10s, no external services |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run migrate` | apply `lib/db/schema.sql` |
| `npm run seed` | create the demo account and ingest the fixtures |
| `npm run eval` | the golden set → `eval/results.md` (free tier; takes a few minutes) |

---

## Deploying

1. **Neon** → new project, copy the **pooled** connection string (the host
   contains `-pooler`). `pgvector` ships preinstalled.
2. **Google AI Studio** → [aistudio.google.com](https://aistudio.google.com) →
   Get API key. No card on file; the free tier (1,500 requests/day on Flash)
   covers a demo comfortably.
3. **Vercel** → import the repo. Root directory is the repo root; there is no
   `frontend/` to point at. Set `DATABASE_URL`, `SESSION_SECRET`,
   `GOOGLE_API_KEY`.
4. **GitHub** → secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
   (the last two are in `.vercel/project.json` after `npx vercel link`), plus
   `DATABASE_URL` / `GOOGLE_API_KEY` for the nightly eval.
5. `npm run migrate && npm run seed` once against production.

`vercel.json` sets `"deploymentEnabled": { "main": false }`. **Leave it that
way.** Vercel's Git integration otherwise deploys on push before CI has run,
which makes the test job decorative — the opposite of the point.

**Prove the gate once, on purpose:** delete `AND user_id = $1` from `getChat` in
`lib/db/queries.ts`, open a PR, and watch `tenant-guard.test.ts` fail before the
isolation suite even connects to a database. Then revert.

---

## Design decisions

**One deployment, not two.** An earlier version of this project split a Next.js
frontend from a Dockerized FastAPI backend. That seam cost a CORS allowlist, a
`SameSite=None; Secure` refresh cookie, a rewrite proxy to make the cookie
first-party, a `refresh_tokens` table with rotation and revocation, and a test
that read the frontend config from the backend suite to keep the two halves
agreeing about a cookie path. Collapsing to one origin deleted all of it. Eight
environment variables became three — `DATABASE_URL`, `SESSION_SECRET`,
`GOOGLE_API_KEY`. What's left is the retrieval pipeline and the tenancy
boundary, which is what the project was ever about.

**No ORM.** The interesting statements are vector and tsvector SQL that an ORM
only obscures, and every one needs a tenant filter you want visible in the
source. Keeping all SQL in one file is also what makes the CI scan possible.

**scrypt, not argon2id.** argon2id is the better primitive on paper. scrypt is
memory-hard, in `node:crypto`, and cannot break a serverless build the way a
native module can. Parameters are stored with each hash so they can be raised
without invalidating anyone's password.

**One provider, free tier.** Every model call — rewrite, rerank, grade, answer,
embeddings — goes through Google AI Studio. One key, no card on file, and the
1,500-requests/day free tier on the Flash models comfortably covers a demo.
`EMBED_DIM` (768) is pinned in two places — here and the `vector(768)` column —
so a silent model or dimension change fails at INSERT rather than at retrieval.
The trade-off is the free tier's 15-requests/minute rate limit, which is why
the eval script runs slowly rather than in a burst.

**The PDF isn't stored.** Only extracted text and page numbers. Vercel's
filesystem is ephemeral and blob storage is a whole extra service; the citation
popover shows the exact clause text, which is most of what a PDF viewer would
give you.

**`after()` for ingestion.** The upload response returns an id immediately and
parsing continues past it, so the client polls instead of holding a request open
for thirty seconds. It defers the work, not the 60-second cap — which is why
`MAX_PAGES` is 60. Raising it needs a queue, not a bigger number.

---

## What this trades away

- **Independent scaling and independent deploys.** A CSS change now redeploys
  the API. At this size that's a feature; it's still a real difference.
- **A 60-second wall on every request.** Ingestion caps at 60 pages. The split
  version could run a ten-minute job.
- **Python's document ecosystem.** `pypdf` + `pdfplumber` handle table-heavy
  PDFs better than pdf.js. Leases are mostly linear prose, so this rarely bites
  — but a lease with a rent-schedule table will chunk worse here.

---

## Evaluation

`npm run eval` runs 24 questions across the two synthetic fixture leases and
writes `eval/results.md`:

- **Recall@5** — did the clause that decides the answer survive to the prompt?
- **Refusal accuracy** — on the six questions the leases genuinely don't cover,
  did it decline?
- **False refusals** — the failure mode refusal accuracy would otherwise hide.
- **Citation validity** — every `[n]` resolves to a clause actually supplied.
- **Groundedness** — LLM-as-judge: is every claim supported by a cited clause?

The fixtures are generated, never committed: `scripts/fixtures.ts` writes one
lease with numbered clauses and one in continuous plain prose, which is where
clause-boundary chunking earns or loses its keep. Never ship a real person's
lease in a public repo.

> Numbers land in `eval/results.md` after the first run. It needs live API keys,
> so it is not part of `npm test`.

---

*Information from your document, not legal advice.*
