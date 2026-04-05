# 13. Competitive Gap Analysis

Last updated: 2026-04-05

## Purpose
This document compares CoverageAtlas with the closest existing solutions and explains where CoverageAtlas is stronger for our target use case.

## Scope and Method
- Comparison is based on publicly documented product capabilities.
- Ratings are feature-level (not implementation-quality benchmarks).
- If a vendor has private or enterprise-only features not publicly documented, they are not counted here.

## Feature Matrix

| Platform | Primary User | Policy Q&A (RAG-style) | Plan/Formulary Compare | Policy Version Change Timeline | Denial/PA Next-Best-Action | Appeal Letter Drafting | Voice Agent UX | Open Source |
|---|---|---|---|---|---|---|---|---|
| CoverageAtlas | Patient + care/admin teams | Yes | Yes | Yes | Yes | Yes | Partial | Yes |
| Cohere Health | Providers + payers | Partial | Partial | No | Yes | Partial | No | No |
| Surescripts (ePA + RTPB) | Providers/pharmacies/payers | Partial | Partial | No | Yes | No | No | No |
| MMIT (CoverageFinder/API) | Market access/commercial teams | No | Yes | Partial | No | No | No | No |
| 1up Formulary API | Builders/integrators | No | Yes | No | No | No | No | No |
| Counterforce / appeal tools | Patients/providers | Partial | No | No | Partial | Yes | No | No |
| AWS insurance AI assistant sample | Builders/dev teams | Yes | Partial | No | No | No | No | Yes |

## Where CoverageAtlas Is Better Than Each

### 1) CoverageAtlas vs Cohere Health
CoverageAtlas advantages:
- Covers both patient-facing and team-facing workflows in one product.
- Adds policy version timeline and patch-note style diffs, which improves explainability over time.
- Includes integrated appeal generation and denial-risk simulation in the same workspace.
- Combines Q&A + compare + timeline + action planning in one continuous flow.

### 2) CoverageAtlas vs Surescripts
CoverageAtlas advantages:
- More transparent policy reasoning for end users via citation-backed responses and policy context.
- Includes policy change intelligence (version diffs and update timeline), not only transaction exchange.
- Adds user-facing workflow modules for denial risk, next best action, and appeal drafting.
- Better suited for patient education and navigation, not only provider transaction routing.

### 3) CoverageAtlas vs MMIT
CoverageAtlas advantages:
- Goes beyond formulary lookup into decision support and workflow execution.
- Adds longitudinal change tracking of policy versions and field-level updates.
- Includes denial mitigation tooling (next best access, risk scoring, appeal draft generation).
- Provides a patient profile-aware interface and guided actions instead of lookup-only behavior.

### 4) CoverageAtlas vs 1up Formulary API
CoverageAtlas advantages:
- End-product experience (UI + workflow) rather than API-only infrastructure.
- Native reasoning layer on top of retrieved policy evidence.
- Operational modules for denial handling and appeals, not just data access.
- Can be used immediately by end users without building additional product layers.

### 5) CoverageAtlas vs Counterforce / Appeal-Only Tools
CoverageAtlas advantages:
- Supports the full pre-appeal and post-denial journey, not just appeal letter creation.
- Includes plan comparison and policy Q&A before denial occurs (proactive support).
- Adds policy-change timeline and access pathway ranking to improve strategy selection.
- Better for care teams that need one integrated workspace for multiple workflows.

### 6) CoverageAtlas vs AWS Insurance Assistant Sample
CoverageAtlas advantages:
- Productized healthcare-policy workflows instead of a generic/sample assistant.
- Includes domain-specific modules: plan switch simulation, denial risk meter, appeal builder.
- Includes policy version-diff timeline and compare workflows out of the box.
- Ready for real team integration with authenticated profile context and workflow navigation.

## Strategic Positioning Summary
CoverageAtlas is strongest when positioned as:
- A unified "coverage intelligence + action orchestration" workspace.
- A system that not only answers coverage questions, but also helps teams execute the next best action.
- A transparency-first tool where policy changes and rationale are visible, trackable, and operationally useful.

## Evidence Sources
- Cohere Health Provider Solutions: https://www.coherehealth.com/solutions/providers
- Surescripts ePA: https://surescripts.com/what-we-do/electronic-prior-authorization
- Surescripts RTPB: https://surescripts.com/what-we-do/real-time-prescription-benefit
- MMIT API QuickStart: https://api.mmitnetwork.com/Home/QuickStart
- MMIT CoverageFinder: https://www.mmitnetwork.com/coveragefinder/
- 1up Formulary: https://1up.health/products/formulary/
- Counterforce Health: https://www.counterforcehealth.org/
- AWS Sample Insurance AI Assistant: https://github.com/aws-samples/sample-insurance-policy-ai-assistant
- Insurance RAG Chatbot (community): https://github.com/arpan65/Insurance-RAG-Chatbot
- HL7 Da Vinci Drug Formulary RI: https://github.com/HL7-DaVinci/drug-formulary-ri

