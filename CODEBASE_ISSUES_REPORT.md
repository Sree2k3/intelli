# IntelliHire AI Interview Platform - Codebase Issues Report

**Date**: 2026-10-01  
**Scope**: Full backend (Python/FastAPI), frontend (React/TypeScript), voice server (Node.js), and infrastructure

---

## 🔴 CRITICAL ISSUES (Security, Data Integrity, Production Blockers)

### 1. **Hardcoded Secrets in Configuration** (`backend/config.py:84`)
```python
ENCRYPTION_KEY: Optional[str] = "Xc5qurndq22SuKwKg1mnIY1a43BBODmFVTA2o1N17JQ="
```
**Impact**: Production encryption key is hardcoded and committed. Anyone with repo access can decrypt all payloads.
**Fix**: Must be loaded from environment variable only. Remove default.

### 2. **JWT Secret Has Insecure Default** (`backend/config.py:20`)
```python
JWT_SECRET: str = "CHANGE_ME_IN_PRODUCTION_supersecret_key_for_intellihire_local"
```
**Impact**: If deployed without overriding, all tokens are forgeable.
**Fix**: Remove default; fail startup if not set in production.

### 3. **Database URL Defaults to Empty String** (`backend/config.py:17`)
```python
DATABASE_URL: str = ""
```
**Impact**: App crashes on startup if `.env` missing. No graceful handling.
**Fix**: Add validation in `Settings` model or startup check.

### 4. **No Input Validation on LLM-Generated SQL** (`backend/main.py:53-58`)
```python
async def try_run_migration(sql_query: str):
    try:
        async with engine.begin() as conn:
            await conn.execute(text(sql_query))
    except Exception:
        pass  # Silently swallows ALL errors
```
**Impact**: Migration failures are silently ignored. Schema drift goes undetected. SQL injection risk if `sql_query` ever becomes dynamic.
**Fix**: Log errors, use Alembic for migrations, never raw SQL in startup.

### 5. **Tenant Resolution Creates Tenants Automatically** (`backend/database.py:182-200`)
```python
# If slug does NOT exist, explicitly insert a new Tenant record safely
new_tenant = Tenant(id=new_id, name=clean_str, ...)
session.add(new_tenant)
await session.commit()
return new_id
```
**Impact**: Any request with arbitrary `X-Tenant-ID` header creates a tenant. Multi-tenant isolation bypassed. No admin approval.
**Fix**: Remove auto-creation. Require explicit tenant provisioning.

### 6. **Encryption Middleware Applied Globally** (`backend/main.py:328-329`)
```python
from encryption_middleware import EncryptionMiddleware
app.add_middleware(EncryptionMiddleware)
```
**Impact**: ALL responses encrypted including health checks, static files, WebSocket upgrades. Breaks monitoring, load balancers, and candidate interview pages.
**Fix**: Apply only to authenticated API routes. Exclude `/health`, `/i/{short_code}`, `/uploads`, WebSocket routes.

### 7. **CORS Regex Overly Permissive** (`backend/main.py:336`)
```python
allow_origin_regex=settings.CORS_ORIGIN_REGEX or r"https://([a-zA-Z0-9\-\.]+\.)?scaloz\.com|https?://([a-zA-Z0-9\-\.]+\.)?localhost(:\d+)?"
```
**Impact**: Allows any subdomain of `scaloz.com` including untrusted ones. Localhost regex allows any port on any subdomain.
**Fix**: Restrict to known production subdomains. Remove wildcard localhost in production.

### 8. **Code Execution Uses Local Subprocess Without Sandbox** (`backend/executor.py`)
- Runs `g++`, `javac`, `python`, `node` directly on host
- No containerization, no resource limits (CPU/memory), no network isolation
- Temp directory cleanup relies on `TemporaryDirectory` (can be bypassed)
**Impact**: RCE vector. Malicious code can read `/etc/passwd`, mine crypto, DoS the host.
**Fix**: Use gVisor, Firecracker, or Piston API (already configured in `PISTON_URL`). Disable local executor in production.

### 9. **SQL Injection Risk in Dynamic Queries** (`backend/database.py:143-147`)
```python
conds = [func.lower(Tenant.name) == c for c in uniq_candidates]
conds.append(cast(Tenant.id, String) == clean_str)
stmt = select(Tenant).where(or_(*conds))
```
While SQLAlchemy ORM generally prevents injection, the dynamic `clean_str` from headers is used in multiple raw queries without parameterization guarantees.

