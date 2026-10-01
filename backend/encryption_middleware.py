"""
encryption_middleware.py

Raw ASGI middleware that ONLY decrypts incoming AES-256-GCM encrypted request bodies.

Response encryption is intentionally NOT done here because intercepting the send
callable inside a raw ASGI middleware conflicts with Starlette's BaseHTTPMiddleware
(which wraps send internally for its own streaming logic), causing:
  - RuntimeError: Unexpected message received: http.request
  - ASGI callable returned without completing response
  - 500 errors on all routes

Response encryption is handled separately via encrypt_response() in route handlers
or via a custom JSONResponse subclass.
"""
import json
import base64
import logging
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from config import settings

log = logging.getLogger(__name__)


class EncryptionMiddleware:
    """
    Raw ASGI middleware to transparently decrypt AES-256-GCM encrypted JSON
    request bodies (POST / PUT / PATCH) before they reach FastAPI route handlers.

    Encrypted envelope format (sent by frontend):
        { "encrypted": true, "iv": "<base64>", "payload": "<base64>" }

    If the body is NOT an encrypted envelope it is passed through unchanged
    (unless REQUIRE_ENCRYPTION=true, in which case a 400 is returned).
    """

    def __init__(self, app):
        self.app = app
        self.key: bytes | None = None
        if settings.ENCRYPTION_KEY:
            try:
                self.key = base64.b64decode(settings.ENCRYPTION_KEY)
                if len(self.key) != 32:
                    raise ValueError(
                        f"AES-256 key must be 32 bytes, got {len(self.key)}"
                    )
                log.info("EncryptionMiddleware: AES-256-GCM request decryption active.")
            except Exception as exc:
                self.key = None
                log.warning(
                    "EncryptionMiddleware: Could not load ENCRYPTION_KEY (%s). "
                    "Request decryption disabled.", exc
                )
        else:
            log.warning(
                "EncryptionMiddleware: ENCRYPTION_KEY not set. "
                "Request decryption disabled."
            )

    # ─────────────────────────────────────────────────────────────────────────

    async def __call__(self, scope, receive, send):
        # Only intercept HTTP requests
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        method: str = scope.get("method", "")
        raw_headers: list = scope.get("headers", [])
        header_dict: dict = {k.lower(): v for k, v in raw_headers}
        content_type: str = header_dict.get(b"content-type", b"").decode("utf-8", errors="ignore")

        # Only attempt decryption for JSON-body mutation requests
        if method in ("POST", "PUT", "PATCH") and "application/json" in content_type:
            # Buffer the complete request body
            body_bytes = b""
            more_body = True
            while more_body:
                msg = await receive()
                body_bytes += msg.get("body", b"")
                more_body = msg.get("more_body", False)

            # Attempt to decrypt if body is present
            if body_bytes:
                result = await self._try_decrypt(body_bytes, send)
                if result is None:
                    return  # Error response already sent
                body_bytes = result

            # Patch content-length to match the (possibly shorter) decrypted body
            new_headers = []
            for k, v in raw_headers:
                if k.lower() == b"content-length":
                    new_headers.append((k, str(len(body_bytes)).encode()))
                else:
                    new_headers.append((k, v))
            scope["headers"] = new_headers

            # Build a receive callable that replays the buffered body once,
            # then forwards subsequent messages (http.disconnect etc.) directly.
            _body_sent = False

            async def patched_receive():
                nonlocal _body_sent
                if not _body_sent:
                    _body_sent = True
                    return {
                        "type": "http.request",
                        "body": body_bytes,
                        "more_body": False,
                    }
                # Body already consumed — forward subsequent ASGI messages
                return await receive()

            return await self.app(scope, patched_receive, send)

        # All other requests: pass through completely unchanged
        return await self.app(scope, receive, send)

    # ─────────────────────────────────────────────────────────────────────────

    async def _try_decrypt(self, body_bytes: bytes, send) -> bytes | None:
        """
        Parse and (if necessary) decrypt the request body.

        Returns:
            bytes  — the plaintext body (decrypted or original).
            None   — decryption failed; an HTTP error response has been sent.
        """
        try:
            payload_data = json.loads(body_bytes)
        except (json.JSONDecodeError, ValueError):
            # Not JSON — pass through as-is (e.g. raw text, broken body)
            return body_bytes

        # Not an encrypted envelope → check REQUIRE_ENCRYPTION policy
        if not isinstance(payload_data, dict) or not payload_data.get("encrypted"):
            if settings.REQUIRE_ENCRYPTION:
                await self._send_error(
                    send, 400, b'{"detail": "Payload encryption is required"}'
                )
                return None
            return body_bytes  # Plaintext JSON is fine

        # Encrypted envelope: we must have the key
        if not self.key:
            log.error(
                "Received encrypted payload but ENCRYPTION_KEY is not configured."
            )
            await self._send_error(
                send, 500, b'{"detail": "Encryption not configured on server."}'
            )
            return None

        try:
            iv = base64.b64decode(payload_data["iv"])
            ciphertext_with_tag = base64.b64decode(payload_data["payload"])
            aesgcm = AESGCM(self.key)
            decrypted = aesgcm.decrypt(iv, ciphertext_with_tag, None)
            log.debug(
                "Request payload decrypted: %d cipher-bytes → %d plain-bytes.",
                len(ciphertext_with_tag), len(decrypted),
            )
            return decrypted
        except Exception as exc:
            log.error("Request decryption failed: %s", exc)
            await self._send_error(send, 400, b'{"detail": "Invalid encrypted payload"}')
            return None

    @staticmethod
    async def _send_error(send, status_code: int, body: bytes):
        await send({
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body, "more_body": False})
