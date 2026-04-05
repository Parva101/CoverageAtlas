"""
cms_loader.py
═════════════
Downloads CMS Medicare Part D formulary data and loads it into
CoverageAtlas PostgreSQL + Qdrant.

Data sources:
  - CMS Monthly Formulary PUF (plan_information.txt + basic_drugs_formulary.txt)
  - NLM RxNorm API (drug name lookup by RXCUI)

Usage:
    python cms_loader.py                    # download + load everything
    python cms_loader.py --dry-run          # download + parse, no DB write
    python cms_loader.py --limit 5000       # load only first N formulary rows
    python cms_loader.py --payer "UnitedHealthcare"  # filter to one payer
"""

import os, sys, csv, json, uuid, time, zipfile, logging, argparse, io
from pathlib import Path
from datetime import date
from typing import Optional

import requests

# ── DB / Qdrant ────────────────────────────────────────────────────────────
import db as db_layer
try:
    import qdrant_setup as qdrant_layer
except ImportError:
    qdrant_layer = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────
CMS_ZIP_URL      = "https://data.cms.gov/sites/default/files/2026-03/1d9ac9d7-b372-48ac-b7a9-8d9e356216f8/2026_20260318.zip"
CMS_PLAN_INFO_URL = "https://data.cms.gov/sites/default/files/2026-01/5942aa7e-a0c4-4e65-bd56-32608c33649f/SPUF_2026_20260107.zip"
RXNORM_URL    = "https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/property?propName=RxNorm+Name"
CACHE_DIR     = Path("cms_cache")
CACHE_DIR.mkdir(exist_ok=True)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
EMBED_MODEL    = "models/gemini-embedding-001"
VECTOR_DIM     = 768

# Tier → coverage_status mapping
TIER_STATUS = {
    "1": "covered",    # preferred generic
    "2": "covered",    # generic
    "3": "restricted", # preferred brand
    "4": "restricted", # non-preferred brand
    "5": "restricted", # specialty
    "6": "restricted", # select care
}

# Known payer name keywords → normalized name
PAYER_NORMALIZE = {
    "unitedhealthcare": "UnitedHealthcare",
    "united health":    "UnitedHealthcare",
    "aetna":            "Aetna",
    "humana":           "Humana",
    "cigna":            "Cigna",
    "cvs":              "CVS / Caremark",
    "caremark":         "CVS / Caremark",
    "wellcare":         "WellCare",
    "anthem":           "Anthem",
    "bcbs":             "Blue Cross Blue Shield",
    "blue cross":       "Blue Cross Blue Shield",
    "kaiser":           "Kaiser Permanente",
    "molina":           "Molina Healthcare",
    "centene":          "Centene",
    "silverscript":     "SilverScript",
}

# ── RxNorm drug name cache ─────────────────────────────────────────────────
_rxcui_cache: dict[str, str] = {}
_rxcui_cache_file = CACHE_DIR / "rxcui_names.json"

def _load_rxcui_cache():
    global _rxcui_cache
    if _rxcui_cache_file.exists():
        _rxcui_cache = json.loads(_rxcui_cache_file.read_text())
        log.info(f"Loaded {len(_rxcui_cache):,} cached drug names")

def _save_rxcui_cache():
    _rxcui_cache_file.write_text(json.dumps(_rxcui_cache))

def get_drug_name(rxcui: str) -> str:
    """Resolve RXCUI → drug name via NLM RxNorm API (cached)."""
    if rxcui in _rxcui_cache:
        return _rxcui_cache[rxcui]
    try:
        r = requests.get(
            f"https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/property.json?propName=RxNorm+Name",
            timeout=10
        )
        if r.status_code == 200:
            props = r.json().get("propConceptGroup", {}).get("propConcept", [])
            if props:
                name = props[0].get("propValue", f"RXCUI:{rxcui}")
                _rxcui_cache[rxcui] = name
                return name
    except Exception:
        pass
    name = f"RXCUI:{rxcui}"
    _rxcui_cache[rxcui] = name
    return name

def normalize_payer(contract_name: str) -> str:
    lower = contract_name.lower()
    for key, norm in PAYER_NORMALIZE.items():
        if key in lower:
            return norm
    # Title-case fallback
    return contract_name.strip().title()

