# Phase 0: plan and scaffold

## File tree (✓ = exists now; the rest is planned)

```
app/
  layout.tsx, globals.css (theme tokens) ✓   page.tsx → /dashboard ✓
  login/ ✓   change-password/ ✓
  (app)/layout.tsx (session gate + nav) ✓
  (app)/dashboard|data|insights|ask|alerts|audit|admin/page.tsx ✓ placeholders
  api/auth/login|logout|me|change-password ✓   api/health ✓
  api/ingest/*           Phase 1  upload, job status, cancel, quality report
  api/reviews, api/aggregates/*, api/products/*   Phase 2–3
  api/export, api/views  Phase 3
  api/ask, api/alerts/*  Phase 4
  api/audit, api/admin/* Phase 5
components/ AppNav.tsx ✓  Placeholder.tsx ✓  (charts, filters, Provenance badge: Phase 3)
lib/
  db.ts, schema.ts (migrations) ✓   audit.ts (hash chain) ✓   env.ts ✓   theme.ts ✓
  auth/ session.ts, guard.ts, password.ts, rateLimit.ts ✓
  ingest/ (streaming xlsx, validation)  redact/ (rules, vault)       Phase 1
  nlp/ (language, sentiment, taxonomy)  mapping/  score/  trend/     Phase 2
  ai.ts (AIProvider: mock | watsonx | gemini), agent/                Phase 4
config/ taxonomy.json, lexicon.*.json     Phase 2
fixtures/ sample_reviews.xlsx (200 synthetic rows)  Phase 1
scripts/ setup-env.mjs ✓  seed.ts ✓
tests/ audit.test.ts ✓  auth.test.ts ✓
middleware.ts ✓  public/brand/logo.svg ✓ (placeholder)
```

## Data model (SQLite, `lib/schema.ts`)

| Table | Purpose |
|---|---|
| users | Local accounts, bcrypt hash, role `user` or `it_officer`, forced password change |
| sessions | Hashed session id, per-session CSRF token, expiry |
| audit_log | Append-only (triggers block UPDATE/DELETE), SHA-256 hash chain |
| ingest_jobs | Background job state, progress, cancel flag, quality report JSON |
| reviews | One row per review. Text is **redacted only**. Holds NLP and score outputs. Indexed on filter columns, date, product and sentiment |
| review_themes | Theme → Five Vector tags per review, with source `rule`, `AI` or `human` |
| products, product_aliases | Product mapping: canonical products and their raw-name and code variants |
| pii_vault | AES-256-GCM ciphertext, IV and auth tag per redaction token |
| tag_feedback, redaction_flags | "Is this tag wrong?" and missed-PII reports |
| alerts | Agent proposals with evidence; Approve or Dismiss |
| saved_views | Named filter sets per user and persona |
| settings | Key/value (AI provider settings, assumptions such as minutes per record) |

## API list

| Route | Method | Who | Phase |
|---|---|---|---|
| /api/auth/login | POST | public (Origin check, rate limited) | 0 ✓ |
| /api/auth/logout, /api/auth/change-password | POST | signed in + CSRF | 0 ✓ |
| /api/auth/me | GET | signed in | 0 ✓ |
| /api/health | GET | public status; details for IT officers | 0 ✓ |
| /api/ingest (upload), /api/ingest/:id, /api/ingest/:id/cancel | POST/GET/POST | user | 1 |
| /api/reviews, /api/aggregates/*, /api/products/* (merge, split) | GET/POST | user | 2–3 |
| /api/feedback/tag, /api/feedback/redaction | POST | user | 3 |
| /api/export, /api/views | POST/GET | user | 3 |
| /api/ask, /api/alerts, /api/alerts/:id/decision | POST/GET/POST | user | 4 |
| /api/audit (own entries; all for IT), /api/audit/verify | GET | user / it_officer | 5 |
| /api/admin/users, /pii/reveal, /pii/restore, /purge, /settings, /ai/test | various | it_officer | 5 |

Every protected route calls `guard(req, { roles })` from `lib/auth/guard.ts`. It checks the session, role and pending password change, and on mutations the CSRF header and Origin.
