# 01 - Product Overview

## 1) Problem Statement
Insurance drug coverage rules are scattered across many payer websites and policy PDFs.
Each payer writes rules differently, updates frequently, and uses dense language.
Users today must manually read documents and maintain spreadsheets.

## 2) Product Goal
Build a policy intelligence platform that answers:
- Is Drug X covered by Plan Y?
- Does it need prior authorization?
- How do plans differ?
- What changed this quarter?

## 3) Target Users
Primary (initial paying users):
- Market access analysts (life sciences teams tracking payer coverage)
- Reimbursement teams (provider/pharma operations)
- Policy operations teams

Secondary (hackathon-facing user):
- Patient/caregiver in a plain-language "Patient Mode"

## 4) What The Product Does
1. Ingest policy sources (PDF, website pages, downloadable files).
2. Parse documents into clean text blocks with source metadata.
3. Normalize rules into a standard JSON schema.
4. Store data for keyword search + semantic search.
5. Answer questions with citations.
6. Compare plans side by side.
7. Track changes between policy versions.
8. Provide voice call Q&A using the same grounded data.

## 5) Plain-Language Definitions
- Payer: Insurance company or government insurance program that pays for care.
- Provider: Doctor/hospital that gives care.
- Prior authorization (PA): Insurance pre-approval required before payment.
- Formulary: Approved drug list.
- Coverage criteria: Conditions a patient must meet for approval.
- Semantic search: Search by meaning, not exact words.

## 6) Scope
### In Scope (MVP)
- 2 to 4 payer sources
- 10 to 30 policy documents
- Medical benefit + pharmacy benefit core fields
- Search, compare, diff, citations
- Voice call answer experience

### Out of Scope (MVP)
- Full claims adjudication prediction
- Individual patient eligibility verification via payer login
- Real-time EHR (electronic health record) integration

## 7) Success Metrics
- >=90% of answers include at least one valid source citation
- <=10 seconds for common Q&A queries
- >=80% extraction accuracy on core fields in labeled test set
- 100% policy changes visible with version timestamps

## 8) Product Principles
1. Citation first, answer second.
2. Plain language for non-experts.
3. Preserve history (never lose old versions).
4. Human-review path for low-confidence outputs.
