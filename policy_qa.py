"""
policy_qa.py
─────────────
Gemini-powered Q&A engine over the ChromaDB insurance policy vector store.
Users can ask natural language questions and get cited answers.

Usage:
    # Interactive chat
    python policy_qa.py

    # Single question
    python policy_qa.py --question "Does UHC cover bariatric surgery?"

    # Filter to specific payer
    python policy_qa.py --payer "UnitedHealthcare"

    # REST API mode (FastAPI)
    python policy_qa.py --serve
"""

import os
import argparse
from pathlib import Path
from datetime import datetime

import ai_provider
import chromadb
from chromadb.config import Settings

# ── Config ─────────────────────────────────────────────────────────────────
EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "768"))
CHAT_MODEL = os.environ.get("QA_MODEL", "gemini-2.5-flash")
CHROMA_DIR   = Path("insurance_policies/chroma_db")
TOP_K        = 8      # chunks to retrieve per query
MAX_TOKENS   = 2048


# ══════════════════════════════════════════════════════════════════════════════
# VECTOR STORE RETRIEVAL
# ══════════════════════════════════════════════════════════════════════════════

def get_collection():
    client = chromadb.PersistentClient(
        path=str(CHROMA_DIR),
        settings=Settings(anonymized_telemetry=False)
    )
    return client.get_or_create_collection(
        name="insurance_policies",
        metadata={"hnsw:space": "cosine"}
    )


def embed_query(question: str) -> list[float]:
    use_output_dim = EMBED_MODEL.startswith("gemini-embedding-")
    return ai_provider.embed_query(
        question,
        model=EMBED_MODEL,
        output_dimensionality=EMBEDDING_DIM if use_output_dim else None,
    )


def retrieve(question: str, collection, payer_filter: str = None, top_k: int = TOP_K):
    """Semantic search: returns top-k relevant chunks with metadata."""
    query_embedding = embed_query(question)

    where = None
    if payer_filter:
        where = {"payer": {"$eq": payer_filter}}

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where=where,
        include=["documents", "metadatas", "distances"]
    )

    chunks = []
    for i, doc in enumerate(results["documents"][0]):
        meta = results["metadatas"][0][i]
        dist = results["distances"][0][i]
        chunks.append({
            "text":         doc,
            "payer":        meta.get("payer", "Unknown"),
            "policy_type":  meta.get("policy_type", ""),
            "title":        meta.get("title", ""),
            "url":          meta.get("url", ""),
            "relevance":    round(1 - dist, 3),   # cosine similarity
        })

    # Sort by relevance descending
    chunks.sort(key=lambda x: x["relevance"], reverse=True)
    return chunks


# ══════════════════════════════════════════════════════════════════════════════
# GEMINI ANSWER GENERATION
# ══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """
You are PolicyLens AI, an expert insurance policy assistant helping healthcare 
professionals, patients, and pharmacists understand medical benefit drug policies 
and medical coverage policies from major US health insurers.

Your job:
1. Answer the user's question based ONLY on the provided policy context below.
2. Be specific: mention which payer (UHC, Aetna, Cigna, etc.) each piece of 
   information comes from.
3. If policies differ across payers, clearly compare them side by side.
4. Always mention prior authorization requirements, step therapy, and quantity 
   limits when relevant.
5. If the context doesn't contain enough info to answer confidently, say so 
   clearly and suggest where the user can find more information.
6. Never make up coverage details — only use what's in the context.
7. Format your answer clearly with payer-specific sections when comparing multiple plans.

Tone: Professional, clear, helpful. Avoid jargon when possible.
""".strip()


def build_context(chunks: list[dict]) -> str:
    """Format retrieved chunks into a readable context block for Gemini."""
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        context_parts.append(
            f"[SOURCE {i}]\n"
            f"Payer: {chunk['payer']}\n"
            f"Policy Type: {chunk['policy_type']}\n"
            f"Document: {chunk['title']}\n"
            f"Relevance: {chunk['relevance']}\n"
            f"Content:\n{chunk['text']}\n"
        )
    return "\n" + "─" * 50 + "\n".join(context_parts)


def ask_gemini(question: str, context: str, chat_history: list = None) -> str:
    """Send question + context to Gemini and get a grounded answer."""
    prompt = f"""
POLICY CONTEXT (retrieved from insurance policy database):
{context}

USER QUESTION:
{question}

