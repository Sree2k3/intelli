import uuid
import boto3
from botocore.client import Config
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
from config import settings
from logging_config import logger as log
from models import Interview, InterviewMessage, InterviewQuestion, CodingQuestion, InterviewSession, InterviewCandidate
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

def get_s3_client() -> Optional[Any]:
    """Centralized S3 client factory that handles static keys and IAM roles."""
    if settings.STORAGE_MODE != "s3":
        return None

    has_static_creds = bool(
        settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY 
        and not settings.AWS_ACCESS_KEY_ID.startswith("your_")
    )
    
    try:
        if has_static_creds:
            return boto3.client(
                's3',
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=settings.AWS_REGION,
                config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'})
            )
        else:
            return boto3.client(
                's3',
                region_name=settings.AWS_REGION,
                config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'})
            )
    except Exception as e:
        log.error(f"Failed to initialize S3 client: {e}")
        return None

def parse_s3_key(url: Optional[str]) -> Optional[str]:
    """Extract key from S3 URI or HTTPS URL, stripping bucket prefix if present."""
    if not url:
        return None
    
    # Check if already a presigned URL to prevent double-signing
    url_lower = url.lower()
    if "signature=" in url_lower or "x-amz-signature=" in url_lower or "awsaccesskeyid=" in url_lower:
        return None

    if url.startswith("s3://"):
        key = url.replace("s3://", "")
    elif ".amazonaws.com/" in url:
        key = url.split(".amazonaws.com/")[-1]
    else:
        return None
        
    if settings.S3_BUCKET_NAME:
        bucket_prefix = f"{settings.S3_BUCKET_NAME}/"
        if key.startswith(bucket_prefix):
            key = key[len(bucket_prefix):]
    return key

def _generate_presigned_url(url: Optional[str]) -> Optional[str]:
    """Helper to convert S3 storage paths/URLs into temporary presigned URLs."""
    if not url or settings.STORAGE_MODE != "s3":
        return url
    
    s3_key = parse_s3_key(url)
    if not s3_key:
        return url

    s3_client = get_s3_client()
    if not s3_client:
        return url

    try:
        return s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': settings.S3_BUCKET_NAME, 'Key': s3_key},
            ExpiresIn=settings.S3_PRESIGNED_EXPIRY
        )
    except Exception as e:
        log.error(f"!!! Presigned URL Generation Error for {url}: {e}")
        return url

import json

def _resolve_violation_screenshots(url_val: Optional[str]) -> List[Any]:
    """Helper to parse a single string or JSON list of screenshot URLs/objects and return their presigned versions."""
    if not url_val:
        return []
    
    val_str = str(url_val).strip()
    if val_str.startswith("["):
        try:
            items = json.loads(val_str)
            if isinstance(items, list):
                result = []
                for u in items:
                    if isinstance(u, dict):
                        u_copy = u.copy()
                        u_copy["url"] = _generate_presigned_url(u.get("url"))
                        result.append(u_copy)
                    elif u:
                        result.append(_generate_presigned_url(u))
                return result
        except Exception:
            pass
    return [_generate_presigned_url(url_val)]

