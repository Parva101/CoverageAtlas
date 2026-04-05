"""
Provider-aware Gemini helper.

Supports:
1) Gemini Developer API key (existing mode)
2) Vertex AI mode with API key + project/location (recommended for this repo)
3) Vertex AI mode with ADC credentials
"""

from __future__ import annotations

import os
import threading
from typing import Any

import requests

try:
    from google import genai as modern_genai
except ImportError:  # pragma: no cover
    modern_genai = None

legacy_genai = None

_LEGACY_LOCK = threading.Lock()
_LEGACY_CONFIGURED = False
_VERTEX_CLIENT_LOCK = threading.Lock()
_VERTEX_CLIENT: Any = None


def _truthy(value: str | None) -> bool:
    if not value:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _provider() -> str:
    explicit = os.environ.get("GEMINI_PROVIDER", "").strip().lower()
    if explicit in {"vertex", "vertexai"}:
        return "vertex"
    if explicit in {"google", "developer", "gemini"}:
        return "developer"

    if _truthy(os.environ.get("GOOGLE_GENAI_USE_VERTEXAI")):
        return "vertex"
    if os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip():
        return "vertex"
    if os.environ.get("VERTEX_API_KEY", "").strip():
        return "vertex"
    return "developer"


def _normalize_model(model: str) -> str:
    cleaned = (model or "").strip()
    if cleaned.startswith("models/"):
        return cleaned.split("/", 1)[1]
    return cleaned


def _developer_api_key() -> str:
    return (
        os.environ.get("GEMINI_API_KEY", "").strip()
        or os.environ.get("GOOGLE_API_KEY", "").strip()
    )


def _vertex_api_key() -> str:
    return (
        os.environ.get("VERTEX_API_KEY", "").strip()
        or os.environ.get("GOOGLE_API_KEY", "").strip()
        or os.environ.get("GEMINI_API_KEY", "").strip()
    )


def _vertex_project() -> str:
    return os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()


def _vertex_location() -> str:
    return os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1").strip() or "us-central1"


def _vertex_model_resource(model: str) -> str:
    model_id = _normalize_model(model)
    project = _vertex_project()
    location = _vertex_location()
    if project:
        return f"projects/{project}/locations/{location}/publishers/google/models/{model_id}"
    # Best effort for express-mode style calls.
    return f"publishers/google/models/{model_id}"


def _ensure_legacy_configured() -> None:
    global legacy_genai
    global _LEGACY_CONFIGURED
    if _LEGACY_CONFIGURED:
        return
    with _LEGACY_LOCK:
        if _LEGACY_CONFIGURED:
            return
        if legacy_genai is None:
            try:
                import google.generativeai as legacy_genai_module
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "google-generativeai is required for Gemini Developer API mode."
                ) from exc
            legacy_genai = legacy_genai_module
        api_key = _developer_api_key()
        if not api_key:
            raise RuntimeError(
                "Missing GEMINI_API_KEY/GOOGLE_API_KEY for Gemini Developer API mode."
            )
        legacy_genai.configure(api_key=api_key)
        _LEGACY_CONFIGURED = True


def _vertex_post(model: str, method: str, body: dict[str, Any]) -> dict[str, Any]:
    api_key = _vertex_api_key()
    if not api_key:
        raise RuntimeError(
            "Missing Vertex API key. Set VERTEX_API_KEY (or GOOGLE_API_KEY / GEMINI_API_KEY)."
        )

    resource = _vertex_model_resource(model)
    url = f"https://aiplatform.googleapis.com/v1/{resource}:{method}"
    response = requests.post(
        url,
        params={"key": api_key},
        json=body,
        timeout=90,
    )
    if not response.ok:
        detail = response.text[:800]
        if method == "embedContent" and not _vertex_project():
            detail = (
                detail
                + " Hint: set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION for Vertex embedding calls."
            )
        raise RuntimeError(f"Vertex {method} failed ({response.status_code}): {detail}")
    return response.json()


def _get_vertex_client():
    global _VERTEX_CLIENT
    if _VERTEX_CLIENT is not None:
        return _VERTEX_CLIENT
    with _VERTEX_CLIENT_LOCK:
        if _VERTEX_CLIENT is not None:
            return _VERTEX_CLIENT
        if modern_genai is None:
            raise RuntimeError(
                "google-genai is required for Vertex SDK mode. Install google-genai."
            )
        project = _vertex_project()
        location = _vertex_location()
        if not project:
            raise RuntimeError(
                "GOOGLE_CLOUD_PROJECT is required for Vertex SDK mode when no API key is used."
            )
        _VERTEX_CLIENT = modern_genai.Client(
            vertexai=True,
            project=project,
            location=location,
        )
        return _VERTEX_CLIENT


