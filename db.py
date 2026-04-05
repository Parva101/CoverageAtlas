"""
db.py
══════
PostgreSQL connection manager + typed helper functions for all 9 tables.
Import this module everywhere you need DB access — never open connections directly.

Usage:
    from db import get_conn, insert_document, upsert_payer, ...
"""

import os
import json
import uuid
import logging
from contextlib import contextmanager
from datetime import datetime, date
from typing import Any, Optional

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/coverageatlas"
)

log = logging.getLogger(__name__)

# ── Connection pool (simple, no external lib needed for hackathon) ──────────

@contextmanager
def get_conn():
    """Context manager — auto-commits on success, rolls back on exception."""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetchone(conn, sql: str, params=()) -> Optional[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else None


def fetchall(conn, sql: str, params=()) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def execute(conn, sql: str, params=()) -> Optional[str]:
    """Executes SQL, returns first column of first row (useful for RETURNING id)."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        # UPDATE/DELETE without RETURNING has no result set.
        if cur.description is None:
            return None
        row = cur.fetchone()
        return str(row[0]) if row else None


# ══════════════════════════════════════════════════════════════════════════════
# PAYERS
# ══════════════════════════════════════════════════════════════════════════════

def upsert_payer(conn, name: str, payer_type: str = "commercial", region: str = None) -> str:
    return execute(conn, """
        INSERT INTO payers (name, payer_type, region)
        VALUES (%s, %s, %s)
        ON CONFLICT (name) DO UPDATE SET
            payer_type = EXCLUDED.payer_type,
            region     = COALESCE(EXCLUDED.region, payers.region)
        RETURNING id
    """, (name, payer_type, region))


def get_payer_by_name(conn, name: str) -> Optional[dict]:
    return fetchone(conn, "SELECT * FROM payers WHERE name = %s", (name,))


def get_payer(conn, payer_id: str) -> Optional[dict]:
    return fetchone(conn, "SELECT * FROM payers WHERE id = %s", (payer_id,))


def list_payers(conn) -> list[dict]:
    return fetchall(conn, "SELECT * FROM payers ORDER BY name")


# ══════════════════════════════════════════════════════════════════════════════
# PLANS
# ══════════════════════════════════════════════════════════════════════════════

def insert_plan(conn, payer_id: str, plan_name: str,
                plan_type: str = None, market: str = None) -> str:
    return execute(conn, """
        INSERT INTO plans (payer_id, plan_name, plan_type, market)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        RETURNING id
    """, (payer_id, plan_name, plan_type, market))


def list_plans_for_payer(conn, payer_id: str) -> list[dict]:
    return fetchall(conn,
        "SELECT * FROM plans WHERE payer_id = %s ORDER BY plan_name",
        (payer_id,)
    )


def list_plans_by_ids(conn, plan_ids: list[str]) -> list[dict]:
    if not plan_ids:
        return []
    return fetchall(
        conn,
        "SELECT * FROM plans WHERE id = ANY(%s)",
        (plan_ids,),
    )


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENTS
# ══════════════════════════════════════════════════════════════════════════════

def insert_document(conn, file_name: str, file_type: str, sha256: str,
                    storage_path: str, source_url: str = None,
                    payer_id: str = None) -> str:
    """
    Inserts a new document record. If sha256 already exists, returns existing id.
    Status starts as 'queued'.
    """
    existing = fetchone(conn, "SELECT id FROM documents WHERE sha256 = %s", (sha256,))
    if existing:
        log.info(f"  Document already exists (sha256 match): {file_name}")
        return str(existing["id"])

    return execute(conn, """
        INSERT INTO documents
          (file_name, file_type, sha256, storage_path, source_url, payer_id, ingestion_status)
        VALUES (%s, %s, %s, %s, %s, %s, 'queued')
        RETURNING id
    """, (file_name, file_type, sha256, storage_path, source_url, payer_id))


def update_document_status(conn, document_id: str, status: str, error: str = None):
    """Updates ingestion_status and optionally ingestion_error."""
    ingested_at = datetime.now() if status == "completed" else None
    execute(conn, """
        UPDATE documents
        SET ingestion_status = %s,
            ingestion_error  = %s,
            ingested_at      = %s
        WHERE id = %s
    """, (status, error, ingested_at, document_id))


def get_document(conn, document_id: str) -> Optional[dict]:
    return fetchone(conn, "SELECT * FROM documents WHERE id = %s", (document_id,))


def list_documents_for_payer(conn, payer_id: str) -> list[dict]:
    return fetchall(conn,
        "SELECT * FROM documents WHERE payer_id = %s ORDER BY created_at DESC",
        (payer_id,)
    )


# ══════════════════════════════════════════════════════════════════════════════
# POLICIES
# ══════════════════════════════════════════════════════════════════════════════

def upsert_policy(conn, payer_id: str, policy_title: str,
                  policy_code: str = None,
                  policy_category: str = "medical_benefit") -> str:
    return execute(conn, """
        INSERT INTO policies (payer_id, policy_title, policy_code, policy_category)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        RETURNING id
    """, (payer_id, policy_title, policy_code, policy_category)) or \
        execute(conn,
            "SELECT id FROM policies WHERE payer_id=%s AND policy_title=%s",
            (payer_id, policy_title)
        )


def get_policy(conn, policy_id: str) -> Optional[dict]:
    return fetchone(conn, "SELECT * FROM policies WHERE id = %s", (policy_id,))


def list_policies_for_payer(conn, payer_id: str) -> list[dict]:
    return fetchall(conn,
        "SELECT * FROM policies WHERE payer_id = %s ORDER BY policy_title",
        (payer_id,)
    )


# ══════════════════════════════════════════════════════════════════════════════
# POLICY VERSIONS
# ══════════════════════════════════════════════════════════════════════════════

def create_policy_version(conn, policy_id: str, document_id: str,
                           version_label: str, effective_date: str = None,
                           published_date: str = None,
                           source_url: str = None) -> str:
    """
    Creates a new version and marks all previous versions as not current.
    Spec rule: never delete old versions.
    """
    execute(conn,
        "UPDATE policy_versions SET is_current = FALSE WHERE policy_id = %s",
        (policy_id,)
    )
    return execute(conn, """
        INSERT INTO policy_versions
          (policy_id, document_id, version_label, effective_date,
           published_date, source_url, is_current)
        VALUES (%s, %s, %s, %s, %s, %s, TRUE)
        RETURNING id
    """, (policy_id, document_id, version_label,
          effective_date or date.today().isoformat(),
          published_date, source_url))


def get_current_version(conn, policy_id: str) -> Optional[dict]:
    return fetchone(conn,
        "SELECT * FROM policy_versions WHERE policy_id = %s AND is_current = TRUE",
        (policy_id,)
    )


def list_versions(conn, policy_id: str) -> list[dict]:
    return fetchall(conn,
        "SELECT * FROM policy_versions WHERE policy_id = %s ORDER BY effective_date DESC",
        (policy_id,)
    )


# ══════════════════════════════════════════════════════════════════════════════
# POLICY CHUNKS
# ══════════════════════════════════════════════════════════════════════════════

def insert_chunk(conn, policy_version_id: str, chunk_index: int,
                 section_title: str, page_number: int,
                 text: str, embedding_id: str = None) -> str:
    return execute(conn, """
        INSERT INTO policy_chunks
          (policy_version_id, chunk_index, section_title, page_number, text, embedding_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
    """, (policy_version_id, chunk_index, section_title, page_number,
          text[:8000], embedding_id))


def update_chunk_embedding(conn, chunk_id: str, embedding_id: str):
    execute(conn,
        "UPDATE policy_chunks SET embedding_id = %s WHERE id = %s",
        (embedding_id, chunk_id)
    )


def get_chunks_for_version(conn, policy_version_id: str) -> list[dict]:
    return fetchall(conn,
        "SELECT * FROM policy_chunks WHERE policy_version_id = %s ORDER BY chunk_index",
        (policy_version_id,)
    )


# ══════════════════════════════════════════════════════════════════════════════
# COVERAGE RULES
# ══════════════════════════════════════════════════════════════════════════════

def insert_coverage_rule(conn, policy_version_id: str, rule: dict) -> str:
    return execute(conn, """
        INSERT INTO coverage_rules (
            policy_version_id, drug_name, drug_aliases, indication,
            coverage_status, prior_auth_required, step_therapy_required,
            quantity_limit_text, site_of_care_text, criteria_summary,
            raw_evidence_ref, extraction_confidence, needs_review
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
    """, (
        policy_version_id,
        rule["drug_name"],
        json.dumps(rule.get("drug_aliases", [])),
        rule.get("indication"),
        rule.get("coverage_status", "unknown"),
        rule.get("prior_auth_required"),
        rule.get("step_therapy_required"),
        rule.get("quantity_limit_text"),
        rule.get("site_of_care_text"),
        json.dumps(rule.get("criteria_summary", [])),
        json.dumps(rule.get("citations", [])),
        rule.get("extraction_confidence"),
        rule.get("needs_review", False),
    ))


def get_coverage_rules_for_drug(conn, drug_name: str,
                                 payer_id: str = None) -> list[dict]:
    """Returns current coverage rules for a drug across all (or one) payer."""
    sql = """
        SELECT cr.*, p.name AS payer_name, pol.policy_title, pv.version_label,
               pv.effective_date, pv.source_url
        FROM coverage_rules cr
        JOIN policy_versions pv ON cr.policy_version_id = pv.id
        JOIN policies pol        ON pv.policy_id = pol.id
        JOIN payers p            ON pol.payer_id = p.id
        WHERE pv.is_current = TRUE
          AND LOWER(cr.drug_name) ILIKE %s
    """
    params = [f"%{drug_name.lower()}%"]
    if payer_id:
        sql    += " AND p.id = %s"
        params.append(payer_id)
    sql += " ORDER BY p.name"
    return fetchall(conn, sql, params)


def get_rules_for_version(conn, policy_version_id: str) -> list[dict]:
    return fetchall(conn,
        "SELECT * FROM coverage_rules WHERE policy_version_id = %s ORDER BY drug_name",
        (policy_version_id,)
    )


# ══════════════════════════════════════════════════════════════════════════════
# POLICY CHANGES
# ══════════════════════════════════════════════════════════════════════════════

def insert_policy_change(conn, policy_id: str, from_version_id: Optional[str],
                          to_version_id: str, change_type: str,
                          field_name: str, old_value=None,
                          new_value=None, citations: list = None) -> str:
    return execute(conn, """
        INSERT INTO policy_changes
          (policy_id, from_version_id, to_version_id, change_type,
           field_name, old_value, new_value, citations)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
    """, (
        policy_id, from_version_id, to_version_id, change_type,
        field_name,
        str(old_value) if old_value is not None else None,
        str(new_value) if new_value is not None else None,
        json.dumps(citations or []),
    ))


def get_changes_between_versions(conn, policy_id: str,
                                  from_version_id: str,
                                  to_version_id: str) -> list[dict]:
    return fetchall(conn, """
        SELECT * FROM policy_changes
        WHERE policy_id = %s
          AND from_version_id = %s
          AND to_version_id   = %s
        ORDER BY change_type, field_name
    """, (policy_id, from_version_id, to_version_id))


def get_recent_changes(conn, limit: int = 50) -> list[dict]:
    return fetchall(conn, """
        SELECT * FROM v_recent_changes LIMIT %s
    """, (limit,))


# ══════════════════════════════════════════════════════════════════════════════
# QA SESSIONS + MESSAGES
# ══════════════════════════════════════════════════════════════════════════════

def create_qa_session(conn, user_id: str = None, channel: str = "web") -> str:
    return execute(conn, """
        INSERT INTO qa_sessions (user_id, channel)
        VALUES (%s, %s)
        RETURNING id
    """, (user_id, channel))


def end_qa_session(conn, session_id: str, summary: str = None):
    execute(conn, """
        UPDATE qa_sessions SET ended_at = NOW(), summary = %s WHERE id = %s
    """, (summary, session_id))


def append_qa_message(conn, session_id: str, role: str, message_text: str,
                       confidence: float = None, citations: list = None) -> str:
    return execute(conn, """
        INSERT INTO qa_messages (session_id, role, message_text, confidence, citations)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
    """, (session_id, role, message_text, confidence, json.dumps(citations or [])))


def get_session_messages(conn, session_id: str) -> list[dict]:
    return fetchall(conn,
        "SELECT * FROM qa_messages WHERE session_id = %s ORDER BY created_at",
        (session_id,)
    )


# ══════════════════════════════════════════════════════════════════════════════
# COMPARE HELPER — used by /compare API endpoint
# ══════════════════════════════════════════════════════════════════════════════

def compare_drug_across_plans(conn, drug_name: str,
                               payer_ids: list[str] = None) -> list[dict]:
    """
    Returns one row per payer showing current coverage for drug_name.
    Used directly by the /compare API endpoint.
    """
    sql = """
        SELECT
            p.id           AS payer_id,
            p.name         AS payer_name,
            pol.id         AS policy_id,
            pol.policy_title,
            pv.version_label,
            pv.effective_date,
            pv.source_url,
            cr.id          AS rule_id,
            cr.coverage_status,
            cr.prior_auth_required,
            cr.step_therapy_required,
            cr.quantity_limit_text,
            cr.site_of_care_text,
            cr.criteria_summary,
            cr.raw_evidence_ref,
            cr.extraction_confidence
        FROM coverage_rules cr
        JOIN policy_versions pv ON cr.policy_version_id = pv.id
        JOIN policies pol        ON pv.policy_id = pol.id
        JOIN payers p            ON pol.payer_id = p.id
        WHERE pv.is_current = TRUE
          AND LOWER(cr.drug_name) ILIKE %s
    """
    params = [f"%{drug_name.lower()}%"]
    if payer_ids:
        sql    += " AND p.id = ANY(%s)"
        params.append(payer_ids)
    sql += " ORDER BY p.name"
    return fetchall(conn, sql, params)


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# SOURCE REFRESH REGISTRY + RUNS
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

def upsert_source_registry(
    conn,
    *,
    source_key: str,
    display_name: str,
    entry_url: str,
    adapter_name: str = "mock_static",
    source_group: str = "default",
    payer_id: Optional[str] = None,
    source_type: str = "html_index",
    enabled: bool = True,
    refresh_interval_hours: int = 24,
    metadata: Optional[dict[str, Any]] = None,
) -> str:
    return execute(
        conn,
        """
        INSERT INTO source_registry (
            source_key,
            payer_id,
            source_group,
            display_name,
            source_type,
            entry_url,
            adapter_name,
            enabled,
            refresh_interval_hours,
            metadata
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (source_key) DO UPDATE SET
            payer_id = EXCLUDED.payer_id,
            source_group = EXCLUDED.source_group,
            display_name = EXCLUDED.display_name,
            source_type = EXCLUDED.source_type,
            entry_url = EXCLUDED.entry_url,
            adapter_name = EXCLUDED.adapter_name,
            enabled = EXCLUDED.enabled,
            refresh_interval_hours = EXCLUDED.refresh_interval_hours,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        RETURNING id
        """,
        (
            source_key,
            payer_id,
            source_group,
            display_name,
            source_type,
            entry_url,
            adapter_name,
            enabled,
            refresh_interval_hours,
            json.dumps(metadata or {}),
        ),
    )


def list_source_registry(
    conn,
    source_group: Optional[str] = None,
    enabled_only: bool = True,
    source_keys: Optional[list[str]] = None,
) -> list[dict]:
    where = ["1=1"]
    params: list[Any] = []

    if source_group:
        where.append("source_group = %s")
        params.append(source_group)

    if enabled_only:
        where.append("enabled = TRUE")

    if source_keys:
        cleaned = [k.strip() for k in source_keys if k and k.strip()]
        if cleaned:
            where.append("source_key = ANY(%s)")
            params.append(cleaned)

    sql = f"""
        SELECT *
        FROM source_registry
        WHERE {' AND '.join(where)}
        ORDER BY source_key
    """
    return fetchall(conn, sql, tuple(params))


def create_source_refresh_run(
    conn,
    *,
    source_group: str,
    dry_run: bool,
    fetch_enabled: bool,
    ingestion_enabled: bool,
    status: str = "queued",
    log: Optional[dict[str, Any]] = None,
) -> str:
    return execute(
        conn,
        """
        INSERT INTO source_refresh_runs (
            source_group,
            status,
            dry_run,
            fetch_enabled,
            ingestion_enabled,
            log
        ) VALUES (%s,%s,%s,%s,%s,%s)
        RETURNING id
        """,
        (
            source_group,
            status,
            dry_run,
            fetch_enabled,
            ingestion_enabled,
            json.dumps(log or {}),
        ),
    )


def mark_source_refresh_run_started(conn, run_id: str):
    execute(
        conn,
        """
        UPDATE source_refresh_runs
        SET status = 'running',
            started_at = NOW(),
            updated_at = NOW()
        WHERE id = %s
        """,
        (run_id,),
    )


def complete_source_refresh_run(
    conn,
    *,
    run_id: str,
    status: str,
    discovered_count: int,
    changed_count: int,
    queued_for_ingestion_count: int,
    failed_count: int,
    log: Optional[dict[str, Any]] = None,
    error: Optional[str] = None,
):
    execute(
        conn,
        """
        UPDATE source_refresh_runs
        SET status = %s,
            discovered_count = %s,
            changed_count = %s,
            queued_for_ingestion_count = %s,
            failed_count = %s,
            log = %s,
            error = %s,
            finished_at = NOW(),
            updated_at = NOW()
        WHERE id = %s
        """,
        (
            status,
            discovered_count,
            changed_count,
            queued_for_ingestion_count,
            failed_count,
            json.dumps(log or {}),
            error,
            run_id,
        ),
    )


def get_source_refresh_run(conn, run_id: str) -> Optional[dict]:
    return fetchone(conn, "SELECT * FROM source_refresh_runs WHERE id = %s", (run_id,))


def list_source_refresh_runs(conn, limit: int = 20) -> list[dict]:
    return fetchall(
        conn,
        """
        SELECT *
        FROM source_refresh_runs
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (max(1, min(int(limit), 200)),),
    )


def insert_source_refresh_item(
    conn,
    *,
    run_id: str,
    source_key: str,
    document_url: str,
    change_status: str,
    source_id: Optional[str] = None,
    external_id: Optional[str] = None,
    normalized_title: Optional[str] = None,
    file_type: str = "other",
    published_date: Optional[str] = None,
    effective_date: Optional[str] = None,
    content_hash: Optional[str] = None,
    etag: Optional[str] = None,
    last_modified: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    error: Optional[str] = None,
) -> str:
    return execute(
        conn,
        """
        INSERT INTO source_refresh_items (
            run_id,
            source_id,
            source_key,
            external_id,
            document_url,
            normalized_title,
            file_type,
            published_date,
            effective_date,
            change_status,
            content_hash,
            etag,
            last_modified,
            payload,
            error
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
        """,
        (
            run_id,
            source_id,
            source_key,
            external_id,
            document_url,
            normalized_title,
            file_type,
            published_date,
            effective_date,
            change_status,
            content_hash,
            etag,
            last_modified,
            json.dumps(payload or {}),
            error,
        ),
    )


def list_source_refresh_items(conn, run_id: str) -> list[dict]:
    return fetchall(
        conn,
        """
        SELECT *
        FROM source_refresh_items
        WHERE run_id = %s
        ORDER BY created_at, source_key, document_url
        """,
        (run_id,),
    )


def get_source_document_state(conn, source_key: str, document_url: str) -> Optional[dict]:
    return fetchone(
        conn,
        """
        SELECT *
        FROM source_document_state
        WHERE source_key = %s
          AND document_url = %s
        """,
        (source_key, document_url),
    )


def upsert_source_document_state(
    conn,
    *,
    source_key: str,
    document_url: str,
    source_id: Optional[str] = None,
    normalized_title: Optional[str] = None,
    file_type: str = "other",
    content_hash: Optional[str] = None,
    etag: Optional[str] = None,
    last_modified: Optional[str] = None,
    published_date: Optional[str] = None,
    effective_date: Optional[str] = None,
    last_change_status: str = "unchanged",
    metadata: Optional[dict[str, Any]] = None,
) -> str:
    return execute(
        conn,
        """
        INSERT INTO source_document_state (
            source_id,
            source_key,
            document_url,
            normalized_title,
            file_type,
            content_hash,
            etag,
            last_modified,
            published_date,
            effective_date,
            last_change_status,
            metadata,
            first_seen_at,
            last_seen_at,
            updated_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW(),NOW())
        ON CONFLICT (source_key, document_url) DO UPDATE SET
            source_id = EXCLUDED.source_id,
            normalized_title = COALESCE(EXCLUDED.normalized_title, source_document_state.normalized_title),
            file_type = EXCLUDED.file_type,
            content_hash = COALESCE(EXCLUDED.content_hash, source_document_state.content_hash),
            etag = COALESCE(EXCLUDED.etag, source_document_state.etag),
            last_modified = COALESCE(EXCLUDED.last_modified, source_document_state.last_modified),
            published_date = COALESCE(EXCLUDED.published_date, source_document_state.published_date),
            effective_date = COALESCE(EXCLUDED.effective_date, source_document_state.effective_date),
            last_change_status = EXCLUDED.last_change_status,
            metadata = EXCLUDED.metadata,
            last_seen_at = NOW(),
            updated_at = NOW()
        RETURNING id
        """,
        (
            source_id,
            source_key,
            document_url,
            normalized_title,
            file_type,
            content_hash,
            etag,
            last_modified,
            published_date,
            effective_date,
            last_change_status,
            json.dumps(metadata or {}),
        ),
    )