def _interview_to_dict(i: Interview) -> Dict[str, Any]:
    # Generate presigned URLs for both video and candidate ID if they are in S3
    video_url = _generate_presigned_url(getattr(i, 'video_url', None))
    candidate_id_url = _generate_presigned_url(getattr(i, 'candidate_id_url', None))
    violation_screenshot = _resolve_violation_screenshots(getattr(i, 'violation_screenshot', None))
    
    return {
        "id":                   str(i.id),
        "user_id":              str(i.user_id),
        "interview_name":       getattr(i, "interview_name", None) or f"{i.job_role} Interview",
        "interviewer_name":     getattr(i, "interviewer_name", None),
        "candidate_name":       i.candidate_name,
        "candidate_email":      i.candidate_email,
        "candidate_experience": i.candidate_experience,
        "job_role":             i.job_role,
        "job_role_id":          str(i.job_role_id) if getattr(i, "job_role_id", None) else None,
        "department_id":        str(i.department_id) if getattr(i, "department_id", None) else None,
        "department":           getattr(i, "department", None),
        "skill_tags":           getattr(i, "skill_tags", []) or [],
        "difficulty_level":     getattr(i, "difficulty_level", "Medium") or "Medium",
        "question_count":       getattr(i, "question_count", 5) if getattr(i, "question_count", None) is not None else 5,
        "coding_count":         getattr(i, "coding_count", 2) if getattr(i, "coding_count", None) is not None else 2,
        "interview_stage":      getattr(i, "interview_stage", "Screening") or "Screening",
        "seniority_level":      getattr(i, "seniority_level", "Mid") or "Mid",
        "experience_min":       getattr(i, "experience_min", 2) if getattr(i, "experience_min", None) is not None else 2,
        "experience_max":       getattr(i, "experience_max", 5) if getattr(i, "experience_max", None) is not None else 5,
        "interview_language":   getattr(i, "interview_language", "English") or "English",
        "link_expiry_days":     getattr(i, "link_expiry_days", 7) if getattr(i, "link_expiry_days", None) is not None else 7,
        "invite_expires_at":    i.invite_expires_at.isoformat() if getattr(i, "invite_expires_at", None) else None,
        "require_camera":       getattr(i, "require_camera", True) if getattr(i, "require_camera", None) is not None else True,
        "detect_tab_switch":    getattr(i, "detect_tab_switch", True) if getattr(i, "detect_tab_switch", None) is not None else True,
        "block_copy_paste":     getattr(i, "block_copy_paste", True) if getattr(i, "block_copy_paste", None) is not None else True,
        "max_retake_attempts":  getattr(i, "max_retake_attempts", 1) if getattr(i, "max_retake_attempts", None) is not None else 1,
        "status":               i.status,
        "current_round":        i.current_round,
        "overall_score":        i.overall_score,
        "technical_score":      i.technical_score,
        "coding_score":         i.coding_score,
        "behavioral_score":     i.behavioral_score,
        "ai_recommendation":    i.ai_recommendation,
        "duration_seconds":     i.duration_seconds,
        "invite_token":         i.invite_token,
        "short_code":           getattr(i, "short_code", None),
        "jd_file_path":         i.jd_file_path,
        "video_url":            video_url,
        "compliance_accepted":  getattr(i, "compliance_accepted", False),
        "candidate_id_url":     candidate_id_url,
        "violation_screenshot": violation_screenshot,
        "structured_memory":    getattr(i, "structured_memory", {}),
        "save_video_recording": getattr(i, "save_video_recording", False),
        "show_candidate_video": getattr(i, "show_candidate_video", True),
        "duration_minutes":     getattr(i, "duration_minutes", 30),
        "started_at":           i.started_at.isoformat() if getattr(i, "started_at", None) else None,
        "proctoring_strikes":   getattr(i, "proctoring_strikes", {"mobile": 0, "multi_person": 0, "gaze": 0}),
        "manager_id":           str(i.manager_id) if getattr(i, "manager_id", None) else None,
        "recruiter_id":         str(i.recruiter_id) if getattr(i, "recruiter_id", None) else None,
        "candidate_id":         str(i.candidate_id) if getattr(i, "candidate_id", None) else None,
        "created_by":           str(i.created_by) if getattr(i, "created_by", None) else None,
        "created_at":           i.created_at.isoformat() if i.created_at else None,
        "updated_at":           i.updated_at.isoformat() if i.updated_at else None,
        "is_multi_candidate":   getattr(i, "is_multi_candidate", False),
        "proctoring_enabled":   getattr(i, "proctoring_enabled", True),
        "proctoring_max_strikes": getattr(i, "proctoring_max_strikes", 3),
        "proctoring_score_cutoff": getattr(i, "proctoring_score_cutoff", 70),
        "proctoring_max_strikes_action": getattr(i, "proctoring_max_strikes_action", "flag_review"),
        "proctoring_cutoff_action": getattr(i, "proctoring_cutoff_action", "manual_review"),
        "evaluation_score_cutoff": getattr(i, "evaluation_score_cutoff", 60),
        "evaluation_cutoff_action": getattr(i, "evaluation_cutoff_action", "manual_review"),
        "evaluation_rubric":       getattr(i, "evaluation_rubric", None),
        "available_from":       i.available_from.isoformat() if getattr(i, "available_from", None) else None,
        "available_until":      i.available_until.isoformat() if getattr(i, "available_until", None) else None,
        "timezone":             getattr(i, "timezone", "Asia/Kolkata") or "Asia/Kolkata",
        "grace_period_minutes": getattr(i, "grace_period_minutes", 0) or 0,
        "actual_started_at":    i.actual_started_at.isoformat() if getattr(i, "actual_started_at", None) else None,
        "access_status":        check_access_status(i, i),
        "server_time":          datetime.now(timezone.utc).isoformat()
    }

