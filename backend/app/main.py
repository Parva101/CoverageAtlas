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
from backend.app.auth import (
    AuthClaims,
    require_admin_auth,
)
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

SOURCE_SCAN_RUNS: dict[str, dict[str, Any]] = {}


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


def build_answer(question: str, chunks: list[dict], citations: list[dict]) -> tuple[str, float]:
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
def document_status(document_id: str):
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
def query(req: QueryRequest):
    if not req.question.strip():
        return error_response(400, "VALIDATION_ERROR", "question is required")

    try:
        top_k = max(1, min(req.retrieval.top_k, 20))
        chunks, scope = retrieve_chunks(req.question, req.filters, top_k)
        citations = build_citations(chunks)
        answer, confidence = build_answer(req.question, chunks, citations)
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
    }


@app.post(f"{API_PREFIX}/compare")
def compare(req: CompareRequest):
    if not req.plan_ids:
        return error_response(400, "VALIDATION_ERROR", "plan_ids is required")

    with db_layer.get_conn() as conn:
        plans = db_layer.list_plans_by_ids(conn, req.plan_ids)
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
                "criteria_summary": [],
                "citations": [],
            })
            continue

        response_rows.append({
            "plan_id": plan_id,
            "coverage_status": match.get("coverage_status", "unknown"),
            "prior_auth_required": match.get("prior_auth_required"),
            "step_therapy_required": match.get("step_therapy_required"),
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
def scan_status(scan_id: str):
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
def voice_start(req: VoiceStartRequest):
    with db_layer.get_conn() as conn:
        session_id = db_layer.create_qa_session(conn, user_id=req.user_id, channel="voice")
    return {"session_id": session_id, "status": "started"}


@app.post(f"{API_PREFIX}/voice/session/{{session_id}}/turn")
def voice_turn(session_id: str, req: VoiceTurnRequest):
    with db_layer.get_conn() as conn:
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
def voice_end(session_id: str, req: VoiceEndRequest):
    with db_layer.get_conn() as conn:
        if req.summary:
            summary = req.summary
        else:
            messages = db_layer.get_session_messages(conn, session_id)
            summary = " ".join([m["message_text"] for m in messages[-4:]])[:1200] if messages else ""
        db_layer.end_qa_session(conn, session_id, summary=summary)

    return {"session_id": session_id, "status": "ended", "summary": summary}
