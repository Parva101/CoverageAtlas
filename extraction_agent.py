"""
extraction_agent.py
════════════════════
Extraction Agent: converts raw policy PDF/HTML text into normalized
coverage_rules records matching the CoverageAtlas data model.

Pipeline per document:
  raw text
    → section splitter  (heading-aware chunks)
    → Gemini extractor  (structured JSON per drug/rule)
    → schema validator  (required fields, enum checks)
    → confidence scorer (composite 0..1)
    → PostgreSQL writer (coverage_rules + policy_chunks tables)
    → Qdrant upsert     (vector index for RAG retrieval)

Usage:
    # Extract a single file
    python extraction_agent.py --file path/to/policy.pdf --payer "UnitedHealthcare" --policy-title "Ozempic Policy" --version "2026-Q1"

    # Process everything in the insurance_policies/ download folder
    python extraction_agent.py --scan-dir insurance_policies/

    # Dry run (extract + validate, no DB write)
    python extraction_agent.py --file policy.pdf --dry-run
"""

import os, re, sys, json, uuid, time, logging, argparse, hashlib
from pathlib import Path
from datetime import datetime, date
from typing import Optional

import ai_provider
import db as db_layer
try:
    import qdrant_setup as qdrant_layer
except ImportError:
    qdrant_layer = None

# ── AI models ───────────────────────────────────────────────────────────────
EXTRACT_MODEL = os.environ.get("EXTRACT_MODEL", os.environ.get("QA_MODEL", "gemini-2.5-flash"))
EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "768"))

# ── PostgreSQL ─────────────────────────────────────────────────────────────
try:
    import psycopg2
    import psycopg2.extras
    PSQL_AVAILABLE = True
except ImportError:
    PSQL_AVAILABLE = False

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/coverageatlas"
)

# ── Qdrant ─────────────────────────────────────────────────────────────────
try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance, VectorParams, PointStruct,
        Filter, FieldCondition, MatchValue
    )
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False

QDRANT_URL        = os.environ.get("QDRANT_URL", "http://10.157.92.242:6333/")
QDRANT_API_KEY    = os.environ.get("QDRANT_API_KEY", "")
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "policy_chunks")
VECTOR_DIM        = EMBEDDING_DIM

# ── PDF extraction ──────────────────────────────────────────────────────────
try:
    import pdfplumber
    PDF_LIB = "pdfplumber"
except ImportError:
    try:
        import pypdf
        PDF_LIB = "pypdf"
    except ImportError:
        PDF_LIB = None

# ── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMA — mirrors doc 05 exactly
# ══════════════════════════════════════════════════════════════════════════════

COVERAGE_STATUS_VALUES = {"covered", "restricted", "not_covered", "unknown"}

EXTRACTION_PROMPT = """
You are a medical insurance policy extraction expert.

Given the policy text below, extract EVERY drug or treatment coverage rule mentioned.
For EACH drug/treatment, output a JSON object with EXACTLY these fields:

{
  "drug_name": "string — primary drug or treatment name",
  "drug_aliases": ["list of brand names, generics, or codes mentioned"],
  "indication": "string — medical condition this coverage applies to (or null)",
  "coverage_status": "one of: covered | restricted | not_covered | unknown",
  "prior_auth_required": true | false | null,
  "step_therapy_required": true | false | null,
  "quantity_limit_text": "string describing quantity/dose limits (or null)",
  "site_of_care_text": "string describing where care must occur (or null)",
  "criteria_summary": [
    "bullet 1 — plain language criterion",
    "bullet 2 — plain language criterion"
  ],
  "citations": [
    {
      "section": "section heading or page reference",
      "snippet": "exact quote from source text, max 200 chars"
    }
  ],
  "confidence": 0.0 to 1.0
}

Rules:
- Extract ALL drugs/treatments mentioned, even if only briefly.
- If a field is genuinely unknown, use null — do NOT guess.
- coverage_status MUST be one of the four allowed values.
- criteria_summary should be plain-language bullets a non-expert can understand.
- confidence: 0.9+ if clearly stated, 0.7 if implied, 0.5 if uncertain, lower if very ambiguous.
- citations.snippet must be a real quote from the provided text.
- Output ONLY a JSON array [...] — no markdown, no preamble.

POLICY TEXT:
\"\"\"
{chunk_text}
\"\"\"
"""

