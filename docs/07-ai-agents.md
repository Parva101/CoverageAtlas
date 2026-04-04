# 07 - AI Agents Design

This project uses multiple specialized AI agents.

## 1) Extraction Agent (Document -> Structured Rules)
Purpose:
- Read policy text chunks and output normalized JSON fields.

Input:
- Chunk text + document metadata.

Output:
- `coverage_rules` records with citations and confidence.

Guardrails:
- No inference beyond provided text.
- If uncertain, set `coverage_status = unknown` and lower confidence.

## 2) Q&A Agent (Grounded Answering)
Purpose:
- Answer user questions from retrieved evidence.

How it works:
1. Retriever pulls relevant chunks from Qdrant + keyword index with metadata filters (payer, plan, version).
2. Agent synthesizes answer strictly from evidence.
3. Response includes plain-language explanation + citations.

Failure behavior:
- If evidence is weak, respond with "insufficient evidence" instead of guessing.

## 3) Compare Agent (Normalization + Contrast)
Purpose:
- Convert plan-specific wording into comparable normalized fields.

Output:
- Comparison rows and textual summary of key differences.

## 4) Diff Agent (Version Change Detection)
Purpose:
- Compare structured records for two versions and emit changes.

Change types:
- `added`, `removed`, `modified`

## 5) Voice Agent (Call Experience)
Purpose:
- Converse with users over phone using the same Q&A backend.

Flow:
- STT -> intent + retrieval -> grounded answer -> TTS -> caller

Safety behavior:
- Always state informational scope.
- For critical uncertainty, instruct user to contact insurer/provider.

## 6) Source Discovery Agent (Freshness)
Purpose:
- Monitor payer policy pages and files to detect updates.

Capabilities:
- Track source URLs
- Detect file hash changes
- Trigger ingestion jobs
- Record update events

## 7) Shared Prompt Rules
- Use plain language first.
- Define technical terms in short parentheses.
- Never claim certainty without evidence.
- Always include citations when available.
- Do not provide medical advice.

## 8) Confidence Scoring (MVP Formula)
A practical composite score:
- Extraction confidence from model
- Number/quality of citations
- Agreement between structured and unstructured retrieval

If score < threshold:
- Mark `needs_review = true`
- Response includes explicit uncertainty warning.

## 9) Model-Agnostic Design
Keep model and retrieval providers pluggable:
- `extractor_model`
- `qa_model`
- `voice_model`
- `vector_store_adapter`

Use adapter interfaces so model or vector store provider can change without rewriting business logic.


