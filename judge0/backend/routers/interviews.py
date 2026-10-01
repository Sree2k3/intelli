import uuid
import os
import boto3
from botocore.client import Config
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status, Header, File, UploadFile, Form
from sqlalchemy import and_, or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import User, Interview, InterviewCreate, InterviewUpdate, InterviewMessage, Membership, RoleMaster, DepartmentMaster
from auth import get_current_user
from config import settings
from utils import _interview_to_dict, _message_to_dict, _generate_presigned_url
from logging_config import logger as log
from auth_rbac import get_user_context, UserContext, Role, Permission, require_permission, require_role

router = APIRouter(prefix="/api/rest/v1", tags=["Interviews"])

from pydantic import BaseModel
from urllib.parse import urlparse

class PresignedUrlRequest(BaseModel):
    s3_url: str

class EmailPayload(BaseModel):
    to: str
    subject: str
    body: str
    invite_expires_at: Optional[str] = None  # ISO datetime string of link expiry
    cc: Optional[List[str]] = []
    bcc: Optional[List[str]] = []

@router.post("/interviews/presigned-url")
async def get_playback_presigned_url(request: PresignedUrlRequest):
    try:
        # Check if already a presigned URL to prevent double-signing
        url_lower = request.s3_url.lower()
        if "signature=" in url_lower or "x-amz-signature=" in url_lower or "awsaccesskeyid=" in url_lower:
            return {"presigned_url": request.s3_url}

        from utils import get_s3_client, _generate_presigned_url, parse_s3_key
        presigned_url = _generate_presigned_url(request.s3_url)
        if presigned_url == request.s3_url:
            object_key = parse_s3_key(request.s3_url)
            if not object_key:
                parsed_url = urlparse(request.s3_url)
                object_key = parsed_url.path.lstrip('/')
                if settings.S3_BUCKET_NAME:
                    bucket_prefix = f"{settings.S3_BUCKET_NAME}/"
                    if object_key.startswith(bucket_prefix):
                        object_key = object_key[len(bucket_prefix):]
            s3_client = get_s3_client()
            if s3_client and object_key:
                presigned_url = s3_client.generate_presigned_url(
                    'get_object',
                    Params={
                        'Bucket': settings.S3_BUCKET_NAME,
                        'Key': object_key
                    },
                    ExpiresIn=settings.S3_PRESIGNED_EXPIRY
                )
        return {"presigned_url": presigned_url}
    except Exception as e:
        return {"error": str(e)}
async def is_manager_authorized(db: AsyncSession, tenant_id: Any, manager_id: Any, recruiter_id: Any) -> bool:
    if not recruiter_id:
        return False
    try:
        r_id = uuid.UUID(str(recruiter_id))
        m_id = uuid.UUID(str(manager_id))
        t_id = uuid.UUID(str(tenant_id))
    except (ValueError, TypeError):
        return False
        
    if m_id == r_id:
        return True
        
    res = await db.execute(
        select(Membership.user_id)
        .where(Membership.tenant_id == t_id)
        .where(Membership.manager_id == m_id)
        .where(Membership.user_id == r_id)
    )
    return res.scalar() is not None

@router.get("/interviews")
async def list_interviews(
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """List all interviews within the tenant, filtered by role."""
    if not ctx.tenant_id:
        return []

    # Admin: all in tenant. Recruiter: only own. Manager: reporting recruiters & own.
    query = select(Interview).where(Interview.tenant_id == ctx.tenant_id)
    if ctx.role == Role.RECRUITER:
        query = query.where(Interview.recruiter_id == ctx.user.id)
    elif ctx.role == Role.MANAGER:
        rec_ids_subquery = select(Membership.user_id).where(
            and_(Membership.manager_id == ctx.user.id, Membership.tenant_id == ctx.tenant_id)
        )
        query = query.where(or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery)))
    
    result = await db.execute(query.order_by(Interview.created_at.desc()))
    return [_interview_to_dict(i) for i in result.scalars().all()]

@router.get("/interviews/{interview_id}/details")
async def get_interview_details(
    interview_id: str,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db),
):
    """Get complete details for an interview configuration, including candidate summary and list."""
    if not ctx.tenant_id:
        raise HTTPException(400, "Tenant context missing")

    try:
        i_id = uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(422, "Invalid interview_id format")

    from models import User
    res = await db.execute(
        select(Interview, User.full_name.label("recruiter_name")).outerjoin(
            User, Interview.recruiter_id == User.id
        ).where(
            and_(Interview.id == i_id, Interview.tenant_id == ctx.tenant_id)
        )
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "Interview not found")
        
    interview, recruiter_name = row

    if ctx.role == Role.RECRUITER and interview.recruiter_id != ctx.user.id:
        raise HTTPException(403, "Not authorized to view this interview")

    info = {
        "id": str(interview.id),
        "job_role": interview.job_role,
        "created_at": interview.created_at.isoformat() if interview.created_at else None,
        "status": interview.status,
        "is_multi_candidate": interview.is_multi_candidate,
        "invite_token": interview.invite_token,
        "short_code": interview.short_code,
        "passing_score": interview.evaluation_score_cutoff,
        "duration_minutes": interview.duration_minutes,
        "proctoring_enabled": getattr(interview, "proctoring_enabled", True),
        "proctoring_max_strikes": interview.proctoring_max_strikes,
        "available_from": interview.available_from.isoformat() if getattr(interview, "available_from", None) else None,
        "available_until": interview.available_until.isoformat() if getattr(interview, "available_until", None) else None,
        "timezone": interview.timezone,
        "save_video_recording": getattr(interview, "save_video_recording", False),
        "show_candidate_video": getattr(interview, "show_candidate_video", True),
        "recruiter_name": recruiter_name or "Unknown",
    }

    from models import InterviewSession, InterviewCandidate, InterviewQuestion, CodingQuestion

    tech_count = await db.scalar(
        select(func.count(InterviewQuestion.id)).where(
            and_(InterviewQuestion.interview_id == i_id, InterviewQuestion.question_type == 'technical', InterviewQuestion.selected == True)
        )
    )
    behav_count = await db.scalar(
        select(func.count(InterviewQuestion.id)).where(
            and_(InterviewQuestion.interview_id == i_id, InterviewQuestion.question_type == 'behavioral', InterviewQuestion.selected == True)
        )
    )
    code_count = await db.scalar(
        select(func.count(CodingQuestion.id)).where(CodingQuestion.interview_id == i_id)
    )
    
    info["technical_questions_count"] = tech_count or 0
    info["behavioral_questions_count"] = behav_count or 0
    info["coding_questions_count"] = code_count or 0

    if interview.is_multi_candidate:
        sessions_res = await db.execute(
            select(
                InterviewSession,
                InterviewCandidate.candidate_name,
                InterviewCandidate.candidate_email
            ).outerjoin(
                InterviewCandidate, InterviewSession.candidate_id == InterviewCandidate.id
            ).where(
                InterviewSession.interview_id == i_id
            )
        )
        session_rows = sessions_res.all()

        candidates = []
        for sess, c_name, c_email in session_rows:
            candidates.append({
                "id": str(sess.id),
                "name": c_name or c_email or "Unknown",
                "email": c_email,
                "status": sess.status,
                "score": sess.overall_score,
                "created_at": sess.created_at.isoformat() if sess.created_at else None,
                "view_result_id": str(sess.id),
                "video_url": sess.video_url
            })
            
        pending_res = await db.execute(
            select(InterviewCandidate).where(
                and_(
                    InterviewCandidate.interview_id == i_id,
                    InterviewCandidate.session_id == None
                )
            )
        )
        for cand in pending_res.scalars().all():
            candidates.append({
                "id": str(cand.id),
                "name": cand.candidate_name or cand.candidate_email or "Unknown",
                "email": cand.candidate_email,
                "status": cand.invitation_status,
                "score": None,
                "created_at": cand.invited_at.isoformat() if cand.invited_at else None,
                "view_result_id": None,
                "video_url": None
            })
    else:
        candidates = [{
            "id": str(interview.id),
            "name": interview.candidate_name or interview.candidate_email or "Unknown",
            "email": interview.candidate_email,
            "status": interview.status,
            "score": interview.overall_score,
            "created_at": interview.created_at.isoformat() if interview.created_at else None,
            "view_result_id": str(interview.id),
            "video_url": interview.video_url
        }]

    summary = {
        "total_invited": sum(1 for c in candidates if c["status"] not in ["failed", "pending"]),
        "failed_invites": sum(1 for c in candidates if c["status"] == "failed"),
        "pending": sum(1 for c in candidates if c["status"] == "pending"),
        "started": sum(1 for c in candidates if c["status"] == "in_progress"),
        "completed": sum(1 for c in candidates if c["status"] in ["completed", "selected", "rejected", "flagged"]),
        "passed": sum(1 for c in candidates if c["score"] is not None and c["score"] >= interview.evaluation_score_cutoff),
        "failed": sum(1 for c in candidates if c["score"] is not None and c["score"] < interview.evaluation_score_cutoff),
        "flagged": sum(1 for c in candidates if c["status"] == "flagged"),
    }

    # Accurately synchronize interview status with candidate evaluation lifecycle
    if interview.is_multi_candidate and candidates:
        non_failed_cands = [c for c in candidates if c["status"] != "failed"]
        if non_failed_cands:
            all_completed = all(c["status"] in ("completed", "selected", "rejected", "flagged") for c in non_failed_cands)
            any_in_progress = any(c["status"] == "in_progress" for c in non_failed_cands)
            all_pending = all(c["status"] in ("pending", "sent") for c in non_failed_cands)

            if all_completed:
                if len(non_failed_cands) == 1:
                    info["status"] = non_failed_cands[0]["status"]
                else:
                    info["status"] = "completed"
            elif any_in_progress:
                info["status"] = "in_progress"
            elif all_pending:
                info["status"] = "pending"
            else:
                info["status"] = "in_progress"
        else:
            info["status"] = "pending"

        # Persist updated status to interview row in DB
        if interview.status != info["status"]:
            interview.status = info["status"]
            try:
                await db.commit()
            except Exception as e:
                log.warning(f"Could not persist interview status sync: {e}")

    return {
        "info": info,
        "summary": summary,
        "candidates": sorted(candidates, key=lambda x: x["created_at"] or "", reverse=True)
    }


