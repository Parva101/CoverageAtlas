# 02 - User Stories

## Story 1: Coverage Check (Professional)
As a market access analyst,
I want to ask "Does Plan A cover Drug X for condition Y?",
so that I can make quick evidence-based access recommendations.

Acceptance criteria:
- Returns coverage status (`covered`, `restricted`, `not_covered`, `unknown`).
- Shows at least one source citation.
- Displays policy effective date.

## Story 2: Prior Authorization Details
As a reimbursement specialist,
I want to see prior authorization criteria in plain bullets,
so that I can prepare complete documentation upfront.

Acceptance criteria:
- Returns normalized criteria list.
- Flags required labs/diagnosis/treatment history if present.
- Includes disclaimer when data confidence is low.

## Story 3: Plan Comparison
As a policy analyst,
I want to compare 2+ plans side by side,
so that I can identify strict vs flexible policies.

Acceptance criteria:
- Comparison table includes coverage status, PA requirements, step therapy, quantity limits.
- Differences are highlighted.
- Export to CSV supported.

## Story 4: Policy Change Tracking
As a team lead,
I want to know what changed between policy versions,
so that I can react before field teams are surprised.

Acceptance criteria:
- Diff shows added/removed/modified rules.
- Includes old value and new value.
- Every change links back to source snippets.

## Story 5: Upload & Process
As an admin,
I want to upload a new policy file,
so that it becomes searchable automatically.

Acceptance criteria:
- Upload returns processing status (`queued`, `processing`, `completed`, `failed`).
- On success, policy appears in search and compare screens.
- On failure, user sees error reason.

## Story 6: Voice Call Assistant
As a patient/caregiver,
I want to call and ask policy questions in plain language,
so that I can understand likely next steps without reading PDFs.

Acceptance criteria:
- Voice agent answers using RAG (grounded retrieval).
- Response includes plain-language guidance and uncertainty handling.
- Post-call summary is stored and viewable.

## Story 7: Auto-Update Agent
As a product admin,
I want an automated agent to check payer websites for new policy files,
so that our database stays current without manual effort.

Acceptance criteria:
- Agent checks configured sources daily.
- New/changed files trigger ingestion and versioning.
- Change log records source URL and detection timestamp.

## Story 8: Citation Trust Layer
As any user,
I want to verify where each answer came from,
so that I can trust the result.

Acceptance criteria:
- Every answer includes citation cards (document, section, page/snippet).
- User can click through to the source excerpt.
- No citation means "insufficient evidence" response.
