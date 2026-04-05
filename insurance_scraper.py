"""
insurance_scraper.py
────────────────────
Daily incremental sync: discovers new policy docs from all major insurers,
downloads them, chunks the text, embeds via Google Gemini, and upserts
into a local ChromaDB vector store — ready for semantic Q&A.

Usage:
    python insurance_scraper.py              # normal daily sync
    python insurance_scraper.py --dry-run    # discover only, no download
    python insurance_scraper.py --force      # wipe DB and re-ingest everything
    python insurance_scraper.py --payers uhc aetna
"""

import os, re, time, json, sqlite3, hashlib, logging, argparse, tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

# ── Google Gemini ──────────────────────────────────────────────────────────
from gemini_client import embed_texts as embed_texts_via_gemini

EMBED_MODEL = "models/text-embedding-004"   # 768-dim, free tier generous

# ── ChromaDB ───────────────────────────────────────────────────────────────
import chromadb
from chromadb.config import Settings

# ── PDF text extraction ────────────────────────────────────────────────────
try:
    import pdfplumber
    PDF_BACKEND = "pdfplumber"
except ImportError:
    try:
        import pypdf
        PDF_BACKEND = "pypdf"
    except ImportError:
        PDF_BACKEND = None

# ── Paths & constants ──────────────────────────────────────────────────────
BASE_DIR     = Path("insurance_policies")
CHROMA_DIR   = BASE_DIR / "chroma_db"
DB_PATH      = BASE_DIR / "registry.db"
LOG_DIR      = Path("logs")
RUN_LOG      = BASE_DIR / "run_history.json"

BASE_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

CHUNK_SIZE    = 800    # characters per chunk (fits well in Gemini context)
CHUNK_OVERLAP = 150
MONTHS = ["january","february","march","april","may","june",
          "july","august","september","october","november","december"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / f"sync_{datetime.now().strftime('%Y%m%d')}.log"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
})


# ══════════════════════════════════════════════════════════════════════════════
# SQLITE — tracks every URL ever seen to avoid re-downloading
# ══════════════════════════════════════════════════════════════════════════════

def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS policies (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            url          TEXT UNIQUE NOT NULL,
            url_hash     TEXT UNIQUE NOT NULL,
            payer        TEXT NOT NULL,
            policy_type  TEXT NOT NULL,
            title        TEXT,
            local_path   TEXT,
            file_hash    TEXT,
            chunk_count  INTEGER DEFAULT 0,
            first_seen   TEXT NOT NULL,
            last_checked TEXT NOT NULL,
            in_vectordb  INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sync_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at        TEXT, new_docs INTEGER DEFAULT 0,
            failed_docs   INTEGER DEFAULT 0,
            total_checked INTEGER DEFAULT 0,
            duration_sec  REAL
        );
        CREATE INDEX IF NOT EXISTS idx_uhash ON policies(url_hash);
    """)
    conn.commit()
    return conn

def md5(s: str) -> str: return hashlib.md5(s.encode()).hexdigest()
def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p,"rb") as f:
        for chunk in iter(lambda: f.read(8192), b""): h.update(chunk)
    return h.hexdigest()

def is_known(conn, url): 
    return conn.execute("SELECT id FROM policies WHERE url_hash=?", (md5(url),)).fetchone() is not None

def register(conn, doc, path, fhash, chunks):
    now = datetime.now().isoformat()
    conn.execute("""
        INSERT INTO policies
          (url,url_hash,payer,policy_type,title,local_path,file_hash,chunk_count,first_seen,last_checked,in_vectordb)
        VALUES (?,?,?,?,?,?,?,?,?,?,1)
        ON CONFLICT(url_hash) DO UPDATE SET
          last_checked=excluded.last_checked, file_hash=excluded.file_hash,
          chunk_count=excluded.chunk_count, in_vectordb=1
    """, (doc["url"], md5(doc["url"]), doc.get("payer","?"), doc.get("policy_type","?"),
          doc.get("title",""), str(path), fhash, chunks, now, now))
    conn.commit()

def mark_seen(conn, url):
    conn.execute("UPDATE policies SET last_checked=? WHERE url_hash=?",
                 (datetime.now().isoformat(), md5(url)))
    conn.commit()


# ══════════════════════════════════════════════════════════════════════════════
# CHROMADB — persistent local vector store
# ══════════════════════════════════════════════════════════════════════════════

def get_chroma_collection() -> chromadb.Collection:
    client = chromadb.PersistentClient(
        path=str(CHROMA_DIR),
        settings=Settings(anonymized_telemetry=False)
    )
    # Use cosine distance for semantic similarity
    collection = client.get_or_create_collection(
        name="insurance_policies",
        metadata={"hnsw:space": "cosine"}
    )
    return collection


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch embed texts via Gemini text-embedding-004."""
    embeddings = []
    # Gemini allows up to 100 texts per batch
    batch_size = 50
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        embeddings.extend(
            embed_texts_via_gemini(
                texts=batch,
                model=EMBED_MODEL,
                task_type="retrieval_document",
            )
        )
        time.sleep(0.3)  # respect rate limits
    return embeddings


