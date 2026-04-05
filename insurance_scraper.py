"""
insurance_scraper.py

Daily incremental sync for CoverageAtlas:
1) Discover policy document URLs from payer index pages
2) Download new/changed files to insurance_policies/
3) Run extraction_agent.process_document(...) to write:
   - structured policy rules -> PostgreSQL
   - chunk embeddings -> Qdrant
"""

import argparse
from collections import deque
import hashlib
import json
import logging
import os
import re
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from tqdm import tqdm

import extraction_agent
try:
    from qdrant_client.models import FieldCondition, Filter, MatchValue
except Exception:
    FieldCondition = Filter = MatchValue = None

load_dotenv()

BASE_DIR = Path("insurance_policies")
DB_PATH = BASE_DIR / "registry.db"
LOG_DIR = Path("logs")
RUN_LOG = BASE_DIR / "run_history.json"

BASE_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / f"sync_{datetime.now().strftime('%Y%m%d')}.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    }
)


def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS policies (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            url                TEXT UNIQUE NOT NULL,
            url_hash           TEXT UNIQUE NOT NULL,
            payer              TEXT NOT NULL,
            policy_type        TEXT NOT NULL,
            title              TEXT,
            local_path         TEXT,
            file_hash          TEXT,
            sections_processed INTEGER DEFAULT 0,
            rules_extracted    INTEGER DEFAULT 0,
            status             TEXT DEFAULT 'queued',
            last_error         TEXT,
            first_seen         TEXT NOT NULL,
            last_checked       TEXT NOT NULL,
            last_ingested      TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at        TEXT,
            new_docs      INTEGER DEFAULT 0,
            failed_docs   INTEGER DEFAULT 0,
            total_checked INTEGER DEFAULT 0,
            duration_sec  REAL
        );

        CREATE INDEX IF NOT EXISTS idx_policies_url_hash ON policies(url_hash);
        """
    )
    conn.commit()
    return conn


def md5(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_registry_row(conn: sqlite3.Connection, url: str):
    return conn.execute(
        "SELECT * FROM policies WHERE url_hash=?",
        (md5(url),),
    ).fetchone()


def upsert_registry(
    conn: sqlite3.Connection,
    doc: dict,
    *,
    local_path: Path,
    file_hash: str,
    sections_processed: int,
    rules_extracted: int,
    status: str,
    last_error: str | None,
    mark_ingested: bool,
):
    now = datetime.now().isoformat()
    last_ingested = now if mark_ingested else None
    conn.execute(
        """
        INSERT INTO policies (
            url, url_hash, payer, policy_type, title,
            local_path, file_hash, sections_processed, rules_extracted,
            status, last_error, first_seen, last_checked, last_ingested
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(url_hash) DO UPDATE SET
            payer=excluded.payer,
            policy_type=excluded.policy_type,
            title=excluded.title,
            local_path=excluded.local_path,
            file_hash=excluded.file_hash,
            sections_processed=excluded.sections_processed,
            rules_extracted=excluded.rules_extracted,
            status=excluded.status,
            last_error=excluded.last_error,
            last_checked=excluded.last_checked,
            last_ingested=COALESCE(excluded.last_ingested, policies.last_ingested)
        """,
        (
            doc["url"],
            md5(doc["url"]),
            doc.get("payer", "unknown"),
            doc.get("policy_type", "unknown"),
            doc.get("title", ""),
            str(local_path),
            file_hash,
            int(sections_processed),
            int(rules_extracted),
            status,
            (last_error or "")[:1000] or None,
            now,
            now,
            last_ingested,
        ),
    )
    conn.commit()


def mark_seen(conn: sqlite3.Connection, url: str):
    conn.execute(
        "UPDATE policies SET last_checked=? WHERE url_hash=?",
        (datetime.now().isoformat(), md5(url)),
    )
    conn.commit()


def sanitize(value: str) -> str:
    cleaned = re.sub(r"[\\/*?:\"<>|]", "_", str(value or "")).strip()
    return cleaned[:150] or "untitled"


def is_supported_href(href: str) -> bool:
    if not href:
        return False
    value = href.strip()
    if not value:
        return False
    lowered = value.lower()
    if lowered.startswith(("mailto:", "javascript:", "tel:", "#")):
        return False
    return True


def is_pdf_href(href: str) -> bool:
    if not is_supported_href(href):
        return False
    parsed = urlparse(href.strip())
    path = (parsed.path or href).lower()
    return path.endswith(".pdf") or ".pdf" in path


UHC_BASE = "https://www.uhcprovider.com"
UHC_LISTINGS = {
    "drug": "https://www.uhcprovider.com/en/policies-protocols/commercial-policies/commercial-medical-drug-policies.html",
    "medical": "https://www.uhcprovider.com/en/policies-protocols/commercial-policies/commercial-medical-policies.html",
    "medicare_drug": "https://www.uhcprovider.com/en/policies-protocols/medicare-advantage-policies/ma-medical-drug-policies.html",
    "medicare_medical": "https://www.uhcprovider.com/en/policies-protocols/medicare-advantage-policies/ma-medical-policies.html",
}
UHC_BULLETIN = "https://www.uhcprovider.com/content/dam/provider/docs/public/policies/mpub-archives/commercial/"


def discover_uhc() -> list[dict]:
    payer = "UnitedHealthcare"
    docs: list[dict] = []

    for year in [datetime.now().year, datetime.now().year - 1]:
        for month in MONTHS:
            docs.append(
                {
                    "url": f"{UHC_BULLETIN}medical-policy-update-bulletin-{month}-{year}.pdf",
                    "title": f"UHC Bulletin {month.title()} {year}",
                    "policy_type": "bulletin",
                    "payer": payer,
                }
            )

    for policy_type, url in UHC_LISTINGS.items():
        try:
            response = SESSION.get(url, timeout=20)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            for anchor in soup.find_all("a", href=True):
                href = anchor["href"]
                if is_pdf_href(href):
                    docs.append(
                        {
                            "url": urljoin(UHC_BASE, href),
                            "title": anchor.get_text(strip=True) or Path(href).stem,
                            "policy_type": policy_type,
                            "payer": payer,
                        }
                    )
            time.sleep(1)
        except Exception as exc:
            log.warning("[UHC] %s: %s", policy_type, exc)

    return dedupe(docs)


def discover_aetna() -> list[dict]:
    payer = "Aetna"
    base = "https://www.aetna.com"
    docs: list[dict] = []

    endpoints = {
        "medical": "https://www.aetna.com/cpb/medical/data/cpb_alpha.html",
        "drug": "https://www.aetna.com/health-care-professionals/clinical-policy-bulletins/medical-clinical-policy-bulletins.html",
    }

    for policy_type, url in endpoints.items():
        try:
            response = SESSION.get(url, timeout=20)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            for anchor in soup.find_all("a", href=True):
                href = anchor["href"].strip()
                if not is_supported_href(href):
                    continue

                full_url = urljoin(base, href)
                lower_url = full_url.lower()

                if "/cpb/" not in lower_url:
                    continue
                if any(token in lower_url for token in ["cpb_alpha", "faqs", "what-s-new", "whats-new", "search-by-title"]):
                    continue
                if policy_type == "medical" and not re.search(r"/cpb/medical/data/.+\.html?$", lower_url):
                    continue

                docs.append(
                    {
                        "url": full_url,
                        "title": anchor.get_text(strip=True),
                        "policy_type": policy_type,
                        "type": "html",
                        "payer": payer,
                    }
                )
            time.sleep(1)
        except Exception as exc:
            log.warning("[Aetna] %s: %s", policy_type, exc)

    return dedupe(docs)


def discover_cigna() -> list[dict]:
    payer = "Cigna"
    static = "https://static.cigna.com"
    docs: list[dict] = []

    for year in [datetime.now().year, datetime.now().year - 1]:
        for month in MONTHS:
            docs.append(
                {
                    "url": f"https://static.cigna.com/assets/chcp/pdf/coveragePolicies/policy_updates/{month}_{year}_policy_updates.pdf",
                    "title": f"Cigna Policy Updates {month.title()} {year}",
                    "policy_type": "bulletin",
                    "payer": payer,
                }
            )

    endpoints = {
        "drug": "https://static.cigna.com/assets/chcp/resourceLibrary/coveragePolicies/pharmacy_a-z.html",
        "medical": "https://static.cigna.com/assets/chcp/resourceLibrary/coveragePolicies/medical_a-z.html",
    }

    for policy_type, url in endpoints.items():
        try:
            response = SESSION.get(url, timeout=20)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            for anchor in soup.find_all("a", href=True):
                href = anchor["href"]
                if is_pdf_href(href):
                    docs.append(
                        {
                            "url": urljoin(static, href),
                            "title": anchor.get_text(strip=True) or Path(href).stem,
                            "policy_type": policy_type,
                            "payer": payer,
                        }
                    )
            time.sleep(1)
        except Exception as exc:
            log.warning("[Cigna] %s: %s", policy_type, exc)

    return dedupe(docs)


def discover_humana() -> list[dict]:
    payer = "Humana"
    docs: list[dict] = [
        {
            "url": "https://assets.humana.com/is/content/humana/FINAL589003ALL1024_2025_ProviderManualNonDelegatedpdf",
            "title": "Humana 2025 Provider Manual",
            "policy_type": "medical",
            "payer": payer,
        }
    ]

    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        for policy_type in ["drug", "medical"]:
            try:
                url = (
                    "https://mcp.humana.com/tad/tad_new/Search.aspx?"
                    f"searchtype=beginswith&docbegin={letter}&policyType={policy_type}"
                )
                response = SESSION.get(url, timeout=15)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, "html.parser")
                for anchor in soup.find_all("a", href=True):
                    href = anchor["href"].strip()
                    title = anchor.get_text(strip=True)
                    if len(title) <= 3:
                        continue
                    if not is_supported_href(href):
                        continue

                    full_url = urljoin("https://mcp.humana.com", href)
                    lower_url = full_url.lower()
                    lower_title = title.lower()

                    if any(token in lower_url for token in ["home.aspx", "search.aspx", "hmcpinquiry", "contact-us"]):
                        continue
                    if lower_title in {"effective date", "policy name", "reviewed date"}:
                        continue
                    if not (is_pdf_href(href) or "policy" in lower_url):
                        continue

                    docs.append(
                        {
                            "url": full_url,
                            "title": title,
                            "policy_type": policy_type,
                            "payer": payer,
                        }
                    )
                time.sleep(0.4)
            except Exception as exc:
                log.warning("[Humana] %s/%s: %s", letter, policy_type, exc)

    return dedupe(docs)


BCBS_CHAPTERS = [
    {
        "name": "BCBS Massachusetts",
        "base": "https://www.bluecrossma.org",
        "medical_url": "https://www.bluecrossma.org/medical-policies/",
        "drug_url": "https://www.bluecrossma.org/medication/",
    },
    {
        "name": "CareFirst BCBS",
        "base": "https://provider.carefirst.com",
        "medical_url": "https://provider.carefirst.com/providers/medical/medical-policy.page",
        "drug_url": None,
    },
    {
        "name": "Excellus BCBS",
        "base": "https://www.excellusbcbs.com",
        "medical_url": "https://www.excellusbcbs.com/health-wellness/medical-policies",
        "drug_url": "https://www.excellusbcbs.com/health-wellness/drug-policies",
    },
    {
        "name": "BCBS Michigan",
        "base": "https://www.bcbsm.com",
        "medical_url": "https://www.bcbsm.com/providers/clinical-criteria/",
        "drug_url": "https://www.bcbsm.com/individuals/resources/forms-documents/drug-lists/",
    },
    {
        "name": "BCBS Texas",
        "base": "https://www.bcbstx.com",
        "medical_url": "https://www.bcbstx.com/provider/clinical/index.html",
        "drug_url": "https://www.bcbstx.com/prescription-drugs/managing-prescriptions/drug-lists",
    },
]


def discover_bcbs() -> list[dict]:
    payer = "BCBS"
    docs: list[dict] = []

    for chapter in BCBS_CHAPTERS:
        for policy_type in ["drug", "medical"]:
            url = chapter.get(f"{policy_type}_url")
            if not url:
                continue
            try:
                response = SESSION.get(url, timeout=20)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, "html.parser")
                for anchor in soup.find_all("a", href=True):
                    href = anchor["href"]
                    if is_pdf_href(href):
                        docs.append(
                            {
                                "url": urljoin(chapter["base"], href),
                                "title": f"[{chapter['name']}] {anchor.get_text(strip=True)}",
                                "policy_type": policy_type,
                                "payer": payer,
                            }
                        )
                time.sleep(1)
            except Exception as exc:
                log.warning("[%s] %s: %s", chapter["name"], policy_type, exc)

    return dedupe(docs)


DISCOVERERS = {
    "uhc": discover_uhc,
    "aetna": discover_aetna,
    "cigna": discover_cigna,
    "humana": discover_humana,
    "bcbs": discover_bcbs,
}


def normalize_category(policy_type: str) -> str:
    value = (policy_type or "").strip().lower()
    if not value:
        return "other"
    if "drug" in value or "formulary" in value or "pharmacy" in value:
        return "drug"
    if "medical" in value or "service" in value:
        return "service"
    return "other"


def filter_docs_by_category(docs: list[dict], category: str) -> list[dict]:
    target = (category or "all").strip().lower()
    if target in {"", "all"}:
        return docs
    return [doc for doc in docs if normalize_category(str(doc.get("policy_type", ""))) == target]


def interleave_docs_by_payer(docs_by_payer: dict[str, list[dict]]) -> list[dict]:
    keys = list(docs_by_payer.keys())
    queues = {k: deque(v) for k, v in docs_by_payer.items()}
    merged: list[dict] = []
    while True:
        progressed = False
        for key in keys:
            q = queues[key]
            if not q:
                continue
            merged.append(q.popleft())
            progressed = True
        if not progressed:
            break
    return merged


def dedupe(docs: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for doc in docs:
        url = doc.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(doc)
    return out


def configure_models(args: argparse.Namespace):
    if args.vertex:
        os.environ["AI_USE_VERTEX"] = "1"
    if args.vertex_location:
        os.environ["GOOGLE_CLOUD_LOCATION"] = args.vertex_location

    os.environ["EXTRACT_MODEL"] = args.extract_model
    os.environ["QA_MODEL"] = args.qa_model
    os.environ["EMBEDDING_MODEL"] = args.embedding_model
    os.environ["EMBEDDING_DIM"] = str(args.embedding_dim)

    extraction_agent.EXTRACT_MODEL = os.environ.get("EXTRACT_MODEL", extraction_agent.EXTRACT_MODEL)
    extraction_agent.EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", extraction_agent.EMBED_MODEL)
    extraction_agent.EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", str(extraction_agent.EMBEDDING_DIM)))
    extraction_agent.VECTOR_DIM = extraction_agent.EMBEDDING_DIM


def process_doc(
    doc: dict,
    registry_conn: sqlite3.Connection,
    pg_conn,
    qdrant_client,
    *,
    dry_run: bool,
    delay: float,
    recheck_known: bool,
    skip_existing_vectors: bool,
) -> tuple[bool, bool]:
    """
    Download + full extraction pipeline.
    Returns: (ok, is_new_or_changed)
    """
    url = doc["url"]
    is_html = doc.get("type") == "html" or url.lower().endswith((".html", ".htm"))
    title = sanitize(doc.get("title", "untitled"))
    policy_type = sanitize(doc.get("policy_type", "unknown"))
    payer = sanitize(doc.get("payer", "unknown"))

    dest_dir = BASE_DIR / payer / policy_type
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{title}{'.html' if is_html else '.pdf'}"

    existing = get_registry_row(registry_conn, url)
    if existing and dest.exists() and not recheck_known and existing["status"] == "completed":
        mark_seen(registry_conn, url)
        return True, False

    # Fast-skip if this source URL is already present in vector store.
    # This avoids re-ingesting known documents when local sqlite registry is incomplete.
    if skip_existing_vectors and qdrant_client and source_exists_in_qdrant(qdrant_client, url):
        upsert_registry(
            registry_conn,
            doc,
            local_path=dest,
            file_hash=(existing["file_hash"] if existing and existing["file_hash"] else ""),
            sections_processed=int(existing["sections_processed"]) if existing else 0,
            rules_extracted=int(existing["rules_extracted"]) if existing else 0,
            status="completed",
            last_error=None,
            mark_ingested=True,
        )
        log.info("[SKIP EXISTING VECTOR] %s", url)
        return True, False

    download_candidates = [url]
    if url.startswith("http://"):
        download_candidates.append("https://" + url[len("http://"):])

    effective_url = url
    download_error = None
    for candidate in download_candidates:
        try:
            response = SESSION.get(candidate, timeout=40, stream=not is_html)
            response.raise_for_status()
            effective_url = response.url or candidate
            if is_html:
                dest.write_text(response.text, encoding="utf-8")
            else:
                with dest.open("wb") as handle:
                    for chunk in response.iter_content(8192):
                        if chunk:
                            handle.write(chunk)
            if delay > 0:
                time.sleep(delay)
            download_error = None
            break
        except Exception as exc:
            download_error = exc
            continue

    if download_error is not None:
        log.error("[DOWNLOAD FAIL] %s: %s", url, download_error)
        upsert_registry(
            registry_conn,
            doc,
            local_path=dest,
            file_hash="",
            sections_processed=0,
            rules_extracted=0,
            status="failed",
            last_error=f"download_failed: {download_error}",
            mark_ingested=False,
        )
        return False, True

    file_hash = sha256(dest)
    if existing and existing["file_hash"] == file_hash and existing["status"] == "completed" and not recheck_known:
        mark_seen(registry_conn, url)
        return True, False

    if dry_run:
        upsert_registry(
            registry_conn,
            doc,
            local_path=dest,
            file_hash=file_hash,
            sections_processed=0,
            rules_extracted=0,
            status="queued",
            last_error=None,
            mark_ingested=False,
        )
        return True, True

    try:
        result = extraction_agent.process_document(
            file_path=dest,
            payer=doc.get("payer", "Unknown Payer"),
            policy_title=doc.get("title") or title,
            version_label=datetime.now().strftime("v%Y-%m-%d"),
            source_url=effective_url,
            effective_date=doc.get("effective_date"),
            dry_run=False,
            conn=pg_conn,
            qdrant_client=qdrant_client,
            document_id=None,
        )

        if result.get("status") != "completed":
            raise RuntimeError(f"pipeline_status={result.get('status')}")

        upsert_registry(
            registry_conn,
            doc,
            local_path=dest,
            file_hash=file_hash,
            sections_processed=int(result.get("sections_processed") or 0),
            rules_extracted=int(result.get("rules_extracted") or 0),
            status="completed",
            last_error=None,
            mark_ingested=True,
        )
        return True, True
    except Exception as exc:
        log.error("[INGEST FAIL] %s: %s", url, exc)
        upsert_registry(
            registry_conn,
            doc,
            local_path=dest,
            file_hash=file_hash,
            sections_processed=0,
            rules_extracted=0,
            status="failed",
            last_error=f"ingest_failed: {exc}",
            mark_ingested=False,
        )
        return False, True


def source_exists_in_qdrant(qdrant_client, source_url: str) -> bool:
    if not qdrant_client or not source_url:
        return False

    collection = os.environ.get("QDRANT_COLLECTION", "policy_chunks")
    source_url = source_url.strip()
    if not source_url:
        return False

    try:
        if Filter and FieldCondition and MatchValue:
            q_filter = Filter(
                must=[FieldCondition(key="source_url", match=MatchValue(value=source_url))]
            )
            try:
                count_resp = qdrant_client.count(
                    collection_name=collection,
                    count_filter=q_filter,
                    exact=False,
                )
            except TypeError:
                count_resp = qdrant_client.count(
                    collection_name=collection,
                    filter=q_filter,
                    exact=False,
                )

            count_val = getattr(count_resp, "count", None)
            if count_val is None and isinstance(count_resp, dict):
                count_val = count_resp.get("count")
            if int(count_val or 0) > 0:
                return True

            points, _ = qdrant_client.scroll(
                collection_name=collection,
                scroll_filter=q_filter,
                with_payload=False,
                with_vectors=False,
                limit=1,
            )
            return bool(points)

        # Fallback path if model classes are unavailable.
        points, _ = qdrant_client.scroll(
            collection_name=collection,
            scroll_filter={
                "must": [{"key": "source_url", "match": {"value": source_url}}],
            },
            with_payload=False,
            with_vectors=False,
            limit=1,
        )
        return bool(points)
    except Exception as exc:
        log.debug("source_exists_in_qdrant failed for %s: %s", source_url, exc)
        return False

def main():
    parser = argparse.ArgumentParser(description="Insurance policy sync -> Postgres + Qdrant")
    parser.add_argument("--payers", nargs="+", default=list(DISCOVERERS.keys()), choices=list(DISCOVERERS.keys()))
    parser.add_argument(
        "--category",
        choices=["all", "drug", "service", "other"],
        default="all",
        help="Process documents by category across all payers.",
    )
    parser.add_argument(
        "--balance-across-payers",
        dest="balance_across_payers",
        action="store_true",
        default=True,
        help="Round-robin document processing across selected payers (default: on).",
    )
    parser.add_argument(
        "--no-balance-across-payers",
        dest="balance_across_payers",
        action="store_false",
        help="Process payer-by-payer order instead of round-robin.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Discover + download only, skip ingestion")
    parser.add_argument("--force", action="store_true", help="Clear registry and re-run from scratch")
    parser.add_argument("--recheck-known", action="store_true", help="Re-download known URLs to detect changes")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between document downloads")
    parser.add_argument("--max-new-docs", type=int, default=0, help="Stop after ingesting this many new/changed docs (0=unlimited)")
    parser.add_argument("--max-per-payer", type=int, default=0, help="Limit discovered docs processed per payer (0=all)")
    parser.add_argument("--init-schema", action="store_true", help="Initialize PostgreSQL schema before run")
    parser.add_argument(
        "--skip-existing-vectors",
        dest="skip_existing_vectors",
        action="store_true",
        default=True,
        help="Skip ingestion when source_url already exists in Qdrant (default: on).",
    )
    parser.add_argument(
        "--no-skip-existing-vectors",
        dest="skip_existing_vectors",
        action="store_false",
        help="Disable source_url-based skip check in Qdrant.",
    )

    parser.add_argument("--vertex", dest="vertex", action="store_true", default=True, help="Use Vertex AI for extraction/embeddings")
    parser.add_argument("--no-vertex", dest="vertex", action="store_false", help="Do not force Vertex override")
    parser.add_argument("--vertex-required", action="store_true", help="Fail if Vertex access is unavailable (no API-key fallback)")
    parser.add_argument("--vertex-location", type=str, default="", help="Optional Vertex location override (e.g. global)")
    parser.add_argument("--extract-model", type=str, default="gemini-3-flash-preview")
    parser.add_argument("--qa-model", type=str, default=os.environ.get("QA_MODEL", "gemini-2.5-flash"))
    parser.add_argument("--embedding-model", type=str, default=os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001"))
    parser.add_argument("--embedding-dim", type=int, default=int(os.environ.get("EMBEDDING_DIM", "768")))

    args = parser.parse_args()

    configure_models(args)

    log.info("=" * 72)
    log.info("Insurance Policy Sync -> Postgres + Qdrant  [%s]", datetime.now().strftime("%Y-%m-%d %H:%M"))
    log.info(
        "Payers=%s | Category=%s | DryRun=%s | Force=%s | RecheckKnown=%s",
        args.payers,
        args.category,
        args.dry_run,
        args.force,
        args.recheck_known,
    )
    log.info("BalanceAcrossPayers=%s", args.balance_across_payers)
    log.info("SkipExistingVectors=%s", args.skip_existing_vectors)
    log.info("AI_USE_VERTEX=%s | EXTRACT_MODEL=%s | EMBEDDING_MODEL=%s", os.environ.get("AI_USE_VERTEX"), os.environ.get("EXTRACT_MODEL"), os.environ.get("EMBEDDING_MODEL"))
    log.info("=" * 72)

    registry_conn = init_db()
    pg_conn = None
    qdrant_client = None

    if args.force:
        registry_conn.execute("DELETE FROM policies")
        registry_conn.commit()
        log.info("Force mode: registry cleared.")

    if not args.dry_run:
        pg_conn = extraction_agent.get_db()
        if args.init_schema:
            extraction_agent.init_schema(pg_conn)
        qdrant_client = extraction_agent.get_qdrant()
        if qdrant_client is None:
            raise RuntimeError("Qdrant client unavailable. Check QDRANT_URL and connectivity.")

        # Early AI connectivity check so failures happen before long ingest loops.
        try:
            extraction_agent.embed_batch(["coverage atlas ingestion smoke test"])
        except Exception as exc:
            message = str(exc)
            is_vertex_permission = "PERMISSION_DENIED" in message or "aiplatform.endpoints.predict" in message
            if args.vertex and is_vertex_permission and not args.vertex_required:
                log.warning("Vertex permission denied. Falling back to Gemini API key for this run.")
                os.environ["AI_USE_VERTEX"] = "0"
                extraction_agent.ai_provider.get_client.cache_clear()
                extraction_agent.embed_batch(["coverage atlas ingestion smoke test"])
                log.info("Fallback active: AI_USE_VERTEX=%s", os.environ.get("AI_USE_VERTEX"))
            else:
                raise

    start = datetime.now()
    totals = {"new": 0, "fail": 0, "checked": 0}
    new_docs_log: list[dict] = []
    docs_by_payer: dict[str, list[dict]] = {}

    for payer_key in args.payers:
        log.info("\n-- Discovering: %s --", payer_key.upper())
        try:
            docs = DISCOVERERS[payer_key]()
        except Exception as exc:
            log.error("Discovery error [%s]: %s", payer_key, exc)
            totals["fail"] += 1
            continue

        docs = filter_docs_by_category(docs, args.category)
        if args.max_per_payer and args.max_per_payer > 0:
            docs = docs[: args.max_per_payer]
        totals["checked"] += len(docs)

        docs_by_payer[payer_key] = docs

        if args.dry_run:
            new_for_payer = [d for d in docs if get_registry_row(registry_conn, d["url"]) is None]
            log.info(
                "  %s URLs found in category '%s' | %s new (dry-run)",
                len(docs),
                args.category,
                len(new_for_payer),
            )
            for doc in new_for_payer:
                log.info("  [DRY-RUN] [%s] %s", doc.get("payer"), (doc.get("title") or "")[:80])

    if not args.dry_run:
        if args.balance_across_payers:
            queue = interleave_docs_by_payer(docs_by_payer)
        else:
            queue = []
            for payer_key in args.payers:
                queue.extend(docs_by_payer.get(payer_key, []))

        stop = False
        for doc in tqdm(queue, desc=f"{args.category}"):
            ok, is_new_or_changed = process_doc(
                doc,
                registry_conn,
                pg_conn,
                qdrant_client,
                dry_run=False,
                delay=args.delay,
                recheck_known=args.recheck_known,
                skip_existing_vectors=args.skip_existing_vectors,
            )
            if ok and is_new_or_changed:
                totals["new"] += 1
                new_docs_log.append(doc)
            if not ok:
                totals["fail"] += 1

            if args.max_new_docs and args.max_new_docs > 0 and totals["new"] >= args.max_new_docs:
                log.info("Reached --max-new-docs=%s, stopping early.", args.max_new_docs)
                stop = True
                break

        if stop:
            log.info("Stopped early after reaching max-new-docs.")

    duration = (datetime.now() - start).total_seconds()

    registry_conn.execute(
        "INSERT INTO sync_runs (run_at,new_docs,failed_docs,total_checked,duration_sec) VALUES (?,?,?,?,?)",
        (start.isoformat(), totals["new"], totals["fail"], totals["checked"], duration),
    )
    registry_conn.commit()

    history = json.loads(RUN_LOG.read_text()) if RUN_LOG.exists() else []
    history.append(
        {
            "run_at": start.isoformat(),
            **totals,
            "new_titles": [doc.get("title", "") for doc in new_docs_log],
            "dry_run": args.dry_run,
            "vertex": args.vertex,
            "extract_model": os.environ.get("EXTRACT_MODEL"),
        }
    )
    RUN_LOG.write_text(json.dumps(history[-90:], indent=2), encoding="utf-8")

    log.info("\n" + "=" * 72)
    log.info("SYNC COMPLETE")
    log.info("  Duration      : %.1fs", duration)
    log.info("  Total checked : %s", totals["checked"])
    log.info("  New/changed   : %s", totals["new"])
    log.info("  Failed        : %s", totals["fail"])
    if new_docs_log:
        log.info("\n  NEW/CHANGED DOCUMENTS THIS RUN:")
        for doc in new_docs_log[:40]:
            log.info("    [%s] %s", doc.get("payer"), (doc.get("title") or "")[:70])
        if len(new_docs_log) > 40:
            log.info("    ... and %s more", len(new_docs_log) - 40)
    else:
        log.info("\n  No new/changed documents ingested.")
    log.info("=" * 72)

    registry_conn.close()
    if pg_conn is not None:
        pg_conn.close()


if __name__ == "__main__":
    main()
