# 10 - Testing and Quality Plan

## 1) Testing Strategy
Use three layers:
1. Unit tests: small logic checks (parser, diff, normalizer).
2. Integration tests: API + DB + vector retrieval behavior.
3. End-to-end tests: user flows in UI and voice scenarios.

## 2) Must-Test Scenarios

### Ingestion
- Upload valid PDF -> status reaches `completed`.
- Corrupt PDF -> status `failed` with readable error.

### Extraction
- Core fields extracted: drug name, coverage status, PA requirement.
- Missing information handled as `unknown`.

### Query
- Answers include citations.
- Unsupported question returns "insufficient evidence".

### Compare
- For same drug across 2 plans, differences appear correctly.

### Diff
- Version A vs B identifies added/removed/modified fields.

### Voice
- Caller question transcribed and answered.
- Transcript saved.

### Source Discovery
- New source file detected and ingestion triggered.
- Same unchanged source does not duplicate records.

## 3) Quality Metrics
- Citation coverage rate
- Extraction field-level precision/recall
- Average query latency
- Failed ingestion rate
- Voice turn success rate

## 4) Human Review Workflow
When confidence is low:
- Mark result as `needs_review`.
- Add reviewer queue entry.
- Do not present as certain.

## 5) Test Dataset
Create a labeled mini-set:
- 10-20 policy docs
- 3-5 drugs
- Known expected outcomes for key fields

Store expected outputs in:
- `backend/tests/fixtures/policy_expected.json`

## 6) Regression Rules
Before demo/release:
- All endpoint smoke tests pass.
- No uncited answer in top scripted queries.
- No broken compare/diff screens.

## 7) Tooling
- Backend: `pytest` + Django test framework
- Frontend: component + e2e smoke tests
- Optional: API contract tests using JSON schema validation
