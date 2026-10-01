"""
main.py - Entry point for the modularized AI Interview Platform Backend.
Organized into routers for production-grade maintenance and scalability.
# Production service reload
"""
import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from config import settings
from database import engine, get_db, AsyncSessionLocal
from models import Base, EmailLog, Interview, RoleMaster, DepartmentMaster
from logging_config import logger as log
from utils import _interview_to_dict
from encrypted_response import EncryptedJSONResponse

# Import Routers
from routers import auth, interviews, questions, ai, results, code, admin, admin_dashboard, super_admin, recruiter, ats, reports
import proctoring

# ─── Rate Limiting Setup ──────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and Shutdown logic."""
    log.info("Starting up backend...")
    log.info("Loaded Integration Config:")
    log.info(f"  XEVHIRE_BASE_URL={settings.XEVHIRE_BASE_URL}")
    log.info(f"  AI_INTERVIEW_BASE_URL={settings.AI_INTERVIEW_BASE_URL}")
    log.info(f"  RESULTS_BASE_URL={settings.RESULTS_BASE_URL}")
    log.info(f"  WEBHOOK_CALLBACK_URL={settings.WEBHOOK_CALLBACK_URL}")
    
    async with engine.begin() as conn:
        # Run additive migrations safely
        await conn.run_sync(Base.metadata.create_all)
        
    from sqlalchemy import text
    
    async def try_run_migration(sql_query: str):
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql_query))
        except Exception:
            pass

    # --- migrations for interview_questions ---
    await try_run_migration("ALTER TABLE interview_questions ADD COLUMN source VARCHAR NOT NULL DEFAULT 'generated'")
    # BUG-2 FIX: tenant_id was in the ORM model but never migrated to the live DB
    await try_run_migration("ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE")
    await try_run_migration("ALTER TABLE interview_questions ADD COLUMN original_text TEXT")
    await try_run_migration("ALTER TABLE interview_questions ADD COLUMN edited_at TIMESTAMP WITH TIME ZONE")
    await try_run_migration("ALTER TABLE interview_questions ADD COLUMN ideal_answer TEXT")
    await try_run_migration("ALTER TABLE interview_questions ADD COLUMN rubric JSONB")
        
    # --- migrations for interviews ---
    await try_run_migration("ALTER TABLE interviews ADD COLUMN jd_text TEXT")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN structured_memory JSONB DEFAULT '{}'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN duration_seconds INTEGER DEFAULT 0")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN video_url TEXT")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN recording_status TEXT")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN s3_upload_id TEXT")
        
    await try_run_migration("ALTER TABLE interviews ADD COLUMN compliance_accepted BOOLEAN NOT NULL DEFAULT FALSE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN started_at TIMESTAMP WITH TIME ZONE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN proctoring_strikes JSONB DEFAULT '{\"mobile\": 0, \"multi_person\": 0, \"gaze\": 0}'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN violation_screenshot TEXT")

    # --- migrations for tenants ---
    await try_run_migration("ALTER TABLE tenants ADD COLUMN plan_type VARCHAR DEFAULT 'basic'")
    await try_run_migration("ALTER TABLE tenants ADD COLUMN duration_days INTEGER DEFAULT 30")
    await try_run_migration("ALTER TABLE tenants ADD COLUMN start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()")
    await try_run_migration("ALTER TABLE tenants ADD COLUMN expiry_date TIMESTAMP WITH TIME ZONE")
    await try_run_migration("ALTER TABLE tenants ADD COLUMN status VARCHAR DEFAULT 'active'")
    await try_run_migration("ALTER TABLE tenants ADD COLUMN interview_limit INTEGER DEFAULT 100")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN save_video_recording BOOLEAN NOT NULL DEFAULT FALSE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN show_candidate_video BOOLEAN NOT NULL DEFAULT TRUE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS short_code VARCHAR UNIQUE")
    await try_run_migration("CREATE UNIQUE INDEX IF NOT EXISTS idx_interviews_short_code ON interviews (short_code)")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interview_name TEXT")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interviewer_name TEXT")
    await try_run_migration("CREATE INDEX IF NOT EXISTS idx_interviews_interview_name ON interviews (interview_name)")
    await try_run_migration("CREATE INDEX IF NOT EXISTS idx_interviews_interviewer_name ON interviews (interviewer_name)")
    await try_run_migration("UPDATE interviews SET interview_name = CONCAT(job_role, ' Interview') WHERE interview_name IS NULL OR interview_name = ''")
    await try_run_migration("UPDATE interviews SET interviewer_name = u.full_name FROM users u WHERE interviews.user_id = u.id AND (interviews.interviewer_name IS NULL OR interviews.interviewer_name = '')")

    # --- migrations for multi-candidate ---
    await try_run_migration("ALTER TABLE interviews ADD COLUMN is_multi_candidate BOOLEAN NOT NULL DEFAULT FALSE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS proctoring_enabled BOOLEAN NOT NULL DEFAULT TRUE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS proctoring_max_strikes INTEGER NOT NULL DEFAULT 3")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS proctoring_score_cutoff INTEGER NOT NULL DEFAULT 70")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS proctoring_max_strikes_action VARCHAR NOT NULL DEFAULT 'flag_review'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS proctoring_cutoff_action VARCHAR NOT NULL DEFAULT 'manual_review'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS evaluation_score_cutoff INTEGER NOT NULL DEFAULT 60")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS evaluation_cutoff_action VARCHAR NOT NULL DEFAULT 'manual_review'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS evaluation_rubric JSONB")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS available_from TIMESTAMP WITH TIME ZONE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS available_until TIMESTAMP WITH TIME ZONE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS timezone VARCHAR NOT NULL DEFAULT 'Asia/Kolkata'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER DEFAULT 0")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS actual_started_at TIMESTAMP WITH TIME ZONE")

    # --- migrations for structured screening & setup fields ---
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS job_role_id UUID REFERENCES roles_master(id) ON DELETE SET NULL")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments_master(id) ON DELETE SET NULL")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS department TEXT")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS skill_tags JSONB DEFAULT '[]'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS difficulty_level VARCHAR DEFAULT 'Medium'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS question_count INTEGER DEFAULT 5")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS coding_count INTEGER DEFAULT 2")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interview_stage VARCHAR DEFAULT 'Screening'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS seniority_level VARCHAR DEFAULT 'Mid'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS experience_min INTEGER DEFAULT 2")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS experience_max INTEGER DEFAULT 5")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interview_language VARCHAR DEFAULT 'English'")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS link_expiry_days INTEGER DEFAULT 7")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS require_camera BOOLEAN DEFAULT TRUE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS detect_tab_switch BOOLEAN DEFAULT TRUE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS block_copy_paste BOOLEAN DEFAULT TRUE")
    await try_run_migration("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS max_retake_attempts INTEGER DEFAULT 1")
    await try_run_migration("CREATE INDEX IF NOT EXISTS idx_interviews_job_role_id ON interviews (job_role_id)")
    await try_run_migration("CREATE INDEX IF NOT EXISTS idx_interviews_department_id ON interviews (department_id)")

    # Seed default departments and roles if empty
    try:
        import uuid as _uuid_seed
        async with engine.begin() as conn:
            dept_res = await conn.execute(text("SELECT COUNT(*) FROM departments_master"))
            if (dept_res.scalar() or 0) == 0:
                default_depts = [
                    "Engineering", "Product", "Design", "Sales",
                    "Marketing", "Operations", "Human Resources", "Finance"
                ]
                for d in default_depts:
                    await conn.execute(
                        text("INSERT INTO departments_master (id, name, created_at) VALUES (:id, :name, NOW())"),
                        {"id": _uuid_seed.uuid4(), "name": d}
                    )
                log.info("Seeded default departments in departments_master")

            role_res = await conn.execute(text("SELECT COUNT(*) FROM roles_master"))
            if (role_res.scalar() or 0) == 0:
                default_roles = [
                    ("Software Engineer", "Engineering"),
                    ("Senior Software Engineer", "Engineering"),
                    ("Frontend Developer", "Engineering"),
                    ("Backend Developer", "Engineering"),
                    ("Full Stack Developer", "Engineering"),
                    ("DevOps / Cloud Engineer", "Engineering"),
                    ("Data Scientist", "Data & Analytics"),
                    ("Machine Learning Engineer", "Data & Analytics"),
                    ("Product Manager", "Product"),
                    ("UI/UX Designer", "Design"),
                    ("QA / Automation Engineer", "Quality Assurance"),
                    ("Mobile Engineer (iOS/Android)", "Engineering"),
                    ("Engineering Manager", "Engineering"),
                    ("Solutions Architect", "Architecture"),
                ]
                for r_name, r_dept in default_roles:
                    await conn.execute(
                        text("INSERT INTO roles_master (id, name, department, created_at) VALUES (:id, :name, :dept, NOW())"),
                        {"id": _uuid_seed.uuid4(), "name": r_name, "dept": r_dept}
                    )
                log.info("Seeded default roles in roles_master")
    except Exception as e:
        log.warning(f"Error checking/seeding master tables: {e}")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS candidate_id UUID REFERENCES interview_candidates(id) ON DELETE CASCADE")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS current_question_index INTEGER NOT NULL DEFAULT 0")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS chat_history JSONB DEFAULT '[]'")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}'")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS coding_answers JSONB DEFAULT '{}'")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS audio_url TEXT")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS proctoring_alerts JSONB DEFAULT '{}'")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS communication_score FLOAT")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS interview_duration VARCHAR")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS s3_upload_id TEXT")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS coding_score INTEGER")
    await try_run_migration("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS behavioral_score INTEGER")
    await try_run_migration("ALTER TABLE code_submissions ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES interview_sessions(id) ON DELETE SET NULL")
    await try_run_migration("ALTER TABLE interview_sessions ALTER COLUMN candidate_name DROP NOT NULL")
    await try_run_migration("ALTER TABLE interview_sessions ALTER COLUMN candidate_email DROP NOT NULL")
    await try_run_migration("ALTER TABLE interview_sessions ALTER COLUMN compliance_accepted DROP NOT NULL")
    await try_run_migration("ALTER TABLE interview_sessions ALTER COLUMN save_video_recording DROP NOT NULL")
    await try_run_migration("ALTER TABLE interview_sessions ALTER COLUMN show_candidate_video DROP NOT NULL")

    # Backfill short_code for existing interviews where it's NULL
    try:
        from utils import generate_base62_short_code
        async with engine.begin() as conn:
            res = await conn.execute(text("SELECT id FROM interviews WHERE short_code IS NULL"))
            rows = res.fetchall()
            for row in rows:
                interview_id = row[0]
                attempts = 0
                unique_code = None
                while attempts < 10:
                    candidate = generate_base62_short_code(7)
                    dup_res = await conn.execute(text("SELECT id FROM interviews WHERE short_code = :code"), {"code": candidate})
                    if dup_res.fetchone() is None:
                        unique_code = candidate
                        break
                    attempts += 1
                if unique_code:
                    await conn.execute(
                        text("UPDATE interviews SET short_code = :code WHERE id = :id"),
                        {"code": unique_code, "id": interview_id}
                    )
    except Exception as e:
        log.error(f"Migration backfill failed: {e}")

    # --- migrations for memberships ---
    await try_run_migration("ALTER TABLE memberships ADD COLUMN IF NOT EXISTS scaloz_role VARCHAR")
    await try_run_migration("ALTER TABLE memberships ADD COLUMN IF NOT EXISTS override_role VARCHAR")

    # --- migrations for users ---
    await try_run_migration("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'active'")
    await try_run_migration("ALTER TABLE users ADD COLUMN IF NOT EXISTS scaloz_user_id VARCHAR")

    # ISSUE-6 FIX: current_round constraint was missing 'completed', causing IntegrityError on round completion
    await try_run_migration("""
        ALTER TABLE interviews DROP CONSTRAINT IF EXISTS interviews_round_check;
        ALTER TABLE interviews ADD CONSTRAINT interviews_round_check
            CHECK (current_round IN ('technical','coding','behavioral','completed'));
    """)
            

    log.info("Database schema synchronized.")

    async def sso_sync_worker():
        from sync import sync_all_users_from_scaloz
        # Wait a bit on startup
        await asyncio.sleep(5)
        log.info("[SSO Sync Worker] Started.")
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    await sync_all_users_from_scaloz(db)
            except Exception as e:
                log.error(f"[SSO Sync Worker] Error in sync iteration: {e}")
            await asyncio.sleep(60)

    sync_task = asyncio.create_task(sso_sync_worker())
    
    yield
    
    log.info("Shutting down backend...")
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass

