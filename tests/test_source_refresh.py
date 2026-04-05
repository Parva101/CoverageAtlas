import unittest
from unittest.mock import patch

import requests

from backend.app.source_refresh import (
    HtmlIndexLinksAdapter,
    MockStaticAdapter,
    discover_from_sources,
)


class _FakeResponse:
    def __init__(self, *, body: bytes = b"", text: str = "", headers=None, status_code: int = 200, url: str = ""):
        self._body = body if body else text.encode("utf-8")
        self.text = text if text else self._body.decode("utf-8", errors="ignore")
        self.headers = headers or {}
        self.status_code = status_code
        self.url = url

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def iter_content(self, chunk_size: int = 65536):
        for idx in range(0, len(self._body), chunk_size):
            yield self._body[idx : idx + chunk_size]


class SourceRefreshDiscoveryTests(unittest.TestCase):
    def test_discovery_skips_when_fetch_disabled(self) -> None:
        sources = [
            {
                "id": "src-1",
                "source_key": "uhc:medical",
                "entry_url": "https://example.org/uhc",
                "adapter_name": "mock_static",
            }
        ]
        adapters = {"mock_static": MockStaticAdapter()}

        result = discover_from_sources(
            sources=sources,
            adapter_registry=adapters,
            limit_per_source=2,
            fetch_enabled=False,
            ingestion_enabled=False,
        )

        self.assertEqual(result["summary"]["discovered_count"], 2)
        self.assertEqual(result["summary"]["failed_count"], 0)
        self.assertEqual(len(result["items"]), 2)
        for item in result["items"]:
            self.assertEqual(item["change_status"], "skipped")
            self.assertEqual(item["payload"].get("reason"), "fetch_disabled")

    def test_discovery_reports_missing_adapter(self) -> None:
        sources = [
            {
                "id": "src-2",
                "source_key": "aetna:medical",
                "entry_url": "https://example.org/aetna",
                "adapter_name": "not_registered",
            }
        ]

        result = discover_from_sources(
            sources=sources,
            adapter_registry={},
            limit_per_source=1,
            fetch_enabled=False,
            ingestion_enabled=False,
        )

        self.assertEqual(result["summary"]["discovered_count"], 0)
        self.assertEqual(result["summary"]["failed_count"], 1)
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["change_status"], "error")
        self.assertIn("No adapter registered", result["items"][0]["error"])

    @patch("backend.app.source_refresh.requests.head")
    @patch("backend.app.source_refresh.requests.get")
    def test_fetch_hash_based_change_detection(self, mock_get, mock_head) -> None:
        source_url = "https://example.org/cigna/sample-policy-1.pdf"

        mock_head.return_value = _FakeResponse(
            headers={"ETag": "etag-v1"},
            status_code=200,
            url=source_url,
        )

        state_store = {}

        def _get_state(source_key: str, document_url: str):
            return state_store.get((source_key, document_url))

        def _upsert_state(**kwargs):
            state_store[(kwargs["source_key"], kwargs["document_url"])] = dict(kwargs)

        sources = [
            {
                "id": "src-3",
                "source_key": "cigna:medical",
                "entry_url": "https://example.org/cigna",
                "adapter_name": "mock_static",
            }
        ]
        adapters = {"mock_static": MockStaticAdapter()}

        # First run -> new
        mock_get.return_value = _FakeResponse(
            body=b"alpha-policy-content",
            headers={"Content-Type": "application/pdf", "ETag": "etag-v1"},
            status_code=200,
            url=source_url,
        )
        first = discover_from_sources(
            sources=sources,
            adapter_registry=adapters,
            limit_per_source=1,
            fetch_enabled=True,
            ingestion_enabled=False,
            get_state=_get_state,
            upsert_state=_upsert_state,
        )
        self.assertEqual(first["summary"]["discovered_count"], 1)
        self.assertEqual(first["summary"]["failed_count"], 0)
        self.assertEqual(first["summary"]["changed_count"], 1)
        self.assertEqual(first["items"][0]["change_status"], "new")

        # Second run with same content -> unchanged
        mock_get.return_value = _FakeResponse(
            body=b"alpha-policy-content",
            headers={"Content-Type": "application/pdf", "ETag": "etag-v1"},
            status_code=200,
            url=source_url,
        )
        second = discover_from_sources(
            sources=sources,
            adapter_registry=adapters,
            limit_per_source=1,
            fetch_enabled=True,
            ingestion_enabled=False,
            get_state=_get_state,
            upsert_state=_upsert_state,
        )
        self.assertEqual(second["summary"]["changed_count"], 0)
        self.assertEqual(second["items"][0]["change_status"], "unchanged")

        # Third run with changed bytes -> changed and would queue if ingestion_enabled
        mock_get.return_value = _FakeResponse(
            body=b"beta-policy-content",
            headers={"Content-Type": "application/pdf", "ETag": "etag-v2"},
            status_code=200,
            url=source_url,
        )
        third = discover_from_sources(
            sources=sources,
            adapter_registry=adapters,
            limit_per_source=1,
            fetch_enabled=True,
            ingestion_enabled=True,
            get_state=_get_state,
            upsert_state=_upsert_state,
        )
        self.assertEqual(third["summary"]["changed_count"], 1)
        self.assertEqual(third["summary"]["queued_for_ingestion_count"], 1)
        self.assertEqual(third["items"][0]["change_status"], "changed")

    @patch("backend.app.source_refresh.requests.get")
    def test_html_index_adapter_extracts_document_links(self, mock_get) -> None:
        entry_url = "https://payer.example.com/policies"
        html = """
        <html><body>
          <a href="/docs/policy-a.pdf">Policy A</a>
          <a href="https://payer.example.com/docs/policy-b.docx">Policy B</a>
          <a href="/not-a-doc">Ignore Me</a>
        </body></html>
        """
        mock_get.return_value = _FakeResponse(
            text=html,
            headers={"Content-Type": "text/html"},
            status_code=200,
            url=entry_url,
        )

        adapter = HtmlIndexLinksAdapter()
        docs = adapter.discover(
            {
                "source_key": "payer:demo",
                "entry_url": entry_url,
                "metadata": {"same_domain_only": True},
            },
            limit=5,
        )

        self.assertEqual(len(docs), 2)
        self.assertTrue(docs[0].document_url.startswith("https://payer.example.com/"))
        self.assertIn(docs[0].file_type, {"pdf", "docx", "html"})


if __name__ == "__main__":
    unittest.main()
