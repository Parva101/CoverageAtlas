# 06 - API Contract (MVP)

Base path: `/api/v1`

## 1) Health
### `GET /health`
Returns service status.

Response:
```json
{ "status": "ok" }
```

## 2) Documents & Ingestion
### `POST /documents/upload`
Upload policy file.

Request: multipart form-data
- `file`
- `payer_id`
- `policy_title`
- `effective_date` (optional)

Response:
```json
{
  "document_id": "uuid",
  "ingestion_status": "queued"
}
```

### `GET /documents/{document_id}/status`
Returns ingestion progress.

Response:
```json
{
  "document_id": "uuid",
  "ingestion_status": "processing",
  "current_step": "extracting_rules"
}
```

## 3) Query / Q&A
### `POST /query`
Ask natural-language policy question.

Request:
```json
{
  "question": "Does Plan A cover Drug X for condition Y?",
  "filters": {
    "payer_ids": ["uuid"],
    "plan_ids": ["uuid"],
    "policy_categories": ["medical_benefit"],
    "version_labels": ["v2026-04-01"],
    "coverage_statuses": ["restricted"],
    "policy_version_ids": ["uuid"],
    "effective_on": "2026-04-01"
  },
  "retrieval": {
    "top_k": 8,
    "hybrid": true
  }
}
```

Notes:
- All `filters.*` fields are optional.
- `plan_ids` are resolved to payer scope before retrieval.
- `effective_on` applies policy-version date filtering (`effective_date <= effective_on`).
- `policy_version_ids` can be used as an explicit allowlist for retrieval.

Response:
```json
{
  "answer": "Plan A covers Drug X with restrictions.",
  "confidence": 0.82,
  "citations": [
    {
      "document_id": "uuid",
      "page": 14,
      "section": "Coverage Criteria",
      "snippet": "..."
    }
  ],
  "retrieval_trace": {
    "chunks_used": 6,
    "vector_store": "qdrant"
  },
  "disclaimer": "Informational only. Final decision depends on plan-specific review."
}
```

## 4) Compare
### `POST /compare`
Compare policies across plans for a drug.

Request:
```json
{
  "drug_name": "Drug X",
  "plan_ids": ["uuid-1", "uuid-2"],
  "effective_on": "2026-04-01"
}
```

Response:
```json
{
  "drug_name": "Drug X",
  "rows": [
    {
      "plan_id": "uuid-1",
      "coverage_status": "restricted",
      "prior_auth_required": true,
      "step_therapy_required": false,
      "criteria_summary": ["..."],
      "citations": []
    }
  ]
}
```

## 5) Change Tracking
### `GET /policies/{policy_id}/changes?from=versionA&to=versionB`
Returns change diff.

Response:
```json
{
  "policy_id": "uuid",
  "from_version": "2025-Q4",
  "to_version": "2026-Q1",
  "changes": [
    {
      "change_type": "modified",
      "field_name": "step_therapy_required",
      "old_value": "false",
      "new_value": "true",
      "citations": []
    }
  ]
}
```

## 6) Source Discovery Agent
### `POST /sources/scan`
Manually trigger configured source scan.

Request:
```json
{ "source_group": "default" }
```

Response:
```json
{
  "scan_id": "uuid",
  "status": "started"
}
```

### `GET /sources/scan/{scan_id}`
Returns scan results and found updates.

## 7) Voice Session APIs
### `POST /voice/session/start`
Start call session record.

### `POST /voice/session/{id}/turn`
Append user utterance and return assistant response.

### `POST /voice/session/{id}/end`
Finalize summary and store transcript.

## 8) Error Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "drug_name is required",
    "details": {}
  }
}
```

## 9) Security (MVP)
- Auth: Bearer JWT (Auth0) for user APIs.
- Admin-only endpoints: upload, source scan config/status.
- `GET /auth/me` returns parsed claims for auth debugging.
- If `AUTH0_ENABLED=false`, backend runs in local-dev auth bypass mode.
- Rate limit query endpoints.
