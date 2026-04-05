# 13 - Feature Status Report (Implemented vs Remaining)

Date: 2026-04-04  
Scope reviewed: backend API, ingestion pipeline, DB/Qdrant, LiveKit voice agent, frontend app, infra/config

---

## 1) Executive Summary

Current platform state:
- Core backend APIs for upload, query, compare, policy diff, source scan, and voice session are implemented.
- Core data model (PostgreSQL schema + helper layer) is implemented and aligned to policy versioning + citations.
- Extraction pipeline (document to structured rules + Qdrant upsert) is implemented.
- LiveKit voice agent is implemented with function tools for policy query/compare/diff and signed-in context handling.
- Frontend has working user-facing pages for Ask, Compare, and Voice chat UI.

Main gap pattern:
- Several features exist in backend but are not fully wired end-to-end in frontend/ops.
- Some older modules use ChromaDB while current production path uses Qdrant, creating architecture drift.
- Reliability/testing/production hardening is still missing.

---

## 2) Implemented Features

### A. Core API Surface (FastAPI)
Implemented endpoints:
- `GET /api/v1/health`
- `POST /api/v1/documents/upload`
- `GET /api/v1/documents/{document_id}/status`
- `POST /api/v1/query`
- `POST /api/v1/compare`
- `GET /api/v1/policies/{policy_id}/changes`
- `POST /api/v1/sources/scan`
- `GET /api/v1/sources/scan/{scan_id}`
- `POST /api/v1/voice/session/start`
- `POST /api/v1/voice/session/{session_id}/turn`
- `POST /api/v1/voice/session/{session_id}/end`

Evidence:
- `backend/app/main.py` declares all API routes above.

### B. Retrieval + Grounded Q&A
Implemented:
- Query filters with payer/plan/category/version/status/effective date support.
- Policy version scope resolution before retrieval.
- Qdrant retrieval + metadata filtering.
- Citation building and response disclaimer.
- Confidence scoring based on retrieval relevance + citation count.

Evidence:
- `backend/app/main.py` functions: `_resolve_retrieval_scope`, `retrieve_chunks`, `build_citations`, `build_answer`, `query`.
- `qdrant_setup.py` function: `search(...)`.

### C. Compare and Diff
Implemented:
- Drug compare endpoint for selected plans.
- Version-to-version policy changes endpoint.
- Diff data model in DB (`policy_changes`) and write path in extraction pipeline.

Evidence:
- `backend/app/main.py`: `compare(...)`, `policy_changes(...)`.
- `extraction_agent.py`: `detect_changes(...)`.
- `schema.sql`: `policy_changes` table + related indexes/views.

### D. Ingestion Pipeline
Implemented:
- Upload-to-background ingestion flow via FastAPI `BackgroundTasks`.
- Document status lifecycle (`queued` -> `processing` -> `completed/failed`).
- Extraction pipeline: page extraction, section chunking, Gemini extraction, validation, confidence scoring, DB writes, Qdrant upsert.

Evidence:
- `backend/app/main.py`: `documents_upload(...)`, `run_ingestion_job(...)`.
- `extraction_agent.py`: `process_document(...)`, extraction/validation/upsert pipeline.

### E. Data Layer and Schema
Implemented:
- Full relational schema and typed DB helper methods.
- Version history preservation with `is_current` handling.
- QA session and message storage for voice/web conversation logging.

Evidence:
- `schema.sql`.
- `db.py` helpers for payers/plans/documents/policies/versions/chunks/rules/changes/sessions/messages.

### F. LiveKit Voice Agent (Realtime)
Implemented:
- Realtime LiveKit worker entrypoint and room session handling.
- Tool-based policy operations in call:
  - `get_user_context`
  - `query_policy`
  - `compare_drug_across_plans`
  - `get_policy_changes`
- Signed-in profile-aware context behavior:
  - use known profile data first
  - ask only missing fields
  - ask all fields if unsigned/unregistered
- VertexAI-compatible model config via env.

Evidence:
- `backend/livekit/agent.py`.
- `backend/livekit/agent_prompt.py`.
- `backend/livekit/playground_tools.py` + `backend/livekit/README.md` for dispatch/token/SIP utilities.

### G. Frontend (Patient-facing MVP UI)
Implemented routes/screens:
- `/ask` question flow
- `/compare` plan comparison view
- `/voice` voice-style chat session UI

Evidence:
- `frontend/src/App.tsx`, `frontend/src/components/patient/*.tsx`, `frontend/src/api/client.ts`.

### H. Source Monitoring (Baseline)
Implemented:
- Manual source scan trigger API endpoint.
- Scraper runner integration (subprocess call + result status/tail logs).
- Standalone scheduler + scraper scripts for recurring source pulls.

Evidence:
- `backend/app/main.py`: `sources/scan` endpoints and `run_source_scan_job(...)`.
- `insurance_scraper.py`.
- `scheduler.py`.

---

## 3) Partially Implemented / Integration Gaps

### A. Frontend compare flow does not use `/compare` endpoint
Current behavior:
- Compare page runs many `/query` calls across payer names.

Gap:
- Backend `/compare` endpoint expects `plan_ids` and returns normalized compare rows.
- Frontend compare currently bypasses this normalization path.

Impact:
- UI comparison logic can drift from backend canonical compare logic.
- More API calls and less deterministic compare output.

Evidence:
- `frontend/src/components/patient/ComparePlans.tsx` calls `postQuery(...)`.
- `frontend/src/api/client.ts` has `postCompare(...)` but not used in component.

### B. Payer filter mismatch risk (IDs vs names)
Current behavior:
- Some frontend requests pass payer display names in `filters.payer_ids`.

Gap:
- Backend filter logic expects payer UUIDs for `payer_ids`.
- Scope resolver may still retrieve results via fallback path, but semantics are inconsistent.

