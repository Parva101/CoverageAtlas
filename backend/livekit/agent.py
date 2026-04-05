import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Annotated

import requests
from dotenv import load_dotenv
from pydantic import Field

from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    WorkerType,
    cli,
    function_tool,
)
from livekit.agents.voice import RunContext
from livekit.plugins import google

try:
    from agent_prompt import POLICY_SINGLE_AGENT_PROMPT, OPENING_INSTRUCTIONS
except ImportError:
    from backend.livekit.agent_prompt import POLICY_SINGLE_AGENT_PROMPT, OPENING_INSTRUCTIONS


ROOT_DIR = Path(__file__).resolve().parents[2]
ENV_PATH = os.environ.get("DOTENV_PATH", str(ROOT_DIR / ".env"))
load_dotenv(ENV_PATH, override=True)

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("policy_voice_agent")


@dataclass
class SessionState:
    participant_identity: str = "unknown"
    user_id: Optional[str] = None
    is_signed_in: bool = False
    is_registered: Optional[bool] = None
    default_payer_name: Optional[str] = None
    default_plan_name: Optional[str] = None
    default_plan_ids: list[str] = None
    default_drug_name: Optional[str] = None
    default_condition: Optional[str] = None
    default_effective_on: Optional[str] = None
    voice_session_id: Optional[str] = None

    def __post_init__(self) -> None:
        if self.default_plan_ids is None:
            self.default_plan_ids = []


RunContextT = RunContext[SessionState]


class PolicyAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=POLICY_SINGLE_AGENT_PROMPT)
        self._logger = logging.getLogger("policy_voice_agent.tools")
        self._api_base_url = os.environ.get("COVERAGE_API_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
        self._timeout_sec = float(os.environ.get("COVERAGE_API_TIMEOUT_SEC", "30"))
        self._service_bearer_token = os.environ.get("COVERAGE_API_BEARER_TOKEN", "").strip()

    def _ok(self, *, status: str, next_action: str, data: Optional[dict] = None) -> dict[str, Any]:
        return {
            "ok": True,
            "status": status,
            "next_action": next_action,
            "data": data or {},
            "error": None,
        }

    def _fail(
        self,
        *,
        status: str,
        next_action: str,
        code: str,
        message: str,
        retryable: bool = True,
    ) -> dict[str, Any]:
        return {
            "ok": False,
            "status": status,
            "next_action": next_action,
            "data": {},
            "error": {
                "code": code,
                "message": message,
                "retryable": retryable,
            },
        }

    def _resolve_state(self, context: Optional[RunContextT]) -> Optional[SessionState]:
        if context is not None:
            return context.userdata
        try:
            return self.session.userdata  # type: ignore[return-value]
        except Exception:
            return None

    @staticmethod
    def _profile_summary(state: SessionState) -> str:
        known_parts = []
        if state.default_payer_name:
            known_parts.append(f"payer={state.default_payer_name}")
        if state.default_plan_name:
            known_parts.append(f"plan={state.default_plan_name}")
        if state.default_plan_ids:
            known_parts.append(f"plan_ids={','.join(state.default_plan_ids)}")
        if state.default_drug_name:
            known_parts.append(f"drug={state.default_drug_name}")
        if state.default_condition:
            known_parts.append(f"condition={state.default_condition}")
        if state.default_effective_on:
            known_parts.append(f"effective_on={state.default_effective_on}")

        missing = []
        if not state.default_payer_name:
            missing.append("payer_name")
        if not state.default_plan_name and not state.default_plan_ids:
            missing.append("plan")
        if not state.default_drug_name:
            missing.append("drug_name")

        known_text = ", ".join(known_parts) if known_parts else "none"
        missing_text = ", ".join(missing) if missing else "none"
        return f"known={known_text}; missing={missing_text}"

    def _request_headers(self, bearer_token: Optional[str] = None) -> dict[str, str]:
        token = (bearer_token or "").strip() or self._service_bearer_token
        if not token:
            return {}
        return {"Authorization": f"Bearer {token}"}

    async def _post_json(
        self,
        path: str,
        payload: dict[str, Any],
        bearer_token: Optional[str] = None,
    ) -> dict[str, Any]:
        url = f"{self._api_base_url}{path}"
        headers = self._request_headers(bearer_token)

        def _request() -> dict[str, Any]:
            try:
                response = requests.post(url, json=payload, timeout=self._timeout_sec, headers=headers or None)
            except requests.RequestException as exc:
                return {"_http_status": None, "_transport_error": str(exc)}

            try:
                body = response.json()
            except ValueError:
                body = {"raw_text": response.text}

            if isinstance(body, dict):
                body["_http_status"] = response.status_code
                return body
            return {"_http_status": response.status_code, "result": body}

        return await asyncio.to_thread(_request)

    async def _get_json(
        self,
        path: str,
        params: Optional[dict[str, Any]] = None,
        bearer_token: Optional[str] = None,
    ) -> dict[str, Any]:
        url = f"{self._api_base_url}{path}"
        headers = self._request_headers(bearer_token)

        def _request() -> dict[str, Any]:
            try:
                response = requests.get(url, params=params, timeout=self._timeout_sec, headers=headers or None)
            except requests.RequestException as exc:
                return {"_http_status": None, "_transport_error": str(exc)}

            try:
                body = response.json()
            except ValueError:
                body = {"raw_text": response.text}

            if isinstance(body, dict):
                body["_http_status"] = response.status_code
                return body
            return {"_http_status": response.status_code, "result": body}

        return await asyncio.to_thread(_request)

    @staticmethod
    def _normalize_text(value: Optional[str]) -> str:
        return re.sub(r"\s+", " ", (value or "").strip().lower())

    async def _resolve_plan_filters(
        self,
        *,
        payer_name: Optional[str],
        plan_name: Optional[str],
    ) -> dict[str, list[str]]:
        normalized_payer = self._normalize_text(payer_name)
        normalized_plan = self._normalize_text(plan_name)
        if not normalized_payer and not normalized_plan:
            return {"plan_ids": [], "payer_ids": []}

        response = await self._get_json("/api/v1/metadata/plans")
        status_code = response.get("_http_status")
        if status_code is None or status_code >= 400:
            self._logger.warning(
                "Unable to resolve plan filters from metadata endpoint: %s",
                {
                    "status_code": status_code,
                    "error": response.get("error") or response.get("_transport_error"),
                },
            )
            return {"plan_ids": [], "payer_ids": []}

        plans = response.get("plans", [])
        if not isinstance(plans, list):
            return {"plan_ids": [], "payer_ids": []}

        matched_plan_ids: set[str] = set()
        matched_payer_ids: set[str] = set()

        for row in plans:
            if not isinstance(row, dict):
                continue
            plan_id = str(row.get("plan_id", "")).strip()
            payer_id = str(row.get("payer_id", "")).strip()
            row_plan = self._normalize_text(str(row.get("plan_name", "")))
            row_payer = self._normalize_text(str(row.get("payer_name", "")))

            payer_match = not normalized_payer or (
                normalized_payer in row_payer or row_payer in normalized_payer
            )
            plan_match = not normalized_plan or (
                normalized_plan in row_plan or row_plan in normalized_plan
            )

            if payer_match and plan_match:
                if plan_id:
                    matched_plan_ids.add(plan_id)
                if payer_id:
                    matched_payer_ids.add(payer_id)

        # If we only matched by payer and no specific plan could be found, keep payer scope.
        if not matched_plan_ids and normalized_payer:
            for row in plans:
                if not isinstance(row, dict):
                    continue
                payer_id = str(row.get("payer_id", "")).strip()
                row_payer = self._normalize_text(str(row.get("payer_name", "")))
                if payer_id and (normalized_payer in row_payer or row_payer in normalized_payer):
                    matched_payer_ids.add(payer_id)

        return {
            "plan_ids": sorted(matched_plan_ids),
            "payer_ids": sorted(matched_payer_ids),
        }

    async def _build_query_filters(
        self,
        *,
        state: Optional[SessionState],
        payer_name: Optional[str],
        plan_name: Optional[str],
        effective_on: Optional[str],
    ) -> dict[str, Any]:
        plan_ids: set[str] = set()
        payer_ids: set[str] = set()

        if state and state.default_plan_ids:
            plan_ids.update(v for v in state.default_plan_ids if isinstance(v, str) and v.strip())

        resolved = await self._resolve_plan_filters(
            payer_name=payer_name or (state.default_payer_name if state else None),
            plan_name=plan_name or (state.default_plan_name if state else None),
        )
        plan_ids.update(resolved.get("plan_ids", []))
        payer_ids.update(resolved.get("payer_ids", []))

        filters: dict[str, Any] = {}
        if plan_ids:
            filters["plan_ids"] = sorted(plan_ids)
        elif payer_ids:
            filters["payer_ids"] = sorted(payer_ids)

        clean_effective_on = (effective_on or "").strip()
        if clean_effective_on:
            filters["effective_on"] = clean_effective_on
        return filters

    async def _ensure_voice_session(self, state: Optional[SessionState]) -> Optional[str]:
        if state is None:
            return None
        if state.voice_session_id:
            return state.voice_session_id

        payload: dict[str, Any] = {}
        if state.user_id:
            payload["user_id"] = state.user_id

        response = await self._post_json("/api/v1/voice/session/start", payload)
        status_code = response.get("_http_status")
        if status_code is None or status_code >= 400:
            self._logger.warning(
                "Unable to start voice QA session, falling back to /query endpoint: %s",
                {
                    "status_code": status_code,
                    "error": response.get("error") or response.get("_transport_error"),
                },
            )
            return None

        session_id = str(response.get("session_id", "")).strip()
        if not session_id:
            self._logger.warning("Voice session start response missing session_id: %s", response)
            return None

        state.voice_session_id = session_id
        self._logger.info("Voice QA session started: %s", session_id)
        return session_id

    async def _post_voice_turn(
        self,
        *,
        state: Optional[SessionState],
        utterance: str,
        filters: dict[str, Any],
        top_k: int,
    ) -> dict[str, Any]:
        session_id = await self._ensure_voice_session(state)
        if not session_id:
            return {"_http_status": None, "_transport_error": "voice_session_unavailable"}

        payload: dict[str, Any] = {
            "utterance": utterance,
            "filters": filters or {},
            "retrieval": {"top_k": top_k, "hybrid": True},
        }
        response = await self._post_json(f"/api/v1/voice/session/{session_id}/turn", payload)
        status_code = response.get("_http_status")

        # session ownership/state can drift if backend restarted; re-open once then retry.
        if status_code in {403, 404} and state is not None:
            self._logger.warning(
                "Voice turn failed with session status %s, retrying with a new session.",
                status_code,
            )
            state.voice_session_id = None
            fresh_session_id = await self._ensure_voice_session(state)
            if fresh_session_id:
                response = await self._post_json(
                    f"/api/v1/voice/session/{fresh_session_id}/turn",
                    payload,
                )
        return response

    @function_tool()
    async def get_user_context(
        self,
        context: RunContextT = None,
    ) -> dict[str, Any]:
        state = self._resolve_state(context)
        if state is None:
            return self._fail(
                status="context_unavailable",
                next_action="ask_full_context",
                code="missing_session_state",
                message="Session context is unavailable.",
                retryable=False,
            )

        missing_fields = []
        if not state.default_payer_name:
            missing_fields.append("payer_name")
        if not state.default_plan_name and not state.default_plan_ids:
            missing_fields.append("plan_name_or_plan_ids")
        if not state.default_drug_name:
            missing_fields.append("drug_name")

        return self._ok(
            status="user_context_ready",
            next_action="use_known_context_or_ask_missing",
            data={
                "user_id": state.user_id,
                "is_signed_in": state.is_signed_in,
                "is_registered": state.is_registered,
                "known": {
                    "payer_name": state.default_payer_name,
                    "plan_name": state.default_plan_name,
                    "plan_ids": state.default_plan_ids,
                    "drug_name": state.default_drug_name,
                    "condition": state.default_condition,
                    "effective_on": state.default_effective_on,
                },
                "missing_fields": missing_fields,
            },
        )

    @function_tool()
    async def query_policy(
        self,
        question: Annotated[str, Field(description="User policy question in plain language")],
        payer_name: Annotated[Optional[str], Field(description="Optional payer name (e.g., Aetna)")] = None,
        plan_name: Annotated[Optional[str], Field(description="Optional plan name if known")] = None,
        drug_name: Annotated[Optional[str], Field(description="Optional drug name for targeting retrieval")] = None,
        condition: Annotated[Optional[str], Field(description="Optional condition/indication")] = None,
        effective_on: Annotated[Optional[str], Field(description="Optional date YYYY-MM-DD")] = None,
        top_k: Annotated[int, Field(description="Retrieval chunk count, 1-20")] = 8,
        context: RunContextT = None,
    ) -> dict[str, Any]:
        state = self._resolve_state(context)
        resolved_payer_name = (payer_name or "").strip() or (state.default_payer_name if state else None)
        resolved_plan_name = (plan_name or "").strip() or (state.default_plan_name if state else None)
        resolved_drug_name = (drug_name or "").strip() or (state.default_drug_name if state else None)
        resolved_condition = (condition or "").strip() or (state.default_condition if state else None)
        resolved_effective_on = (effective_on or "").strip() or (state.default_effective_on if state else None)

        clean_question = (question or "").strip()
        if not clean_question:
            return self._fail(
                status="query_validation_failed",
                next_action="ask_question",
                code="missing_question",
                message="Question is required.",
                retryable=False,
            )

        if state:
            if resolved_payer_name:
                state.default_payer_name = resolved_payer_name
            if resolved_plan_name:
                state.default_plan_name = resolved_plan_name
            if resolved_drug_name:
                state.default_drug_name = resolved_drug_name
            if resolved_condition:
                state.default_condition = resolved_condition
            if resolved_effective_on:
                state.default_effective_on = resolved_effective_on

        filters = await self._build_query_filters(
            state=state,
            payer_name=resolved_payer_name,
            plan_name=resolved_plan_name,
            effective_on=resolved_effective_on,
        )

        hints = []
        if resolved_payer_name:
            hints.append(f"payer={resolved_payer_name}")
        if resolved_plan_name:
            hints.append(f"plan={resolved_plan_name}")
        if resolved_drug_name:
            hints.append(f"drug={resolved_drug_name}")
        if resolved_condition:
            hints.append(f"condition={resolved_condition}")

        # Keep the spoken question natural; only append context hints when structured filters are not available.
        query_text = clean_question
        if hints and not (filters.get("plan_ids") or filters.get("payer_ids")):
            query_text = clean_question + "\n\nCaller context hints: " + ", ".join(hints)

        safe_top_k = max(1, min(int(top_k), 20))

        self._logger.info(
            "query_policy input=%s",
            {
                "question": clean_question,
                "payer_name": resolved_payer_name,
                "plan_name": resolved_plan_name,
                "drug_name": resolved_drug_name,
                "condition": resolved_condition,
                "effective_on": resolved_effective_on,
                "filters": filters,
                "top_k": safe_top_k,
            },
        )

        response = await self._post_voice_turn(
            state=state,
            utterance=query_text,
            filters=filters,
            top_k=safe_top_k,
        )
        status_code = response.get("_http_status")

        # Fallback path when voice-session endpoints are unavailable.
        if status_code is None or status_code >= 400:
            payload: dict[str, Any] = {
                "question": query_text,
                "retrieval": {"top_k": safe_top_k, "hybrid": True},
                "filters": filters,
            }
            response = await self._post_json("/api/v1/query", payload)
            status_code = response.get("_http_status")

        if status_code is None:
            return self._fail(
                status="query_unavailable",
                next_action="retry_or_collect_details",
                code="transport_error",
                message=response.get("_transport_error", "Unable to reach policy API."),
                retryable=True,
            )

        if status_code >= 400:
            return self._fail(
                status="query_failed",
                next_action="retry_or_collect_details",
                code="api_error",
                message=str(response.get("error", response.get("raw_text", "Query API returned an error."))),
                retryable=True,
            )

        missing_labels = response.get("missing_profile_field_labels") or response.get("missing_profile_fields") or []
        needs_profile = bool(response.get("needs_profile_completion"))
        if needs_profile:
            return self._ok(
                status="profile_incomplete",
                next_action="ask_missing_profile_fields",
                data={
                    "answer": response.get("answer"),
                    "missing_profile_fields": response.get("missing_profile_fields", []),
                    "missing_profile_field_labels": missing_labels,
                    "profile_completion_url": response.get("profile_completion_url", "/profile"),
                    "profile_snapshot": response.get("profile_snapshot", {}),
                },
            )

        answer = response.get("answer")
        if not answer:
            return self._fail(
                status="query_failed",
                next_action="retry_or_collect_details",
                code="missing_answer",
                message="Policy API returned no answer.",
                retryable=True,
            )

        return self._ok(
            status="query_answered",
            next_action="answer_user",
            data={
                "answer": answer,
                "confidence": response.get("confidence"),
                "citations": response.get("citations", []),
                "retrieval_trace": response.get("retrieval_trace", {}),
                "disclaimer": response.get("disclaimer"),
                "reasoning": response.get("reasoning", {}),
                "evidence_cards": response.get("evidence_cards", []),
                "customer_help": response.get("customer_help", {}),
                "needs_profile_completion": response.get("needs_profile_completion", False),
                "profile_snapshot": response.get("profile_snapshot", {}),
            },
        )

    @function_tool()
    async def compare_drug_across_plans(
        self,
        drug_name: Annotated[Optional[str], Field(description="Drug name to compare across plans")] = None,
        plan_ids_csv: Annotated[Optional[str], Field(description="Comma-separated plan UUIDs")] = None,
        effective_on: Annotated[Optional[str], Field(description="Optional date YYYY-MM-DD")] = None,
        context: RunContextT = None,
    ) -> dict[str, Any]:
        state = self._resolve_state(context)
        clean_drug = (drug_name or "").strip() or (state.default_drug_name if state else None)
        if not clean_drug:
            return self._fail(
                status="compare_validation_failed",
                next_action="ask_drug_name",
                code="missing_drug_name",
                message="Drug name is required for compare.",
                retryable=False,
            )

        plan_ids = [value.strip() for value in (plan_ids_csv or "").split(",") if value.strip()]
        if not plan_ids and state and state.default_plan_ids:
            plan_ids = [value.strip() for value in state.default_plan_ids if value.strip()]
        if not plan_ids:
            return self._fail(
                status="compare_missing_plan_ids",
                next_action="ask_plan_ids",
                code="missing_plan_ids",
                message="Plan IDs are required for compare endpoint.",
                retryable=False,
            )

        payload: dict[str, Any] = {
            "drug_name": clean_drug,
            "plan_ids": plan_ids,
        }
        resolved_effective_on = (effective_on or "").strip() or (state.default_effective_on if state else None)
        if resolved_effective_on:
            payload["effective_on"] = resolved_effective_on

        self._logger.info("compare_drug_across_plans input=%s", payload)

        response = await self._post_json("/api/v1/compare", payload)
        status_code = response.get("_http_status")

        if status_code is None:
            return self._fail(
                status="compare_unavailable",
                next_action="retry_or_collect_details",
                code="transport_error",
                message=response.get("_transport_error", "Unable to reach compare API."),
                retryable=True,
            )

        if status_code >= 400:
            return self._fail(
                status="compare_failed",
                next_action="retry_or_collect_details",
                code="api_error",
                message=str(response.get("error", response.get("raw_text", "Compare API returned an error."))),
                retryable=True,
            )

        return self._ok(
            status="compare_completed",
            next_action="summarize_comparison",
            data={
                "drug_name": response.get("drug_name", clean_drug),
                "rows": response.get("rows", []),
            },
        )

    @function_tool()
    async def get_policy_changes(
        self,
        policy_id: Annotated[str, Field(description="Policy UUID")],
        from_version: Annotated[str, Field(description="From version label or UUID")],
        to_version: Annotated[str, Field(description="To version label or UUID")],
        context: RunContextT = None,
    ) -> dict[str, Any]:
        policy_id = (policy_id or "").strip()
        from_version = (from_version or "").strip()
        to_version = (to_version or "").strip()

        if not policy_id or not from_version or not to_version:
            return self._fail(
                status="changes_validation_failed",
                next_action="collect_policy_change_params",
                code="missing_required_fields",
                message="policy_id, from_version, and to_version are all required.",
                retryable=False,
            )

        state = self._resolve_state(context)
        response = await self._get_json(
            f"/api/v1/policies/{policy_id}/changes",
            params={"from": from_version, "to": to_version},
        )
        status_code = response.get("_http_status")

        if status_code is None:
            return self._fail(
                status="changes_unavailable",
                next_action="retry_or_collect_details",
                code="transport_error",
                message=response.get("_transport_error", "Unable to reach policy-changes API."),
                retryable=True,
            )

        if status_code >= 400:
            return self._fail(
                status="changes_failed",
                next_action="retry_or_collect_details",
                code="api_error",
                message=str(response.get("error", response.get("raw_text", "Policy changes API returned an error."))),
                retryable=True,
            )

        return self._ok(
            status="changes_completed",
            next_action="summarize_changes",
            data={
                "policy_id": response.get("policy_id", policy_id),
                "from_version": response.get("from_version", from_version),
                "to_version": response.get("to_version", to_version),
                "changes": response.get("changes", []),
            },
        )

    async def on_enter(self) -> None:
        state = self._resolve_state(None)
        profile_context = ""
        if state:
            profile_context = self._profile_summary(state)
            await self._ensure_voice_session(state)

        if state and state.is_signed_in:
            if state.is_registered is False:
                runtime_instruction = (
                    "Caller is signed in but not registered. Ask for all required details explicitly: "
                    "drug name, payer, plan, indication if relevant, and effective date if date-sensitive."
                )
            else:
                runtime_instruction = (
                    "Caller is signed in. Reuse known profile values first and only ask for missing fields."
                )
        else:
            runtime_instruction = (
                "Caller is not signed in. Collect all required details from the caller."
            )

        instruction = (
            f"{OPENING_INSTRUCTIONS} "
            f"Runtime profile context: {profile_context}. "
            f"{runtime_instruction}"
        )

        self.session.generate_reply(
            instructions=instruction,
            allow_interruptions=True,
        )


def _safe_json_loads(raw_value: Optional[str]) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        parsed = json.loads(raw_value)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _first_nonempty(*values: Any) -> Optional[str]:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            clean = value.strip()
            if clean:
                return clean
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _as_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    return None


def _extract_context_from_metadata(
    room_meta: dict[str, Any],
    participant_meta: dict[str, Any],
) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    merged.update(room_meta if isinstance(room_meta, dict) else {})
    merged.update(participant_meta if isinstance(participant_meta, dict) else {})

    user_data = merged.get("user", {}) if isinstance(merged.get("user"), dict) else {}
    insurance_data = merged.get("insurance", {}) if isinstance(merged.get("insurance"), dict) else {}
    plan_data = insurance_data.get("plan", {}) if isinstance(insurance_data.get("plan"), dict) else {}

    user_id = _first_nonempty(
        user_data.get("id"),
        merged.get("user_id"),
        merged.get("sub"),
    )
    is_signed_in = _as_bool(
        user_data.get("signed_in")
        or user_data.get("is_authenticated")
        or merged.get("signed_in")
        or merged.get("is_authenticated")
    )
    is_registered = _as_bool(
        user_data.get("is_registered")
        or merged.get("is_registered")
        or merged.get("registered")
    )

    payer_name = _first_nonempty(
        insurance_data.get("payer_name"),
        insurance_data.get("payer"),
        merged.get("payer_name"),
        merged.get("payer"),
    )
    plan_name = _first_nonempty(
        plan_data.get("name"),
        insurance_data.get("plan_name"),
        merged.get("plan_name"),
    )
    plan_id = _first_nonempty(
        plan_data.get("id"),
        insurance_data.get("plan_id"),
        merged.get("plan_id"),
    )
    plan_ids = merged.get("plan_ids")
    if not isinstance(plan_ids, list):
        plan_ids = insurance_data.get("plan_ids")
    if not isinstance(plan_ids, list):
        plan_ids = user_data.get("plan_ids")
    if not isinstance(plan_ids, list):
        plan_ids = []
    normalized_plan_ids = [str(v).strip() for v in plan_ids if str(v).strip()]
    if plan_id and plan_id not in normalized_plan_ids:
        normalized_plan_ids.insert(0, plan_id)

    return {
        "user_id": user_id,
        "is_signed_in": bool(is_signed_in) if is_signed_in is not None else bool(user_id),
        "is_registered": is_registered,
        "payer_name": payer_name,
        "plan_name": plan_name,
        "plan_ids": normalized_plan_ids,
        "drug_name": _first_nonempty(merged.get("drug_name")),
        "condition": _first_nonempty(merged.get("condition")),
        "effective_on": _first_nonempty(merged.get("effective_on")),
    }


async def entrypoint(ctx: JobContext) -> None:
    session: Optional[AgentSession] = None

    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        participant = await ctx.wait_for_participant()

        room_metadata = _safe_json_loads(getattr(ctx.room, "metadata", ""))
        participant_metadata = _safe_json_loads(getattr(participant, "metadata", ""))
        runtime_context = _extract_context_from_metadata(room_metadata, participant_metadata)

        state = SessionState(
            participant_identity=participant.identity or "unknown",
            user_id=runtime_context["user_id"],
            is_signed_in=runtime_context["is_signed_in"],
            is_registered=runtime_context["is_registered"],
            default_payer_name=runtime_context["payer_name"],
            default_plan_name=runtime_context["plan_name"],
            default_plan_ids=runtime_context["plan_ids"],
            default_drug_name=runtime_context["drug_name"],
            default_condition=runtime_context["condition"],
            default_effective_on=runtime_context["effective_on"],
        )

        logger.info(
            "Runtime user context loaded: %s",
            {
                "user_id": state.user_id,
                "is_signed_in": state.is_signed_in,
                "is_registered": state.is_registered,
                "default_payer_name": state.default_payer_name,
                "default_plan_name": state.default_plan_name,
                "default_plan_ids_count": len(state.default_plan_ids),
                "default_drug_name": state.default_drug_name,
                "default_condition": state.default_condition,
                "default_effective_on": state.default_effective_on,
            },
        )

        realtime_model_kwargs = {
            "voice": os.environ.get("GOOGLE_REALTIME_VOICE", "Puck"),
            "model": os.environ.get("GOOGLE_REALTIME_MODEL", "gemini-live-2.5-flash-native-audio"),
            "temperature": float(os.environ.get("GOOGLE_REALTIME_TEMPERATURE", "0.5")),
        }

        use_vertexai = os.environ.get("GOOGLE_REALTIME_VERTEXAI", "1").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        realtime_model_kwargs["vertexai"] = use_vertexai

        google_cloud_project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
        if google_cloud_project:
            realtime_model_kwargs["project"] = google_cloud_project

        google_cloud_location = os.environ.get("GOOGLE_CLOUD_LOCATION", "").strip()
        if google_cloud_location:
            realtime_model_kwargs["location"] = google_cloud_location

        session = AgentSession(
            userdata=state,
            llm=google.realtime.RealtimeModel(**realtime_model_kwargs),
            max_tool_steps=int(os.environ.get("VOICE_MAX_TOOL_STEPS", "4")),
        )

        await session.start(agent=PolicyAgent(), room=ctx.room)

        caller_disconnected = asyncio.Event()

        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(disconnected_participant) -> None:
            if disconnected_participant.identity == state.participant_identity:
                caller_disconnected.set()

        if not any(
            remote_participant.identity == state.participant_identity
            for remote_participant in ctx.room.remote_participants.values()
        ):
            caller_disconnected.set()

        await caller_disconnected.wait()

    except Exception:
        logger.exception("Policy agent failed")
        raise
    finally:
        if session:
            await session.aclose()


if __name__ == "__main__":
    opts = WorkerOptions(
        entrypoint_fnc=entrypoint,
        worker_type=WorkerType.ROOM,
        agent_name=os.environ.get("AGENT_NAME", "Policy_Agent"),
        initialize_process_timeout=60,
    )
    cli.run_app(opts)
