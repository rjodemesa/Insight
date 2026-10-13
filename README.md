# Prism

**A Digital Platform for Consumer-Driven Brand Growth**

Prism (formerly Insight) is an internal web app for P&G Philippines teams. It turns online consumer reviews from Excel exports into trusted, explainable insight.

Pipeline: **Ingest Excel → clean/validate → redact personal data (reversible) → product mapping → NLP tagging → scoring → GenAI explanation → dashboards → alerts → audit log.**

> **Status: Phase 5 (complete).** Sign-in, roles, the audit chain, Excel/CSV import, the data-quality report, reversible redaction, sentiment and theme tagging, product mapping, the Intelligence Score and trend tests are working. So are the Dashboard and Insights screens, with global filters, drill-down, provenance labels, product merge/split, tag and redaction feedback, saved views and Excel export. Phase 4 adds the AI summary, Ask AI, AI second-opinion tagging and agent alerts with approval, on Gemini or an offline mock. Phase 5 adds the Audit Log screen (chain check, CSV export) and the Admin screen (system health, users, personal data, AI, purge). See [docs/PHASE0.md](docs/PHASE0.md) for the overall plan.

## Run it

Requires Node.js 20.12 or later (tested on Node 24, Windows ARM64).

```bash
npm install
npm run dev        # http://localhost:3000
```

On the first `npm run dev`, the app does two things:
1. It creates `.env.local` with random `SESSION_SECRET` and `PII_VAULT_KEY` values and prints a temporary IT-officer password. The file is never overwritten.
2. It creates the SQLite database in `./data/` and the first IT officer, `admin@prism.local` (copies set up before the rename keep `admin@insight.local`). You must change the password at first sign-in.

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