def _execution_context_to_dict(execution_obj: Any, template_obj: Interview) -> Dict[str, Any]:
    """
    Serializes the blended state of an execution object (Interview or InterviewSession)
    and its template (Interview).
    """
    if isinstance(execution_obj, Interview):
        return _interview_to_dict(execution_obj)

    # Blend InterviewSession (execution) and Interview (template)
    session = execution_obj
    template = template_obj
    
    video_url = _generate_presigned_url(getattr(session, 'video_url', None))
    # We map session_token as the unified invite_token
    
    return {
        "id":                   str(session.id),
        "user_id":              str(template.user_id),
        "candidate_name":       getattr(session.candidate, "candidate_name", None) if getattr(session, "candidate", None) else "",
        "candidate_email":      getattr(session.candidate, "candidate_email", None) if getattr(session, "candidate", None) else "",
        "candidate_experience": template.candidate_experience,
        "job_role":             template.job_role,
        "status":               session.status,
        "current_round":        getattr(session, "current_round", template.current_round),
        "overall_score":        session.overall_score,
        "technical_score":      session.technical_score,
        "coding_score":         getattr(session, "coding_score", None),
        "behavioral_score":     session.communication_score, # Mapped to comm score
        "ai_recommendation":    session.ai_recommendation,
        "duration_seconds":     0, # We can parse session.interview_duration if needed
        "invite_token":         session.session_token,
        "short_code":           template.short_code,
        "jd_file_path":         template.jd_file_path,
        "video_url":            video_url,
        "compliance_accepted":  True, # Assuming verified
        "candidate_id_url":     _generate_presigned_url(getattr(session, "candidate_id_url", None)),
        "violation_screenshot": _resolve_violation_screenshots(getattr(session, "violation_screenshot", None)),
        "structured_memory":    session.structured_memory,
        "answers":              getattr(session, "answers", {}),
        "save_video_recording": template.save_video_recording,
        "show_candidate_video": template.show_candidate_video,
        "duration_minutes":     template.duration_minutes,
        "started_at":           session.started_at.isoformat() if session.started_at else None,
        "proctoring_strikes":   session.proctoring_alerts,
        "manager_id":           str(template.manager_id) if template.manager_id else None,
        "recruiter_id":         str(template.recruiter_id) if template.recruiter_id else None,
        "candidate_id":         str(session.candidate_id),
        "created_by":           str(template.created_by) if template.created_by else None,
        "created_at":           session.created_at.isoformat() if session.created_at else None,
        "updated_at":           session.updated_at.isoformat() if session.updated_at else None,
        "is_multi_candidate":   True,
        "proctoring_enabled":   getattr(template, "proctoring_enabled", True),
        "proctoring_max_strikes": getattr(template, "proctoring_max_strikes", 3),
        "proctoring_score_cutoff": getattr(template, "proctoring_score_cutoff", 70),
        "proctoring_max_strikes_action": getattr(template, "proctoring_max_strikes_action", "flag_review"),
        "proctoring_cutoff_action": getattr(template, "proctoring_cutoff_action", "manual_review"),
        "evaluation_score_cutoff": getattr(template, "evaluation_score_cutoff", 60),
        "evaluation_cutoff_action": getattr(template, "evaluation_cutoff_action", "manual_review"),
        "evaluation_rubric":       getattr(template, "evaluation_rubric", None),
        "current_question_index": session.current_question_index,
        "available_from":       template.available_from.isoformat() if getattr(template, "available_from", None) else None,
        "available_until":      template.available_until.isoformat() if getattr(template, "available_until", None) else None,
        "timezone":             getattr(template, "timezone", "Asia/Kolkata") or "Asia/Kolkata",
        "grace_period_minutes": getattr(template, "grace_period_minutes", 0) or 0,
        "actual_started_at":    session.started_at.isoformat() if getattr(session, "started_at", None) else None,
        "access_status":        check_access_status(session, template),
        "server_time":          datetime.now(timezone.utc).isoformat()
    }


