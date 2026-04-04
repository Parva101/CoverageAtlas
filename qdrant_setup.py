"""
qdrant_setup.py
════════════════
Initializes and manages the Qdrant vector collections for CoverageAtlas.

Collections:
  policy_chunks  — main RAG retrieval collection (768-dim Gemini embeddings)

Usage:
    python qdrant_setup.py --init          # create collection (safe to re-run)
    python qdrant_setup.py --status        # show collection stats
    python qdrant_setup.py --reset         # DROP and recreate (careful!)
    python qdrant_setup.py --test-embed    # smoke test embedding + insert
"""

import os
import uuid
import argparse
import logging
from datetime import datetime

# ── Qdrant ─────────────────────────────────────────────────────────────────
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    HnswConfigDiff,
    OptimizersConfigDiff,
    PayloadSchemaType,
    Filter,
    FieldCondition,
    MatchValue,
    PointStruct,
    SearchRequest,
)

# ── Gemini (for smoke test) ─────────────────────────────────────────────────
import google.generativeai as genai

GEMINI_API_KEY    = os.environ.get("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY_HERE")
QDRANT_URL        = os.environ.get("QDRANT_URL",        "http://localhost:6333")
QDRANT_API_KEY    = os.environ.get("QDRANT_API_KEY",    "")
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "policy_chunks")

# Gemini text-embedding-004 produces 768-dim vectors
VECTOR_DIM = 768

genai.configure(api_key=GEMINI_API_KEY)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# COLLECTION SCHEMA
# ══════════════════════════════════════════════════════════════════════════════

# Every point stored in Qdrant has this payload structure.
# These mirror the PostgreSQL metadata so we can filter during retrieval
# without a DB roundtrip.
PAYLOAD_SCHEMA = {
    # ── identifiers (link back to PostgreSQL) ──
    "policy_version_id": PayloadSchemaType.KEYWORD,  # UUID string
    "chunk_id":          PayloadSchemaType.KEYWORD,  # UUID string
    "chunk_index":       PayloadSchemaType.INTEGER,

    # ── retrieval filters ──────────────────────
    "payer_name":        PayloadSchemaType.KEYWORD,
    "payer_type":        PayloadSchemaType.KEYWORD,  # commercial/medicare/medicaid
    "policy_category":   PayloadSchemaType.KEYWORD,  # medical_benefit/pharmacy_benefit
    "coverage_status":   PayloadSchemaType.KEYWORD,  # covered/restricted/not_covered/unknown
    "drug_name":         PayloadSchemaType.KEYWORD,

    # ── display / citation ─────────────────────
    "policy_title":      PayloadSchemaType.KEYWORD,
    "version_label":     PayloadSchemaType.KEYWORD,
    "effective_date":    PayloadSchemaType.KEYWORD,  # ISO date string
    "section_title":     PayloadSchemaType.KEYWORD,
    "page_number":       PayloadSchemaType.INTEGER,
    "source_url":        PayloadSchemaType.KEYWORD,
    "text":              PayloadSchemaType.KEYWORD,  # chunk text for citation display
}


def get_client() -> QdrantClient:
    return QdrantClient(
        url=QDRANT_URL,
        api_key=QDRANT_API_KEY or None,
        timeout=20,
    )


# ══════════════════════════════════════════════════════════════════════════════
# INIT — creates collection with optimal settings for policy retrieval
# ══════════════════════════════════════════════════════════════════════════════

def init_collection(client: QdrantClient, reset: bool = False):
    """
    Creates the policy_chunks collection.
    - reset=False : safe, skips if already exists
    - reset=True  : drops and recreates (use only in dev)
    """
    existing = [c.name for c in client.get_collections().collections]

    if reset and QDRANT_COLLECTION in existing:
        client.delete_collection(QDRANT_COLLECTION)
        log.warning(f"Dropped existing collection: {QDRANT_COLLECTION}")
        existing = []

    if QDRANT_COLLECTION in existing:
        log.info(f"Collection '{QDRANT_COLLECTION}' already exists — skipping init.")
        return

    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(
            size=VECTOR_DIM,
            distance=Distance.COSINE,   # best for semantic text similarity
        ),
        # HNSW tuning for fast recall at our expected scale (~100K vectors)
        hnsw_config=HnswConfigDiff(
            m=16,               # graph connectivity — higher = more accurate, slower build
            ef_construct=100,   # build-time search width
            full_scan_threshold=10_000,
        ),
        # Optimizer — batches small updates to keep index fresh
        optimizers_config=OptimizersConfigDiff(
            indexing_threshold=5_000,
        ),
    )
    log.info(f"Created collection: {QDRANT_COLLECTION} (dim={VECTOR_DIM}, cosine)")

    # Create payload indexes for fast metadata filtering
    for field, schema_type in PAYLOAD_SCHEMA.items():
        try:
            client.create_payload_index(
                collection_name=QDRANT_COLLECTION,
                field_name=field,
                field_schema=schema_type,
            )
        except Exception as e:
            log.warning(f"  Index for '{field}': {e}")

    log.info(f"Payload indexes created for {len(PAYLOAD_SCHEMA)} fields.")