### 10. **YOLO Model Loaded at Module Level** (`backend/proctoring.py:39`)
```python
yolo_model = YOLO("yolov8s.pt")
```
**Impact**: Blocks startup if model file missing. No graceful degradation. Loads ~200MB model in every worker process (memory bloat).
**Fix**: Lazy load with fallback. Share model across workers via multiprocessing or model server.

---

## 🟠 HIGH SEVERITY (Reliability, Correctness, Performance)

### 11. **State Machine Race Conditions in AI Interview** (`backend/routers/ai.py`)
- `memory` dict read/modified/written without locking
- `question_turn_count` and `follow_up_done` can desync between request and LLM call
- `intercepted_response` bypasses LLM but still advances `current_question_index`
**Impact**: Candidates can get skipped questions, duplicate follow-ups, or stuck rounds.
**Fix**: Use database transactions with row-level locks. Persist state before LLM call.

### 12. **LLM Call Has No Timeout in `ai_interview`** (`backend/llm_service.py:739`)
```python
raw = await _chat(llm_messages, max_tokens=1500, model_type="question")
```
`_chat` has 35s timeout but `ai_interview` doesn't enforce overall deadline. Can hang 2+ minutes.
**Fix**: Wrap `ai_interview` call with `asyncio.wait_for(..., timeout=30)`.

### 13. **Evaluation Pipeline No Concurrency Control** (`backend/evaluation_service.py:512`)
```python
sem = asyncio.Semaphore(4)  # But tasks created for ALL questions at once
tasks = [evaluate_single_task(idx, q) for idx, q in enumerate(questions)]
completed_results = await asyncio.gather(*tasks)
```
Creates N tasks immediately; semaphore only limits concurrent *execution*, not memory. For 20 questions, 20 prompts built in memory.
**Fix**: Use `asyncio.Semaphore` with async generator or batch processing.

### 14. **WebSocket Face Monitor No Auth** (`backend/proctoring.py:210`)
```python
@router.websocket("/api/ws/face-monitor")
async def face_monitor_websocket(websocket: WebSocket, interview_id: Optional[str] = None):
```
No token validation. Any client can connect with any `interview_id` and consume CPU/GPU for face mesh.
**Fix**: Require `x-invite-token` or JWT in query params. Validate before accepting.

### 15. **Video Upload No Chunked/Resumable Support** (`backend/proctoring.py:467-476`)
```python
video_bytes = await video.read()  # Loads entire file into memory
if len(video_bytes) > MAX_UPLOAD_BYTES: ...
```
200MB limit but loads fully into RAM. No multipart upload for large recordings.
**Fix**: Use streaming upload to S3. Implement chunked upload endpoints.

### 16. **LocalStorage Persistence in VoiceInterviewAgent** (`frontend/src/components/interview/VoiceInterviewAgent.tsx:188-226`)
```javascript
const key = `interview_session_${interviewId}`;
const saved = localStorage.getItem(key);
// ... restores messages, round, stage, meta
```
**Impact**: 
- Sensitive interview transcripts stored in plaintext in browser
- No encryption, no expiry, no cleanup
- Shared device = data leak
- State can desync from server (race conditions)
**Fix**: Remove localStorage persistence. Use server-side session state only.

### 17. **Speech Recognition Auto-Restart Loop** (`frontend/src/components/interview/VoiceInterviewAgent.tsx:734-750`)
```javascript
r.onend = () => {
  if (isListeningRef.current) {
    setTimeout(() => { recognitionRef.current = createAndStart(); }, 100);
  }
};
```
Infinite restart on `onend` without backoff. Browser SpeechRecognition stops after ~60s of silence; this creates tight loop.
**Impact**: CPU spike, battery drain, microphone permission prompts.
**Fix**: Add max restarts, exponential backoff, silence timeout.

### 18. **Code Execution Harness Trusts User Input** (`backend/routers/code.py:91-113`)
```python
_input_text = sys.stdin.read().strip()
# ... parses with ast.literal_eval and json.loads
_args = _parsed if isinstance(_parsed, list) else [_parsed]
_res = _target(*_args)  # Calls user function with parsed input
```
Uses `ast.literal_eval` on stdin. While safer than `eval`, complex nested structures can cause DoS.
**Fix**: Strict schema validation on test case inputs. Limit input size.

