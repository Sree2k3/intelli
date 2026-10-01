# Judge0 Integration - Changes Summary

**Date**: 2026-10-01  
**Branch**: `main`  
**Purpose**: Replace local `LocalExecutor` with sandboxed, scalable Judge0 code execution

---

## 📁 **Files to Send**

### **New Files (3)**
```
backend/judge0_client.py          # Async Judge0 client with batch execution
backend/.env.example              # Environment template with Judge0 config
JUDGE0_INTEGRATION_CHANGES.md     # This document
```

### **Modified Files (3)**
```
docker-compose.yml                # Added redis, judge0, judge0-workers services
backend/config.py                 # Added JUDGE0_URL, JUDGE0_AUTH_TOKEN settings
backend/routers/code.py           # Replaced LocalExecutor with Judge0Client
```

### **Unchanged (Reference Only)**
```
backend/executor.py               # Original LocalExecutor (kept for rollback)
backend/requirements.txt          # No new Python deps needed (httpx already there)
```

---

## 🔧 **Changes Detail**

### **1. docker-compose.yml** — Infrastructure
**Added 3 services** to existing compose file:

```yaml
redis:
  image: redis:7-alpine
  networks: [xevyte-net]
  restart: always

judge0:
  image: judge0/judge0:1.13.1
  ports: ["2358:2358"]
  environment:
    POSTGRES_HOST: db
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: judge0
    REDIS_HOST: redis
  depends_on: [db, redis]
  networks: [xevyte-net]
  restart: always

judge0-workers:
  image: judge0/worker:1.13.1
  deploy:
    replicas: 2
  environment:
    POSTGRES_HOST: db
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: judge0
    REDIS_HOST: redis
  depends_on: [db, redis]
  networks: [xevyte-net]
  restart: always
```

**Backend now depends on `judge0`** (added to `depends_on`).

---

### **2. backend/config.py** — Configuration
**Added 2 settings** to `Settings` class:

```python
# Judge0 (code execution) - self-hosted sandboxed executor
JUDGE0_URL: str = "http://judge0:2358"
JUDGE0_AUTH_TOKEN: Optional[str] = None
```

---

### **3. backend/judge0_client.py** — New Core Module
**Complete async Judge0 client** with:

| Feature | Implementation |
|---------|----------------|
| **Batch execution** | `run_batch()` - parallel test case execution |
| **Polling** | Async polling with configurable timeout (30s default) |
| **Result normalization** | Converts Judge0 status codes to internal format |
| **Language mapping** | Maps 5 languages to Judge0 IDs |
| **Health check** | `health_check()` for monitoring |
| **Error handling** | Graceful fallbacks, detailed logging |

**Language Mapping:**
```python
language_map = {
    "python": 71, "python3": 71,
    "javascript": 63, "js": 63, "node": 63,
    "java": 62,
    "cpp": 54, "c++": 54,
    "c": 50,
}
```

**Resource Limits (per test case):**
- CPU Time: 2s
- Wall Time: 5s  
- Memory: 128 MB
- Network: Disabled

---

### **4. backend/routers/code.py** — Endpoint Updates

#### **`/execute-code` (Test Run)** — Lines 633-725
**Before:** Sequential `LocalExecutor.run()` per test case  
**After:** Parallel `judge0.run_batch()` 

```python
# Key changes:
judge0 = get_judge0_client()
batch_submissions = [
    {"source_code": harness_code, "language": body.language, "stdin": tc_input, "expected_output": expected}
    for tc in body.test_cases
]
results = await judge0.run_batch(batch_submissions)
# Process results using status_id == 3 (Accepted)
```

#### **`/submit-coding` (Final Submission)** — Lines 728-891
**Same pattern** — batch execution via Judge0, aggregate scoring unchanged.

**Removed import:**
```python
# OLD
from executor import LocalExecutor

# NEW
from judge0_client import get_judge0_client
```

---

## 🎯 **Behavioral Changes**

| Aspect | Before (LocalExecutor) | After (Judge0) |
|--------|------------------------|----------------|
| **Execution** | Sequential per test case | **Parallel batch** |
| **Sandbox** | None (host process) | **isolate** (Linux namespaces + cgroups) |
| **Resource Limits** | None | CPU 2s, Mem 128MB, Wall 5s |
| **Network Access** | Inherited from host | **Disabled** |
| **Scaling** | Single process | **Horizontal (2 workers)** |
| **Queue Management** | None | **Built-in (Redis + Sidekiq)** |
| **Languages** | 5 (hardcoded harnesses) | **60+ (configurable)** |