app = FastAPI(
    title="Xeviewer Production API",
    version="2.0.0",
    lifespan=lifespan,
    default_response_class=EncryptedJSONResponse,
)

# ─── Global State & Middleware ────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ─── Exception Handlers ──────────────────────────────────────────────────────
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = jsonable_encoder(exc.errors())
    log.error(f"Validation Error on {request.url}: {errors}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": errors},
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    import traceback
    log.error(f"Unhandled Exception on {request.method} {request.url}: {exc}\n{traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "error": str(exc)},
    )

# ─── Global Logging Middleware ───────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    log.debug(f"Incoming {request.method} {request.url}")
    response = await call_next(request)
    return response

# ─── CORS Middleware (Multi-tenant + Hardened) ──────────────────────────────
# NOTE: We add this LAST so it runs FIRST in the request pipeline.
# Local dev origins are listed explicitly; production tenant subdomains are
# matched by regex to support any tenant onboarded in Scaloz.
local_origins = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3001",
    "http://rohan-local-dev.localhost:3001",
]
if settings.FRONTEND_ORIGIN and settings.FRONTEND_ORIGIN not in local_origins:
    local_origins.append(settings.FRONTEND_ORIGIN)

from encryption_middleware import EncryptionMiddleware
app.add_middleware(EncryptionMiddleware)

