# CoverageAtlas Project Context (LLM Handoff)

Last updated: 2026-04-05 (America/Phoenix)
Current branch: `parva_dev`
Workspace root: `d:\projects\github_projects\innovation_hacks`

## 1) Project in One Minute

CoverageAtlas is a policy intelligence platform for US medical-benefit coverage.

Goal:
- Ingest payer policy documents (PDF/HTML),
- Extract structured coverage rules,
- Store searchable evidence in Postgres + Qdrant,
- Answer user questions with citations (chat + voice),
- Compare plans and show policy changes over time.

Core user outcomes:
- "Is drug X covered by my plan?"
- "What prior authorization (pre-approval) is required?"
- "How does plan A compare to plan B?"
- "What changed between policy versions?"

## 2) Actual Current Stack (Code Reality)

Backend:
- FastAPI (`backend/app/main.py`)
- Postgres via `psycopg2` (`db.py`, `schema.sql`)
- Qdrant vector DB (`qdrant_setup.py`)
- Gemini/Vertex through shared wrapper (`ai_provider.py`)

AI:
- Embeddings: `gemini-embedding-001` (768 dims by default)
- QA generation: `gemini-2.5-flash` (configurable)
- Extraction model: configurable (`EXTRACT_MODEL`, often Gemini Flash variants)

Voice:
- LiveKit worker (`backend/livekit/agent.py`)
- LiveKit tooling for room/token/SIP (`backend/livekit/playground_tools.py`)
- Optional Twilio SIP inbound routing setup via tooling

Frontend:
- Vite + React + TypeScript (`frontend/`)
- Auth0 React SDK integration (optional by env)
- Pages for Ask, AI assistant chat, Compare, Voice session UI, Access Lab, Timeline, Profile

Infra:
- Docker Compose for Postgres/Qdrant/Redis/backend/frontend
- Also supports local non-docker runs

## 3) Repo Map (What Matters Most)

Core backend and API:
- `backend/app/main.py` - API routes and query/compare/voice session APIs
- `backend/app/source_refresh.py` - source discovery + change detection helper flow
- `backend/app/auth.py` - Auth0 token validation/dependencies
- `backend/app/langgraph_chatbot.py` - advanced graph chatbot module (present, not wired to `/query` yet)

Voice:
- `backend/livekit/agent.py` - LiveKit real-time policy voice agent with function tools
- `backend/livekit/agent_prompt.py` - system prompt/instructions
- `backend/livekit/playground_tools.py` - create token, manage room, setup inbound SIP rule

Ingestion/discovery:
- `insurance_scraper.py` - large-source crawl/discovery/download + extraction trigger
- `extraction_agent.py` - parse docs, extract rules, write DB, upsert vectors
- `qdrant_setup.py` - collection init/search/upsert/compat handling

Data layer:
- `db.py` - all DB helper functions
- `schema.sql` - full relational schema

Frontend:
- `frontend/src/App.tsx` - route map
- `frontend/src/api/client.ts` - API client methods
- `frontend/src/components/patient/*` - page components (ask, assistant chat, compare, voice, etc.)
- `frontend/src/auth/*` - Auth0 config/provider/token bridge

Docs:
- `docs/` contains planning docs and status reports (some are stale vs current implementation)
- `AGENT_CONTEXT.md` exists but is outdated; use this file (`PROJECT_CONTEXT.md`) as primary handoff.

## 4) Backend API Surface (Current)

From `backend/app/main.py`:

- `GET /api/v1/health`
- `GET /api/v1/auth/me`
- `GET /api/v1/profile/me`
- `PUT /api/v1/profile/me`
- `GET /api/v1/metadata/plans`
- `GET /api/v1/metadata/policies`
- `POST /api/v1/documents/upload` (admin)
- `GET /api/v1/documents/{document_id}/status`
- `POST /api/v1/query`
- `POST /api/v1/compare`
- `GET /api/v1/policies/{policy_id}/changes`
- `GET /api/v1/policies/changes/recent`
- `POST /api/v1/sources/scan` (admin)
- `GET /api/v1/sources/scan/{scan_id}` (admin)
- `GET /api/v1/sources/registry`
- `POST /api/v1/sources/registry/upsert` (admin)
- `POST /api/v1/sources/refresh` (admin)
- `GET /api/v1/sources/refresh/{run_id}`
- `POST /api/v1/voice/session/start`
- `POST /api/v1/voice/session/{session_id}/turn`
- `POST /api/v1/voice/session/{session_id}/end`