Evidence:
- `frontend/src/components/patient/AskQuestion.tsx` sets `filters: { payer_ids: [payer] }` where `payer` is a name string.
- `backend/app/main.py` `_resolve_retrieval_scope(...)` treats `payer_ids` as IDs.

### C. Voice stack split: LiveKit realtime agent vs REST voice session flow
Current behavior:
- Backend has REST voice session endpoints (`/voice/session/*`) used by frontend.
- Separate LiveKit realtime agent exists with richer tooling.

Gap:
- Frontend voice page is text-chat style and does not connect to LiveKit realtime/telephony path.
- Two voice paths exist, not unified.

Evidence:
- REST voice in `backend/app/main.py`.
- LiveKit worker in `backend/livekit/agent.py`.
- `frontend/src/components/patient/VoiceCall.tsx` uses REST client methods, not LiveKit SDK.

### D. Auth coverage is incomplete
Current behavior:
- Admin auth applied to upload and source scan.

Gap:
- End-user endpoints (`query`, `voice/session/*`) are open.
- Token-to-user-context wiring for voice sessions is not enforced in API layer.

Evidence:
- `backend/app/main.py` has auth dependency only on admin endpoints.

### E. Source scan orchestration is basic
Current behavior:
- Source scan API triggers `insurance_scraper.py` process and records stdout/stderr tails.

Gap:
- No robust queueing/retry/backoff/structured scan event records in DB.
- Not integrated with ingestion job pipeline as one managed workflow.

Evidence:
- `backend/app/main.py`: `run_source_scan_job(...)` uses `subprocess.run(...)`.

### F. Infrastructure/env consistency gaps
Current behavior:
- Multiple env files/expectations coexist.

Gap:
- Active `.env` in this workspace currently lacks key backend data envs (`DATABASE_URL`, `QDRANT_URL`), while `.env.example` defines them.
- This can cause runtime confusion depending on startup path.

Evidence:
- `.env` and `.env.example` differ in scope.

---

## 4) Not Implemented Yet (or Missing for Hackathon Reliability)

### A. Automated tests
Status:
- No backend/frontend/unit/integration test suite present.

Impact:
- High regression risk during rapid hackathon iteration.

Evidence:
- No test directories/files; only planning doc exists (`docs/10-testing-and-quality.md`).

### B. End-to-end demo guardrails
Status:
- No deterministic seeded demo dataset script and no one-command smoke-check script.

Impact:
- Demo can fail due to missing data/index/runtime env mismatch.

### C. Production-grade async ingestion queue
Status:
- Uses FastAPI background tasks; Celery/Redis path not fully wired for ingestion.

Impact:
- Long ingestion tasks can be fragile under load or restarts.

### D. UI for policy change tracking
Status:
- Backend diff endpoint exists, but no dedicated changes screen wired in frontend routes.

Impact:
- One major demo story is backend-only currently.

### E. Provider/admin analytics portal
Status:
- Not implemented (idea discussed, no modules/routes/UI for this yet).

### F. External connector integrations
Status:
- Not implemented (GitHub/Google/other connector flows are not integrated in the agent runtime).

### G. Full telephony hardening
Status:
- Twilio setup tooling exists, but there is no deployment-grade inbound call operational playbook/monitoring in codebase.

---

## 5) Architecture Drift / Technical Debt to Resolve

### A. Qdrant vs Chroma dual path
- Current core app path uses PostgreSQL + Qdrant.
- Legacy scripts (`insurance_scraper.py`, `policy_qa.py`) still use ChromaDB.

Risk:
- Team confusion and duplicate ingestion/retrieval logic.

Recommendation:
- Keep Qdrant path as source of truth for hackathon demo.
- Mark Chroma scripts as legacy or migrate them to Qdrant.

### B. Docs mention Next.js, codebase is Vite React
- Planning docs describe Next.js; frontend implementation is Vite React.

Risk:
- Onboarding friction and inconsistent runbooks.

Recommendation:
- Update docs to match current implementation or execute migration explicitly.

### C. Protected endpoint readiness
- Admin-protected endpoints exist, but this path needs explicit token-issuance/testing docs for demo-day operators.

Risk:
- Confusion during demos if admin-only routes are called without a valid bearer token.

---

## 6) Priority Backlog (Suggested for Winning Demo)

### Priority 0 (must-do before demo)
1. Ensure Qdrant + Postgres + backend startup script is one command and repeatable.
2. Wire frontend compare screen to backend `/compare`.
3. Add frontend policy changes screen using `/policies/{id}/changes`.
4. Add a demo data bootstrap script (seed docs + run ingestion + verify query).
5. Add basic smoke tests:
   - health
   - query (with citation count > 0)
   - compare
   - policy diff
   - voice session start/turn/end

### Priority 1 (high value)
1. Unify voice experience decision:
   - keep REST voice mode for demo simplicity, or
   - fully move to LiveKit realtime with Twilio inbound.
2. Add minimal auth path for user sessions (optional in hackathon if time is tight).
3. Add error telemetry/log correlation IDs across ingestion/query/voice.

### Priority 2 (post-demo)
1. Replace background ingestion with Celery workers.
2. Consolidate legacy Chroma scripts into Qdrant architecture.
3. Add provider/admin analytics portal.

---

## 7) Practical Definition of "Demo Ready"

The platform is demo-ready when all are true:
1. `POST /query` returns answer + at least one citation on seeded data.
2. `/compare` path is shown in UI using real `plan_ids`.
3. Policy diff endpoint is visible in UI for one real policy version pair.
4. Voice mode demonstrates one successful grounded response.
5. Startup script validates dependencies, DB, Qdrant, and model connectivity before demo begins.
