import hashlib
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Protocol
from urllib.parse import urljoin, urlparse

import requests

import db as db_layer


logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


HTTP_TIMEOUT_SEC = _env_float("SOURCE_REFRESH_HTTP_TIMEOUT_SEC", 15.0)
MAX_FETCH_BYTES = _env_int("SOURCE_REFRESH_MAX_FETCH_BYTES", 2_500_000)
MAX_DISCOVERY_PER_SOURCE = _env_int("SOURCE_REFRESH_MAX_DISCOVERY_PER_SOURCE", 5)
DEFAULT_USER_AGENT = os.environ.get(
    "SOURCE_REFRESH_USER_AGENT",
    "CoverageAtlasSourceRefresh/0.1",
)


@dataclass
class DiscoveredDocument:
    document_url: str
    title: str
    file_type: Optional[str] = None
    published_date: Optional[str] = None
    effective_date: Optional[str] = None
    external_id: Optional[str] = None
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    payload: dict[str, Any] = field(default_factory=dict)


class SourceAdapter(Protocol):
    def discover(self, source: dict[str, Any], limit: int) -> list[DiscoveredDocument]:
        ...


class MockStaticAdapter:
    """
    Deterministic adapter used for dry-run and self-tests.
    It never performs network calls.
    """

    def discover(self, source: dict[str, Any], limit: int) -> list[DiscoveredDocument]:
        base = (source.get("entry_url") or "https://example.org").rstrip("/")
        source_key = source.get("source_key", "unknown-source")
        safe_limit = max(1, min(int(limit), 10))
        docs: list[DiscoveredDocument] = []
        for idx in range(1, safe_limit + 1):
            docs.append(
                DiscoveredDocument(
                    document_url=f"{base}/sample-policy-{idx}.pdf",
                    title=f"{source_key} sample policy {idx}",
                    file_type="pdf",
                    external_id=f"{source_key}:{idx}",
                    payload={"mock": True, "sequence": idx},
                )
            )
        return docs


class HtmlIndexLinksAdapter:
    """
    Small-scale discovery adapter:
    - fetches one HTML index page
    - extracts document links (pdf/docx/html)
    - returns up to `limit` links
    """

    _EXTENSIONS = (".pdf", ".docx", ".html", ".htm")

    def discover(self, source: dict[str, Any], limit: int) -> list[DiscoveredDocument]:
        BeautifulSoup = None
        try:
            from bs4 import BeautifulSoup as _BeautifulSoup
            BeautifulSoup = _BeautifulSoup
        except ImportError:
            BeautifulSoup = None

        entry_url = (source.get("entry_url") or "").strip()
        if not entry_url:
            return []

        metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
        same_domain_only = bool(metadata.get("same_domain_only", True))

        headers = {"User-Agent": DEFAULT_USER_AGENT}
        response = requests.get(entry_url, timeout=HTTP_TIMEOUT_SEC, headers=headers, allow_redirects=True)
        response.raise_for_status()

        content_type = (response.headers.get("Content-Type") or "").lower()
        base_url = response.url or entry_url

        # If entry URL itself is a direct document, treat as one discovered item.
        if self._looks_like_document_url(base_url):
            return [
                DiscoveredDocument(
                    document_url=base_url,
                    title=self._fallback_title(base_url),
                    file_type=_normalize_file_type(None, base_url, content_type),
                    payload={"adapter": "html_index_links", "direct_document": True},
                )
            ][: max(1, min(limit, MAX_DISCOVERY_PER_SOURCE))]

        if "html" not in content_type and "xml" not in content_type:
            return []

        docs: list[DiscoveredDocument] = []
        seen_urls: set[str] = set()
        target_host = urlparse(base_url).netloc.lower()
        if BeautifulSoup is not None:
            soup = BeautifulSoup(response.text, "lxml")
            anchors = [
                ((a_tag.get("href") or "").strip(), (a_tag.get_text(" ", strip=True) or "").strip())
                for a_tag in soup.find_all("a")
            ]
        else:
            # Minimal fallback parser for environments without bs4.
            anchors = [(href.strip(), "") for href in re.findall(r'href=[\"\\\']([^\"\\\']+)[\"\\\']', response.text, re.IGNORECASE)]

        for href, anchor_text in anchors:
            if not href:
                continue
            if href.startswith("#") or href.lower().startswith("javascript:") or href.lower().startswith("mailto:"):
                continue

            absolute = urljoin(base_url, href)
            parsed = urlparse(absolute)
            if parsed.scheme not in {"http", "https"}:
                continue

            if same_domain_only and parsed.netloc.lower() and parsed.netloc.lower() != target_host:
                continue

            if not self._looks_like_document_url(absolute):
                continue

            normalized_url = absolute.strip()
            if normalized_url in seen_urls:
                continue
            seen_urls.add(normalized_url)

            title = anchor_text or self._fallback_title(normalized_url)
            file_type = _normalize_file_type(None, normalized_url, None)

            docs.append(
                DiscoveredDocument(
                    document_url=normalized_url,
                    title=title,
                    file_type=file_type,
                    payload={"adapter": "html_index_links", "anchor_text": anchor_text},
                )
            )

            if len(docs) >= max(1, min(limit, MAX_DISCOVERY_PER_SOURCE)):
                break

        return docs

    def _looks_like_document_url(self, url: str) -> bool:
        lower = url.lower()
        return any(lower.endswith(ext) for ext in self._EXTENSIONS)

    def _fallback_title(self, url: str) -> str:
        path = urlparse(url).path.strip("/")
        if not path:
            return "policy document"
        leaf = path.split("/")[-1]
        return leaf.replace("-", " ").replace("_", " ")


