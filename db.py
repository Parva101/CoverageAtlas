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


def list_plans(conn) -> list[dict]:
    return fetchall(
        conn,
        """
        SELECT
            pl.id,
            pl.payer_id,
            pl.plan_name,
            pl.plan_type,
            pl.market,
            p.name AS payer_name
        FROM plans pl
        JOIN payers p ON pl.payer_id = p.id
        ORDER BY p.name, pl.plan_name
        """,
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


def list_policies_with_versions(conn) -> list[dict]:
    rows = fetchall(
        conn,
        """
        SELECT
            pol.id::text AS policy_id,
            pol.payer_id::text AS payer_id,
            p.name AS payer_name,
            pol.policy_title,
            pol.policy_category,
            pv.id::text AS version_id,
            pv.version_label,
            pv.effective_date,
            pv.published_date,
            pv.is_current,
            pv.created_at AS version_created_at
        FROM policies pol
        JOIN payers p ON pol.payer_id = p.id
        LEFT JOIN policy_versions pv ON pv.policy_id = pol.id
        ORDER BY p.name, pol.policy_title, pv.effective_date DESC NULLS LAST, pv.created_at DESC
        """,
    )

    by_policy: dict[str, dict] = {}
    for row in rows:
        policy_id = str(row["policy_id"])
        entry = by_policy.get(policy_id)
        if entry is None:
            entry = {
                "policy_id": policy_id,
                "payer_id": str(row["payer_id"]),
                "payer_name": row["payer_name"],
                "policy_title": row["policy_title"],
                "policy_category": row["policy_category"],
                "versions": [],
            }
            by_policy[policy_id] = entry

        if row.get("version_id"):
            entry["versions"].append({
                "version_id": str(row["version_id"]),
                "version_label": row.get("version_label"),
                "effective_date": row.get("effective_date"),
                "published_date": row.get("published_date"),
                "is_current": bool(row.get("is_current", False)),
            })

    return list(by_policy.values())


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


def _coerce_text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            normalized = str(item).strip()
            if normalized:
                out.append(normalized)
        return out
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, list):
                return _coerce_text_list(parsed)
        except Exception:
            pass
        return [piece.strip() for piece in stripped.split(",") if piece.strip()]
    return [str(value).strip()]


def ensure_user_profiles_table(conn):
    execute(conn, """
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id            TEXT        PRIMARY KEY,
            full_name          TEXT,
            email              TEXT,
            phone              TEXT,
            date_of_birth      DATE,
            state              TEXT,
            member_id          TEXT,
            preferred_language TEXT,
            preferred_channel  TEXT        CHECK (preferred_channel IN ('web','voice','email')),
            primary_plan_id    TEXT,
            chronic_conditions JSONB       NOT NULL DEFAULT '[]',
            medications        JSONB       NOT NULL DEFAULT '[]',
            notes              TEXT,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    execute(conn, "CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email)")
    execute(conn, "CREATE INDEX IF NOT EXISTS idx_user_profiles_plan ON user_profiles(primary_plan_id)")


def _normalize_profile_row(row: Optional[dict]) -> Optional[dict]:
    if row is None:
        return None

    normalized = dict(row)
    normalized["user_id"] = str(normalized.get("user_id") or "")
    normalized["chronic_conditions"] = _coerce_text_list(normalized.get("chronic_conditions"))
    normalized["medications"] = _coerce_text_list(normalized.get("medications"))
    dob = normalized.get("date_of_birth")
    if isinstance(dob, date):
        normalized["date_of_birth"] = dob.isoformat()
    elif dob is None:
        normalized["date_of_birth"] = None
    else:
        normalized["date_of_birth"] = str(dob)
    return normalized


def get_user_profile(conn, user_id: str) -> Optional[dict]:
    ensure_user_profiles_table(conn)
    row = fetchone(
        conn,
        "SELECT * FROM user_profiles WHERE user_id = %s",
        (user_id,),
    )
    return _normalize_profile_row(row)


def upsert_user_profile(conn, user_id: str, profile: dict) -> dict:
    ensure_user_profiles_table(conn)
    row = fetchone(
        conn,
        """
        INSERT INTO user_profiles (
            user_id, full_name, email, phone, date_of_birth, state, member_id,
            preferred_language, preferred_channel, primary_plan_id,
            chronic_conditions, medications, notes
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (user_id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            date_of_birth = EXCLUDED.date_of_birth,
            state = EXCLUDED.state,
            member_id = EXCLUDED.member_id,
            preferred_language = EXCLUDED.preferred_language,
            preferred_channel = EXCLUDED.preferred_channel,
            primary_plan_id = EXCLUDED.primary_plan_id,
            chronic_conditions = EXCLUDED.chronic_conditions,
            medications = EXCLUDED.medications,
            notes = EXCLUDED.notes,
            updated_at = NOW()
        RETURNING *
        """,
        (
            user_id,
            profile.get("full_name"),
            profile.get("email"),
            profile.get("phone"),
            profile.get("date_of_birth"),
            profile.get("state"),
            profile.get("member_id"),
            profile.get("preferred_language"),
            profile.get("preferred_channel"),
            profile.get("primary_plan_id"),
            json.dumps(_coerce_text_list(profile.get("chronic_conditions"))),
            json.dumps(_coerce_text_list(profile.get("medications"))),
            profile.get("notes"),
        ),
    )
    normalized = _normalize_profile_row(row)
    if normalized is None:
        raise RuntimeError("Profile upsert failed unexpectedly")
    return normalized


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
