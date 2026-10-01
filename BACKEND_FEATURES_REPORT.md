# IntelliHire Backend - Feature Report

**Service**: Python 3.10 + FastAPI + SQLAlchemy 2.0 + PostgreSQL  
**Port**: 8000 (internal) / 5000 (Docker)  
**Workers**: 4 Gunicorn + Uvicorn workers

---

## 📋 **Feature Inventory**

### 1. 🔐 **Authentication & Authorization**

| Feature | Implementation | Endpoints |
|---------|----------------|-----------|
| **JWT Auth** | RS256/HS256, 30-day expiry, refresh via re-login | `POST /auth/v1/token`, `POST /auth/v1/signup` |
| **Password Hashing** | bcrypt (cost=12 via passlib) | Internal |
| **RBAC Roles** | `super_admin`, `admin`, `manager`, `recruiter` | `auth_rbac.py` |
| **Multi-tenant Isolation** | Row-level security via SQLAlchemy `with_loader_criteria` | All queries auto-filtered |
| **SSO Integration** | Scaloz workspace sync (background worker every 60s) | `sync.py`, `auth.py` |
| **Invite-token Auth** | Candidate access without JWT (x-invite-token header) | Interview endpoints |
| **Password Reset** | Token-based (1hr expiry), email delivery | `POST /auth/v1/forgot-password`, `POST /auth/v1/reset-password` |

**Key Files**: `auth.py`, `auth_rbac.py`, `models.py` (User, Membership, Tenant)

---

### 2. 🏢 **Multi-Tenancy & Organization**

| Feature | Implementation |
|---------|----------------|
| **Tenant Hierarchy** | Tenant → Memberships (user + role) → Interviews |
| **Dynamic Tenant Resolution** | Header `X-Tenant-ID` → Origin/Referer → Host → JWT claim → Fallback |
| **Auto-provisioning** | SSO login creates tenant + membership if missing |
| **Plan Limits** | `plan_type` (basic/pro/enterprise), `interview_limit`, `duration_days`, `expiry_date` |
| **Master Catalogs** | `roles_master`, `departments_master` (tenant-scoped + global) |

**Key Files**: `database.py` (resolve_tenant_id, get_db), `models.py` (Tenant, Membership, RoleMaster, DepartmentMaster)

---

### 3. 📝 **Interview Management**

| Feature | Details |
|---------|---------|
| **Interview Creation** | From JD text or manual config (50+ fields) |
| **Structured Configuration** | Job role, department, skills, difficulty, stages, seniority, experience range |
| **Proctoring Config** | Enabled/disabled, max strikes (default 3), score cutoff (70), actions (flag/terminate) |
| **Evaluation Config** | Score cutoff (60), custom rubric (weighted criteria) |
| **Scheduling** | `available_from`, `available_until`, timezone, grace period |
| **Multi-candidate** | Single template → multiple `InterviewSession` records |
| **Invite Links** | Base62 short codes (`/i/{short_code}`) + UUID tokens |
| **Access Control** | Status: pending → in_progress → completed/flagged; expiry enforcement |
| **Video Recording** | Optional S3 multipart upload, configurable retention |

**Key Files**: `routers/interviews.py`, `models.py` (Interview), `routers/ai.py` (round management)

---

### 4. ❓ **Question Management**

| Feature | Details |
|---------|---------|
| **Question Types** | `technical`, `coding`, `behavioral` |
| **Source Tracking** | `generated` (AI), `edited` (HR modified), `custom` (HR written) |
| **Versioning** | `original_text` preserved for revert; `edited_at` timestamp |
| **Selection** | Recruiter selects subset; candidates see only `selected=true` |
| **Ideal Answers** | AI-generated reference answers stored per question |
| **Rubrics** | JSONB per question: key_concepts, weights, evaluation_guide, common_mistakes |
| **Deduplication** | Cosine similarity (TF-IDF) against existing questions in interview |
| **Batch Operations** | Bulk select/deselect, reorder via `order_index` |

