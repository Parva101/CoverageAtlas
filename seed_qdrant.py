"""
seed_qdrant.py
══════════════
Pulls coverage_rules from PostgreSQL and embeds them into Qdrant.
Much faster than re-running the full CMS loader because DB inserts
are already done — this only does the embedding step.

Usage:
    python seed_qdrant.py               # embed all rules (slow)
    python seed_qdrant.py --limit 5000  # embed top 5000 (fast, good for demo)
    python seed_qdrant.py --popular     # embed only popular drugs (fastest)
"""

import os, sys, logging, argparse
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import db as db_layer
import qdrant_setup as qdrant_layer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
EMBED_MODEL    = "models/gemini-embedding-001"
VECTOR_DIM     = 768

# High-value drugs for demo — covers GLP-1s, insulins, cancer drugs, common meds
POPULAR_DRUGS = [
    "semaglutide", "tirzepatide", "dulaglutide", "liraglutide",
    "ozempic", "wegovy", "mounjaro", "trulicity", "victoza",
    "insulin", "metformin", "atorvastatin", "lisinopril",
    "humira", "adalimumab", "dupixent", "dupilumab",
    "keytruda", "pembrolizumab", "opdivo", "nivolumab",
    "eliquis", "apixaban", "xarelto", "rivaroxaban",
    "jardiance", "empagliflozin", "farxiga", "dapagliflozin",
    "repatha", "evolocumab", "praluent", "alirocumab",
    "skyrizi", "risankizumab", "taltz", "ixekizumab",
    "rinvoq", "upadacitinib", "xeljanz", "tofacitinib",
    "entresto", "sacubitril", "ibrance", "palbociclib",
    "morphine", "oxycodone", "gabapentin", "pregabalin",
]


def embed_text(text: str) -> list[float]:
    url = f"https://generativelanguage.googleapis.com/v1beta/{EMBED_MODEL}:embedContent?key={GEMINI_API_KEY}"
    resp = requests.post(url, json={
        "model": EMBED_MODEL,
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": VECTOR_DIM,
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]["values"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",   type=int, default=0,     help="Max rules to embed (0 = all)")
    parser.add_argument("--popular", action="store_true",      help="Only embed popular drugs")
    args = parser.parse_args()

    qdrant_client = qdrant_layer.get_client()
    qdrant_layer.init_collection(qdrant_client)

    with db_layer.get_conn() as conn:
        if args.popular:
            # Build SQL for popular drugs
            like_clauses = " OR ".join([f"LOWER(cr.drug_name) LIKE '%%{d}%%'" for d in POPULAR_DRUGS])
            sql = f"""
                SELECT
                    cr.id::text, cr.drug_name, cr.coverage_status,
                    cr.prior_auth_required, cr.step_therapy_required,
                    cr.quantity_limit_text, cr.criteria_summary,
                    pv.id::text AS policy_version_id,
                    pv.version_label, pv.effective_date, pv.source_url,
                    pol.policy_title, pol.policy_category,
                    p.name AS payer_name, p.payer_type
                FROM coverage_rules cr
                JOIN policy_versions pv ON cr.policy_version_id = pv.id
                JOIN policies pol ON pv.policy_id = pol.id
                JOIN payers p ON pol.payer_id = p.id
                WHERE {like_clauses}
                ORDER BY cr.drug_name
            """
            rows = db_layer.fetchall(conn, sql)
            log.info(f"Found {len(rows):,} rules for popular drugs")
        else:
            limit_clause = f"LIMIT {args.limit}" if args.limit else ""
            sql = f"""
                SELECT
                    cr.id::text, cr.drug_name, cr.coverage_status,
                    cr.prior_auth_required, cr.step_therapy_required,
                    cr.quantity_limit_text, cr.criteria_summary,
                    pv.id::text AS policy_version_id,
                    pv.version_label, pv.effective_date, pv.source_url,
                    pol.policy_title, pol.policy_category,
                    p.name AS payer_name, p.payer_type
                FROM coverage_rules cr
                JOIN policy_versions pv ON cr.policy_version_id = pv.id
                JOIN policies pol ON pv.policy_id = pol.id
                JOIN payers p ON pol.payer_id = p.id
                ORDER BY cr.drug_name
                {limit_clause}
            """
            rows = db_layer.fetchall(conn, sql)
            log.info(f"Found {len(rows):,} rules to embed")

    if not rows:
        log.error("No rules found — is the DB populated?")
        return

    chunks = []
    for r in rows:
        criteria = r.get("criteria_summary") or []
        if isinstance(criteria, str):
            import json
            try: criteria = json.loads(criteria)
            except: criteria = []

        text = (
            f"{r['drug_name']} — {r['payer_name']} ({r['policy_category']}). "
            f"Coverage: {r['coverage_status']}. "
            + ("Prior auth required. " if r.get("prior_auth_required") else "")
            + ("Step therapy required. " if r.get("step_therapy_required") else "")
            + (f"{r['quantity_limit_text']}. " if r.get("quantity_limit_text") else "")
            + (" ".join(criteria))
        )
        chunks.append({
            "text":              text,
            "payer_name":        r["payer_name"],
            "payer_type":        r.get("payer_type", "medicare"),
            "policy_title":      r["policy_title"],
            "policy_category":   r["policy_category"],
            "version_label":     r.get("version_label", ""),
            "effective_date":    str(r.get("effective_date", "")),
            "source_url":        r.get("source_url", ""),
            "section_title":     r["coverage_status"],
            "page_number":       0,
            "chunk_index":       0,
            "policy_version_id": r["policy_version_id"],
            "coverage_status":   r["coverage_status"],
            "drug_name":         r["drug_name"],
        })

    log.info(f"Embedding {len(chunks):,} chunks...")
    vectors = []
    for i, chunk in enumerate(chunks):
        try:
            vec = embed_text(chunk["text"])
            vectors.append(vec)
        except Exception as e:
            log.warning(f"  Embed failed for {chunk['drug_name']}: {e} — skipping")
            chunks[i] = None
            vectors.append(None)

        if (i + 1) % 50 == 0:
            log.info(f"  {i+1}/{len(chunks)} embedded")

    # Filter out failed embeds
    valid = [(c, v) for c, v in zip(chunks, vectors) if c and v]
    if not valid:
        log.error("All embeddings failed")
        return

    valid_chunks, valid_vectors = zip(*valid)
    valid_chunks = list(valid_chunks)
    valid_vectors = list(valid_vectors)

    batch_size = 200
    for i in range(0, len(valid_chunks), batch_size):
        qdrant_layer.upsert_chunks(
            qdrant_client,
            valid_chunks[i:i+batch_size],
            valid_vectors[i:i+batch_size],
        )
        log.info(f"  Upserted {min(i+batch_size, len(valid_chunks)):,}/{len(valid_chunks):,}")

    log.info(f"Done! Upserted {len(valid_chunks):,} vectors to Qdrant")


if __name__ == "__main__":
    main()
