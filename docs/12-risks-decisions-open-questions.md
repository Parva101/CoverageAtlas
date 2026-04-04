# 12 - Risks, Decisions, and Open Questions

## 1) Key Risks

### Risk A: Extraction Accuracy
Problem: Policies have inconsistent formatting and legal wording.
Mitigation:
- Keep confidence scores.
- Add human review path.
- Use schema validation and test fixtures.

### Risk B: Hallucinated Answers
Problem: AI may generate unsupported statements.
Mitigation:
- Enforce citation requirement.
- Return "insufficient evidence" when retrieval is weak.

### Risk C: Data Freshness
Problem: Policy updates can make old outputs stale.
Mitigation:
- Source discovery agent with scheduled scans.
- Versioning and change timestamps.

### Risk D: Compliance/Trust
Problem: Users may treat output as final insurer decision.
Mitigation:
- Clear disclaimers.
- Show policy source and effective date.

### Risk E: Voice Latency
Problem: Slow calls create poor user experience.
Mitigation:
- Keep responses concise.
- Cache common queries.
- Use streaming STT/TTS if available.

## 2) Architectural Decisions (Locked for MVP)
1. Keep retrieval and answer generation separate for easier debugging.
2. Store both structured fields and raw text chunks.
3. Make LLM provider replaceable via adapter interface.
4. Maintain complete policy version history.
5. Use PostgreSQL as source-of-truth relational DB.
6. Use Qdrant as primary vector store for RAG retrieval.

## 3) Open Questions (Need Team Decision)
1. Telephony provider first: LiveKit or Twilio bridge?
2. Source scope for MVP: only commercial payer docs or include one Medicare/Medicaid source?
3. Authentication: lightweight demo auth or production-grade role model?
4. Should patient mode include plan-selection helper flow in MVP?
5. What are trigger criteria to add Pinecone later (scale, ops, latency, cost)?

## 4) Non-Negotiable Guardrails
- No answer without evidence.
- No medical advice claims.
- Always show date/version context.

## 5) Post-Hackathon Roadmap Ideas
- Policy provider analytics portal (quality/compliance dashboard)
- Personalized member-level guidance integrations
- Appeal support assistant with document checklist generation