def _normalize_file_type(file_type: Optional[str], document_url: str, content_type: Optional[str] = None) -> str:
    clean = (file_type or "").strip().lower()
    if clean in {"pdf", "html", "docx"}:
        return clean

    ctype = (content_type or "").lower()
    if "application/pdf" in ctype:
        return "pdf"
    if "application/vnd.openxmlformats-officedocument.wordprocessingml.document" in ctype:
        return "docx"
    if "text/html" in ctype or "application/xhtml+xml" in ctype:
        return "html"

    lower_url = (document_url or "").lower()
    if lower_url.endswith(".pdf"):
        return "pdf"
    if lower_url.endswith(".docx"):
        return "docx"
    if lower_url.endswith(".html") or lower_url.endswith(".htm"):
        return "html"
    return "other"


def _fetch_document_snapshot(
    document_url: str,
    hinted_file_type: Optional[str] = None,
) -> dict[str, Any]:
    headers = {"User-Agent": DEFAULT_USER_AGENT}

    etag = None
    last_modified = None
    head_content_type = None
    head_content_length = None

    try:
        head_response = requests.head(
            document_url,
            timeout=HTTP_TIMEOUT_SEC,
            headers=headers,
            allow_redirects=True,
        )
        if head_response is not None:
            etag = head_response.headers.get("ETag")
            last_modified = head_response.headers.get("Last-Modified")
            head_content_type = head_response.headers.get("Content-Type")
            head_content_length = head_response.headers.get("Content-Length")
    except requests.RequestException:
        # HEAD failures are common; continue with GET.
        pass

    response = requests.get(
        document_url,
        timeout=HTTP_TIMEOUT_SEC,
        headers=headers,
        allow_redirects=True,
        stream=True,
    )
    response.raise_for_status()

    hasher = hashlib.sha256()
    total_bytes = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total_bytes += len(chunk)
        if total_bytes > MAX_FETCH_BYTES:
            raise RuntimeError(
                f"Document exceeded max fetch size ({MAX_FETCH_BYTES} bytes)."
            )
        hasher.update(chunk)

    final_url = response.url or document_url
    content_type = response.headers.get("Content-Type") or head_content_type

    return {
        "document_url": final_url,
        "content_hash": hasher.hexdigest(),
        "etag": (response.headers.get("ETag") or etag),
        "last_modified": (response.headers.get("Last-Modified") or last_modified),
        "content_type": content_type,
        "content_length": total_bytes,
        "head_content_length": head_content_length,
        "file_type": _normalize_file_type(hinted_file_type, final_url, content_type),
        "http_status": response.status_code,
    }


