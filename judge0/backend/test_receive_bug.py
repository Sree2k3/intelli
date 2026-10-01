import asyncio
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse

app = FastAPI()

@app.middleware("http")
async def test_middleware(request: Request, call_next):
    body = await request.body()
    
    # Reconstruct receive
    async def new_receive():
        nonlocal body
        if body is not None:
            b = body
            body = None
            return {"type": "http.request", "body": b, "more_body": False}
        while True:
            msg = await request.receive()
            if msg["type"] == "http.disconnect":
                return msg
            # Ignore duplicate http.request from TestClient/Uvicorn
            import asyncio
            await asyncio.Event().wait()
        
    request._receive = new_receive
    
    return await call_next(request)

@app.post("/test-receive")
async def test_endpoint(request: Request):
    await request.json()
    await asyncio.sleep(2) # Simulate work (e.g. email)
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    # We will just run this with testclient first
    client = TestClient(app)
    resp = client.post("/test-receive", json={"test": "data"})
    print("TestClient Response:", resp.json())
