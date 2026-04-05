-- ============================================================
-- CoverageAtlas — Full PostgreSQL Schema
-- Doc ref: 05-data-model.md
-- Run: psql $DATABASE_URL -f schema.sql
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ────────────────────────────────────────────────────────────
-- 1. PAYERS
--    Insurance companies / government programs
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payers (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL UNIQUE,
    payer_type TEXT        NOT NULL DEFAULT 'commercial'
                           CHECK (payer_type IN ('commercial','medicare','medicaid','other')),
    region     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 2. PLANS
--    Specific plan products offered by a payer
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id  UUID NOT NULL REFERENCES payers(id) ON DELETE CASCADE,
    plan_name TEXT NOT NULL,
    plan_type TEXT,                      -- HMO, PPO, EPO, POS, etc.
    market    TEXT                       -- individual, group, MA, Medicaid
);

CREATE INDEX IF NOT EXISTS idx_plans_payer ON plans(payer_id);

-- ────────────────────────────────────────────────────────────
-- 3. DOCUMENTS
--    Raw source files (PDF, HTML, DOCX) before parsing
--    Created BEFORE policy_versions so policy_versions can FK to it
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name        TEXT        NOT NULL,
    file_type        TEXT        NOT NULL CHECK (file_type IN ('pdf','html','docx','other')),
    sha256           TEXT        UNIQUE,   -- dedup: same file = same hash
    storage_path     TEXT,                 -- local path or GCS/S3 URI
    source_url       TEXT,                 -- where it was scraped from
    payer_id         UUID        REFERENCES payers(id),
    ingestion_status TEXT        NOT NULL DEFAULT 'queued'
                                 CHECK (ingestion_status IN ('queued','processing','completed','failed')),
    ingestion_error  TEXT,                 -- human-readable error if failed
    ingested_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_status  ON documents(ingestion_status);
CREATE INDEX IF NOT EXISTS idx_documents_sha256  ON documents(sha256);
CREATE INDEX IF NOT EXISTS idx_documents_payer   ON documents(payer_id);

