# Insight: Consumer Insight Platform

An internal web app for P&G Philippines teams. It turns online consumer reviews from Excel exports into trusted, explainable insight.

Pipeline: **Ingest Excel → clean/validate → redact personal data (reversible) → product mapping → NLP tagging → scoring → GenAI explanation → dashboards → alerts → audit log.**

> **Status: Phase 1 (ingestion and privacy).** Sign-in, roles, the audit chain, Excel/CSV import with progress and cancel, the data-quality report and reversible redaction are working. Dashboards, NLP and AI arrive in Phases 2–5. See [docs/PHASE0.md](docs/PHASE0.md) for the overall plan.

## Run it

Requires Node.js 20.12 or later (tested on Node 24, Windows ARM64).

```bash
npm install
npm run dev        # http://localhost:3000
```

On the first `npm run dev`, the app does two things:
1. It creates `.env.local` with random `SESSION_SECRET` and `PII_VAULT_KEY` values and prints a temporary IT-officer password. The file is never overwritten.
2. It creates the SQLite database in `./data/` and the first IT officer, `admin@insight.local`. You must change the password at first sign-in.

**Back up `PII_VAULT_KEY`.** Without it, redacted originals cannot be restored.

Other commands: `npm run build && npm start` (production), `npm test`, `npm run typecheck`, `npm run seed`, `npm run fixture` (rebuilds the synthetic sample file).

## Importing data

- **In the app:** Data tab → drag in an `.xlsx`, `.csv` or `.csv.gz` file (up to 250 MB) with the 32 standard columns. You'll see a progress bar and a Cancel button. A cancelled or failed import keeps no rows.
- **From the command line** (IT): stop `npm run dev` first, then run `npm run import -- "C:/path/to/file.csv.gz"`.
- Excel files: the first sheet with the 32 columns is imported. Other sheets, such as `PointerStorage`, are ignored.
- Duplicates are matched on `retailerReviewId`, within the file and against earlier imports. They're flagged and kept out of analysis.
- Try it with `fixtures/sample_reviews.xlsx`: 200 synthetic rows, no real data.

## Redaction and reversal

During import, before anything is stored, the app finds personal data in the review title and text and swaps it for tokens like `[PHONE_001]` (the same value in one review always gets the same token). It looks for:
- emails, PH mobile and landline numbers
- order, tracking and reference numbers, and long digit runs
- links and @handles
- barangay, purok, block-and-lot and street cues
- names after cues like "ako si", "my name is", "po si" or "this is", and sign-offs like "- Ana"

Customer image links are never shown, only counted. Rules are in `lib/redact/rules.ts`.

The originals go into `pii_vault`, encrypted with AES-256-GCM using `PII_VAULT_KEY`. Each ciphertext is bound to its review, field and token. Only an IT officer can reveal a record (`POST /api/admin/pii/reveal`), a reason of at least 10 characters is required, and every reveal is audited.

Detection is best-effort: names without a cue word, especially in Taglish, can be missed, and some links or digit strings are redacted when they don't need to be.

## Environment variables

See [.env.example](.env.example). All values are server-side only; none use `NEXT_PUBLIC_`.

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `mock` (default, offline), `watsonx` or `gemini` |
| `GEMINI_*`, `AI_API_KEY`, `WATSONX_*` | Optional provider credentials |
| `PII_VAULT_KEY` | 32 bytes, base64. Encrypts the PII vault (AES-256-GCM). Redaction refuses to run without it |
| `SESSION_SECRET` | At least 32 characters. Signs session cookies |
| `INITIAL_IT_OFFICER_EMAIL` / `_PASSWORD` | First admin account, created by the seed script |

## Roles

- **user**: Dashboard, Data, Insights, Ask AI, Alerts, own Audit Log entries, Export.
- **it_officer**: everything above, plus Admin (users, PII reveal and restore, purge, AI settings, system health) and the full Audit Log.

Roles are enforced on the server in every API route (`lib/auth/guard.ts`), not only in the UI.

## Security

- Passwords are hashed with bcrypt (cost 12). Sessions use an httpOnly, SameSite=Strict cookie signed with HMAC; only a hash of the session id is stored.
- CSRF protection: a per-session token in the `X-CSRF-Token` header, plus an Origin check on every mutation.
- Sign-in is rate limited (5 failures per 15 minutes per IP and email). Failed sign-ins are audited.
- The audit log is append-only (database triggers) and hash-chained. `verifyAuditChain()` detects edits.
- Consumer data never enters git: `.gitignore` excludes `data/`, `*.db`, `*.xlsx` and `.env*`.

## Branding

Colours and fonts are placeholder tokens in `app/globals.css`, mirrored in `lib/theme.ts` for charts. Replace `public/brand/logo.svg` with the official asset. The P&G logo is intentionally not recreated.

## Limitations (current phase)

- No NLP tagging, product mapping, dashboards or AI yet. These arrive in Phases 2–5.
- Uploaded files are deleted once their import finishes; only the redacted rows are kept.
- The login rate limiter and job runner are in-process, so run a single server instance.
