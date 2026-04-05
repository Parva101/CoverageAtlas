import hashlib
import json
import os
import subprocess
import sys
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import db as db_layer
import extraction_agent
import ai_provider
from backend.app.auth import AuthClaims, extract_scopes, is_auth_enabled, require_admin_auth, require_auth0_token
from backend.app.source_refresh import run_refresh
try:
    import qdrant_setup as qdrant_layer
except ImportError:
    qdrant_layer = None


API_PREFIX = "/api/v1"
UPLOAD_DIR = ROOT_DIR / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "768"))
QA_MODEL = os.environ.get("QA_MODEL", "gemini-2.5-flash")
QA_TEMPERATURE = float(os.environ.get("QA_TEMPERATURE", "0.2"))
QA_MAX_OUTPUT_TOKENS = int(os.environ.get("QA_MAX_OUTPUT_TOKENS", "2048"))
REQUIRED_PROFILE_FIELDS = tuple(
    field.strip()
    for field in os.environ.get(
        "CHATBOT_REQUIRED_PROFILE_FIELDS",
        "full_name,date_of_birth,state,member_id,primary_plan_id",
    ).split(",")
    if field.strip()
)

SOURCE_SCAN_RUNS: dict[str, dict[str, Any]] = {}

DEMO_CHAT_QUESTIONS = [
    "Does my plan cover rituximab for rheumatoid arthritis, and what are the criteria?",
    "What prior authorization requirements apply to my treatment and what documents are needed?",
    "What changed in my payer policy this quarter for my drug under medical benefit?",
    "Compare policy requirements for this drug across two payers and explain the differences.",
]


class QueryFilters(BaseModel):
    payer_ids: list[str] = Field(default_factory=list)
    plan_ids: list[str] = Field(default_factory=list)
    policy_categories: list[str] = Field(default_factory=list)
    version_labels: list[str] = Field(default_factory=list)
    coverage_statuses: list[str] = Field(default_factory=list)
    policy_version_ids: list[str] = Field(default_factory=list)
    effective_on: Optional[str] = None


class RetrievalOptions(BaseModel):
    top_k: int = 8
    hybrid: bool = True


class QueryRequest(BaseModel):
    question: str
    filters: QueryFilters = Field(default_factory=QueryFilters)
    retrieval: RetrievalOptions = Field(default_factory=RetrievalOptions)


class CompareRequest(BaseModel):
    drug_name: str
    plan_ids: list[str]
    effective_on: Optional[str] = None


class SourceScanRequest(BaseModel):
    source_group: str = "default"


class SourceRegistryUpsertRequest(BaseModel):
    source_key: str
    display_name: str
    entry_url: str
    adapter_name: str = "html_index_links"
    source_group: str = "default"
    payer_id: Optional[str] = None
    source_type: str = "html_index"
    enabled: bool = True
    refresh_interval_hours: int = 24
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceRefreshRequest(BaseModel):
    source_group: str = "default"
    source_keys: list[str] = Field(default_factory=list)
    limit_per_source: int = 2
    dry_run: bool = True
    fetch_enabled: bool = False
    ingestion_enabled: bool = False


class VoiceStartRequest(BaseModel):
    user_id: Optional[str] = None


class VoiceTurnRequest(BaseModel):
    utterance: str
    filters: QueryFilters = Field(default_factory=QueryFilters)
    retrieval: RetrievalOptions = Field(default_factory=RetrievalOptions)


class VoiceEndRequest(BaseModel):
    summary: Optional[str] = None


class ProfileUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    state: Optional[str] = None
    member_id: Optional[str] = None
    preferred_language: Optional[str] = None
    preferred_channel: Optional[str] = None
    primary_plan_id: Optional[str] = None
    chronic_conditions: list[str] = Field(default_factory=list)
    medications: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


def error_response(status_code: int, code: str, message: str, details: Optional[dict] = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            }
        },
    )


def parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def normalize_json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed
        except json.JSONDecodeError:
            return default
    return default


def iso_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def effective_date_passes(row_effective_date: Any, requested_effective_on: Optional[str]) -> bool:
    if not requested_effective_on:
        return True
    target = parse_iso_date(requested_effective_on)
    if target is None:
        return True
    if row_effective_date is None:
        return True
    if isinstance(row_effective_date, date):
        row_date = row_effective_date
    else:
        row_date = parse_iso_date(str(row_effective_date))
    if row_date is None:
        return True
    return row_date <= target


def _version_label(effective_date_value: Optional[str]) -> str:
    if effective_date_value:
        return f"v{effective_date_value}"
    return f"v{date.today().isoformat()}"


def _embedding(question: str) -> list[float]:
    use_output_dim = EMBED_MODEL.startswith("gemini-embedding-")
    return ai_provider.embed_query(
        question,
        model=EMBED_MODEL,
        output_dimensionality=EMBEDDING_DIM if use_output_dim else None,
    )