@router.get("/roles-master")
async def get_roles_master_endpoint(
    db: AsyncSession = Depends(get_db),
):
    """Retrieve all available roles from the master catalog."""
    res = await db.execute(select(RoleMaster).order_by(RoleMaster.name.asc()))
    roles = res.scalars().all()
    return [{"id": str(r.id), "name": r.name, "department": r.department} for r in roles]


@router.get("/departments-master")
async def get_departments_master_endpoint(
    db: AsyncSession = Depends(get_db),
):
    """Retrieve all available departments from the master catalog."""
    res = await db.execute(select(DepartmentMaster).order_by(DepartmentMaster.name.asc()))
    depts = res.scalars().all()
    return [{"id": str(d.id), "name": d.name} for d in depts]


@router.post("/interviews", status_code=201)
async def create_interview_endpoint(
    body: InterviewCreate,
    ctx: UserContext = Depends(require_permission(Permission.CREATE_INTERVIEW)),
    db: AsyncSession = Depends(get_db),
):
    """Create a new interview record within the user's tenant."""
    if not ctx.tenant_id:
        raise HTTPException(400, "User must belong to a tenant to create interviews")

    # Check interview limit
    from models import Tenant
    res = await db.execute(select(Tenant.interview_limit).where(Tenant.id == ctx.tenant_id))
    limit = res.scalar() or 100
    
    count_res = await db.execute(select(func.count(Interview.id)).where(Interview.tenant_id == ctx.tenant_id))
    current_count = count_res.scalar() or 0
    
    # if current_count >= limit:
    #     raise HTTPException(status_code=403, detail="Interview limit reached for this workspace. Please contact your administrator to upgrade.")

    from utils import generate_base62_short_code
    
    # Generate unique short code
    short_code = None
    for _ in range(10):
        code = generate_base62_short_code()
        existing = await db.execute(select(Interview.id).where(Interview.short_code == code))
        if not existing.scalar_one_or_none():
            short_code = code
            break
            
    if not short_code:
        raise HTTPException(status_code=500, detail="Failed to generate a unique short code")

    invite_token = body.invite_token or str(uuid.uuid4())
    interview_name = (body.interview_name or "").strip() or f"{body.job_role} Interview"
    interviewer_name = (body.interviewer_name or "").strip() or (ctx.user.full_name or ctx.user.email or "Interviewer").strip()

    job_role_id = None
    if body.job_role_id:
        try:
            job_role_id = uuid.UUID(str(body.job_role_id))
        except Exception:
            job_role_id = None

    department_id = None
    if body.department_id:
        try:
            department_id = uuid.UUID(str(body.department_id))
        except Exception:
            department_id = None

    link_expiry_days = body.link_expiry_days if body.link_expiry_days is not None else 7
    from datetime import datetime, timezone, timedelta
    invite_expires_at = datetime.now(timezone.utc) + timedelta(days=link_expiry_days)

    interview = Interview(
        user_id=ctx.user.id,
        tenant_id=ctx.tenant_id,
        interview_name=interview_name,
        interviewer_name=interviewer_name,
        manager_id=ctx.user.id if ctx.role == Role.MANAGER else ctx.manager_id,
        recruiter_id=ctx.user.id,
        created_by=ctx.user.id,
        candidate_id=uuid.uuid4(),
        candidate_name=body.candidate_name or "",
        candidate_email=body.candidate_email,
        candidate_experience=body.candidate_experience,
        job_role=body.job_role,
        job_role_id=job_role_id,
        department_id=department_id,
        department=body.department,
        skill_tags=body.skill_tags or [],
        difficulty_level=body.difficulty_level or "Medium",
        question_count=body.question_count if body.question_count is not None else 5,
        coding_count=body.coding_count if body.coding_count is not None else 2,
        interview_stage=body.interview_stage or "Screening",
        seniority_level=body.seniority_level or "Mid",
        experience_min=body.experience_min if body.experience_min is not None else 2,
        experience_max=body.experience_max if body.experience_max is not None else 5,
        interview_language=body.interview_language or "English",
        link_expiry_days=link_expiry_days,
        invite_expires_at=invite_expires_at,
        require_camera=body.require_camera if body.require_camera is not None else True,
        detect_tab_switch=body.detect_tab_switch if body.detect_tab_switch is not None else True,
        block_copy_paste=body.block_copy_paste if body.block_copy_paste is not None else True,
        max_retake_attempts=body.max_retake_attempts if body.max_retake_attempts is not None else 1,
        invite_token=invite_token,
        short_code=short_code,
        jd_file_path=body.jd_file_path,
        save_video_recording=body.save_video_recording or False,
        show_candidate_video=body.show_candidate_video if body.show_candidate_video is not None else True,
        duration_minutes=body.duration_minutes if body.duration_minutes is not None else 30,
        status="pending",
        current_round=getattr(body, "current_round", None) or "behavioral",
        is_multi_candidate=body.is_multi_candidate or False,
        proctoring_enabled=body.proctoring_enabled if body.proctoring_enabled is not None else True,
        proctoring_max_strikes=body.proctoring_max_strikes if body.proctoring_max_strikes is not None else 3,
        proctoring_score_cutoff=body.proctoring_score_cutoff if body.proctoring_score_cutoff is not None else 70,
        proctoring_max_strikes_action=body.proctoring_max_strikes_action or "flag_review",
        proctoring_cutoff_action=body.proctoring_cutoff_action or "manual_review",
        evaluation_score_cutoff=body.evaluation_score_cutoff if body.evaluation_score_cutoff is not None else 60,
        evaluation_cutoff_action=body.evaluation_cutoff_action or "manual_review",
        evaluation_rubric=body.evaluation_rubric,
        available_from=body.available_from,
        available_until=body.available_until,
        timezone=body.timezone or "Asia/Kolkata",
        grace_period_minutes=body.grace_period_minutes or 0,
    )
    db.add(interview)
    await db.commit()
    await db.refresh(interview)
    
    log.info(f"Interview created: {interview.id} for {interview.candidate_name} in tenant {ctx.tenant_id}")
    return _interview_to_dict(interview)


# NOTE: /by-token/{token} routes MUST be declared before /{interview_id}
# to prevent FastAPI's top-down pattern matching from treating "by-token"
# as a literal interview_id value, which causes 405 Method Not Allowed errors.

@router.get("/interviews/by-token/{token}")
async def get_interview_by_token(token: str, db: AsyncSession = Depends(get_db)):
    """Public access via invite token or session token (Candidate flow)."""
    from utils import resolve_interview_context, _execution_context_to_dict
    
    try:
        execution_obj, template_obj = await resolve_interview_context(db, token)
    except HTTPException as e:
        raise e

    from utils import check_access_status, raise_access_blocked_exception
    access_status = check_access_status(execution_obj, template_obj)
    if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
        c_cand = getattr(execution_obj, "candidate", None)
        c_name = getattr(execution_obj, "candidate_name", None) or (c_cand.candidate_name if c_cand else None)
        c_email = getattr(execution_obj, "candidate_email", None) or (c_cand.candidate_email if c_cand else None)
        completed_at_dt = getattr(execution_obj, "completed_at", None)
        raise_access_blocked_exception(
            access_status,
            template_obj,
            extra_detail={
                "candidate_name": c_name,
                "candidate_email": c_email,
                "job_role": getattr(template_obj, "job_role", None) or getattr(template_obj, "title", None),
                "completed_at": completed_at_dt.isoformat() if completed_at_dt else None,
            }
        )

    return _execution_context_to_dict(execution_obj, template_obj)