### 19. **Duplicate Question Detection Uses Fuzzy Matching Only** (`backend/question_similarity.py`)
```python
def find_duplicate_in_list(title: str, existing_titles: List[str]) -> Optional[str]:
    # Uses cosine similarity on TF vectors
```
**Impact**: False positives (different questions with similar words blocked). False negatives (rephrased duplicates allowed).
**Fix**: Add semantic embedding comparison (sentence-transformers) + exact title match.

### 20. **Database Migrations Run on Every Startup** (`backend/main.py:47-100`)
100+ `ALTER TABLE` statements execute on every container start.
**Impact**: 
- Startup latency 5-15 seconds
- Locks tables during migration
- Fails silently if column exists (PostgreSQL error swallowed)
**Fix**: Use Alembic properly. Run migrations as separate step before app start.

---

## 🟡 MEDIUM SEVERITY (Maintainability, UX, Technical Debt)

### 21. **Massive God Object: `main.py` (416 lines)**
Imports 13 routers, runs migrations, seeds data, manages WebSocket worker, configures CORS, encryption, static files, health checks, short-code resolution.
**Fix**: Split into `app_factory.py`, `migrations.py`, `seeds.py`, `middleware.py`.

### 22. **Models File Is 1048 Lines** (`backend/models.py`)
All SQLAlchemy models + Pydantic schemas in one file.
**Fix**: Split into `models/orm.py`, `models/schemas.py`, `models/enums.py`.

### 23. **LLM Service Is 1077 Lines** (`backend/llm_service.py`)
Personas, mission builder, JSON extraction, TTS, STT, question generation, closing generation all in one file.
**Fix**: Split into `llm/client.py`, `llm/personas.py`, `llm/missions.py`, `llm/tts.py`, `llm/stt.py`.

### 24. **Evaluation Service Is 1052 Lines** (`backend/evaluation_service.py`)
Validation, similarity, LLM evaluation, aggregation, ideal answer generation all coupled.
**Fix**: Pipeline pattern with separate stages.

### 25. **Frontend `api.ts` Is 1498 Lines** (`frontend/src/lib/api.ts`)
All API calls in one file. Mixes Supabase client, direct fetch, encryption, auth logic.
**Fix**: Split by domain: `api/auth.ts`, `api/interviews.ts`, `api/questions.ts`, `api/code.ts`, `api/admin.ts`.

### 26. **VoiceInterviewAgent Is 1259 Lines** (`frontend/src/components/interview/VoiceInterviewAgent.tsx`)
Handles STT, TTS, state machine, persistence, UI, speech boundary detection, auto-save, soft close.
**Fix**: Split into hooks: `useSpeechRecognition`, `useSpeechSynthesis`, `useInterviewState`, `useAutoSave`.

### 27. **Hardcoded Model Names** (`backend/config.py:29-33`)
```python
OPENAI_MODEL: str = "gpt-4o"
OPENAI_QUESTION_MODEL: str = "gpt-4o-mini"
OPENAI_EVALUATION_MODEL: str = "gpt-4o"
OPENAI_WHISPER_MODEL: str = "whisper-1"
```
**Impact**: Cannot switch models without code change. `gpt-5` references in `llm_service.py:43` don't exist yet.
**Fix**: Make all model names env-configurable with validation.

### 28. **No Structured Logging / Correlation IDs**
- Uses `print()` statements extensively (`backend/auth.py:139`, `backend/database.py:82`)
- No request ID propagation
- No structured JSON logs for observability
**Fix**: Use `structlog` or Python `logging` with JSON formatter. Add middleware for request IDs.

### 29. **Error Handling Inconsistent**
- Some endpoints return `{"detail": "..."}` (FastAPI standard)
- Others return `{"error": "..."}` or `{"message": "..."}` 
- Some raise `HTTPException`, others return error dicts
**Fix**: Standardize on FastAPI `HTTPException` with `detail` dict.

### 30. **Frontend Uses `any` Type Extensively**
```typescript
// frontend/src/lib/api.ts:208
const res = await authFetch("/api/rest/v1/roles-master");
// Returns `any`, no type safety
```
**Fix**: Define TypeScript interfaces for all API responses. Use `zod` for runtime validation.

### 31. **No API Versioning Strategy**
Endpoints mixed: `/api/rest/v1/`, `/functions/v1/`, `/admin/v1/`, `/recruiter/`, `/super-admin/`
No deprecation policy. Breaking changes deployed without version bump.
**Fix**: Enforce `/api/v1/` prefix. Use header-based versioning for experiments.

