import json
import os
import time
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

AuthClaims = dict[str, Any]

ALGORITHMS = ["RS256"]
DEFAULT_ADMIN_SCOPE = "admin:write"


def _parse_int(value: str, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


JWKS_CACHE_TTL_SECONDS = _parse_int(os.environ.get("AUTH0_JWKS_CACHE_TTL_SECONDS", "3600"), 3600)

_jwks_cache: dict[str, Any] = {"value": None, "expires_at": 0.0}
_jwks_lock = Lock()

bearer_scheme = HTTPBearer(auto_error=False)


def _is_truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _first_non_empty_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def _normalize_auth0_domain(value: str) -> str:
    raw = value.strip().rstrip("/")
    if not raw:
        return ""
    if "://" not in raw:
        return raw

    parsed = urlparse(raw)
    # Accept either full URL (https://tenant.us.auth0.com) or just host-like strings.
    host = parsed.netloc or parsed.path
    return host.strip().strip("/")


def _normalize_issuer(value: str, domain: str) -> str:
    raw = value.strip()
    if not raw:
        return f"https://{domain}/"
    if "://" not in raw:
        return f"https://{_normalize_auth0_domain(raw)}/"
    return raw.rstrip("/") + "/"


def _resolve_domain() -> str:
    return _normalize_auth0_domain(
        _first_non_empty_env("AUTH0_DOMAIN", "VITE_AUTH0_DOMAIN")
    )


def _resolve_audience() -> str:
    return _first_non_empty_env("AUTH0_AUDIENCE", "AUTH0_API_IDENTIFIER", "VITE_AUTH0_AUDIENCE")


def is_auth_enabled() -> bool:
    explicit = os.environ.get("AUTH0_ENABLED")
    if explicit is not None and explicit.strip():
        return _is_truthy(explicit)

    # If explicit flag is absent, auto-enable only when core Auth0 settings exist.
    return bool(_resolve_domain() and _resolve_audience())


def _load_jose():
    try:
        from jose import JOSEError, JWTError, jwt
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="python-jose is required for Auth0 token validation.",
        ) from exc
    return jwt, JWTError, JOSEError


def _auth0_settings() -> tuple[str, str, str]:
    domain = _resolve_domain()
    audience = _resolve_audience()
    issuer = _first_non_empty_env("AUTH0_ISSUER")

    if not domain:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AUTH0_DOMAIN is not configured.",
        )
    if not audience:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AUTH0_AUDIENCE (or AUTH0_API_IDENTIFIER) is not configured.",
        )

    issuer = _normalize_issuer(issuer, domain)

    return domain, audience, issuer


def _fetch_jwks(domain: str) -> dict[str, Any]:
    jwks_url = f"https://{domain}/.well-known/jwks.json"
    req = Request(jwks_url, headers={"User-Agent": "CoverageAtlas/1.0"})
    try:
        with urlopen(req, timeout=8) as response:
            payload = response.read().decode("utf-8")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to fetch Auth0 JWKS.",
        ) from exc

    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Invalid JWKS response from Auth0.",
        ) from exc

    keys = data.get("keys")
    if not isinstance(keys, list) or not keys:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth0 JWKS does not contain signing keys.",
        )
    return data


def _get_jwks(domain: str, force_refresh: bool = False) -> dict[str, Any]:
    now = time.time()
    with _jwks_lock:
        cached = _jwks_cache["value"]
        expires_at = _jwks_cache["expires_at"]
        if not force_refresh and cached is not None and now < expires_at:
            return cached

    fresh = _fetch_jwks(domain)
    with _jwks_lock:
        _jwks_cache["value"] = fresh
        _jwks_cache["expires_at"] = time.time() + JWKS_CACHE_TTL_SECONDS
    return fresh


def _select_key(jwks: dict[str, Any], kid: str | None) -> dict[str, Any] | None:
    if not kid:
        return None
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def verify_auth0_token(token: str) -> AuthClaims:
    jwt, JWTError, JOSEError = _load_jose()
    domain, audience, issuer = _auth0_settings()

    try:
        unverified = jwt.get_unverified_header(token)
    except (JWTError, JOSEError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token header.",
        ) from exc

    kid = unverified.get("kid")
    jwks = _get_jwks(domain)
    signing_key = _select_key(jwks, kid)
    if signing_key is None:
        jwks = _get_jwks(domain, force_refresh=True)
        signing_key = _select_key(jwks, kid)
    if signing_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to find matching signing key.",
        )

    try:
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=ALGORITHMS,
            audience=audience,
            issuer=issuer,
        )
    except (JWTError, JOSEError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        ) from exc
    except Exception as exc:
        # Defensive catch-all for jose/libcrypto runtime errors so callers do not see a 500.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to validate bearer token.",
        ) from exc

    return dict(payload)


def _extract_scopes(payload: AuthClaims) -> set[str]:
    scopes: set[str] = set()
    scope_value = payload.get("scope")
    if isinstance(scope_value, str):
        for scope in scope_value.split():
            if scope:
                scopes.add(scope.strip())

    permissions = payload.get("permissions")
    if isinstance(permissions, list):
        for permission in permissions:
            if isinstance(permission, str) and permission.strip():
                scopes.add(permission.strip())
    return scopes


def extract_scopes(payload: AuthClaims) -> set[str]:
    return _extract_scopes(payload)


def _dev_claims() -> AuthClaims:
    admin_scope = os.environ.get("AUTH0_ADMIN_SCOPE", DEFAULT_ADMIN_SCOPE).strip()
    permissions = [admin_scope] if admin_scope else []
    scope_text = " ".join(permissions)
    return {
        "sub": "local-dev-user",
        "permissions": permissions,
        "scope": scope_text,
        "auth_mode": "disabled",
    }


def require_auth0_token(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> AuthClaims:
    if not is_auth_enabled():
        return _dev_claims()

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )
    return verify_auth0_token(credentials.credentials)


def require_admin_auth(payload: AuthClaims = Depends(require_auth0_token)) -> AuthClaims:
    if not is_auth_enabled():
        return payload

    required_scope = os.environ.get("AUTH0_ADMIN_SCOPE", DEFAULT_ADMIN_SCOPE).strip()
    if not required_scope:
        return payload

    scopes = _extract_scopes(payload)
    if required_scope not in scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing required scope: {required_scope}",
        )
    return payload