@router.get("/interviews/by-short-code/{short_code}")
async def get_interview_by_short_code(short_code: str, db: AsyncSession = Depends(get_db)):
    """Public access via base62 short code (Candidate flow)."""
    from utils import resolve_interview_context, _execution_context_to_dict
    
    try:
        execution_obj, template_obj = await resolve_interview_context(db, short_code)
    except HTTPException as e:
        raise e

    from utils import check_access_status, raise_access_blocked_exception
    access_status = check_access_status(execution_obj, template_obj)
    if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
        c_cand = getattr(execution_obj, "candidate", None)
        c_name = getattr(execution_obj, "candidate_name", None) or (c_cand.candidate_name if c_cand else None)
        c_email = getattr(execution_obj, "candidate_email", None) or (c_cand.candidate_email if c_cand else None)
        completed_at_dt = getattr(execution_obj, "completed_at", None)
        raise_access_blocked_exception(
            access_status,
            template_obj,
            extra_detail={
                "candidate_name": c_name,
                "candidate_email": c_email,
                "job_role": getattr(template_obj, "job_role", None) or getattr(template_obj, "title", None),
                "completed_at": completed_at_dt.isoformat() if completed_at_dt else None,
            }
        )

    return _execution_context_to_dict(execution_obj, template_obj)

@router.patch("/interviews/by-token/{token}")
async def update_interview_by_token(
    token: str,
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
):
    """Candidate update restricted fields via invite token."""
    from utils import resolve_interview_context, _execution_context_to_dict
    from models import InterviewSession
    try:
        execution_obj, template_obj = await resolve_interview_context(db, token)
    except HTTPException as e:
        raise e

    from utils import check_access_status, raise_access_blocked_exception
    access_status = check_access_status(execution_obj, template_obj)
    if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
        raise_access_blocked_exception(access_status, template_obj)

    # If the interview is already completed/flagged/cancelled/canceled, deny core updates
    # (Allowing idempotent status updates and late telemetry like strikes/screenshots)
    requested_status = body.get("status")
    if execution_obj.status not in ("pending", "in_progress"):
        if requested_status and requested_status != execution_obj.status:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This interview has already been {execution_obj.status} and cannot be modified."
            )
            
        allowed_late_fields = {"status", "proctoring_strikes", "violation_screenshot"}
        if not all(k in allowed_late_fields for k in body.keys()):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Cannot modify interview data after it is {execution_obj.status}."
            )

    # Prevent candidates from "restarting" a completed interview
    if execution_obj.status == "completed" and body.get("status") in ("pending", "in_progress"):
        log.warning(f"!!! Candidate attempted to restart completed interview {execution_obj.id}")
        raise HTTPException(403, "This interview has already been completed and cannot be restarted.")

    # Validation: Ensure candidate email matches invited email
    if "candidate_email" in body:
        incoming_email = body["candidate_email"]
        if incoming_email is not None:
            incoming_clean = str(incoming_email).strip().lower()
            invited_clean = ""
            if isinstance(execution_obj, InterviewSession) and execution_obj.candidate:
                invited_clean = execution_obj.candidate.candidate_email.strip().lower()
            if invited_clean and incoming_clean != invited_clean:
                raise HTTPException(
                    status_code=400,
                    detail="Entered email does not match the invited email address."
                )

    # Ignore actual_started_at and started_at from frontend payloads
    body.pop("actual_started_at", None)
    body.pop("started_at", None)

    # Candidate-safe fields only
    safe_fields = {"status", "candidate_name", "candidate_email", "candidate_experience", "compliance_accepted", "proctoring_strikes", "violation_screenshot", "current_round"}
    
    # Validate candidate_experience if provided
    if "candidate_experience" in body:
        exp_val = body["candidate_experience"]
        if exp_val is not None:
            exp_str = str(exp_val).strip()
            if not exp_str.isdigit() or int(exp_str) < 0:
                raise HTTPException(status_code=400, detail="Experience must be a non-negative integer (e.g., 3)")

    # If starting for the first time, mark started_at
    if body.get("status") == "in_progress":
        started_already = getattr(execution_obj, "actual_started_at", None) or getattr(execution_obj, "started_at", None)
        if not started_already:
            from datetime import datetime, timezone
            now_time = datetime.now(timezone.utc)
            execution_obj.started_at = now_time
            if hasattr(execution_obj, "actual_started_at"):
                execution_obj.actual_started_at = now_time
            log.info(f"Interview {execution_obj.id} started at {now_time}")

    for field, value in body.items():
        if field in safe_fields:
            if field in ("candidate_name", "candidate_email"):
                if isinstance(execution_obj, InterviewSession):
                    if execution_obj.candidate:
                        setattr(execution_obj.candidate, field, value)
                else:
                    setattr(execution_obj, field, value)
            elif field == "proctoring_strikes":
                if getattr(template_obj, "proctoring_enabled", True):
                    max_strikes = getattr(template_obj, "proctoring_max_strikes", 3)
                    curr_existing = execution_obj.proctoring_alerts if isinstance(execution_obj, InterviewSession) else getattr(execution_obj, "proctoring_strikes", {})
                    curr_total = sum(v for k, v in (curr_existing or {}).items() if k != "backend" and isinstance(v, (int, float)))
                    if curr_total >= max_strikes:
                        # Already reached max strikes: system stops recording additional strikes
                        pass
                    else:
                        incoming_total = sum(v for k, v in value.items() if k != "backend" and isinstance(v, (int, float)))
                        if incoming_total > max_strikes:
                            excess = incoming_total - max_strikes
                            capped_value = dict(value)
                            for cat in ["gaze", "mobile", "multi_person"]:
                                if cat in capped_value and isinstance(capped_value[cat], int) and capped_value[cat] > 0 and excess > 0:
                                    deduct = min(excess, capped_value[cat])
                                    capped_value[cat] -= deduct
                                    excess -= deduct
                            value = capped_value

                        if isinstance(execution_obj, InterviewSession):
                            execution_obj.proctoring_alerts = value
                        else:
                            execution_obj.proctoring_strikes = value

                        new_total = sum(v for k, v in value.items() if k != "backend" and isinstance(v, (int, float)))
                        if new_total >= max_strikes:
                            action = getattr(template_obj, "proctoring_max_strikes_action", "flag_review")
                            if action == "auto_terminate":
                                execution_obj.status = "flagged"
                            else:
                                mem = dict(execution_obj.structured_memory) if execution_obj.structured_memory else {}
                                mem["proctoring_max_strikes_reached"] = True
                                execution_obj.structured_memory = mem
                else:
                    if isinstance(execution_obj, InterviewSession):
                        execution_obj.proctoring_alerts = value
                    else:
                        execution_obj.proctoring_strikes = value
            else:
                setattr(execution_obj, field, value)

    await db.commit()
    await db.refresh(execution_obj)
    return _execution_context_to_dict(execution_obj, template_obj)


