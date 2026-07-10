"""
Backend authentication — shared API key via Authorization header.

All routes (except /health) require `Authorization: Bearer <BACKEND_API_KEY>`.
If BACKEND_API_KEY is not set, auth is disabled (local dev only).
"""

import os
import secrets
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

API_KEY = os.getenv("BACKEND_API_KEY", "")

if not API_KEY:
    import logging
    logging.warning(
        "BACKEND_API_KEY is not set — all API requests will be rejected. "
        "Set BACKEND_API_KEY in the environment to enable backend access.",
    )

security = HTTPBearer(auto_error=False)


async def verify_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> None:
    if not API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Backend authentication is not configured. Set BACKEND_API_KEY.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not secrets.compare_digest(credentials.credentials, API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
