import datetime
import functools
import os

import jwt
from flask import request, jsonify, g

SECRET = os.environ.get("PULSE_JWT_SECRET", "pulse-dev-secret-change-me")
ALGO = "HS256"


def make_token(user):
    payload = {
        "sub": str(user["id"]),
        "role": user["role"],
        "company_id": user["company_id"],
        "name": user["name"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7),
        "iat": datetime.datetime.utcnow(),
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO)


def decode_token(token):
    try:
        return jwt.decode(token, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None


def get_bearer_token():
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return None


def require_auth(roles=None):
    """Decorator: attaches g.user (dict with sub/role/company_id/name) or 401s.
    If roles is provided, 403s when the user's role isn't in the list.
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            token = get_bearer_token()
            if not token:
                return jsonify({"error": "Не авторизовано"}), 401
            payload = decode_token(token)
            if not payload:
                return jsonify({"error": "Недействительный или истёкший токен"}), 401
            if roles and payload["role"] not in roles:
                return jsonify({"error": "Недостаточно прав"}), 403
            payload["sub"] = int(payload["sub"])
            g.user = payload
            return fn(*args, **kwargs)
        return wrapper
    return decorator