## 5) AI/RAG State (Important)

### 5.1 What `/query` uses right now

Live path in `main.py`:
1. Resolve retrieval scope from filters (payer/plan/category/version/effective date),
2. Embed query via `ai_provider.embed_query(...)`,
3. Search Qdrant (`qdrant_setup.search(...)`) with metadata filters,
4. Build citations from policy version -> document mapping,
5. Generate grounded answer from evidence chunks using Gemini,
6. Return answer + confidence + citations + retrieval trace + disclaimer.

### 5.2 What exists but is not live yet

`backend/app/langgraph_chatbot.py` implements a stronger multi-step flow:
- intent routing,
- retrieval,
- answer generation,
- verifier/fact-check stage,
- reasoning/evidence cards/customer-help outputs.

But this module is not wired into `/api/v1/query` in `main.py` yet.

Practical implication:
- Frontend expects optional `reasoning/evidence_cards/customer_help`,
- Current `/query` response often does not populate those fields.

## 6) Ingestion + Discovery State

### 6.1 `extraction_agent.py` pipeline

For each document:
1. Extract text (PDF/HTML),
2. Section/chunk split,
3. Gemini extraction prompt -> structured rule objects,
4. Validate + normalize fields,
5. Confidence score rules,
6. Write rules/chunks/versions to Postgres,
7. Embed and upsert chunks to Qdrant.

### 6.2 `insurance_scraper.py` behavior

- Discovers policies from payer endpoints (UHC, Aetna, Cigna, Humana, BCBS set in code),
- Uses local SQLite registry at `insurance_policies/registry.db` for seen URL/file tracking,
- Has category filtering and interleaving logic,
- Supports skipping already indexed vectors via flags.

### 6.3 Source registry refresh (`source_refresh.py`)

Implemented:
- adapter-driven source discovery (`html_index_links`, `mock_static`),
- optional lightweight fetch/hash-change detection,
- run/item/state persistence in Postgres source tracking tables.

Limitations:
- intentionally small-scale and conservative limits,
- not a full distributed ingestion orchestrator.

## 7) Voice System State

Two different voice-related paths exist:

1) REST "voice session" path used by current frontend page:
- `/voice/session/start|turn|end`
- Stores transcript in `qa_sessions` + `qa_messages`
- UI is text-chat style, not real telephony audio transport

2) LiveKit real-time voice agent:
- `backend/livekit/agent.py`
- Tool calls for:
  - user context,
  - policy query,
  - compare drug across plans,
  - policy changes
- Supports room metadata context (signed-in vs not, known plan/drug fields)
- Can be dispatched via room token or SIP dispatch rule
- `playground_tools.py` includes Twilio inbound SIP setup helper

## 8) Frontend State

Route map (`frontend/src/App.tsx`):
- `/ask` - standard policy Q&A
- `/assistant` - Atlas AI assistant chat page + Twilio call CTA
- `/access-lab` - simulation modules (currently frontend-only logic)
- `/compare` - plan comparison UI (hits backend `/compare`)
- `/voice` - session-based voice assistant UI via REST endpoints
- `/changes` - policy timeline + version diff viewer
- `/profile` - per-user profile/preferences

Key frontend strengths currently:
- polished UX and multiple user-facing workflows,
- handles plan metadata, query, compare, recent changes,
- optional Auth0 sign-in integration.

Current caveat:
- some advanced AI reasoning panels depend on fields not always returned by current `/query` implementation.

## 9) Data Model Summary (Postgres)

Primary business tables from `schema.sql`:
- `payers`
- `plans`
- `documents`
- `policies`
- `policy_versions`
- `policy_chunks`
- `coverage_rules`
- `policy_changes`
- `qa_sessions`
- `qa_messages`
- `user_profiles` (managed via helper migration logic in `db.py`)
- source tracking tables:
  - `source_registry`
  - `source_refresh_runs`
  - `source_refresh_items`
  - `source_document_state`

Design principle:
- policy versions are append-only history,
- current version determined by `is_current`,
- citations and evidence tracked for explainability.

## 10) Auth State

Backend:
- Auth can be toggled by `AUTH0_ENABLED` or inferred from `AUTH0_DOMAIN` + `AUTH0_AUDIENCE`.
- `require_auth0_token` and `require_admin_auth` dependencies are in use.

Frontend:
- Auth0 enabled when `VITE_AUTH0_ENABLED` true (or core config auto-detected),
- token bridge attaches bearer tokens to API calls,
- protected route wrapper redirects to login when enabled.