def _dedupe_nonempty(values: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        normalized = str(value).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _qdrant_status() -> dict[str, Any]:
    status = {
        "reachable": False,
        "collection": os.environ.get("QDRANT_COLLECTION", "policy_chunks"),
        "points_count": 0,
    }
    if qdrant_layer is None:
        status["error"] = "qdrant client not available"
        return status

    try:
        client = qdrant_layer.get_client()
        count = client.count(
            collection_name=status["collection"],
            exact=True,
        )
        status["reachable"] = True
        status["points_count"] = int(getattr(count, "count", 0) or 0)
        return status
    except Exception as exc:
        status["error"] = str(exc)
        return status


def _compact_drug_name(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""
    # Prefer bracketed brand/generic alias e.g. "... [Invega]".
    if "[" in value and "]" in value:
        inner = value.split("[")[-1].split("]")[0].strip()
        if inner:
            return inner
    # Keep reasonably short names for UI prompts.
    if len(value) <= 80:
        return value
    return value[:77].rstrip() + "..."


def _build_live_chat_questions(
    payers: list[str],
    drugs: list[str],
    policies: list[str],
) -> list[str]:
    questions: list[str] = []

    if payers and drugs:
        questions.append(
            f"Does {payers[0]} cover {drugs[0]} under medical benefit, and what criteria are required?"
        )
    if len(payers) >= 2 and drugs:
        questions.append(
            f"Compare {drugs[0]} policy requirements between {payers[0]} and {payers[1]}, including prior auth and step therapy."
        )
    if policies:
        questions.append(
            f'Summarize key criteria in "{policies[0]}" in plain language.'
        )
    if payers:
        questions.append(
            f"What changed recently in {payers[0]} policy updates that could affect approvals?"
        )
    if drugs:
        questions.append(
            f"For {drugs[0]}, what documentation is usually required before approval?"
        )

    # Keep unique, non-empty, ordered.
    deduped = _dedupe_nonempty(questions)
    return deduped[:6]


def _resolve_retrieval_scope(filters: QueryFilters) -> dict[str, Any]:
    input_payer_ids = set(_dedupe_nonempty(filters.payer_ids))
    payer_ids = set(input_payer_ids)
    plan_ids = _dedupe_nonempty(filters.plan_ids)
    policy_categories = _dedupe_nonempty(filters.policy_categories)
    version_labels = _dedupe_nonempty(filters.version_labels)
    coverage_statuses = _dedupe_nonempty(filters.coverage_statuses)
    explicit_version_ids = _dedupe_nonempty(filters.policy_version_ids)
    effective_on_date = parse_iso_date(filters.effective_on)

    with db_layer.get_conn() as conn:
        resolved_plans_count = 0
        if plan_ids:
            resolved_plans = db_layer.list_plans_by_ids(conn, plan_ids)
            resolved_plans_count = len(resolved_plans)
            for plan in resolved_plans:
                payer_ids.add(str(plan["payer_id"]))

            # Fallback for "virtual plan ids" (metadata fallback mode):
            # when plans table is empty, frontend uses payer IDs as plan IDs.
            if resolved_plans_count == 0:
                payer_rows = db_layer.fetchall(
                    conn,
                    "SELECT id, name FROM payers WHERE id::text = ANY(%s)",
                    (plan_ids,),
                )
                if payer_rows:
                    resolved_plans_count = len(payer_rows)
                    for row in payer_rows:
                        payer_ids.add(str(row["id"]))

        if plan_ids and resolved_plans_count == 0 and not input_payer_ids:
            return {
                "plan_ids": plan_ids,
                "payer_ids": [],
                "payer_names": [],
                "policy_categories": policy_categories,
                "version_labels": version_labels,
                "coverage_statuses": coverage_statuses,
                "policy_version_ids": [],
                "effective_on": effective_on_date.isoformat() if effective_on_date else filters.effective_on,
                "resolved_versions_count": 0,
            }

        where_clauses = ["1=1"]
        params: list[Any] = []

        if explicit_version_ids:
            where_clauses.append("pv.id::text = ANY(%s)")
            params.append(explicit_version_ids)
        if payer_ids:
            where_clauses.append("pol.payer_id::text = ANY(%s)")
            params.append(sorted(payer_ids))
        if policy_categories:
            where_clauses.append("pol.policy_category = ANY(%s)")
            params.append(policy_categories)
        if version_labels:
            where_clauses.append("pv.version_label = ANY(%s)")
            params.append(version_labels)

        base_where = " AND ".join(where_clauses)

        if effective_on_date and not explicit_version_ids:
            sql = f"""
                WITH filtered AS (
                    SELECT
                        pv.id::text AS policy_version_id,
                        pv.policy_id::text AS policy_id,
                        pv.version_label,
                        pv.effective_date,
                        pol.payer_id::text AS payer_id,
                        p.name AS payer_name,
                        pol.policy_category,
                        ROW_NUMBER() OVER (
                            PARTITION BY pv.policy_id
                            ORDER BY pv.effective_date DESC NULLS LAST, pv.created_at DESC
                        ) AS rn
                    FROM policy_versions pv
                    JOIN policies pol ON pv.policy_id = pol.id
                    JOIN payers p ON pol.payer_id = p.id
                    WHERE {base_where}
                      AND (pv.effective_date IS NULL OR pv.effective_date <= %s)
                )
                SELECT
                    policy_version_id,
                    policy_id,
                    version_label,
                    effective_date,
                    payer_id,
                    payer_name,
                    policy_category
                FROM filtered
                WHERE rn = 1
            """
            rows = db_layer.fetchall(conn, sql, (*params, effective_on_date))
        else:
            default_current_only = not effective_on_date and not explicit_version_ids and not version_labels
            current_clause = " AND pv.is_current = TRUE" if default_current_only else ""
            effective_clause = ""
            final_params: tuple[Any, ...]
            if effective_on_date:
                effective_clause = " AND (pv.effective_date IS NULL OR pv.effective_date <= %s)"
                final_params = (*params, effective_on_date)
            else:
                final_params = tuple(params)

            sql = f"""
                SELECT
                    pv.id::text AS policy_version_id,
                    pv.policy_id::text AS policy_id,
                    pv.version_label,
                    pv.effective_date,
                    pol.payer_id::text AS payer_id,
                    p.name AS payer_name,
                    pol.policy_category
                FROM policy_versions pv
                JOIN policies pol ON pv.policy_id = pol.id
                JOIN payers p ON pol.payer_id = p.id
                WHERE {base_where}
                {current_clause}
                {effective_clause}
                ORDER BY pv.effective_date DESC NULLS LAST, pv.created_at DESC
            """
            rows = db_layer.fetchall(conn, sql, final_params)

    version_ids = _dedupe_nonempty([str(r["policy_version_id"]) for r in rows if r.get("policy_version_id")])
    payer_names = _dedupe_nonempty([str(r["payer_name"]) for r in rows if r.get("payer_name")])
    resolved_categories = _dedupe_nonempty([str(r["policy_category"]) for r in rows if r.get("policy_category")])

    return {
        "plan_ids": plan_ids,
        "payer_ids": sorted(payer_ids),
        "payer_names": payer_names,
        "policy_categories": policy_categories or resolved_categories,
        "version_labels": version_labels,
        "coverage_statuses": coverage_statuses,
        "policy_version_ids": version_ids,
        "effective_on": effective_on_date.isoformat() if effective_on_date else filters.effective_on,
        "resolved_versions_count": len(version_ids),
    }


def retrieve_chunks(question: str, filters: QueryFilters, top_k: int) -> tuple[list[dict], dict[str, Any]]:
    if qdrant_layer is None:
        raise RuntimeError("qdrant_client is not installed")

    scope = _resolve_retrieval_scope(filters)
    if not scope["policy_version_ids"]:
        return [], scope

    client = qdrant_layer.get_client()
    query_vector = _embedding(question)

    merged = qdrant_layer.search(
        client=client,
        query_vector=query_vector,
        top_k=max(top_k, 30),
        payer_filters=scope["payer_names"],
        policy_category_filters=scope["policy_categories"],
        version_label_filters=scope["version_labels"],
        coverage_status_filters=scope["coverage_statuses"],
        policy_version_ids=scope["policy_version_ids"],
    )

    dedup: dict[tuple[str, int], dict] = {}
    for row in merged:
        key = (str(row.get("policy_version_id", "")), int(row.get("chunk_index", 0)))
        existing = dedup.get(key)
        if existing is None or row.get("relevance", 0) > existing.get("relevance", 0):
            dedup[key] = row

    rows = sorted(dedup.values(), key=lambda r: r.get("relevance", 0), reverse=True)
    if filters.effective_on:
        rows = [r for r in rows if effective_date_passes(r.get("effective_date"), filters.effective_on)]
    return rows[:top_k], scope


def build_citations(chunks: list[dict]) -> list[dict]:
    version_ids = list({c.get("policy_version_id") for c in chunks if c.get("policy_version_id")})
    version_to_doc: dict[str, Optional[str]] = {}

    if version_ids:
        with db_layer.get_conn() as conn:
            rows = db_layer.fetchall(
                conn,
                "SELECT id, document_id FROM policy_versions WHERE id = ANY(%s::uuid[])",
                (version_ids,),
            )
            for row in rows:
                version_to_doc[str(row["id"])] = str(row["document_id"]) if row["document_id"] else None

    citations: list[dict] = []
    seen: set[tuple] = set()
    for chunk in chunks:
        version_id = str(chunk.get("policy_version_id", ""))
        citation = {
            "document_id": version_to_doc.get(version_id),
            "page": chunk.get("page_number"),
            "section": chunk.get("section_title"),
            "snippet": (chunk.get("text") or "")[:240],
        }
        key = (citation["document_id"], citation["page"], citation["section"], citation["snippet"])
        if key not in seen:
            seen.add(key)
            citations.append(citation)
    return citations


def build_answer(
    question: str,
    chunks: list[dict],
    citations: list[dict],
    profile_context: Optional[str] = None,
) -> tuple[str, float]:
    if not chunks:
        return "Insufficient evidence to answer based on available policy sources.", 0.0

    context_blocks = []
    for idx, chunk in enumerate(chunks, start=1):
        context_blocks.append(
            f"[SOURCE {idx}] payer={chunk.get('payer_name')} "
            f"policy={chunk.get('policy_title')} section={chunk.get('section_title')} "
            f"page={chunk.get('page_number')}\n{chunk.get('text', '')}"
        )
    context = "\n\n".join(context_blocks)

    prompt = (
        "You are a policy assistant. Answer ONLY from evidence.\n"
        "If evidence is weak, say insufficient evidence.\n"
        "Keep answer concise and plain-language.\n\n"
        f"Patient profile context (if provided): {profile_context or 'not provided'}\n\n"
        f"Question: {question}\n\n"
        f"Evidence:\n{context}\n"
    )

    text = ai_provider.generate_text(
        prompt,
        model=QA_MODEL,
        temperature=QA_TEMPERATURE,
        max_output_tokens=QA_MAX_OUTPUT_TOKENS,
    ).strip() or "Insufficient evidence to answer from retrieved policy text."

    avg_relevance = sum(c.get("relevance", 0) for c in chunks) / max(1, len(chunks))
    citation_factor = min(1.0, len(citations) / 4.0)
    confidence = max(0.0, min(0.99, round((avg_relevance * 0.75) + (citation_factor * 0.25), 2)))
    return text, confidence


def _resolve_request_user_id(claims: AuthClaims, fallback: Optional[str] = None) -> str:
    sub = str(claims.get("sub", "")).strip()
    if sub:
        return sub
    return str(fallback or "anonymous")


def _is_missing_profile_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) == 0
    return False


def _merge_claims_into_profile(profile: Optional[dict], claims: AuthClaims, user_id: str) -> dict[str, Any]:
    merged = dict(profile or {})
    merged["user_id"] = user_id
    if _is_missing_profile_value(merged.get("full_name")) and claims.get("name"):
        merged["full_name"] = str(claims.get("name"))
    if _is_missing_profile_value(merged.get("email")) and claims.get("email"):
        merged["email"] = str(claims.get("email"))
    return merged


def _profile_field_label(field: str) -> str:
    labels = {
        "full_name": "full name",
        "email": "email",
        "phone": "phone",
        "date_of_birth": "date of birth",
        "state": "state",
        "member_id": "member ID",
        "preferred_language": "preferred language",
        "preferred_channel": "preferred channel",
        "primary_plan_id": "primary plan",
        "chronic_conditions": "chronic conditions",
        "medications": "medications",
        "notes": "notes",
    }
    return labels.get(field, field.replace("_", " "))


def _required_profile_fields_for_question(question: str) -> list[str]:
    q = (question or "").strip().lower()
    required = list(REQUIRED_PROFILE_FIELDS)

    # Require condition context for diagnosis-driven questions.
    if any(token in q for token in ("condition", "diagnosis", "diagnoses", "for my disease", "for my case")):
        if "chronic_conditions" not in required:
            required.append("chronic_conditions")
    return required


def _missing_profile_fields(profile: dict[str, Any], question: str) -> list[str]:
    required = _required_profile_fields_for_question(question)
    missing: list[str] = []
    for field in required:
        if _is_missing_profile_value(profile.get(field)):
            missing.append(field)
    return missing


def _profile_summary_payload(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "full_name": profile.get("full_name"),
        "email": profile.get("email"),
        "phone": profile.get("phone"),
        "date_of_birth": profile.get("date_of_birth"),
        "state": profile.get("state"),
        "member_id": profile.get("member_id"),
        "primary_plan_id": profile.get("primary_plan_id"),
        "chronic_conditions": profile.get("chronic_conditions") or [],
        "medications": profile.get("medications") or [],
    }


def _profile_gate_response(missing_fields: list[str], profile: dict[str, Any], user_id: str) -> dict[str, Any]:
    labels = [_profile_field_label(field) for field in missing_fields]
    if len(labels) == 1:
        fields_sentence = labels[0]
    elif len(labels) == 2:
        fields_sentence = f"{labels[0]} and {labels[1]}"
    else:
        fields_sentence = f"{', '.join(labels[:-1])}, and {labels[-1]}"

    answer = (
        "Before I can give a policy answer for your exact case, I need a complete patient profile. "
        f"Please provide {fields_sentence}. "
        "You can update these in My Profile, then ask your question again."
    )
    return {
        "answer": answer,
        "confidence": 0.0,
        "citations": [],
        "retrieval_trace": {
            "chunks_used": 0,
            "vector_store": "qdrant",
            "applied_filters": {},
            "profile_gate": True,
        },
        "disclaimer": "Informational only. Final decision depends on plan-specific review.",
        "needs_profile_completion": True,
        "missing_profile_fields": missing_fields,
        "missing_profile_field_labels": labels,
        "profile_completion_url": "/profile",
        "user_id": user_id,
        "profile_snapshot": _profile_summary_payload(profile),
    }


def _inject_profile_into_filters(filters: QueryFilters, profile: dict[str, Any]) -> QueryFilters:
    merged = filters.model_copy(deep=True)
    if not merged.plan_ids:
        primary_plan_id = str(profile.get("primary_plan_id") or "").strip()
        if primary_plan_id:
            merged.plan_ids = [primary_plan_id]
    return merged


def _build_profile_context(profile: dict[str, Any]) -> str:
    context_parts: list[str] = []
    full_name = str(profile.get("full_name") or "").strip()
    date_of_birth = str(profile.get("date_of_birth") or "").strip()
    state = str(profile.get("state") or "").strip()
    member_id = str(profile.get("member_id") or "").strip()
    primary_plan_id = str(profile.get("primary_plan_id") or "").strip()
    chronic_conditions = profile.get("chronic_conditions") or []
    medications = profile.get("medications") or []

    if full_name:
        context_parts.append(f"name={full_name}")
    if date_of_birth:
        context_parts.append(f"date_of_birth={date_of_birth}")
    if state:
        context_parts.append(f"state={state}")
    if member_id:
        context_parts.append(f"member_id={member_id}")
    if primary_plan_id:
        context_parts.append(f"primary_plan_id={primary_plan_id}")
    if chronic_conditions:
        context_parts.append(f"chronic_conditions={', '.join(str(v) for v in chronic_conditions)}")
    if medications:
        context_parts.append(f"medications={', '.join(str(v) for v in medications)}")

    return "; ".join(context_parts)


def _session_owned_by_user(conn, session_id: str, user_id: str) -> bool:
    row = db_layer.fetchone(
        conn,
        "SELECT id, user_id FROM qa_sessions WHERE id = %s",
        (session_id,),
    )
    if not row:
        return False
    owner = str(row.get("user_id") or "").strip()
    return owner == "" or owner == user_id


def run_ingestion_job(document_id: str, payer_id: str, policy_title: str, effective_date_value: Optional[str]):
    try:
        with db_layer.get_conn() as conn:
            doc = db_layer.get_document(conn, document_id)
            payer = db_layer.get_payer(conn, payer_id)
            if not doc or not payer:
                if doc:
                    db_layer.update_document_status(conn, document_id, "failed", "Missing payer/document.")
                return

            db_layer.update_document_status(conn, document_id, "processing")
            conn.commit()

            qdrant_client = extraction_agent.get_qdrant()
            extraction_agent.process_document(
                file_path=Path(doc["storage_path"]),
                payer=payer["name"],
                policy_title=policy_title,
                version_label=_version_label(effective_date_value),
                source_url=doc.get("source_url"),
                effective_date=effective_date_value,
                dry_run=False,
                conn=conn,
                qdrant_client=qdrant_client,
                document_id=document_id,
            )
            db_layer.update_document_status(conn, document_id, "completed")
            conn.commit()
    except Exception as exc:
        with db_layer.get_conn() as conn:
            db_layer.update_document_status(conn, document_id, "failed", str(exc)[:1000])
            conn.commit()


def run_source_scan_job(scan_id: str, source_group: str):
    scan = SOURCE_SCAN_RUNS.get(scan_id)
    if not scan:
        return
    started = datetime.utcnow().isoformat()
    scan["started_at"] = started

    cmd = [sys.executable, str(ROOT_DIR / "insurance_scraper.py")]
    process = subprocess.run(cmd, capture_output=True, text=True)
    stdout_tail = "\n".join((process.stdout or "").splitlines()[-30:])
    stderr_tail = "\n".join((process.stderr or "").splitlines()[-30:])

    scan["finished_at"] = datetime.utcnow().isoformat()
    scan["status"] = "completed" if process.returncode == 0 else "failed"
    scan["result"] = {
        "exit_code": process.returncode,
        "stdout_tail": stdout_tail,
        "stderr_tail": stderr_tail,
        "source_group": source_group,
    }


app = FastAPI(title="CoverageAtlas API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get(f"{API_PREFIX}/health")
def health():
    return {"status": "ok"}


@app.get(f"{API_PREFIX}/auth/me")
def auth_me(claims: AuthClaims = Depends(require_auth0_token)):
    return {
        "sub": claims.get("sub"),
        "scope": claims.get("scope", ""),
        "permissions": claims.get("permissions", []),
        "scopes": sorted(extract_scopes(claims)),
        "auth_enabled": is_auth_enabled(),
    }


@app.get(f"{API_PREFIX}/profile/me")
def profile_me(claims: AuthClaims = Depends(require_auth0_token)):
    user_id = _resolve_request_user_id(claims)
    with db_layer.get_conn() as conn:
        profile = db_layer.get_user_profile(conn, user_id)

    if profile is None:
        profile = {
            "user_id": user_id,
            "full_name": claims.get("name"),
            "email": claims.get("email"),
            "phone": None,
            "date_of_birth": None,
            "state": None,
            "member_id": None,
            "preferred_language": None,
            "preferred_channel": "web",
            "primary_plan_id": None,
            "chronic_conditions": [],
            "medications": [],
            "notes": None,
            "created_at": None,
            "updated_at": None,
        }
    else:
        if not profile.get("email") and claims.get("email"):
            profile["email"] = claims.get("email")
        if not profile.get("full_name") and claims.get("name"):
            profile["full_name"] = claims.get("name")

    return {"profile": profile}


@app.put(f"{API_PREFIX}/profile/me")
def profile_update(
    req: ProfileUpdateRequest,
    claims: AuthClaims = Depends(require_auth0_token),
):
    user_id = _resolve_request_user_id(claims)
    payload = req.model_dump()
    preferred_channel = payload.get("preferred_channel")
    if preferred_channel and preferred_channel not in {"web", "voice", "email"}:
        return error_response(
            400,
            "VALIDATION_ERROR",
            "preferred_channel must be one of: web, voice, email",
            {"preferred_channel": preferred_channel},
        )
    if not payload.get("email") and claims.get("email"):
        payload["email"] = str(claims.get("email"))
    if not payload.get("full_name") and claims.get("name"):
        payload["full_name"] = str(claims.get("name"))

    with db_layer.get_conn() as conn:
        profile = db_layer.upsert_user_profile(conn, user_id=user_id, profile=payload)
    return {"profile": profile}


@app.get(f"{API_PREFIX}/metadata/plans")
def metadata_plans(_auth: AuthClaims = Depends(require_auth0_token)):
    with db_layer.get_conn() as conn:
        payers = db_layer.list_payers(conn)
        plans = db_layer.list_plans(conn)

    if not plans:
        plans = [
            {
                "id": row["id"],
                "payer_id": row["id"],
                "payer_name": row["name"],
                "plan_name": f"{row['name']} (default)",
                "plan_type": None,
                "market": None,
                "is_virtual": True,
            }
            for row in payers
        ]

    return {
        "payers": [
            {
                "payer_id": str(row["id"]),
                "name": row["name"],
                "payer_type": row.get("payer_type"),
                "region": row.get("region"),
            }
            for row in payers
        ],
        "plans": [
            {
                "plan_id": str(row["id"]),
                "payer_id": str(row["payer_id"]),
                "payer_name": row.get("payer_name"),
                "plan_name": row["plan_name"],
                "plan_type": row.get("plan_type"),
                "market": row.get("market"),
                "is_virtual": bool(row.get("is_virtual", False)),
            }
            for row in plans
        ],
    }


@app.get(f"{API_PREFIX}/metadata/policies")
def metadata_policies(_auth: AuthClaims = Depends(require_auth0_token)):
    with db_layer.get_conn() as conn:
        policies = db_layer.list_policies_with_versions(conn)

    return {
        "policies": [
            {
                "policy_id": str(row["policy_id"]),
                "payer_id": str(row["payer_id"]),
                "payer_name": row["payer_name"],
                "policy_title": row["policy_title"],
                "policy_category": row.get("policy_category"),
                "versions": [
                    {
                        "version_id": str(v["version_id"]),
                        "version_label": v.get("version_label"),
                        "effective_date": iso_or_none(v.get("effective_date")),
                        "published_date": iso_or_none(v.get("published_date")),
                        "is_current": bool(v.get("is_current", False)),
                    }
                    for v in row.get("versions", [])
                ],
            }
            for row in policies
        ]
    }


@app.get(f"{API_PREFIX}/metadata/chat-hints")
def metadata_chat_hints(_auth: AuthClaims = Depends(require_auth0_token)):
    with db_layer.get_conn() as conn:
        stats = db_layer.fetchone(
            conn,
            """
            SELECT
              (SELECT COUNT(*)::int FROM payers) AS payer_count,
              (SELECT COUNT(*)::int FROM policies) AS policy_count,
              (SELECT COUNT(*)::int FROM policy_versions) AS policy_version_count,
              (SELECT COUNT(*)::int FROM coverage_rules) AS coverage_rule_count,
              (SELECT COUNT(*)::int FROM policy_chunks) AS chunk_count
            """,
        ) or {}

        payer_rows = db_layer.fetchall(
            conn,
            "SELECT name FROM payers ORDER BY name LIMIT 24",
        )
        policy_rows = db_layer.fetchall(
            conn,
            """
            SELECT policy_title
            FROM policies
            WHERE COALESCE(TRIM(policy_title), '') <> ''
            ORDER BY created_at DESC
            LIMIT 24
            """,
        )
        drug_rows = db_layer.fetchall(
            conn,
            """
            SELECT drug_name, COUNT(*)::int AS freq
            FROM coverage_rules
            WHERE COALESCE(TRIM(drug_name), '') <> ''
            GROUP BY drug_name
            ORDER BY freq DESC, drug_name ASC
            LIMIT 24
            """,
        )

    payers = _dedupe_nonempty([str(row.get("name", "")) for row in payer_rows])
    policies = _dedupe_nonempty([str(row.get("policy_title", "")) for row in policy_rows])
    drugs = _dedupe_nonempty([_compact_drug_name(str(row.get("drug_name", ""))) for row in drug_rows])

    qdrant = _qdrant_status()
    postgres_rule_count = int(stats.get("coverage_rule_count", 0) or 0)
    qdrant_points = int(qdrant.get("points_count", 0) or 0)
    use_live_examples = postgres_rule_count > 0 and qdrant.get("reachable", False) and qdrant_points > 0

    live_questions = (
        _build_live_chat_questions(
            payers=payers[:6],
            drugs=drugs[:6],
            policies=policies[:6],
        )
        if use_live_examples
        else []
    )

    return {
        "use_live_examples": use_live_examples,
        "live_example_questions": live_questions,
        "demo_example_questions": DEMO_CHAT_QUESTIONS,
        "live_signals": {
            "payers": payers[:8],
            "top_drugs": drugs[:8],
            "policy_titles": policies[:8],
        },
        "data_status": {
            "postgres": {
                "payers": int(stats.get("payer_count", 0) or 0),
                "policies": int(stats.get("policy_count", 0) or 0),
                "policy_versions": int(stats.get("policy_version_count", 0) or 0),
                "coverage_rules": int(stats.get("coverage_rule_count", 0) or 0),
                "chunks": int(stats.get("chunk_count", 0) or 0),
            },
            "qdrant": qdrant,
        },
    }


@app.post(f"{API_PREFIX}/documents/upload")
async def documents_upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    payer_id: str = Form(...),
    policy_title: str = Form(...),
    effective_date: Optional[str] = Form(None),
    _auth: AuthClaims = Depends(require_admin_auth),
):
    with db_layer.get_conn() as conn:
        payer = db_layer.get_payer(conn, payer_id)
        if not payer:
            return error_response(404, "NOT_FOUND", "payer_id not found", {"payer_id": payer_id})

    file_bytes = await file.read()
    if not file_bytes:
        return error_response(400, "VALIDATION_ERROR", "file is empty")

    file_hash = hashlib.sha256(file_bytes).hexdigest()
    suffix = Path(file.filename or "upload.bin").suffix.lower()
    if suffix == ".pdf":
        file_type = "pdf"
    elif suffix in (".html", ".htm"):
        file_type = "html"
    elif suffix == ".docx":
        file_type = "docx"
    else:
        file_type = "other"

    local_name = f"{uuid.uuid4().hex}_{Path(file.filename or 'upload').name}"
    local_path = UPLOAD_DIR / local_name
    local_path.write_bytes(file_bytes)

    with db_layer.get_conn() as conn:
        document_id = db_layer.insert_document(
            conn=conn,
            file_name=file.filename or local_name,
            file_type=file_type,
            sha256=file_hash,
            storage_path=str(local_path),
            source_url=None,
            payer_id=payer_id,
        )
        db_layer.update_document_status(conn, document_id, "queued")
        conn.commit()

    background_tasks.add_task(
        run_ingestion_job,
        str(document_id),
        payer_id,
        policy_title,
        effective_date,
    )
    return {"document_id": str(document_id), "ingestion_status": "queued"}


@app.get(f"{API_PREFIX}/documents/{{document_id}}/status")
def document_status(
    document_id: str,
    _auth: AuthClaims = Depends(require_auth0_token),
):
    with db_layer.get_conn() as conn:
        document = db_layer.get_document(conn, document_id)
        if not document:
            return error_response(404, "NOT_FOUND", "document not found", {"document_id": document_id})

    status = document["ingestion_status"]
    step_map = {
        "queued": "queued",
        "processing": "extracting_rules",
        "completed": "completed",
        "failed": "failed",
    }
    return {
        "document_id": str(document["id"]),
        "ingestion_status": status,
        "current_step": step_map.get(status, status),
    }


@app.post(f"{API_PREFIX}/query")
def query(
    req: QueryRequest,
    auth: AuthClaims = Depends(require_auth0_token),
):
    if not req.question.strip():
        return error_response(400, "VALIDATION_ERROR", "question is required")

    user_id = _resolve_request_user_id(auth)
    with db_layer.get_conn() as conn:
        raw_profile = db_layer.get_user_profile(conn, user_id)
    profile = _merge_claims_into_profile(raw_profile, auth, user_id)
    missing_profile_fields = _missing_profile_fields(profile, req.question)
    if missing_profile_fields:
        return _profile_gate_response(missing_profile_fields, profile, user_id)

    filters = _inject_profile_into_filters(req.filters, profile)
    profile_context = _build_profile_context(profile)

    try:
        top_k = max(1, min(req.retrieval.top_k, 20))
        chunks, scope = retrieve_chunks(req.question, filters, top_k)
        citations = build_citations(chunks)
        answer, confidence = build_answer(req.question, chunks, citations, profile_context=profile_context)
    except Exception as exc:
        return error_response(500, "INTERNAL_ERROR", "Query processing failed", {"reason": str(exc)})

    return {
        "answer": answer,
        "confidence": confidence,
        "citations": citations,
        "retrieval_trace": {
            "chunks_used": len(chunks),
            "vector_store": "qdrant",
            "applied_filters": {
                "plan_ids": scope["plan_ids"],
                "payer_ids": scope["payer_ids"],
                "policy_categories": scope["policy_categories"],
                "version_labels": scope["version_labels"],
                "coverage_statuses": scope["coverage_statuses"],
                "policy_version_ids_count": scope["resolved_versions_count"],
                "effective_on": scope["effective_on"],
            },
        },
        "disclaimer": "Informational only. Final decision depends on plan-specific review.",
        "needs_profile_completion": False,
        "missing_profile_fields": [],
        "profile_completion_url": "/profile",
        "profile_snapshot": _profile_summary_payload(profile),
    }


@app.post(f"{API_PREFIX}/compare")
def compare(
    req: CompareRequest,
    _auth: AuthClaims = Depends(require_auth0_token),
):
    if not req.plan_ids:
        return error_response(400, "VALIDATION_ERROR", "plan_ids is required")

    with db_layer.get_conn() as conn:
        plans = db_layer.list_plans_by_ids(conn, req.plan_ids)
        if not plans:
            payer_rows = db_layer.fetchall(
                conn,
                "SELECT id, name FROM payers WHERE id::text = ANY(%s)",
                (req.plan_ids,),
            )
            plans = [
                {
                    "id": row["id"],
                    "payer_id": row["id"],
                    "plan_name": f"{row['name']} (default)",
                }
                for row in payer_rows
            ]
        if not plans:
            return error_response(404, "NOT_FOUND", "No matching plans found", {"plan_ids": req.plan_ids})

        payer_ids = sorted({str(plan["payer_id"]) for plan in plans})
        rows = db_layer.compare_drug_across_plans(conn, req.drug_name, payer_ids=payer_ids)
        rows = [r for r in rows if effective_date_passes(r.get("effective_date"), req.effective_on)]

    by_payer: dict[str, dict] = {}
    for row in rows:
        by_payer[str(row["payer_id"])] = row

    response_rows = []
    for plan in plans:
        plan_id = str(plan["id"])
        payer_id = str(plan["payer_id"])
        match = by_payer.get(payer_id)
        if not match:
            response_rows.append({
                "plan_id": plan_id,
                "coverage_status": "unknown",
                "prior_auth_required": None,
                "step_therapy_required": None,
                "quantity_limit_text": None,
                "site_of_care_text": None,
                "criteria_summary": [],
                "citations": [],
            })
            continue

        response_rows.append({
            "plan_id": plan_id,
            "coverage_status": match.get("coverage_status", "unknown"),
            "prior_auth_required": match.get("prior_auth_required"),
            "step_therapy_required": match.get("step_therapy_required"),
            "quantity_limit_text": match.get("quantity_limit_text"),
            "site_of_care_text": match.get("site_of_care_text"),
            "criteria_summary": normalize_json(match.get("criteria_summary"), []),
            "citations": normalize_json(match.get("raw_evidence_ref"), []),
        })

    return {"drug_name": req.drug_name, "rows": response_rows}


def resolve_version(conn, policy_id: str, ref: str) -> Optional[dict]:
    by_id = db_layer.fetchone(
        conn,
        "SELECT id, version_label FROM policy_versions WHERE policy_id = %s AND id::text = %s",
        (policy_id, ref),
    )
    if by_id:
        return by_id
    by_label = db_layer.fetchone(
        conn,
        "SELECT id, version_label FROM policy_versions WHERE policy_id = %s AND version_label = %s",
        (policy_id, ref),
    )
    return by_label


@app.get(f"{API_PREFIX}/policies/{{policy_id}}/changes")
def policy_changes(
    policy_id: str,
    from_: str = Query(..., alias="from"),
    to: str = Query(..., alias="to"),
    _auth: AuthClaims = Depends(require_auth0_token),
):
    with db_layer.get_conn() as conn:
        from_version = resolve_version(conn, policy_id, from_)
        to_version = resolve_version(conn, policy_id, to)
        if not from_version or not to_version:
            return error_response(
                404,
                "NOT_FOUND",
                "Unable to resolve from/to versions for policy",
                {"policy_id": policy_id, "from": from_, "to": to},
            )

        changes = db_layer.get_changes_between_versions(
            conn,
            policy_id=policy_id,
            from_version_id=str(from_version["id"]),
            to_version_id=str(to_version["id"]),
        )

    formatted = [{
        "change_type": c["change_type"],
        "field_name": c["field_name"],
        "old_value": c["old_value"],
        "new_value": c["new_value"],
        "citations": normalize_json(c.get("citations"), []),
    } for c in changes]

    return {
        "policy_id": policy_id,
        "from_version": from_version["version_label"],
        "to_version": to_version["version_label"],
        "changes": formatted,
    }


@app.get(f"{API_PREFIX}/policies/changes/recent")
def policy_changes_recent(
    limit: int = Query(30, ge=1, le=200),
    policy_id: Optional[str] = None,
    _auth: AuthClaims = Depends(require_auth0_token),
):
    with db_layer.get_conn() as conn:
        if policy_id:
            rows = db_layer.fetchall(
                conn,
                """
                SELECT *
                FROM v_recent_changes
                WHERE policy_id::text = %s
                ORDER BY detected_at DESC
                LIMIT %s
                """,
                (policy_id, limit),
            )
        else:
            rows = db_layer.get_recent_changes(conn, limit)

    return {
        "changes": [
            {
                "id": str(row["id"]),
                "policy_id": str(row["policy_id"]),
                "payer_name": row.get("payer_name"),
                "policy_title": row.get("policy_title"),
                "from_version": row.get("from_version"),
                "to_version": row.get("to_version"),
                "change_type": row.get("change_type"),
                "field_name": row.get("field_name"),
                "old_value": row.get("old_value"),
                "new_value": row.get("new_value"),
                "citations": normalize_json(row.get("citations"), []),
                "detected_at": iso_or_none(row.get("detected_at")),
            }
            for row in rows
        ]
    }


@app.post(f"{API_PREFIX}/sources/scan")
def sources_scan(
    req: SourceScanRequest,
    background_tasks: BackgroundTasks,
    _auth: AuthClaims = Depends(require_admin_auth),
):
    scan_id = str(uuid.uuid4())
    SOURCE_SCAN_RUNS[scan_id] = {
        "scan_id": scan_id,
        "status": "started",
        "created_at": datetime.utcnow().isoformat(),
    }
    background_tasks.add_task(run_source_scan_job, scan_id, req.source_group)
    return {"scan_id": scan_id, "status": "started"}


@app.get(f"{API_PREFIX}/sources/scan/{{scan_id}}")
def scan_status(
    scan_id: str,
    _auth: AuthClaims = Depends(require_admin_auth),
):
    scan = SOURCE_SCAN_RUNS.get(scan_id)
    if not scan:
        return error_response(404, "NOT_FOUND", "scan_id not found", {"scan_id": scan_id})
    return scan


@app.get(f"{API_PREFIX}/sources/registry")
def list_sources_registry(
    source_group: Optional[str] = Query(None),
    enabled_only: bool = Query(True),
):
    with db_layer.get_conn() as conn:
        items = db_layer.list_source_registry(
            conn,
            source_group=source_group,
            enabled_only=enabled_only,
        )
    return {"items": items}


@app.post(f"{API_PREFIX}/sources/registry/upsert")
def upsert_source_registry(
    req: SourceRegistryUpsertRequest,
    _auth: AuthClaims = Depends(require_admin_auth),
):
    with db_layer.get_conn() as conn:
        source_id = db_layer.upsert_source_registry(
            conn,
            source_key=req.source_key.strip(),
            display_name=req.display_name.strip(),
            entry_url=req.entry_url.strip(),
            adapter_name=req.adapter_name.strip() or "html_index_links",
            source_group=req.source_group.strip() or "default",
            payer_id=req.payer_id,
            source_type=req.source_type.strip() or "html_index",
            enabled=req.enabled,
            refresh_interval_hours=max(1, min(int(req.refresh_interval_hours), 24 * 14)),
            metadata=req.metadata,
        )
        row = db_layer.fetchone(conn, "SELECT * FROM source_registry WHERE id = %s", (source_id,))
    return {"item": row}


@app.post(f"{API_PREFIX}/sources/refresh")
def sources_refresh(
    req: SourceRefreshRequest,
    _auth: AuthClaims = Depends(require_admin_auth),
):
    result = run_refresh(
        source_group=req.source_group.strip() or "default",
        source_keys=req.source_keys,
        limit_per_source=max(1, min(int(req.limit_per_source), 5)),
        dry_run=req.dry_run,
        fetch_enabled=req.fetch_enabled,
        ingestion_enabled=req.ingestion_enabled,
    )
    return {
        "run": result.get("run"),
        "items": result.get("items", []),
    }


@app.get(f"{API_PREFIX}/sources/refresh/{{run_id}}")
def get_source_refresh_run(run_id: str):
    with db_layer.get_conn() as conn:
        run_row = db_layer.get_source_refresh_run(conn, run_id)
        if not run_row:
            return error_response(404, "NOT_FOUND", "run_id not found", {"run_id": run_id})
        items = db_layer.list_source_refresh_items(conn, run_id)
    return {"run": run_row, "items": items}


@app.post(f"{API_PREFIX}/voice/session/start")
def voice_start(
    req: VoiceStartRequest,
    auth: AuthClaims = Depends(require_auth0_token),
):
    user_id = _resolve_request_user_id(auth, fallback=req.user_id)
    with db_layer.get_conn() as conn:
        session_id = db_layer.create_qa_session(conn, user_id=user_id, channel="voice")
    return {"session_id": session_id, "status": "started"}


@app.post(f"{API_PREFIX}/voice/session/{{session_id}}/turn")
def voice_turn(
    session_id: str,
    req: VoiceTurnRequest,
    auth: AuthClaims = Depends(require_auth0_token),
):
    user_id = _resolve_request_user_id(auth)
    with db_layer.get_conn() as conn:
        if not _session_owned_by_user(conn, session_id, user_id):
            return error_response(
                403,
                "FORBIDDEN",
                "You are not allowed to access this voice session.",
                {"session_id": session_id},
            )
        db_layer.append_qa_message(conn, session_id, "user", req.utterance)

    query_req = QueryRequest(
        question=req.utterance,
        filters=req.filters,
        retrieval=req.retrieval,
    )
    result = query(query_req)
    if isinstance(result, JSONResponse):
        return result

    with db_layer.get_conn() as conn:
        db_layer.append_qa_message(
            conn,
            session_id,
            "assistant",
            result["answer"],
            confidence=result["confidence"],
            citations=result["citations"],
        )
    return {
        "session_id": session_id,
        "answer": result["answer"],
        "confidence": result["confidence"],
        "citations": result["citations"],
        "disclaimer": result["disclaimer"],
    }


@app.post(f"{API_PREFIX}/voice/session/{{session_id}}/end")
def voice_end(
    session_id: str,
    req: VoiceEndRequest,
    auth: AuthClaims = Depends(require_auth0_token),
):
    user_id = _resolve_request_user_id(auth)
    with db_layer.get_conn() as conn:
        if not _session_owned_by_user(conn, session_id, user_id):
            return error_response(
                403,
                "FORBIDDEN",
                "You are not allowed to access this voice session.",
                {"session_id": session_id},
            )
        if req.summary:
            summary = req.summary
        else:
            messages = db_layer.get_session_messages(conn, session_id)
            summary = " ".join([m["message_text"] for m in messages[-4:]])[:1200] if messages else ""
        db_layer.end_qa_session(conn, session_id, summary=summary)

    return {"session_id": session_id, "status": "ended", "summary": summary}
