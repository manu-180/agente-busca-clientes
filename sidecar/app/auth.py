import hashlib
import hmac


def verify_signature(body: bytes, secret: str, header: str) -> bool:
    if not header or not header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header)


def sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
