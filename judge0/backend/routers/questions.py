import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import User, Interview, InterviewQuestion, QuestionCreateRequest
from auth import get_current_user, get_optional_user
from utils import _question_to_dict
from logging_config import logger as log
from auth_rbac import get_user_context, get_optional_user_context, UserContext, Role, Permission

router = APIRouter(prefix="/api/rest/v1", tags=["Questions"])

# Fields that can be updated by candidates vs recruiters
candidate_fields = ["candidate_answer"]
recruiter_fields = [
    "selected", "question_text", "question_type", "difficulty", 
    "order_index", "ideal_answer", "rubric", "ai_score", "ai_feedback"
]

from pydantic import BaseModel

class BatchSelectionItem(BaseModel):
    id: str
    selected: bool

class BatchSelectionRequest(BaseModel):
    selections: List[BatchSelectionItem]

@router.get("/interview_questions")
async def list_questions(
    interview_id: str = Query(...),
    selected: Optional[str] = Query(None),
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    invite_token: Optional[str] = Header(None, alias="x-invite-token"),
    db: AsyncSession = Depends(get_db),
):
    """List questions for an interview (JWT or invite token access)."""
    try:
        obj_uuid = uuid.UUID(str(interview_id).strip())
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid interview_id format")

    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        # 1. Try to find as Interview first
        r = await db.execute(select(Interview).where(Interview.id == obj_uuid))
        interview = r.scalar_one_or_none()
        session = None
        actual_interview_id = obj_uuid

        if not interview:
            # 2. Try to find as InterviewSession (multi-candidate session ID)
            from models import InterviewSession
            sess_r = await db.execute(
                select(InterviewSession).where(InterviewSession.id == obj_uuid)
            )
            session = sess_r.scalar_one_or_none()
            if session:
                actual_interview_id = session.interview_id
                r = await db.execute(select(Interview).where(Interview.id == actual_interview_id))
                interview = r.scalar_one_or_none()

        if not interview:
            raise HTTPException(404, "Interview not found")

        # Authorization logic
        if invite_token:
            authorized = False
            if str(interview.invite_token) == str(invite_token):
                authorized = True
            elif session and str(session.session_token) == str(invite_token):
                authorized = True
            else:
                from models import InterviewSession
                check_sess = await db.execute(
                    select(InterviewSession).where(
                        and_(
                            InterviewSession.session_token == invite_token,
                            InterviewSession.interview_id == actual_interview_id
                        )
                    )
                )
                matched_sess = check_sess.scalar_one_or_none()
                if matched_sess:
                    session = matched_sess
                    authorized = True
            
            if not authorized:
                raise HTTPException(403, "Invalid invite token")
            
            # Enforce access window check
            from utils import check_access_status, raise_access_blocked_exception
            access_status = check_access_status(session or interview, interview)
            if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
                raise_access_blocked_exception(access_status, interview)
            
            # Candidates only see selected questions
            result = await db.execute(
                select(InterviewQuestion)
                .where(
                    and_(
                        InterviewQuestion.interview_id == actual_interview_id,
                        InterviewQuestion.selected == True,
                    )
                )
                .order_by(InterviewQuestion.order_index)
            )
        elif ctx and ctx.user:
            is_super = (
                ctx.role == Role.SUPER_ADMIN
                or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
            )
            same_tenant = (
                ctx.tenant_id is not None
                and interview.tenant_id is not None
                and str(interview.tenant_id) == str(ctx.tenant_id)
            )
            is_owner = (
                ctx.user.id is not None
                and interview.user_id is not None
                and str(interview.user_id) == str(ctx.user.id)
            )

            if not (is_super or same_tenant or is_owner):
                from models import Membership
                m_check = await db.execute(
                    select(Membership).where(
                        and_(
                            Membership.user_id == ctx.user.id,
                            Membership.tenant_id == interview.tenant_id
                        )
                    )
                )
                if not m_check.scalar_one_or_none():
                    raise HTTPException(403, "Forbidden")
            
            if ctx.role == Role.RECRUITER and not is_owner and not is_super:
                raise HTTPException(403, "Forbidden")
            
            if ctx.role == Role.MANAGER and not is_super:
                if str(interview.user_id) != str(ctx.user.id):
                    from models import Membership
                    reporting_check = await db.execute(
                        select(Membership).where(
                            and_(
                                Membership.user_id == interview.user_id,
                                Membership.manager_id == ctx.user.id,
                                Membership.tenant_id == interview.tenant_id
                            )
                        )
                    )
                    if not reporting_check.scalar_one_or_none():
                        raise HTTPException(403, "Forbidden")

            # Optionally filter by selected
            q_select = select(InterviewQuestion).where(InterviewQuestion.interview_id == actual_interview_id)
            if selected is not None:
                q_select = q_select.where(InterviewQuestion.selected == (selected.lower() == "true"))
            result = await db.execute(q_select.order_by(InterviewQuestion.order_index))
        else:
            raise HTTPException(401, "Not authenticated")

        questions_list = result.scalars().all()
        response_list = []
        session_answers = session.answers if (session and session.answers) else {}
        for q in questions_list:
            d = _question_to_dict(q)
            if session:
                d["candidate_answer"] = session_answers.get(str(q.id))
            response_list.append(d)
        return response_list
    finally:
        db.info["tenant_id"] = _old_tenant


