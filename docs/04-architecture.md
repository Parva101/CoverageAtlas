# 04 - System Architecture

## 1) High-Level Architecture

```text
[Policy Sources]
  | (PDF URLs, web pages, manual uploads)
  v
[Ingestion Service] --> [Raw Document Store]
  |                    (files + metadata)
  v
[Parser + Chunker] --> [Normalized Policy Extractor (LLM)]
  |                         |
  |                         v
  |                     [PostgreSQL]
  |                         |
  v                         v
[Vector Index Builder] --> [Qdrant]

User paths:
[Web App] ----> [Query API] ----> [Retriever + Answer Generator] ----> [Cited Response]
[Voice Call] -> [STT] -> [Same Query API] -> [TTS] -> [Caller]

Ops paths:
[Source Discovery Agent] -> detects new/changed docs -> triggers ingestion pipeline
[Change Engine] -> compares versions -> writes change events
```

## 2) Component Responsibilities
- Ingestion Service: Downloads and validates source docs.
- Parser/Chunker: Extracts text and splits into meaningful sections.
- Extractor: Converts chunks into normalized rule objects.
- PostgreSQL: Stores entities like payer, policy, criteria, versions, and audit data.
- Qdrant: Stores embeddings for semantic retrieval with metadata filters.
- Query API: Handles Q&A, compare, and diff requests.
- Voice Layer: Phone call interface using STT/TTS.
- Discovery Agent: Watches configured source pages for updates.

## 3) Data Flow (Upload Path)
1. User uploads document.
2. File metadata saved in `documents`.
3. Parser extracts text and headings.
4. Extractor emits normalized JSON.
5. Validation checks required fields.
6. Structured rows inserted into PostgreSQL.
7. Chunks embedded and indexed in Qdrant.
8. Status set to `completed`.

## 4) Data Flow (Question Path)
1. User asks question.
2. Retriever runs hybrid retrieval (keyword + vector) with metadata filters (payer/plan/version).
3. Answer model generates response only from retrieved evidence.
4. Citation builder attaches source references.
5. API returns answer + confidence + citations.

## 5) Non-Functional Requirements
- Reliability: processing jobs retriable with dead-letter logging.
- Performance: p95 query response under 10s for MVP.
- Auditability: every answer has trace id and citation list.
- Security: no raw PHI required for MVP (PHI = patient health-identifying data).

## 6) MVP Infrastructure Choice (Locked)
- Frontend: Next.js (TypeScript)
- Backend API: Python + FastAPI
- Async tasks: Celery + Redis
- Relational DB: PostgreSQL
- Vector DB: Qdrant (primary)
- Telephony: LiveKit or Twilio bridge into the same Query API

## 7) RAG Rules (Non-Negotiable)
1. No final answer without retriever evidence.
2. Every answer includes citations.
3. Low-evidence queries return "insufficient evidence".
4. Retrieval always applies version/date filters when available.