# ══════════════════════════════════════════════════════════════════════════════
# UPSERT — called by the extraction pipeline
# ══════════════════════════════════════════════════════════════════════════════

def upsert_chunks(
    client: QdrantClient,
    chunks: list[dict],
    embeddings: list[list[float]],
) -> list[str]:
    """
    Upserts pre-embedded chunks into Qdrant.

    Each chunk dict must contain:
        text, section_title, page_number, chunk_index,
        payer_name, payer_type, policy_title, policy_category,
        version_label, effective_date, source_url,
        policy_version_id, coverage_status (optional), drug_name (optional)

    Returns list of Qdrant point IDs (UUIDs as strings).
    """
    assert len(chunks) == len(embeddings), "chunks and embeddings must be same length"

    points  = []
    ids     = []

    for chunk, vector in zip(chunks, embeddings):
        point_id = str(uuid.uuid4())
        ids.append(point_id)

        payload = {
            "policy_version_id": chunk.get("policy_version_id", ""),
            "chunk_id":          chunk.get("chunk_id", point_id),
            "chunk_index":       chunk.get("chunk_index", 0),
            "payer_name":        chunk.get("payer_name", ""),
            "payer_type":        chunk.get("payer_type", "commercial"),
            "policy_title":      chunk.get("policy_title", ""),
            "policy_category":   chunk.get("policy_category", "medical_benefit"),
            "version_label":     chunk.get("version_label", ""),
            "effective_date":    chunk.get("effective_date", ""),
            "source_url":        chunk.get("source_url", ""),
            "section_title":     chunk.get("section_title", ""),
            "page_number":       chunk.get("page_number", 0),
            "text":              chunk.get("text", "")[:2000],  # cap for storage
            "coverage_status":   chunk.get("coverage_status", ""),
            "drug_name":         chunk.get("drug_name", ""),
        }

        points.append(PointStruct(id=point_id, vector=vector, payload=payload))

    client.upsert(collection_name=QDRANT_COLLECTION, points=points, wait=True)
    log.info(f"Upserted {len(points)} points to Qdrant")
    return ids


# ══════════════════════════════════════════════════════════════════════════════
# SEARCH — used by the Q&A agent
# ══════════════════════════════════════════════════════════════════════════════

def search(
    client: QdrantClient,
    query_vector: list[float],
    top_k: int = 8,
    payer_filter: str = None,
    payer_type_filter: str = None,
    policy_category_filter: str = None,
    version_label_filter: str = None,
    coverage_status_filter: str = None,
) -> list[dict]:
    """
    Semantic search with optional metadata filters.
    Mirrors the API contract filter fields from doc 06.

    Returns list of result dicts with text + metadata + score.
    """
    # Build Qdrant filter conditions
    conditions = []

    if payer_filter:
        conditions.append(FieldCondition(
            key="payer_name", match=MatchValue(value=payer_filter)
        ))
    if payer_type_filter:
        conditions.append(FieldCondition(
            key="payer_type", match=MatchValue(value=payer_type_filter)
        ))
    if policy_category_filter:
        conditions.append(FieldCondition(
            key="policy_category", match=MatchValue(value=policy_category_filter)
        ))
    if version_label_filter:
        conditions.append(FieldCondition(
            key="version_label", match=MatchValue(value=version_label_filter)
        ))
    if coverage_status_filter:
        conditions.append(FieldCondition(
            key="coverage_status", match=MatchValue(value=coverage_status_filter)
        ))

    qdrant_filter = Filter(must=conditions) if conditions else None

    results = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_vector,
        limit=top_k,
        query_filter=qdrant_filter,
        with_payload=True,
        with_vectors=False,   # don't return raw vectors — saves bandwidth
    )

    return [
        {
            "score":             r.score,
            "relevance":         round(r.score, 4),
            "text":              r.payload.get("text", ""),
            "payer_name":        r.payload.get("payer_name", ""),
            "policy_title":      r.payload.get("policy_title", ""),
            "policy_category":   r.payload.get("policy_category", ""),
            "version_label":     r.payload.get("version_label", ""),
            "effective_date":    r.payload.get("effective_date", ""),
            "source_url":        r.payload.get("source_url", ""),
            "section_title":     r.payload.get("section_title", ""),
            "page_number":       r.payload.get("page_number", 0),
            "policy_version_id": r.payload.get("policy_version_id", ""),
            "chunk_index":       r.payload.get("chunk_index", 0),
        }
        for r in results
    ]


