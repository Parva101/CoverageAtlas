# CoverageAtlas — Project Context for Claude Code Agent

## What This Project Is

CoverageAtlas (internal name: PayerLens) is a medical insurance policy intelligence
platform built for a hackathon. It answers questions like:
- "Does UHC cover Ozempic for diabetes?"
- "What prior auth does Aetna require for Humira?"
- "How do UHC and Cigna differ on bariatric surgery coverage?"
- "What changed in UHC's GLP-1 policy this quarter?"

The product is spec-driven. All decisions come from the docs/ folder in
CoverageAtlas-main.zip. The spec files that matter most:
  - 04-architecture.md  → system design and locked stack
  - 05-data-model.md    → exact table schemas
  - 06-api-contract.md  → exact API endpoints to build
  - 07-ai-agents.md     → 6 AI agents and their responsibilities
  - 08-implementation-plan.md → build order and hours breakdown

---

## Locked Tech Stack (Do Not Change)

| Layer          | Technology                          |
|----------------|-------------------------------------|
| Backend API    | Python + FastAPI                    |
| Async tasks    | Celery + Redis                      |
| Relational DB  | PostgreSQL                          |
| Vector DB      | Qdrant (NOT ChromaDB, NOT Pinecone) |
| AI model       | Google Gemini 1.5 Pro (generation)  |
| Embeddings     | Google text-embedding-004 (768-dim) |
| Frontend       | Next.js + TypeScript                |
| Auth           | Auth0 (JWT)                         |
| Voice          | ElevenLabs (STT + TTS)              |
| Infrastructure | Docker Compose                      |

---

## Files Already Built

### insurance_scraper.py
Daily sync agent. Crawls UHC, Aetna, Cigna, Humana, and 6 BCBS chapters.
Discovers all policy PDF and HTML links. Uses SQLite to track seen URLs —
only downloads NEW documents it hasn't seen before. Saves files into:
  insurance_policies/<PayerName>/<policy_type>/<filename>.pdf
Also writes run_history.json and logs each run.
Run: `python insurance_scraper.py`
Run daily: `python scheduler.py`

### scheduler.py
Wraps insurance_scraper.py. Checks every hour if 24h have passed since
the last sync run. If yes, triggers a full sync. Designed to run as a
background process or in Docker.

### extraction_agent.py
Extraction Agent (doc 07, Agent 1). Takes a downloaded PDF/HTML file,
extracts text page by page using pdfplumber, splits into heading-aware
sections, sends each section to Gemini 1.5 Pro with a structured extraction
prompt, and gets back normalized coverage_rules JSON.

Each extracted rule has these fields (matching schema exactly):
  drug_name, drug_aliases, indication, coverage_status,
  prior_auth_required, step_therapy_required, quantity_limit_text,
  site_of_care_text, criteria_summary, citations, extraction_confidence

After extraction it:
  - Validates required fields (rejects if drug_name missing)
  - Scores confidence (composite 0..1 across 7 factors)
  - Flags needs_review=true if confidence < 0.60
  - Writes to PostgreSQL coverage_rules table
  - Embeds chunks and upserts to Qdrant

Run single file:
  python extraction_agent.py --file policy.pdf --payer "UnitedHealthcare" --policy-title "Ozempic Policy"

Run all downloaded files:
  python extraction_agent.py --scan-dir insurance_policies/

Dry run (extract only, no DB write):
  python extraction_agent.py --file policy.pdf --payer "Aetna" --dry-run

### schema.sql
Complete PostgreSQL schema. All 9 tables from doc 05. Run once to initialize.
Command: psql $DATABASE_URL -f schema.sql

Tables (in dependency order):
  1. payers          — insurance companies (UHC, Aetna, Cigna, Humana, BCBS, etc.)
  2. plans           — specific plan products within a payer (HMO, PPO, etc.)
  3. documents       — raw source files (PDF/HTML) with ingestion_status tracking
  4. policies        — logical policy identity (e.g. "UHC Ozempic Policy")
  5. policy_versions — each version of a policy; is_current=TRUE for latest
  6. policy_chunks   — text segments per version, with Qdrant embedding_id FK
  7. coverage_rules  — structured extracted rules per drug per version
  8. policy_changes  — diff records between versions (added/removed/modified)
  9. qa_sessions     — conversation sessions (web or voice channel)
     qa_messages     — individual turns within a session

Also creates 3 helper views:
  v_current_coverage_rules — joins coverage_rules with payer/policy context
  v_recent_changes         — human-readable diff log
  v_ingestion_health       — doc count by payer and status

Seeds 12 known payers on first run.

Key schema rules from spec:
  - NEVER delete old policy_versions (audit trail)
  - coverage_status MUST be: covered | restricted | not_covered | unknown
  - Only one is_current=TRUE per policy (enforced by partial unique index)
  - needs_review=TRUE when extraction_confidence < 0.60

