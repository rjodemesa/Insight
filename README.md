# Insight: Consumer Insight Platform

An internal web app for P&G Philippines teams. It turns online consumer reviews from Excel exports into trusted, explainable insight.

Pipeline: **Ingest Excel → clean/validate → redact personal data (reversible) → product mapping → NLP tagging → scoring → GenAI explanation → dashboards → alerts → audit log.**

> **Status: Phase 3 (UI).** Sign-in, roles, the audit chain, Excel/CSV import, the data-quality report, reversible redaction, sentiment and theme tagging, product mapping, the Intelligence Score and trend tests are working. So are the Dashboard and Insights screens, with global filters, drill-down, provenance labels, product merge/split, tag and redaction feedback, saved views and Excel export. AI arrives in Phase 4, and the Audit Log and Admin screens in Phase 5. See [docs/PHASE0.md](docs/PHASE0.md) for the overall plan.

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

Other commands: `npm run build && npm start` (production), `npm test`, `npm run typecheck`, `npm run seed`, `npm run fixture` (rebuilds the synthetic sample file), `npm run reprocess` (re-tags stored reviews; see below).

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

## Tagging, product mapping and scores

Every import tags each review after redaction, so tagging only ever sees redacted text. Labels in the API and UI say whether a number is OBSERVED (straight from the file) or DERIVED (by a formula below).

- **Sentiment** (`lib/nlp/sentiment.ts`): a lexicon scorer for English, Filipino and Taglish, including text-speak and emoji. A negator ("hindi", "di", "walang", "not") flips the next sentiment word. Intensifiers ("sobrang", "napaka-", "very") strengthen it and "medyo" weakens it. Words after "pero"/"but" count more. The result is a score from −1 to 1 and a label: positive ≥ 0.05, negative ≤ −0.05, otherwise neutral. Reviews with no text have no sentiment.
- **Themes** (`config/taxonomy.json`): 28 themes, each in one of the Five Vectors (Product, Packaging, Communication, Retail Execution, Value). Each theme in a review gets its own sentiment: "Medyo mahal pero sulit" is negative on Price and positive on Value for money. Tags record their source (`rule`, `AI` or `human`). Reprocessing never overwrites human tags.
- **Rating/text conflict**: 4–5 stars with clearly negative text (score ≤ −0.3), or 1–2 stars with clearly positive text.
- **Product mapping** (`lib/mapping/`): listings are matched to canonical products in this order: UPC, then brand + retailer code, then brand + normalized name + size, then a fuzzy name match (≥ 0.85, same brand, size and format). Different sizes, and refill versus bottle, never merge. Every spelling is kept as an alias with its similarity.
- **Trust weight** (per review): verified (1.0 / unknown 0.8 / no 0.6) × text (none 0.5 / 1–3 characters 0.7 / otherwise 1.0) × a helpful-votes bonus of up to 1.5×. Duplicates get 0.
- **Intelligence Score** (0–100): 100 × (0.40·sentiment + 0.35·rating + 0.25·issue-free share), all trust-weighted. It is then pulled toward the comparison set's score by (w·raw + 20·prior) / (w + 20), so a product with 3 reviews can't outrank one with 3,000. Each score has a reliability: low (under 30 reviews), medium (under 100) or high.
- **Trends**: monthly or weekly series. A change is "significant" when a two-proportion z-test gives |z| ≥ 1.96 and both periods have at least 30 reviews. Themes compare the last 30 days (configurable) with the 90 days before.

To change the wording rules, edit `config/taxonomy.json` or a `config/lexicon.*.json` file and bump its `version`. Then stop the server and run `npm run reprocess`, which re-tags only reviews tagged with an older version (`npm run reprocess -- --all` re-tags everything). Run it once after upgrading so Phase 1 imports get tagged. On 75k reviews it takes a few seconds.

Rule-based tagging has limits. Sarcasm, and complaints phrased without a sentiment word, can be read as neutral or positive. AI tagging (Phase 4) will add a second opinion.

## Using the app