Please answer based on the policy context above. Cite which payer/document 
each piece of information comes from.
""".strip()

    return ai_provider.generate_text(
        prompt,
        model=CHAT_MODEL,
        temperature=0.2,
        max_output_tokens=MAX_TOKENS,
        system_instruction=SYSTEM_PROMPT,
    )


# ══════════════════════════════════════════════════════════════════════════════
# MAIN Q&A FUNCTION (importable by other modules)
# ══════════════════════════════════════════════════════════════════════════════

def answer_question(
    question: str,
    payer_filter: str = None,
    top_k: int = TOP_K,
    include_sources: bool = True,
) -> dict:
    """
    Main entrypoint. Returns:
    {
        "answer": str,
        "sources": [...],
        "question": str,
        "payer_filter": str | None,
        "retrieved_chunks": int,
        "timestamp": str
    }
    """
    collection = get_collection()

    if collection.count() == 0:
        return {
            "answer": "⚠️ The policy database is empty. Please run insurance_scraper.py first to populate it.",
            "sources": [],
            "question": question,
            "payer_filter": payer_filter,
            "retrieved_chunks": 0,
            "timestamp": datetime.now().isoformat(),
        }

    chunks = retrieve(question, collection, payer_filter=payer_filter, top_k=top_k)

    if not chunks:
        return {
            "answer": "No relevant policy documents found for your question. Try rephrasing or removing the payer filter.",
            "sources": [],
            "question": question,
            "payer_filter": payer_filter,
            "retrieved_chunks": 0,
            "timestamp": datetime.now().isoformat(),
        }

    context = build_context(chunks)
    answer  = ask_gemini(question, context)

    sources = []
    if include_sources:
        seen_titles = set()
        for c in chunks:
            t = c["title"]
            if t not in seen_titles:
                seen_titles.add(t)
                sources.append({
                    "payer":       c["payer"],
                    "title":       c["title"],
                    "policy_type": c["policy_type"],
                    "url":         c["url"],
                    "relevance":   c["relevance"],
                })

    return {
        "answer":           answer,
        "sources":          sources,
        "question":         question,
        "payer_filter":     payer_filter,
        "retrieved_chunks": len(chunks),
        "timestamp":        datetime.now().isoformat(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# FASTAPI REST SERVER (optional, for backend integration)
# ══════════════════════════════════════════════════════════════════════════════

def run_server():
    try:
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware
        from pydantic import BaseModel
        import uvicorn
    except ImportError:
        print("Install FastAPI: pip install fastapi uvicorn")
        return

    app = FastAPI(title="PolicyLens AI", description="Insurance Policy Q&A API")
    app.add_middleware(CORSMiddleware, allow_origins=["*"],
                       allow_methods=["*"], allow_headers=["*"])

    class QuestionRequest(BaseModel):
        question: str
        payer_filter: str | None = None
        top_k: int = 8

    class StatsResponse(BaseModel):
        total_vectors: int
        total_documents: int
        payers: list[str]

    @app.post("/ask")
    def ask(req: QuestionRequest):
        return answer_question(
            question=req.question,
            payer_filter=req.payer_filter,
            top_k=req.top_k,
        )

    @app.get("/stats")
    def stats():
        collection = get_collection()
        import sqlite3
        conn = sqlite3.connect("insurance_policies/registry.db")
        rows = conn.execute("SELECT DISTINCT payer FROM policies").fetchall()
        docs = conn.execute("SELECT COUNT(*) FROM policies WHERE in_vectordb=1").fetchone()[0]
        conn.close()
        return {
            "total_vectors":   collection.count(),
            "total_documents": docs,
            "payers":          [r[0] for r in rows],
        }

    @app.get("/health")
    def health():
        return {"status": "ok", "timestamp": datetime.now().isoformat()}

    print("\n PolicyLens API running at http://localhost:8000")
    print(" POST /ask     → ask a question")
    print(" GET  /stats   → DB stats")
    print(" GET  /docs    → Swagger UI\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)


# ══════════════════════════════════════════════════════════════════════════════
# INTERACTIVE CLI
# ══════════════════════════════════════════════════════════════════════════════

def run_interactive(payer_filter=None):
    collection = get_collection()
    total = collection.count()

    print("\n" + "═" * 60)
    print("  PolicyLens AI — Insurance Policy Q&A")
    print(f"  Vector DB: {total:,} chunks indexed")
    if payer_filter:
        print(f"  Filtered to: {payer_filter}")
    print("  Type 'quit' to exit, 'clear' to reset filter")
    print("═" * 60 + "\n")

    chat_history = []

    while True:
        try:
            question = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye!")
            break

        if not question:
            continue
        if question.lower() in ("quit","exit","q"):
            print("Goodbye!")
            break
        if question.lower() == "clear":
            chat_history = []
            print("Chat history cleared.\n")
            continue

        print("\nSearching policies...", end="\r")
        result = answer_question(question, payer_filter=payer_filter)

        print(f"\n{'─'*60}")
        print(f"PolicyLens: {result['answer']}")

        if result["sources"]:
            print(f"\n📎 Sources ({len(result['sources'])}):")
            for s in result["sources"]:
                print(f"  • [{s['payer']}] {s['title'][:60]} (relevance: {s['relevance']})")
                if s["url"]:
                    print(f"    {s['url']}")
        print()


def main():
    parser = argparse.ArgumentParser(description="PolicyLens AI — Insurance Policy Q&A")
    parser.add_argument("--question", type=str, help="Single question (non-interactive)")
    parser.add_argument("--payer", type=str, help="Filter to specific payer, e.g. 'UnitedHealthcare'")
    parser.add_argument("--serve", action="store_true", help="Run as FastAPI REST server")
    parser.add_argument("--top-k", type=int, default=8, help="Number of chunks to retrieve")
    args = parser.parse_args()

    if args.serve:
        run_server()
    elif args.question:
        result = answer_question(args.question, payer_filter=args.payer, top_k=args.top_k)
        print(f"\nQ: {result['question']}")
        print(f"\nA: {result['answer']}")
        if result["sources"]:
            print(f"\nSources:")
            for s in result["sources"]:
                print(f"  • [{s['payer']}] {s['title']}")
    else:
        run_interactive(payer_filter=args.payer)


if __name__ == "__main__":
    main()

