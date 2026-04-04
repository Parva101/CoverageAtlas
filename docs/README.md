# Core Product Documentation

Working project name: **PayerLens** (can be renamed later).

This folder is the implementation starter pack for the core app:
- Policy ingestion (PDF/website documents)
- Rule extraction and normalization
- Search, comparison, and change tracking
- Voice call agent for user Q&A
- Auto-update agent for keeping data fresh

## Read This First
1. [01-product-overview.md](./01-product-overview.md)
2. [02-user-stories.md](./02-user-stories.md)
3. [03-glossary.md](./03-glossary.md)
4. [04-architecture.md](./04-architecture.md)
5. [05-data-model.md](./05-data-model.md)
6. [06-api-contract.md](./06-api-contract.md)

## Build & Delivery Docs
7. [07-ai-agents.md](./07-ai-agents.md)
8. [08-implementation-plan.md](./08-implementation-plan.md)
9. [09-team-split.md](./09-team-split.md)
10. [10-testing-and-quality.md](./10-testing-and-quality.md)
11. [11-demo-script.md](./11-demo-script.md)
12. [12-risks-decisions-open-questions.md](./12-risks-decisions-open-questions.md)

## Workspace Context
- Primary workspace: `innovation_hacks/` (this repo root)
- Reference implementation only: `insurance-policy-insights/`

## Current Stack Decisions
- Backend: Python API service (FastAPI recommended)
- Frontend: Next.js + TypeScript
- Relational DB: PostgreSQL
- Vector DB: Qdrant (primary)
- RAG policy: citation-first grounded answers

## Doc Conventions
- Every major technical term is defined in plain language.
- "Source citation" means the exact policy location (file, page, section, quote snippet).
- "Confidence" is the model's certainty score, not a guarantee.
