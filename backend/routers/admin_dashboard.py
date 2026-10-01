from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, and_, or_, cast, Date, false, case
from sqlalchemy.orm import selectinload, aliased
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from datetime import datetime, timedelta, timezone

nullif = func.nullif

from database import get_db
from models import Tenant, Membership, User, Interview
from auth_rbac import get_user_context, UserContext, Role, Permission, require_permission, require_role
from logging_config import logger as log
from utils import _generate_presigned_url, _resolve_violation_screenshots

router = APIRouter(prefix="/api/admin/dashboard", tags=["Admin Dashboard"])

@router.get("/stats")
async def get_dashboard_stats(
    tenant_id: Optional[str] = None,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """Get high-level tenant statistics with advanced metrics."""
    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.warning(f"[get_dashboard_stats] tenant_id '{tenant_id}' is not a valid UUID. Using ctx.tenant_id fallback.")

    if not effective_tenant_id:
        raise HTTPException(status_code=400, detail="Tenant ID is required")

    from models import InterviewSession, InterviewCandidate

    interviews_query = select(
        func.count(Interview.id).label("total"),
        func.count(Interview.id).filter(
            Interview.status.in_(["completed", "selected", "rejected", "flagged"])
        ).label("finished"),
        func.count(Interview.id).filter(
            or_(
                Interview.status == "pending",
                Interview.status == "sent",
                Interview.status == None,
                Interview.status.not_in(["completed", "selected", "rejected", "flagged", "in_progress"])
            )
        ).label("pending"),
        func.count(Interview.id).filter(Interview.status == "in_progress").label("in_progress"),
        func.count(Interview.id).filter(
            or_(
                Interview.status == "selected",
                and_(Interview.status == "completed", Interview.overall_score != None, Interview.overall_score >= 60)
            )
        ).label("selected"),
        func.count(Interview.id).filter(
            or_(
                Interview.status == "rejected",
                and_(Interview.status == "completed", Interview.overall_score != None, Interview.overall_score < 60)
            )
        ).label("rejected"),
        func.count(Interview.id).filter(Interview.status == "flagged").label("flagged"),
        func.count(Interview.id).filter(Interview.overall_score != None).label("scored_count"),
        func.sum(Interview.overall_score).label("sum_score"),
        func.count(Interview.id).filter(Interview.candidate_id_url != None).label("id_verified"),
    ).where(
        and_(
            Interview.tenant_id == effective_tenant_id,
            or_(
                Interview.is_multi_candidate == False,
                Interview.id.not_in(select(InterviewCandidate.interview_id))
            )
        )
    )
    
    sessions_query = select(
        func.count(InterviewSession.id).label("total"),
        func.count(InterviewSession.id).filter(
            InterviewSession.status.in_(["completed", "selected", "rejected", "flagged"])
        ).label("finished"),
        func.count(InterviewSession.id).filter(
            or_(
                InterviewSession.status == "pending",
                InterviewSession.status == "sent",
                InterviewSession.status == None,
                InterviewSession.status.not_in(["completed", "selected", "rejected", "flagged", "in_progress"])
            )
        ).label("pending"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "in_progress").label("in_progress"),
        func.count(InterviewSession.id).filter(
            or_(
                InterviewSession.status == "selected",
                and_(InterviewSession.status == "completed", InterviewSession.overall_score != None, InterviewSession.overall_score >= 60)
            )
        ).label("selected"),
        func.count(InterviewSession.id).filter(
            or_(
                InterviewSession.status == "rejected",
                and_(InterviewSession.status == "completed", InterviewSession.overall_score != None, InterviewSession.overall_score < 60)
            )
        ).label("rejected"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "flagged").label("flagged"),
        func.count(InterviewSession.id).filter(InterviewSession.overall_score != None).label("scored_count"),
        func.sum(InterviewSession.overall_score).label("sum_score"),
        func.count(InterviewSession.id).filter(InterviewSession.candidate_id_url != None).label("id_verified"),
    ).join(
        Interview, InterviewSession.interview_id == Interview.id
    ).where(Interview.tenant_id == effective_tenant_id)

    pending_cand_query = select(
        func.count(InterviewCandidate.id).label("total"),
        func.count(InterviewCandidate.id).filter(
            or_(
                InterviewCandidate.invitation_status == "pending",
                InterviewCandidate.invitation_status == "sent",
                InterviewCandidate.invitation_status == None,
                InterviewCandidate.invitation_status.not_in(["completed", "in_progress", "selected", "rejected", "flagged"])
            )
        ).label("pending"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "in_progress").label("in_progress"),
        func.count(InterviewCandidate.id).filter(
            InterviewCandidate.invitation_status.in_(["completed", "selected", "rejected", "flagged"])
        ).label("finished"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "selected").label("selected"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "rejected").label("rejected"),
        func.count(InterviewCandidate.id).filter(InterviewCandidate.invitation_status == "flagged").label("flagged"),
    ).join(
        Interview, InterviewCandidate.interview_id == Interview.id
    ).where(
        and_(
            Interview.tenant_id == effective_tenant_id,
            InterviewCandidate.session_id == None
        )
    )
    
    # Default queries for ADMIN
    managers_query = select(func.count(Membership.id)).join(User, Membership.user_id == User.id).where(
        and_(Membership.tenant_id == effective_tenant_id, Membership.role == Role.MANAGER.value, User.status != "disabled")
    )
    recruiters_query = select(func.count(Membership.id)).join(User, Membership.user_id == User.id).where(
        and_(Membership.tenant_id == effective_tenant_id, Membership.role == Role.RECRUITER.value, User.status != "disabled")
    )

    if ctx.role == Role.MANAGER:
        managers_query = select(func.count(Membership.id)).join(User, Membership.user_id == User.id).where(
            and_(Membership.tenant_id == effective_tenant_id, Membership.user_id == ctx.user.id, Membership.role == Role.MANAGER.value, User.status != "disabled")
        )
        recruiters_query = select(func.count(Membership.id)).join(User, Membership.user_id == User.id).where(
            and_(Membership.tenant_id == effective_tenant_id, Membership.manager_id == ctx.user.id, Membership.role == Role.RECRUITER.value, User.status != "disabled")
        )
        rec_ids_subquery = select(Membership.user_id).where(
            and_(Membership.manager_id == ctx.user.id, Membership.tenant_id == effective_tenant_id)
        )
        interviews_query = interviews_query.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
        sessions_query = sessions_query.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
        pending_cand_query = pending_cand_query.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
    
    if ctx.role == Role.RECRUITER:
        managers_query = select(func.count(Membership.id)).where(false()) # Recruiters see 0 managers
        recruiters_query = select(func.count(Membership.id)).where(
            and_(Membership.tenant_id == effective_tenant_id, Membership.user_id == ctx.user.id, Membership.role == Role.RECRUITER.value)
        )
        interviews_query = interviews_query.where(Interview.recruiter_id == ctx.user.id)
        sessions_query = sessions_query.where(Interview.recruiter_id == ctx.user.id)
        pending_cand_query = pending_cand_query.where(Interview.recruiter_id == ctx.user.id)

    total_managers = (await db.execute(managers_query)).scalar() or 0
    total_recruiters = (await db.execute(recruiters_query)).scalar() or 0
    
    int_stats = (await db.execute(interviews_query)).first()
    sess_stats = (await db.execute(sessions_query)).first()
    cand_stats = (await db.execute(pending_cand_query)).first()

    i_total = int_stats.total if int_stats else 0
    s_total = sess_stats.total if sess_stats else 0
    c_total = cand_stats.total if cand_stats else 0
    total_interviews = i_total + s_total + c_total

    # Calculate UNIQUE total candidates
    single_emails_q = select(Interview.candidate_email).where(
        and_(Interview.tenant_id == effective_tenant_id, Interview.is_multi_candidate == False, Interview.candidate_email != None)
    )
    multi_emails_q = select(InterviewCandidate.candidate_email).join(
        Interview, InterviewCandidate.interview_id == Interview.id
    ).where(
        and_(Interview.tenant_id == effective_tenant_id, InterviewCandidate.candidate_email != None)
    )

    if ctx.role == Role.MANAGER:
        single_emails_q = single_emails_q.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
        multi_emails_q = multi_emails_q.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
    elif ctx.role == Role.RECRUITER:
        single_emails_q = single_emails_q.where(Interview.recruiter_id == ctx.user.id)
        multi_emails_q = multi_emails_q.where(Interview.recruiter_id == ctx.user.id)

    single_emails = (await db.execute(single_emails_q)).scalars().all()
    multi_emails = (await db.execute(multi_emails_q)).scalars().all()
    
    unique_candidates = len(set(single_emails) | set(multi_emails))

    # All finished interviews regardless of outcome or flag
    completed = (int_stats.finished if int_stats else 0) + (sess_stats.finished if sess_stats else 0) + (cand_stats.finished if cand_stats else 0)
    pending = (int_stats.pending if int_stats else 0) + (sess_stats.pending if sess_stats else 0) + (cand_stats.pending if cand_stats else 0)
    in_progress = (int_stats.in_progress if int_stats else 0) + (sess_stats.in_progress if sess_stats else 0) + (cand_stats.in_progress if cand_stats else 0)

    # Reconcile counts so total_interviews == pending + in_progress + completed with zero discrepancies
    unaccounted = total_interviews - (pending + in_progress + completed)
    if unaccounted > 0:
        pending += unaccounted

    selected = (int_stats.selected if int_stats else 0) + (sess_stats.selected if sess_stats else 0) + (cand_stats.selected if cand_stats else 0)
    rejected = (int_stats.rejected if int_stats else 0) + (sess_stats.rejected if sess_stats else 0) + (cand_stats.rejected if cand_stats else 0)
    flagged = (int_stats.flagged if int_stats else 0) + (sess_stats.flagged if sess_stats else 0) + (cand_stats.flagged if cand_stats else 0)
    id_verified = (int_stats.id_verified if int_stats else 0) + (sess_stats.id_verified if sess_stats else 0)

    # Finished interviews awaiting decision (neither selected, rejected, nor flagged)
    under_review = max(0, completed - (selected + rejected + flagged))
    clean_completed = max(0, completed - flagged)

    # True average score among candidates who were scored
    scored_count = (int_stats.scored_count if int_stats else 0) + (sess_stats.scored_count if sess_stats else 0)
    sum_score = (int_stats.sum_score or 0.0) + (sess_stats.sum_score or 0.0)
    avg_score = round(sum_score / scored_count, 1) if scored_count > 0 else 0.0

    completion_rate = round((completed / total_interviews * 100), 1) if total_interviews > 0 else 0.0
    selection_rate = round((selected / completed * 100), 1) if completed > 0 else 0.0
    integrity_rate = round((clean_completed / completed * 100), 1) if completed > 0 else 100.0

    return {
        "total_managers": total_managers,
        "total_recruiters": total_recruiters,
        "total_candidates": unique_candidates,
        # Section 1: Interview Progress & Lifecycle
        "total_interviews": total_interviews,
        "completed_interviews": completed,
        "pending_interviews": pending,
        "in_progress_count": in_progress,
        "completion_rate": completion_rate,
        # Section 2: Candidate Outcomes & Decisions
        "selected_candidates": selected,
        "rejected_candidates": rejected,
        "under_review_count": under_review,
        "selection_rate": selection_rate,
        "avg_score": avg_score,
        # Section 3: Integrity & Proctoring
        "flagged_count": flagged,
        "cheating_alert_count": flagged,
        "clean_interviews_count": clean_completed,
        "integrity_rate": integrity_rate,
        "id_verified_count": id_verified,
        # Legacy compatibility
        "success_rate": selection_rate,
    }

@router.get("/trends")
async def get_interview_trends(
    tenant_id: Optional[str] = None,
    days: int = 30,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """Get interview trends over time."""
    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.warning(f"[get_interview_trends] tenant_id '{tenant_id}' is not a valid UUID. Using ctx.tenant_id fallback.")

    if not effective_tenant_id:
        raise HTTPException(status_code=400, detail="Tenant ID is required")

    from models import InterviewSession
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Single-candidate interviews
    query = select(
        cast(Interview.created_at, Date).label("date"),
        func.count(Interview.id).label("count")
    ).where(
        and_(Interview.tenant_id == effective_tenant_id, Interview.created_at >= start_date, Interview.is_multi_candidate == False)
    )
    
    # Multi-candidate sessions
    sess_query = select(
        cast(InterviewSession.created_at, Date).label("date"),
        func.count(InterviewSession.id).label("count")
    ).join(
        Interview, InterviewSession.interview_id == Interview.id
    ).where(
        and_(Interview.tenant_id == effective_tenant_id, InterviewSession.created_at >= start_date)
    )
    
    if ctx.role == Role.MANAGER:
        rec_ids_subquery = select(Membership.user_id).where(
            and_(Membership.manager_id == ctx.user.id, Membership.tenant_id == effective_tenant_id)
        )
        query = query.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
        sess_query = sess_query.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
    if ctx.role == Role.RECRUITER:
        query = query.where(Interview.recruiter_id == ctx.user.id)
        sess_query = sess_query.where(Interview.recruiter_id == ctx.user.id)
    
    query = query.group_by(cast(Interview.created_at, Date))
    sess_query = sess_query.group_by(cast(InterviewSession.created_at, Date))
    
    result = await db.execute(query)
    single_trends = result.all()
    sess_result = await db.execute(sess_query)
    session_trends = sess_result.all()
    
    # Merge trends by date
    from collections import defaultdict
    merged = defaultdict(int)
    for t in single_trends:
        merged[str(t.date)] += t.count
    for t in session_trends:
        merged[str(t.date)] += t.count
    
    return [{"date": d, "count": c} for d, c in sorted(merged.items())]

@router.get("/leaderboard")
async def get_recruiter_leaderboard(
    tenant_id: Optional[str] = None,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """Get recruiter performance leaderboard."""
    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.warning(f"[get_recruiter_leaderboard] tenant_id '{tenant_id}' is not a valid UUID. Using ctx.tenant_id fallback.")

    if not effective_tenant_id:
        raise HTTPException(status_code=400, detail="Tenant ID is required")

    query = select(
        User.full_name,
        func.count(Interview.id).label("total_interviews"),
        func.count(Interview.id).filter(Interview.overall_score >= 70).label("selected_count")
    ).join(
        Interview, Interview.user_id == User.id
    ).where(
        Interview.tenant_id == effective_tenant_id
    )
    
    if ctx.role == Role.MANAGER:
        rec_ids_subquery = select(Membership.user_id).where(
            and_(Membership.manager_id == ctx.user.id, Membership.tenant_id == effective_tenant_id)
        )
        query = query.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
    if ctx.role == Role.RECRUITER:
        query = query.where(Interview.recruiter_id == ctx.user.id)
    
    query = query.group_by(User.full_name).order_by(func.count(Interview.id).desc()).limit(10)
    
    result = await db.execute(query)
    rows = result.all()
    
    return [
        {
            "name": r.full_name,
            "interviews": r.total_interviews,
            "selections": r.selected_count,
            "rate": round((r.selected_count / r.total_interviews * 100), 1) if r.total_interviews > 0 else 0
        } for r in rows
    ]

@router.get("/pipeline")
async def get_pipeline_stats(
    tenant_id: Optional[str] = None,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """Get candidate pipeline stages."""
    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.warning(f"[get_pipeline_stats] tenant_id '{tenant_id}' is not a valid UUID. Using ctx.tenant_id fallback.")

    if not effective_tenant_id:
        raise HTTPException(status_code=400, detail="Tenant ID is required")

    from models import InterviewSession
    query = select(
        func.count(Interview.id).label("applied"),
        func.count(Interview.id).filter(Interview.status == "in_progress").label("started"),
        func.count(Interview.id).filter(Interview.status.in_(["completed", "selected", "rejected", "flagged"])).label("completed"),
        func.count(Interview.id).filter(
            or_(Interview.status == "selected", and_(Interview.overall_score != None, Interview.overall_score >= 60))
        ).label("selected"),
        func.count(Interview.id).filter(
            or_(Interview.status == "rejected", and_(Interview.overall_score != None, Interview.overall_score < 60))
        ).label("rejected")
    ).where(and_(Interview.tenant_id == effective_tenant_id, Interview.is_multi_candidate == False))
    
    sess_query = select(
        func.count(InterviewSession.id).label("applied"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "in_progress").label("started"),
        func.count(InterviewSession.id).filter(InterviewSession.status.in_(["completed", "selected", "rejected", "flagged"])).label("completed"),
        func.count(InterviewSession.id).filter(
            or_(InterviewSession.status == "selected", and_(InterviewSession.overall_score != None, InterviewSession.overall_score >= 60))
        ).label("selected"),
        func.count(InterviewSession.id).filter(
            or_(InterviewSession.status == "rejected", and_(InterviewSession.overall_score != None, InterviewSession.overall_score < 60))
        ).label("rejected")
    ).join(
        Interview, InterviewSession.interview_id == Interview.id
    ).where(Interview.tenant_id == effective_tenant_id)
    
    if ctx.role == Role.MANAGER:
        rec_ids_subquery = select(Membership.user_id).where(
            and_(Membership.manager_id == ctx.user.id, Membership.tenant_id == effective_tenant_id)
        )
        query = query.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
        sess_query = sess_query.where(
            or_(Interview.recruiter_id == ctx.user.id, Interview.recruiter_id.in_(rec_ids_subquery))
        )
    if ctx.role == Role.RECRUITER:
        query = query.where(Interview.recruiter_id == ctx.user.id)
        sess_query = sess_query.where(Interview.recruiter_id == ctx.user.id)
    
    row = (await db.execute(query)).first()
    s_row = (await db.execute(sess_query)).first()
    
    return [
        {"stage": "Applied", "count": (row.applied if row else 0) + (s_row.applied if s_row else 0)},
        {"stage": "Started", "count": (row.started if row else 0) + (s_row.started if s_row else 0)},
        {"stage": "Completed", "count": (row.completed if row else 0) + (s_row.completed if s_row else 0)},
        {"stage": "Selected", "count": (row.selected if row else 0) + (s_row.selected if s_row else 0)},
        {"stage": "Rejected", "count": (row.rejected if row else 0) + (s_row.rejected if s_row else 0)},
    ]

@router.get("/managers")
async def list_managers(
    tenant_id: Optional[str] = None,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """List all managers with detailed metrics. Only ADMIN/SUPER_ADMIN get full list; other roles get empty list."""
    # Managers and recruiters should not see the full manager list
    if ctx.role not in [Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER]:
        return []

    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.warning(f"[list_managers] tenant_id '{tenant_id}' is not a valid UUID. Using ctx.tenant_id fallback.")

    if not effective_tenant_id:
        raise HTTPException(status_code=400, detail="Tenant ID is required")
    
    from models import InterviewSession

    # Advanced query for managers with sub-metrics
    # 1. Recruiter counts
    rec_counts = select(
        Membership.manager_id,
        func.count(Membership.id).label("count")
    ).join(User, Membership.user_id == User.id).where(
        and_(Membership.tenant_id == effective_tenant_id, Membership.role == Role.RECRUITER.value, User.status != "disabled")
    ).group_by(Membership.manager_id).subquery()

    # 2. Stats for single-candidate interviews via recruiter membership
    # Groups both the reporting recruiters' interviews and the manager's own created interviews
    sub_int_stats = select(
        func.coalesce(Membership.manager_id, Membership.user_id).label("manager_id"),
        func.count(Interview.id).label("total_candidates"),
        func.count(Interview.id).filter(Interview.status.in_(["completed", "selected", "rejected"])).label("completed_interviews"),
        func.count(Interview.id).filter(Interview.status == "pending").label("pending_count"),
        func.count(Interview.id).filter(Interview.status == "flagged").label("flagged_count"),
        func.count(Interview.id).filter(Interview.status == "selected").label("selected_count"),
        func.count(Interview.id).filter(Interview.status == "rejected").label("rejected_count"),
    ).join(
        Interview, and_(
            Interview.recruiter_id == Membership.user_id,
            Interview.tenant_id == effective_tenant_id,
            Interview.is_multi_candidate == False
        )
    ).join(User, Membership.user_id == User.id).where(
        and_(
            Membership.tenant_id == effective_tenant_id,
            Membership.role.in_([Role.RECRUITER.value, Role.MANAGER.value]),
            User.status != "disabled"
        )
    ).group_by(func.coalesce(Membership.manager_id, Membership.user_id)).subquery()

    # 3. Stats for multi-candidate sessions via recruiter membership
    # Groups both the reporting recruiters' sessions and the manager's own created sessions
    sub_sess_stats = select(
        func.coalesce(Membership.manager_id, Membership.user_id).label("manager_id"),
        func.count(InterviewSession.id).label("total_candidates"),
        func.count(InterviewSession.id).filter(InterviewSession.status.in_(["completed", "selected", "rejected"])).label("completed_interviews"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "pending").label("pending_count"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "flagged").label("flagged_count"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "selected").label("selected_count"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "rejected").label("rejected_count"),
    ).join(
        Interview, and_(
            InterviewSession.interview_id == Interview.id,
            Interview.tenant_id == effective_tenant_id
        )
    ).join(
        Membership, and_(Interview.recruiter_id == Membership.user_id, Membership.tenant_id == effective_tenant_id)
    ).join(User, Membership.user_id == User.id).where(
        and_(
            Membership.role.in_([Role.RECRUITER.value, Role.MANAGER.value]),
            User.status != "disabled"
        )
    ).group_by(func.coalesce(Membership.manager_id, Membership.user_id)).subquery()

    query = select(
        Membership.id.label("membership_id"),
        User.id,
        User.full_name,
        User.email,
        User.updated_at.label("last_active"),
        func.coalesce(rec_counts.c.count, 0).label("recruiter_count"),
        (func.coalesce(sub_int_stats.c.total_candidates, 0) + func.coalesce(sub_sess_stats.c.total_candidates, 0)).label("candidate_count"),
        (func.coalesce(sub_int_stats.c.completed_interviews, 0) + func.coalesce(sub_sess_stats.c.completed_interviews, 0)).label("total_interviews"),
        (func.coalesce(sub_int_stats.c.pending_count, 0) + func.coalesce(sub_sess_stats.c.pending_count, 0)).label("pending_count"),
        (func.coalesce(sub_int_stats.c.flagged_count, 0) + func.coalesce(sub_sess_stats.c.flagged_count, 0)).label("flagged_count"),
        (func.coalesce(sub_int_stats.c.selected_count, 0) + func.coalesce(sub_sess_stats.c.selected_count, 0)).label("selected_count"),
        (func.coalesce(sub_int_stats.c.rejected_count, 0) + func.coalesce(sub_sess_stats.c.rejected_count, 0)).label("rejected_count"),
    ).join(
        Membership, and_(Membership.user_id == User.id, Membership.tenant_id == effective_tenant_id)
    ).outerjoin(
        rec_counts, User.id == rec_counts.c.manager_id
    ).outerjoin(
        sub_int_stats, User.id == sub_int_stats.c.manager_id
    ).outerjoin(
        sub_sess_stats, User.id == sub_sess_stats.c.manager_id
    ).where(and_(Membership.role == Role.MANAGER.value, User.status != "disabled"))

    # If the user is a manager, only return their own manager profile/stats
    if ctx.role == Role.MANAGER:
        query = query.where(User.id == ctx.user.id)
    
    result = await db.execute(query)
    managers = result.all()
    
    return [
        {
            "id": str(m.id),
            "membership_id": str(m.membership_id),
            "full_name": m.full_name,
            "email": m.email,
            "recruiter_count": m.recruiter_count,
            "candidate_count": m.candidate_count,
            "total_interviews": m.total_interviews,
            "completed_count": m.total_interviews,
            "pending_count": m.pending_count,
            "flagged_count": m.flagged_count,
            "selected_count": m.selected_count,
            "rejected_count": m.rejected_count,
            "last_active": str(m.last_active) if m.last_active else "N/A"
        } for m in managers
    ]


@router.get("/managers/{manager_id}/recruiters")
async def list_manager_recruiters(
    manager_id: str,
    tenant_id: Optional[str] = None,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """List recruiters reporting to a specific manager."""
    log.info(f"[list_manager_recruiters] Input manager_id: {manager_id}, tenant_id: {tenant_id}, ctx.user.id: {ctx.user.id}, ctx.role: {ctx.role}")

    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.error(f"[list_manager_recruiters] Validation Failure: Invalid tenant_id {tenant_id}")
            raise HTTPException(status_code=422, detail="Invalid tenant_id format")

    if not effective_tenant_id:
        log.error(f"[list_manager_recruiters] Validation Failure: tenant_id context is missing")
        raise HTTPException(status_code=400, detail="Tenant ID is required")
    
    target_manager_id = None
    filter_by_manager = True
    if ctx.role == Role.MANAGER:
        target_manager_id = ctx.user.id
        log.info(f"[list_manager_recruiters] Derived manager_id from JWT context: {target_manager_id}")
    elif manager_id == "all":
        filter_by_manager = False
    else:
        try:
            target_manager_id = UUID(manager_id)
        except ValueError:
            target_manager_id = ctx.user.id
            log.warning(f"[list_manager_recruiters] manager_id '{manager_id}' is not a valid UUID. Using authenticated user ID fallback: {target_manager_id}")

    from models import InterviewSession
 
    # Single-candidate interview counts per recruiter
    int_counts = select(
        Interview.recruiter_id.label("user_id"),
        func.count(Interview.id).label("total_interviews"),
        func.count(Interview.id).filter(Interview.status.in_(["completed", "selected", "rejected"])).label("completed_interviews"),
        func.count(Interview.id).filter(Interview.status == "pending").label("pending_count"),
        func.count(Interview.id).filter(Interview.status == "flagged").label("flagged_count"),
        func.count(Interview.id).filter(Interview.status == "selected").label("selected_count"),
        func.count(Interview.id).filter(Interview.status == "rejected").label("rejected_count"),
    ).where(
        and_(Interview.tenant_id == effective_tenant_id, Interview.is_multi_candidate == False)
    ).group_by(Interview.recruiter_id).subquery()

    # Multi-candidate session counts per recruiter
    sess_counts = select(
        Interview.recruiter_id.label("user_id"),
        func.count(InterviewSession.id).label("total_interviews"),
        func.count(InterviewSession.id).filter(InterviewSession.status.in_(["completed", "selected", "rejected"])).label("completed_interviews"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "pending").label("pending_count"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "flagged").label("flagged_count"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "selected").label("selected_count"),
        func.count(InterviewSession.id).filter(InterviewSession.status == "rejected").label("rejected_count"),
    ).join(
        Interview, InterviewSession.interview_id == Interview.id
    ).where(
        Interview.tenant_id == effective_tenant_id
    ).group_by(Interview.recruiter_id).subquery()

    where_clauses = [
        User.status != "disabled",
        Membership.role == Role.RECRUITER.value
    ]
    if filter_by_manager:
        where_clauses.append(Membership.manager_id == target_manager_id)

    query = select(
        Membership.id.label("membership_id"),
        User.id,
        User.full_name,
        User.email,
        (func.coalesce(int_counts.c.total_interviews, 0) + func.coalesce(sess_counts.c.total_interviews, 0)).label("total_interviews"),
        (func.coalesce(int_counts.c.completed_interviews, 0) + func.coalesce(sess_counts.c.completed_interviews, 0)).label("completed_interviews"),
        (func.coalesce(int_counts.c.pending_count, 0) + func.coalesce(sess_counts.c.pending_count, 0)).label("pending_count"),
        (func.coalesce(int_counts.c.flagged_count, 0) + func.coalesce(sess_counts.c.flagged_count, 0)).label("flagged_count"),
        (func.coalesce(int_counts.c.selected_count, 0) + func.coalesce(sess_counts.c.selected_count, 0)).label("selected_count"),
        (func.coalesce(int_counts.c.rejected_count, 0) + func.coalesce(sess_counts.c.rejected_count, 0)).label("rejected_count"),
    ).join(
        Membership, and_(Membership.user_id == User.id, Membership.tenant_id == effective_tenant_id)
    ).outerjoin(
        int_counts, User.id == int_counts.c.user_id
    ).outerjoin(
        sess_counts, User.id == sess_counts.c.user_id
    ).where(
        and_(*where_clauses)
    )
    
    result = await db.execute(query)
    recruiters = result.all()
    
    return [
        {
            "id": str(r.id),
            "membership_id": str(r.membership_id),
            "full_name": r.full_name,
            "email": r.email,
            "total_interviews": r.total_interviews,
            "completed_interviews": r.completed_interviews,
            "pending_count": r.pending_count,
            "flagged_count": r.flagged_count,
            "selected_count": r.selected_count,
            "rejected_count": r.rejected_count,
        } for r in recruiters
    ]

@router.get("/recruiters/{recruiter_id}/candidates")
async def list_recruiter_candidates(
    recruiter_id: str,
    tenant_id: Optional[str] = None,
    page: int = 1,
    limit: int = 10,
    direct_only: bool = False,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    log.info(f"[list_recruiter_candidates] Input recruiter_id: {recruiter_id}, tenant_id: {tenant_id}, ctx.user.id: {ctx.user.id}, ctx.role: {ctx.role}")

    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.error(f"[list_recruiter_candidates] Validation Failure: Invalid tenant_id {tenant_id}")
            raise HTTPException(status_code=422, detail="Invalid tenant_id format")

    if not effective_tenant_id:
        log.error(f"[list_recruiter_candidates] Validation Failure: tenant_id context is missing")
        raise HTTPException(status_code=400, detail="Tenant ID is required")
    
    target_recruiter_id = None
    if ctx.role == Role.RECRUITER:
        target_recruiter_id = ctx.user.id
    else:
        try:
            target_recruiter_id = UUID(recruiter_id)
        except ValueError:
            target_recruiter_id = ctx.user.id
            log.warning(f"[list_recruiter_candidates] recruiter_id '{recruiter_id}' is not a valid UUID. Using authenticated user ID fallback: {target_recruiter_id}")

    # Check if target_recruiter_id is a manager
    mgr_check = await db.execute(
        select(Membership.role).where(
            and_(
                Membership.user_id == target_recruiter_id,
                Membership.tenant_id == effective_tenant_id,
                Membership.role == Role.MANAGER.value
            )
        )
    )
    is_manager = mgr_check.scalar() is not None

    if is_manager and not direct_only:
        rec_ids_stmt = select(Membership.user_id).where(
            and_(
                Membership.manager_id == target_recruiter_id,
                Membership.tenant_id == effective_tenant_id
            )
        )
        rec_ids_res = await db.execute(rec_ids_stmt)
        reporting_rec_ids = [r[0] for r in rec_ids_res.all()]
        target_ids = reporting_rec_ids + [target_recruiter_id]
    else:
        target_ids = [target_recruiter_id]

    if ctx.role == Role.RECRUITER and ctx.user.id != target_recruiter_id:
        raise HTTPException(status_code=403, detail="Recruiters can only view their own candidates")
    
    if ctx.role == Role.MANAGER:
        if target_recruiter_id != ctx.user.id:
            check = await db.execute(
                select(Membership).where(
                    and_(
                        Membership.user_id == target_recruiter_id,
                        Membership.manager_id == ctx.user.id,
                        Membership.tenant_id == effective_tenant_id
                    )
                )
            )
            if not check.scalar_one_or_none():
                raise HTTPException(status_code=403, detail="Managers can only view candidates of recruiters reporting to them")

    offset = (page - 1) * limit

    from models import InterviewSession, InterviewCandidate

    # --- Single-candidate interviews ---
    recruiter_id_expr = func.coalesce(Interview.recruiter_id, Interview.user_id)
    cand_name_single = nullif(Interview.candidate_name, '')
    cand_email_single = nullif(Interview.candidate_email, '')

    single_query = select(
        Interview.id,
        cand_name_single.label("candidate_name"),
        cand_email_single.label("candidate_email"),
        Interview.job_role,
        Interview.status,
        Interview.overall_score,
        Interview.created_at,
        Interview.video_url,
        Interview.candidate_id_url,
    ).where(
        and_(
            recruiter_id_expr.in_(target_ids),
            Interview.tenant_id == effective_tenant_id,
            Interview.is_multi_candidate == False
        )
    )

    single_result = await db.execute(single_query.order_by(Interview.created_at.desc()))
    single_rows = single_result.all()

    # --- Multi-candidate sessions ---
    cand_name_sess = func.coalesce(
        nullif(InterviewCandidate.candidate_name, ''),
        nullif(Interview.candidate_name, '')
    )
    cand_email_sess = func.coalesce(
        nullif(InterviewCandidate.candidate_email, ''),
        nullif(Interview.candidate_email, '')
    )

    sess_query = select(
        InterviewSession.id,
        cand_name_sess.label("candidate_name"),
        cand_email_sess.label("candidate_email"),
        Interview.job_role,
        InterviewSession.status,
        InterviewSession.overall_score,
        InterviewSession.created_at,
        InterviewSession.video_url,
        InterviewSession.candidate_id_url,
    ).join(
        Interview, InterviewSession.interview_id == Interview.id
    ).outerjoin(
        InterviewCandidate, InterviewSession.candidate_id == InterviewCandidate.id
    ).where(
        and_(recruiter_id_expr.in_(target_ids), Interview.tenant_id == effective_tenant_id)
    )

    sess_result = await db.execute(sess_query.order_by(InterviewSession.created_at.desc()))
    session_rows = sess_result.all()

    # --- Multi-candidate pending candidates (invited but haven't started session yet) ---
    cand_name_pending = func.coalesce(
        nullif(InterviewCandidate.candidate_name, ''),
        nullif(Interview.candidate_name, '')
    )
    cand_email_pending = func.coalesce(
        nullif(InterviewCandidate.candidate_email, ''),
        nullif(Interview.candidate_email, '')
    )

    pending_query = select(
        InterviewCandidate.id,
        cand_name_pending.label("candidate_name"),
        cand_email_pending.label("candidate_email"),
        Interview.job_role,
        InterviewCandidate.invitation_status.label("status"),
        InterviewCandidate.invited_at.label("created_at"),
    ).join(
        Interview, InterviewCandidate.interview_id == Interview.id
    ).where(
        and_(
            recruiter_id_expr.in_(target_ids),
            Interview.tenant_id == effective_tenant_id,
            InterviewCandidate.session_id == None
        )
    )
    pending_result = await db.execute(pending_query.order_by(InterviewCandidate.invited_at.desc()))
    pending_rows = pending_result.all()

    # Merge into a unified candidate list
    combined = []
    cand_placeholders = ("unknown", "null", "none", "unknown candidate", "unassigned candidate", "unassigned (invite pending)", "candidate")
    for r in single_rows:
        cand_name = (r.candidate_name or "").strip()
        cand_email = (r.candidate_email or "").strip()
        disp_name = cand_name if (cand_name and cand_name.lower() not in cand_placeholders) else (cand_email or "Unknown")
        combined.append({
            "id": str(r.id),
            "candidate_name": disp_name,
            "candidate_email": cand_email,
            "job_role": r.job_role,
            "status": r.status,
            "overall_score": r.overall_score,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "video_url": _generate_presigned_url(r.video_url),
            "candidate_id_url": _generate_presigned_url(getattr(r, "candidate_id_url", None)),
        })
    for r in session_rows:
        cand_name = (r.candidate_name or "").strip()
        cand_email = (r.candidate_email or "").strip()
        disp_name = cand_name if (cand_name and cand_name.lower() not in cand_placeholders) else (cand_email or "Unknown")
        combined.append({
            "id": str(r.id),
            "candidate_name": disp_name,
            "candidate_email": cand_email,
            "job_role": r.job_role,
            "status": r.status,
            "overall_score": r.overall_score,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "video_url": _generate_presigned_url(r.video_url),
            "candidate_id_url": _generate_presigned_url(getattr(r, "candidate_id_url", None)),
        })
    for r in pending_rows:
        cand_name = (r.candidate_name or "").strip()
        cand_email = (r.candidate_email or "").strip()
        disp_name = cand_name if (cand_name and cand_name.lower() not in cand_placeholders) else (cand_email or "Unknown")
        combined.append({
            "id": str(r.id),
            "candidate_name": disp_name,
            "candidate_email": cand_email,
            "job_role": r.job_role,
            "status": "pending",
            "invitation_status": r.status or "pending",
            "overall_score": None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "video_url": None,
            "candidate_id_url": None,
        })

    combined.sort(key=lambda x: x["created_at"] or "", reverse=True)
    total = len(combined)
    paginated = combined[offset: offset + limit]

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "items": paginated,
        "candidates": paginated
    }

@router.get("/results/{candidate_id}")
async def get_candidate_result(
    candidate_id: str,
    tenant_id: Optional[str] = None,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    log.info(f"[get_candidate_result] Input candidate_id: {candidate_id}, tenant_id: {tenant_id}, ctx.user.id: {ctx.user.id}, ctx.role: {ctx.role}")

    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.error(f"[get_candidate_result] Validation Failure: Invalid tenant_id {tenant_id}")
            raise HTTPException(status_code=422, detail="Invalid tenant_id format")

    if not effective_tenant_id:
        log.error(f"[get_candidate_result] Validation Failure: tenant_id context is missing")
        raise HTTPException(status_code=400, detail="Tenant ID is required")
    
    try:
        resolved_candidate_id = UUID(candidate_id)
    except ValueError:
        log.error(f"[get_candidate_result] Validation Failure: Invalid candidate_id {candidate_id}")
        raise HTTPException(status_code=422, detail="Invalid candidate_id format")

    from models import InterviewSession, InterviewCandidate

    query = select(Interview).where(
        and_(Interview.id == resolved_candidate_id, Interview.tenant_id == effective_tenant_id)
    ).options(selectinload(Interview.user))
    
    result = await db.execute(query)
    interview = result.scalar_one_or_none()
    
    # If not found as Interview, try as InterviewSession (multi-candidate)
    session = None
    if not interview:
        sess_query = select(InterviewSession).where(
            InterviewSession.id == resolved_candidate_id
        ).options(
            selectinload(InterviewSession.candidate),
            selectinload(InterviewSession.interview).selectinload(Interview.user)
        )
        sess_result = await db.execute(sess_query)
        session = sess_result.scalar_one_or_none()
        
        if session:
            interview = session.interview
            # Verify tenant
            if str(interview.tenant_id) != str(effective_tenant_id):
                raise HTTPException(status_code=404, detail="Candidate not found")
    
    if not interview and not session:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    effective_recruiter_id = interview.recruiter_id or interview.user_id

    if ctx.role == Role.RECRUITER and effective_recruiter_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="Recruiters can only view their own candidates")
        
    if ctx.role == Role.MANAGER:
        if effective_recruiter_id != ctx.user.id:
            reporting_check = await db.execute(
                select(Membership).where(
                    and_(
                        Membership.user_id == effective_recruiter_id,
                        Membership.manager_id == ctx.user.id,
                        Membership.tenant_id == effective_tenant_id
                    )
                )
            )
            if not reporting_check.scalar_one_or_none():
                raise HTTPException(status_code=403, detail="Managers can only view candidate results of recruiters reporting to them")

    # Resolve manager name robustly
    effective_mgr_id = interview.manager_id
    if not effective_mgr_id and effective_recruiter_id:
        mgr_mem_res = await db.execute(
            select(Membership.manager_id, Membership.role).where(
                and_(Membership.user_id == effective_recruiter_id, Membership.tenant_id == effective_tenant_id)
            )
        )
        mem_row = mgr_mem_res.first()
        if mem_row:
            if mem_row[0]:
                effective_mgr_id = mem_row[0]
            elif mem_row[1] == Role.MANAGER.value:
                effective_mgr_id = effective_recruiter_id

    manager_name = "N/A"
    if effective_mgr_id:
        m_u = (await db.execute(select(User.full_name, User.email).where(User.id == effective_mgr_id))).first()
        if m_u:
            manager_name = (m_u[0] or m_u[1] or "N/A").strip()
    
    if manager_name == "N/A":
        # Fallback to tenant active manager if available
        tm_res = await db.execute(
            select(User.full_name, User.email)
            .join(Membership, Membership.user_id == User.id)
            .where(
                and_(
                    Membership.tenant_id == effective_tenant_id,
                    Membership.role == Role.MANAGER.value,
                    User.status != "disabled"
                )
            )
            .limit(1)
        )
        tm_u = tm_res.first()
        if tm_u:
            manager_name = (tm_u[0] or tm_u[1] or "N/A").strip()

    # Recruiter display name
    recruiter_name = "N/A"
    if effective_recruiter_id:
        rec_u = (await db.execute(select(User.full_name, User.email).where(User.id == effective_recruiter_id))).first()
        if rec_u:
            recruiter_name = (rec_u[0] or rec_u[1] or "N/A").strip()

    cand_placeholders = ("unknown", "null", "none", "unknown candidate", "unassigned candidate", "unassigned (invite pending)", "candidate")

    if session:
        candidate = session.candidate
        raw_name = ((candidate.candidate_name if candidate else interview.candidate_name) or "").strip()
        raw_email = ((candidate.candidate_email if candidate else interview.candidate_email) or "").strip()
        disp_name = raw_name if (raw_name and raw_name.lower() not in cand_placeholders) else (raw_email or "Unknown")
        return {
            "id": str(session.id),
            "candidate_name": disp_name,
            "candidate_email": raw_email,
            "applied_role": interview.job_role,
            "interview_score": session.overall_score,
            "technical_score": session.technical_score,
            "coding_score": getattr(session, "coding_score", None),
            "behavioral_score": session.communication_score,
            "ai_recommendation": session.ai_recommendation,
            "status": session.status,
            "interview_date": session.created_at,
            "video_url": _generate_presigned_url(session.video_url),
            "candidate_id_url": _generate_presigned_url(getattr(session, "candidate_id_url", None)),
            "proctoring_strikes": session.proctoring_alerts or {},
            "recruiter_name": recruiter_name,
            "manager_name": manager_name,
            "structured_memory": session.structured_memory
        }

    raw_name = (interview.candidate_name or "").strip()
    raw_email = (interview.candidate_email or "").strip()
    disp_name = raw_name if (raw_name and raw_name.lower() not in cand_placeholders) else (raw_email or "Unknown")

    return {
        "id": str(interview.id),
        "candidate_name": disp_name,
        "candidate_email": raw_email,
        "applied_role": interview.job_role,
        "interview_score": interview.overall_score,
        "technical_score": interview.technical_score,
        "coding_score": interview.coding_score,
        "behavioral_score": interview.behavioral_score,
        "ai_recommendation": interview.ai_recommendation,
        "status": interview.status,
        "interview_date": interview.created_at,
        "video_url": _generate_presigned_url(interview.video_url),
        "candidate_id_url": _generate_presigned_url(interview.candidate_id_url),
        "proctoring_strikes": interview.proctoring_strikes,
        "recruiter_name": recruiter_name,
        "manager_name": manager_name,
        "structured_memory": interview.structured_memory
    }

@router.get("/operational-table")
async def get_operational_table(
    manager_id: Optional[str] = None,
    recruiter_id: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    tenant_id: Optional[str] = None,
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """Operational tracking table with ownership mapping and filters."""
    print(
        f"RBAC CHECK | "
        f"user={ctx.user.email} "
        f"role={ctx.role}"
    )
    effective_tenant_id = ctx.tenant_id
    if ctx.role == Role.SUPER_ADMIN and tenant_id:
        try:
            effective_tenant_id = UUID(tenant_id)
        except ValueError:
            log.error(f"[get_operational_table] Validation Failure: Invalid tenant_id {tenant_id}")
            raise HTTPException(status_code=422, detail="Invalid tenant_id format")

    if not effective_tenant_id:
        log.error(f"[get_operational_table] Validation Failure: tenant_id context is missing")
        raise HTTPException(status_code=400, detail="Tenant ID is required")

    resolved_manager_id = None
    if manager_id:
        try:
            resolved_manager_id = UUID(manager_id)
        except ValueError:
            log.warning(f"[get_operational_table] manager_id '{manager_id}' is not a valid UUID. Ignoring filter.")

    resolved_recruiter_id = None
    if recruiter_id:
        try:
            resolved_recruiter_id = UUID(recruiter_id)
        except ValueError:
            log.warning(f"[get_operational_table] recruiter_id '{recruiter_id}' is not a valid UUID. Ignoring filter.")

    from models import InterviewSession, InterviewCandidate
    Recruiter = aliased(User)
    RecruiterMembership = aliased(Membership)
    Manager = aliased(User)
    Cand = aliased(InterviewCandidate)

    recruiter_id_expr = func.coalesce(Interview.recruiter_id, Interview.user_id)
    effective_mgr_id_expr = func.coalesce(
        Interview.manager_id,
        RecruiterMembership.manager_id,
        case((RecruiterMembership.role == 'manager', recruiter_id_expr), else_=None)
    )

    context_default_mgr = None
    if ctx.role == Role.MANAGER:
        context_default_mgr = (ctx.user.full_name or ctx.user.email or "").strip()
    elif ctx.role == Role.RECRUITER:
        if ctx.manager_id:
            m_res = await db.execute(select(User.full_name, User.email).where(User.id == ctx.manager_id))
            m_u = m_res.first()
            if m_u:
                context_default_mgr = (m_u[0] or m_u[1] or "").strip()
        else:
            mem_res = await db.execute(select(Membership.manager_id).where(and_(Membership.user_id == ctx.user.id, Membership.tenant_id == effective_tenant_id)))
            m_id = mem_res.scalar_one_or_none()
            if m_id:
                m_res = await db.execute(select(User.full_name, User.email).where(User.id == m_id))
                m_u = m_res.first()
                if m_u:
                    context_default_mgr = (m_u[0] or m_u[1] or "").strip()
        
        if not context_default_mgr:
            tm_res = await db.execute(
                select(User.full_name, User.email)
                .join(Membership, Membership.user_id == User.id)
                .where(
                    and_(
                        Membership.tenant_id == effective_tenant_id,
                        Membership.role == Role.MANAGER.value,
                        User.status != "disabled"
                    )
                )
                .limit(1)
            )
            tm_u = tm_res.first()
            if tm_u:
                context_default_mgr = (tm_u[0] or tm_u[1] or "").strip()

    def format_row(r, interview_id_val, score_val=None, violation_val=None, strikes_val=None, video_val=None, id_url_val=None):
        cand_name = (r.candidate_name or "").strip()
        cand_email = (r.candidate_email or "").strip()
        is_placeholder = (
            not cand_name or 
            cand_name.lower() in ("unknown", "null", "none", "unknown candidate", "unassigned candidate", "unassigned (invite pending)", "candidate")
        )
        disp_name = cand_name if not is_placeholder else (cand_email or "Unknown")

        mgr_name = (r.manager_name or "").strip()
        mgr_email = (r.manager_email or "").strip()
        mgr_placeholder = not mgr_name or mgr_name.lower() in ("unknown", "null", "none", "n/a")
        if not mgr_placeholder:
            manager_disp = mgr_name
        elif mgr_email:
            manager_disp = mgr_email
        elif context_default_mgr:
            manager_disp = context_default_mgr
        else:
            manager_disp = "N/A"

        rec_name = (r.recruiter_name or "").strip()
        rec_email = (r.recruiter_email or "").strip()
        rec_placeholder = not rec_name or rec_name.lower() in ("unknown", "null", "none", "n/a")
        if not rec_placeholder:
            recruiter_disp = rec_name
        elif rec_email:
            recruiter_disp = rec_email
        elif ctx.role == Role.RECRUITER:
            recruiter_disp = (ctx.user.full_name or ctx.user.email or "N/A")
        else:
            recruiter_disp = "N/A"

        raw_st = (r.status or "pending").lower().strip()
        has_violations = bool(violation_val) or raw_st == "flagged"

        # 1. Progress Status (pending, in_progress, completed)
        if raw_st in ("completed", "selected", "rejected", "flagged") or score_val is not None:
            progress_status = "completed"
        elif raw_st == "in_progress":
            progress_status = "in_progress"
        else:
            progress_status = "pending"

        # 2. Hiring Decision (selected, rejected, under_review, None)
        if progress_status == "completed":
            if raw_st == "selected" or (score_val is not None and score_val >= 60 and raw_st != "rejected"):
                hiring_decision = "selected"
            elif raw_st == "rejected" or (score_val is not None and score_val < 60 and raw_st != "selected"):
                hiring_decision = "rejected"
            else:
                hiring_decision = "under_review"
        else:
            hiring_decision = None

        # 3. Integrity Status (flagged, clean, None)
        if progress_status == "completed":
            integrity_status = "flagged" if raw_st == "flagged" else "clean"
        else:
            integrity_status = None

        return {
            "id": str(r.id),
            "candidate": disp_name,
            "candidate_name": disp_name,
            "candidate_email": cand_email,
            "role": r.job_role,
            "recruiter": recruiter_disp,
            "manager": manager_disp,
            "manager_name": manager_disp,
            "manager_email": mgr_email,
            "score": score_val,
            "status": r.status or "pending",
            "progress_status": progress_status,
            "hiring_decision": hiring_decision,
            "integrity_status": integrity_status,
            "date": r.created_at.isoformat() if r.created_at else None,
            "violation_screenshot": _resolve_violation_screenshots(violation_val) if violation_val else [],
            "proctoring_strikes": strikes_val or {"mobile": 0, "multi_person": 0, "gaze": 0},
            "video_url": _generate_presigned_url(video_val),
            "candidate_id_url": _generate_presigned_url(id_url_val),
            "interview_id": str(interview_id_val)
        }

    def apply_status_filter(query, model_class, st_str: Optional[str]):
        if not st_str:
            return query
        st = st_str.lower().strip()
        status_col = getattr(model_class, "status")
        score_col = getattr(model_class, "overall_score", None)

        if st == "completed":
            conds = [status_col.in_(["completed", "selected", "rejected", "flagged"])]
            if score_col is not None:
                conds.append(score_col != None)
            return query.where(or_(*conds))
        elif st == "pending":
            return query.where(
                or_(
                    status_col == "pending",
                    status_col == "sent",
                    status_col == None,
                    status_col.not_in(["completed", "selected", "rejected", "flagged", "in_progress"])
                )
            )
        elif st == "in_progress":
            return query.where(status_col == "in_progress")
        elif st == "selected":
            conds = [status_col == "selected"]
            if score_col is not None:
                conds.append(and_(status_col == "completed", score_col >= 60))
            return query.where(or_(*conds))
        elif st == "rejected":
            conds = [status_col == "rejected"]
            if score_col is not None:
                conds.append(and_(status_col == "completed", score_col < 60))
            return query.where(or_(*conds))
        elif st == "flagged":
            return query.where(status_col == "flagged")
        elif st == "clean":
            return query.where(and_(status_col.in_(["completed", "selected", "rejected"]), status_col != "flagged"))
        elif st == "under_review":
            return query.where(and_(status_col.in_(["completed", "selected", "rejected", "flagged"])))
        elif st == "candidates":
            return query
        else:
            return query.where(status_col == st_str)

    # --- Single-candidate interviews (or multi-candidate templates with no candidates yet) ---
    cand_name_single = nullif(Interview.candidate_name, '')
    cand_email_single = nullif(Interview.candidate_email, '')

    single_query = select(
        Interview.id,
        cand_name_single.label("candidate_name"),
        cand_email_single.label("candidate_email"),
        Interview.job_role,
        Interview.status,
        Interview.overall_score,
        Interview.created_at,
        Interview.violation_screenshot,
        Interview.proctoring_strikes,
        Interview.video_url,
        Interview.candidate_id_url,
        Recruiter.full_name.label("recruiter_name"),
        Recruiter.email.label("recruiter_email"),
        Manager.full_name.label("manager_name"),
        Manager.email.label("manager_email"),
    ).outerjoin(
        Recruiter, recruiter_id_expr == Recruiter.id
    ).outerjoin(
        RecruiterMembership, and_(
            RecruiterMembership.user_id == recruiter_id_expr,
            RecruiterMembership.tenant_id == effective_tenant_id
        )
    ).outerjoin(
        Manager, Manager.id == effective_mgr_id_expr
    ).where(
        and_(
            Interview.tenant_id == effective_tenant_id,
            or_(
                Interview.is_multi_candidate == False,
                Interview.id.not_in(select(InterviewCandidate.interview_id))
            )
        )
    )

    if resolved_manager_id:
        single_query = single_query.where(
            or_(
                Interview.manager_id == resolved_manager_id,
                RecruiterMembership.manager_id == resolved_manager_id,
                and_(RecruiterMembership.role == 'manager', recruiter_id_expr == resolved_manager_id)
            )
        )
    if resolved_recruiter_id:
        single_query = single_query.where(recruiter_id_expr == resolved_recruiter_id)
    single_query = apply_status_filter(single_query, Interview, status)
    if start_date:
        single_query = single_query.where(Interview.created_at >= start_date)
    if end_date:
        single_query = single_query.where(Interview.created_at <= end_date)

    if ctx.role == Role.MANAGER:
        rec_ids_subquery = select(Membership.user_id).where(
            and_(
                Membership.manager_id == ctx.user.id,
                Membership.tenant_id == effective_tenant_id,
                Membership.role == Role.RECRUITER.value
            )
        )
        single_query = single_query.where(
            or_(
                Interview.manager_id == ctx.user.id,
                recruiter_id_expr == ctx.user.id,
                recruiter_id_expr.in_(rec_ids_subquery),
                RecruiterMembership.manager_id == ctx.user.id
            )
        )
    if ctx.role == Role.RECRUITER:
        single_query = single_query.where(recruiter_id_expr == ctx.user.id)

    result = await db.execute(single_query.order_by(Interview.created_at.desc()).limit(500))
    single_rows = result.all()

    # --- Multi-candidate sessions ---
    SessRecruiter = aliased(User)
    SessRecruiterMembership = aliased(Membership)
    SessManager = aliased(User)

    sess_recruiter_id_expr = func.coalesce(Interview.recruiter_id, Interview.user_id)
    sess_effective_mgr_id_expr = func.coalesce(
        Interview.manager_id,
        SessRecruiterMembership.manager_id,
        case((SessRecruiterMembership.role == 'manager', sess_recruiter_id_expr), else_=None)
    )

    cand_name_sess = func.coalesce(
        nullif(InterviewCandidate.candidate_name, ''),
        nullif(Interview.candidate_name, '')
    )
    cand_email_sess = func.coalesce(
        nullif(InterviewCandidate.candidate_email, ''),
        nullif(Interview.candidate_email, '')
    )

    sess_query = select(
        InterviewSession.id,
        cand_name_sess.label("candidate_name"),
        cand_email_sess.label("candidate_email"),
        Interview.job_role,
        InterviewSession.status,
        InterviewSession.overall_score,
        InterviewSession.created_at,
        InterviewSession.violation_screenshot,
        InterviewSession.proctoring_alerts.label("proctoring_strikes"),
        InterviewSession.video_url,
        InterviewSession.candidate_id_url,
        SessRecruiter.full_name.label("recruiter_name"),
        SessRecruiter.email.label("recruiter_email"),
        SessManager.full_name.label("manager_name"),
        SessManager.email.label("manager_email"),
        InterviewSession.interview_id
    ).join(
        Interview, InterviewSession.interview_id == Interview.id
    ).outerjoin(
        InterviewCandidate, InterviewSession.candidate_id == InterviewCandidate.id
    ).outerjoin(
        SessRecruiter, sess_recruiter_id_expr == SessRecruiter.id
    ).outerjoin(
        SessRecruiterMembership, and_(
            SessRecruiterMembership.user_id == sess_recruiter_id_expr,
            SessRecruiterMembership.tenant_id == effective_tenant_id
        )
    ).outerjoin(
        SessManager, SessManager.id == sess_effective_mgr_id_expr
    ).where(Interview.tenant_id == effective_tenant_id)

    if resolved_manager_id:
        sess_query = sess_query.where(
            or_(
                Interview.manager_id == resolved_manager_id,
                SessRecruiterMembership.manager_id == resolved_manager_id,
                and_(SessRecruiterMembership.role == 'manager', sess_recruiter_id_expr == resolved_manager_id)
            )
        )
    if resolved_recruiter_id:
        sess_query = sess_query.where(sess_recruiter_id_expr == resolved_recruiter_id)
    sess_query = apply_status_filter(sess_query, InterviewSession, status)
    if start_date:
        sess_query = sess_query.where(InterviewSession.created_at >= start_date)
    if end_date:
        sess_query = sess_query.where(InterviewSession.created_at <= end_date)

    if ctx.role == Role.MANAGER:
        rec_ids_subquery = select(Membership.user_id).where(
            and_(
                Membership.manager_id == ctx.user.id,
                Membership.tenant_id == effective_tenant_id,
                Membership.role == Role.RECRUITER.value
            )
        )
        sess_query = sess_query.where(
            or_(
                Interview.manager_id == ctx.user.id,
                sess_recruiter_id_expr == ctx.user.id,
                sess_recruiter_id_expr.in_(rec_ids_subquery),
                SessRecruiterMembership.manager_id == ctx.user.id
            )
        )
    if ctx.role == Role.RECRUITER:
        sess_query = sess_query.where(sess_recruiter_id_expr == ctx.user.id)

    sess_result = await db.execute(sess_query.order_by(InterviewSession.created_at.desc()).limit(500))
    session_rows = sess_result.all()

    # --- Multi-candidate pending candidates (invited but haven't started session yet) ---
    PendingRecruiter = aliased(User)
    PendingRecruiterMembership = aliased(Membership)
    PendingManager = aliased(User)

    pending_recruiter_id_expr = func.coalesce(Interview.recruiter_id, Interview.user_id)
    pending_effective_mgr_id_expr = func.coalesce(
        Interview.manager_id,
        PendingRecruiterMembership.manager_id,
        case((PendingRecruiterMembership.role == 'manager', pending_recruiter_id_expr), else_=None)
    )

    cand_name_pending = func.coalesce(
        nullif(InterviewCandidate.candidate_name, ''),
        nullif(Interview.candidate_name, '')
    )
    cand_email_pending = func.coalesce(
        nullif(InterviewCandidate.candidate_email, ''),
        nullif(Interview.candidate_email, '')
    )

    pending_cand_query = select(
        InterviewCandidate.id,
        cand_name_pending.label("candidate_name"),
        cand_email_pending.label("candidate_email"),
        Interview.job_role,
        InterviewCandidate.invitation_status.label("status"),
        InterviewCandidate.invited_at.label("created_at"),
        PendingRecruiter.full_name.label("recruiter_name"),
        PendingRecruiter.email.label("recruiter_email"),
        PendingManager.full_name.label("manager_name"),
        PendingManager.email.label("manager_email"),
        InterviewCandidate.interview_id
    ).join(
        Interview, InterviewCandidate.interview_id == Interview.id
    ).outerjoin(
        PendingRecruiter, pending_recruiter_id_expr == PendingRecruiter.id
    ).outerjoin(
        PendingRecruiterMembership, and_(
            PendingRecruiterMembership.user_id == pending_recruiter_id_expr,
            PendingRecruiterMembership.tenant_id == effective_tenant_id
        )
    ).outerjoin(
        PendingManager, PendingManager.id == pending_effective_mgr_id_expr
    ).where(
        and_(
            Interview.tenant_id == effective_tenant_id,
            InterviewCandidate.session_id == None
        )
    )

    if resolved_manager_id:
        pending_cand_query = pending_cand_query.where(
            or_(
                Interview.manager_id == resolved_manager_id,
                PendingRecruiterMembership.manager_id == resolved_manager_id,
                and_(PendingRecruiterMembership.role == 'manager', pending_recruiter_id_expr == resolved_manager_id)
            )
        )
    if resolved_recruiter_id:
        pending_cand_query = pending_cand_query.where(pending_recruiter_id_expr == resolved_recruiter_id)
    if status:
        if status.lower() == "pending":
            pass  # All invited candidates without session are pending assessment
        else:
            pending_cand_query = pending_cand_query.where(false())
    if start_date:
        pending_cand_query = pending_cand_query.where(InterviewCandidate.invited_at >= start_date)
    if end_date:
        pending_cand_query = pending_cand_query.where(InterviewCandidate.invited_at <= end_date)

    if ctx.role == Role.MANAGER:
        rec_ids_subquery = select(Membership.user_id).where(
            and_(
                Membership.manager_id == ctx.user.id,
                Membership.tenant_id == effective_tenant_id,
                Membership.role == Role.RECRUITER.value
            )
        )
        pending_cand_query = pending_cand_query.where(
            or_(
                Interview.manager_id == ctx.user.id,
                pending_recruiter_id_expr == ctx.user.id,
                pending_recruiter_id_expr.in_(rec_ids_subquery),
                PendingRecruiterMembership.manager_id == ctx.user.id
            )
        )
    if ctx.role == Role.RECRUITER:
        pending_cand_query = pending_cand_query.where(pending_recruiter_id_expr == ctx.user.id)

    pending_result = await db.execute(pending_cand_query.order_by(InterviewCandidate.invited_at.desc()).limit(500))
    pending_cand_rows = pending_result.all()

    # --- Merge and sort ---
    combined = []
    for r in single_rows:
        combined.append(format_row(
            r,
            interview_id_val=r.id,
            score_val=r.overall_score,
            violation_val=r.violation_screenshot,
            strikes_val=r.proctoring_strikes,
            video_val=r.video_url,
            id_url_val=getattr(r, "candidate_id_url", None)
        ))

    for r in session_rows:
        combined.append(format_row(
            r,
            interview_id_val=r.interview_id,
            score_val=r.overall_score,
            violation_val=r.violation_screenshot,
            strikes_val=r.proctoring_strikes,
            video_val=r.video_url,
            id_url_val=getattr(r, "candidate_id_url", None)
        ))

    for r in pending_cand_rows:
        row_dict = format_row(
            r,
            interview_id_val=r.interview_id,
            score_val=None,
            violation_val=None,
            strikes_val=None,
            video_val=None,
            id_url_val=None
        )
        row_dict["status"] = "pending"
        row_dict["progress_status"] = "pending"
        row_dict["hiring_decision"] = None
        row_dict["integrity_status"] = None
        row_dict["invitation_status"] = r.status or "pending"
        combined.append(row_dict)

    # Sort combined by date descending
    combined.sort(key=lambda x: x["date"] or "", reverse=True)
    return combined