### db.py
Typed Python helper layer over PostgreSQL. Import this everywhere instead
of writing raw psycopg2 queries. Uses context manager pattern:

  from db import get_conn, upsert_payer, insert_coverage_rule, compare_drug_across_plans

  with get_conn() as conn:
      payer_id = upsert_payer(conn, "UnitedHealthcare", "commercial", "National")
      ...

Key functions:
  upsert_payer(conn, name, payer_type, region) -> payer_id
  insert_plan(conn, payer_id, plan_name, plan_type, market) -> plan_id
  insert_document(conn, file_name, file_type, sha256, ...) -> doc_id
  update_document_status(conn, doc_id, status, error)
  upsert_policy(conn, payer_id, policy_title, ...) -> policy_id
  create_policy_version(conn, policy_id, document_id, version_label, ...) -> version_id
  insert_chunk(conn, policy_version_id, chunk_index, section_title, ...) -> chunk_id
  insert_coverage_rule(conn, policy_version_id, rule_dict) -> rule_id
  get_coverage_rules_for_drug(conn, drug_name, payer_id=None) -> list
  insert_policy_change(conn, policy_id, from_ver, to_ver, change_type, field, old, new)
  compare_drug_across_plans(conn, drug_name, payer_ids=None) -> list
  create_qa_session(conn, user_id, channel) -> session_id
  append_qa_message(conn, session_id, role, text, confidence, citations) -> msg_id

### qdrant_setup.py
Qdrant collection manager. Handles init, search, upsert, and delete.
Collection name: policy_chunks (768-dim, cosine distance)

Key functions (import these in the query/ingestion pipeline):
  get_client() -> QdrantClient
  init_collection(client, reset=False)  — safe to re-run
  upsert_chunks(client, chunks, embeddings) -> list of point IDs
  search(client, query_vector, top_k=8, payer_filter=None, ...) -> list of result dicts
  delete_version_chunks(client, policy_version_id)

Search result dict shape:
  { score, relevance, text, payer_name, policy_title, version_label,
    effective_date, source_url, section_title, page_number,
    policy_version_id, chunk_index }

Qdrant payload indexes (for fast metadata filtering):
  payer_name, payer_type, policy_category, coverage_status,
  drug_name, version_label, effective_date, policy_version_id

CLI:
  python qdrant_setup.py --init        # create collection
  python qdrant_setup.py --status      # show vector count
  python qdrant_setup.py --test-embed  # smoke test

### policy_qa.py
Q&A Agent (doc 07, Agent 2). Answers user questions with grounded citations.

answer_question(question, payer_filter=None, top_k=8) -> dict
Returns: { answer, sources, question, retrieved_chunks, timestamp }

RAG rules from spec (non-negotiable):
  1. No answer without retriever evidence
  2. Every answer includes citations
  3. Weak evidence returns "insufficient evidence" not a guess
  4. Retrieval uses payer/version metadata filters when available

Also runs as FastAPI server:
  python policy_qa.py --serve
  POST /ask { question, payer_filter, top_k }
  GET  /stats
  GET  /health

### docker-compose.yml
Starts PostgreSQL (5432), Qdrant (6333), Redis (6379).
Command: docker compose up -d

### .env.example
All required environment variables. Copy to .env and fill in.
  GEMINI_API_KEY, DATABASE_URL, QDRANT_URL, QDRANT_COLLECTION,
  REDIS_URL, AUTH0_DOMAIN, AUTH0_CLIENT_ID, ELEVENLABS_API_KEY

---

## What Still Needs to Be Built

These are the remaining pieces in priority order for the hackathon demo:

### 1. FastAPI Backend (backend/app/main.py)
Build these endpoints exactly as defined in doc 06-api-contract.md:

  GET  /health
  POST /documents/upload         — multipart PDF upload, triggers Celery ingestion job
  GET  /documents/{id}/status    — returns queued/processing/completed/failed
  POST /query                    — Q&A with hybrid retrieval + citations
  POST /compare                  — side-by-side drug coverage across plans
  GET  /policies/{id}/changes    — diff between two versions
  POST /sources/scan             — manually trigger scraper
  POST /voice/session/start      — start voice call session
  POST /voice/session/{id}/turn  — append utterance, return answer
  POST /voice/session/{id}/end   — finalize transcript

The /query endpoint request body:
  { question, filters: { payer_ids, plan_ids, policy_categories, effective_on },
    retrieval: { top_k, hybrid } }

The /query response body:
  { answer, confidence, citations: [{document_id, page, section, snippet}],
    retrieval_trace: {chunks_used, vector_store}, disclaimer }

The /compare request body:
  { drug_name, plan_ids, effective_on }