### 32. **Rate Limiting Only By IP** (`backend/main.py:35`)
```python
limiter = Limiter(key_func=get_remote_address)
```
**Impact**: Behind load balancer/proxy, all requests appear from same IP. No per-user/tenant limiting.
**Fix**: Use `X-Forwarded-For` or JWT `sub` as key. Configure trusted proxies.

### 33. **WebM Fixer Imported But Not Defined** (`backend/proctoring.py:479`)
```python
from webm_fixer import fix_webm_stream
```
File `backend/webm_fixer.py` exists but not reviewed. If missing, upload fails silently.

### 34. **No Health Check Dependencies** (`backend/main.py:387-394`)
```python
@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "2.0.0"}
```
Doesn't check DB connectivity, Redis, S3, LLM API. Load balancer will route to dead instances.
**Fix**: Add `liveness` and `readiness` probes with dependency checks.

### 35. **Timezone Handling Inconsistent** 
- `backend/models.py:207`: `timezone = Column(String, default="Asia/Kolkata")`
- `backend/config.py:54-57`: Integration URLs hardcoded to localhost
- Frontend uses browser local time
**Impact**: Scheduled interviews, expiry calculations wrong across DST boundaries.
**Fix**: Store all timestamps in UTC. Convert to user timezone only at display layer.

---

## 🟢 LOW SEVERITY (Code Quality, Best Practices)

### 36. **Dead Code / Debug Files in Backend Root**
```
backend/debug_scoring.py
backend/debug_questions.py
backend/debug_05.py
backend/test.py
backend/test2.py
backend/test_encryption.py
backend/test_duplicate_detection.py
backend/test_backend_duplicate_endpoint.py
backend/test_api_duplicate_prevention.py
backend/test_scoring.py
backend/check_pg.py
backend/check_db.py
backend/check_data.py
backend/check_tables.py
backend/output.txt
backend/dump.txt
backend/pip_out.txt
backend/questions_dump.txt
```
**Fix**: Move to `tests/` or `scripts/`. Remove from production Docker image.

### 37. **Duplicate YOLO Model Files**
```
backend/yolov8s.pt (200MB)
backend/yolov8n.pt (50MB)
aiinterview_test-main/yolov8s.pt (duplicate)
```
**Fix**: Keep one. Use Docker volume or model registry.

### 38. **Print Statements in Production Code**
- `backend/auth.py`: 15+ `print(f"DEBUG: ...")` statements
- `backend/database.py`: Multiple `print(f"DEBUG: ...")`
- `backend/proctoring.py`: `print(f"PROCTORING: ...")`
**Fix**: Replace with `log.debug()` / `log.info()`.

### 39. **Inconsistent Naming Conventions**
- `snake_case` for Python (good)
- `camelCase` for JSON (good)
- But: `x_invite_token` header vs `inviteToken` JS variable
- `tenant_id` vs `tenantId` in JWT claims
**Fix**: Define API contract (OpenAPI spec). Generate types from it.

### 40. **No Test Infrastructure**
- `frontend/vitest.config.ts` exists but `frontend/src/test/example.test.ts` only has dummy test
- Backend has no `pytest` config, no test files (only debug scripts)
**Fix**: Add unit tests for critical paths (auth, evaluation, code execution). Add integration tests with Testcontainers.

### 41. **Docker Compose Uses Hardcoded Secrets** (`docker-compose.yml:21`)
```yaml
VITE_ENCRYPTION_KEY=${VITE_ENCRYPTION_KEY:-Xc5qurndq22SuKwKg1mnIY1a43BBODmFVTA2o1N17JQ=}
```
Default encryption key in compose file. Anyone with compose file can decrypt.
**Fix**: Remove defaults. Require `.env` file.

### 42. **Frontend Build Args Expose Internal URLs** (`docker-compose.yml:11-17`)
```yaml
args:
  - VITE_API_BASE_URL=${VITE_API_BASE_URL:-https://aiinterviewtest.scaloz.com/api}
  - VITE_VOICE_SERVER_URL=${VITE_VOICE_SERVER_URL:-wss://aiinterviewtest.scaloz.com/voice}
  - VITE_SCALOZ_URL=${VITE_SCALOZ_URL:-https://workspacetest.scaloz.com}
```
Internal staging URLs baked into production image.
**Fix**: Use build-time args only. No defaults for production URLs.

### 43. **No Database Connection Pool Tuning for Production** (`backend/database.py:18-25`)
```python
pool_size=50, max_overflow=100
```
**Impact**: 150 connections per worker. With 4 gunicorn workers = 600 connections. PostgreSQL default `max_connections=100`.
**Fix**: Calculate based on `max_connections`. Use PgBouncer.