-- ────────────────────────────────────────────────────────────
-- 4. POLICIES
--    A logical policy (e.g. "UHC Ozempic Medical Benefit Policy")
--    Independent of version — versions hang off this
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policies (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id        UUID        NOT NULL REFERENCES payers(id) ON DELETE CASCADE,
    policy_title    TEXT        NOT NULL,
    policy_code     TEXT,                  -- payer's internal code if present
    policy_category TEXT        NOT NULL DEFAULT 'medical_benefit'
                                CHECK (policy_category IN
                                  ('medical_benefit','pharmacy_benefit','general_um')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_payer    ON policies(payer_id);
CREATE INDEX IF NOT EXISTS idx_policies_category ON policies(policy_category);

-- ────────────────────────────────────────────────────────────
-- 5. POLICY VERSIONS
--    Each time a policy document is updated, a new version row is added.
--    Old versions are NEVER deleted (audit trail requirement).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_versions (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id      UUID        NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    document_id    UUID        REFERENCES documents(id),
    version_label  TEXT        NOT NULL,   -- e.g. "v2026-Q1", "v2026-04-01"
    effective_date DATE,
    published_date DATE,
    source_url     TEXT,
    is_current     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce only ONE current version per policy
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_versions_current
    ON policy_versions(policy_id)
    WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_pv_policy     ON policy_versions(policy_id);
CREATE INDEX IF NOT EXISTS idx_pv_document   ON policy_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_pv_effective  ON policy_versions(effective_date);

-- ────────────────────────────────────────────────────────────
-- 6. POLICY CHUNKS
--    Text segments from a policy version, used for RAG retrieval.
--    embedding_id references the Qdrant point ID for this chunk.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_chunks (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_version_id UUID        NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
    chunk_index       INTEGER     NOT NULL,
    section_title     TEXT,
    page_number       INTEGER,
    text              TEXT        NOT NULL,
    embedding_id      TEXT,       -- Qdrant point UUID
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_version    ON policy_chunks(policy_version_id);
CREATE INDEX IF NOT EXISTS idx_chunks_section    ON policy_chunks(section_title);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding  ON policy_chunks(embedding_id);

-- ────────────────────────────────────────────────────────────
-- 7. COVERAGE RULES
--    Structured, normalized rules extracted by the Extraction Agent.
--    One row per drug/treatment per policy version.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coverage_rules (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_version_id     UUID        NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
    drug_name             TEXT        NOT NULL,
    drug_aliases          JSONB       NOT NULL DEFAULT '[]',   -- ["brand", "generic", "J-code"]
    indication            TEXT,                                -- condition this applies to
    coverage_status       TEXT        NOT NULL DEFAULT 'unknown'
                                      CHECK (coverage_status IN
                                        ('covered','restricted','not_covered','unknown')),
    prior_auth_required   BOOLEAN,    -- null = unknown
    step_therapy_required BOOLEAN,    -- null = unknown
    quantity_limit_text   TEXT,
    site_of_care_text     TEXT,
    criteria_summary      JSONB       NOT NULL DEFAULT '[]',   -- plain-language bullet list
    raw_evidence_ref      JSONB       NOT NULL DEFAULT '[]',   -- citation pointers
    extraction_confidence FLOAT       CHECK (extraction_confidence BETWEEN 0 AND 1),
    needs_review          BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cr_version    ON coverage_rules(policy_version_id);
CREATE INDEX IF NOT EXISTS idx_cr_drug       ON coverage_rules(drug_name);
CREATE INDEX IF NOT EXISTS idx_cr_status     ON coverage_rules(coverage_status);
CREATE INDEX IF NOT EXISTS idx_cr_pa         ON coverage_rules(prior_auth_required);
CREATE INDEX IF NOT EXISTS idx_cr_review     ON coverage_rules(needs_review) WHERE needs_review = TRUE;
-- Full-text search on drug name + indication
CREATE INDEX IF NOT EXISTS idx_cr_fts ON coverage_rules
    USING GIN (to_tsvector('english', drug_name || ' ' || COALESCE(indication, '')));

-- ────────────────────────────────────────────────────────────
-- 8. POLICY CHANGES
--    Diff records written by the Diff Agent when a new policy
--    version is ingested. Never deleted.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_changes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id       UUID        NOT NULL REFERENCES policies(id),
    from_version_id UUID        REFERENCES policy_versions(id),
    to_version_id   UUID        NOT NULL REFERENCES policy_versions(id),
    change_type     TEXT        NOT NULL
                                CHECK (change_type IN ('added','removed','modified')),
    field_name      TEXT        NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    citations       JSONB       NOT NULL DEFAULT '[]',
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_changes_policy    ON policy_changes(policy_id);
CREATE INDEX IF NOT EXISTS idx_changes_to_ver    ON policy_changes(to_version_id);
CREATE INDEX IF NOT EXISTS idx_changes_type      ON policy_changes(change_type);
CREATE INDEX IF NOT EXISTS idx_changes_detected  ON policy_changes(detected_at);

-- ────────────────────────────────────────────────────────────
-- 9. QA SESSIONS + QA MESSAGES
--    Tracks every user conversation (web or voice).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qa_sessions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT,                   -- Auth0 sub or anonymous id
    channel    TEXT        NOT NULL DEFAULT 'web'
               CHECK (channel IN ('web','voice')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at   TIMESTAMPTZ,
    summary    TEXT                    -- post-call/session summary
);

CREATE INDEX IF NOT EXISTS idx_qa_sessions_user    ON qa_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_qa_sessions_channel ON qa_sessions(channel);
CREATE INDEX IF NOT EXISTS idx_qa_sessions_started ON qa_sessions(started_at);

CREATE TABLE IF NOT EXISTS qa_messages (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID        NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
    role         TEXT        NOT NULL CHECK (role IN ('user','assistant')),
    message_text TEXT        NOT NULL,
    confidence   FLOAT       CHECK (confidence BETWEEN 0 AND 1),
    citations    JSONB       NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_messages_session ON qa_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_qa_messages_role    ON qa_messages(role);

-- ============================================================
-- 10. USER PROFILES
--    Per-user profile and preferences (keyed by Auth0 sub)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id                TEXT        PRIMARY KEY, -- Auth0 sub
    full_name              TEXT,
    email                  TEXT,
    phone                  TEXT,
    date_of_birth          DATE,
    state                  TEXT,
    member_id              TEXT,
    preferred_language     TEXT,
    preferred_channel      TEXT        CHECK (preferred_channel IN ('web','voice','email')),
    primary_plan_id        TEXT,
    chronic_conditions     JSONB       NOT NULL DEFAULT '[]',
    medications            JSONB       NOT NULL DEFAULT '[]',
    notes                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_plan  ON user_profiles(primary_plan_id);

-- ────────────────────────────────────────────────────────────
-- SEED: Known major payers (safe to re-run, ON CONFLICT skips)
-- ────────────────────────────────────────────────────────────
INSERT INTO payers (name, payer_type, region) VALUES
    ('UnitedHealthcare',       'commercial', 'National'),
    ('Aetna',                  'commercial', 'National'),
    ('Cigna',                  'commercial', 'National'),
    ('Humana',                 'commercial', 'National'),
    ('BCBS Massachusetts',     'commercial', 'Northeast'),
    ('CareFirst BCBS',         'commercial', 'Mid-Atlantic'),
    ('Excellus BCBS',          'commercial', 'Northeast'),
    ('BCBS Michigan',          'commercial', 'Midwest'),
    ('BCBS Texas',             'commercial', 'South'),
    ('Horizon BCBS NJ',        'commercial', 'Northeast'),
    ('Medicare',               'medicare',   'National'),
    ('Medicaid',               'medicaid',   'National')
ON CONFLICT (name) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- HELPER VIEWS
-- ────────────────────────────────────────────────────────────

-- Current coverage rules with payer context (most used in Q&A)
CREATE OR REPLACE VIEW v_current_coverage_rules AS
SELECT
    cr.*,
    p.name          AS payer_name,
    p.payer_type,
    pol.policy_title,
    pol.policy_category,
    pv.version_label,
    pv.effective_date,
    pv.source_url
FROM coverage_rules cr
JOIN policy_versions pv  ON cr.policy_version_id = pv.id
JOIN policies pol         ON pv.policy_id = pol.id
JOIN payers p             ON pol.payer_id = p.id
WHERE pv.is_current = TRUE;

-- Recent policy changes with human-readable context
CREATE OR REPLACE VIEW v_recent_changes AS
SELECT
    pc.*,
    p.name          AS payer_name,
    pol.policy_title,
    pv_from.version_label AS from_version,
    pv_to.version_label   AS to_version
FROM policy_changes pc
JOIN policies pol              ON pc.policy_id = pol.id
JOIN payers p                  ON pol.payer_id = p.id
LEFT JOIN policy_versions pv_from ON pc.from_version_id = pv_from.id
JOIN policy_versions pv_to        ON pc.to_version_id   = pv_to.id
ORDER BY pc.detected_at DESC;

-- Document ingestion health
CREATE OR REPLACE VIEW v_ingestion_health AS
SELECT
    p.name              AS payer_name,
    d.ingestion_status,
    COUNT(*)            AS doc_count,
    MIN(d.created_at)   AS oldest,
    MAX(d.created_at)   AS newest
FROM documents d
LEFT JOIN payers p ON d.payer_id = p.id
GROUP BY p.name, d.ingestion_status
ORDER BY p.name, d.ingestion_status;
