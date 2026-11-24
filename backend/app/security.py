from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import User


pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


def hash_password(value: str) -> str:
    return pwd.hash(value)


def verify_password(value: str, hashed: str) -> bool:
    return pwd.verify(value, hashed)


def token(subject: str, kind: str, minutes: int):
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "kind": kind,
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_tokens(user: User):
    access = token(str(user.id), "access", settings.access_token_minutes)
    refresh = token(str(user.id), "refresh", settings.refresh_token_days * 24 * 60)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
        },
    }


def decode(value: str, expected: str):
    try:
        payload = jwt.decode(
            value, settings.jwt_secret, algorithms=["HS256"]
        )
        if payload.get("kind") != expected:
            raise ValueError("Wrong token type")
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = decode(credentials.credentials, "access")
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid access token")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User unavailable")
    if user.role not in ("admin_supervisor", "field_staff"):
        raise HTTPException(status_code=403, detail="Unsupported role")
    return user


def require_admin(user: User = Depends(current_user)):
    if user.role != "admin_supervisor":
        raise HTTPException(
            status_code=403,
            detail="Admin/Supervisor permission required",
        )
    return user