CONFIDENCE_WEIGHTS = {
    "has_drug_name":       0.20,
    "has_coverage_status": 0.20,
    "has_criteria":        0.20,
    "has_citation":        0.15,
    "has_pa_field":        0.10,
    "has_indication":      0.10,
    "model_confidence":    0.05,
}


# ══════════════════════════════════════════════════════════════════════════════
# TEXT EXTRACTION FROM FILES
# ══════════════════════════════════════════════════════════════════════════════

def extract_text_from_pdf(path: Path) -> list[dict]:
    """Returns list of {page_num, text} dicts."""
    pages = []
    if PDF_LIB == "pdfplumber":
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages, 1):
                t = page.extract_text() or ""
                if t.strip():
                    pages.append({"page_num": i, "text": t})
    elif PDF_LIB == "pypdf":
        reader = pypdf.PdfReader(str(path))
        for i, page in enumerate(reader.pages, 1):
            t = page.extract_text() or ""
            if t.strip():
                pages.append({"page_num": i, "text": t})
    else:
        log.error("No PDF library available. Install pdfplumber: pip install pdfplumber")
    return pages


def extract_text_from_html(path: Path) -> list[dict]:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="ignore"), "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    return [{"page_num": 1, "text": text}]


def extract_pages(path: Path) -> list[dict]:
    if path.suffix.lower() == ".pdf":
        return extract_text_from_pdf(path)
    elif path.suffix.lower() in (".html", ".htm"):
        return extract_text_from_html(path)
    else:
        log.warning(f"Unsupported file type: {path.suffix}")
        return []


# ══════════════════════════════════════════════════════════════════════════════
# SECTION SPLITTER — heading-aware chunking
# ══════════════════════════════════════════════════════════════════════════════

HEADING_RE = re.compile(
    r'^((?:coverage criteria|prior authorization|step therapy|quantity limit|'
    r'description|indication|background|policy|criteria|requirements?|'
    r'medical necessity|clinical criteria|benefit|formulary|exclusion|'
    r'conditions?|treatment|drug name|applicable|notes?)\b.*)',
    re.IGNORECASE | re.MULTILINE
)

def split_into_sections(pages: list[dict], max_chars: int = 3000) -> list[dict]:
    """
    Splits pages into semantically meaningful sections.
    Each section: {section_title, page_num, text, char_count}
    """
    sections = []
    current_title = "Introduction"
    current_text  = []
    current_page  = 1

    def flush(title, text, page):
        combined = " ".join(text).strip()
        if len(combined) > 100:   # skip tiny fragments
            sections.append({
                "section_title": title,
                "page_num":      page,
                "text":          combined,
                "char_count":    len(combined),
            })

    for page_data in pages:
        page_num = page_data["page_num"]
        lines    = page_data["text"].split("\n")

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # Detect section headings
            if HEADING_RE.match(stripped) and len(stripped) < 120:
                flush(current_title, current_text, current_page)
                current_title = stripped
                current_text  = []
                current_page  = page_num
            else:
                current_text.append(stripped)

                # Force split if section gets too large
                combined = " ".join(current_text)
                if len(combined) >= max_chars:
                    flush(current_title, current_text, current_page)
                    current_text = []

        current_page = page_num

    flush(current_title, current_text, current_page)
    return sections


# ══════════════════════════════════════════════════════════════════════════════
# GEMINI EXTRACTION — calls LLM to extract structured rules from a section
# ══════════════════════════════════════════════════════════════════════════════