The /compare response body:
  { drug_name, rows: [{plan_id, coverage_status, prior_auth_required,
    step_therapy_required, criteria_summary, citations}] }

For /compare, use db.compare_drug_across_plans() — already built.

### 2. Celery Task for Document Ingestion (backend/app/ingestion/tasks.py)
When a PDF is uploaded via /documents/upload:
  - Save file to disk, insert document row with status='queued'
  - Queue Celery task: process_document(document_id)
  - Task calls extraction_agent.process_document()
  - Updates status to processing → completed/failed
  - On completion: run diff agent against previous version

### 3. Diff Agent (backend/app/diff/engine.py)
When a new policy version is ingested, compare coverage_rules
against the previous version for the same policy. For each drug:
  - In new but not old → change_type='added'
  - In old but not new → change_type='removed'
  - In both but field changed → change_type='modified'
Write results to policy_changes table using db.insert_policy_change().
Fields to compare: coverage_status, prior_auth_required,
step_therapy_required, quantity_limit_text, site_of_care_text

### 4. Auth0 Middleware (backend/app/auth.py)
FastAPI dependency that validates Auth0 JWT on protected endpoints.
Public: /health, GET /query (read-only)
Protected: POST /documents/upload, POST /sources/scan

### 5. ElevenLabs Voice Layer (backend/app/voice/)
Flow: caller audio → ElevenLabs STT → text → POST /query → answer text → ElevenLabs TTS → audio
Use /voice/session/* endpoints to track conversation.
Post-call: save full transcript to qa_messages, generate summary.

### 6. Next.js Frontend (frontend/)
Four screens:
  - Dashboard/Search: text input → calls POST /query → shows answer + citation cards
  - Compare: drug name input + payer checkboxes → calls POST /compare → comparison table
  - Changes: policy selector → calls GET /policies/{id}/changes → diff timeline
  - Patient Mode: simplified UI, plain language answers

---

## Environment Setup (Run in This Order)

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Apply PostgreSQL schema
psql postgresql://postgres:postgres@localhost:5432/coverageatlas -f schema.sql

# 3. Initialize Qdrant collection
python qdrant_setup.py --init

# 4. Copy and fill in environment variables
cp .env.example .env
# Edit .env with your GEMINI_API_KEY, AUTH0_*, ELEVENLABS_API_KEY

# 5. Install Python dependencies
pip install -r requirements.txt

# 6. First scrape (downloads policy docs from all payers)
python insurance_scraper.py --payers uhc aetna cigna --limit 10

# 7. Extract and index (processes downloaded docs into DB + Qdrant)
python extraction_agent.py --scan-dir insurance_policies/ --init-schema

# 8. Test Q&A
python policy_qa.py --question "Does UHC cover Ozempic for diabetes?"

# 9. Start API server
uvicorn backend.app.main:app --reload --port 8000
```

---

## Repo Structure (Target)

```
CoverageAtlas/
├── backend/
│   └── app/
│       ├── main.py              ← FastAPI app, routers
│       ├── auth.py              ← Auth0 JWT middleware
│       ├── policy/              ← models, schemas, repositories
│       ├── ingestion/           ← parser, extractor, Celery tasks
│       ├── qa/                  ← retriever + answer service
│       ├── diff/                ← change detection engine
│       ├── voice/               ← ElevenLabs session handlers
│       └── source_monitor/      ← scraper integration
├── frontend/
│   └── app/
│       ├── dashboard/           ← search + Q&A UI
│       ├── compare/             ← plan comparison table
│       ├── changes/             ← policy diff timeline
│       └── patient/             ← plain-language mode
├── insurance_scraper.py         ← ✅ built
├── scheduler.py                 ← ✅ built
├── extraction_agent.py          ← ✅ built
├── schema.sql                   ← ✅ built
├── db.py                        ← ✅ built
├── qdrant_setup.py              ← ✅ built
├── policy_qa.py                 ← ✅ built
├── docker-compose.yml           ← ✅ built
├── requirements.txt             ← ✅ built
└── .env.example                 ← ✅ built
```

---

## Key Constraints the Agent Must Respect

1. Never answer without retriever evidence (RAG rule #1 from spec)
2. Every answer must include citations (document, page, section, snippet)
3. Never delete policy_versions rows — append only
4. coverage_status must always be one of: covered | restricted | not_covered | unknown
5. Only one policy_version can have is_current=TRUE per policy at any time
6. Low confidence extractions (< 0.60) must be flagged needs_review=TRUE
7. Voice responses must state informational scope disclaimer
8. No medical advice claims anywhere in the system
9. Qdrant is the ONLY vector store — do not introduce ChromaDB or Pinecone
10. db.py is the ONLY way to talk to PostgreSQL — no raw psycopg2 elsewhere