**Key Files**: `routers/questions.py`, `models.py` (InterviewQuestion), `question_similarity.py`

---

### 5. 🤖 **AI Interview Engine** (Core Differentiator)

#### **State Machine Architecture**
```
INTRO → TECHNICAL (Q1→Followup→Q2→Followup...) → CODING → BEHAVIORAL → CLOSING
```

| Component | Implementation |
|-----------|----------------|
| **Mission Builder** | `_build_mission()` constructs per-turn instructions for LLM |
| **Answer Classification** | `_classify_answer_quality()` - heuristic (substantive/partial/evasive) in <1ms |
| **Follow-up Control** | Exactly 1 follow-up per base question (double-lock: turn_count + DB flag) |
| **Drift Prevention** | Follow-ups anchored to base question; ignores candidate tangents |
| **Round Transitions** | Dynamic based on selected question types; behavioral first if present |
| **Personalized Closing** | LLM synthesizes sign-off from conversation history |
| **Self-Introduction** | Dynamic AI intro based on JD + role |

#### **LLM Integration** (`llm_service.py`)
| Provider | Models | Use Case |
|----------|--------|----------|
| **Groq** (primary) | `openai/gpt-oss-120b` | Interview, questions, evaluation |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `whisper-1` | Fallback, TTS, STT, evaluation |
| **Ollama** (local) | `llama3.1:8b` | Air-gapped deployments |

#### **Quality Guards**
- Meta-response detection (blocks "As an AI..." responses)
- JSON schema enforcement with fallback wrapping
- 35s timeout with exponential backoff retry
- Circuit breaker for rate limits

**Key Files**: `routers/ai.py`, `llm_service.py`, `evaluation_service.py`

---

### 6. 💻 **Code Execution & Coding Assessment**

#### **Multi-Language Support**
| Language | Runtime | Harness |
|----------|---------|---------|
| Python | `python3` | Dynamic function calling + stdout capture |
| JavaScript | `node` | ESM/CommonJS compatible |
| Java | `javac` + `java` | `SolutionHarness` wrapper |
| C++ | `g++ -std=c++17` | `Solution` class + main() injection |
| C | `gcc` | `solution()` function + main() injection |

#### **Execution Modes**
| Mode | Endpoint | Purpose |
|------|----------|---------|
| **Test Run** | `POST /functions/v1/execute-code` | Visible test cases only, no persistence |
| **Final Submit** | `POST /functions/v1/submit-coding` | All test cases (hidden + visible), persisted |

#### **Security**
- Temporary directory per execution
- 5s timeout (configurable)
- No network access (subprocess isolation)
- Resource limits via OS (no container sandbox yet ⚠️)

#### **Aggregation Logic**
- Best submission per question × question count = aggregate coding score
- Unattempted questions score 0

**Key Files**: `executor.py`, `routers/code.py`, `models.py` (CodingQuestion, CodeSubmission)

---

### 7. 📊 **Evaluation Pipeline** (4-Stage)

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ 1. HARD     │──▶│ 2. SIMILARITY│──▶│ 3. LLM      │──▶│ 4. BACKEND  │
│ VALIDATION  │   │ CHECK       │   │ RUBRIC EVAL │   │ AGGREGATION │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
     │                │                 │                  │
     ▼                ▼                 ▼                  ▼
  Reject empty/    Cosine sim       Structured        Weighted avg
  filler, "IDK",   vs ideal_answer  JSON rubric       per rubric
  prompt injection (threshold 0.30)  (temp=0.1)        weights