def call_gemini_extractor(chunk_text: str, retries: int = 3) -> list[dict]:
    """Calls Gemini to extract coverage_rules from a text chunk."""
    prompt = EXTRACTION_PROMPT.replace("{chunk_text}", chunk_text[:4000])

    for attempt in range(retries):
        try:
            raw = ai_provider.generate_text(
                prompt,
                model=EXTRACT_MODEL,
                temperature=0.0,
                max_output_tokens=4096,
            ).strip()

            # Strip markdown fences if present
            raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
            raw = re.sub(r'\s*```$',          '', raw, flags=re.MULTILINE)
            raw = raw.strip()

            rules = json.loads(raw)
            if isinstance(rules, dict):
                rules = [rules]   # single rule returned as object
            return rules

        except json.JSONDecodeError as e:
            log.warning(f"  JSON parse error (attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)
        except Exception as e:
            log.warning(f"  Gemini error (attempt {attempt+1}): {e}")
            time.sleep(2 ** attempt)

    return []


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMA VALIDATOR + NORMALIZER
# ══════════════════════════════════════════════════════════════════════════════

def validate_and_normalize(raw: dict, section_title: str, page_num: int) -> Optional[dict]:
    """
    Validates a raw extraction dict against the coverage_rules schema.
    Returns a clean record or None if it fails minimum requirements.
    """
    drug_name = (raw.get("drug_name") or "").strip()
    if not drug_name:
        return None   # reject: required field missing

    # Normalize coverage_status
    status = (raw.get("coverage_status") or "unknown").lower().strip()
    if status not in COVERAGE_STATUS_VALUES:
        status = "unknown"

    # Coerce booleans
    def to_bool(v):
        if isinstance(v, bool): return v
        if isinstance(v, str):  return v.lower() in ("true", "yes", "1")
        return None

    # Normalize criteria_summary to list
    criteria = raw.get("criteria_summary") or []
    if isinstance(criteria, str):
        criteria = [c.strip() for c in criteria.split("\n") if c.strip()]

    # Normalize aliases
    aliases = raw.get("drug_aliases") or []
    if isinstance(aliases, str):
        aliases = [a.strip() for a in aliases.split(",") if a.strip()]

    # Normalize citations — attach section context
    citations = raw.get("citations") or []
    for c in citations:
        c.setdefault("section", section_title)
        c.setdefault("page",    page_num)

    model_confidence = float(raw.get("confidence") or 0.5)
    model_confidence = max(0.0, min(1.0, model_confidence))

    return {
        "drug_name":            drug_name,
        "drug_aliases":         aliases,
        "indication":           (raw.get("indication") or "").strip() or None,
        "coverage_status":      status,
        "prior_auth_required":  to_bool(raw.get("prior_auth_required")),
        "step_therapy_required": to_bool(raw.get("step_therapy_required")),
        "quantity_limit_text":  (raw.get("quantity_limit_text") or "").strip() or None,
        "site_of_care_text":    (raw.get("site_of_care_text") or "").strip() or None,
        "criteria_summary":     criteria,
        "citations":            citations,
        "model_confidence":     model_confidence,
        "source_section":       section_title,
        "source_page":          page_num,
        "needs_review":         False,   # set by scorer
    }


# ══════════════════════════════════════════════════════════════════════════════
# CONFIDENCE SCORER
# ══════════════════════════════════════════════════════════════════════════════

REVIEW_THRESHOLD = 0.60

def score_confidence(rule: dict) -> dict:
    """
    Computes a composite extraction_confidence score and flags low-confidence
    records for human review.
    """
    score = 0.0
    score += CONFIDENCE_WEIGHTS["has_drug_name"]       * (1.0 if rule["drug_name"] else 0.0)
    score += CONFIDENCE_WEIGHTS["has_coverage_status"] * (1.0 if rule["coverage_status"] != "unknown" else 0.3)
    score += CONFIDENCE_WEIGHTS["has_criteria"]        * (1.0 if rule["criteria_summary"] else 0.0)
    score += CONFIDENCE_WEIGHTS["has_citation"]        * (1.0 if rule["citations"] else 0.0)
    score += CONFIDENCE_WEIGHTS["has_pa_field"]        * (1.0 if rule["prior_auth_required"] is not None else 0.0)
    score += CONFIDENCE_WEIGHTS["has_indication"]      * (1.0 if rule["indication"] else 0.5)
    score += CONFIDENCE_WEIGHTS["model_confidence"]    * rule["model_confidence"]

    rule["extraction_confidence"] = round(score, 3)
    rule["needs_review"]          = score < REVIEW_THRESHOLD
    return rule


# ══════════════════════════════════════════════════════════════════════════════
# POSTGRESQL WRITER
# ══════════════════════════════════════════════════════════════════════════════

INIT_SQL = """
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS payers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT UNIQUE NOT NULL,
    payer_type TEXT DEFAULT 'commercial',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policies (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id       UUID REFERENCES payers(id),
    policy_title   TEXT NOT NULL,
    policy_category TEXT DEFAULT 'medical_benefit',
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id      UUID REFERENCES policies(id),
    version_label  TEXT NOT NULL,
    effective_date DATE,
    source_url     TEXT,
    file_path      TEXT,
    file_sha256    TEXT,
    is_current     BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_chunks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_version_id UUID REFERENCES policy_versions(id),
    chunk_index       INTEGER,
    section_title     TEXT,
    page_number       INTEGER,
    text              TEXT,
    qdrant_point_id   TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coverage_rules (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_version_id     UUID REFERENCES policy_versions(id),
    drug_name             TEXT NOT NULL,
    drug_aliases          JSONB DEFAULT '[]',
    indication            TEXT,
    coverage_status       TEXT CHECK (coverage_status IN ('covered','restricted','not_covered','unknown')),
    prior_auth_required   BOOLEAN,
    step_therapy_required BOOLEAN,
    quantity_limit_text   TEXT,
    site_of_care_text     TEXT,
    criteria_summary      JSONB DEFAULT '[]',
    raw_evidence_ref      JSONB DEFAULT '[]',
    extraction_confidence FLOAT,
    needs_review          BOOLEAN DEFAULT FALSE,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_changes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id       UUID REFERENCES policies(id),
    from_version_id UUID REFERENCES policy_versions(id),
    to_version_id   UUID REFERENCES policy_versions(id),
    change_type     TEXT CHECK (change_type IN ('added','removed','modified')),
    field_name      TEXT,
    old_value       TEXT,
    new_value       TEXT,
    citations       JSONB DEFAULT '[]',
    detected_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cr_drug    ON coverage_rules(drug_name);
CREATE INDEX IF NOT EXISTS idx_cr_status  ON coverage_rules(coverage_status);
CREATE INDEX IF NOT EXISTS idx_cr_version ON coverage_rules(policy_version_id);
CREATE INDEX IF NOT EXISTS idx_cr_review  ON coverage_rules(needs_review) WHERE needs_review = TRUE;
"""

def get_db():
    if not PSQL_AVAILABLE:
        raise RuntimeError("psycopg2 not installed: pip install psycopg2-binary")
    return psycopg2.connect(DATABASE_URL)


def init_schema(conn):
    schema_path = Path(__file__).with_name("schema.sql")
    with schema_path.open("r", encoding="utf-8") as fh, conn.cursor() as cur:
        cur.execute(fh.read())
    conn.commit()
    log.info("PostgreSQL schema initialized.")


def upsert_payer(conn, payer_name: str) -> str:
    return db_layer.upsert_payer(conn, payer_name)


def upsert_policy(conn, payer_id: str, policy_title: str, category: str = "medical_benefit") -> str:
    return db_layer.upsert_policy(
        conn,
        payer_id,
        policy_title,
        policy_category=category,
    )


def create_policy_version(conn, policy_id: str, version_label: str,
                          document_id: str,
                          source_url: str = None,
                          effective_date: str = None) -> str:
    return db_layer.create_policy_version(
        conn,
        policy_id,
        document_id,
        version_label,
        effective_date=effective_date,
        published_date=None,
        source_url=source_url,
    )


def insert_chunk(conn, policy_version_id: str, chunk_index: int,
                 section: dict, qdrant_id: str = None) -> str:
    return db_layer.insert_chunk(
        conn,
        policy_version_id=policy_version_id,
        chunk_index=chunk_index,
        section_title=section["section_title"],
        page_number=section["page_num"],
        text=section["text"],
        embedding_id=qdrant_id,
    )


def insert_coverage_rule(conn, policy_version_id: str, rule: dict) -> str:
    return db_layer.insert_coverage_rule(conn, policy_version_id, rule)


# ══════════════════════════════════════════════════════════════════════════════
# QDRANT WRITER
# ══════════════════════════════════════════════════════════════════════════════

def get_qdrant() -> Optional["QdrantClient"]:
    if not QDRANT_AVAILABLE or qdrant_layer is None:
        log.warning("qdrant-client not installed - skipping vector index.")
        return None
    try:
        client = qdrant_layer.get_client()
        qdrant_layer.init_collection(client, reset=False)
        return client
    except Exception as e:
        log.warning(f"Qdrant unavailable: {e}")
        return None


def embed_batch(texts: list[str]) -> list[list[float]]:
    use_output_dim = EMBED_MODEL.startswith("gemini-embedding-")
    return ai_provider.embed_texts(
        texts,
        model=EMBED_MODEL,
        task_type="RETRIEVAL_DOCUMENT",
        output_dimensionality=VECTOR_DIM if use_output_dim else None,
    )


def upsert_chunks_to_qdrant(client, sections: list[dict],
                             policy_meta: dict) -> list[str]:
    """Embeds sections and upserts to Qdrant. Returns list of point IDs."""
    if not client or not sections or qdrant_layer is None:
        return []

    texts = [s["text"] for s in sections]
    vectors = embed_batch(texts)
    chunks = []

    for i, section in enumerate(sections):
        chunks.append({
            "policy_version_id": policy_meta.get("policy_version_id", ""),
            "chunk_id": str(uuid.uuid4()),
            "chunk_index": i,
            "payer_name": policy_meta.get("payer_name", ""),
            "payer_type": policy_meta.get("payer_type", "commercial"),
            "policy_title": policy_meta.get("policy_title", ""),
            "policy_category": policy_meta.get("policy_category", "medical_benefit"),
            "version_label": policy_meta.get("version_label", ""),
            "effective_date": policy_meta.get("effective_date", ""),
            "source_url": policy_meta.get("source_url", ""),
            "section_title": section["section_title"],
            "page_number": section["page_num"],
            "text": section["text"],
        })

    ids = qdrant_layer.upsert_chunks(client, chunks=chunks, embeddings=vectors)
    log.info(f"  Qdrant: upserted {len(ids)} vectors")
    return ids


# DIFF ENGINE - detects changes between policy versions
# ══════════════════════════════════════════════════════════════════════════════

COMPARABLE_FIELDS = [
    "coverage_status", "prior_auth_required", "step_therapy_required",
    "quantity_limit_text", "site_of_care_text",
]

def detect_changes(conn, policy_id: str, from_version_id: str, to_version_id: str):
    """
    Compares coverage_rules between two versions of the same policy.
    Writes change records to policy_changes table.
    """
    old_rules = {
        r["drug_name"].lower(): r
        for r in db_layer.get_rules_for_version(conn, from_version_id)
    }
    new_rules = {
        r["drug_name"].lower(): r
        for r in db_layer.get_rules_for_version(conn, to_version_id)
    }

    changes = []
    all_drugs = set(old_rules) | set(new_rules)

    for drug in all_drugs:
        if drug not in old_rules:
            changes.append(("added", drug, None, new_rules[drug]))
        elif drug not in new_rules:
            changes.append(("removed", drug, old_rules[drug], None))
        else:
            old, new = old_rules[drug], new_rules[drug]
            for field in COMPARABLE_FIELDS:
                oval = str(old.get(field) or "")
                nval = str(new.get(field) or "")
                if oval != nval:
                    changes.append(("modified", drug, old, new, field, oval, nval))

    for change in changes:
        change_type = change[0]
        drug = change[1]

        if change_type == "added":
            rule = change[3]
            db_layer.insert_policy_change(
                conn=conn,
                policy_id=policy_id,
                from_version_id=from_version_id,
                to_version_id=to_version_id,
                change_type="added",
                field_name="drug_name",
                old_value=None,
                new_value=drug,
                citations=rule.get("raw_evidence_ref") or [],
            )
        elif change_type == "removed":
            db_layer.insert_policy_change(
                conn=conn,
                policy_id=policy_id,
                from_version_id=from_version_id,
                to_version_id=to_version_id,
                change_type="removed",
                field_name="drug_name",
                old_value=drug,
                new_value=None,
                citations=[],
            )
        else:
            _, _, _, _, field, oval, nval = change
            db_layer.insert_policy_change(
                conn=conn,
                policy_id=policy_id,
                from_version_id=from_version_id,
                to_version_id=to_version_id,
                change_type="modified",
                field_name=field,
                old_value=oval,
                new_value=nval,
                citations=[],
            )

    log.info(f"  Diff: {len(changes)} changes written for policy {policy_id}")
    return changes


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE — orchestrates everything for one document
# ══════════════════════════════════════════════════════════════════════════════

def process_document(
    file_path: Path,
    payer: str,
    policy_title: str,
    version_label: str,
    source_url: str = None,
    effective_date: str = None,
    dry_run: bool = False,
    conn=None,
    qdrant_client=None,
    document_id: str = None,
) -> dict:
    """
    Full pipeline: file -> sections -> extract -> validate -> score -> DB + Qdrant.
    Returns summary dict with counts and extracted rules.
    """
    log.info(f"\n{'=' * 60}")
    log.info(f"Processing: {file_path.name}")
    log.info(f"  Payer: {payer} | Version: {version_label}")

    pages = extract_pages(file_path)
    if not pages:
        log.error("  No text extracted - skipping.")
        return {"status": "failed", "reason": "no_text", "rules": []}
    log.info(f"  Extracted {len(pages)} pages of text")

    sections = split_into_sections(pages)
    log.info(f"  Split into {len(sections)} sections")

    file_sha = hashlib.sha256(file_path.read_bytes()).hexdigest()

    policy_version_id = None
    policy_id = None
    previous_version_id = None
    qdrant_ids = []
    resolved_document_id = document_id

    if not dry_run and conn:
        payer_id = upsert_payer(conn, payer)
        payer_row = db_layer.get_payer_by_name(conn, payer)
        policy_id = upsert_policy(conn, payer_id, policy_title)
        policy_row = db_layer.get_policy(conn, policy_id) or {}
        previous_version = db_layer.get_current_version(conn, policy_id)
        previous_version_id = str(previous_version["id"]) if previous_version else None

        if resolved_document_id is None:
            suffix = file_path.suffix.lower()
            if suffix == ".pdf":
                file_type = "pdf"
            elif suffix in (".html", ".htm"):
                file_type = "html"
            elif suffix == ".docx":
                file_type = "docx"
            else:
                file_type = "other"

            resolved_document_id = db_layer.insert_document(
                conn=conn,
                file_name=file_path.name,
                file_type=file_type,
                sha256=file_sha,
                storage_path=str(file_path),
                source_url=source_url,
                payer_id=payer_id,
            )

        db_layer.update_document_status(conn, resolved_document_id, "processing")
        policy_version_id = create_policy_version(
            conn=conn,
            policy_id=policy_id,
            version_label=version_label,
            document_id=resolved_document_id,
            source_url=source_url,
            effective_date=effective_date,
        )
        conn.commit()

        if qdrant_client:
            policy_meta = {
                "policy_version_id": policy_version_id,
                "payer_name": payer,
                "payer_type": (payer_row or {}).get("payer_type", "commercial"),
                "policy_title": policy_title,
                "policy_category": policy_row.get("policy_category", "medical_benefit"),
                "version_label": version_label,
                "effective_date": effective_date or date.today().isoformat(),
                "source_url": source_url or "",
            }
            qdrant_ids = upsert_chunks_to_qdrant(qdrant_client, sections, policy_meta)

        for i, section in enumerate(sections):
            qid = qdrant_ids[i] if i < len(qdrant_ids) else None
            insert_chunk(conn, policy_version_id, i, section, qid)
        conn.commit()

    all_rules = []
    for i, section in enumerate(sections):
        log.info(f"  [{i + 1}/{len(sections)}] Extracting: {section['section_title'][:50]}")
        raw_rules = call_gemini_extractor(section["text"])
        if not raw_rules:
            continue

        for raw in raw_rules:
            validated = validate_and_normalize(raw, section["section_title"], section["page_num"])
            if validated is None:
                continue
            scored = score_confidence(validated)
            all_rules.append(scored)

            if not dry_run and conn and policy_version_id:
                insert_coverage_rule(conn, policy_version_id, scored)

        time.sleep(0.5)

    if not dry_run and conn:
        conn.commit()
        if previous_version_id and policy_version_id:
            detect_changes(
                conn=conn,
                policy_id=policy_id,
                from_version_id=previous_version_id,
                to_version_id=policy_version_id,
            )
            conn.commit()

        if resolved_document_id:
            db_layer.update_document_status(conn, resolved_document_id, "completed")
            conn.commit()

    review_count = sum(1 for r in all_rules if r["needs_review"])
    avg_conf = (
        sum(r["extraction_confidence"] for r in all_rules) / len(all_rules)
        if all_rules
        else 0
    )

    log.info(f"\n  {'-' * 40}")
    log.info(f"  Rules extracted  : {len(all_rules)}")
    log.info(f"  Needs review     : {review_count}")
    log.info(f"  Avg confidence   : {avg_conf:.2f}")
    log.info(f"  Policy version ID: {policy_version_id or 'DRY RUN'}")

    if dry_run:
        log.info("\n  [DRY RUN] Sample extracted rules:")
        for r in all_rules[:3]:
            log.info(
                f"    - {r['drug_name']} -> {r['coverage_status']} "
                f"(PA={r['prior_auth_required']}, conf={r['extraction_confidence']:.2f})"
            )

    return {
        "status": "completed",
        "file": str(file_path),
        "payer": payer,
        "version_label": version_label,
        "document_id": resolved_document_id,
        "policy_version_id": policy_version_id,
        "policy_id": policy_id,
        "sections_processed": len(sections),
        "rules_extracted": len(all_rules),
        "rules_need_review": review_count,
        "avg_confidence": round(avg_conf, 3),
        "rules": all_rules,
    }


# SCAN DIRECTORY - processes all downloaded policy files
# ══════════════════════════════════════════════════════════════════════════════

def scan_directory(root: Path, dry_run: bool = False, conn=None, qdrant=None):
    """
    Walks the insurance_policies/ folder structure:
      <root>/<PayerName>/<policy_type>/<filename>.pdf
    and processes each file it hasn't seen before (checks by SHA256).
    """
    results = []
    known_hashes = set()

    if conn:
        with conn.cursor() as cur:
            cur.execute("SELECT sha256 FROM documents WHERE sha256 IS NOT NULL")
            known_hashes = {r[0] for r in cur.fetchall()}

    for payer_dir in sorted(root.iterdir()):
        if not payer_dir.is_dir() or payer_dir.name.startswith("."):
            continue
        payer_name = payer_dir.name

        for ptype_dir in sorted(payer_dir.iterdir()):
            if not ptype_dir.is_dir():
                continue

            for file_path in sorted(ptype_dir.glob("**/*")):
                if file_path.suffix.lower() not in (".pdf", ".html", ".htm"):
                    continue

                fsha = hashlib.sha256(file_path.read_bytes()).hexdigest()
                if fsha in known_hashes:
                    log.info(f"[SKIP] Already ingested: {file_path.name}")
                    continue

                version_label = datetime.now().strftime("v%Y-%m-%d")
                result = process_document(
                    file_path     = file_path,
                    payer         = payer_name,
                    policy_title  = file_path.stem.replace("_", " "),
                    version_label = version_label,
                    dry_run       = dry_run,
                    conn          = conn,
                    qdrant_client = qdrant,
                )
                results.append(result)
                known_hashes.add(fsha)

    total_rules = sum(r.get("rules_extracted", 0) for r in results)
    log.info(f"\n{'═'*60}")
    log.info(f"Scan complete: {len(results)} files processed, {total_rules} rules extracted")
    return results


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="CoverageAtlas Extraction Agent")
    group  = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file",      type=Path, help="Single file to process")
    group.add_argument("--scan-dir",  type=Path, help="Scan entire download folder")

    parser.add_argument("--payer",         type=str, help="Payer name (for --file)")
    parser.add_argument("--policy-title",  type=str, help="Policy title (for --file)")
    parser.add_argument("--version",       type=str, default=datetime.now().strftime("v%Y-%m-%d"))
    parser.add_argument("--effective-date",type=str, default=None)
    parser.add_argument("--source-url",    type=str, default=None)
    parser.add_argument("--dry-run", action="store_true", help="Extract but don't write to DB")
    parser.add_argument("--init-schema", action="store_true", help="Initialize PostgreSQL schema")
    args = parser.parse_args()

    # ── Connect to services ──────────────────────────────────────────────────
    conn   = None
    qdrant = None

    if not args.dry_run:
        try:
            conn = get_db()
            if args.init_schema:
                init_schema(conn)
            log.info("PostgreSQL connected.")
        except Exception as e:
            log.warning(f"PostgreSQL unavailable: {e} — running without DB.")

        qdrant = get_qdrant()

    # ── Run ──────────────────────────────────────────────────────────────────
    if args.file:
        if not args.payer:
            parser.error("--payer is required with --file")
        process_document(
            file_path     = args.file,
            payer         = args.payer,
            policy_title  = args.policy_title or args.file.stem,
            version_label = args.version,
            source_url    = args.source_url,
            effective_date = args.effective_date,
            dry_run       = args.dry_run,
            conn          = conn,
            qdrant_client = qdrant,
        )
    elif args.scan_dir:
        scan_directory(args.scan_dir, dry_run=args.dry_run, conn=conn, qdrant=qdrant)

    if conn:
        conn.close()


if __name__ == "__main__":
    main()