@router.get("/interview_questions/{question_id}")
async def get_question(
    question_id: str,
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    invite_token: Optional[str] = Header(None, alias="x-invite-token"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single question by ID (JWT or invite token access)."""
    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        try:
            q_uuid = uuid.UUID(str(question_id).strip())
        except (ValueError, AttributeError):
            raise HTTPException(400, "Invalid question ID format")

        result = await db.execute(
            select(InterviewQuestion).where(InterviewQuestion.id == q_uuid)
        )
        q = result.scalar_one_or_none()
        if not q:
            raise HTTPException(404, "Question not found")

        r = await db.execute(select(Interview).where(Interview.id == q.interview_id))
        interview = r.scalar_one_or_none()
        if not interview:
            raise HTTPException(404, "Interview not found")

        session = None
        if ctx and ctx.user:
            is_super = ctx.role == Role.SUPER_ADMIN or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
            same_tenant = ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id)
            is_owner = ctx.user.id and str(interview.user_id) == str(ctx.user.id)
            if not (is_super or same_tenant or is_owner):
                from models import Membership
                m_check = await db.execute(
                    select(Membership).where(
                        and_(
                            Membership.user_id == ctx.user.id,
                            Membership.tenant_id == interview.tenant_id
                        )
                    )
                )
                if not m_check.scalar_one_or_none():
                    raise HTTPException(403, "Forbidden")
        elif invite_token:
            authorized = False
            if str(interview.invite_token) == str(invite_token):
                authorized = True
            else:
                from models import InterviewSession
                sess_r = await db.execute(
                    select(InterviewSession).where(
                        and_(
                            InterviewSession.session_token == invite_token,
                            InterviewSession.interview_id == q.interview_id
                        )
                    )
                )
                session = sess_r.scalar_one_or_none()
                if session:
                    authorized = True
            
            if not authorized:
                raise HTTPException(403, "Invalid invite token")

            from utils import check_access_status, raise_access_blocked_exception
            access_status = check_access_status(session or interview, interview)
            if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
                raise_access_blocked_exception(access_status, interview)
        else:
            raise HTTPException(401, "Not authenticated")

        d = _question_to_dict(q)
        if session:
            session_answers = session.answers if session.answers else {}
            d["candidate_answer"] = session_answers.get(str(q.id))
        return d
    finally:
        db.info["tenant_id"] = _old_tenant


@router.patch("/interview_questions/{question_id}")
async def update_question(
    question_id: str,
    body: Dict[str, Any],
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    invite_token: Optional[str] = Header(None, alias="x-invite-token"),
    db: AsyncSession = Depends(get_db),
):
    """Update question state or answer (JWT or invite token access)."""
    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        try:
            q_uuid = uuid.UUID(str(question_id).strip())
        except (ValueError, AttributeError):
            raise HTTPException(400, "Invalid question ID format")

        result = await db.execute(
            select(InterviewQuestion).where(InterviewQuestion.id == q_uuid)
        )
        q = result.scalar_one_or_none()
        if not q:
            raise HTTPException(404, "Question not found")

        r = await db.execute(select(Interview).where(Interview.id == q.interview_id))
        interview = r.scalar_one_or_none()
        if not interview:
            raise HTTPException(404, "Interview not found")

        session = None
        # Authorise: recruiter/admin owns/shares tenant OR candidate has matching token
        if ctx and ctx.user:
            is_super = ctx.role == Role.SUPER_ADMIN or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
            same_tenant = ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id)
            is_owner = ctx.user.id and str(interview.user_id) == str(ctx.user.id)
            
            if not (is_super or same_tenant or is_owner):
                from models import Membership
                m_check = await db.execute(
                    select(Membership).where(
                        and_(
                            Membership.user_id == ctx.user.id,
                            Membership.tenant_id == interview.tenant_id
                        )
                    )
                )
                if not m_check.scalar_one_or_none():
                    raise HTTPException(403, "Forbidden")

            if ctx.role == Role.RECRUITER and not is_owner and not is_super:
                raise HTTPException(403, "Forbidden")
        elif invite_token:
            authorized = False
            if str(interview.invite_token) == str(invite_token):
                authorized = True
            else:
                from models import InterviewSession
                sess_r = await db.execute(
                    select(InterviewSession).where(
                        and_(
                            InterviewSession.session_token == invite_token,
                            InterviewSession.interview_id == q.interview_id
                        )
                    )
                )
                session = sess_r.scalar_one_or_none()
                if session:
                    authorized = True
                
            if not authorized:
                raise HTTPException(403, "Invalid invite token")

            from utils import check_access_status, raise_access_blocked_exception
            access_status = check_access_status(session or interview, interview)
            if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
                raise_access_blocked_exception(access_status, interview)
        else:
            raise HTTPException(401, "Not authenticated")
        
        is_recruiter = ctx is not None and ctx.user is not None

        for field, value in body.items():
            if field in candidate_fields:
                if field == "candidate_answer":
                    if session:
                        existing = (session.answers or {}).get(str(q.id), "")
                    else:
                        existing = getattr(q, "candidate_answer", "") or ""
                    
                    if "[Initial Answer]" in existing and "[Initial Answer]" not in value:
                        import re
                        clean_existing = re.sub(r"\[Follow-up Answer\].*", "", existing, flags=re.DOTALL).strip()
                        value = f"{clean_existing}\n\n[Follow-up Answer]\n{value}"
                        
                if session:
                    sess_answers = dict(session.answers) if session.answers else {}
                    sess_answers[str(q.id)] = value
                    session.answers = sess_answers
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(session, "answers")
                    db.add(session)
                else:
                    setattr(q, field, value)
            elif field in recruiter_fields and is_recruiter:
                if field == "question_text" and value:
                    import re
                    norm_incoming = re.sub(r'[^\w\s]', '', str(value).lower()).strip()
                    norm_incoming = re.sub(r'\s+', ' ', norm_incoming)
                    other_qs_res = await db.execute(
                        select(InterviewQuestion.question_text).where(
                            and_(
                                InterviewQuestion.interview_id == q.interview_id,
                                InterviewQuestion.id != q.id
                            )
                        )
                    )
                    for row in other_qs_res.scalars().all():
                        norm_existing = re.sub(r'[^\w\s]', '', (row or '').lower()).strip()
                        norm_existing = re.sub(r'\s+', ' ', norm_existing)
                        if norm_incoming and norm_incoming == norm_existing:
                            raise HTTPException(400, "Another question with this wording already exists in this interview.")
                    log.info(f"Question {q.id} edited. Source: {q.source}")
                setattr(q, field, value)

        await db.commit()
        if not session:
            await db.refresh(q)
        
        d = _question_to_dict(q)
        if session:
            session_answers = session.answers if session.answers else {}
            d["candidate_answer"] = session_answers.get(str(q.id))
        return d
    finally:
        db.info["tenant_id"] = _old_tenant


@router.patch("/interview_questions_batch")
async def update_questions_batch(
    body: BatchSelectionRequest,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Batch update selection status for questions."""
    if not body.selections:
        return {"updated": 0}

    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        id_map = {}
        for item in body.selections:
            try:
                id_map[uuid.UUID(str(item.id).strip())] = item.selected
            except (ValueError, AttributeError):
                continue

        if not id_map:
            return {"updated": 0}

        result = await db.execute(
            select(InterviewQuestion).where(InterviewQuestion.id.in_(list(id_map.keys())))
        )
        questions = result.scalars().all()
        if not questions:
            return {"updated": 0}

        # Check authorization on the parent interview of the first question
        first_q = questions[0]
        r = await db.execute(select(Interview).where(Interview.id == first_q.interview_id))
        interview = r.scalar_one_or_none()
        if not interview:
            raise HTTPException(404, "Interview not found")

        is_super = ctx.role == Role.SUPER_ADMIN or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
        same_tenant = ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id)
        is_owner = ctx.user.id and str(interview.user_id) == str(ctx.user.id)
        if not (is_super or same_tenant or is_owner):
            from models import Membership
            m_check = await db.execute(
                select(Membership).where(
                    and_(
                        Membership.user_id == ctx.user.id,
                        Membership.tenant_id == interview.tenant_id
                    )
                )
            )
            if not m_check.scalar_one_or_none():
                raise HTTPException(403, "Forbidden")

        for q in questions:
            if q.id in id_map:
                q.selected = id_map[q.id]

        await db.commit()
        return {"updated": len(questions)}
    finally:
        db.info["tenant_id"] = _old_tenant


@router.post("/interview_questions", status_code=201)
async def create_custom_question(
    body: QuestionCreateRequest,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Add a custom question to an interview (Recruiter only)."""
    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        try:
            i_uuid = uuid.UUID(str(body.interview_id).strip())
        except (ValueError, AttributeError):
            raise HTTPException(400, "Invalid interview ID format")

        r = await db.execute(select(Interview).where(Interview.id == i_uuid))
        interview = r.scalar_one_or_none()
        if not interview:
            raise HTTPException(404, "Interview not found")

        is_super = ctx.role == Role.SUPER_ADMIN or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
        same_tenant = ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id)
        is_owner = ctx.user.id and str(interview.user_id) == str(ctx.user.id)

        if not (is_super or same_tenant or is_owner):
            from models import Membership
            m_check = await db.execute(
                select(Membership).where(
                    and_(
                        Membership.user_id == ctx.user.id,
                        Membership.tenant_id == interview.tenant_id
                    )
                )
            )
            if not m_check.scalar_one_or_none():
                raise HTTPException(403, "Forbidden")
        
        if ctx.role == Role.RECRUITER and not is_owner and not is_super:
            raise HTTPException(403, "Forbidden")

        # Check for duplicate question in this interview
        import re
        norm_incoming = re.sub(r'[^\w\s]', '', (body.question_text or '').lower()).strip()
        norm_incoming = re.sub(r'\s+', ' ', norm_incoming)

        existing_qs_res = await db.execute(
            select(InterviewQuestion.question_text).where(InterviewQuestion.interview_id == i_uuid)
        )
        for row in existing_qs_res.scalars().all():
            norm_existing = re.sub(r'[^\w\s]', '', (row or '').lower()).strip()
            norm_existing = re.sub(r'\s+', ' ', norm_existing)
            if norm_incoming and norm_incoming == norm_existing:
                raise HTTPException(400, "This question has already been added to this interview.")

        # Calculate next order_index
        max_idx_result = await db.execute(
            select(InterviewQuestion.order_index)
            .where(InterviewQuestion.interview_id == i_uuid)
            .order_by(InterviewQuestion.order_index.desc())
            .limit(1)
        )
        max_row = max_idx_result.scalar_one_or_none()
        next_idx = (max_row + 1) if max_row is not None else 0

        new_q = InterviewQuestion(
            interview_id=i_uuid,
            tenant_id=interview.tenant_id,
            question_text=body.question_text,
            question_type=body.question_type,
            difficulty=body.difficulty,
            selected=body.selected,
            order_index=next_idx,
            source="custom",
        )
        db.add(new_q)
        await db.commit()
        await db.refresh(new_q)
        log.info(f"Custom question added to interview {body.interview_id}")
        return _question_to_dict(new_q)
    finally:
        db.info["tenant_id"] = _old_tenant


@router.delete("/interview_questions/{question_id}")
async def delete_question(
    question_id: str,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Remove a question from an interview (Recruiter only)."""
    _old_tenant = db.info.get("tenant_id")
    db.info["tenant_id"] = None
    try:
        try:
            q_uuid = uuid.UUID(str(question_id).strip())
        except (ValueError, AttributeError):
            raise HTTPException(400, "Invalid question ID format")

        result = await db.execute(
            select(InterviewQuestion).where(InterviewQuestion.id == q_uuid)
        )
        q = result.scalar_one_or_none()
        if not q:
            raise HTTPException(404, "Question not found")

        # Ownership/Tenant check
        r = await db.execute(select(Interview).where(Interview.id == q.interview_id))
        interview = r.scalar_one_or_none()
        if not interview:
            raise HTTPException(404, "Interview not found")
        
        is_super = ctx.role == Role.SUPER_ADMIN or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
        same_tenant = ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id)
        is_owner = ctx.user.id and str(interview.user_id) == str(ctx.user.id)

        if not (is_super or same_tenant or is_owner):
            from models import Membership
            m_check = await db.execute(
                select(Membership).where(
                    and_(
                        Membership.user_id == ctx.user.id,
                        Membership.tenant_id == interview.tenant_id
                    )
                )
            )
            if not m_check.scalar_one_or_none():
                raise HTTPException(403, "Forbidden")
            
        if ctx.role == Role.RECRUITER and not is_owner and not is_super:
            raise HTTPException(403, "Forbidden")

        await db.delete(q)
        await db.commit()
        log.info(f"Question deleted: {question_id}")
        return {"message": "Question deleted", "id": question_id}
    finally:
        db.info["tenant_id"] = _old_tenant
