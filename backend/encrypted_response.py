"""
encrypted_response.py

A drop-in replacement for FastAPI's JSONResponse that transparently
encrypts the JSON body using AES-256-GCM before transmission.

Usage (in route handlers):
    from encrypted_response import EncryptedJSONResponse
    return EncryptedJSONResponse(content={"key": "value"})

Or configure as the default response class on the entire app/router:
    app = FastAPI(default_response_class=EncryptedJSONResponse)

Skipping encryption: if ENCRYPTION_KEY is not configured or the key fails
to load, it silently falls back to plain JSONResponse behaviour.
"""
import os
import json
import base64
import logging
from fastapi.responses import JSONResponse
from config import settings

log = logging.getLogger(__name__)

# Cache the decoded key so we only pay the b64decode cost once.
_KEY: bytes | None = None
_KEY_LOADED = False


def _get_key() -> bytes | None:
    global _KEY, _KEY_LOADED
    if _KEY_LOADED:
        return _KEY
    _KEY_LOADED = True
    if not settings.ENCRYPTION_KEY:
        return None
    try:
        key = base64.b64decode(settings.ENCRYPTION_KEY)
        if len(key) != 32:
            log.warning(
                "EncryptedJSONResponse: ENCRYPTION_KEY must be 32 bytes "
                "(got %d). Response encryption disabled.", len(key)
            )
            return None
        _KEY = key
        log.info("EncryptedJSONResponse: AES-256-GCM response encryption active.")
        return _KEY
    except Exception as exc:
        log.warning("EncryptedJSONResponse: Failed to decode key — %s. "
                    "Response encryption disabled.", exc)
        return None


class EncryptedJSONResponse(JSONResponse):
    """
    JSONResponse that encrypts its body with AES-256-GCM.

    Wire format transmitted to the client:
        {"encrypted": true, "iv": "<base64-12-bytes>", "payload": "<base64-ciphertext+tag>"}

    If the ENCRYPTION_KEY is missing or invalid the response is sent as
    plain JSON so the application continues to work gracefully.
    """
    media_type = "application/json"

    def render(self, content) -> bytes:
        plain: bytes = json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")

        key = _get_key()
        if key is None:
            return plain  # Graceful fallback

        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            iv = os.urandom(12)
            aesgcm = AESGCM(key)
            ciphertext_with_tag = aesgcm.encrypt(iv, plain, None)
            envelope = {
                "encrypted": True,
                "iv": base64.b64encode(iv).decode(),
                "payload": base64.b64encode(ciphertext_with_tag).decode(),
            }
            encrypted = json.dumps(envelope, separators=(",", ":")).encode("utf-8")
            log.debug(
                "Response encrypted: %d → %d bytes.", len(plain), len(encrypted)
            )
            return encrypted
        except Exception as exc:
            log.error("Response encryption failed: %s — sending plaintext.", exc)
            return plain  # Safe fallback