# ══════════════════════════════════════════════════════════════════════════════
# DELETE — removes all chunks for a specific policy version
# ══════════════════════════════════════════════════════════════════════════════

def delete_version_chunks(client: QdrantClient, policy_version_id: str):
    """Removes all Qdrant points for a given policy version (used on re-ingest)."""
    client.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=Filter(
            must=[FieldCondition(
                key="policy_version_id",
                match=MatchValue(value=policy_version_id)
            )]
        ),
    )
    log.info(f"Deleted Qdrant points for version: {policy_version_id}")


# ══════════════════════════════════════════════════════════════════════════════
# STATUS — human-readable collection stats
# ══════════════════════════════════════════════════════════════════════════════

def print_status(client: QdrantClient):
    try:
        info = client.get_collection(QDRANT_COLLECTION)
        log.info("=" * 50)
        log.info(f"Collection : {QDRANT_COLLECTION}")
        log.info(f"Vectors    : {info.vectors_count:,}")
        log.info(f"Points     : {info.points_count:,}")
        log.info(f"Status     : {info.status}")
        log.info(f"Dimension  : {VECTOR_DIM}")
        log.info(f"Distance   : COSINE")
        log.info("=" * 50)
    except Exception as e:
        log.error(f"Could not get collection status: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# SMOKE TEST — embeds a sample chunk and runs a search
# ══════════════════════════════════════════════════════════════════════════════

def smoke_test(client: QdrantClient):
    log.info("Running smoke test...")

    # Insert a sample point
    sample_text = (
        "UnitedHealthcare covers semaglutide (Ozempic/Wegovy) for members with "
        "Type 2 diabetes or BMI ≥30. Prior authorization is required. "
        "Step therapy applies: must have tried metformin first."
    )

    result = genai.embed_content(
        model="models/text-embedding-004",
        content=[sample_text],
        task_type="retrieval_document"
    )
    vector = result["embedding"][0]

    test_id = upsert_chunks(
        client,
        chunks=[{
            "text":              sample_text,
            "section_title":     "Coverage Criteria",
            "page_number":       3,
            "chunk_index":       0,
            "payer_name":        "UnitedHealthcare",
            "payer_type":        "commercial",
            "policy_title":      "Semaglutide Medical Benefit Policy",
            "policy_category":   "medical_benefit",
            "version_label":     "v2026-test",
            "effective_date":    "2026-01-01",
            "source_url":        "https://uhcprovider.com/test",
            "policy_version_id": str(uuid.uuid4()),
            "coverage_status":   "restricted",
            "drug_name":         "semaglutide",
        }],
        embeddings=[vector],
    )

    # Now search for it
    query_result = genai.embed_content(
        model="models/text-embedding-004",
        content=["Does UHC cover Ozempic for diabetes?"],
        task_type="retrieval_query"
    )
    query_vector = query_result["embedding"][0]

    hits = search(client, query_vector, top_k=3)
    log.info(f"Search returned {len(hits)} results")
    for h in hits:
        log.info(f"  Score {h['relevance']} | {h['payer_name']} | {h['text'][:80]}")

    log.info("✅ Smoke test passed!")


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="CoverageAtlas Qdrant Setup")
    parser.add_argument("--init",       action="store_true", help="Initialize collection")
    parser.add_argument("--reset",      action="store_true", help="Drop + recreate collection")
    parser.add_argument("--status",     action="store_true", help="Show collection stats")
    parser.add_argument("--test-embed", action="store_true", help="Run smoke test")
    args = parser.parse_args()

    client = get_client()
    log.info(f"Connected to Qdrant at {QDRANT_URL}")

    if args.reset:
        init_collection(client, reset=True)
    elif args.init:
        init_collection(client, reset=False)

    if args.status:
        print_status(client)

    if args.test_embed:
        init_collection(client, reset=False)
        smoke_test(client)

    if not any(vars(args).values()):
        parser.print_help()


if __name__ == "__main__":
    main()