def chunk_text(text: str, doc_title: str) -> list[str]:
    """Split text into overlapping chunks for better retrieval."""
    text = re.sub(r'\s+', ' ', text).strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunk = text[start:end]
        # Prepend title for context in every chunk
        chunks.append(f"[{doc_title}]\n{chunk}")
        if end == len(text):
            break
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def upsert_to_chroma(collection, doc: dict, chunks: list[str]) -> int:
    """Embed chunks and upsert into ChromaDB. Returns chunk count."""
    if not chunks:
        return 0

    log.info(f"    Embedding {len(chunks)} chunks...")
    try:
        embeddings = embed_texts(chunks)
    except Exception as e:
        log.error(f"    Embedding failed: {e}")
        return 0

    url_hash = md5(doc["url"])
    ids       = [f"{url_hash}_{i}" for i in range(len(chunks))]
    metadatas = [{
        "payer":       doc.get("payer", "unknown"),
        "policy_type": doc.get("policy_type", "unknown"),
        "title":       doc.get("title", ""),
        "url":         doc.get("url", ""),
        "chunk_index": i,
        "total_chunks": len(chunks),
        "ingested_at": datetime.now().isoformat(),
    } for i in range(len(chunks))]

    # Delete old chunks for this doc (in case of update)
    try:
        existing = collection.get(where={"url": doc["url"]})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
    except Exception:
        pass

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=metadatas,
    )
    return len(chunks)


# ══════════════════════════════════════════════════════════════════════════════
# TEXT EXTRACTION — from PDF or HTML
# ══════════════════════════════════════════════════════════════════════════════

def extract_text_from_pdf(path: Path) -> str:
    if PDF_BACKEND == "pdfplumber":
        import pdfplumber
        try:
            with pdfplumber.open(path) as pdf:
                return "\n".join(
                    page.extract_text() or "" for page in pdf.pages
                )
        except Exception as e:
            log.warning(f"pdfplumber failed on {path.name}: {e}")
    if PDF_BACKEND == "pypdf":
        import pypdf
        try:
            reader = pypdf.PdfReader(str(path))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as e:
            log.warning(f"pypdf failed on {path.name}: {e}")
    return ""


