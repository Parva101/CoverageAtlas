import os
from functools import lru_cache
from typing import Iterable, Optional

from google import genai
from google.genai import types


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


DEFAULT_USE_VERTEX = _env_bool("AI_USE_VERTEX", True)
DEFAULT_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
DEFAULT_EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
DEFAULT_QA_MODEL = os.environ.get("QA_MODEL", "gemini-2.5-flash")
DEFAULT_EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "768"))


def _extract_text_from_response(response) -> str:
    direct = (getattr(response, "text", None) or "").strip()
    if direct:
        return direct

    parts: list[str] = []
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        if content is None and isinstance(candidate, dict):
            content = candidate.get("content")
        if content is None:
            continue
        content_parts = getattr(content, "parts", None)
        if content_parts is None and isinstance(content, dict):
            content_parts = content.get("parts", [])
        for part in content_parts or []:
            text = getattr(part, "text", None)
            if text is None and isinstance(part, dict):
                text = part.get("text")
            if text:
                parts.append(text)

    return "\n".join(parts).strip()


def _extract_embeddings(response) -> list[list[float]]:
    embeddings = getattr(response, "embeddings", None)
    if embeddings:
        rows: list[list[float]] = []
        for emb in embeddings:
            values = getattr(emb, "values", None)
            if values is None and isinstance(emb, dict):
                values = emb.get("values")
            if values is not None:
                rows.append(list(values))
        if rows:
            return rows

    single = getattr(response, "embedding", None)
    if single is not None:
        values = getattr(single, "values", None)
        if values is None and isinstance(single, dict):
            values = single.get("values")
        if values is not None:
            return [list(values)]

    if isinstance(response, dict) and "embedding" in response:
        emb = response.get("embedding")
        if isinstance(emb, list) and emb and isinstance(emb[0], list):
            return [list(v) for v in emb]
        if isinstance(emb, list):
            return [list(emb)]

    raise RuntimeError("Embedding response did not contain vectors.")


def _normalize_contents(texts: Iterable[str]) -> list[str]:
    out: list[str] = []
    for value in texts:
        text = str(value or "").strip()
        if text:
            out.append(text)
    return out


@lru_cache(maxsize=1)
def get_client():
    use_vertex = _env_bool("AI_USE_VERTEX", DEFAULT_USE_VERTEX)
    if use_vertex:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
        if not project:
            raise RuntimeError("AI_USE_VERTEX=1 requires GOOGLE_CLOUD_PROJECT.")
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", DEFAULT_LOCATION).strip() or DEFAULT_LOCATION
        return genai.Client(vertexai=True, project=project, location=location)

    api_key = (
        os.environ.get("GEMINI_API_KEY", "").strip()
        or os.environ.get("GOOGLE_API_KEY", "").strip()
    )
    if not api_key:
        raise RuntimeError("Set GEMINI_API_KEY or enable AI_USE_VERTEX with Google Cloud project settings.")
    return genai.Client(api_key=api_key)


def embed_texts(
    texts: list[str],
    *,
    model: Optional[str] = None,
    task_type: str = "RETRIEVAL_DOCUMENT",
    output_dimensionality: Optional[int] = None,
) -> list[list[float]]:
    contents = _normalize_contents(texts)
    if not contents:
        return []

    config_kwargs: dict = {}
    if task_type:
        config_kwargs["task_type"] = task_type
    if output_dimensionality:
        config_kwargs["output_dimensionality"] = int(output_dimensionality)
    config = types.EmbedContentConfig(**config_kwargs) if config_kwargs else None

    response = get_client().models.embed_content(
        model=model or DEFAULT_EMBEDDING_MODEL,
        contents=contents,
        config=config,
    )
    return _extract_embeddings(response)


def embed_query(
    text: str,
    *,
    model: Optional[str] = None,
    output_dimensionality: Optional[int] = None,
) -> list[float]:
    rows = embed_texts(
        [text],
        model=model,
        task_type="RETRIEVAL_QUERY",
        output_dimensionality=output_dimensionality,
    )
    if not rows:
        raise RuntimeError("No query embedding returned.")
    return rows[0]


def generate_text(
    prompt: str,
    *,
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_output_tokens: int = 2048,
    system_instruction: Optional[str] = None,
) -> str:
    config_kwargs = {
        "temperature": float(temperature),
        "max_output_tokens": int(max_output_tokens),
    }
    if system_instruction:
        config_kwargs["system_instruction"] = system_instruction

    response = get_client().models.generate_content(
        model=model or DEFAULT_QA_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(**config_kwargs),
    )
    return _extract_text_from_response(response)