---

## 📋 **Response Format (Unchanged)**
Both endpoints return **identical JSON** — fully backward compatible:

```json
{
  "passedTests": 3,
  "totalTests": 5,
  "results": [
    {"id": 0, "input": "...", "expectedOutput": "...", "actualOutput": "...", "status": "passed", "executionTime": 45}
  ],
  "output": "3/5 test cases passed\n────────────────────\n✓ Test Case 1: PASSED\n  Input: ...\n  Expected: ...\n  Output: ...\n"
}
```

---

## 🚀 **Deployment Instructions**

### **1. Prerequisites**
- Docker & Docker Compose v2+
- PostgreSQL (existing `db` service)
- `.env` file with `POSTGRES_PASSWORD`

### **2. First-Time Setup**
```bash
# Copy env template
cp backend/.env.example backend/.env
# Edit backend/.env with real values

# Start infrastructure
docker-compose up -d redis judge0 judge0-workers

# Wait 15s for Judge0 to start, then initialize DB
docker-compose exec judge0 rails db:migrate RAILS_ENV=production

# Start app services
docker-compose up -d backend voice-server frontend

# Initialize app database
docker-compose exec backend python init_db.py
```

### **3. Verify Installation**
```bash
# Judge0 health
curl http://localhost:2358/about
# {"version":"1.13.1",...}

# Backend health
curl http://localhost:5000/health
# {"status":"healthy","version":"2.0.0"}

# Test execution
curl -X POST http://localhost:5000/api/functions/v1/execute-code \
  -H "Content-Type: application/json" \
  -d '{"code":"def solution(a,b): return a+b","language":"python","test_cases":[{"input":"1\n2","expected_output":"3"}]}'
```

---

## 🔄 **Rollback Plan**
If issues arise, revert in 3 steps:

1. **Revert import** in `routers/code.py`:
   ```python
   from executor import LocalExecutor  # instead of judge0_client
   ```

2. **Replace Judge0 calls** with:
   ```python
   output, is_error, exec_time = LocalExecutor.run(language, harness_code, stdin)
   ```

3. **Remove Judge0 services** from `docker-compose.yml`

**Original `executor.py` is untouched** — zero risk.

---

## 🔍 **Troubleshooting**

| Symptom | Check |
|---------|-------|
| `Connection refused: judge0:2358` | `docker-compose logs judge0` — wait for Rails boot |
| `502 Code execution service unavailable` | Judge0 not ready; check `docker-compose ps` |
| `Language not supported` | `curl http://localhost:2358/languages` |
| Timeout on execution | Increase `default_wall_time_limit` in `judge0_client.py` |
| Workers idle | `docker-compose logs judge0-workers` — check Redis connection |

---

## 📊 **Resource Impact**

| Component | CPU | RAM | Disk |
|-----------|-----|-----|------|
| **redis** | ~50m | ~10 MB | negligible |
| **judge0 (API)** | ~100m | ~200 MB | ~500 MB |
| **judge0-workers (×2)** | ~200m each | ~300 MB each | negligible |
| **Total Added** | ~550m | ~800 MB | ~500 MB |

---

## ✅ **Verification Checklist**

- [ ] `docker-compose up -d` starts all services healthy
- [ ] `curl http://localhost:2358/about` returns version
- [ ] `curl http://localhost:5000/health` returns healthy
- [ ] `/execute-code` returns correct pass/fail for test cases
- [ ] `/submit-coding` persists results and calculates aggregate score
- [ ] All 5 languages (Python, JS, Java, C++, C) work
- [ ] Concurrent submissions execute in parallel
- [ ] Resource limits enforced (test with infinite loop)

---

## 📝 **Notes for Recipient**

1. **No new Python dependencies** — `httpx` already in `requirements.txt`
2. **PostgreSQL shared** — Judge0 uses same `db` service, separate `judge0` database
3. **Redis shared** — Single Redis for both Judge0 queue and any future caching
4. **Production scaling** — Increase `replicas` under `judge0-workers` for higher throughput
5. **Auth** — Set `JUDGE0_AUTH_TOKEN` in `.env` and `judge0.conf` for production exposure

---

**Total Implementation Time**: ~2 hours  
**Lines Changed**: ~150 (mostly replacement, not addition)  
**Risk Level**: Low (full rollback available, backward compatible API)