def check_access_status(execution_obj, template_obj) -> str:
    # 1. If explicitly completed/submitted
    status = execution_obj.status
    if status in ("completed", "flagged", "selected", "rejected"):
        return "ALREADY_COMPLETED"

    # 2. If legitimately started and actual_started_at/started_at exists
    started_at = getattr(execution_obj, "actual_started_at", None) or getattr(execution_obj, "started_at", None)
    if started_at:
        return "AVAILABLE"

    # 3. If current server UTC time is before available_from
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    
    available_from = getattr(template_obj, "available_from", None)
    if available_from:
        if available_from.tzinfo is None:
            available_from = available_from.replace(tzinfo=timezone.utc)
        if now < available_from:
            return "NOT_YET_AVAILABLE"

    # 4. If current server UTC time is after available_until
    available_until = getattr(template_obj, "available_until", None)
    if available_until:
        if available_until.tzinfo is None:
            available_until = available_until.replace(tzinfo=timezone.utc)
        if now > available_until:
            return "EXPIRED"

    # 5. Otherwise
    return "AVAILABLE"


def raise_access_blocked_exception(code: str, template_obj, extra_detail: dict = None):
    from datetime import datetime, timezone
    from fastapi import HTTPException, status
    
    available_from_str = template_obj.available_from.isoformat() if getattr(template_obj, "available_from", None) else None
    available_until_str = template_obj.available_until.isoformat() if getattr(template_obj, "available_until", None) else None
    timezone_str = "Asia/Kolkata"
    server_time_str = datetime.now(timezone.utc).isoformat()
    
    if code == "NOT_YET_AVAILABLE":
        message = "Interview is not yet available."
        status_code = status.HTTP_403_FORBIDDEN
    elif code == "EXPIRED":
        message = "This interview link has expired."
        status_code = status.HTTP_403_FORBIDDEN
    elif code == "ALREADY_COMPLETED":
        message = "This interview has already been completed."
        status_code = status.HTTP_403_FORBIDDEN
    else:
        message = "This interview is no longer accessible."
        status_code = status.HTTP_403_FORBIDDEN

    payload = {
        "code": code,
        "message": message,
        "available_from": available_from_str,
        "available_until": available_until_str,
        "timezone": timezone_str,
        "server_time": server_time_str
    }
    if extra_detail and isinstance(extra_detail, dict):
        payload.update(extra_detail)

    raise HTTPException(
        status_code=status_code,
        detail=payload
    )


