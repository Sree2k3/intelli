from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import select, func, and_, or_, cast, Date
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from datetime import datetime, timedelta
import re
import os

from database import get_db
from models import Interview, User, Membership
from auth_rbac import UserContext, Role, require_role, get_user_context
from logging_config import logger as log
from config import settings

router = APIRouter(prefix="/api/recruiter", tags=["Recruiter"])

@router.get("/dashboard/stats")
async def get_recruiter_stats(
    ctx: UserContext = Depends(require_role([Role.RECRUITER, Role.MANAGER, Role.ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Get recruiter-level dashboard statistics."""
    if not ctx.tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context missing")

    from models import InterviewSession

    from models import InterviewCandidate

    # Single-candidate interview stats (or multi-candidate templates with no candidates yet)
    stats_query = select(
        func.count(Interview.id).label("total_candidates"),
        func.count(Interview.id).filter(Interview.status != "pending").label("interviews_created"),
        func.count(Interview.id).filter(Interview.status == "completed").label("completed_interviews"),
        func.count(Interview.id).filter(Interview.status == "pending").label("pending_interviews"),
        func.count(Interview.id).filter(Interview.status == "in_progress").label("in_progress"),
        func.count(Interview.id).filter(Interview.status == "selected").label("selected_candidates"),
        func.count(Interview.id).filter(Interview.status == "rejected").label("rejected_candidates"),
        func.count(Interview.id).filter(Interview.status == "flagged").label("flagged_interviews"),
        func.sum(Interview.overall_score).label("sum_score"),
        func.count(Interview.id).filter(Interview.candidate_id_url != None).label("id_verified"),
    ).where(
        and_(
            Interview.tenant_id == ctx.tenant_id,
            Interview.recruiter_id == ctx.user.id,
            or_(
                Interview.is_multi_candidate == False,
                Interview.id.not_in(select(InterviewCandidate.interview_id))
            )
        )
    )

    # Multi-candidate session stats
    sess_stats_query = select(
        func.count(InterviewSession.id).label("total_candidates"),
        func.count(InterviewSession.id).filter(InterviewSession.status != "pending").label("interviews_created"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "completed").label("completed_interviews"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "pending").label("pending_interviews"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "in_progress").label("in_progress"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "selected").label("selected_candidates"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "rejected").label("rejected_candidates"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "flagged").label("flagged_interviews"),
        func.sum(InterviewSession.overall_score).label("sum_score"),
        func.count(InterviewSession.id).filter(InterviewSession.candidate_id_url != None).label("id_verified"),
    ).join(
        Interview, InterviewSession.interview_id == Interview.id
    ).where(
        and_(
            Interview.tenant_id == ctx.tenant_id,
            Interview.recruiter_id == ctx.user.id
        )
    )

    # Multi-candidate pending candidate stats
    cand_stats_query = select(
        func.count(InterviewCandidate.id).label("total_candidates"),
        func.count(InterviewCandidate.id).filter(
            or_(
                InterviewCandidate.invitation_status == "pending",
                InterviewCandidate.invitation_status == "sent",
                InterviewCandidate.invitation_status == None,
                InterviewCandidate.invitation_status.not_in(["completed", "in_progress", "selected", "rejected", "flagged"])
            )
        ).label("pending_interviews"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "in_progress").label("in_progress"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "completed").label("completed_interviews"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "selected").label("selected_candidates"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "rejected").label("rejected_candidates"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "flagged").label("flagged_interviews"),
    ).join(
        Interview, InterviewCandidate.interview_id == Interview.id
    ).where(
        and_(
            Interview.tenant_id == ctx.tenant_id,
            Interview.recruiter_id == ctx.user.id,
            InterviewCandidate.session_id == None
        )
    )

    result = await db.execute(stats_query)
    stats = result.first()
    sess_result = await db.execute(sess_stats_query)
    s_stats = sess_result.first()
    cand_result = await db.execute(cand_stats_query)
    c_stats = cand_result.first()

    total = (stats.total_candidates or 0) + (s_stats.total_candidates or 0) + (c_stats.total_candidates or 0)
    selected = (stats.selected_candidates or 0) + (s_stats.selected_candidates or 0) + (c_stats.selected_candidates or 0)
    sum_score = (stats.sum_score or 0.0) + (s_stats.sum_score or 0.0)

    return {
        "total_candidates": total,
        "total_interviews": total,
        "interviews_created": (stats.interviews_created or 0) + (s_stats.interviews_created or 0),
        "completed_interviews": (stats.completed_interviews or 0) + (s_stats.completed_interviews or 0) + (c_stats.completed_interviews or 0),
        "pending_interviews": (stats.pending_interviews or 0) + (s_stats.pending_interviews or 0) + (c_stats.pending_interviews or 0),
        "in_progress_count": (stats.in_progress or 0) + (s_stats.in_progress or 0) + (c_stats.in_progress or 0),
        "selected_candidates": selected,
        "rejected_candidates": (stats.rejected_candidates or 0) + (s_stats.rejected_candidates or 0) + (c_stats.rejected_candidates or 0),
        "success_rate": round((selected / total * 100), 1) if total > 0 else 0,
        "avg_score": round(sum_score / total, 1) if total > 0 else 0,
        "id_verified_count": (stats.id_verified or 0) + (s_stats.id_verified or 0),
        "flagged_interviews": (stats.flagged_interviews or 0) + (s_stats.flagged_interviews or 0) + (c_stats.flagged_interviews or 0),
        "cheating_alert_count": (stats.flagged_interviews or 0) + (s_stats.flagged_interviews or 0) + (c_stats.flagged_interviews or 0)
    }

@router.get("/interviews")
async def list_recruiter_interviews(
    status: Optional[str] = None,
    role: Optional[str] = None,
    ctx: UserContext = Depends(require_role([Role.RECRUITER, Role.MANAGER, Role.ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """List recruiter's own interviews with filters."""
    query = select(Interview).where(
        and_(
            Interview.tenant_id == ctx.tenant_id,
            Interview.recruiter_id == ctx.user.id
        )
    )

    if status:
        query = query.where(Interview.status == status)
    if role:
        query = query.where(Interview.job_role.ilike(f"%{role}%"))

    result = await db.execute(query.order_by(Interview.created_at.desc()))
    interviews = result.scalars().all()

    return interviews

@router.get("/interview/{id}/result")
async def get_interview_result(
    id: UUID,
    ctx: UserContext = Depends(require_role([Role.RECRUITER, Role.MANAGER, Role.ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed result for a specific interview owned by the recruiter."""
    from models import InterviewSession
    from utils import _generate_presigned_url

    # Try InterviewSession first (multi-candidate)
    sess_query = select(InterviewSession).where(
        InterviewSession.id == id
    ).options(
        selectinload(InterviewSession.candidate),
        selectinload(InterviewSession.interview)
    )
    sess_result = await db.execute(sess_query)
    session = sess_result.scalar_one_or_none()

    if session:
        interview = session.interview
        if interview.recruiter_id != ctx.user.id:
            raise HTTPException(status_code=403, detail="Access denied")
        candidate = session.candidate
        return {
            "candidate_name": candidate.candidate_name if candidate else "Unknown",
            "applied_role": interview.job_role,
            "status": session.status,
            "ai_score": session.overall_score,
            "technical_score": session.technical_score,
            "communication_score": session.communication_score,
            "ai_recommendation": session.ai_recommendation,
            "final_result": session.status,
            "proctoring_alerts": session.proctoring_alerts or {},
            "id_verification_status": "Verified" if getattr(session, "candidate_id_url", None) else "Pending",
            "interview_duration": f"{session.duration_seconds // 60}m {session.duration_seconds % 60}s" if getattr(session, "duration_seconds", None) else "N/A",
            "video_url": _generate_presigned_url(session.video_url),
            "candidate_id_url": _generate_presigned_url(getattr(session, "candidate_id_url", None))
        }

    # Fallback to Interview (single-candidate)
    query = select(Interview).where(
        and_(
            Interview.id == id,
            Interview.recruiter_id == ctx.user.id
        )
    )
    
    result = await db.execute(query)
    interview = result.scalar_one_or_none()

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found or access denied")

    return {
        "candidate_name": interview.candidate_name,
        "applied_role": interview.job_role,
        "status": interview.status,
        "ai_score": interview.overall_score,
        "technical_score": interview.technical_score,
        "communication_score": interview.behavioral_score, # Mapping behavioral to communication for UI
        "ai_recommendation": interview.ai_recommendation,
        "final_result": interview.status,
        "proctoring_alerts": interview.proctoring_strikes,
        "id_verification_status": "Verified" if interview.candidate_id_url else "Pending",
        "interview_duration": f"{interview.duration_seconds // 60}m {interview.duration_seconds % 60}s" if interview.duration_seconds else "N/A",
        "video_url": _generate_presigned_url(interview.video_url),
        "candidate_id_url": _generate_presigned_url(interview.candidate_id_url)
    }

@router.get("/interview/{id}/recording")
async def get_interview_recording(
    id: UUID,
    download: bool = Query(False, description="Whether to generate download presigned URL with attachment disposition"),
    ctx: UserContext = Depends(require_role([Role.RECRUITER, Role.MANAGER, Role.ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Get recording URL for an interview or session."""
    from models import InterviewSession

    video_url = None
    candidate_name = None

    # Try InterviewSession first
    sess_query = select(InterviewSession).where(InterviewSession.id == id).options(
        selectinload(InterviewSession.interview)
    )
    sess_result = await db.execute(sess_query)
    session = sess_result.scalar_one_or_none()

    if session:
        video_url = session.video_url
        candidate_name = getattr(session, "candidate_name", None)
        parent = session.interview
        if ctx.role == Role.RECRUITER and parent.recruiter_id != ctx.user.id:
            raise HTTPException(status_code=403, detail="Access denied")
        elif ctx.role != Role.RECRUITER and str(parent.tenant_id) != str(ctx.tenant_id):
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        # Fallback to Interview
        query = select(Interview).where(Interview.id == id)
        result = await db.execute(query)
        interview_obj = result.scalar_one_or_none()
        if interview_obj:
            video_url = interview_obj.video_url
            candidate_name = getattr(interview_obj, "candidate_name", None)
            if ctx.role == Role.RECRUITER and interview_obj.recruiter_id != ctx.user.id:
                raise HTTPException(status_code=403, detail="Access denied")
            elif ctx.role != Role.RECRUITER and str(interview_obj.tenant_id) != str(ctx.tenant_id):
                raise HTTPException(status_code=403, detail="Access denied")

            # If template video_url is null, check if any InterviewSession under this interview has a video_url
            if not video_url:
                sess_query2 = (
                    select(InterviewSession)
                    .where(InterviewSession.interview_id == id, InterviewSession.video_url.is_not(None))
                    .order_by(InterviewSession.created_at.desc())
                )
                sess_result2 = await db.execute(sess_query2)
                sess2 = sess_result2.scalar_one_or_none()
                if sess2:
                    video_url = sess2.video_url
                    if not candidate_name:
                        candidate_name = getattr(sess2, "candidate_name", None)

    if not video_url:
        raise HTTPException(status_code=404, detail="Recording not found or access denied")

    clean_name = "Candidate"
    if candidate_name and candidate_name.strip():
        clean_name = re.sub(r'[^a-zA-Z0-9_-]', '_', candidate_name.strip())
    filename = f"Interview_Recording_{clean_name}_{str(id)[:8]}.webm"

    if (video_url.startswith("s3://") or ".amazonaws.com/" in video_url) and settings.STORAGE_MODE == "s3":
        try:
            from utils import get_s3_client, parse_s3_key
            s3_key = parse_s3_key(video_url)
            s3_client = get_s3_client()
            if s3_client and s3_key:
                params = {"Bucket": settings.S3_BUCKET_NAME, "Key": s3_key}
                if download:
                    params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
                presigned_url = s3_client.generate_presigned_url(
                    "get_object",
                    Params=params,
                    ExpiresIn=settings.S3_PRESIGNED_EXPIRY,
                )
                return {"video_url": presigned_url, "filename": filename, "type": "s3"}
        except Exception as e:
            log.error(f"Presigned URL generation failed: {e}")
            raise HTTPException(500, f"Failed to generate video URL: {str(e)}")

    # If local file, ensure it is patched for seeking
    clean_local = video_url.lstrip("/")
    if os.path.exists(clean_local):
        try:
            from webm_fixer import fix_webm_file
            clean_local = fix_webm_file(clean_local)
        except Exception as fe:
            log.warning(f"Failed to fix local webm {clean_local}: {fe}")

    return {"video_url": video_url, "filename": filename, "type": "local"}

@router.get("/interview/{id}/recording/download")
async def download_interview_recording(
    id: UUID,
    ctx: UserContext = Depends(require_role([Role.RECRUITER, Role.MANAGER, Role.ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Direct download endpoint that ensures seekable WebM and sets attachment Content-Disposition header."""
    rec = await get_interview_recording(id=id, download=True, ctx=ctx, db=db)
    video_url = rec["video_url"]
    filename = rec.get("filename", f"Interview_Recording_{str(id)[:8]}.webm")

    if rec.get("type") == "s3":
        try:
            import io
            from utils import get_s3_client, parse_s3_key
            from starlette.responses import StreamingResponse
            from webm_fixer import fix_webm_stream
            s3_key = parse_s3_key(video_url)
            s3_client = get_s3_client()
            if s3_client and s3_key:
                s3_obj = s3_client.get_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
                raw_bytes = s3_obj["Body"].read()
                try:
                    fixed_bytes = fix_webm_stream(raw_bytes)
                except Exception as fe:
                    log.warning(f"Failed to patch S3 WebM: {fe}")
                    fixed_bytes = raw_bytes

                headers = {
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Content-Length": str(len(fixed_bytes)),
                }
                return StreamingResponse(
                    io.BytesIO(fixed_bytes),
                    media_type="video/webm",
                    headers=headers
                )
        except Exception as e:
            log.error(f"S3 streaming download failed: {e}")
        return RedirectResponse(url=video_url, status_code=307)

    # Local file: make sure it's seekable with duration and cues before serving
    clean_path = video_url.lstrip("/")
    if os.path.exists(clean_path):
        try:
            from webm_fixer import fix_webm_file
            clean_path = fix_webm_file(clean_path)
        except Exception as fe:
            log.warning(f"Failed to patch local WebM file {clean_path}: {fe}")

        return FileResponse(
            path=clean_path,
            filename=filename,
            media_type="video/webm",
            content_disposition_type="attachment"
        )
    raise HTTPException(status_code=404, detail="Recording file not found on disk")

@router.get("/interview/{id}/report")
async def get_interview_report(
    id: UUID,
    ctx: UserContext = Depends(require_role([Role.RECRUITER, Role.MANAGER, Role.ADMIN])),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed AI report for an interview or session."""
    from models import InterviewSession

    # Try InterviewSession first
    sess_query = select(InterviewSession).where(InterviewSession.id == id).options(
        selectinload(InterviewSession.interview)
    )
    sess_result = await db.execute(sess_query)
    session = sess_result.scalar_one_or_none()

    obj = None
    if session:
        obj = session
        parent = session.interview
        if ctx.role == Role.RECRUITER and parent.recruiter_id != ctx.user.id:
            raise HTTPException(status_code=403, detail="Access denied")
        elif ctx.role != Role.RECRUITER and str(parent.tenant_id) != str(ctx.tenant_id):
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        # Fallback to Interview
        query = select(Interview).where(Interview.id == id)
        if ctx.role == Role.RECRUITER:
            query = query.where(Interview.recruiter_id == ctx.user.id)
        else:
            query = query.where(Interview.tenant_id == ctx.tenant_id)
        result = await db.execute(query)
        obj = result.scalar_one_or_none()

    if not obj:
        raise HTTPException(status_code=404, detail="Interview not found or access denied")

    # In a real app, 'strengths' and 'weaknesses' might be parsed from structured_memory
    # or generated during evaluation. Here we use placeholders if not present.
    memory = getattr(obj, "structured_memory", {}) or {}
    overall_score = getattr(obj, "overall_score", 0) or 0
    proctoring = getattr(obj, "proctoring_alerts", None) or getattr(obj, "proctoring_strikes", {}) or {}
    
    return {
        "ai_summary": getattr(obj, "ai_recommendation", None) or "No summary available.",
        "strengths": memory.get("strengths", ["Technical proficiency", "Communication"]),
        "weaknesses": memory.get("weaknesses", ["Speed of implementation"]),
        "recommendation": "Hire" if overall_score >= 70 else "Consider" if overall_score >= 50 else "Reject",
        "suspicious_activity_alerts": proctoring
    }