```

#### **Rubric System**
- **Default**: 5 criteria (Technical Correctness 35%, Problem Solving 25%, Code Quality 20%, Practical Knowledge 10%, Communication 10%)
- **Enterprise**: Custom criteria via `evaluation_rubric` on interview
- **Per-question**: AI-generated key_concepts + weights at question creation

#### **Output**
```json
{
  "per_question": [...],
  "technical_score": 78,
  "coding_score": 85,
  "behavioral_score": 72,
  "overall_score": 79,
  "recommendation": "recommend",
  "categories": {...},
  "emotions": {...},
  "strengths": [...],
  "weaknesses": [...],
  "rubric_summary": {...}
}
```

**Key Files**: `evaluation_service.py`, `llm_service.py` (generate_ideal_answer_and_rubric)

---

### 8. 🎥 **Proctoring & Anti-Cheat**

#### **Real-time (WebSocket: `/api/ws/face-monitor`)**
| Detection | Technology | Threshold |
|-----------|------------|-----------|
| **Face Count** | MediaPipe Face Mesh | >1 face = multi-person strike |
| **Gaze/Attention** | Eye landmarks (33, 263) + iris (468, 473) | Nose X outside [0.18, 0.82] |
| **Face Validity** | Anatomical checks (eye dist, aspect ratio, mouth position) | Filters hands/glare |
| **Object Detection** | YOLOv8s (phone, bottle, backpack) | Confidence >0.45-0.55 |

#### **Strike System**
- Configurable: `max_strikes` (default 3), `score_cutoff` (70)
- Actions: `flag_review` | `auto_terminate` | `manual_review`
- 15s cooldown between strikes
- Frontend sync via `signals.strikes` in WebSocket payload

#### **Video Recording**
- Chunked WebM upload → `webm_fixer` → S3 multipart
- 200MB limit, presigned URLs for large files
- S3 key: `interviews/{id}/recording.webm`

**Key Files**: `proctoring.py`, `routers/proctoring.py` (if separate), `models.py` (proctoring_strikes JSONB)

---

### 9. 📧 **Communication & Notifications**

| Feature | Implementation |
|---------|----------------|
| **Email Service** | SMTP (configurable), HTML templates with invite links |
| **Invite Flow** | Recruiter adds candidates → bulk email with unique tokens |
| **Email Logging** | `email_logs` table (to, cc, bcc, subject, status, error) |
| **Resend/Revoke** | Per-candidate controls |
| **Verification** | Candidate email verification before interview start |

**Key Files**: `email_service.py`, `routers/recruiter.py` (send-email, candidates endpoints)

---

### 10. 📈 **Admin & Reporting**

| Feature | Endpoint |
|---------|----------|
| **Dashboard Stats** | `GET /admin/dashboard/stats` |
| **Hierarchy View** | `GET /admin/dashboard/managers` → recruiters → candidates |
| **Operational Table** | `GET /admin/dashboard/operational-table` (filters: date, status, manager) |
| **Trends** | `GET /admin/dashboard/trends?days=30` |
| **Leaderboard** | `GET /admin/dashboard/leaderboard` |
| **Pipeline** | `GET /admin/dashboard/pipeline` |
| **Super Admin** | Tenant CRUD, platform-wide stats (`/super-admin/*`) |
| **Reports** | Per-interview PDF/JSON export (`/recruiter/interview/{id}/report`) |
| **Recordings** | Streaming/download (`/recruiter/interview/{id}/recording`) |

**Key Files**: `routers/admin_dashboard.py`, `routers/super_admin.py`, `routers/recruiter.py`, `routers/reports.py`

---

### 11. 🔌 **ATS Integration**

| Feature | Details |
|---------|---------|
| **Webhook Receiver** | `POST /ats/webhook` - receives candidate updates |
| **Webhook Sender** | `WEBHOOK_CALLBACK_URL` - sends interview results |
| **API Key Auth** | `ATS_API_KEY` header validation |
| **Sync Endpoints** | Push/pull candidate/interview status |

**Key Files**: `routers/ats.py`

---

### 12. 🛠️ **System & Infrastructure**

| Feature | Implementation |
|---------|----------------|
| **Database Migrations** | Alembic (configured) + raw SQL in lifespan (legacy) |
| **Health Check** | `GET /health` - returns version, env |
| **Rate Limiting** | SlowAPI (IP-based, 100 req/min default) |
| **CORS** | Multi-origin + regex (scaloz.com subdomains) |
| **Payload Encryption** | AES-256-GCM middleware (configurable) |
| **Request Logging** | Middleware + structured logger |
| **Exception Handlers** | Validation, HTTP, Global (500) with traceback |
| **Static Files** | `/uploads` mount for local video fallback |
| **S3 Client** | Boto3 with transfer config (multipart, 5 concurrency) |

**Key Files**: `main.py`, `config.py`, `database.py`, `encryption_middleware.py`, `logging_config.py`

---

## 📊 **API Surface Summary**

| Router | Prefix | Auth | Purpose |
|--------|--------|------|---------|
| `auth` | `/auth/v1` | Public | Login, signup, SSO |
| `interviews` | `/rest/v1/interviews` | JWT/Token | CRUD, config |
| `questions` | `/rest/v1/interview_questions` | JWT/Token | Question mgmt |
| `ai` | `/functions/v1` | JWT/Token | AI interview, generation |
| `code` | `/rest/v1/coding_questions`, `/functions/v1/execute-code` | JWT/Token | Coding assessment |
| `results` | `/rest/v1/interviews/{id}/results` | JWT/Token | Evaluation results |
| `admin` | `/admin/v1` | JWT (admin+) | Tenant/user mgmt |
| `admin_dashboard` | `/admin/dashboard` | JWT (admin+) | Analytics |
| `super_admin` | `/super-admin` | JWT (super_admin) | Platform mgmt |
| `recruiter` | `/recruiter` | JWT (recruiter+) | Recruiter workflow |
| `ats` | `/ats` | API Key | ATS integration |
| `reports` | `/reports` | JWT | Export |
| `proctoring` | `/api/ws/face-monitor`, `/api/upload-video` | Token | Proctoring |

---

## 🗄️ **Database Schema (Key Tables)**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `tenants` | Organizations | id, name, plan_type, expiry_date, interview_limit |
| `users` | Platform users | id, email, password_hash, full_name, status |
| `memberships` | User-Tenant-Role | user_id, tenant_id, role, scaloz_role, override_role |
| `interviews` | Interview templates | id, user_id, tenant_id, job_role, config JSONB, status, current_round |
| `interview_sessions` | Candidate attempts | id, interview_id, candidate_id, session_token, chat_history, answers |
| `interview_questions` | Questions per interview | id, interview_id, question_text, type, difficulty, selected, ideal_answer, rubric |
| `coding_questions` | Coding challenges | id, interview_id, title, description, test_cases, starter_code |
| `code_submissions` | Code runs | id, interview_id, session_id, question_id, code, passed_tests, total_tests |
| `interview_messages` | Chat transcript | id, interview_id, role, content, round, metadata |
| `interview_candidates` | Multi-candidate invites | id, interview_id, candidate_email, invitation_status, session_id |
| `email_logs` | Audit trail | id, interview_id, to_email, subject, status, sent_by |

---

## ⚙️ **Configuration (Environment Variables)**

### Required
```env
DATABASE_URL=postgresql://user:pass@host:5432/db
JWT_SECRET=<64-char-random>
GROQ_API_KEY=gsk_...  # or OLLAMA_BASE_URL
```

### Optional (with defaults)
```env
# LLM
OPENAI_API_KEY=
OLLAMA_MODEL=llama3.1:8b
GROQ_MODEL=openai/gpt-oss-120b

# Voice
DEEPGRAM_API_KEY=
TTS_PROVIDER=deepgram

# Storage
STORAGE_MODE=local|s3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=

# Email
SMTP_HOST=, SMTP_PORT=587, SMTP_USER=, SMTP_PASS=, SMTP_FROM=

# Security
ENCRYPTION_KEY=<base64-32-bytes>
REQUIRE_ENCRYPTION=false
CORS_ORIGIN_REGEX=

# Integration
FRONTEND_ORIGIN=http://localhost:8080
XEVHIRE_BASE_URL=
AI_INTERVIEW_BASE_URL=
RESULTS_BASE_URL=
WEBHOOK_CALLBACK_URL=
```

---

## 🚀 **Startup Sequence** (`main.py` lifespan)

1. **DB Connection** - Async engine + session factory
2. **Schema Sync** - `Base.metadata.create_all()` + 100+ additive migrations
3. **Seed Data** - Default departments (8), roles (14) if empty
4. **SSO Sync Worker** - Background task (60s interval)
5. **Middleware Stack** - Encryption → CORS → Rate Limit → Logging
6. **Router Registration** - 13 routers mounted
7. **Static Mount** - `/uploads` for local files

---

## 📁 **Code Organization**

```
backend/
├── main.py                 # App factory, lifespan, middleware, routers
├── config.py               # Pydantic Settings (env-driven)
├── database.py             # Engine, session, tenant resolution
├── models.py               # SQLAlchemy ORM + Pydantic schemas (1048 lines)
├── auth.py                 # JWT, password, SSO, RBAC
├── auth_rbac.py            # Role/Permission enums, dependencies
├── llm_service.py          # LLM client, personas, missions, TTS/STT (1077 lines)
├── evaluation_service.py   # 4-stage evaluation pipeline (1052 lines)
├── executor.py             # Local code execution (4 languages)
├── proctoring.py           # WebSocket face monitor, YOLO, video upload
├── encryption_middleware.py # AES-256-GCM request/response encryption
├── logging_config.py       # Structured logging setup
├── utils.py                # Helpers (short_code, serialization)
├── question_similarity.py  # TF-IDF cosine deduplication
├── sync.py                 # Scaloz SSO user sync
├── routers/                # 13 feature routers
│   ├── auth.py
│   ├── interviews.py
│   ├── questions.py
│   ├── ai.py
│   ├── code.py
│   ├── results.py
│   ├── admin.py
│   ├── admin_dashboard.py
│   ├── super_admin.py
│   ├── recruiter.py
│   ├── ats.py
│   ├── reports.py
│   └── proctoring.py
├── requirements.txt        # 26 Python packages
├── alembic.ini             # Migration config (unused currently)
├── Dockerfile              # Python 3.10 + JDK + build tools
└── *.py (debug/test scripts)  # 15+ files - should be cleaned
```

---

## ✅ **Production Readiness Checklist**

| Area | Status | Notes |
|------|--------|-------|
| **Auth/Security** | ⚠️ Partial | Hardcoded secrets, no sandbox, global encryption |
| **Multi-tenancy** | ✅ Solid | Row-level isolation, SSO sync |
| **AI Interview** | ✅ Advanced | State machine, drift prevention, adaptive |
| **Code Execution** | ⚠️ Risk | No container sandbox, local subprocess |
| **Evaluation** | ✅ Robust | 4-stage pipeline, custom rubrics |
| **Proctoring** | ✅ Comprehensive | Face + object + gaze + video |
| **Observability** | ❌ Missing | No health deps, no tracing, print() logs |
| **Testing** | ❌ None | No pytest, no CI |
| **Migrations** | ⚠️ Mixed | Alembic config exists but raw SQL used |
| **Documentation** | ⚠️ Minimal | No OpenAPI descriptions on endpoints |

---

## 🎯 **Backend-Specific Critical Issues** (from full report)

1. **Hardcoded encryption key** (`config.py:84`)
2. **Tenant auto-creation from headers** (`database.py:182-200`)
3. **Global encryption middleware** breaks health checks (`main.py:328`)
4. **Local code executor without sandbox** (`executor.py`)
5. **100+ raw SQL migrations on every startup** (`main.py:47-100`)
6. **AI interview state machine race conditions** (`routers/ai.py`)
7. **WebSocket proctoring no auth** (`proctoring.py:210`)
8. **No Node.js in Dockerfile** for JS execution
9. **Torch import not in requirements** (`proctoring.py:27`)
10. **Alembic unused** - migrations via raw SQL

---

*This report covers backend features only. Frontend and voice server features documented separately.*