- **Filters** sit above every chart and live in the page address, so the back button undoes a filter and a copied link shares the exact view. Choices come from the data; no brand, retailer or category is hard-coded.
- **Drill-down**: click a bar, a month, a tile or a finding to open the reviews behind it.
- **Provenance**: every number carries OBSERVED, DERIVED or ESTIMATED; hover for the definition. "How is this calculated?" panels show the formulas from the code.
- **Dashboard**: headline tiles, Key findings, sentiment over time, top themes, issues by Five Vectors, retailer comparison and brand ranking. Key findings are written by fixed rules from the numbers on the page; an AI summary is added in Phase 4. *Analyst hours saved* is ESTIMATED from an editable minutes-per-review assumption (default 1.5); changes are audited.
- **Insights**: a theme explorer grouped by vector, product and brand rankings, product and brand pages with a score breakdown, and the review viewer. Under each review, **Is a tag wrong?** and **Missed personal info?** record feedback. Feedback does not change data; it is listed on the Data tab for whoever updates the taxonomy or redaction rules.
- **Data → Product mapping review**: products with the weakest name matches come first. Tick products to **merge** them, or open one to **split** listing names off into a new product. Both are audited, and later imports and reprocessing keep them.
- **Views ☆**: save the current filters under a name and persona, or start from a built-in view per persona. Views are private to each user.
- **Export**: every chart and table has an Export link that downloads the filtered data as Excel. Each file includes an *About this export* sheet (filters, who, when, provenance of every column). Text is always the redacted text, for every role, and exports are audited. Review exports stop at 100,000 rows.
- Charts use blue for positive, gray for neutral and red for negative, a scale that stays distinguishable with red-green colour blindness. Each chart has a Table view.

Aggregates are cached in memory for up to 5 minutes and cleared whenever an import, merge or split changes the data. `npx tsx scripts/bench-queries.ts` times the dashboard queries against the local database.

## Read API

All routes are GET and need a signed-in user. Responses include the active filters, a `provenance` map and the method text.

| Route | Returns |
|---|---|
| `/api/reviews` | Redacted reviews with tags. `sort` = newest, oldest, helpful, rating_low, rating_high; `limit` ≤ 100; `offset` |
| `/api/aggregates/summary` | KPIs, sentiment shares and the Intelligence Score of the filtered set |
| `/api/aggregates/trend` | `bucket` = month or week, with a change test on the latest period |
| `/api/aggregates/themes` | Theme and vector counts with sentiment and recent change (`days`, default 30) |
| `/api/aggregates/retailers`, `/api/aggregates/brands` | Comparisons with scores |
| `/api/aggregates/filters` | Values for the filter controls, and how many reviews need reprocessing |
| `/api/products`, `/api/products/:id` | Products with scores; one product's aliases, themes, trend and score against its category |
| `/api/aggregates/operations` | Latest import's data-quality score and processing time, and the estimate assumptions |
| `/api/mapping`, `/api/mapping/:id` | Products to review for mapping, weakest first; one product's aliases with ids |
| `/api/feedback` | Tag corrections and missed-redaction flags |
| `/api/views` | Your saved views and the persona presets |
| `/api/export?kind=…` | Excel download: `reviews`, `products`, `brands`, `retailers`, `themes` or `trend` |

Changes (all need the CSRF header and are audited): `POST /api/products/merge` `{targetId, sourceIds}`, `POST /api/products/:id/split` `{aliasIds, name?}`, `POST /api/feedback/tag` `{reviewId, theme, suggested, comment}`, `POST /api/feedback/redaction` `{reviewId, note}`, `POST /api/views` `{name, persona, filters}`, `DELETE /api/views/:id`, `PUT /api/settings/estimates` `{minutesPerRecord}`.

Every read route accepts the same filters; repeat a parameter to pass several values. The filters are `retailer`, `category`, `subcategory`, `brand`, `product` (id), `review` (id), `sentiment` (positive, neutral, negative, none), `language`, `theme`, `vector`, `themeSentiment`, `from` and `to` (YYYY-MM-DD, inclusive), `minRating`, `maxRating`, `verified`, `conflict`, `includeDuplicates` and `q` (text search in redacted text). Example: `/api/aggregates/themes?vector=Packaging&retailer=Lazada&from=2024-01-01`.

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

- No AI summaries, Ask AI or alerts yet (Phase 4), and the Audit Log and Admin tabs are placeholders until Phase 5.
- There is no dark mode yet; the colour tokens are light-only.
- Uploaded files are deleted once their import finishes; only the redacted rows are kept.
- The login rate limiter and job runner are in-process, so run a single server instance.