def _extract_modern_embedding(response: Any) -> list[float]:
    embeddings = getattr(response, "embeddings", None)
    if embeddings:
        first = embeddings[0]
        values = getattr(first, "values", None)
        if values:
            return list(values)

    embedding = getattr(response, "embedding", None)
    if embedding is not None:
        values = getattr(embedding, "values", None)
        if values:
            return list(values)

    if isinstance(response, dict):
        emb = response.get("embedding") or {}
        values = emb.get("values")
        if values:
            return list(values)

    raise RuntimeError("Unable to parse embedding response from Gemini provider.")


def _extract_modern_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        chunks: list[str] = []
        for part in parts:
            part_text = getattr(part, "text", None)
            if isinstance(part_text, str) and part_text.strip():
                chunks.append(part_text.strip())
        if chunks:
            return "\n".join(chunks).strip()

    if isinstance(response, dict):
        for candidate in response.get("candidates", []):
            content = candidate.get("content", {})
            parts = content.get("parts", [])
            chunks = [p.get("text", "").strip() for p in parts if p.get("text")]
            if chunks:
                return "\n".join(chunks).strip()

    return ""


def embed_texts(texts: list[str], model: str, task_type: str) -> list[list[float]]:
    payloads = [str(t or "").strip() for t in texts if str(t or "").strip()]
    if not payloads:
        return []

    if _provider() == "vertex":
        if _vertex_api_key():
            vectors: list[list[float]] = []
            for text in payloads:
                body = {
                    "content": {
                        "role": "user",
                        "parts": [{"text": text}],
                    },
                    "embedContentConfig": {
                        "taskType": task_type.upper(),
                    },
                }
                data = _vertex_post(model=model, method="embedContent", body=body)
                values = (((data.get("embedding") or {}).get("values")) or [])
                if not values:
                    raise RuntimeError("Vertex embedContent returned an empty embedding vector.")
                vectors.append(values)
            return vectors

        client = _get_vertex_client()
        vectors = []
        for text in payloads:
            response = client.models.embed_content(
                model=_normalize_model(model),
                contents=text,
                config={"task_type": task_type.upper()},
            )
            vectors.append(_extract_modern_embedding(response))
        return vectors

    _ensure_legacy_configured()
    result = legacy_genai.embed_content(
        model=model,
        content=payloads,
        task_type=task_type,
    )
    raw = result["embedding"]
    if raw and isinstance(raw[0], list):
        return raw
    return [raw]


def embed_text(text: str, model: str, task_type: str) -> list[float]:
    vectors = embed_texts([text], model=model, task_type=task_type)
    if not vectors:
        raise RuntimeError("Embedding request returned no vectors.")
    return vectors[0]


def generate_text(
    prompt: str,
    model: str,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    system_instruction: str | None = None,
) -> str:
    if _provider() == "vertex":
        if _vertex_api_key():
            body: dict[str, Any] = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": prompt}],
                    }
                ]
            }
            generation_config: dict[str, Any] = {}
            if temperature is not None:
                generation_config["temperature"] = temperature
            if max_output_tokens is not None:
                generation_config["maxOutputTokens"] = max_output_tokens
            if generation_config:
                body["generationConfig"] = generation_config
            if system_instruction:
                body["systemInstruction"] = {
                    "role": "system",
                    "parts": [{"text": system_instruction}],
                }
            data = _vertex_post(model=model, method="generateContent", body=body)
            text = _extract_modern_text(data)
            return text or "Insufficient evidence to answer from retrieved policy text."

        client = _get_vertex_client()
        config: dict[str, Any] = {}
        if temperature is not None:
            config["temperature"] = temperature
        if max_output_tokens is not None:
            config["max_output_tokens"] = max_output_tokens
        if system_instruction:
            config["system_instruction"] = system_instruction
        response = client.models.generate_content(
            model=_normalize_model(model),
            contents=prompt,
            config=config or None,
        )
        text = _extract_modern_text(response)
        return text or "Insufficient evidence to answer from retrieved policy text."

    _ensure_legacy_configured()
    generation_config = {}
    if temperature is not None:
        generation_config["temperature"] = temperature
    if max_output_tokens is not None:
        generation_config["max_output_tokens"] = max_output_tokens

    model_obj = legacy_genai.GenerativeModel(
        model_name=model,
        system_instruction=system_instruction,
        generation_config=(
            legacy_genai.GenerationConfig(**generation_config) if generation_config else None
        ),
    )
    response = model_obj.generate_content(prompt)
    text = (response.text or "").strip()
    return text or "Insufficient evidence to answer from retrieved policy text."