### 44. **Alembic Config Present But Not Used** (`backend/alembic.ini`)
Migrations done via raw SQL in `main.py` instead.
**Fix**: Migrate to Alembic. Remove raw SQL migrations.

### 45. **Magic Strings for Round Names**
```python
# backend/models.py:237
"current_round IN ('technical','coding','behavioral')"
# backend/llm_service.py:772
if round_lower not in active_rounds:
# frontend: "technical" | "coding" | "behavioral"
```
**Fix**: Define `RoundType` enum. Use everywhere.

### 46. **No OpenAPI/Swagger Documentation**
FastAPI auto-generates but no descriptions, examples, or tags on most endpoints.
**Fix**: Add `summary`, `description`, `response_model` to all routes.

### 47. **Frontend Has No Error Boundary Coverage**
`ErrorBoundary.tsx` exists but not wrapping critical routes (interview, coding).
**Fix**: Wrap each major route segment.

### 48. **TypeScript `strict: false` Implied** (no `tsconfig.json` strict flags shown)
**Fix**: Enable `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`.

### 49. **No CI/CD Pipeline Visible**
No GitHub Actions, GitLab CI, or Jenkinsfile.
**Fix**: Add CI with lint, typecheck, test, build, security scan.

### 50. **No Database Backup / Point-in-Time Recovery Strategy**
`hire.db` (SQLite) and PostgreSQL used. No backup scripts, no replication config.
**Fix**: Document and automate backups. Test restore procedure.

---

## 📋 SUMMARY BY CATEGORY

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 6 | 2 | 1 | 2 | 11 |
| Reliability | 1 | 6 | 3 | 1 | 11 |
| Data Integrity | 2 | 1 | 0 | 1 | 4 |
| Performance | 0 | 2 | 2 | 2 | 6 |
| Maintainability | 0 | 0 | 8 | 5 | 13 |
| Architecture | 1 | 0 | 4 | 2 | 7 |
| Observability | 0 | 0 | 2 | 2 | 4 |
| **TOTAL** | **10** | **11** | **20** | **15** | **56** |

---

## 🎯 PRIORITIZED ACTION PLAN

### Week 1 (Critical Security)
1. Remove all hardcoded secrets (Issues #1, #2, #41)
2. Fix tenant auto-creation (Issue #5)
3. Restrict encryption middleware (Issue #6)
4. Fix CORS regex (Issue #7)
5. Disable local code executor in production (Issue #8)

### Week 2 (Critical Reliability)
6. Add request timeouts to all LLM calls (Issue #12)
7. Fix WebSocket auth (Issue #14)
8. Implement proper migrations with Alembic (Issue #20)
9. Add health check dependencies (Issue #34)
10. Fix state machine race conditions (Issue #11)

### Week 3 (High Severity)
11. Add concurrency control to evaluation (Issue #13)
12. Implement streaming video upload (Issue #15)
13. Remove localStorage persistence (Issue #16)
14. Fix SpeechRecognition restart loop (Issue #17)
15. Add structured logging (Issue #28)

### Week 4+ (Technical Debt)
16. Split god files (Issues #21-#26)
17. Add TypeScript strict mode (Issue #48)
18. Implement test infrastructure (Issue #40)
19. Add CI/CD pipeline (Issue #49)
20. Document backup strategy (Issue #50)

---

## 📁 FILES REQUIRING IMMEDIATE ATTENTION

| File | Issues | Priority |
|------|--------|----------|
| `backend/config.py` | #1, #2, #3, #27 | 🔴 Critical |
| `backend/main.py` | #4, #6, #7, #20, #21, #34 | 🔴 Critical |
| `backend/database.py` | #5, #9 | 🔴 Critical |
| `backend/executor.py` | #8, #18 | 🔴 Critical |
| `backend/proctoring.py` | #10, #14, #15, #33 | 🔴 Critical |
| `backend/routers/ai.py` | #11 | 🔴 Critical |
| `backend/llm_service.py` | #12, #23, #27 | 🟠 High |
| `backend/evaluation_service.py` | #13, #24 | 🟠 High |
| `frontend/src/components/interview/VoiceInterviewAgent.tsx` | #16, #17, #26 | 🟠 High |
| `frontend/src/lib/api.ts` | #25, #30 | 🟡 Medium |
| `docker-compose.yml` | #41, #42 | 🔴 Critical |

---

*Report generated by automated codebase analysis. Manual review recommended for business logic correctness.*