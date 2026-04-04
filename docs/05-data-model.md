# 05 - Data Model

## 1) Core Entities

### `payers`
- `id` (UUID)
- `name`
- `payer_type` (`commercial`, `medicare`, `medicaid`, `other`)
- `region`
- `created_at`

### `plans`
- `id` (UUID)
- `payer_id` (FK)
- `plan_name`
- `plan_type` (for example HMO/PPO)
- `market` (individual/group/MA/Medicaid)

### `policies`
- `id` (UUID)
- `payer_id` (FK)
- `policy_title`
- `policy_code` (if present)
- `policy_category` (`medical_benefit`, `pharmacy_benefit`, `general_um`)

### `policy_versions`
- `id` (UUID)
- `policy_id` (FK)
- `version_label` (for example "v2026-04")
- `effective_date`
- `published_date`
- `source_url`
- `document_id` (FK)
- `is_current` (bool)

### `documents`
- `id` (UUID)
- `file_name`
- `file_type` (`pdf`, `html`, `docx`)
- `sha256`
- `storage_path`
- `ingestion_status`
- `ingested_at`

### `policy_chunks`
- `id` (UUID)
- `policy_version_id` (FK)
- `chunk_index`
- `section_title`
- `page_number`
- `text`
- `embedding_id`

### `coverage_rules`
- `id` (UUID)
- `policy_version_id` (FK)
- `drug_name`
- `drug_aliases` (JSON array)
- `indication`
- `coverage_status` (`covered`, `restricted`, `not_covered`, `unknown`)
- `prior_auth_required` (bool/nullable)
- `step_therapy_required` (bool/nullable)
- `quantity_limit_text`
- `site_of_care_text`
- `criteria_summary`
- `raw_evidence_ref` (JSON citation pointers)
- `extraction_confidence` (0..1)

### `policy_changes`
- `id` (UUID)
- `policy_id` (FK)
- `from_version_id` (FK)
- `to_version_id` (FK)
- `change_type` (`added`, `removed`, `modified`)
- `field_name`
- `old_value`
- `new_value`
- `citations` (JSON)
- `detected_at`

### `qa_sessions`
- `id` (UUID)
- `user_id`
- `channel` (`web`, `voice`)
- `started_at`

### `qa_messages`
- `id` (UUID)
- `session_id` (FK)
- `role` (`user`, `assistant`)
- `message_text`
- `confidence`
- `citations` (JSON)
- `created_at`

## 2) Normalized Rule JSON (Extractor Output)
```json
{
  "drug_name": "ExampleDrug",
  "indication": "Condition A",
  "coverage_status": "restricted",
  "prior_auth_required": true,
  "step_therapy_required": true,
  "quantity_limit_text": "Up to 2 doses per 28 days",
  "criteria_summary": [
    "Diagnosis confirmed by specialist",
    "Trial and failure of first-line therapy"
  ],
  "citations": [
    {
      "document_id": "...",
      "page": 12,
      "section": "Coverage Criteria",
      "snippet": "..."
    }
  ],
  "confidence": 0.86
}
```

## 3) Data Quality Rules
- Keep original text and extracted values together.
- Never delete historical versions.
- Reject records missing `drug_name` and `coverage_status` unless marked `unknown`.
- If confidence < threshold, mark `needs_review = true`.
