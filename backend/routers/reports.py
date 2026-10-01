"""
reports.py - Dedicated History & Reports API router.
Supports multi-criteria filtering, search, sorting, pagination, facets,
summary statistics, and CSV export for interview records and candidate evaluations.
"""
import io
import csv
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select, desc, asc
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from auth_rbac import require_role, UserContext, Role
from database import get_db
from models import (
    Interview,
    InterviewCandidate,
    InterviewSession,
    User,
    Membership
)
from logging_config import logger as log
from utils import _generate_presigned_url

router = APIRouter(prefix="/api/reports", tags=["Reports & History"])


def _extract_year(dt: Optional[datetime]) -> Optional[int]:
    if dt:
        return dt.year
    return None


def _derive_score_tier(score: Optional[int]) -> str:
    if score is None:
        return "unscored"
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 50:
        return "needs_review"
    return "critical"


@router.get("/history")
async def get_reports_history(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(15, ge=1, le=100, description="Items per page"),
    search: Optional[str] = Query(None, description="Global search query"),
    status: Optional[str] = Query(None, description="Filter by status"),
    role: Optional[str] = Query(None, description="Filter by job role"),
    job_role: Optional[str] = Query(None, description="Alias for role"),
    interviewer: Optional[str] = Query(None, description="Filter by interviewer"),
    year: Optional[int] = Query(None, description="Filter by year (e.g. 2026)"),
    start_date: Optional[str] = Query(None, description="Start date (ISO or YYYY-MM-DD)"),
    date_from: Optional[str] = Query(None, description="Alias for start_date"),
    end_date: Optional[str] = Query(None, description="End date (ISO or YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Alias for end_date"),
    score_filter: Optional[str] = Query(None, description="'all', 'excellent', 'good', 'needs_review', 'critical', 'high', 'mid', 'low'"),
    score_range: Optional[str] = Query(None, description="Alias for score_filter"),
    skill: Optional[str] = Query(None, description="Filter by skill tag"),
    min_score: Optional[int] = Query(None, ge=0, le=100),
    max_score: Optional[int] = Query(None, ge=0, le=100),
    sort_by: str = Query("date", description="Field to sort by: 'date', 'score', 'candidate', 'interview_name', 'role', 'status'"),
    sort_dir: Optional[str] = Query(None, description="'asc' or 'desc'"),
    sort_order: Optional[str] = Query(None, description="Alias for sort_dir"),
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """
    Search, filter, sort, and paginate historical interview reports with summary statistics and filter facets.
    """
    search = search if isinstance(search, str) else None
    status = status if isinstance(status, str) else None
    role = role if isinstance(role, str) else (job_role if isinstance(job_role, str) else None)
    interviewer = interviewer if isinstance(interviewer, str) else None
    year = year if isinstance(year, int) else None
    start_date = start_date if isinstance(start_date, str) else (date_from if isinstance(date_from, str) else None)
    end_date = end_date if isinstance(end_date, str) else (date_to if isinstance(date_to, str) else None)
    score_filter = score_filter if isinstance(score_filter, str) else (score_range if isinstance(score_range, str) else None)
    skill = skill if isinstance(skill, str) else None
    min_score = min_score if isinstance(min_score, int) else None
    max_score = max_score if isinstance(max_score, int) else None
    sort_by = sort_by if isinstance(sort_by, str) else "date"
    sort_dir = sort_dir if isinstance(sort_dir, str) else (sort_order if isinstance(sort_order, str) else "desc")
    page = page if isinstance(page, int) else 1
    page_size = page_size if isinstance(page_size, int) else 15
    if sort_by in ("created_at", "date"):
        sort_by = "date"

    effective_tenant_id = ctx.tenant_id
    if not effective_tenant_id and ctx.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Tenant context is required")

    # Fetch all interviews within tenant scope
    query_interviews = select(Interview).order_by(desc(Interview.created_at))
    if effective_tenant_id:
        query_interviews = query_interviews.where(Interview.tenant_id == effective_tenant_id)
    
    # Recruiter/Manager scoping if not admin
    if ctx.role == Role.RECRUITER:
        query_interviews = query_interviews.where(
            or_(
                Interview.user_id == ctx.user.id,
                Interview.recruiter_id == ctx.user.id,
                Interview.created_by == ctx.user.id
            )
        )
    elif ctx.role == Role.MANAGER:
        # Manager sees interviews created by themselves or managed team members
        managed_user_subq = select(Membership.user_id).where(
            and_(Membership.tenant_id == effective_tenant_id, Membership.manager_id == ctx.user.id)
        )
        query_interviews = query_interviews.where(
            or_(
                Interview.user_id == ctx.user.id,
                Interview.manager_id == ctx.user.id,
                Interview.user_id.in_(managed_user_subq),
                Interview.recruiter_id.in_(managed_user_subq)
            )
        )

    res_interviews = await db.execute(query_interviews)
    interviews = res_interviews.scalars().all()

    interview_ids = [i.id for i in interviews]

    # Pre-fetch users for creator names
    creator_ids = list(set([i.user_id for i in interviews if i.user_id] + [i.created_by for i in interviews if i.created_by]))
    user_map = {}
    if creator_ids:
        u_res = await db.execute(select(User).where(User.id.in_(creator_ids)))
        for u in u_res.scalars().all():
            user_map[u.id] = (u.full_name or u.email or "Interviewer").strip()

    # Pre-fetch sessions for multi-candidate or individual candidate tracking
    sessions_by_interview: Dict[UUID, List[InterviewSession]] = {}
    candidates_by_id: Dict[UUID, InterviewCandidate] = {}
    candidates_by_interview: Dict[UUID, List[InterviewCandidate]] = {}
    if interview_ids:
        sess_res = await db.execute(
            select(InterviewSession).where(InterviewSession.interview_id.in_(interview_ids))
        )
        for s in sess_res.scalars().all():
            sessions_by_interview.setdefault(s.interview_id, []).append(s)

        cand_res = await db.execute(
            select(InterviewCandidate).where(InterviewCandidate.interview_id.in_(interview_ids))
        )
        for c in cand_res.scalars().all():
            candidates_by_id[c.id] = c
            candidates_by_interview.setdefault(c.interview_id, []).append(c)

    # Flatten unified report rows
    all_rows: List[Dict[str, Any]] = []

    for i in interviews:
        int_name = i.interview_name or f"{i.job_role} Interview"
        creator_name = user_map.get(i.created_by or i.user_id) or "Interviewer"
        interviewer_name = i.interviewer_name or creator_name
        sessions = sessions_by_interview.get(i.id, [])
        cands = candidates_by_interview.get(i.id, [])
        pending_cands = [c for c in cands if c.session_id is None]

        # Multi-candidate container or has associated candidates/sessions
        if i.is_multi_candidate or cands or sessions:
            # 1. Active or completed candidate sessions
            for s in sessions:
                cand = candidates_by_id.get(s.candidate_id)
                cand_name = cand.candidate_name if cand and cand.candidate_name else (i.candidate_name or "Candidate")
                cand_email = cand.candidate_email if cand and cand.candidate_email else (i.candidate_email or "")
                
                # Derive status
                raw_status = s.status or i.status or "pending"
                if raw_status == "passed":
                    raw_status = "completed"
                
                raw_score = s.overall_score if s.overall_score is not None else i.overall_score
                display_score = int(round(raw_score)) if raw_score is not None else None

                eval_date = s.completed_at or s.started_at or i.actual_started_at or i.started_at or i.created_at

                all_rows.append({
                    "id": str(s.id),
                    "interview_id": str(i.id),
                    "session_id": str(s.id),
                    "candidate_id": str(cand.id) if cand else None,
                    "interview_name": int_name,
                    "candidate_name": cand_name,
                    "candidate_email": cand_email,
                    "job_role": i.job_role or "Software Engineer",
                    "interviewer": interviewer_name,
                    "interviewer_name": interviewer_name,
                    "status": raw_status,
                    "score": display_score,
                    "overall_score": display_score,
                    "score_tier": _derive_score_tier(display_score),
                    "technical_score": int(round(s.technical_score)) if s.technical_score is not None else i.technical_score,
                    "coding_score": s.coding_score if s.coding_score is not None else i.coding_score,
                    "behavioral_score": s.behavioral_score if s.behavioral_score is not None else i.behavioral_score,
                    "ai_recommendation": s.ai_recommendation or i.ai_recommendation,
                    "date": eval_date.isoformat() if eval_date else None,
                    "date_raw": eval_date,
                    "year": _extract_year(eval_date),
                    "duration_minutes": i.duration_minutes or 30,
                    "duration_seconds": i.duration_seconds or 0,
                    "has_recording": bool(s.video_url or i.video_url),
                    "short_code": i.short_code,
                    "invite_token": i.invite_token,
                    "is_multi_candidate": True,
                    "created_at": (s.created_at or i.created_at).isoformat() if (s.created_at or i.created_at) else None,
                    "skill_tags": i.skill_tags if isinstance(i.skill_tags, list) else [],
                })

            # 2. Pending invited candidates (who haven't started an interview session yet)
            for c in pending_cands:
                cand_name = (c.candidate_name or "").strip() or "Candidate"
                cand_email = (c.candidate_email or "").strip()
                raw_status = c.invitation_status or "pending"
                if raw_status == "passed":
                    raw_status = "completed"

                eval_date = c.invited_at or c.created_at or i.created_at

                all_rows.append({
                    "id": str(c.id),
                    "interview_id": str(i.id),
                    "session_id": None,
                    "candidate_id": str(c.id),
                    "interview_name": int_name,
                    "candidate_name": cand_name,
                    "candidate_email": cand_email,
                    "job_role": i.job_role or "Software Engineer",
                    "interviewer": interviewer_name,
                    "interviewer_name": interviewer_name,
                    "status": raw_status,
                    "score": None,
                    "overall_score": None,
                    "score_tier": "unscored",
                    "technical_score": None,
                    "coding_score": None,
                    "behavioral_score": None,
                    "ai_recommendation": None,
                    "date": eval_date.isoformat() if eval_date else None,
                    "date_raw": eval_date,
                    "year": _extract_year(eval_date),
                    "duration_minutes": i.duration_minutes or 30,
                    "duration_seconds": i.duration_seconds or 0,
                    "has_recording": False,
                    "short_code": i.short_code,
                    "invite_token": i.invite_token,
                    "is_multi_candidate": True,
                    "created_at": (c.created_at or i.created_at).isoformat() if (c.created_at or i.created_at) else None,
                    "skill_tags": i.skill_tags if isinstance(i.skill_tags, list) else [],
                })

            # 3. Empty multi-candidate template (no sessions and no invited candidates yet)
            if not sessions and not pending_cands:
                eval_date = i.actual_started_at or i.started_at or i.created_at
                raw_status = i.status or "pending"
                if raw_status == "passed":
                    raw_status = "completed"

                display_score = int(round(i.overall_score)) if i.overall_score is not None else None

                all_rows.append({
                    "id": str(i.id),
                    "interview_id": str(i.id),
                    "session_id": None,
                    "candidate_id": None,
                    "interview_name": int_name,
                    "candidate_name": i.candidate_name or "Candidate",
                    "candidate_email": i.candidate_email or "",
                    "job_role": i.job_role or "Software Engineer",
                    "interviewer": interviewer_name,
                    "interviewer_name": interviewer_name,
                    "status": raw_status,
                    "score": display_score,
                    "overall_score": display_score,
                    "score_tier": _derive_score_tier(display_score),
                    "technical_score": i.technical_score,
                    "coding_score": i.coding_score,
                    "behavioral_score": i.behavioral_score,
                    "ai_recommendation": i.ai_recommendation,
                    "date": eval_date.isoformat() if eval_date else None,
                    "date_raw": eval_date,
                    "year": _extract_year(eval_date),
                    "duration_minutes": i.duration_minutes or 30,
                    "duration_seconds": i.duration_seconds or 0,
                    "has_recording": bool(i.video_url),
                    "short_code": i.short_code,
                    "invite_token": i.invite_token,
                    "is_multi_candidate": True,
                    "created_at": i.created_at.isoformat() if i.created_at else None,
                    "skill_tags": i.skill_tags if isinstance(i.skill_tags, list) else [],
                })
        else:
            # Standalone interview (single-candidate)
            eval_date = i.actual_started_at or i.started_at or i.created_at
            raw_status = i.status or "pending"
            if raw_status == "passed":
                raw_status = "completed"

            display_score = int(round(i.overall_score)) if i.overall_score is not None else None

            all_rows.append({
                "id": str(i.id),
                "interview_id": str(i.id),
                "session_id": None,
                "candidate_id": None,
                "interview_name": int_name,
                "candidate_name": i.candidate_name or "Candidate",
                "candidate_email": i.candidate_email or "",
                "job_role": i.job_role or "Software Engineer",
                "interviewer": interviewer_name,
                "interviewer_name": interviewer_name,
                "status": raw_status,
                "score": display_score,
                "overall_score": display_score,
                "score_tier": _derive_score_tier(display_score),
                "technical_score": i.technical_score,
                "coding_score": i.coding_score,
                "behavioral_score": i.behavioral_score,
                "ai_recommendation": i.ai_recommendation,
                "date": eval_date.isoformat() if eval_date else None,
                "date_raw": eval_date,
                "year": _extract_year(eval_date),
                "duration_minutes": i.duration_minutes or 30,
                "duration_seconds": i.duration_seconds or 0,
                "has_recording": bool(i.video_url),
                "short_code": i.short_code,
                "invite_token": i.invite_token,
                "is_multi_candidate": bool(i.is_multi_candidate),
                "created_at": i.created_at.isoformat() if i.created_at else None,
                "skill_tags": i.skill_tags if isinstance(i.skill_tags, list) else [],
            })

    # Facets Calculation (from full dataset before filtering)
    facets_roles = sorted(list(set([r["job_role"] for r in all_rows if r["job_role"]])))
    facets_interviewers = sorted(list(set([r["interviewer"] for r in all_rows if r["interviewer"]])))
    facets_years = sorted(list(set([r["year"] for r in all_rows if r["year"] is not None])), reverse=True)
    all_skills = set()
    for r in all_rows:
        for sk in r.get("skill_tags", []):
            if sk:
                all_skills.add(sk)
    facets_skills = sorted(list(all_skills))

    status_counts: Dict[str, int] = {}
    for r in all_rows:
        s_val = (r["status"] or "pending").lower()
        status_counts[s_val] = status_counts.get(s_val, 0) + 1

    # Apply Filters
    filtered_rows = all_rows

    # 1. Global Search
    if search and search.strip():
        q = search.strip().lower()
        filtered_rows = [
            r for r in filtered_rows
            if q in r["interview_name"].lower()
            or q in r["candidate_name"].lower()
            or q in r["candidate_email"].lower()
            or q in r["job_role"].lower()
            or q in r["interviewer"].lower()
            or any(q in sk.lower() for sk in r.get("skill_tags", []))
        ]

    # 2. Status Filter
    if status and status.lower() != "all":
        st_clean = status.strip().lower()
        filtered_rows = [r for r in filtered_rows if r["status"].lower() == st_clean]

    # 3. Role Filter
    if role and role.lower() != "all":
        r_clean = role.strip().lower()
        filtered_rows = [r for r in filtered_rows if r["job_role"].lower() == r_clean]

    # 4. Skill Tag Filter
    if skill and skill.lower() != "all":
        sk_clean = skill.strip().lower()
        filtered_rows = [
            r for r in filtered_rows
            if any(sk_clean == sk.lower() for sk in r.get("skill_tags", []))
        ]

    # 4. Interviewer Filter
    if interviewer and interviewer.lower() != "all":
        int_clean = interviewer.strip().lower()
        filtered_rows = [r for r in filtered_rows if r["interviewer"].lower() == int_clean]

    # 5. Year Filter
    if year:
        filtered_rows = [r for r in filtered_rows if r["year"] == year]

    # 6. Date Range Filter
    start_dt = None
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        except Exception:
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            except Exception:
                pass

    end_dt = None
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        except Exception:
            try:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d")
                end_dt = end_dt.replace(hour=23, minute=59, second=59)
            except Exception:
                pass

    if start_dt:
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        filtered_rows = [
            r for r in filtered_rows
            if r["date_raw"] and (
                r["date_raw"].astimezone(timezone.utc) if r["date_raw"].tzinfo else r["date_raw"].replace(tzinfo=timezone.utc)
            ) >= start_dt
        ]

    if end_dt:
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        filtered_rows = [
            r for r in filtered_rows
            if r["date_raw"] and (
                r["date_raw"].astimezone(timezone.utc) if r["date_raw"].tzinfo else r["date_raw"].replace(tzinfo=timezone.utc)
            ) <= end_dt
        ]

    # 7. Score Filter
    if score_filter and score_filter != "all":
        if score_filter in ("excellent", "high"):
            filtered_rows = [r for r in filtered_rows if r["score"] is not None and r["score"] >= (85 if score_filter == "excellent" else 80)]
        elif score_filter in ("good", "mid"):
            filtered_rows = [r for r in filtered_rows if r["score"] is not None and (70 <= r["score"] < 85 if score_filter == "good" else 60 <= r["score"] < 80)]
        elif score_filter == "needs_review":
            filtered_rows = [r for r in filtered_rows if r["score"] is not None and 50 <= r["score"] < 70]
        elif score_filter in ("critical", "low"):
            filtered_rows = [r for r in filtered_rows if r["score"] is not None and r["score"] < (50 if score_filter == "critical" else 60)]

    if min_score is not None:
        filtered_rows = [r for r in filtered_rows if r["score"] is not None and r["score"] >= min_score]
    if max_score is not None:
        filtered_rows = [r for r in filtered_rows if r["score"] is not None and r["score"] <= max_score]

    # Calculate Summary Stats for filtered dataset
    total_count = len(filtered_rows)
    completed_reports = len([r for r in filtered_rows if r["status"] == "completed"])
    scored_items = [r["score"] for r in filtered_rows if r["score"] is not None]
    avg_score = round(sum(scored_items) / len(scored_items), 1) if scored_items else 0.0

    # Top role
    role_freq: Dict[str, int] = {}
    for r in filtered_rows:
        role_freq[r["job_role"]] = role_freq.get(r["job_role"], 0) + 1
    top_role = max(role_freq.items(), key=lambda x: x[1])[0] if role_freq else "N/A"

    # Sorting
    reverse = (sort_dir.lower() == "desc")
    if sort_by == "score":
        if reverse:
            # Highest score first, unscored at bottom
            filtered_rows.sort(
                key=lambda r: (1 if r["score"] is not None else 0, r["score"] if r["score"] is not None else -1),
                reverse=True
            )
        else:
            # Lowest score first, unscored at bottom
            filtered_rows.sort(
                key=lambda r: (0 if r["score"] is not None else 1, r["score"] if r["score"] is not None else 9999),
                reverse=False
            )
    elif sort_by == "candidate":
        filtered_rows.sort(key=lambda r: (r.get("candidate_name") or "").lower(), reverse=reverse)
    elif sort_by == "interview_name":
        filtered_rows.sort(key=lambda r: (r.get("interview_name") or "").lower(), reverse=reverse)
    elif sort_by == "role":
        filtered_rows.sort(key=lambda r: (r.get("job_role") or "").lower(), reverse=reverse)
    elif sort_by == "status":
        filtered_rows.sort(key=lambda r: (r.get("status") or "").lower(), reverse=reverse)
    elif sort_by == "interviewer":
        filtered_rows.sort(key=lambda r: (r.get("interviewer") or "").lower(), reverse=reverse)
    else:
        # Default: date
        filtered_rows.sort(
            key=lambda r: r["date_raw"] or datetime.min.replace(tzinfo=timezone.utc),
            reverse=reverse
        )

    # Clean date_raw before serialization
    for r in filtered_rows:
        if "date_raw" in r:
            del r["date_raw"]

    # Pagination
    total_pages = math.ceil(total_count / page_size) if total_count > 0 else 1
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paginated_items = filtered_rows[start_idx:end_idx]

    return {
        "items": paginated_items,
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "summary": {
            "total_interviews": total_count,
            "completed_interviews": completed_reports,
            "completed_reports": completed_reports,
            "avg_score": avg_score,
            "average_score": avg_score,
            "top_role": top_role,
            "high_performers": len([s for s in scored_items if s >= 80]),
        },
        "summary_stats": {
            "total_interviews": total_count,
            "completed_interviews": completed_reports,
            "completed_reports": completed_reports,
            "avg_score": avg_score,
            "average_score": avg_score,
            "top_role": top_role,
            "high_performers": len([s for s in scored_items if s >= 80]),
        },
        "facets": {
            "roles": facets_roles,
            "job_roles": facets_roles,
            "interviewers": facets_interviewers,
            "years": facets_years,
            "statuses": status_counts,
            "skills": facets_skills,
        }
    }


@router.get("/export")
async def export_reports_csv(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    job_role: Optional[str] = Query(None),
    skill: Optional[str] = Query(None),
    interviewer: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    score_filter: Optional[str] = Query(None),
    score_range: Optional[str] = Query(None),
    min_score: Optional[int] = Query(None),
    max_score: Optional[int] = Query(None),
    sort_by: str = Query("date"),
    sort_dir: Optional[str] = Query(None),
    sort_order: Optional[str] = Query(None),
    ctx: UserContext = Depends(require_role([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.RECRUITER])),
    db: AsyncSession = Depends(get_db)
):
    """Export filtered interview history as a CSV file."""
    # Reuse filtering logic by calling get_reports_history with max page size
    data = await get_reports_history(
        page=1,
        page_size=10000,
        search=search,
        status=status,
        role=role or job_role,
        skill=skill,
        interviewer=interviewer,
        year=year,
        start_date=start_date or date_from,
        end_date=end_date or date_to,
        score_filter=score_filter or score_range,
        min_score=min_score,
        max_score=max_score,
        sort_by=sort_by,
        sort_dir=sort_dir or sort_order or "desc",
        ctx=ctx,
        db=db
    )

    items = data.get("items", [])
    output = io.StringIO()
    writer = csv.writer(output)

    # Header Row
    writer.writerow([
        "Interview ID",
        "Interview Name",
        "Candidate Name",
        "Candidate Email",
        "Job Role",
        "Skill Tags",
        "Interviewer",
        "Date",
        "Status",
        "Overall Score (%)",
        "Technical Score (%)",
        "Coding Score (%)",
        "Behavioral Score (%)",
        "AI Recommendation",
        "Duration (Mins)",
        "Short Code"
    ])

    for row in items:
        writer.writerow([
            row.get("interview_id", ""),
            row.get("interview_name", ""),
            row.get("candidate_name", ""),
            row.get("candidate_email", ""),
            row.get("job_role", ""),
            ", ".join(row.get("skill_tags", [])),
            row.get("interviewer", ""),
            row.get("date", ""),
            row.get("status", ""),
            row.get("score") if row.get("score") is not None else "",
            row.get("technical_score") if row.get("technical_score") is not None else "",
            row.get("coding_score") if row.get("coding_score") is not None else "",
            row.get("behavioral_score") if row.get("behavioral_score") is not None else "",
            row.get("ai_recommendation", ""),
            row.get("duration_minutes", ""),
            row.get("short_code", "")
        ])

    output.seek(0)
    filename = f"Interview_Reports_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