Rule-based tagging has limits. Sarcasm, and complaints phrased without a sentiment word, can be read as neutral or positive. `npm run ai-tag` adds an AI second opinion on those reviews (see [AI](#ai)).

## Using the app

- **Filters** sit above every chart and live in the page address, so the back button undoes a filter and a copied link shares the exact view. Choices come from the data; no brand, retailer or category is hard-coded.
- **Drill-down**: click a bar, a month, a tile or a finding to open the reviews behind it.
- **Provenance**: every number carries OBSERVED, DERIVED or ESTIMATED; hover for the definition. "How is this calculated?" panels show the formulas from the code.
- **Dashboard**: headline tiles, Key findings, sentiment over time, top themes, issues by Five Vectors, retailer comparison and brand ranking. Key findings are written by fixed rules from the numbers on the page; **Write summary** beside them asks the AI for a summary grounded in the same facts. Approved alerts show at the top. *Analyst hours saved* is ESTIMATED from an editable minutes-per-review assumption (default 1.5); changes are audited.
- **Insights**: a theme explorer grouped by vector, product and brand rankings, product and brand pages with a score breakdown, and the review viewer. Under each review, **Is a tag wrong?** and **Missed personal info?** record feedback. Feedback does not change data; it is listed on the Data tab for whoever updates the taxonomy or redaction rules.
- **Data** is four steps: **1 Import** (upload, quality report, history), **2 Verify reviews**, **3 Product mapping** and **4 Feedback**.
- **Data → Verify reviews**: the reviews the tagger is unsure about, for a person to confirm or correct (Positive, Neutral, Negative, or Unreadable/spam). A verdict replaces the automatic label in every chart, export and AI answer, is kept when the data is re-tagged, is audited, and can be undone. What to include:
  - **Confidence below** a threshold (slider). At 30%, only reviews where the tagger found no sentiment words.
  - **Mixed or weak wording**: sentiment words that cancel out, at any confidence.
  - **Stars disagree with text**.

  **Truly uncertain** (the default) ticks all three at 30%: 11,593 reviews on the current data. **Everything below 75%** is 22,871 (41% of reviews with text). The **How reliable is the automatic label?** chart shows, per confidence band, how often the label contradicts the star rating. The tagger never reads the stars, so this is an independent check. Mistakes cluster where wording is mixed (about 1 in 8 contradict the stars below a strength of 0.35, against under 3 in 100 above it) rather than simply at low confidence. Unreadable reviews leave sentiment, like reviews without text, but still count toward ratings.
- **Rating filter** (above every review list and in Verify reviews): the average rating, a bar per star, and Lazada/Shopee-style chips for All, 5★ to 1★, **With comments** and **With photos**, each with its count.
- **Insights → Brands → Brand comparison** treats all brands as one portfolio:
  - each brand's reviews, **visibility** (its share of all reviews), average rating, star mix and 1–2★ share;
  - **overperformers** and **underperformers**: at least 0.05★ from the average of all other brands and statistically significant (Welch z-test). Each brand is assumed to vary at least as much as the portfolio, so a small all-5★ brand is not over-certain. Brands with under 30 ratings aren't judged.

  The Intelligence Score ranking follows below.
- **Data → Product mapping review**: products with the weakest name matches come first. Tick products to **merge** them, or open one to **split** listing names off into a new product. Both are audited, and later imports and reprocessing keep them.
- **Views ☆**: save the current filters under a name and persona, or start from a built-in view per persona. Views are private to each user.
- **Export**: every chart and table has an Export link that downloads the filtered data as Excel. Each file includes an *About this export* sheet (filters, who, when, provenance of every column). Text is always the redacted text, for every role, and exports are audited. Review exports stop at 100,000 rows.
- **Ask AI**: ask about the reviews under the current filters, in English, Filipino or Taglish. Naming a brand, retailer or theme narrows the answer to it. Answers cite facts [F#] and reviews [R#]; click a citation to check it.
- **Alerts**: **Run agent now** checks the data for significant changes and proposes alerts with evidence. Each one needs **Approve** or **Dismiss**, with an optional note; decisions are final and audited.
- Charts use blue for positive, gray for neutral and red for negative, a scale that stays distinguishable with red-green colour blindness. Each chart has a Table view.

Aggregates are cached in memory for up to 5 minutes and cleared whenever an import, merge or split changes the data. `npx tsx scripts/bench-queries.ts` times the dashboard queries against the local database.

## AI

Set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` (from Google AI Studio) in `.env.local`, then restart. `GEMINI_MODEL` defaults to `gemini-3.8-flash`. Without a key the app uses the **mock** provider: it works offline and restates the computed facts, and every AI panel says so. On Gemini's free tier Google may use prompts to improve its products, so use a paid key for real consumer data.

How it stays trustworthy:
- **Redacted text only.** The AI sees the same redacted text as users, never the PII vault.
- **Grounded.** Each request carries numbered facts computed by the app (with sample sizes) and a few numbered reviews. The prompt tells the model to use nothing else and to cite inline. The server removes any citation that points at something it did not supply, and the UI flags claims with no citation.
- **Labelled.** AI text carries the AI badge and names the model. The numbers behind it stay DERIVED.
- **Audited.** Every AI call logs the provider, model, prompt version and a hash of the prompt. Ask AI logs the question's length, not its text.
- **Bounded.** Each user can make 30 AI requests per 10 minutes. The same dashboard summary is reused for an hour unless you click Rewrite.

**AI tagging** (`npm run ai-tag`) gives a second opinion on reviews the rules handle badly: reviews with text but no theme (7,983 in the current data) and reviews whose rating disagrees with the text. It sends 20 reviews per Gemini call and does 200 reviews per run by default (`-- --limit 1000`, `-- --scope untagged|conflict`, `-- --count` to see what is waiting). AI themes are stored with source `AI` next to rule tags and count in the theme charts. A rule or human tag on the same theme wins. The AI's sentiment is shown in the review viewer when it disagrees with the rules, but the charts keep using rule sentiment. Reprocessing keeps AI tags, and a taxonomy or model change queues the reviews again. It refuses to run on the mock unless you pass `--allow-mock`.

**The agent** (`Run agent now` on the Alerts tab, or `npm run agent` on a schedule) runs fixed statistical checks. Whether an alert exists and how severe it is never depends on the AI:
- a theme's negative mentions rising in the last 30 days against the 90 days before, overall and for the 8 largest brands (two-proportion z-test, at least 10 recent complaints);
- the negative share rising in the latest month;
- a retailer's negative share in the last 90 days being significantly above all other retailers.

The AI then writes each alert's description and suggested next step from its evidence. If the AI fails, the alert is still proposed with rule-written text. The same change in the same time window is never proposed twice. On the current data (one retailer, flat negative share), the agent finds nothing to propose.

## Audit Log and Admin

**Audit Log** lists every sign-in, import, export, AI call, alert decision and admin change, newest first, with filters by action, status, user and date (UTC days; times are shown in Manila time). Users see their own entries. IT officers see everyone's and get two more buttons:
- **Verify chain** re-hashes the whole log and names the first entry changed outside the app.
- **Export CSV** downloads the filtered log. Cells that a spreadsheet would run as formulas are neutralised. The export itself is audited.

**Admin** (IT officers only; the server refuses everyone else):
- **System health**: checks for the schema version, the audit chain, whether `PII_VAULT_KEY` actually decrypts the vault, the AI provider, tagging that needs reprocessing, stuck imports, and whether there are at least two IT officers. Also shows the main counts and the database size.
- **Users**: add users, change roles, disable or enable accounts, and reset passwords. New accounts and resets get a one-time temporary password that is shown once and must be changed at sign-in. Role changes, disabling and resets sign the user out everywhere. You cannot change your own role or disable yourself, and there is always at least one active IT officer.
- **Personal data**: reveal one review's originals (reason required, audited) and restore wrongly redacted values. Restoring puts the original back into the stored text for every user, export and AI request, deletes it from the vault and re-tags the review, so use it only for false positives such as an order number read as personal data. The tab also lists reviews users flagged for missed personal data, and what the vault holds.
- **AI**: the provider, model and key status in use (read-only: they live in `.env.local`, never in the database), a **Test connection** button that sends no review data, and the last 7 days of AI calls with token counts.
- **Purge** (irreversible, exact confirmation text required, audited):
  - delete an import with its reviews, tags, vault entries and feedback, plus products left with no reviews;
  - purge the vault's customer image links, or the whole vault, which makes redaction permanent.

  The audit log is never purged. The database file does not shrink until it is vacuumed.

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

Admin routes (IT officers only; changes need the CSRF header and are audited): GET `/api/admin/health`, `/api/admin/ai`, `/api/admin/pii`, `/api/admin/purge`, `/api/admin/users`; POST `/api/admin/users` `{email, displayName, role}`, PATCH `/api/admin/users/:id` `{role?, disabled?, displayName?}`, POST `/api/admin/users/:id/reset-password`, `/api/admin/pii/reveal` `{reviewId, reason}`, `/api/admin/pii/restore` `{reviewId, tokens, reason}`, `/api/admin/purge` `{target: import, id, confirm}` or `{target: vault, scope: images|all, confirm}`, `/api/admin/ai/test`. Audit: GET `/api/audit` (own entries, or all for IT officers), `/api/audit/verify` and `/api/audit/export` (IT officers).

Verification: GET `/api/verify` (the usual filters plus `threshold` = 0.3–1 or `off`, `mixed`, `disagree`, `sort`, `limit`, `offset`), GET `/api/verify/overview` (reliability by confidence band, recent verdicts), POST `/api/verify` `{reviewId, verdict}`, DELETE `/api/verify/:id` (undo). Also GET `/api/aggregates/ratings` (star breakdown) and `/api/aggregates/brand-comparison`. New filters: `hasText`, `hasPhotos`.

AI routes (POST, CSRF header, audited): `/api/ai/summary` `{query, refresh?}`, `/api/ask` `{question, query, history}`, `/api/alerts/scan`, `/api/alerts/:id/decision` `{decision: approve|dismiss, note}`. `query` is the filter query string. GET `/api/ai/status` returns the provider and model; GET `/api/alerts?status=proposed|approved|dismissed|all` lists alerts.

Changes (all need the CSRF header and are audited): `POST /api/products/merge` `{targetId, sourceIds}`, `POST /api/products/:id/split` `{aliasIds, name?}`, `POST /api/feedback/tag` `{reviewId, theme, suggested, comment}`, `POST /api/feedback/redaction` `{reviewId, note}`, `POST /api/views` `{name, persona, filters}`, `DELETE /api/views/:id`, `PUT /api/settings/estimates` `{minutesPerRecord}`.

Every read route accepts the same filters; repeat a parameter to pass several values. The filters are `retailer`, `category`, `subcategory`, `brand`, `product` (id), `review` (id), `sentiment` (positive, neutral, negative, none), `language`, `theme`, `vector`, `themeSentiment`, `from` and `to` (YYYY-MM-DD, inclusive), `minRating`, `maxRating`, `verified`, `conflict`, `includeDuplicates`, `hasText`, `hasPhotos` and `q` (text search in redacted text). Example: `/api/aggregates/themes?vector=Packaging&retailer=Lazada&from=2024-01-01`.

## Environment variables

See [.env.example](.env.example). All values are server-side only; none use `NEXT_PUBLIC_`.

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `mock` (default, offline) or `gemini` |
| `GEMINI_API_KEY` | Google AI Studio key, needed when `AI_PROVIDER=gemini` |
| `GEMINI_MODEL` | Optional. Defaults to `gemini-3.8-flash` |
| `PII_VAULT_KEY` | 32 bytes, base64. Encrypts the PII vault (AES-256-GCM). Redaction refuses to run without it |
| `SESSION_SECRET` | At least 32 characters. Signs session cookies |
| `PRISM_DB_PATH` | Optional. Database file; defaults to `data/prism.db`. A `data/insight.db` from before the rename is renamed automatically at the next start |
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

P&G branding, for an academic presentation only: this is not an official P&G product, and every page says so in its footer. The logo (`public/brand/logo.svg`, also the browser-tab icon in `app/icon.svg`) is the current P&G mark from Wikimedia Commons, unmodified. P&G does not publish its colour specs, so the brand blue is Pantone 293 C (`#003DA5`), the core blue of the logo, with the logo's light blue `#00A3E0` used only for the stripe under the header. Tokens are in `app/globals.css`, mirrored in `lib/theme.ts`. Chart colours stay on the colour-blind-safe scale. Fonts are system fonts, because P&G's typeface is proprietary.

## Limitations (current phase)

- AI settings are edited in `.env.local`, not in the app, by design.
- Purges do not shrink the database file; run `VACUUM` with the server stopped to reclaim space.
- Ask AI conversations are not saved; leaving the page clears them.
- The AI request limit and summary cache are in memory, like the login limiter.
- There is no dark mode yet; the colour tokens are light-only.
- Uploaded files are deleted once their import finishes; only the redacted rows are kept.
- The login rate limiter and job runner are in-process, so run a single server instance.
