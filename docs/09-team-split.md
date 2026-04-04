# 09 - Team Split (3 Members)

## Team Structure

### Member 1 - Data/AI Engineer (Owner: Ingestion + Extraction)
Responsibilities:
- Document ingestion and parsing pipeline
- Extraction prompts and schema validation
- Vector indexing
- Data quality evaluation scripts

Deliverables:
- `ingestion` module
- `extractor` module
- Extraction accuracy report on sample dataset

### Member 2 - Backend Engineer (Owner: APIs + Business Logic)
Responsibilities:
- DB schema and migrations
- Query, compare, diff APIs
- Auth/rate limits/logging
- Source discovery scheduler and job orchestration

Deliverables:
- API endpoints defined in `06-api-contract.md`
- Change tracking engine
- Source scan job endpoints

### Member 3 - Frontend/Voice Engineer (Owner: UX + Demo)
Responsibilities:
- Dashboard/search/compare/change UI
- Patient mode plain-language layer
- Voice flow integration and transcript UI
- Demo script + fallback UI states

Deliverables:
- Working user flows for web and call demo
- Citation cards and confidence labels
- Demo-ready screens

## Daily Sync Model
- 10 min standup every 4-6 hours in hackathon window.
- Shared integration branch updated at least 2x/day.
- API contract changes must be announced before merge.

## Ownership Boundaries
- Member 1 owns extraction schema changes.
- Member 2 owns API contract changes.
- Member 3 owns response rendering format.
- Any cross-cutting change requires 2 approvals.

## Task Board (Initial)
1. Define schema + sample policies (All, 2h)
2. Build upload + parser (M1, 5h)
3. Build core models + migrations (M2, 4h)
4. Build query endpoint with citations (M2 + M1, 6h)
5. Build dashboard query UI (M3, 4h)
6. Build compare API + UI (M2 + M3, 6h)
7. Build diff API + UI (M2 + M3, 5h)
8. Build voice call flow (M3 + M2, 6h)
9. Build source discovery agent (M1 + M2, 6h)
10. End-to-end test pass + demo polish (All, 6h)

## Communication Rules
- Keep PRs under ~300 lines when possible.
- Use short PR template: scope, risk, test evidence.
- No silent schema changes.
