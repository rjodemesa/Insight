/**
 * SQLite schema, applied in order by lib/db.ts using PRAGMA user_version.
 * To change the schema, append a new migration. Never edit one that has shipped.
 */
export const MIGRATIONS: string[] = [
  /* v1 — Phase 0 baseline */ `
  CREATE TABLE users (
    id                   INTEGER PRIMARY KEY,
    email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name         TEXT,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK (role IN ('user','it_officer')),
    must_change_password INTEGER NOT NULL DEFAULT 1,
    disabled             INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Session id is stored hashed; the cookie carries the raw id plus an HMAC.
  CREATE TABLE sessions (
    id_hash     TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at  TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  -- Append-only and hash-chained. Triggers block UPDATE and DELETE.
  CREATE TABLE audit_log (
    id           INTEGER PRIMARY KEY,
    ts           TEXT NOT NULL,
    user_id      INTEGER,
    role         TEXT,
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    details      TEXT,
    ip           TEXT,
    user_agent   TEXT,
    ai_provider  TEXT,
    ai_model     TEXT,
    ai_version   TEXT,
    prompt_hash  TEXT,
    status       TEXT NOT NULL DEFAULT 'ok',
    prev_hash    TEXT NOT NULL,
    hash         TEXT NOT NULL UNIQUE
  );
  CREATE INDEX idx_audit_user ON audit_log(user_id, ts);
  CREATE INDEX idx_audit_action ON audit_log(action, ts);
  CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

  CREATE TABLE ingest_jobs (
    id               INTEGER PRIMARY KEY,
    filename         TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
    total_rows       INTEGER,
    processed_rows   INTEGER NOT NULL DEFAULT 0,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    error            TEXT,
    quality_report   TEXT,
    started_by       INTEGER REFERENCES users(id),
    started_at       TEXT,
    finished_at      TEXT
  );

  CREATE TABLE products (
    id             INTEGER PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    brand          TEXT,
    category       TEXT,
    subcategory    TEXT,
    size_token     TEXT,
    confidence     REAL,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_products_brand ON products(brand, category, subcategory);

  CREATE TABLE product_aliases (
    id                    INTEGER PRIMARY KEY,
    product_id            INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    normalized_name       TEXT NOT NULL,
    retailer_product_code TEXT,
    upc                   TEXT,
    similarity            REAL
  );
  CREATE INDEX idx_alias_product ON product_aliases(product_id);
  CREATE INDEX idx_alias_name ON product_aliases(normalized_name);

  -- One row per source review. Text columns hold REDACTED text only.
  CREATE TABLE reviews (
    id                     INTEGER PRIMARY KEY,
    ingest_id              INTEGER NOT NULL REFERENCES ingest_jobs(id) ON DELETE CASCADE,
    product_id             INTEGER REFERENCES products(id),
    retailer_name          TEXT, market TEXT, site TEXT,
    product_name           TEXT, category TEXT, subcategory TEXT, brand TEXT,
    retailer_product_code  TEXT, upc TEXT, manufacturer TEXT,
    product_url            TEXT, product_rating REAL, number_of_reviews INTEGER,
    internal_review_id     TEXT, retailer_review_id TEXT,
    review_date_iso        TEXT, review_rating REAL,
    review_title           TEXT, review_text TEXT,
    parent_or_child        TEXT, review_url TEXT, review_type TEXT,
    verified_purchase      INTEGER, helpful_review_count INTEGER,
    customer_image_count   INTEGER NOT NULL DEFAULT 0,
    is_duplicate           INTEGER NOT NULL DEFAULT 0,
    language               TEXT, sentiment TEXT, sentiment_score REAL, confidence REAL,
    tag_source             TEXT, rating_text_conflict INTEGER, trust_weight REAL
  );
  CREATE INDEX idx_reviews_filters ON reviews(retailer_name, category, subcategory, brand);
  CREATE INDEX idx_reviews_date ON reviews(review_date_iso);
  CREATE INDEX idx_reviews_product ON reviews(product_id, review_date_iso);
  CREATE INDEX idx_reviews_sentiment ON reviews(sentiment, review_date_iso);
  CREATE INDEX idx_reviews_retailer_id ON reviews(retailer_review_id);

  CREATE TABLE review_themes (
    review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    theme      TEXT NOT NULL,
    vector     TEXT NOT NULL CHECK (vector IN ('Product','Packaging','Communication','Retail Execution','Value')),
    confidence REAL,
    source     TEXT NOT NULL DEFAULT 'rule' CHECK (source IN ('rule','AI','human')),
    PRIMARY KEY (review_id, theme)
  );
  CREATE INDEX idx_themes_theme ON review_themes(theme);
  CREATE INDEX idx_themes_vector ON review_themes(vector);

  -- AES-256-GCM encrypted originals. Reveal is IT-officer-only and audited.
  CREATE TABLE pii_vault (
    id         INTEGER PRIMARY KEY,
    review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    field      TEXT NOT NULL,
    token      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    ciphertext BLOB NOT NULL,
    iv         BLOB NOT NULL,
    auth_tag   BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_vault_review ON pii_vault(review_id);

  CREATE TABLE tag_feedback (
    id              INTEGER PRIMARY KEY,
    review_id       INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    theme           TEXT,
    suggested_theme TEXT,
    comment         TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE redaction_flags (
    id         INTEGER PRIMARY KEY,
    review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE alerts (
    id          INTEGER PRIMARY KEY,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    title       TEXT NOT NULL,
    description TEXT,
    severity    TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
    evidence    TEXT,
    status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','dismissed')),
    decided_by  INTEGER REFERENCES users(id),
    decided_at  TEXT
  );
  CREATE INDEX idx_alerts_status ON alerts(status, created_at);

  CREATE TABLE saved_views (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona    TEXT,
    name       TEXT NOT NULL,
    filters    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  /* v2 — Phase 1 ingestion */ `
  ALTER TABLE ingest_jobs ADD COLUMN source_kind TEXT;
  ALTER TABLE ingest_jobs ADD COLUMN stored_path TEXT;
  ALTER TABLE ingest_jobs ADD COLUMN file_bytes INTEGER;
  ALTER TABLE ingest_jobs ADD COLUMN progress REAL NOT NULL DEFAULT 0;
  ALTER TABLE ingest_jobs ADD COLUMN stage TEXT;
  CREATE INDEX idx_ingest_status ON ingest_jobs(status, id);
  ALTER TABLE reviews ADD COLUMN redaction_count INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX idx_reviews_ingest ON reviews(ingest_id);
  CREATE INDEX idx_reviews_language ON reviews(language);
  `,
  /* v3 — Phase 2 NLP, mapping and scoring */ `
  ALTER TABLE review_themes ADD COLUMN sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative'));
  ALTER TABLE reviews ADD COLUMN nlp_version TEXT;
  CREATE INDEX idx_themes_vector_sentiment ON review_themes(vector, sentiment);
  CREATE INDEX idx_alias_code ON product_aliases(retailer_product_code);
  CREATE INDEX idx_alias_upc ON product_aliases(upc);
  `,
  /* v4 — Phase 4 AI second opinion and agent alerts */ `
  ALTER TABLE reviews ADD COLUMN ai_sentiment TEXT CHECK (ai_sentiment IN ('positive','neutral','negative'));
  ALTER TABLE reviews ADD COLUMN ai_version TEXT;
  CREATE INDEX idx_reviews_ai_version ON reviews(ai_version);
  ALTER TABLE alerts ADD COLUMN kind TEXT;
  ALTER TABLE alerts ADD COLUMN dedupe_key TEXT;
  ALTER TABLE alerts ADD COLUMN recommendation TEXT;
  ALTER TABLE alerts ADD COLUMN drill TEXT;
  ALTER TABLE alerts ADD COLUMN written_by TEXT;
  ALTER TABLE alerts ADD COLUMN decision_note TEXT;
  CREATE INDEX idx_alerts_key ON alerts(dedupe_key);
  `,
  /* v5 — human verification of uncertain reviews */ `
  ALTER TABLE reviews ADD COLUMN human_sentiment TEXT CHECK (human_sentiment IN ('positive','neutral','negative'));
  ALTER TABLE reviews ADD COLUMN unclear INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE reviews ADD COLUMN verified_by INTEGER REFERENCES users(id);
  ALTER TABLE reviews ADD COLUMN verified_at TEXT;
  CREATE INDEX idx_reviews_confidence ON reviews(confidence);
  CREATE INDEX idx_reviews_verified ON reviews(verified_at);
  `,
];
