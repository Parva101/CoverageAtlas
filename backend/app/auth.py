import json
import os
import time
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

AuthClaims = dict[str, Any]

ALGORITHMS = ["RS256"]
JWKS_CACHE_TTL_SECONDS = int(os.environ.get("AUTH0_JWKS_CACHE_TTL_SECONDS", "3600"))
_DEV_BYPASS_ENABLED = os.environ.get("AUTH0_ALLOW_DEV_BYPASS", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

_jwks_cache: dict[str, Any] = {"value": None, "expires_at": 0.0}
_jwks_lock = Lock()

bearer_scheme = HTTPBearer(auto_error=False)


def _load_jwt():
    try:
        import jwt
        from jwt.exceptions import PyJWTError
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PyJWT is required for Auth0 token validation.",
        ) from exc
    return jwt, PyJWTError


def auth0_is_configured() -> bool:
    domain = os.environ.get("AUTH0_DOMAIN", "").strip().rstrip("/")
    audience = os.environ.get("AUTH0_AUDIENCE", "").strip()
    return bool(domain and audience)


def _auth0_settings() -> tuple[str, str, str]:
    domain = os.environ.get("AUTH0_DOMAIN", "").strip().rstrip("/")
    audience = os.environ.get("AUTH0_AUDIENCE", "").strip()
    issuer = os.environ.get("AUTH0_ISSUER", "").strip()

    if not domain:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AUTH0_DOMAIN is not configured.",
        )
    if not audience:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AUTH0_AUDIENCE is not configured.",
        )

    if not issuer:
        issuer = f"https://{domain}/"
    if not issuer.endswith("/"):
        issuer = issuer + "/"

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
    jwt, JWTError = _load_jwt()
    domain, audience, issuer = _auth0_settings()

    try:
        unverified = jwt.get_unverified_header(token)
    except JWTError as exc:
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
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(signing_key))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signing key format.",
        ) from exc

    try:
        payload = jwt.decode(
            token,
            key=public_key,
            algorithms=ALGORITHMS,
            audience=audience,
            issuer=issuer,
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
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


def require_auth0_token(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> AuthClaims:
    if not auth0_is_configured():
        if _DEV_BYPASS_ENABLED:
            return {
                "sub": os.environ.get("AUTH0_DEV_SUB", "dev-user"),
                "scope": os.environ.get("AUTH0_ADMIN_SCOPE", "admin:write"),
                "permissions": [os.environ.get("AUTH0_ADMIN_SCOPE", "admin:write")],
                "auth_mode": "dev_bypass",
            }
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth0 is not configured.",
        )

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    token = credentials.credentials
    return verify_auth0_token(token)


def require_admin_auth(payload: AuthClaims = Depends(require_auth0_token)) -> AuthClaims:
    required_scope = os.environ.get("AUTH0_ADMIN_SCOPE", "admin:write").strip()
    if not required_scope:
        return payload

    scopes = _extract_scopes(payload)
    if required_scope not in scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing required scope: {required_scope}",
        )
    return payload