def extract_text_from_html(path: Path) -> str:
    try:
        soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="ignore"), "lxml")
        for tag in soup(["script","style","nav","footer","header"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)
    except Exception as e:
        log.warning(f"HTML extract failed {path.name}: {e}")
        return ""


def extract_text(path: Path) -> str:
    if path.suffix == ".pdf":
        return extract_text_from_pdf(path)
    elif path.suffix == ".html":
        return extract_text_from_html(path)
    return ""


# ══════════════════════════════════════════════════════════════════════════════
# PAYER DISCOVERY — same as before, returns all discoverable URLs
# ══════════════════════════════════════════════════════════════════════════════

UHC_BASE = "https://www.uhcprovider.com"
UHC_LISTINGS = {
    "drug":             "https://www.uhcprovider.com/en/policies-protocols/commercial-policies/commercial-medical-drug-policies.html",
    "medical":          "https://www.uhcprovider.com/en/policies-protocols/commercial-policies/commercial-medical-policies.html",
    "medicare_drug":    "https://www.uhcprovider.com/en/policies-protocols/medicare-advantage-policies/ma-medical-drug-policies.html",
    "medicare_medical": "https://www.uhcprovider.com/en/policies-protocols/medicare-advantage-policies/ma-medical-policies.html",
}
UHC_BULLETIN = "https://www.uhcprovider.com/content/dam/provider/docs/public/policies/mpub-archives/commercial/"

def discover_uhc():
    payer, docs = "UnitedHealthcare", []
    for year in [datetime.now().year, datetime.now().year-1]:
        for m in MONTHS:
            docs.append({"url": f"{UHC_BULLETIN}medical-policy-update-bulletin-{m}-{year}.pdf",
                          "title": f"UHC Bulletin {m.title()} {year}",
                          "policy_type":"bulletin","payer":payer})
    for ptype, url in UHC_LISTINGS.items():
        try:
            r = SESSION.get(url, timeout=20); r.raise_for_status()
            for a in BeautifulSoup(r.text,"html.parser").find_all("a",href=True):
                if a["href"].endswith(".pdf"):
                    docs.append({"url": urljoin(UHC_BASE, a["href"]),
                                  "title": a.get_text(strip=True) or Path(a["href"]).stem,
                                  "policy_type": ptype, "payer": payer})
            time.sleep(1)
        except Exception as e:
            log.warning(f"[UHC] {ptype}: {e}")
    return dedupe(docs)

def discover_aetna():
    payer, base, docs = "Aetna", "https://www.aetna.com", []
    for ptype, url in {
        "medical": "https://www.aetna.com/cpb/medical/data/cpb_alpha.html",
        "drug":    "https://www.aetna.com/health-care-professionals/clinical-policy-bulletins/medical-clinical-policy-bulletins.html"
    }.items():
        try:
            r = SESSION.get(url, timeout=20); r.raise_for_status()
            for a in BeautifulSoup(r.text,"html.parser").find_all("a",href=True):
                if "/cpb/" in a["href"]:
                    docs.append({"url": urljoin(base, a["href"]),
                                  "title": a.get_text(strip=True),
                                  "policy_type": ptype, "type":"html", "payer": payer})
            time.sleep(1)
        except Exception as e:
            log.warning(f"[Aetna] {ptype}: {e}")
    return dedupe(docs)

def discover_cigna():
    payer, static, docs = "Cigna", "https://static.cigna.com", []
    docs += [
        {"url":"https://static.cigna.com/assets/chcp/pdf/resourceLibrary/prescription/2025-prescription-drug-list-changes.pdf",
         "title":"Cigna 2025 Drug List Changes","policy_type":"drug","payer":payer},
    ]
    for year in [datetime.now().year, datetime.now().year-1]:
        for m in MONTHS:
            docs.append({"url":f"https://static.cigna.com/assets/chcp/pdf/coveragePolicies/policy_updates/{m}_{year}_policy_updates.pdf",
                          "title":f"Cigna Policy Updates {m.title()} {year}","policy_type":"bulletin","payer":payer})
    for ptype, url in {
        "drug":    "https://static.cigna.com/assets/chcp/resourceLibrary/coveragePolicies/pharmacy_a-z.html",
        "medical": "https://static.cigna.com/assets/chcp/resourceLibrary/coveragePolicies/medical_a-z.html",
    }.items():
        try:
            r = SESSION.get(url, timeout=20); r.raise_for_status()
            for a in BeautifulSoup(r.text,"html.parser").find_all("a",href=True):
                if a["href"].endswith(".pdf"):
                    docs.append({"url": urljoin(static, a["href"]),
                                  "title": a.get_text(strip=True) or Path(a["href"]).stem,
                                  "policy_type": ptype, "payer": payer})
            time.sleep(1)
        except Exception as e:
            log.warning(f"[Cigna] {ptype}: {e}")
    return dedupe(docs)

def discover_humana():
    payer, docs = "Humana", [
        {"url":"https://assets.humana.com/is/content/humana/FINAL589003ALL1024_2025_ProviderManualNonDelegatedpdf",
         "title":"Humana 2025 Provider Manual","policy_type":"medical","payer":"Humana"},
    ]
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        for ptype in ["drug","medical"]:
            try:
                url = f"https://mcp.humana.com/tad/tad_new/Search.aspx?searchtype=beginswith&docbegin={letter}&policyType={ptype}"
                r = SESSION.get(url, timeout=15); r.raise_for_status()
                for a in BeautifulSoup(r.text,"html.parser").find_all("a",href=True):
                    t = a.get_text(strip=True)
                    if len(t) > 3:
                        docs.append({"url": urljoin("https://mcp.humana.com", a["href"]),
                                      "title": t, "policy_type": ptype, "payer": payer})
                time.sleep(0.4)
            except Exception as e:
                log.warning(f"[Humana] {letter}/{ptype}: {e}")
    return dedupe(docs)

BCBS_CHAPTERS = [
    {"name":"BCBS Massachusetts","base":"https://www.bluecrossma.org",
     "medical_url":"https://www.bluecrossma.org/medical-policies/",
     "drug_url":"https://www.bluecrossma.org/medication/"},
    {"name":"CareFirst BCBS","base":"https://provider.carefirst.com",
     "medical_url":"https://provider.carefirst.com/providers/medical/medical-policy.page","drug_url":None},
    {"name":"Excellus BCBS","base":"https://www.excellusbcbs.com",
     "medical_url":"https://www.excellusbcbs.com/health-wellness/medical-policies",
     "drug_url":"https://www.excellusbcbs.com/health-wellness/drug-policies"},
    {"name":"BCBS Michigan","base":"https://www.bcbsm.com",
     "medical_url":"https://www.bcbsm.com/providers/clinical-criteria/",
     "drug_url":"https://www.bcbsm.com/individuals/resources/forms-documents/drug-lists/"},
    {"name":"BCBS Texas","base":"https://www.bcbstx.com",
     "medical_url":"https://www.bcbstx.com/provider/clinical/index.html",
     "drug_url":"https://www.bcbstx.com/prescription-drugs/managing-prescriptions/drug-lists"},
]

def discover_bcbs():
    payer, docs = "BCBS", []
    for ch in BCBS_CHAPTERS:
        for ptype in ["drug","medical"]:
            url = ch.get(f"{ptype}_url")
            if not url: continue
            try:
                r = SESSION.get(url, timeout=20); r.raise_for_status()
                for a in BeautifulSoup(r.text,"html.parser").find_all("a",href=True):
                    if a["href"].endswith(".pdf"):
                        docs.append({"url": urljoin(ch["base"], a["href"]),
                                      "title": f"[{ch['name']}] {a.get_text(strip=True)}",
                                      "policy_type": ptype, "payer": payer})
                time.sleep(1)
            except Exception as e:
                log.warning(f"[{ch['name']}] {ptype}: {e}")
    return dedupe(docs)

DISCOVERERS = {"uhc":discover_uhc,"aetna":discover_aetna,"cigna":discover_cigna,
               "humana":discover_humana,"bcbs":discover_bcbs}

def dedupe(docs):
    seen, out = set(), []
    for d in docs:
        if d["url"] not in seen:
            seen.add(d["url"]); out.append(d)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# DOWNLOAD + EMBED PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

def sanitize(s): return re.sub(r'[\\/*?:"<>|]',"_",s).strip()[:150]

def process_doc(doc: dict, conn, collection, delay=1.2) -> tuple[bool,bool]:
    """Download (if new), extract text, chunk, embed, upsert. Returns (ok, is_new)."""
    url     = doc["url"]
    is_html = doc.get("type") == "html"
    title   = sanitize(doc.get("title","untitled"))
    ptype   = doc.get("policy_type","unknown")
    pname   = sanitize(doc.get("payer","unknown"))

    dest_dir = BASE_DIR / pname / ptype
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{title}{'.html' if is_html else '.pdf'}"

    # Already known and in vector DB → just mark checked
    if is_known(conn, url) and dest.exists():
        mark_seen(conn, url)
        return True, False

    # ── Download ──
    try:
        r = SESSION.get(url, timeout=30, stream=not is_html)
        r.raise_for_status()
        if is_html:
            dest.write_text(r.text, encoding="utf-8")
        else:
            with open(dest,"wb") as f:
                for chunk in r.iter_content(8192): f.write(chunk)
        time.sleep(delay)
    except Exception as e:
        log.error(f"  [DOWNLOAD FAIL] {url}: {e}")
        return False, False

    # ── Extract text ──
    text = extract_text(dest)
    if not text.strip():
        log.warning(f"  [NO TEXT] {dest.name} — skipping embed")
        fhash = sha256(dest)
        register(conn, doc, dest, fhash, 0)
        return True, True

    # ── Chunk ──
    chunks = chunk_text(text, doc.get("title", title))
    log.info(f"  [NEW] {title[:55]} → {len(chunks)} chunks")

    # ── Embed + Upsert ──
    n = upsert_to_chroma(collection, doc, chunks)

    fhash = sha256(dest)
    register(conn, doc, dest, fhash, n)
    return True, True


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Insurance Policy Daily Sync → ChromaDB")
    parser.add_argument("--payers", nargs="+", default=list(DISCOVERERS.keys()),
                        choices=list(DISCOVERERS.keys()))
    parser.add_argument("--force",   action="store_true", help="Wipe DB and re-ingest all")
    parser.add_argument("--dry-run", action="store_true", help="Discover only, no download/embed")
    parser.add_argument("--delay",   type=float, default=1.2)
    args = parser.parse_args()

    log.info("=" * 65)
    log.info(f"Insurance Policy Sync → ChromaDB  [{datetime.now():%Y-%m-%d %H:%M}]")
    log.info(f"Payers : {args.payers}  |  Force: {args.force}  |  DryRun: {args.dry_run}")
    log.info("=" * 65)

    conn       = init_db()
    collection = get_chroma_collection()
    start      = datetime.now()

    if args.force:
        conn.execute("DELETE FROM policies"); conn.commit()
        # Wipe chroma collection
        client = chromadb.PersistentClient(path=str(CHROMA_DIR),
                                           settings=Settings(anonymized_telemetry=False))
        client.delete_collection("insurance_policies")
        collection = get_chroma_collection()
        log.info("Force mode — DB and vector store cleared.")

    totals = {"new":0, "fail":0, "checked":0}
    new_docs_log = []

    for payer_key in args.payers:
        log.info(f"\n── Discovering: {payer_key.upper()} ──")
        try:
            all_docs = DISCOVERERS[payer_key]()
        except Exception as e:
            log.error(f"Discovery error [{payer_key}]: {e}"); continue

        new_for_payer = [d for d in all_docs if not is_known(conn, d["url"])]
        totals["checked"] += len(all_docs)
        log.info(f"  {len(all_docs)} URLs found  |  {len(new_for_payer)} are NEW")

        if args.dry_run:
            for d in new_for_payer:
                log.info(f"  [DRY-RUN] {d.get('title','')[:70]}")
            continue

        for doc in tqdm(all_docs, desc=payer_key):
            ok, is_new = process_doc(doc, conn, collection, args.delay)
            if is_new:
                totals["new"] += 1
                new_docs_log.append(doc)
            if not ok:
                totals["fail"] += 1

    duration = (datetime.now() - start).total_seconds()

    # ── Log this run ──
    if not args.dry_run:
        conn.execute("INSERT INTO sync_runs (run_at,new_docs,failed_docs,total_checked,duration_sec) VALUES (?,?,?,?,?)",
                     (start.isoformat(), totals["new"], totals["fail"], totals["checked"], duration))
        conn.commit()

        history = json.loads(RUN_LOG.read_text()) if RUN_LOG.exists() else []
        history.append({"run_at": start.isoformat(), **totals,
                         "new_titles": [d.get("title","") for d in new_docs_log]})
        RUN_LOG.write_text(json.dumps(history[-90:], indent=2))

        total_vectors = collection.count()
        log.info(f"\nChromaDB now holds {total_vectors:,} vectors")

    # ── Summary ──
    log.info("\n" + "=" * 65)
    log.info("SYNC COMPLETE")
    log.info(f"  Duration      : {duration:.1f}s")
    log.info(f"  Total checked : {totals['checked']}")
    log.info(f"  ✅ New docs    : {totals['new']}")
    log.info(f"  ❌ Failed      : {totals['fail']}")
    if new_docs_log:
        log.info("\n  NEW DOCUMENTS THIS RUN:")
        for d in new_docs_log:
            log.info(f"    [{d.get('payer')}] {d.get('title','')[:65]}")
    else:
        log.info("\n  No new documents — everything is up to date.")
    log.info("=" * 65)
    conn.close()


if __name__ == "__main__":
    main()