# ── Download + extract ZIP ─────────────────────────────────────────────────
def download_cms_zip(url: str) -> Path:
    zip_path = CACHE_DIR / "cms_formulary.zip"
    if zip_path.exists():
        log.info(f"Using cached ZIP: {zip_path}")
        return zip_path
    log.info(f"Downloading CMS formulary ZIP (~500MB, please wait)...")
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        downloaded = 0
        with open(zip_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    print(f"\r  {pct:.1f}% ({downloaded // 1024 // 1024}MB / {total // 1024 // 1024}MB)", end="")
    print()
    log.info(f"Downloaded to {zip_path}")
    return zip_path

def extract_file(zip_path: Path, filename: str) -> Path:
    """Extract a file from a ZIP, handling nested ZIPs automatically."""
    out_path = CACHE_DIR / filename
    if out_path.exists():
        log.info(f"Using cached: {filename}")
        return out_path
    log.info(f"Extracting {filename}...")
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        # Direct match
        match = next((n for n in names if filename.lower() in n.lower()), None)
        if match:
            zf.extract(match, CACHE_DIR)
            extracted = CACHE_DIR / match
            if extracted != out_path:
                extracted.rename(out_path)
            log.info(f"Extracted: {out_path}")
            return out_path

        # Look inside nested ZIPs
        nested_zips = [n for n in names if n.endswith(".zip")]
        for nested_name in nested_zips:
            keyword = filename.lower().replace(".txt", "").replace("_", " ")
            if any(k in nested_name.lower() for k in keyword.split()):
                log.info(f"  Looking in nested ZIP: {nested_name}")
                nested_data = zf.read(nested_name)
                with zipfile.ZipFile(io.BytesIO(nested_data)) as inner_zf:
                    inner_names = inner_zf.namelist()
                    inner_match = next((n for n in inner_names if filename.lower() in n.lower()), None)
                    if not inner_match:
                        # Take any .txt file
                        inner_match = next((n for n in inner_names if n.endswith(".txt")), None)
                    if inner_match:
                        data = inner_zf.read(inner_match)
                        out_path.write_bytes(data)
                        log.info(f"Extracted from nested ZIP: {out_path} ({len(data)//1024//1024}MB)")
                        return out_path

        log.error(f"  {filename} not found. Top-level entries: {names}")
        raise FileNotFoundError(f"{filename} not in ZIP")

# ── Parse files ────────────────────────────────────────────────────────────
def load_plan_info(plan_file: Path, payer_filter: Optional[str] = None) -> dict[str, dict]:
    """
    Returns dict: formulary_id → {contract_name, plan_name, contract_id, plan_id}
    """
    plans: dict[str, dict] = {}
    with open(plan_file, encoding="latin-1") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            contract_name = row.get("CONTRACT_NAME", "").strip()
            plan_name     = row.get("PLAN_NAME", "").strip()
            formulary_id  = row.get("FORMULARY_ID", "").strip()
            if not formulary_id:
                continue
            payer = normalize_payer(contract_name)
            if payer_filter and payer_filter.lower() not in payer.lower():
                continue
            plans[formulary_id] = {
                "payer_name":    payer,
                "plan_name":     plan_name,
                "contract_id":   row.get("CONTRACT_ID", "").strip(),
                "plan_id":       row.get("PLAN_ID", "").strip(),
            }
    log.info(f"Loaded {len(plans):,} plans from plan information file")
    return plans

def iter_formulary_rows(formulary_file: Path, plans: dict, limit: int = 0):
    """Yields enriched coverage rule dicts."""
    count = 0
    rxcui_batch_save = 500  # save cache every N new lookups
    new_lookups = 0

    with open(formulary_file, encoding="latin-1") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            formulary_id = row.get("FORMULARY_ID", "").strip()
            plan = plans.get(formulary_id)
            if not plan:
                continue

            rxcui = row.get("RXCUI", "").strip()
            if not rxcui:
                continue

            drug_name = get_drug_name(rxcui)
            new_lookups += 1
            if new_lookups % rxcui_batch_save == 0:
                _save_rxcui_cache()

            tier   = row.get("TIER_LEVEL_VALUE", "").strip()
            pa     = row.get("PRIOR_AUTHORIZATION_YN", "").strip().upper() == "Y"
            step   = row.get("STEP_THERAPY_YN", "").strip().upper() == "Y"
            ql     = row.get("QUANTITY_LIMIT_YN", "").strip().upper() == "Y"
            ql_amt = row.get("QUANTITY_LIMIT_AMOUNT", "").strip()
            ql_day = row.get("QUANTITY_LIMIT_DAYS", "").strip()

            status = TIER_STATUS.get(tier, "restricted")

            ql_text = None
            if ql and (ql_amt or ql_day):
                ql_text = f"Limit: {ql_amt} units / {ql_day} days" if ql_amt and ql_day else f"Quantity limit applies"

            criteria = []
            if pa:
                criteria.append("Prior authorization required")
            if step:
                criteria.append("Step therapy required — must try preferred drugs first")
            if ql:
                criteria.append(ql_text or "Quantity limits apply")

            tier_labels = {
                "1": "Tier 1 — Preferred Generic",
                "2": "Tier 2 — Generic",
                "3": "Tier 3 — Preferred Brand",
                "4": "Tier 4 — Non-Preferred Brand",
                "5": "Tier 5 — Specialty",
                "6": "Tier 6 — Select Care",
            }

            yield {
                "drug_name":            drug_name,
                "rxcui":                rxcui,
                "payer_name":           plan["payer_name"],
                "plan_name":            plan["plan_name"],
                "contract_id":          plan["contract_id"],
                "plan_id":              plan["plan_id"],
                "formulary_id":         formulary_id,
                "tier":                 tier,
                "tier_label":           tier_labels.get(tier, f"Tier {tier}"),
                "coverage_status":      status,
                "prior_auth_required":  pa,
                "step_therapy_required": step,
                "quantity_limit":       ql,
                "quantity_limit_text":  ql_text,
                "criteria_summary":     criteria,
                "contract_year":        row.get("CONTRACT_YEAR", "2026").strip(),
            }

            count += 1
            if limit and count >= limit:
                log.info(f"Reached limit of {limit:,} rows")
                break

    _save_rxcui_cache()
    log.info(f"Processed {count:,} formulary rows")

# ── Embed chunk text ────────────────────────────────────────────────────────
def _embed(text: str) -> list[float]:
    url = f"https://generativelanguage.googleapis.com/v1beta/{EMBED_MODEL}:embedContent?key={GEMINI_API_KEY}"
    payload = {
        "model": EMBED_MODEL,
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": VECTOR_DIM,
    }
    resp = requests.post(url, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]["values"]

# ── Main loader ─────────────────────────────────────────────────────────────
def load_to_db(
    rules: list[dict],
    dry_run: bool = False,
    conn=None,
    qdrant_client=None,
):
    """Batch-insert rules into coverage_rules + Qdrant."""
    if dry_run:
        log.info(f"[DRY RUN] Would insert {len(rules)} rules")
        for r in rules[:5]:
            log.info(f"  {r['payer_name']} | {r['drug_name']} | {r['coverage_status']} | PA={r['prior_auth_required']}")
        return

    # Group by payer → one policy_version per payer
    from collections import defaultdict
    by_payer: dict[str, list[dict]] = defaultdict(list)
    for rule in rules:
        by_payer[rule["payer_name"]].append(rule)

    qdrant_chunks = []
    qdrant_embeds = []

    for payer_name, payer_rules in by_payer.items():
        log.info(f"  Loading {payer_name}: {len(payer_rules):,} rules")

        payer_id = db_layer.upsert_payer(conn, payer_name, payer_type="medicare")

        # One policy per payer for CMS data
        policy_id = db_layer.upsert_policy(
            conn,
            payer_id=payer_id,
            policy_title=f"{payer_name} Medicare Part D Formulary",
            policy_category="pharmacy_benefit",
        )

        version_label = f"v{date.today().isoformat()}-cms"
        # Insert a placeholder document for CMS data (no actual file)
        doc_id = db_layer.insert_document(
            conn,
            file_name=f"cms_part_d_{payer_name.lower().replace(' ','_')}.csv",
            file_type="other",
            sha256=str(uuid.uuid5(uuid.NAMESPACE_DNS, payer_name)).replace("-",""),
            storage_path=f"cms_cache/cms_part_d_{payer_name.lower().replace(' ','_')}.csv",
            payer_id=payer_id,
            source_url="https://data.cms.gov",
        )

        policy_version_id = db_layer.create_policy_version(
            conn,
            policy_id=policy_id,
            document_id=doc_id,
            version_label=version_label,
            effective_date=date.today().isoformat(),
            source_url="https://data.cms.gov",
        )

        for rule in payer_rules:
            chunk_text = (
                f"{rule['drug_name']} ({rule['tier_label']}) — "
                f"{rule['payer_name']} {rule['plan_name']}. "
                f"Coverage: {rule['coverage_status']}. "
                + (f"Prior auth required. " if rule['prior_auth_required'] else "")
                + (f"Step therapy required. " if rule['step_therapy_required'] else "")
                + (f"{rule['quantity_limit_text']}. " if rule['quantity_limit_text'] else "")
            )

            db_layer.insert_coverage_rule(
                conn,
                policy_version_id=str(policy_version_id),
                rule={
                    "drug_name":             rule["drug_name"],
                    "drug_aliases":          [rule["rxcui"]],
                    "coverage_status":       rule["coverage_status"],
                    "prior_auth_required":   rule["prior_auth_required"],
                    "step_therapy_required": rule["step_therapy_required"],
                    "quantity_limit_text":   rule["quantity_limit_text"],
                    "criteria_summary":      rule["criteria_summary"],
                    "extraction_confidence": 0.95,
                    "citations":             [],
                },
            )

            if qdrant_client:
                qdrant_chunks.append({
                    "text":              chunk_text,
                    "payer_name":        rule["payer_name"],
                    "payer_type":        "medicare",
                    "policy_title":      f"{rule['payer_name']} Medicare Part D Formulary",
                    "policy_category":   "pharmacy_benefit",
                    "version_label":     version_label,
                    "effective_date":    date.today().isoformat(),
                    "source_url":        "https://data.cms.gov",
                    "section_title":     rule["tier_label"],
                    "page_number":       0,
                    "chunk_index":       0,
                    "policy_version_id": str(policy_version_id),
                    "coverage_status":   rule["coverage_status"],
                    "drug_name":         rule["drug_name"],
                })

        log.info(f"  Inserted {payer_name}")

    # Batch embed + upsert to Qdrant
    if qdrant_client and qdrant_chunks:
        log.info(f"Embedding {len(qdrant_chunks):,} chunks for Qdrant...")
        batch_size = 50
        all_vectors = []
        for i in range(0, len(qdrant_chunks), batch_size):
            batch = qdrant_chunks[i:i+batch_size]
            for chunk in batch:
                try:
                    vec = _embed(chunk["text"])
                    all_vectors.append(vec)
                except Exception as e:
                    log.warning(f"  Embed failed: {e} — using zero vector")
                    all_vectors.append([0.0] * VECTOR_DIM)
            if (i // batch_size) % 10 == 0:
                log.info(f"  Embedded {min(i+batch_size, len(qdrant_chunks)):,}/{len(qdrant_chunks):,}")

        qdrant_layer.upsert_chunks(qdrant_client, qdrant_chunks, all_vectors)
        log.info(f"Upserted {len(qdrant_chunks):,} vectors to Qdrant")


def main():
    parser = argparse.ArgumentParser(description="CMS Part D Formulary Loader")
    parser.add_argument("--dry-run",  action="store_true", help="Parse only, no DB write")
    parser.add_argument("--limit",    type=int, default=50000, help="Max formulary rows to load (default 50000)")
    parser.add_argument("--payer",    type=str, default=None,  help="Filter to one payer name")
    parser.add_argument("--no-qdrant", action="store_true",    help="Skip Qdrant upsert")
    args = parser.parse_args()

    _load_rxcui_cache()

    # Download main formulary ZIP
    zip_path = download_cms_zip(CMS_ZIP_URL)
    formulary_file = extract_file(zip_path, "basic_drugs_formulary.txt")

    # Plan information comes from SPUF ZIP (has CONTRACT_NAME / PLAN_NAME)
    spuf_zip_path = CACHE_DIR / "cms_spuf.zip"
    if not spuf_zip_path.exists():
        log.info("Downloading SPUF ZIP for plan names (~200MB)...")
        with requests.get(CMS_PLAN_INFO_URL, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(spuf_zip_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024*1024):
                    f.write(chunk)
        log.info(f"Downloaded SPUF to {spuf_zip_path}")
    plan_file = extract_file(spuf_zip_path, "plan_information.txt")

    # Parse
    plans = load_plan_info(plan_file, payer_filter=args.payer)
    if not plans:
        log.error("No plans found — check --payer filter or ZIP contents")
        sys.exit(1)

    log.info(f"Loading up to {args.limit:,} formulary rows...")
    rules = list(iter_formulary_rows(formulary_file, plans, limit=args.limit))
    log.info(f"Total rules to load: {len(rules):,}")

    if args.dry_run:
        load_to_db(rules, dry_run=True)
        return

    qdrant_client = None
    if not args.no_qdrant and qdrant_layer:
        qdrant_client = qdrant_layer.get_client()
        qdrant_layer.init_collection(qdrant_client)

    from contextlib import contextmanager
    with db_layer.get_conn() as conn:
        load_to_db(rules, dry_run=False, conn=conn, qdrant_client=qdrant_client)

    log.info("=" * 50)
    log.info(f"Done! Loaded {len(rules):,} coverage rules from CMS Part D data")
    log.info("=" * 50)


if __name__ == "__main__":
    main()