async def resolve_interview_context(db: AsyncSession, token: str):
    """
    Resolves the provided token into an execution context.
    Returns (execution_obj, template_obj).
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from models import Interview, InterviewSession

    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        # 1. Try resolving as multi-candidate session (eager-load candidate to avoid DetachedInstanceError)
        res = await db.execute(
            select(InterviewSession)
            .options(selectinload(InterviewSession.candidate))
            .where(InterviewSession.session_token == token)
        )
        session = res.scalar_one_or_none()
        
        if session:
            res2 = await db.execute(select(Interview).where(Interview.id == session.interview_id))
            template = res2.scalar_one_or_none()
            if not template:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview template not found for session.")
            db.info["tenant_id"] = str(template.tenant_id)
            return session, template

        # 2. Try resolving as single-candidate or legacy interview
        res3 = await db.execute(select(Interview).where(Interview.invite_token == token))
        interview = res3.scalar_one_or_none()
        
        if interview:
            db.info["tenant_id"] = str(interview.tenant_id)
            return interview, interview
        
        # 3. Fallback to short_code lookup
        res4 = await db.execute(select(Interview).where(Interview.short_code == token))
        interview_by_short = res4.scalar_one_or_none()
        if interview_by_short:
            db.info["tenant_id"] = str(interview_by_short.tenant_id)
            return interview_by_short, interview_by_short

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired interview token.")
    except HTTPException:
        db.info["tenant_id"] = _old_tenant
        raise
    except Exception:
        db.info["tenant_id"] = _old_tenant
        raise

def _message_to_dict(m: InterviewMessage) -> Dict[str, Any]:
    return {
        "id":           str(m.id),
        "interview_id": str(m.interview_id),
        "question_id":  str(m.question_id) if getattr(m, "question_id", None) else None,
        "role":         m.role,
        "content":      m.content,
        "round":        m.round,
        "metadata":     m.metadata_ or {},
        "created_at":   m.created_at.isoformat() if m.created_at else None,
    }


def _question_to_dict(q: InterviewQuestion) -> Dict[str, Any]:
    return {
        "id":               str(q.id),
        "interview_id":     str(q.interview_id),
        "question_text":    q.question_text,
        "question_type":    q.question_type,
        "difficulty":       q.difficulty,
        "selected":         q.selected,
        "candidate_answer": q.candidate_answer,
        "ai_score":         q.ai_score,
        "ai_feedback":      q.ai_feedback,
        "ideal_answer":     q.ideal_answer,
        "rubric":           q.rubric,
        "order_index":      q.order_index,
        "source":           getattr(q, "source", "generated"),
        "original_text":    getattr(q, "original_text", None),
        "edited_at":        q.edited_at.isoformat() if getattr(q, "edited_at", None) else None,
        "created_at":       q.created_at.isoformat() if q.created_at else None,
    }


import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def _coding_question_to_dict(cq: CodingQuestion) -> Dict[str, Any]:
    # ... (existing function content)
    return {
        "id":             str(cq.id),
        "interview_id":   str(cq.interview_id),
        "title":          cq.title,
        "difficulty":     cq.difficulty,
        "description":    cq.description,
        "examples":       cq.examples or [],
        "constraints":    cq.constraints or [],
        "hints":          cq.hints or [],
        "starter_code":   cq.starter_code or {},
        "test_cases":     cq.test_cases or [],
        "order_index":    cq.order_index,
        "created_at":     cq.created_at.isoformat() if cq.created_at else None,
    }

async def send_onboarding_email(email: str, role: str, tenant_name: str, password: str = "Admin@123"):
    """
    Sends an onboarding email.
    If SMTP is configured in .env, it sends a real email.
    Otherwise, it logs the simulation to the console.
    """
    resolved_name = tenant_name
    from database import AsyncSessionLocal
    from email_service import get_clean_company_name_async
    from sqlalchemy import select
    from models import Tenant
    
    try:
        async with AsyncSessionLocal() as db_session:
            res_t = await db_session.execute(select(Tenant).where(Tenant.name == tenant_name))
            tenant = res_t.scalar_one_or_none()
            if tenant:
                resolved_name = await get_clean_company_name_async(db_session, tenant)
    except Exception as e:
        log.error(f"Error resolving tenant name for onboarding email: {e}")

    subject = f"Welcome to {resolved_name} on Xeviewer"
    body = f"""
    Hello,
    
    You have been added to the {resolved_name} organization on Xeviewer as a {role.capitalize()}.
    
    You can log in to your account at {settings.AI_INTERVIEW_BASE_URL}/auth using the following credentials:
    
    Email: {email}
    Password: {password}
    
    IMPORTANT: For security reasons, please change your password immediately after your first login.
    
    Best regards,
    The Xeviewer Team
    """
    
    # 1. Log simulation (Always do this for debug visibility)
    log.info(f"\n" + "="*50)
    log.info(f"📧 ONBOARDING EMAIL TRIGGERED")
    log.info(f"To:      {email}")
    log.info(f"Subject: {subject}")
    log.info("="*50 + "\n")

    # 2. Try real SMTP if configured
    if settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASS:
        try:
            from email_service import send_interview_email
            from database import AsyncSessionLocal
            async with AsyncSessionLocal() as db_session:
                res = await send_interview_email(
                    to=email,
                    subject=subject,
                    body=body,
                    tenant_name=tenant_name,
                    db=db_session
                )
            if res["success"]:
                log.info(f"✅ REAL EMAIL SENT TO {email}")
                return True
            else:
                log.error(f"❌ Failed to send real email: {res['error']}")
                return False
        except Exception as e:
            log.error(f"❌ Failed to send real email: {e}")
            return False
    else:
        log.warning("⚠️ SMTP settings missing in .env. Falling back to console simulation only.")
        log.info(f"SIMULATED BODY:\n{body}")
        return True

async def send_password_reset_email(db, email: str, token: str):
    """Sends a password reset link to the user."""
    subject = "Reset your Xeviewer Password"
    reset_link = f"{settings.FRONTEND_ORIGIN}/reset-password?token={token}"
    
    body = f"""
    Hello,
    
    We received a request to reset your password for your Xeviewer account.
    
    Click the link below to set a new password:
    {reset_link}
    
    This link will expire in 1 hour. 
    
    If you did not request this, please ignore this email.
    
    Best regards,
    The Xeviewer Team
    """
    
    # Simulation log
    log.info(f"\n" + "="*50)
    log.info(f"📧 PASSWORD RESET EMAIL TRIGGERED")
    log.info(f"To:      {email}")
    log.info(f"Subject: {subject}")
    log.info("="*50 + "\n")

    if settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASS:
        try:
            # Resolve user/tenant details for branding
            tenant_name = None
            user_name = None
            user_id = None
            tenant_id = None
            try:
                from sqlalchemy import select
                from sqlalchemy.orm import selectinload
                from models import User, Membership
                res = await db.execute(select(User).where(User.email == email))
                user = res.scalar_one_or_none()
                if user:
                    user_name = user.full_name
                    user_id = user.id
                    
                    m_res = await db.execute(
                        select(Membership).where(Membership.user_id == user.id).options(selectinload(Membership.tenant))
                    )
                    m = m_res.scalars().first()
                    if m and m.tenant:
                        tenant_name = m.tenant.name
                        tenant_id = m.tenant_id
            except Exception as e:
                log.error(f"Error resolving user/tenant for password reset: {e}")

            from email_service import send_interview_email
            res = await send_interview_email(
                to=email,
                subject=subject,
                body=body,
                db=db,
                user_id=user_id,
                tenant_id=tenant_id,
                user_name=user_name,
                tenant_name=tenant_name
            )
            if res["success"]:
                log.info(f"✅ RESET EMAIL SENT TO {email}")
                return True
            else:
                log.error(f"❌ Failed to send reset email: {res['error']}")
                return False
        except Exception as e:
            log.error(f"❌ Failed to send reset email: {e}")
            return False
    else:
        log.warning("⚠️ SMTP settings missing. Check simulation log for link.")
        log.info(f"SIMULATED BODY:\n{body}")
        return True

import secrets
import string

def generate_base62_short_code(length: int = 7) -> str:
    """Generates a secure random Base62 short code of specified length."""
    alphabet = string.ascii_letters + string.digits  # A-Za-z0-9
    return "".join(secrets.choice(alphabet) for _ in range(length))