Known issue:
- In `backend/app/auth.py`, `verify_auth0_token` calls `_load_jwt()` but defined helper is `_load_jose()`. This is a bug if strict Auth0 validation path is exercised.

## 11) Environment Variables (Most Important)

Model and provider:
- `AI_USE_VERTEX`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` (non-Vertex mode)
- `EMBEDDING_MODEL` (default `gemini-embedding-001`)
- `QA_MODEL` (default `gemini-2.5-flash`)
- `EXTRACT_MODEL`

Data:
- `DATABASE_URL`
- `QDRANT_URL`
- `QDRANT_COLLECTION`
- `REDIS_URL`

LiveKit/voice:
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `AGENT_NAME`
- `GOOGLE_REALTIME_MODEL`
- `GOOGLE_REALTIME_VOICE`
- `GOOGLE_REALTIME_VERTEXAI`
- `COVERAGE_API_BASE_URL`
- `ELEVENLABS_API_KEY` (optional)

Auth0:
- `AUTH0_ENABLED`
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_CLIENT_ID`
- `AUTH0_SCOPE`
- plus `VITE_AUTH0_*` frontend counterparts

Use `.env.example` as reference baseline.

## 12) Operational Snapshot (Observed Now)

As of this update:
- Qdrant reachable at configured URL,
- collection `policy_chunks` exists,
- Qdrant `points_count` observed: `6929`.

Local Postgres was not reachable with current `DATABASE_URL` during this check (connection refused on configured localhost port), so live DB counts could not be verified in this session.

Observed running processes included:
- duplicate `uvicorn backend.app.main:app` processes,
- duplicate `insurance_scraper.py --category drug --skip-existing-vectors --delay 0` processes.

Implication:
- likely duplicate workers/runs are active; operational hygiene cleanup is recommended before next full ingestion run.

## 13) What Is Implemented vs Missing (Decision-Critical)

Implemented:
- full API skeleton with query/compare/changes/voice/source endpoints,
- ingestion pipeline to Postgres + Qdrant,
- LiveKit agent with functional tools,
- frontend pages for all core demo flows,
- source registry refresh storage model.

Partially implemented / not yet wired:
- LangGraph advanced chatbot not connected to production `/query`,
- frontend advanced reasoning panels depend on optional fields not always returned,
- two separate voice architectures coexist (REST session vs LiveKit realtime) without full unification.

Not production-hardened:
- auth bug in backend token verification helper naming,
- duplicate process management issues,
- uneven env/docs consistency (older docs still mention Next.js in places).

## 14) Fast Start Commands

Local backend:
```powershell
.venv\Scripts\python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Frontend:
```powershell
cd frontend
npm install
npm run dev
```

LiveKit agent:
```powershell
.venv\Scripts\python backend/livekit/agent.py dev
```

Generate token for LiveKit playground:
```powershell
.venv\Scripts\python backend/livekit/playground_tools.py create-token --room policy-playground-room --name "Playground User"
```

Setup Twilio inbound dispatch (LiveKit side):
```powershell
.venv\Scripts\python backend/livekit/playground_tools.py setup-twilio-inbound --phone-number +16026100653 --room policy-playground-room --agent-name Policy_Agent
```

Run source refresh (small-scale via API or direct pipeline tools) after validating DB connectivity.

## 15) High-Impact Next Steps

1. Wire `LangGraphPolicyChatbot` into `/api/v1/query` (or align frontend to current simple response contract).
2. Fix backend auth helper bug (`_load_jose` vs `_load_jwt`) before enforcing Auth0 in production mode.
3. Normalize to one voice path for demo narrative:
   - either REST voice UI only, or
   - full LiveKit/Twilio end-to-end.
4. Ensure only one scraper and one API process run at a time; add pid/lock checks.
5. Revalidate Postgres connectivity and run health checks for DB+Qdrant+query before demo.

## 16) LLM Handoff Prompt Starter

Use this when handing to another model:

"You are continuing work on CoverageAtlas in `d:\\projects\\github_projects\\innovation_hacks` on branch `parva_dev`. Read `PROJECT_CONTEXT.md` first, then verify current backend/frontend behavior against code. Prioritize wiring advanced LangGraph responses into `/api/v1/query`, fixing auth helper bug in `backend/app/auth.py`, and aligning assistant reasoning panels with actual backend response fields. Keep LiveKit voice agent behavior unchanged unless explicitly requested."
