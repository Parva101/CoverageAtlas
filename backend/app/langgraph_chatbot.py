import json
import re
from typing import Any, Callable, TypedDict

import ai_provider
from langgraph.graph import END, StateGraph


INSUFFICIENT_EVIDENCE = "Insufficient evidence to answer based on available policy sources."
DEFAULT_DISCLAIMER = "Informational only. Final decision depends on plan-specific review."
OUT_OF_SCOPE = (
    "I can only help with medical benefit policy questions such as coverage, "
    "prior authorization, step therapy, and plan policy details."
)


class ChatGraphState(TypedDict, total=False):
    question: str
    filters: Any
    top_k: int
    history: list[dict[str, str]]
    retrieval_query: str
    chunks: list[dict]
    citations: list[dict]
    scope: dict[str, Any]
    route: str
    route_reason: str
    draft_answer: str
    answer: str
    confidence: float
    verifier_supported: bool
    verifier_status: str
    verifier_reason: str
    retrieval_trace: dict[str, Any]
    disclaimer: str
    evidence_strength: float
    evidence_cards: list[dict]
    customer_help: dict[str, Any]
    reasoning: dict[str, Any]


class LangGraphPolicyChatbot:
    def __init__(
        self,
        *,
        retrieve_fn: Callable[[str, Any, int, list[dict[str, str]]], tuple[list[dict], dict[str, Any]]],
        citation_fn: Callable[[list[dict]], list[dict]],
        qa_model: str,
        temperature: float,
        max_output_tokens: int,
    ):
        self.retrieve_fn = retrieve_fn
        self.citation_fn = citation_fn
        self.qa_model = qa_model
        self.temperature = temperature
        self.max_output_tokens = max_output_tokens
        self.graph = self._build_graph().compile()

    def run(
        self,
        *,
        question: str,
        filters: Any,
        top_k: int,
        history: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        initial: ChatGraphState = {
            "question": question.strip(),
            "filters": filters,
            "top_k": top_k,
            "history": history or [],
        }
        state = self.graph.invoke(initial)
        return {
            "answer": state.get("answer", INSUFFICIENT_EVIDENCE),
            "confidence": float(state.get("confidence", 0.0)),
            "citations": state.get("citations", []),
            "retrieval_trace": state.get(
                "retrieval_trace",
                {"chunks_used": 0, "vector_store": "qdrant", "applied_filters": {}},
            ),
            "disclaimer": state.get("disclaimer", DEFAULT_DISCLAIMER),
            "reasoning": state.get("reasoning", {}),
            "evidence_cards": state.get("evidence_cards", []),
            "customer_help": state.get("customer_help", {}),
        }

    def _build_graph(self) -> StateGraph:
        graph = StateGraph(ChatGraphState)
        graph.add_node("route_intent", self._node_route_intent)
        graph.add_node("smalltalk_reply", self._node_smalltalk_reply)
        graph.add_node("glossary_reply", self._node_glossary_reply)
        graph.add_node("out_of_scope_reply", self._node_out_of_scope_reply)
        graph.add_node("retrieve", self._node_retrieve)
        graph.add_node("insufficient", self._node_insufficient)
        graph.add_node("answer_agent", self._node_answer_agent)
        graph.add_node("verify_agent", self._node_verify_agent)
        graph.add_node("finalize", self._node_finalize)

        graph.set_entry_point("route_intent")
        graph.add_conditional_edges(
            "route_intent",
            self._edge_from_route,
            {
                "smalltalk_reply": "smalltalk_reply",
                "glossary_reply": "glossary_reply",
                "out_of_scope_reply": "out_of_scope_reply",
                "retrieve": "retrieve",
            },
        )
        graph.add_edge("smalltalk_reply", "finalize")
        graph.add_edge("glossary_reply", "finalize")
        graph.add_edge("out_of_scope_reply", "finalize")
        graph.add_conditional_edges(
            "retrieve",
            self._edge_from_retrieval,
            {
                "answer_agent": "answer_agent",
                "insufficient": "insufficient",
            },
        )
        graph.add_edge("insufficient", "finalize")
        graph.add_edge("answer_agent", "verify_agent")
        graph.add_edge("verify_agent", "finalize")
        graph.add_edge("finalize", END)
        return graph

    def _node_route_intent(self, state: ChatGraphState) -> ChatGraphState:
        question = (state.get("question") or "").strip()
        route, reason = self._classify_intent(question)
        retrieval_query = self._build_retrieval_query(question, state.get("history") or [])
        return {
            "route": route,
            "route_reason": reason,
            "retrieval_query": retrieval_query,
        }

    def _edge_from_route(self, state: ChatGraphState) -> str:
        route = state.get("route")
        if route == "smalltalk":
            return "smalltalk_reply"
        if route == "glossary":
            return "glossary_reply"
        if route == "out_of_scope":
            return "out_of_scope_reply"
        return "retrieve"

    def _node_smalltalk_reply(self, state: ChatGraphState) -> ChatGraphState:
        return {
            "answer": (
                "Hi. I can help with coverage, prior authorization, step therapy, and policy criteria. "
                "Ask your question with a plan and drug name for best results."
            ),
            "confidence": 0.2,
            "chunks": [],
            "citations": [],
            "scope": {},
            "retrieval_trace": {"chunks_used": 0, "vector_store": "qdrant", "applied_filters": {}},
            "disclaimer": DEFAULT_DISCLAIMER,
            "evidence_strength": 0.0,
            "evidence_cards": [],
            "verifier_status": "n/a",
        }

    def _node_glossary_reply(self, state: ChatGraphState) -> ChatGraphState:
        question = (state.get("question") or "").lower()
        if "prior authorization" in question or "prior auth" in question:
            answer = (
                "Prior authorization means your insurer requires pre-approval before paying for a treatment. "
                "Your doctor usually submits clinical notes to justify medical need."
            )
        elif "step therapy" in question:
            answer = (
                "Step therapy means your insurer asks you to try certain lower-cost first-line treatments first. "
                "If those fail or are not appropriate, they may approve the requested treatment."
            )
        elif "medical benefit" in question:
            answer = (
                "Medical benefit usually covers drugs given in a clinic or hospital setting, "
                "such as infusions or injections administered by a provider."
            )
        elif "pharmacy benefit" in question:
            answer = (
                "Pharmacy benefit usually covers self-administered medications you pick up from a pharmacy."
            )
        else:
            answer = (
                "I can explain insurance terms like prior authorization, step therapy, "
                "medical benefit, and policy criteria in plain language."
            )
        return {
            "answer": answer,
            "confidence": 0.45,
            "chunks": [],
            "citations": [],
            "scope": {},
            "retrieval_trace": {"chunks_used": 0, "vector_store": "qdrant", "applied_filters": {}},
            "disclaimer": DEFAULT_DISCLAIMER,
            "evidence_strength": 0.0,
            "evidence_cards": [],
            "verifier_status": "n/a",
        }

    def _node_out_of_scope_reply(self, state: ChatGraphState) -> ChatGraphState:
        return {
            "answer": OUT_OF_SCOPE,
            "confidence": 0.9,
            "chunks": [],
            "citations": [],
            "scope": {},
            "retrieval_trace": {"chunks_used": 0, "vector_store": "qdrant", "applied_filters": {}},
            "disclaimer": DEFAULT_DISCLAIMER,
            "evidence_strength": 0.0,
            "evidence_cards": [],
            "verifier_status": "n/a",
        }

    def _node_retrieve(self, state: ChatGraphState) -> ChatGraphState:
        question = state.get("retrieval_query") or state.get("question", "")
        filters = state.get("filters")
        top_k = int(state.get("top_k", 8))
        history = state.get("history") or []
        chunks, scope = self.retrieve_fn(question, filters, top_k, history)
        citations = self.citation_fn(chunks)
        retrieval_trace = {
            "chunks_used": len(chunks),
            "vector_store": "qdrant",
            "applied_filters": {
                "plan_ids": scope.get("plan_ids", []),
                "payer_ids": scope.get("payer_ids", []),
                "policy_categories": scope.get("policy_categories", []),
                "version_labels": scope.get("version_labels", []),
                "coverage_statuses": scope.get("coverage_statuses", []),
                "policy_version_ids_count": scope.get("resolved_versions_count", 0),
                "effective_on": scope.get("effective_on"),
                "query_text": question,
            },
        }
        evidence_strength = 0.0
        if chunks:
            evidence_strength = sum(float(c.get("relevance", 0.0)) for c in chunks) / max(1, len(chunks))
        return {
            "chunks": chunks,
            "scope": scope,
            "citations": citations,
            "retrieval_trace": retrieval_trace,
            "evidence_strength": round(max(0.0, min(1.0, evidence_strength)), 2),
            "evidence_cards": self._build_evidence_cards(chunks),
        }

    def _edge_from_retrieval(self, state: ChatGraphState) -> str:
        chunks = state.get("chunks", [])
        if not chunks:
            return "insufficient"
        avg_relevance = sum(float(c.get("relevance", 0.0)) for c in chunks) / max(1, len(chunks))
        if avg_relevance < 0.2:
            return "insufficient"
        return "answer_agent"

    def _node_insufficient(self, state: ChatGraphState) -> ChatGraphState:
        chunks = state.get("chunks", [])
        avg_relevance = (
            sum(float(c.get("relevance", 0.0)) for c in chunks) / max(1, len(chunks))
            if chunks
            else 0.0
        )
        return {
            "answer": INSUFFICIENT_EVIDENCE,
            "confidence": round(max(0.0, min(0.25, avg_relevance)), 2),
            "disclaimer": DEFAULT_DISCLAIMER,
            "evidence_strength": round(max(0.0, min(1.0, avg_relevance)), 2),
        }

    def _node_answer_agent(self, state: ChatGraphState) -> ChatGraphState:
        question = state.get("question", "")
        chunks = state.get("chunks", [])
        history = state.get("history") or []
        history_lines = []
        for item in history[-6:]:
            role = (item.get("role") or "").strip().lower()
            text = (item.get("message_text") or item.get("text") or "").strip()
            if role and text:
                history_lines.append(f"{role}: {text}")
        history_block = "\n".join(history_lines)

        context_blocks = []
        for idx, chunk in enumerate(chunks, start=1):
            context_blocks.append(
                f"[SOURCE {idx}] payer={chunk.get('payer_name')} "
                f"policy={chunk.get('policy_title')} section={chunk.get('section_title')} "
                f"page={chunk.get('page_number')}\n{chunk.get('text', '')}"
            )
        context = "\n\n".join(context_blocks)

        prompt = (
            "You are CoverageAtlas policy assistant.\n"
            "Answer ONLY from the provided evidence.\n"
            "If evidence is missing for the question, output exactly this sentence:\n"
            f"{INSUFFICIENT_EVIDENCE}\n"
            "Do not invent details. No legal or medical advice.\n"
            "Keep the answer concise and plain language.\n\n"
            f"Conversation context (for intent disambiguation only):\n{history_block}\n\n"
            f"Question: {question}\n\n"
            f"Evidence:\n{context}\n"
        )

        draft = ai_provider.generate_text(
            prompt,
            model=self.qa_model,
            temperature=self.temperature,
            max_output_tokens=self.max_output_tokens,
        ).strip() or INSUFFICIENT_EVIDENCE

        avg_relevance = sum(float(c.get("relevance", 0.0)) for c in chunks) / max(1, len(chunks))
        citation_factor = min(1.0, len(state.get("citations", [])) / 4.0)
        confidence = max(0.0, min(0.99, round((avg_relevance * 0.75) + (citation_factor * 0.25), 2)))
        return {"draft_answer": draft, "confidence": confidence}

    def _node_verify_agent(self, state: ChatGraphState) -> ChatGraphState:
        question = state.get("question", "")
        chunks = state.get("chunks", [])
        draft = state.get("draft_answer", "").strip()
        context_blocks = []
        for idx, chunk in enumerate(chunks, start=1):
            context_blocks.append(
                f"[SOURCE {idx}] {chunk.get('text', '')}"
            )
        context = "\n\n".join(context_blocks)

        prompt = (
            "You are a strict fact-checking verifier.\n"
            "Given QUESTION, EVIDENCE, and ANSWER, decide whether every factual claim in ANSWER is grounded in EVIDENCE.\n"
            "Return JSON only with this schema:\n"
            "{\"verdict\":\"supported|partial|unsupported\",\"reason\":\"short reason\"}\n\n"
            f"QUESTION:\n{question}\n\n"
            f"EVIDENCE:\n{context}\n\n"
            f"ANSWER:\n{draft}\n"
        )

        raw = ai_provider.generate_text(
            prompt,
            model=self.qa_model,
            temperature=0.0,
            max_output_tokens=300,
        ).strip()
        parsed = self._extract_json(raw)
        parse_ok = isinstance(parsed, dict) and "verdict" in parsed
        if parse_ok:
            verdict_raw = str(parsed.get("verdict", "")).strip().lower()
            if verdict_raw not in {"supported", "partial", "unsupported"}:
                verdict_raw = "unsupported"
            supported = verdict_raw in {"supported", "partial"}
            reason = str(parsed.get("reason", "")).strip()
            verdict = verdict_raw
        else:
            verdict = self._rough_support_check(draft, chunks)
            supported = verdict in {"supported", "partial"}
            reason = "heuristic verifier fallback"

        if not supported:
            return {
                "verifier_supported": False,
                "verifier_status": "unsupported",
                "verifier_reason": reason,
                "answer": INSUFFICIENT_EVIDENCE,
                "confidence": min(float(state.get("confidence", 0.0)), 0.25),
                "disclaimer": DEFAULT_DISCLAIMER,
            }
        if verdict == "partial":
            cautious = (
                "Based on available policy evidence, this is a partial answer and should be confirmed with your insurer. "
                + (draft or INSUFFICIENT_EVIDENCE)
            )
            return {
                "verifier_supported": True,
                "verifier_status": "partial",
                "verifier_reason": reason,
                "answer": cautious,
                "confidence": min(float(state.get("confidence", 0.0)), 0.55),
                "disclaimer": DEFAULT_DISCLAIMER,
            }
        return {
            "verifier_supported": True,
            "verifier_status": "supported",
            "verifier_reason": reason,
            "answer": draft or INSUFFICIENT_EVIDENCE,
            "disclaimer": DEFAULT_DISCLAIMER,
        }

    def _node_finalize(self, state: ChatGraphState) -> ChatGraphState:
        route = state.get("route", "policy")
        verifier_supported = bool(state.get("verifier_supported", route == "smalltalk"))
        verifier_status = str(state.get("verifier_status", "supported" if verifier_supported else "unsupported"))
        verifier_reason = str(state.get("verifier_reason", "")).strip()
        evidence_strength = float(state.get("evidence_strength", 0.0))
        if evidence_strength >= 0.65:
            evidence_quality = "strong"
        elif evidence_strength >= 0.4:
            evidence_quality = "moderate"
        else:
            evidence_quality = "weak"

        reasoning = {
            "route": route,
            "route_reason": str(state.get("route_reason", "")).strip(),
            "verifier_status": verifier_status,
            "verifier_supported": verifier_supported,
            "verifier_reason": verifier_reason,
            "evidence_strength": round(max(0.0, min(1.0, evidence_strength)), 2),
            "evidence_quality": evidence_quality,
            "supporting_evidence_count": len(state.get("citations", [])),
        }
        customer_help = self._build_customer_help(
            question=state.get("question", ""),
            answer=state.get("answer", ""),
            chunks=state.get("chunks", []),
        )
        return {
            "answer": state.get("answer", INSUFFICIENT_EVIDENCE),
            "confidence": float(state.get("confidence", 0.0)),
            "disclaimer": state.get("disclaimer", DEFAULT_DISCLAIMER),
            "reasoning": reasoning,
            "evidence_cards": state.get("evidence_cards", []),
            "customer_help": customer_help,
        }

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        cleaned = (text or "").strip()
        if not cleaned:
            return {}
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}

    @staticmethod
    def _classify_intent(question: str) -> tuple[str, str]:
        q = (question or "").strip().lower()
        if not q:
            return "smalltalk", "empty_message"

        def has_term(term: str) -> bool:
            term = (term or "").strip().lower()
            if not term:
                return False
            if " " in term:
                return term in q
            return re.search(rf"\b{re.escape(term)}\b", q) is not None

        out_of_scope_terms = [
            "weather",
            "temperature",
            "sports",
            "stock",
            "bitcoin",
            "crypto",
            "recipe",
            "movie",
            "news",
            "travel",
            "flight",
            "restaurant",
            "cricket",
            "football",
            "nba",
            "nfl",
            "election",
            "politics",
            "code bug",
            "python error",
            "javascript",
            "math problem",
        ]
        if any(has_term(term) for term in out_of_scope_terms):
            return "out_of_scope", "non_policy_topic"

        glossary_terms = [
            "what is prior authorization",
            "what does prior authorization mean",
            "what is prior auth",
            "what does step therapy mean",
            "what is step therapy",
            "what is medical benefit",
            "what is pharmacy benefit",
            "what does formulary mean",
            "explain prior authorization",
            "explain step therapy",
            "define prior authorization",
            "define step therapy",
        ]
        if any(has_term(term) for term in glossary_terms):
            return "glossary", "term_explainer"

        policy_terms = [
            "coverage",
            "cover",
            "policy",
            "plan",
            "drug",
            "prior auth",
            "authorization",
            "step therapy",
            "medical benefit",
            "pharmacy benefit",
            "claim",
            "denial",
        ]
        if any(has_term(term) for term in policy_terms):
            return "policy", "policy_keywords"
        smalltalk_terms = [
            "hi",
            "hello",
            "hey",
            "how are you",
            "thanks",
            "thank you",
            "good morning",
            "good evening",
        ]
        if any(has_term(term) for term in smalltalk_terms) and len(q) <= 120:
            return "smalltalk", "greeting"
        return "out_of_scope", "scope_guard"

    @staticmethod
    def _build_retrieval_query(question: str, history: list[dict[str, str]]) -> str:
        q = (question or "").strip()
        if not q:
            return q
        follow_up_tokens = {"it", "that", "those", "this", "same", "they", "them"}
        q_tokens = set(re.findall(r"[a-zA-Z]{2,}", q.lower()))
        if not (q_tokens & follow_up_tokens):
            return q

        # Inject the last user mention for retrieval disambiguation on follow-ups.
        prior_user = ""
        for item in reversed(history or []):
            role = (item.get("role") or "").strip().lower()
            if role != "user":
                continue
            txt = (item.get("message_text") or item.get("text") or "").strip()
            if txt:
                prior_user = txt
                break
        if not prior_user:
            return q
        return f"{prior_user}\nFollow-up question: {q}"

    @staticmethod
    def _rough_support_check(answer: str, chunks: list[dict]) -> str:
        draft = (answer or "").strip().lower()
        if not draft or draft == INSUFFICIENT_EVIDENCE.lower():
            return "unsupported"
        evidence = " ".join((c.get("text") or "") for c in (chunks or [])).lower()
        if not evidence:
            return "unsupported"

        stop = {
            "the", "and", "for", "with", "that", "this", "from", "have", "has",
            "will", "been", "were", "are", "your", "you", "about", "into", "than",
            "their", "they", "them", "what", "when", "where", "which", "under",
        }
        tokens = []
        for token in re.findall(r"[a-z0-9][a-z0-9_-]{3,}", draft):
            if token in stop:
                continue
            if token not in tokens:
                tokens.append(token)
            if len(tokens) >= 24:
                break
        if not tokens:
            return "unsupported"

        hits = sum(1 for token in tokens if token in evidence)
        ratio = hits / max(1, len(tokens))
        if hits >= 5 and ratio >= 0.4:
            return "supported"
        if hits >= 4 and ratio >= 0.28:
            return "partial"
        return "unsupported"

    @staticmethod
    def _build_evidence_cards(chunks: list[dict], limit: int = 5) -> list[dict]:
        cards = []
        for idx, chunk in enumerate(chunks[:limit], start=1):
            cards.append(
                {
                    "source_index": idx,
                    "relevance": round(float(chunk.get("relevance", 0.0)), 3),
                    "payer_name": chunk.get("payer_name"),
                    "policy_title": chunk.get("policy_title"),
                    "section_title": chunk.get("section_title"),
                    "page_number": chunk.get("page_number"),
                    "policy_version_id": chunk.get("policy_version_id"),
                    "snippet": (chunk.get("text") or "")[:300],
                }
            )
        return cards

    @staticmethod
    def _build_customer_help(question: str, answer: str, chunks: list[dict]) -> dict[str, Any]:
        q = (question or "").strip()
        a = (answer or "").lower()
        policy = chunks[0].get("policy_title") if chunks else "the relevant policy"
        payer = chunks[0].get("payer_name") if chunks else "your insurer"

        next_best_questions: list[str] = []
        what_to_prepare: list[str] = [
            "Member ID and group number from your insurance card",
            "Drug/treatment name and diagnosis from your doctor",
            "Requested service date and provider/facility details",
        ]
        call_script: list[str] = [
            f"Hi, I want to verify coverage under {policy} with {payer}.",
            "Can you confirm coverage status, prior authorization, and step-therapy requirements?",
            "Please share the exact policy/version and effective date used for this decision.",
        ]

        if "insufficient evidence" in a:
            next_best_questions.extend(
                [
                    "Can you check this for my exact plan and member state?",
                    "What policy document should I ask my insurer for to confirm this?",
                    "What details do you still need to give me a confident answer?",
                ]
            )
        else:
            next_best_questions.extend(
                [
                    "What documents should my doctor submit first?",
                    "Are there quantity limits or step therapy requirements?",
                    "If denied, what exact appeal language should I use?",
                ]
            )

        if "prior auth" in a or "prior authorization" in a:
            what_to_prepare.append("Clinical notes, failed-therapy history, and prior-auth form")
            call_script.append("What is the prior authorization form and turnaround time?")
        if "step therapy" in a:
            what_to_prepare.append("List of previously tried medications and outcomes")
            call_script.append("What first-line therapies must be tried before approval?")
        if "not covered" in a or "denied" in a:
            call_script.append("If denied, what is the first-level appeal process and deadline?")
            what_to_prepare.append("Denial letter and appeal rights notice")

        if q:
            next_best_questions.append(f"Can you compare this with one alternative for: {q[:80]}?")

        dedup = lambda items: list(dict.fromkeys([i for i in items if i]))
        return {
            "next_best_questions": dedup(next_best_questions)[:5],
            "what_to_prepare": dedup(what_to_prepare)[:6],
            "call_script": dedup(call_script)[:5],
        }