@router.post("/interviews/by-token/{token}/upload-id")
async def upload_id_image(
    token: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Securely upload and link candidate ID image."""
    from utils import resolve_interview_context
    try:
        execution_obj, template_obj = await resolve_interview_context(db, token)
    except HTTPException as e:
        raise e

    try:
        file_ext = os.path.splitext(file.filename)[1]
        filename = f"{execution_obj.id}_id{file_ext}"
        
        # Read the file content
        file_content = await file.read()

        use_s3 = settings.STORAGE_MODE == "s3"
        if use_s3:
            try:
                s3_key = f"ids/{filename}"
                
                # Initialize S3 client with credentials from settings
                from utils import get_s3_client
                s3_client = get_s3_client()
                if not s3_client:
                    raise Exception("S3 client init failed")
                
                # Upload to S3
                s3_client.put_object(
                    Bucket=settings.S3_BUCKET_NAME,
                    Key=s3_key,
                    Body=file_content,
                    ContentType=file.content_type
                )
                    
                # Generate the public S3 URL
                public_url = f"https://{settings.S3_BUCKET_NAME}.s3.{settings.AWS_REGION}.amazonaws.com/{s3_key}"
                execution_obj.candidate_id_url = public_url
                await db.commit()
                await db.refresh(execution_obj)
                
                # Return presigned URL for immediate frontend display
                presigned_url = _generate_presigned_url(public_url)
                log.info(f"ID image uploaded to S3 for interview {execution_obj.id}: {public_url}")
                return {"success": True, "candidate_id_url": presigned_url}
            except Exception as e:
                log.warning(f"S3 upload failed for ID image, falling back to local storage: {e}")
                use_s3 = False
        
        if not use_s3:
            # Fallback to local storage
            upload_dir = os.path.join("uploads", "ids")
            os.makedirs(upload_dir, exist_ok=True)
            local_path = os.path.join(upload_dir, filename)
            
            with open(local_path, "wb") as f:
                f.write(file_content)
            
            public_url = f"/uploads/ids/{filename}"
            execution_obj.candidate_id_url = public_url
            await db.commit()
            await db.refresh(execution_obj)
            
            log.info(f"ID image saved locally for interview {execution_obj.id}: {public_url}")
            return {"success": True, "candidate_id_url": public_url}

    except Exception as e:
        log.error(f"Failed to upload ID image for {execution_obj.id}: {e}")
        raise HTTPException(500, f"Upload failed: {str(e)}")


@router.post("/interviews/by-token/{token}/upload-screenshot")
async def upload_violation_screenshot(
    token: str,
    file: UploadFile = File(...),
    timestamp: Optional[str] = Form(None),
    reason: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db)
):
    """Securely upload and link proctoring violation screenshot."""
    from utils import resolve_interview_context
    try:
        execution_obj, template_obj = await resolve_interview_context(db, token)
    except HTTPException as e:
        raise e

    try:
        import json
        file_ext = os.path.splitext(file.filename)[1] or ".jpg"
        # Generate a unique filename using a short UUID fragment so we preserve multiple distinct snapshots
        unique_id = uuid.uuid4().hex[:6]
        filename = f"{execution_obj.id}_{unique_id}_violation{file_ext}"
        
        # Read the file content
        file_content = await file.read()

        # Parse existing violation screenshots list
        existing_val = getattr(execution_obj, "violation_screenshot", None)
        existing_list = []
        if existing_val:
            val_str = str(existing_val).strip()
            if val_str.startswith("["):
                try:
                    existing_list = json.loads(val_str)
                    if not isinstance(existing_list, list):
                        existing_list = [existing_val]
                except Exception:
                    existing_list = [existing_val]
            else:
                existing_list = [existing_val]

        max_strikes = getattr(template_obj, "proctoring_max_strikes", 3)
        max_evidence = max(max_strikes, 10)
        if len(existing_list) >= max_evidence:
            log.info(f"Violation screenshot limit reached ({max_evidence}) for interview {execution_obj.id}, ignoring extra upload.")
            return {"success": True, "message": f"Maximum evidence limit ({max_evidence}) reached."}

        use_s3 = settings.STORAGE_MODE == "s3"
        if use_s3:
            try:
                s3_key = f"screenshots/{filename}"
                
                # Initialize S3 client with credentials from settings
                from utils import get_s3_client
                s3_client = get_s3_client()
                if not s3_client:
                    raise Exception("S3 client init failed")
                
                # Upload to S3
                s3_client.put_object(
                    Bucket=settings.S3_BUCKET_NAME,
                    Key=s3_key,
                    Body=file_content,
                    ContentType=file.content_type or "image/jpeg"
                )
                    
                # Generate the public S3 URL
                public_url = f"https://{settings.S3_BUCKET_NAME}.s3.{settings.AWS_REGION}.amazonaws.com/{s3_key}"
                screenshot_data = {"url": public_url, "timestamp": timestamp, "reason": reason} if timestamp or reason else public_url
                existing_list.append(screenshot_data)
                execution_obj.violation_screenshot = json.dumps(existing_list)
                await db.commit()
                await db.refresh(execution_obj)
                
                # Return presigned URL for immediate frontend display
                presigned_url = _generate_presigned_url(public_url)
                log.info(f"Violation screenshot uploaded to S3 for interview {execution_obj.id}: {public_url}")
                return {"success": True, "violation_screenshot": presigned_url}
            except Exception as e:
                log.warning(f"S3 upload failed for screenshot, falling back to local storage: {e}")
                use_s3 = False
        
        if not use_s3:
            # Fallback to local storage
            upload_dir = os.path.join("uploads", "screenshots")
            os.makedirs(upload_dir, exist_ok=True)
            local_path = os.path.join(upload_dir, filename)
            
            with open(local_path, "wb") as f:
                f.write(file_content)
            
            # Use a relative URL for local storage
            public_url = f"/uploads/screenshots/{filename}"
            screenshot_data = {"url": public_url, "timestamp": timestamp, "reason": reason} if timestamp or reason else public_url
            existing_list.append(screenshot_data)
            execution_obj.violation_screenshot = json.dumps(existing_list)
            await db.commit()
            await db.refresh(execution_obj)
            
            log.info(f"Violation screenshot saved locally for interview {execution_obj.id}: {public_url}")
            return {"success": True, "violation_screenshot": public_url}

    except Exception as e:
        log.error(f"Failed to upload violation screenshot for {execution_obj.id}: {e}")
        raise HTTPException(500, f"Upload failed: {str(e)}")


@router.post("/interviews/by-token/{token}/initiate-upload")
async def initiate_multipart_upload(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Initiate AWS S3 Multipart Upload.
    Returns the UploadId required for all subsequent part uploads.
    This must be called once when the interview starts.
    """
    # Direct S3 upload disabled from frontend to bypass CORS constraints and route uploads through backend.
    return {
        "upload_id": "DISABLED",
        "s3_key": "DISABLED",
        "bucket": "DISABLED",
        "message": "Direct S3 upload disabled, routing via backend"
    }


@router.get("/interviews/by-token/{token}/upload-url")
async def get_candidate_upload_url(
    token: str,
    part_number: Optional[int] = Query(None),
    filename: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate presigned URL for AWS S3 Multipart Upload.
    
    NEW (Multipart Upload): Uses s3.upload_part
      - Query param: ?part_number=1
      - Must call /initiate-upload first
      - Returns upload_part presigned URL
    
    LEGACY (Single upload): Uses s3.put_object (deprecated)
      - Query param: ?filename=chunk_0.webm
      - For backwards compatibility only
    """
    from utils import resolve_interview_context
    try:
        execution_obj, template_obj = await resolve_interview_context(db, token)
    except HTTPException as e:
        raise e

    if not getattr(template_obj, "save_video_recording", False) or settings.STORAGE_MODE != "s3" or execution_obj.s3_upload_id == "DISABLED":
        raise HTTPException(400, "S3 recording is disabled or not configured.")

    try:
        aws_region = settings.AWS_REGION or "ap-south-2"
        from utils import get_s3_client
        s3_client = get_s3_client()
        if not s3_client:
            raise Exception("S3 client init failed")

        # NEW: Multipart Upload with upload_part
        if part_number is not None:
            if not execution_obj.s3_upload_id:
                raise HTTPException(400, "Multipart upload not initiated. Call /initiate-upload first.")

            s3_key = f"interviews/{execution_obj.id}/video.webm"

            # Generate presigned URL for upload_part (NOT put_object)
            presigned_url = s3_client.generate_presigned_url(
                "upload_part",
                Params={
                    "Bucket": settings.S3_BUCKET_NAME,
                    "Key": s3_key,
                    "UploadId": execution_obj.s3_upload_id,
                    "PartNumber": part_number
                },
                ExpiresIn=settings.S3_PRESIGNED_EXPIRY or 3600,
            )

            return {
                "url": presigned_url,
                "upload_id": execution_obj.s3_upload_id,
                "part_number": part_number,
                "s3_key": s3_key
            }

        # LEGACY: Single file upload (backwards compatibility)
        elif filename is not None:
            log.warning(f"Legacy put_object upload requested for {execution_obj.id}. Use multipart upload instead.")
            s3_key = f"interviews/{execution_obj.id}/chunks/{filename}"

            presigned_url = s3_client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": settings.S3_BUCKET_NAME,
                    "Key": s3_key,
                    "ContentType": "video/webm"
                },
                ExpiresIn=settings.S3_PRESIGNED_EXPIRY or 3600,
            )

            return {"url": presigned_url, "key": s3_key}

        else:
            raise HTTPException(400, "Must provide either part_number or filename query parameter")

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Failed to generate presigned URL: {e}")
        raise HTTPException(500, f"Failed to generate presigned URL: {str(e)}")



@router.post("/interviews/by-token/{token}/complete-upload")
async def complete_multipart_upload(
    token: str,
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db)
):
    """
    Complete the AWS S3 Multipart Upload.
    
    Expected body:
    {
        "parts": [
            {"PartNumber": 1, "ETag": "abc123..."},
            {"PartNumber": 2, "ETag": "def456..."},
            ...
        ]
    }
    
    AWS will stitch all parts together into a single video.webm file.
    Returns the final video_url for database storage.
    """
    from utils import resolve_interview_context
    try:
        execution_obj, template_obj = await resolve_interview_context(db, token)
    except HTTPException as e:
        raise e

    if not getattr(template_obj, "save_video_recording", False) or settings.STORAGE_MODE != "s3" or execution_obj.s3_upload_id == "DISABLED":
        return {"status": "skipped", "message": "S3 Recording disabled"}

    if not execution_obj.s3_upload_id:
        raise HTTPException(400, "No active multipart upload. Call /initiate-upload first.")

    parts = body.get("parts", [])
    if not parts:
        raise HTTPException(400, "No parts provided for upload completion")

    try:
        aws_region = settings.AWS_REGION or "ap-south-2"
        from utils import get_s3_client
        s3_client = get_s3_client()
        if not s3_client:
            raise Exception("S3 client init failed")

        s3_key = f"interviews/{execution_obj.id}/video.webm"

        # Complete the multipart upload with AWS
        # CRITICAL: AWS requires Parts to be sorted by PartNumber
        part_etags = sorted(
            [
                {
                    "PartNumber": p["PartNumber"],
                    "ETag": p["ETag"]
                }
                for p in parts
            ],
            key=lambda x: x["PartNumber"]
        )

        response = s3_client.complete_multipart_upload(
            Bucket=settings.S3_BUCKET_NAME,
            Key=s3_key,
            UploadId=execution_obj.s3_upload_id,
            MultipartUpload={"Parts": part_etags}
        )

        log.info(f"Multipart upload completed: {execution_obj.id} -> {s3_key}")

        # Update interview with final video URL (Constructed as requested)
        # Format: https://[bucket].s3.[region].amazonaws.com/[key]
        public_url = f"https://{settings.S3_BUCKET_NAME}.s3.{aws_region}.amazonaws.com/{s3_key}"
        
        execution_obj.video_url = public_url
        execution_obj.s3_upload_id = None  # Clear upload ID after completion
        if template_obj and str(template_obj.id) != str(execution_obj.id):
            template_obj.video_url = public_url
        await db.commit()
        await db.refresh(execution_obj)

        log.info(f"Interview {execution_obj.id} video finalized: {execution_obj.video_url}")

        return {
            "success": True,
            "video_url": _generate_presigned_url(execution_obj.video_url),
            "s3_key": s3_key,
            "message": "Video upload completed successfully"
        }

    except Exception as e:
        log.error(f"Failed to complete multipart upload for {interview.id}: {e}")
        raise HTTPException(500, f"Upload completion failed: {str(e)}")


@router.post("/interviews/by-token/{token}/upload-video")
async def upload_candidate_video_fallback(
    token: str,
    video: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Fallback endpoint for direct video upload when S3 multipart is disabled."""
    from utils import resolve_interview_context, get_s3_client
    try:
        execution_obj, template_obj = await resolve_interview_context(db, token)
        
        if not getattr(template_obj, "save_video_recording", False):
            return {"success": True, "message": "Recording disabled"}

        video_content = await video.read()
        try:
            from webm_fixer import fix_webm_stream
            video_content = fix_webm_stream(video_content)
        except Exception as fe:
            log.warning(f"Failed to fix uploaded WebM stream: {fe}")

        filename = f"{execution_obj.id}_recording.webm"
        s3_key = f"interviews/{execution_obj.id}/video.webm"
        
        use_s3 = settings.STORAGE_MODE == "s3"
        
        if use_s3:
            try:
                s3_client = get_s3_client()
                if not s3_client:
                    raise Exception("S3 client init failed")
                
                # Upload to S3
                s3_client.put_object(
                    Bucket=settings.S3_BUCKET_NAME,
                    Key=s3_key,
                    Body=video_content,
                    ContentType="video/webm"
                )
                
                aws_region = settings.AWS_REGION or "ap-south-2"
                public_url = f"https://{settings.S3_BUCKET_NAME}.s3.{aws_region}.amazonaws.com/{s3_key}"
                execution_obj.video_url = public_url
                if template_obj and str(template_obj.id) != str(execution_obj.id):
                    template_obj.video_url = public_url
                await db.commit()
                
                log.info(f"Video uploaded to S3 via fallback for interview {execution_obj.id}: {public_url}")
                return {"success": True, "video_url": public_url}
            except Exception as e:
                log.warning(f"S3 upload failed for video fallback, falling back to local storage: {e}")
                use_s3 = False
        
        if not use_s3:
            # Fallback to local storage
            upload_dir = os.path.join("uploads", "videos")
            os.makedirs(upload_dir, exist_ok=True)
            local_path = os.path.join(upload_dir, filename)
            
            with open(local_path, "wb") as f:
                f.write(video_content)
            
            public_url = f"/uploads/videos/{filename}"
            execution_obj.video_url = public_url
            if template_obj and str(template_obj.id) != str(execution_obj.id):
                template_obj.video_url = public_url
            await db.commit()
            return {"success": True, "video_url": public_url}

    except Exception as e:
        log.error(f"Failed to upload video for {token}: {e}")
        raise HTTPException(500, f"Upload failed: {str(e)}")


# 🟢 Generic {interview_id} routes — must remain AFTER all /by-token/ routes 🟢──

@router.get("/interviews/{interview_id}")
async def get_interview_endpoint(
    interview_id: str,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Get interview details with tenant and role security."""
    import uuid
    import traceback
    from models import InterviewSession
    from sqlalchemy.orm import selectinload
    from utils import _execution_context_to_dict
    try:
        try:
            obj_uuid = uuid.UUID(interview_id)
        except ValueError:
            raise HTTPException(400, "Invalid interview/session ID format")

        _old_tenant = db.info.get("tenant_id")
        db.info["tenant_id"] = None
        try:
            # 1. Try InterviewSession first (multi-candidate)
            try:
                session_res = await db.execute(
                    select(InterviewSession)
                    .options(selectinload(InterviewSession.candidate))
                    .where(InterviewSession.id == obj_uuid)
                )
                session = session_res.scalar_one_or_none()
            except Exception as db_err:
                log.exception(f"Database query failed for InterviewSession {obj_uuid}")
                raise HTTPException(status_code=500, detail=f"Database error loading interview session: {str(db_err)}")

            if session:
                try:
                    result = await db.execute(select(Interview).where(Interview.id == session.interview_id))
                    interview = result.scalar_one_or_none()
                except Exception as db_err:
                    log.exception(f"Database query failed for parent Interview of session {obj_uuid}")
                    raise HTTPException(status_code=500, detail=f"Database error loading parent interview: {str(db_err)}")
                    
                if not interview:
                    raise HTTPException(404, "Parent interview not found")
                
                # Tenant & Ownership Security
                is_authorized = (
                    ctx.role == Role.SUPER_ADMIN or
                    interview.user_id == ctx.user.id or
                    (ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id))
                )
                if not is_authorized:
                    raise HTTPException(403, "Unauthorized")
                
                if ctx.role == Role.RECRUITER and interview.recruiter_id != ctx.user.id and interview.user_id != ctx.user.id:
                    raise HTTPException(403, "Recruiters can only view their own interviews")
                
                return _execution_context_to_dict(session, interview)

            # 1.5. Try InterviewCandidate (pending invited candidate)
            try:
                from models import InterviewCandidate
                cand_res = await db.execute(select(InterviewCandidate).where(InterviewCandidate.id == obj_uuid))
                candidate = cand_res.scalar_one_or_none()
                if candidate:
                    result = await db.execute(select(Interview).where(Interview.id == candidate.interview_id))
                    interview = result.scalar_one_or_none()
                    if not interview:
                        raise HTTPException(404, "Parent interview not found")
                    
                    is_authorized = (
                        ctx.role == Role.SUPER_ADMIN or
                        interview.user_id == ctx.user.id or
                        (ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id))
                    )
                    if not is_authorized:
                        raise HTTPException(403, "Unauthorized")
                    
                    if ctx.role == Role.RECRUITER and interview.recruiter_id != ctx.user.id and interview.user_id != ctx.user.id:
                        raise HTTPException(403, "Recruiters can only view their own interviews")
                    
                    cand_data = _interview_to_dict(interview)
                    cand_data["id"] = str(candidate.id)
                    cand_data["candidate_name"] = candidate.candidate_name or interview.candidate_name
                    cand_data["candidate_email"] = candidate.candidate_email or interview.candidate_email
                    cand_data["status"] = candidate.invitation_status or "pending"
                    return cand_data
            except HTTPException:
                raise
            except Exception as cand_err:
                log.warning(f"Error checking InterviewCandidate {obj_uuid}: {cand_err}")

            # 2. Fallback to template Interview (single-candidate)
            try:
                result = await db.execute(select(Interview).where(Interview.id == obj_uuid))
                interview = result.scalar_one_or_none()
            except Exception as db_err:
                log.exception(f"Database query failed for template Interview {obj_uuid}")
                raise HTTPException(status_code=500, detail=f"Database error loading interview template: {str(db_err)}")
            
            if not interview:
                raise HTTPException(404, "Interview not found")
            
            # Tenant & Ownership Security
            is_authorized = (
                ctx.role == Role.SUPER_ADMIN or
                interview.user_id == ctx.user.id or
                (ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id))
            )
            if not is_authorized:
                raise HTTPException(403, "Unauthorized")
            
            if ctx.role == Role.RECRUITER and interview.recruiter_id != ctx.user.id and interview.user_id != ctx.user.id:
                raise HTTPException(403, "Recruiters can only view their own interviews")
            
            return _interview_to_dict(interview)
        finally:
            db.info["tenant_id"] = _old_tenant

    except HTTPException as he:
        raise he
    except Exception as e:
        tb = traceback.format_exc()
        log.error(f"Failed to get interview {interview_id}: {e}. Traceback:\n{tb}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@router.patch("/interviews/{interview_id}")
async def update_interview_endpoint(
    interview_id: str,
    body: InterviewUpdate,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Update interview fields with tenant security."""
    import uuid
    try:
        obj_uuid = uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(400, "Invalid interview id")

    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        result = await db.execute(select(Interview).where(Interview.id == obj_uuid))
        interview = result.scalar_one_or_none()
        
        if not interview:
            raise HTTPException(404, "Interview not found")

        # Tenant & Ownership Security
        is_authorized = (
            ctx.role == Role.SUPER_ADMIN or
            interview.user_id == ctx.user.id or
            (ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id))
        )
        if not is_authorized:
            raise HTTPException(403, "Unauthorized")
        
        # Role-based Ownership
        if ctx.role == Role.RECRUITER and interview.recruiter_id != ctx.user.id and interview.user_id != ctx.user.id:
            raise HTTPException(403, "Recruiters can only update their own interviews")
        if ctx.role == Role.MANAGER:
            authorized = await is_manager_authorized(db, ctx.tenant_id, ctx.user.id, interview.recruiter_id)
            if not authorized and interview.manager_id != ctx.user.id and interview.user_id != ctx.user.id:
                raise HTTPException(403, "Managers can only update their reporting recruiters' interviews")

        for field, value in body.model_dump(exclude_unset=True).items():
            if field in ("job_role_id", "department_id") and value:
                try:
                    value = uuid.UUID(str(value))
                except Exception:
                    value = None
            if field == "link_expiry_days" and value is not None:
                from datetime import datetime, timezone, timedelta
                setattr(interview, "invite_expires_at", datetime.now(timezone.utc) + timedelta(days=int(value)))
            setattr(interview, field, value)

        await db.commit()
        await db.refresh(interview)
        log.info(f"Interview updated: {interview.id}")
        return _interview_to_dict(interview)
    finally:
        db.info["tenant_id"] = _old_tenant


@router.delete("/interviews/{interview_id}")
async def delete_interview_endpoint(
    interview_id: str,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Delete an interview, candidate, or interview session and its associated resources with tenant isolation."""
    try:
        i_id = uuid.UUID(str(interview_id).strip())
    except ValueError:
        raise HTTPException(400, "Invalid interview id")

    from models import InterviewSession, InterviewCandidate

    # Helper function for media cleanup
    async def cleanup_media(video_url: Optional[str], candidate_id_url: Optional[str]):
        if video_url:
            if (video_url.startswith("s3://") or ".amazonaws.com/" in video_url) and settings.STORAGE_MODE == "s3":
                try:
                    from utils import get_s3_client, parse_s3_key
                    s3_key = parse_s3_key(video_url)
                    s3_client = get_s3_client()
                    if s3_client:
                        s3_client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
                except Exception as e:
                    log.error(f"S3 video delete failed: {e}")
            else:
                rel_path = video_url.lstrip("/")
                local_path = os.path.join(os.getcwd(), rel_path)
                if os.path.exists(local_path):
                    try: os.remove(local_path)
                    except: pass

        if candidate_id_url:
            if (candidate_id_url.startswith("s3://") or ".amazonaws.com/" in candidate_id_url) and settings.STORAGE_MODE == "s3":
                try:
                    from utils import get_s3_client, parse_s3_key
                    s3_key = parse_s3_key(candidate_id_url)
                    s3_client = get_s3_client()
                    if s3_client:
                        s3_client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
                except Exception: pass
            else:
                rel_path = candidate_id_url.lstrip("/")
                local_path = os.path.join(os.getcwd(), rel_path)
                if os.path.exists(local_path):
                    try: os.remove(local_path)
                    except: pass

    # Helper for checking tenant and RBAC permission on an interview
    async def verify_permissions(target_interview: Interview):
        if ctx.role != Role.SUPER_ADMIN and ctx.tenant_id and str(target_interview.tenant_id) != str(ctx.tenant_id):
            raise HTTPException(403, "Unauthorized")
        effective_recruiter_id = target_interview.recruiter_id or target_interview.user_id or target_interview.created_by
        if ctx.role == Role.RECRUITER and effective_recruiter_id != ctx.user.id:
            raise HTTPException(403, "Recruiters can only delete their own interviews")
        if ctx.role == Role.MANAGER:
            authorized = await is_manager_authorized(db, ctx.tenant_id, ctx.user.id, effective_recruiter_id)
            if not authorized and target_interview.manager_id != ctx.user.id:
                raise HTTPException(403, "Managers can only delete their reporting recruiters' interviews")

    # Helper to re-evaluate parent interview status
    async def sync_parent_status(parent_id: uuid.UUID):
        parent_res = await db.execute(select(Interview).where(Interview.id == parent_id))
        parent = parent_res.scalar_one_or_none()
        if not parent or not parent.is_multi_candidate:
            return

        sess_statuses_res = await db.execute(
            select(InterviewSession.status).where(InterviewSession.interview_id == parent_id)
        )
        sess_statuses = sess_statuses_res.scalars().all()

        cand_statuses_res = await db.execute(
            select(InterviewCandidate.invitation_status).where(
                and_(
                    InterviewCandidate.interview_id == parent_id,
                    InterviewCandidate.session_id == None
                )
            )
        )
        cand_statuses = cand_statuses_res.scalars().all()

        all_statuses = list(sess_statuses) + list(cand_statuses)
        if not all_statuses:
            parent.status = "pending"
        elif any(s == "in_progress" for s in all_statuses):
            parent.status = "in_progress"
        elif all(s in ["completed", "selected", "rejected", "flagged"] for s in all_statuses):
            if len(all_statuses) == 1:
                parent.status = all_statuses[0]
            else:
                parent.status = "completed"
        else:
            parent.status = "pending"

    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        # 1. Try finding as a multi-candidate InterviewSession first
        result_session = await db.execute(
            select(InterviewSession).where(InterviewSession.id == i_id)
        )
        session = result_session.scalar_one_or_none()

        if session:
            result_parent = await db.execute(
                select(Interview).where(Interview.id == session.interview_id)
            )
            interview = result_parent.scalar_one_or_none()
            if not interview:
                raise HTTPException(404, "Parent interview template not found")

            await verify_permissions(interview)
            await cleanup_media(session.video_url, session.candidate_id_url)

            candidate = await db.get(InterviewCandidate, session.candidate_id)
            if candidate:
                candidate.session_id = None
                await db.flush()
                await db.delete(candidate)
            else:
                await db.delete(session)

            await sync_parent_status(interview.id)
            await db.commit()
            log.info(f"Interview session deleted: {interview_id} by user {ctx.user.id}")
            return {"message": "Candidate profile deleted successfully"}

        # 2. Try finding as an InterviewCandidate (e.g. pending candidate invitation)
        result_candidate = await db.execute(
            select(InterviewCandidate).where(InterviewCandidate.id == i_id)
        )
        candidate = result_candidate.scalar_one_or_none()

        if candidate:
            result_parent = await db.execute(
                select(Interview).where(Interview.id == candidate.interview_id)
            )
            interview = result_parent.scalar_one_or_none()
            if not interview:
                raise HTTPException(404, "Parent interview template not found")

            await verify_permissions(interview)

            # Clean up any sessions and associated media for this candidate
            cand_sessions_res = await db.execute(
                select(InterviewSession).where(
                    or_(
                        InterviewSession.candidate_id == candidate.id,
                        InterviewSession.id == candidate.session_id
                    )
                )
            )
            for s in cand_sessions_res.scalars().all():
                await cleanup_media(s.video_url, s.candidate_id_url)
                await db.delete(s)

            candidate.session_id = None
            await db.flush()
            await db.delete(candidate)

            await sync_parent_status(interview.id)
            await db.commit()
            log.info(f"Interview candidate deleted: {interview_id} by user {ctx.user.id}")
            return {"message": "Candidate profile deleted successfully"}

        # 3. Fallback to standard Interview (single-candidate or parent template) deletion
        result = await db.execute(
            select(Interview).where(Interview.id == i_id)
        )
        interview = result.scalar_one_or_none()
        
        if not interview:
            raise HTTPException(404, "Interview not found")

        await verify_permissions(interview)

        # Clean up media for all sessions belonging to this interview
        interview_sessions_res = await db.execute(
            select(InterviewSession).where(InterviewSession.interview_id == interview.id)
        )
        for s in interview_sessions_res.scalars().all():
            await cleanup_media(s.video_url, s.candidate_id_url)

        await cleanup_media(interview.video_url, getattr(interview, 'candidate_id_url', None))

        await db.delete(interview)
        await db.commit()
        log.info(f"Interview deleted: {interview_id} by user {ctx.user.id}")
        return {"message": "Interview deleted successfully"}
    finally:
        db.info["tenant_id"] = _old_tenant


@router.get("/interview_messages")
async def list_messages(
    interview_id: str = Query(...),
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """List messages with tenant security."""
    import uuid
    from models import InterviewSession
    
    try:
        obj_uuid = uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(400, "Invalid ID format")

    # 1. Try InterviewSession first (multi-candidate)
    session_res = await db.execute(
        select(InterviewSession).where(InterviewSession.id == obj_uuid)
    )
    session = session_res.scalar_one_or_none()

    if session:
        r = await db.execute(
            select(Interview).where(Interview.id == session.interview_id)
        )
        interview = r.scalar_one_or_none()
        if not interview:
            raise HTTPException(404, "Not found")

        if str(interview.tenant_id) != str(ctx.tenant_id):
            raise HTTPException(403, "Forbidden")
        
        if ctx.role == Role.RECRUITER and interview.recruiter_id != ctx.user.id:
            raise HTTPException(403, "Forbidden")
        
        return session.chat_history or []

    # 2. Fallback to template Interview
    r = await db.execute(
        select(Interview).where(Interview.id == obj_uuid)
    )
    interview = r.scalar_one_or_none()
    if not interview:
        raise HTTPException(404, "Not found")

    if str(interview.tenant_id) != str(ctx.tenant_id):
        raise HTTPException(403, "Forbidden")
    
    if ctx.role == Role.RECRUITER and interview.recruiter_id != ctx.user.id:
        raise HTTPException(403, "Forbidden")
    if ctx.role == Role.MANAGER:
        authorized = await is_manager_authorized(db, ctx.tenant_id, ctx.user.id, interview.recruiter_id)
        if not authorized:
            raise HTTPException(403, "Forbidden")

    result = await db.execute(
        select(InterviewMessage)
        .where(InterviewMessage.interview_id == obj_uuid)
        .order_by(InterviewMessage.created_at)
    )
    return [_message_to_dict(m) for m in result.scalars().all()]


@router.post("/interviews/{interview_id}/send-email")
async def send_interview_email_endpoint(
    interview_id: str,
    payload: EmailPayload,
    db: AsyncSession = Depends(get_db),
    ctx: UserContext = Depends(require_permission(Permission.CREATE_INTERVIEW))
):
    try:
        from email_service import send_interview_email
        from datetime import datetime, timezone
        from models import InterviewCandidate

        res = await send_interview_email(
            to=payload.to,
            subject=payload.subject,
            body=payload.body,
            cc=payload.cc,
            bcc=payload.bcc,
            db=db,
            user_id=ctx.user.id,
            tenant_id=ctx.tenant_id,
            interview_id=interview_id
        )

        # Keep InterviewCandidate invitation_status synchronized
        try:
            from uuid import UUID
            i_uuid = UUID(interview_id)
            c_res = await db.execute(
                select(InterviewCandidate).where(
                    and_(
                        InterviewCandidate.interview_id == i_uuid,
                        InterviewCandidate.candidate_email == payload.to.strip().lower()
                    )
                )
            )
            cand = c_res.scalar_one_or_none()
            if cand:
                cand.invitation_status = "sent" if res.get("success") else "failed"
                if res.get("success"):
                    cand.last_invited_at = datetime.now(timezone.utc)
                    cand.invite_count += 1
                await db.commit()
        except Exception as cand_sync_err:
            log.warning(f"Could not sync candidate invitation status: {cand_sync_err}")

        if not res.get("success"):
            err_msg = res.get("error") or "Failed to send email invitation"
            raise HTTPException(status_code=500, detail=f"Failed to send email invitation: {err_msg}")
        return {"message": "Email sent successfully"}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error sending email: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/interviews/{interview_id}/video-url")
async def get_video_url(
    interview_id: str,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Fetch video URL with RBAC enforcement."""
    import uuid
    from models import InterviewSession
    from sqlalchemy.orm import selectinload
    try:
        obj_uuid = uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid interview/session ID format")

    # 1. Try InterviewSession first (multi-candidate)
    session_res = await db.execute(
        select(InterviewSession)
        .options(selectinload(InterviewSession.interview))
        .where(InterviewSession.id == obj_uuid)
    )
    session = session_res.scalar_one_or_none()

    if session:
        interview = session.interview
        video_url = session.video_url
    else:
        # 2. Fallback to template Interview
        result = await db.execute(select(Interview).where(Interview.id == obj_uuid))
        interview = result.scalar_one_or_none()
        video_url = interview.video_url if interview else None
        if not video_url and interview:
            sess_query2 = (
                select(InterviewSession.video_url)
                .where(InterviewSession.interview_id == interview.id, InterviewSession.video_url.is_not(None))
                .order_by(InterviewSession.created_at.desc())
            )
            sess_res2 = await db.execute(sess_query2)
            video_url = sess_res2.scalars().first()
    
    if not interview:
        raise HTTPException(status_code=404, detail="Interview/Session not found")
    
    # Tenant Security
    if str(interview.tenant_id) != str(ctx.tenant_id):
        raise HTTPException(403, "Unauthorized")
    
    # Recruiters can only view their own
    if ctx.role == Role.RECRUITER and interview.recruiter_id != ctx.user.id:
         raise HTTPException(403, "Recruiters can only view their own interview recordings")
    if ctx.role == Role.MANAGER:
        authorized = await is_manager_authorized(db, ctx.tenant_id, ctx.user.id, interview.recruiter_id)
        if not authorized:
             raise HTTPException(403, "Managers can only view their reporting recruiters' interview recordings")
    if not video_url:
        raise HTTPException(404, "No recording available for this interview/session")

    # S3-stored video: generate a presigned URL
    # Support both legacy s3:// and new public https URLs
    if (video_url.startswith("s3://") or ".amazonaws.com/" in video_url) and settings.STORAGE_MODE == "s3":
        try:
            # Let boto3 automatically inherit IAM role credentials
            aws_region = settings.AWS_REGION or "ap-south-2"
            from utils import get_s3_client, parse_s3_key
            s3_key = parse_s3_key(video_url)
            s3_client = get_s3_client()
            if not s3_client:
                raise Exception("S3 client init failed")
            presigned_url = s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.S3_BUCKET_NAME, "Key": s3_key},
                ExpiresIn=settings.S3_PRESIGNED_EXPIRY,
            )
            return {"url": presigned_url, "type": "s3"}
        except Exception as e:
            log.error(f"Presigned URL generation failed: {e}")
            raise HTTPException(500, f"Failed to generate video URL: {str(e)}")

    # Local file: return path directly (served by StaticFiles middleware)
    return {"url": video_url, "type": "local"}


from pydantic import BaseModel

class CandidateAddRequest(BaseModel):
    email: str
    name: Optional[str] = None

class CandidateResendRequest(BaseModel):
    email: str
    subject: str
    body: str

class CandidateRevokeRequest(BaseModel):
    email: str
    is_revoked: bool

class VerifyEmailRequest(BaseModel):
    email: str

@router.get("/interviews/{interview_id}/candidates")
async def get_interview_candidates(
    interview_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: UserContext = Depends(require_permission(Permission.CREATE_INTERVIEW))
):
    try:
        from uuid import UUID
        from models import InterviewCandidate, InterviewSession
        i_uuid = UUID(interview_id)
        
        _old_tenant = db.info.get("tenant_id")
        db.info["tenant_id"] = None
        try:
            # Verify interview exists and user has access
            res = await db.execute(select(Interview).where(Interview.id == i_uuid))
            interview = res.scalar_one_or_none()
            if not interview:
                raise HTTPException(404, "Interview not found")
            if ctx.role != Role.SUPER_ADMIN and ctx.tenant_id and str(interview.tenant_id) != str(ctx.tenant_id):
                raise HTTPException(403, "Access denied")
                
            # Select candidates and join with session to get status, scores etc.
            res_cand = await db.execute(
                select(InterviewCandidate, InterviewSession)
                .outerjoin(InterviewSession, InterviewCandidate.id == InterviewSession.candidate_id)
                .where(InterviewCandidate.interview_id == i_uuid)
            )
            
            candidates_list = []
            for cand, sess in res_cand.all():
                cand_dict = {
                    "id": str(cand.id),
                    "candidate_name": cand.candidate_name,
                    "candidate_email": cand.candidate_email,
                    "invitation_status": cand.invitation_status,
                    "email_verified": cand.email_verified,
                    "verification_time": cand.verification_time.isoformat() if cand.verification_time else None,
                    "last_invited_at": cand.last_invited_at.isoformat() if cand.last_invited_at else None,
                    "invite_count": cand.invite_count,
                    "is_revoked": cand.is_revoked,
                    "created_at": cand.created_at.isoformat() if cand.created_at else None,
                    "updated_at": cand.updated_at.isoformat() if cand.updated_at else None,
                    "session": {
                        "id": str(sess.id),
                        "status": sess.status,
                        "overall_score": sess.overall_score,
                        "started_at": sess.started_at.isoformat() if sess.started_at else None,
                        "completed_at": sess.completed_at.isoformat() if sess.completed_at else None,
                    } if sess else None
                }
                candidates_list.append(cand_dict)
            return candidates_list
        finally:
            db.info["tenant_id"] = _old_tenant
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(400, "Invalid interview ID")
    except Exception as e:
        log.error(f"Error fetching candidates: {e}")
        raise HTTPException(500, str(e))

@router.post("/interviews/{interview_id}/candidates")
async def add_interview_candidate(
    interview_id: str,
    body: CandidateAddRequest,
    db: AsyncSession = Depends(get_db),
    ctx: UserContext = Depends(require_permission(Permission.CREATE_INTERVIEW))
):
    try:
        from uuid import UUID
        from models import InterviewCandidate
        i_uuid = UUID(interview_id)
        
        email_clean = body.email.strip().lower()
        if not email_clean:
            raise HTTPException(400, "Email is required")
            
        # Basic validation
        import re
        if not re.match(r"[^@]+@[^@]+\.[^@]+", email_clean):
            raise HTTPException(400, "Invalid email format")

        _old_tenant = db.info.get("tenant_id")
        db.info["tenant_id"] = None
        try:
            res = await db.execute(select(Interview).where(Interview.id == i_uuid))
            interview = res.scalar_one_or_none()
            if not interview:
                raise HTTPException(404, "Interview not found")
            if ctx.role != Role.SUPER_ADMIN and ctx.tenant_id and str(interview.tenant_id) != str(ctx.tenant_id):
                raise HTTPException(403, "Access denied")
                
            # Check duplicate
            dup_res = await db.execute(
                select(InterviewCandidate).where(
                    and_(
                        InterviewCandidate.interview_id == i_uuid,
                        InterviewCandidate.candidate_email == email_clean
                    )
                )
            )
            if dup_res.scalar_one_or_none():
                raise HTTPException(400, "Candidate with this email already added")
                
            cand = InterviewCandidate(
                interview_id=i_uuid,
                candidate_email=email_clean,
                candidate_name=body.name.strip() if body.name else None,
                invitation_status="pending",
                email_verified=False,
                invite_count=0,
                is_revoked=False
            )
            db.add(cand)
            await db.commit()
            await db.refresh(cand)
            return {
                "id": str(cand.id),
                "candidate_name": cand.candidate_name,
                "candidate_email": cand.candidate_email,
                "invitation_status": cand.invitation_status,
                "email_verified": cand.email_verified,
                "is_revoked": cand.is_revoked
            }
        finally:
            db.info["tenant_id"] = _old_tenant
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(400, "Invalid interview ID")
    except Exception as e:
        log.error(f"Error adding candidate: {e}")
        raise HTTPException(500, str(e))

@router.delete("/interviews/{interview_id}/candidates/{email}")
async def delete_interview_candidate(
    interview_id: str,
    email: str,
    db: AsyncSession = Depends(get_db),
    ctx: UserContext = Depends(require_permission(Permission.CREATE_INTERVIEW))
):
    try:
        from uuid import UUID
        from models import InterviewCandidate, InterviewSession
        i_uuid = UUID(interview_id)
        email_clean = email.strip().lower()
        
        _old_tenant = db.info.get("tenant_id")
        db.info["tenant_id"] = None
        try:
            res = await db.execute(select(Interview).where(Interview.id == i_uuid))
            interview = res.scalar_one_or_none()
            if not interview:
                raise HTTPException(404, "Interview not found")
            if ctx.role != Role.SUPER_ADMIN and ctx.tenant_id and str(interview.tenant_id) != str(ctx.tenant_id):
                raise HTTPException(403, "Access denied")
                
            res_cand = await db.execute(
                select(InterviewCandidate).where(
                    and_(
                        InterviewCandidate.interview_id == i_uuid,
                        InterviewCandidate.candidate_email == email_clean
                    )
                )
            )
            cand = res_cand.scalar_one_or_none()
            if not cand:
                raise HTTPException(404, "Candidate not found")
                
            # If session is started, we cannot delete
            if cand.session_id:
                sess_res = await db.execute(select(InterviewSession).where(InterviewSession.id == cand.session_id))
                sess = sess_res.scalar_one_or_none()
                if sess and sess.status != "pending":
                    raise HTTPException(400, "Cannot delete candidate who has already started the interview")
                    
            await db.delete(cand)
            await db.commit()
            return {"message": "Candidate removed successfully"}
        finally:
            db.info["tenant_id"] = _old_tenant
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(400, "Invalid interview ID")
    except Exception as e:
        log.error(f"Error removing candidate: {e}")
        raise HTTPException(500, str(e))

@router.post("/interviews/{interview_id}/candidates/resend")
async def resend_candidate_invitation(
    interview_id: str,
    payload: CandidateResendRequest,
    db: AsyncSession = Depends(get_db),
    ctx: UserContext = Depends(require_permission(Permission.CREATE_INTERVIEW))
):
    try:
        from uuid import UUID
        from datetime import datetime, timezone
        from models import InterviewCandidate
        i_uuid = UUID(interview_id)
        email_clean = payload.email.strip().lower()
        
        _old_tenant = db.info.get("tenant_id")
        db.info["tenant_id"] = None
        try:
            res = await db.execute(select(Interview).where(Interview.id == i_uuid))
            interview = res.scalar_one_or_none()
            if not interview:
                raise HTTPException(404, "Interview not found")
            if ctx.role != Role.SUPER_ADMIN and ctx.tenant_id and str(interview.tenant_id) != str(ctx.tenant_id):
                raise HTTPException(403, "Access denied")
                
            res_cand = await db.execute(
                select(InterviewCandidate).where(
                    and_(
                        InterviewCandidate.interview_id == i_uuid,
                        InterviewCandidate.candidate_email == email_clean
                    )
                )
            )
            cand = res_cand.scalar_one_or_none()
            if not cand:
                raise HTTPException(404, "Candidate not found")
                
            from email_service import send_interview_email
            email_res = await send_interview_email(
                to=email_clean,
                subject=payload.subject,
                body=payload.body,
                db=db,
                user_id=ctx.user.id,
                tenant_id=ctx.tenant_id,
                interview_id=interview_id
            )
            if not email_res.get("success"):
                cand.invitation_status = "failed"
                await db.commit()
                err_msg = email_res.get("error") or "Failed to send email invitation"
                raise HTTPException(status_code=500, detail=f"Failed to send email invitation: {err_msg}")
                
            cand.invitation_status = "sent"
            cand.last_invited_at = datetime.now(timezone.utc)
            cand.invite_count += 1
            await db.commit()
            return {"message": "Invitation sent successfully"}
        finally:
            db.info["tenant_id"] = _old_tenant
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(400, "Invalid interview ID")
    except Exception as e:
        log.error(f"Error resending invitation: {e}")
        raise HTTPException(500, str(e))

@router.post("/interviews/{interview_id}/candidates/revoke")
async def revoke_candidate_invitation(
    interview_id: str,
    payload: CandidateRevokeRequest,
    db: AsyncSession = Depends(get_db),
    ctx: UserContext = Depends(require_permission(Permission.CREATE_INTERVIEW))
):
    try:
        from uuid import UUID
        from models import InterviewCandidate
        i_uuid = UUID(interview_id)
        email_clean = payload.email.strip().lower()
        
        _old_tenant = db.info.get("tenant_id")
        db.info["tenant_id"] = None
        try:
            res = await db.execute(select(Interview).where(Interview.id == i_uuid))
            interview = res.scalar_one_or_none()
            if not interview:
                raise HTTPException(404, "Interview not found")
            if ctx.role != Role.SUPER_ADMIN and ctx.tenant_id and str(interview.tenant_id) != str(ctx.tenant_id):
                raise HTTPException(403, "Access denied")
                
            res_cand = await db.execute(
                select(InterviewCandidate).where(
                    and_(
                        InterviewCandidate.interview_id == i_uuid,
                        InterviewCandidate.candidate_email == email_clean
                    )
                )
            )
            cand = res_cand.scalar_one_or_none()
            if not cand:
                raise HTTPException(404, "Candidate not found")
                
            cand.is_revoked = payload.is_revoked
            await db.commit()
            return {"message": f"Candidate invitation {'revoked' if payload.is_revoked else 'restored'} successfully"}
        finally:
            db.info["tenant_id"] = _old_tenant
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(400, "Invalid interview ID")
    except Exception as e:
        log.error(f"Error revoking invitation: {e}")
        raise HTTPException(500, str(e))

@router.post("/interviews/by-token/{token}/verify-email")
async def verify_candidate_email(
    token: str,
    body: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db)
):
    from utils import resolve_interview_context
    from models import InterviewCandidate, InterviewSession
    from datetime import datetime, timezone

    # Resolve the template via token (invite_token, session_token, or short_code)
    try:
        execution_obj, template_obj = await resolve_interview_context(db, token)
    except HTTPException as e:
        raise e

    # For multi-candidate, template_obj is the Interview template
    # Make sure we resolve to the root template (not a session)
    if hasattr(template_obj, "interview_id"):
        # template_obj is actually a session — get the real template
        res_t = await db.execute(select(Interview).where(Interview.id == template_obj.interview_id))
        real_template = res_t.scalar_one_or_none()
        if real_template:
            template_obj = real_template

    email_clean = body.email.strip().lower()
    if not email_clean:
        raise HTTPException(400, "Email is required")

    res_cand = await db.execute(
        select(InterviewCandidate).where(
            and_(
                InterviewCandidate.interview_id == template_obj.id,
                InterviewCandidate.candidate_email == email_clean
            )
        )
    )
    cand = res_cand.scalar_one_or_none()
    if not cand:
        raise HTTPException(403, "You are not authorized to attend this interview.")

    if cand.is_revoked:
        raise HTTPException(403, "You are not authorized to attend this interview.")

    from utils import check_access_status, raise_access_blocked_exception
    sess = None
    if cand.session_id:
        res_sess = await db.execute(select(InterviewSession).where(InterviewSession.id == cand.session_id))
        sess = res_sess.scalar_one_or_none()

    access_status = check_access_status(sess or template_obj, template_obj)
    if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
        completed_at_dt = getattr(sess, "completed_at", None) if sess else None
        raise_access_blocked_exception(
            access_status,
            template_obj,
            extra_detail={
                "candidate_name": cand.candidate_name,
                "candidate_email": cand.candidate_email,
                "job_role": getattr(template_obj, "job_role", None) or getattr(template_obj, "title", None),
                "completed_at": completed_at_dt.isoformat() if completed_at_dt else None,
            }
        )

    if sess:
        return {
            "success": True,
            "session_token": sess.session_token,
            "status": sess.status
        }

    import secrets
    session_token = "sess_" + secrets.token_urlsafe(32)
    new_sess = InterviewSession(
        interview_id=template_obj.id,
        candidate_id=cand.id,
        session_token=session_token,
        status="pending",
        current_round="technical"
    )
    db.add(new_sess)
    await db.commit()
    await db.refresh(new_sess)

    cand.session_id = new_sess.id
    cand.email_verified = True
    cand.verification_time = datetime.now(timezone.utc)
    await db.commit()

    return {
        "success": True,
        "session_token": session_token,
        "status": new_sess.status
    }
