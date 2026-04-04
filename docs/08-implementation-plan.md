# 08 - Implementation Plan

## 1) Delivery Tracks
Track A: Data + AI Pipeline
Track B: Backend APIs + Storage
Track C: Frontend + Voice UX

## 2) Phase Plan

### Phase 0 - Setup (Half day)
- Initialize locked stack: Python FastAPI + PostgreSQL + Qdrant + Celery/Redis + Next.js.
- Create `.env.example` for all services.
- Add basic logging and trace IDs.

### Phase 1 - Core Ingestion + Query (Day 1)
- Upload endpoint and document store.
- Parser/chunker working for PDFs.
- Minimal extraction pipeline to write normalized rules.
- Basic `/query` endpoint with citations and retrieval filters.

### Phase 2 - Compare + Diff (Day 2)
- Implement compare endpoint and UI table.
- Implement versioned policy records.
- Implement change detection endpoint and UI timeline.

### Phase 3 - Voice + Auto-Update (Day 3)
- Voice call flow integrated (STT/TTS + query API).
- Source discovery agent for configured URLs.
- End-to-end demo hardening and fallback scripts.

## 3) Definition of Done (MVP)
- User can upload policy and receive searchable results.
- User can ask coverage question and see citation.
- User can compare at least 2 plans for one drug.
- User can view a version diff for one policy.
- Voice call can answer at least 3 scripted queries.
- Auto-update agent can detect at least one changed source.

## 4) Dependency Order
1. Schema + DB tables
2. Ingestion pipeline
3. Qdrant collection + embedding write path
4. Query API (hybrid retrieval + citations)
5. Compare/diff logic
6. Frontend binding
7. Voice and source discovery integration
8. Testing + demo polish

## 5) Work Breakdown by Hours (72-hour Hackathon)
- 0-6h: architecture freeze, schema, setup
- 6-18h: ingestion + extraction baseline
- 18-30h: query + citations
- 30-42h: compare + diff
- 42-54h: voice + source discovery
- 54-66h: QA, bug fixes, latency tuning
- 66-72h: final demo run and backup video

## 6) Repo Structure Recommendation
```text
backend/
  app/
    policy/            # models, schemas, repositories
    ingestion/         # parser, extractor, jobs
    qa/                # retriever + answer service
    diff/              # change engine
    voice/             # voice session handlers
    source_monitor/    # source discovery logic
frontend/
  app/
    dashboard/
    compare/
    changes/
    patient/
    call/
docs/
```

## 7) Environment Variables (Draft)
- `DATABASE_URL`
- `QDRANT_URL`
- `QDRANT_API_KEY`
- `QDRANT_COLLECTION`
- `LLM_API_KEY`
- `EMBEDDING_MODEL`
- `VOICE_PROVIDER_KEY`
- `SOURCE_SCAN_CRON`

## 8) Risks During Build
- Extraction quality varies by PDF format.
- Retrieval quality drops if chunking is poor.
- Metadata filters can point to wrong plan/version if mapping is incomplete.
- Voice latency can hurt user experience.

Mitigation:
- Use small validated document set first.
- Add manual review tags.
- Make plan/version metadata required in ingestion.
- Keep voice responses short and citation-grounded.
