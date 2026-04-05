import json
import os
import tempfile
from functools import lru_cache
from typing import Iterable, Optional

from google import genai
from google.genai import types


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


DEFAULT_USE_VERTEX = _env_bool("AI_USE_VERTEX", False)
DEFAULT_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
DEFAULT_EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
DEFAULT_QA_MODEL = os.environ.get("QA_MODEL", "gemini-2.5-flash")
DEFAULT_EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "768"))
_SA_TEMPFILE_PATH: Optional[str] = None
EMBED_MODEL_FALLBACK = "gemini-embedding-001"


def _first_nonempty(*values: Optional[str]) -> str:
    for value in values:
        if value and value.strip():
            return value.strip()
    return ""


def _vertex_api_key() -> str:
    return _first_nonempty(
        os.environ.get("VERTEX_API_KEY"),
        os.environ.get("GOOGLE_API_KEY"),
        os.environ.get("GEMINI_API_KEY"),
    )


def _developer_api_key() -> str:
    return _first_nonempty(
        os.environ.get("GEMINI_API_KEY"),
        os.environ.get("GOOGLE_API_KEY"),
    )


def _use_vertex_mode() -> bool:
    # Explicit switch wins.
    raw = os.environ.get("AI_USE_VERTEX")
    if raw is not None:
        return _env_bool("AI_USE_VERTEX", False)

    provider = os.environ.get("GEMINI_PROVIDER", "").strip().lower()
    if provider in {"vertex", "vertexai"}:
        return True
    if provider in {"developer", "google", "gemini"}:
        return False

    # Otherwise defer to GOOGLE_GENAI_USE_VERTEXAI if present.
    return _env_bool("GOOGLE_GENAI_USE_VERTEXAI", False)


def _prepare_google_credentials(api_key: str) -> None:
    """
    Make cloud deployments resilient when GOOGLE_APPLICATION_CREDENTIALS points to
    a local path that doesn't exist in the container.
    """
    global _SA_TEMPFILE_PATH

    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if creds_path and os.path.exists(creds_path):
        return

    # If inline service account JSON is supplied, materialize it into a temp file.
    inline_json = _first_nonempty(
        os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON"),
        os.environ.get("GOOGLE_CREDENTIALS_JSON"),
    )
    if inline_json:
        parsed = json.loads(inline_json)
        if not isinstance(parsed, dict):
            raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON must be a JSON object.")
        if _SA_TEMPFILE_PATH is None:
            fh = tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".json",
                prefix="gcp-sa-",
                delete=False,
                encoding="utf-8",
            )
            with fh:
                json.dump(parsed, fh)
            _SA_TEMPFILE_PATH = fh.name
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _SA_TEMPFILE_PATH
        return

    # If an API key is available, clear the broken file-path env var.
    if creds_path and api_key:
        os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
        return

    if creds_path and not api_key:
        raise RuntimeError(
            "GOOGLE_APPLICATION_CREDENTIALS points to a missing file. "
            "Set a valid path, or provide GOOGLE_SERVICE_ACCOUNT_JSON, or use "
            "VERTEX_API_KEY/GOOGLE_API_KEY."
        )


def _embedding_model_candidates(model: Optional[str]) -> list[str]:
    requested = (model or DEFAULT_EMBEDDING_MODEL).strip() or DEFAULT_EMBEDDING_MODEL
    candidates: list[str] = [requested]

    # Legacy Gemini naming variants that often fail on current v1beta embed endpoint.
    if requested.startswith("models/"):
        candidates.append(requested.split("/", 1)[1])
    if requested in {"models/text-embedding-004", "text-embedding-004"}:
        candidates.append(EMBED_MODEL_FALLBACK)

    if EMBED_MODEL_FALLBACK not in candidates:
        candidates.append(EMBED_MODEL_FALLBACK)

    deduped: list[str] = []
    seen: set[str] = set()
    for cand in candidates:
        norm = cand.strip()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        deduped.append(norm)
    return deduped


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
    use_vertex = _use_vertex_mode()
    if use_vertex:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
        if not project:
            raise RuntimeError("AI_USE_VERTEX=1 requires GOOGLE_CLOUD_PROJECT.")
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", DEFAULT_LOCATION).strip() or DEFAULT_LOCATION
        api_key = _vertex_api_key()
        _prepare_google_credentials(api_key=api_key)
        try:
            return genai.Client(vertexai=True, project=project, location=location)
        except Exception:
            # Cloud-safe fallback: if Vertex auth is misconfigured but API key is present,
            # continue in Developer API mode rather than failing hard.
            if api_key:
                return genai.Client(api_key=api_key)
            raise

    api_key = _developer_api_key()
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

    last_error: Optional[Exception] = None
    for candidate_model in _embedding_model_candidates(model):
        try:
            config_kwargs: dict = {}
            if task_type:
                config_kwargs["task_type"] = task_type

            # Keep vector dimensions aligned with Qdrant defaults even when callers
            # omit output_dimensionality.
            candidate_dim = output_dimensionality
            if candidate_dim is None and candidate_model.startswith("gemini-embedding-"):
                candidate_dim = DEFAULT_EMBEDDING_DIM
            if candidate_dim:
                config_kwargs["output_dimensionality"] = int(candidate_dim)

            config = types.EmbedContentConfig(**config_kwargs) if config_kwargs else None
            response = get_client().models.embed_content(
                model=candidate_model,
                contents=contents,
                config=config,
            )
            return _extract_embeddings(response)
        except Exception as exc:  # pragma: no cover - provider-dependent runtime behavior
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    raise RuntimeError("Embedding request failed without a provider error.")


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