def _classify_change(previous_state: Optional[dict[str, Any]], snapshot: dict[str, Any]) -> str:
    if not previous_state:
        return "new"

    previous_hash = (previous_state.get("content_hash") or "").strip()
    current_hash = (snapshot.get("content_hash") or "").strip()
    if previous_hash and current_hash and previous_hash == current_hash:
        return "unchanged"

    previous_etag = (previous_state.get("etag") or "").strip()
    current_etag = (snapshot.get("etag") or "").strip()
    if previous_etag and current_etag and previous_etag == current_etag:
        return "unchanged"

    return "changed"


def _make_error_item(
    *,
    source_id: Any,
    source_key: str,
    document_url: str,
    adapter_name: str,
    stage: str,
    error_type: str,
    message: str,
) -> dict[str, Any]:
    return {
        "source_id": source_id,
        "source_key": source_key,
        "external_id": None,
        "document_url": document_url,
        "normalized_title": None,
        "file_type": "other",
        "published_date": None,
        "effective_date": None,
        "change_status": "error",
        "content_hash": None,
        "etag": None,
        "last_modified": None,
        "payload": {
            "stage": stage,
            "error_type": error_type,
            "adapter_name": adapter_name,
        },
        "error": message[:500],
    }


def discover_from_sources(
    *,
    sources: list[dict[str, Any]],
    adapter_registry: dict[str, SourceAdapter],
    limit_per_source: int,
    fetch_enabled: bool,
    ingestion_enabled: bool,
    get_state: Optional[Callable[[str, str], Optional[dict[str, Any]]]] = None,
    upsert_state: Optional[Callable[..., None]] = None,
) -> dict[str, Any]:
    """
    Runs source discovery and optional small-scale fetch+hash detection.

    Notes:
    - ingestion execution is intentionally not implemented in this phase.
    - if ingestion_enabled=True, we only report would-be queue count.
    """
    run_items: list[dict[str, Any]] = []
    discovered_count = 0
    changed_count = 0
    queued_for_ingestion_count = 0
    failed_count = 0

    safe_limit = max(1, min(int(limit_per_source), MAX_DISCOVERY_PER_SOURCE))

    for source in sources:
        source_id = source.get("id")
        source_key = source.get("source_key", "unknown")
        adapter_name = (source.get("adapter_name") or "").strip()

        adapter = adapter_registry.get(adapter_name)
        if adapter is None:
            failed_count += 1
            run_items.append(
                _make_error_item(
                    source_id=source_id,
                    source_key=source_key,
                    document_url=source.get("entry_url", ""),
                    adapter_name=adapter_name,
                    stage="discovery",
                    error_type="missing_adapter",
                    message=f"No adapter registered for '{adapter_name}'.",
                )
            )
            continue

        try:
            discovered_docs = adapter.discover(source, safe_limit)
        except Exception as exc:
            failed_count += 1
            run_items.append(
                _make_error_item(
                    source_id=source_id,
                    source_key=source_key,
                    document_url=source.get("entry_url", ""),
                    adapter_name=adapter_name,
                    stage="discovery",
                    error_type="adapter_exception",
                    message=str(exc),
                )
            )
            continue

        for doc in discovered_docs:
            discovered_count += 1
            doc_url = (doc.document_url or "").strip()
            if not doc_url:
                failed_count += 1
                run_items.append(
                    _make_error_item(
                        source_id=source_id,
                        source_key=source_key,
                        document_url="",
                        adapter_name=adapter_name,
                        stage="discovery",
                        error_type="invalid_document_url",
                        message="Adapter returned an empty document URL.",
                    )
                )
                continue

            normalized_title = (doc.title or "").strip() or None

            if not fetch_enabled:
                change_status = "skipped"
                item = {
                    "source_id": source_id,
                    "source_key": source_key,
                    "external_id": doc.external_id,
                    "document_url": doc_url,
                    "normalized_title": normalized_title,
                    "file_type": _normalize_file_type(doc.file_type, doc_url, None),
                    "published_date": doc.published_date,
                    "effective_date": doc.effective_date,
                    "change_status": change_status,
                    "content_hash": None,
                    "etag": doc.etag,
                    "last_modified": doc.last_modified,
                    "payload": {"stage": "discovery", "reason": "fetch_disabled", **(doc.payload or {})},
                    "error": None,
                }
                run_items.append(item)
                if upsert_state is not None:
                    upsert_state(
                        source_id=source_id,
                        source_key=source_key,
                        document_url=doc_url,
                        normalized_title=normalized_title,
                        file_type=item["file_type"],
                        content_hash=None,
                        etag=doc.etag,
                        last_modified=doc.last_modified,
                        published_date=doc.published_date,
                        effective_date=doc.effective_date,
                        last_change_status=change_status,
                        metadata=item["payload"],
                    )
                continue

            try:
                snapshot = _fetch_document_snapshot(doc_url, doc.file_type)
                previous_state = get_state(source_key, doc_url) if get_state is not None else None
                change_status = _classify_change(previous_state, snapshot)

                if change_status in {"new", "changed"}:
                    changed_count += 1
                    if ingestion_enabled:
                        queued_for_ingestion_count += 1

                payload = {
                    "stage": "fetch",
                    "adapter": adapter_name,
                    "content_type": snapshot.get("content_type"),
                    "content_length": snapshot.get("content_length"),
                    "ingestion_action": (
                        "would_queue" if ingestion_enabled and change_status in {"new", "changed"} else "none"
                    ),
                    **(doc.payload or {}),
                }
                item = {
                    "source_id": source_id,
                    "source_key": source_key,
                    "external_id": doc.external_id,
                    "document_url": snapshot.get("document_url", doc_url),
                    "normalized_title": normalized_title,
                    "file_type": snapshot.get("file_type") or _normalize_file_type(doc.file_type, doc_url, None),
                    "published_date": doc.published_date,
                    "effective_date": doc.effective_date,
                    "change_status": change_status,
                    "content_hash": snapshot.get("content_hash"),
                    "etag": snapshot.get("etag") or doc.etag,
                    "last_modified": snapshot.get("last_modified") or doc.last_modified,
                    "payload": payload,
                    "error": None,
                }
                run_items.append(item)

                if upsert_state is not None:
                    upsert_state(
                        source_id=source_id,
                        source_key=source_key,
                        document_url=item["document_url"],
                        normalized_title=normalized_title,
                        file_type=item["file_type"],
                        content_hash=item["content_hash"],
                        etag=item["etag"],
                        last_modified=item["last_modified"],
                        published_date=doc.published_date,
                        effective_date=doc.effective_date,
                        last_change_status=change_status,
                        metadata=payload,
                    )
            except Exception as exc:
                failed_count += 1
                run_items.append(
                    {
                        "source_id": source_id,
                        "source_key": source_key,
                        "external_id": doc.external_id,
                        "document_url": doc_url,
                        "normalized_title": normalized_title,
                        "file_type": _normalize_file_type(doc.file_type, doc_url, None),
                        "published_date": doc.published_date,
                        "effective_date": doc.effective_date,
                        "change_status": "error",
                        "content_hash": None,
                        "etag": doc.etag,
                        "last_modified": doc.last_modified,
                        "payload": {"stage": "fetch", "adapter": adapter_name, **(doc.payload or {})},
                        "error": str(exc)[:500],
                    }
                )

    return {
        "items": run_items,
        "summary": {
            "discovered_count": discovered_count,
            "changed_count": changed_count,
            "queued_for_ingestion_count": queued_for_ingestion_count,
            "failed_count": failed_count,
            "sources_processed": len(sources),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }


def run_refresh(
    *,
    source_group: str = "default",
    source_keys: Optional[list[str]] = None,
    limit_per_source: int = 3,
    dry_run: bool = True,
    fetch_enabled: bool = False,
    ingestion_enabled: bool = False,
) -> dict[str, Any]:
    adapter_registry: dict[str, SourceAdapter] = {
        "mock_static": MockStaticAdapter(),
        "html_index_links": HtmlIndexLinksAdapter(),
    }

    with db_layer.get_conn() as conn:
        run_id = db_layer.create_source_refresh_run(
            conn=conn,
            source_group=source_group,
            dry_run=dry_run,
            fetch_enabled=fetch_enabled,
            ingestion_enabled=ingestion_enabled,
            status="queued",
            log={"phase": "created"},
        )

        db_layer.mark_source_refresh_run_started(conn, run_id)

        sources = db_layer.list_source_registry(
            conn,
            source_group=source_group,
            enabled_only=True,
            source_keys=source_keys or [],
        )

        result = discover_from_sources(
            sources=sources,
            adapter_registry=adapter_registry,
            limit_per_source=limit_per_source,
            fetch_enabled=fetch_enabled,
            ingestion_enabled=ingestion_enabled,
            get_state=lambda key, url: db_layer.get_source_document_state(conn, key, url),
            upsert_state=lambda **kwargs: db_layer.upsert_source_document_state(conn, **kwargs),
        )

        for item in result["items"]:
            db_layer.insert_source_refresh_item(
                conn=conn,
                run_id=run_id,
                source_id=item.get("source_id"),
                source_key=item.get("source_key"),
                external_id=item.get("external_id"),
                document_url=item.get("document_url"),
                normalized_title=item.get("normalized_title"),
                file_type=item.get("file_type"),
                published_date=item.get("published_date"),
                effective_date=item.get("effective_date"),
                change_status=item.get("change_status"),
                content_hash=item.get("content_hash"),
                etag=item.get("etag"),
                last_modified=item.get("last_modified"),
                payload=item.get("payload", {}),
                error=item.get("error"),
            )

        summary = result["summary"]
        status = "failed" if summary["failed_count"] > 0 and summary["discovered_count"] == 0 else "completed"
        db_layer.complete_source_refresh_run(
            conn=conn,
            run_id=run_id,
            status=status,
            discovered_count=summary["discovered_count"],
            changed_count=summary["changed_count"],
            queued_for_ingestion_count=summary["queued_for_ingestion_count"],
            failed_count=summary["failed_count"],
            log={
                "phase": "completed",
                "dry_run": dry_run,
                "fetch_enabled": fetch_enabled,
                "ingestion_enabled": ingestion_enabled,
                "sources_processed": summary["sources_processed"],
                "note": "ingestion_execution_not_enabled_in_phase_2",
            },
            error=None,
        )

        run_row = db_layer.get_source_refresh_run(conn, run_id)
        items = db_layer.list_source_refresh_items(conn, run_id)

    logger.info(
        "Source refresh completed run_id=%s summary=%s",
        run_id,
        {
            "discovered_count": run_row.get("discovered_count") if run_row else None,
            "changed_count": run_row.get("changed_count") if run_row else None,
            "failed_count": run_row.get("failed_count") if run_row else None,
            "status": run_row.get("status") if run_row else None,
        },
    )

    return {
        "run": run_row,
        "items": items,
    }