app.add_middleware(
    CORSMiddleware,
    # Explicit origins (local dev) — credentials work here without regex
    allow_origins=local_origins,
    # Regex covers: any subdomain of scaloz.com (including production & test environments), plus localhost subdomains for local development
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or r"https://([a-zA-Z0-9\-\.]+\.)?scaloz\.com|https?://([a-zA-Z0-9\-\.]+\.)?localhost(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# ─── Static Files & Proctoring ───────────────────────────────────────────────
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/i/{short_code}")
async def resolve_short_code(
    short_code: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Public route to resolve a Base62 short code to the frontend candidate interview page."""
    from sqlalchemy.ext.asyncio import AsyncSession
    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        result = await db.execute(select(Interview).where(Interview.short_code == short_code))
        interview = result.scalar_one_or_none()
    finally:
        db.info["tenant_id"] = _old_tenant
    if not interview:
        raise HTTPException(status_code=404, detail="Interview link is invalid or expired")

    # Validate active/expired/completed
    if interview.status not in ("pending", "in_progress"):
        status_msg = "completed" if interview.status in ("completed", "flagged") else interview.status
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This interview has already been {status_msg} and cannot be accessed."
        )

    # Resolve based on Accept headers (Browser direct hit vs API JSON fetch)
    accept_header = request.headers.get("accept", "")
    if "text/html" in accept_header:
        # Browser click: Redirect to the React Router SPA candidate route without exposing UUID in address bar
        frontend_url = f"{settings.FRONTEND_ORIGIN}/i/{short_code}"
        return RedirectResponse(url=frontend_url)
    
    # API request (e.g. from frontend fetch): Return full serialization
    return _interview_to_dict(interview)


# ─── Health Check ────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health_check():
    """Endpoint for AWS Load Balancer health probes."""
    return {
        "status": "healthy",
        "version": "2.0.0",
        "environment": os.getenv("ENV", "production")
    }

# ─── Include Routers ─────────────────────────────────────────────────────────
# --- Include Routers ---
app.include_router(auth.router)
app.include_router(auth.sso_router)
app.include_router(interviews.router)
app.include_router(questions.router)
app.include_router(ai.router)
app.include_router(results.router)
app.include_router(code.router)
app.include_router(admin.router)
app.include_router(admin_dashboard.router)
app.include_router(super_admin.router)
app.include_router(proctoring.router)
app.include_router(recruiter.router)
app.include_router(ats.router)
app.include_router(reports.router)

if __name__ == "__main__":
    import uvicorn
    # Force reload comment
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
