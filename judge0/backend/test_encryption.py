import os
import sys
import json
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import asyncio
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

# Mock settings
class Settings:
    ENCRYPTION_KEY = "Xc5qurndq22SuKwKg1mnIY1a43BBODmFVTA2o1N17JQ="
    REQUIRE_ENCRYPTION = False

import config
config.settings = Settings()

from encryption_middleware import EncryptionMiddleware

app = FastAPI()
app.add_middleware(EncryptionMiddleware)

@app.post("/test")
async def test_endpoint(request: Request):
    body = await request.body()
    try:
        data = await request.json()
    except Exception:
        data = None
    return {"body": body.decode("utf-8"), "parsed": data}

def encrypt_payload(data: dict, key_b64: str) -> dict:
    key = base64.b64decode(key_b64)
    iv = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext_with_tag = aesgcm.encrypt(iv, json.dumps(data).encode("utf-8"), None)
    return {
        "encrypted": True,
        "iv": base64.b64encode(iv).decode("utf-8"),
        "payload": base64.b64encode(ciphertext_with_tag).decode("utf-8")
    }

if __name__ == "__main__":
    client = TestClient(app)
    
    # 1. Test unencrypted payload
    plain_payload = {"hello": "world"}
    resp = client.post("/test", json=plain_payload)
    print("Plain Response:", resp.json())
    assert resp.json()["parsed"] == plain_payload, "Plain payload failed"
    
    # 2. Test encrypted payload
    encrypted = encrypt_payload(plain_payload, Settings.ENCRYPTION_KEY)
    resp2 = client.post("/test", json=encrypted)
    print("Encrypted Response:", resp2.json())
    assert resp2.json()["parsed"] == plain_payload, "Encrypted payload failed"
    
    print("All tests passed!")
