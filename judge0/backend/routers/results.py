import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db, AsyncSessionLocal
from models import (
    User, Interview, InterviewMessage, InterviewQuestion, CodingQuestion,
    CodeSubmission, ScoreAnswersRequest, EvaluateInterviewRequest,
    InterviewSession, InterviewCandidate
)
from auth import get_current_user, get_optional_user
from llm_service import score_answers, evaluate_interview
from evaluation_service import evaluate_all_answers
from utils import _question_to_dict, _message_to_dict
from fastapi import APIRouter, Depends, HTTPException, Header, BackgroundTasks
from logging_config import logger as log
from config import settings
from auth_rbac import get_user_context, get_optional_user_context, UserContext, Role, Permission

router = APIRouter(prefix="/api/functions/v1", tags=["Evaluation"])

async def send_ats_webhook(interview_id: str, db: AsyncSession):
    """
    Sends the evaluation and scorecard data to the Java ATS system webhook callback
    after the interview has been scored/completed.
    """
    try:
        res = await db.execute(select(Interview).where(Interview.id == uuid.UUID(interview_id)))
        interview = res.scalar_one_or_none()
        if not interview:
            log.error(f"[ATS Webhook] Interview {interview_id} not found in DB.")
            return

        # Fetch ATS candidate ID from structured_memory if it exists
        ats_candidate_id = 101
        if interview.structured_memory and isinstance(interview.structured_memory, dict):
            ats_candidate_id = interview.structured_memory.get("ats_candidate_id", 101)

        webhook_url = settings.WEBHOOK_CALLBACK_URL
        
        # map recommendation label to user-friendly string (Selected, Borderline, etc.)
        rec = interview.ai_recommendation
        recommendation_str = "Selected" # default fallback
        if rec == "strongly_recommend":
            recommendation_str = "Selected"
        elif rec == "recommend":
            recommendation_str = "Selected"
        elif rec == "maybe":
            recommendation_str = "Maybe"
        elif rec == "not_recommend":
            recommendation_str = "Rejected"
        elif rec:
            recommendation_str = str(rec).capitalize()

        webhook_secret = getattr(settings, "AI_WEBHOOK_SECRET", "test_ai_webhook_secret")
        
        # Build webhook payload matching Java ATS requirements perfectly
        payload = {
            "interview_id": str(interview.id),
            "candidate_id": ats_candidate_id,
            "overall_score": interview.overall_score or 0,
            "technical_score": interview.technical_score or 0,
            "communication_score": interview.behavioral_score or 0,
            "recommendation": recommendation_str,
            "interview_status": "completed",
            "detailed_result_url": f"{settings.AI_INTERVIEW_BASE_URL}/results?id={interview.id}"
        }

        import httpx
        log.info(f"[ATS Webhook] POSTing webhook callback to {webhook_url} for interview {interview_id}")
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(webhook_url, json=payload, headers={"X-AI-Secret": webhook_secret})
            log.info(f"[ATS Webhook] Webhook response code: {resp.status_code}, response: {resp.text}")
    except Exception as e:
        log.error(f"[ATS Webhook] Exception occurred while sending webhook callback: {e}")

async def run_scoring_task(interview_id: str, job_role: str, candidate_name: str, questions_data: list, code_info: list, total_coding_count: int):
    """Heavy AI scoring logic moved to background task."""
    import asyncio
    import uuid
    from models import Interview
    from database import AsyncSessionLocal
    from sqlalchemy import select
    log.info(f"==> run_scoring_task STARTED for {interview_id} with {len(questions_data)} questions")
    try:
        is_flagged = False
        eval_rubric = None
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(Interview).where(Interview.id == uuid.UUID(interview_id)))
                interview_row = res.scalar_one_or_none()
                if interview_row:
                    is_flagged = (interview_row.status == "flagged")
                    eval_rubric = getattr(interview_row, "evaluation_rubric", None)
        except Exception as db_err:
            log.warning(f"Could not determine flagged status before scoring for {interview_id}: {db_err}")

        # 1. Run Structured Evaluation Pipeline (global 5-min timeout as safety net)
        try:
            evaluation = await asyncio.wait_for(
                evaluate_all_answers(
                    job_role=job_role,
                    candidate_name=candidate_name,
                    questions=questions_data,
                    code_info=code_info,
                    total_coding_count=total_coding_count,
                    is_flagged=is_flagged,
                    evaluation_rubric=eval_rubric,
                ),
                timeout=300.0,  # 5-minute global cap
            )
        except asyncio.TimeoutError:
            log.error(f"[Scoring] evaluate_all_answers timed out after 5 minutes for {interview_id}. Using empty result.")
            evaluation = {"overall_score": 0, "technical_score": None, "coding_score": None, "behavioral_score": None,
                          "recommendation": "not_recommend", "per_question": [], "categories": {}, "strengths": [], "weaknesses": [], "ai_insights": "", "emotions": {}}

        # 2. Persist scores in a new session
        import time
        db_start = time.time()
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(Interview).where(Interview.id == uuid.UUID(interview_id)))
            interview = res.scalar_one_or_none()
            if not interview: return

            q_result = await db.execute(
                select(InterviewQuestion)
                .where(and_(InterviewQuestion.interview_id == interview.id, InterviewQuestion.selected == True))
                .order_by(InterviewQuestion.order_index)
            )
            questions = q_result.scalars().all()

            if evaluation.get("per_question"):
                for pq in evaluation["per_question"]:
                    idx = pq.get("question_index")
                    if idx is not None and idx < len(questions):
                        questions[idx].ai_score    = pq.get("score")
                        questions[idx].ai_feedback = pq.get("feedback")

            interview.overall_score = evaluation.get("overall_score")
            interview.technical_score = evaluation.get("technical_score")
            interview.coding_score = evaluation.get("coding_score")
            interview.behavioral_score = evaluation.get("behavioral_score")
            interview.ai_recommendation = evaluation.get("recommendation")

            # The status should remain 'completed' or 'flagged' after scoring, 
            # 'selected' and 'rejected' are not allowed by the DB check constraint.
            
            mem = dict(interview.structured_memory) if interview.structured_memory else {}
            mem.update({
                "categories": evaluation.get("categories"),
                "strengths":  evaluation.get("strengths"),
                "weaknesses": evaluation.get("weaknesses"),
                "ai_insights": evaluation.get("ai_insights"),
                "emotions": evaluation.get("emotions"),
                "rubric_summary": evaluation.get("rubric_summary"),
                "evaluation_rubric": evaluation.get("evaluation_rubric"),
            })
            
            # Calculate final proctoring/integrity score
            total_strikes = 0
            if interview.proctoring_strikes:
                for k, v in interview.proctoring_strikes.items():
                    if isinstance(v, (int, float)):
                        total_strikes += int(v)
            
            max_strikes = getattr(interview, "proctoring_max_strikes", 3) or 3
            proctoring_score = max(0, 100 - int(total_strikes * 100 / max_strikes))
            mem["proctoring_score"] = proctoring_score
            
            # Enforce candidate evaluation cutoff rules
            overall_score = interview.overall_score if interview.overall_score is not None else 0
            eval_cutoff = getattr(interview, "evaluation_score_cutoff", 60)
            
            # Check if there is an active proctoring violation limit reached or auto-terminated
            is_proctoring_flagged = (
                interview.status == "flagged" or 
                (getattr(interview, "proctoring_enabled", True) and mem.get("proctoring_max_strikes_reached"))
            )

            mem["evaluation_cutoff_violation"] = (overall_score < eval_cutoff)
            
            if is_proctoring_flagged:
                interview.status = "flagged"
            elif overall_score >= eval_cutoff:
                interview.status = "selected"
            else:
                interview.status = "rejected"
                
            interview.structured_memory = mem
            
            await db.commit()
            db_elapsed = time.time() - db_start
            log.info(f"Database processing complete in {db_elapsed:.2f}s")
            log.info(f"Background Scoring complete for {interview_id}")
            try:
                await send_ats_webhook(interview_id, db)
            except Exception as w_err:
                log.error(f"Failed to send ATS webhook inside run_scoring_task: {w_err}")
    except Exception as e:
        log.error(f"Background scoring task failed for interview {interview_id}: {e}")
        try:
            async with AsyncSessionLocal() as db_err_session:
                res = await db_err_session.execute(select(Interview).where(Interview.id == uuid.UUID(interview_id)))
                interview_obj = res.scalar_one_or_none()
                if interview_obj:
                    mem = dict(interview_obj.structured_memory) if interview_obj.structured_memory else {}
                    mem["scoring_status"] = "failed"
                    interview_obj.structured_memory = mem
                    await db_err_session.commit()
                    log.info(f"Marked scoring_status as failed in DB for interview {interview_id}")
        except Exception as db_err:
            log.error(f"Failed to update structured_memory to failed for interview {interview_id}: {db_err}")
async def run_session_scoring_task(session_id: str, interview_id: str, job_role: str, candidate_name: str, questions_data: list, code_info: list, total_coding_count: int):
    """AI scoring logic for multi-candidate InterviewSession."""
    import asyncio
    import uuid
    from models import InterviewSession
    from database import AsyncSessionLocal
    from sqlalchemy import select
    log.info(f"==> run_session_scoring_task STARTED for {session_id} with {len(questions_data)} questions")
    try:
        is_flagged = False
        eval_rubric = None
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(InterviewSession).where(InterviewSession.id == uuid.UUID(session_id)))
                session_row = res.scalar_one_or_none()
                if session_row:
                    is_flagged = (session_row.status == "flagged")
                    tmpl_res = await db.execute(select(Interview.evaluation_rubric).where(Interview.id == session_row.interview_id))
                    eval_rubric = tmpl_res.scalar_one_or_none()
        except Exception as db_err:
            log.warning(f"Could not determine flagged status before scoring for session {session_id}: {db_err}")

        try:
            evaluation = await asyncio.wait_for(
                evaluate_all_answers(
                    job_role=job_role,
                    candidate_name=candidate_name,
                    questions=questions_data,
                    code_info=code_info,
                    total_coding_count=total_coding_count,
                    is_flagged=is_flagged,
                    evaluation_rubric=eval_rubric,
                ),
                timeout=300.0,
            )
        except asyncio.TimeoutError:
            log.error(f"[Scoring] evaluate_all_answers timed out after 5 minutes for session {session_id}. Using empty result.")
            evaluation = {"overall_score": 0, "technical_score": None, "coding_score": None, "behavioral_score": None,
                          "recommendation": "not_recommend", "per_question": [], "categories": {}, "strengths": [], "weaknesses": [], "ai_insights": "", "emotions": {}}

        import time
        db_start = time.time()
        async with AsyncSessionLocal() as db:
            sess_res = await db.execute(select(InterviewSession).where(InterviewSession.id == uuid.UUID(session_id)))
            session = sess_res.scalar_one_or_none()
            if not session:
                log.error(f"Session {session_id} not found for scoring")
                return

            q_result = await db.execute(
                select(InterviewQuestion)
                .where(and_(InterviewQuestion.interview_id == uuid.UUID(interview_id), InterviewQuestion.selected == True))
                .order_by(InterviewQuestion.order_index)
            )
            questions = q_result.scalars().all()

            if evaluation.get("per_question"):
                for pq in evaluation["per_question"]:
                    idx = pq.get("question_index")
                    if idx is not None and idx < len(questions):
                        questions[idx].ai_score    = pq.get("score")
                        questions[idx].ai_feedback = pq.get("feedback")

            session.overall_score       = evaluation.get("overall_score")
            session.technical_score     = evaluation.get("technical_score")
            session.coding_score        = evaluation.get("coding_score")
            session.behavioral_score    = evaluation.get("behavioral_score")
            session.communication_score = evaluation.get("behavioral_score")
            session.ai_recommendation   = evaluation.get("recommendation")

            # The status should remain 'completed' or 'flagged' after scoring, 
            # 'selected' and 'rejected' are not allowed by the DB check constraint.

            mem = dict(session.structured_memory) if session.structured_memory else {}
            mem.update({
                "categories": evaluation.get("categories"),
                "strengths":  evaluation.get("strengths"),
                "weaknesses": evaluation.get("weaknesses"),
                "ai_insights": evaluation.get("ai_insights"),
                "emotions": evaluation.get("emotions"),
                "rubric_summary": evaluation.get("rubric_summary"),
                "evaluation_rubric": evaluation.get("evaluation_rubric"),
            })
            
            # Calculate final proctoring score and compare to cutoff
            total_strikes = 0
            if session.proctoring_alerts:
                for k, v in session.proctoring_alerts.items():
                    if isinstance(v, (int, float)):
                        total_strikes += int(v)
            
            # Load parent interview settings
            res_int = await db.execute(select(Interview).where(Interview.id == session.interview_id))
            interview = res_int.scalar_one_or_none()
            
            if interview:
                max_strikes = getattr(interview, "proctoring_max_strikes", 3) or 3
                proctoring_score = max(0, 100 - int(total_strikes * 100 / max_strikes))
                mem["proctoring_score"] = proctoring_score
                
                # Enforce candidate evaluation cutoff rules using overall_score
                overall_score = session.overall_score if session.overall_score is not None else 0
                eval_cutoff = getattr(interview, "evaluation_score_cutoff", 60)
                
                # Check if there is an active proctoring violation limit reached or auto-terminated
                is_proctoring_flagged = (
                    session.status == "flagged" or 
                    (getattr(interview, "proctoring_enabled", True) and mem.get("proctoring_max_strikes_reached"))
                )

                mem["evaluation_cutoff_violation"] = (overall_score < eval_cutoff)
                
                if is_proctoring_flagged:
                    session.status = "flagged"
                elif overall_score >= eval_cutoff:
                    session.status = "selected"
                else:
                    session.status = "rejected"

                # Synchronize parent interview status with candidate outcome
                try:
                    from models import InterviewCandidate
                    cands_res = await db.execute(
                        select(InterviewCandidate).where(InterviewCandidate.interview_id == interview.id)
                    )
                    all_cands = cands_res.scalars().all()
                    if len(all_cands) <= 1:
                        interview.status = session.status
                    else:
                        other_sessions_res = await db.execute(
                            select(InterviewSession.status).where(
                                and_(
                                    InterviewSession.interview_id == interview.id,
                                    InterviewSession.id != session.id
                                )
                            )
                        )
                        other_statuses = list(other_sessions_res.scalars().all())
                        all_statuses = other_statuses + [session.status]
                        if len(all_statuses) >= len(all_cands) and all(s in ("completed", "selected", "rejected", "flagged") for s in all_statuses):
                            interview.status = "completed"
                        else:
                            interview.status = "in_progress"
                except Exception as sync_err:
                    log.warning(f"Could not sync interview status during scoring: {sync_err}")
            else:
                mem["proctoring_score"] = 100
                mem["evaluation_cutoff_violation"] = False

            session.structured_memory = mem

            await db.commit()
            db_elapsed = time.time() - db_start
            log.info(f"Database processing complete in {db_elapsed:.2f}s")
            log.info(f"Session scoring complete for session {session_id}")
    except Exception as e:
        log.error(f"Session scoring task failed for {session_id}: {e}")
        try:
            async with AsyncSessionLocal() as db_err_session:
                res = await db_err_session.execute(select(InterviewSession).where(InterviewSession.id == uuid.UUID(session_id)))
                session_obj = res.scalar_one_or_none()
                if session_obj:
                    mem = dict(session_obj.structured_memory) if session_obj.structured_memory else {}
                    mem["scoring_status"] = "failed"
                    session_obj.structured_memory = mem
                    await db_err_session.commit()
                    log.info(f"Marked scoring_status as failed in DB for session {session_id}")
        except Exception as db_err:
            log.error(f"Failed to update structured_memory to failed for session {session_id}: {db_err}")


@router.post("/score-answers")
async def score_answers_endpoint(
    body: ScoreAnswersRequest,
    background_tasks: BackgroundTasks,
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    db: AsyncSession = Depends(get_db),
    x_invite_token: Optional[str] = Header(None, alias="x-invite-token"),
):
    """Calculate structured scores for all answers in an interview or session."""
    log.info(f"Scoring answers for interview/session {body.interview_id}")

    import uuid
    obj_id = uuid.UUID(body.interview_id)

    # ── Try InterviewSession first (multi-candidate) ──────────────────────────
    sess_res = await db.execute(
        select(InterviewSession)
        .options(
            __import__("sqlalchemy.orm", fromlist=["selectinload"]).selectinload(InterviewSession.candidate)
        )
        .where(InterviewSession.id == obj_id)
    )
    session = sess_res.scalar_one_or_none()

    if session:
        # Fetch parent interview to check tenant/recruiter
        parent_res = await db.execute(select(Interview).where(Interview.id == session.interview_id))
        parent = parent_res.scalar_one_or_none()
        if not parent:
            raise HTTPException(404, "Parent interview not found")

        # Auth: candidate via session_token
        permission_granted = False
        if x_invite_token and session.session_token == x_invite_token:
            permission_granted = True
            from utils import check_access_status, raise_access_blocked_exception
            access_status = check_access_status(session, parent)
            if access_status in ("NOT_YET_AVAILABLE", "EXPIRED"):
                raise_access_blocked_exception(access_status, parent)
        elif ctx and ctx.user:
            if parent and str(parent.tenant_id) == str(ctx.tenant_id):
                if ctx.role in [Role.ADMIN, Role.MANAGER]:
                    permission_granted = True
                elif ctx.role == Role.RECRUITER and str(parent.recruiter_id) == str(ctx.user.id):
                    permission_granted = True

        if not permission_granted:
            log.warning(f"Unauthorized scoring attempt for session: {body.interview_id}. ctx.role={ctx.role if ctx else None}, ctx.tenant={ctx.tenant_id if ctx else None}, sess.tenant={parent.tenant_id if parent else None}, ctx.user.id={ctx.user.id if ctx and ctx.user else None}")
            raise HTTPException(403, "Access denied")

        # Fetch questions from the parent interview template
        interview_id = session.interview_id
        q_result = await db.execute(
            select(InterviewQuestion)
            .where(and_(InterviewQuestion.interview_id == interview_id, InterviewQuestion.selected == True))
            .order_by(InterviewQuestion.order_index)
        )
        questions = q_result.scalars().all()

        cq_result = await db.execute(
            select(CodingQuestion).where(CodingQuestion.interview_id == interview_id)
        )
        all_coding_qs = cq_result.scalars().all()

        if parent.is_multi_candidate:
            cs_result = await db.execute(
                select(CodeSubmission).where(CodeSubmission.session_id == session.id)
            )
        else:
            cs_result = await db.execute(
                select(CodeSubmission).where(CodeSubmission.interview_id == session.id)
            )
        code_subs = cs_result.scalars().all()

        if not questions and not code_subs and not all_coding_qs:
            raise HTTPException(400, "No data to evaluate")

        code_info = [
            {
                "question_id": str(cs.question_id) if cs.question_id else None,
                "language": cs.language,
                "passed_tests": cs.passed_tests,
                "total_tests": cs.total_tests,
                "code_snippet": cs.code[:1000],
                "status": cs.status
            }
            for cs in code_subs
        ]

        questions_data = []
        for q in questions:
            qd = _question_to_dict(q)
            if session.answers and str(q.id) in session.answers:
                qd["candidate_answer"] = session.answers[str(q.id)]
            questions_data.append(qd)

        # Calculate duration
        if session.started_at:
            from datetime import datetime, timezone
            delta = datetime.now(timezone.utc) - session.started_at
            completed_at = datetime.now(timezone.utc)
            session.completed_at = completed_at

        # Mark session as completed
        # Keep status as pending/flagged during evaluation
        await db.commit()

        # Get candidate name and job_role for scoring
        candidate = session.candidate
        candidate_name = (candidate.candidate_name or candidate.candidate_email or "Candidate") if candidate else "Candidate"

        # Pre-fetch job_role before spawning background task
        parent_for_role = await db.execute(select(Interview.job_role).where(Interview.id == interview_id))
        job_role = parent_for_role.scalar() or "Unknown Role"

        background_tasks.add_task(
            run_session_scoring_task,
            str(session.id),
            str(interview_id),
            job_role,
            candidate_name,
            questions_data,
            code_info,
            len(all_coding_qs)
        )

        return {"status": "processing", "message": "Session scoring started in background"}

    # ── Fallback: single-candidate Interview ──────────────────────────────────
    res = await db.execute(select(Interview).where(Interview.id == obj_id))
    interview = res.scalar_one_or_none()
    
    if not interview:
        raise HTTPException(404, "Interview not found")
        
    permission_granted = False
    if ctx and ctx.user:
        # User is authenticated via JWT
        if str(interview.tenant_id) == str(ctx.tenant_id):
            if ctx.role in [Role.ADMIN, Role.MANAGER]:
                permission_granted = True
            elif ctx.role == Role.RECRUITER and str(interview.recruiter_id) == str(ctx.user.id):
                permission_granted = True
    elif x_invite_token and interview.invite_token == x_invite_token:
        # Candidate is authenticated via invite token
        permission_granted = True
        from utils import check_access_status, raise_access_blocked_exception
        access_status = check_access_status(interview, interview)
        if access_status in ("NOT_YET_AVAILABLE", "EXPIRED"):
            raise_access_blocked_exception(access_status, interview)
        
    if not permission_granted:
        log.warning(f"Unauthorized scoring attempt for interview: {body.interview_id}. ctx.role={ctx.role if ctx else None}, ctx.tenant={ctx.tenant_id if ctx else None}, int.tenant={interview.tenant_id}, ctx.user.id={ctx.user.id if ctx and ctx.user else None}")
        raise HTTPException(403, "Access denied")

    q_result = await db.execute(
        select(InterviewQuestion)
        .where(
            and_(
                InterviewQuestion.interview_id == interview.id,
                InterviewQuestion.selected == True,
            )
        )
        .order_by(InterviewQuestion.order_index)
    )
    questions = q_result.scalars().all()
    
    # Fetch coding questions to know the total count
    cq_result = await db.execute(
        select(CodingQuestion).where(CodingQuestion.interview_id == interview.id)
    )
    all_coding_qs = cq_result.scalars().all()

    # Fetch code submissions
    cs_result = await db.execute(
        select(CodeSubmission).where(CodeSubmission.interview_id == interview.id)
    )
    code_subs = cs_result.scalars().all()

    if not questions and not code_subs and not all_coding_qs:
        raise HTTPException(400, "No data to evaluate")

    code_info = [
        {
            "question_id": str(cs.question_id) if cs.question_id else None,
            "language": cs.language,
            "passed_tests": cs.passed_tests,
            "total_tests": cs.total_tests,
            "code_snippet": cs.code[:1000],
            "status": cs.status
        }
        for cs in code_subs
    ]

    # Prepare data for background task
    questions_data = [_question_to_dict(q) for q in questions]
    
    # Calculate duration
    if interview.started_at:
        from datetime import datetime, timezone
        delta = datetime.now(timezone.utc) - interview.started_at
        interview.duration_seconds = int(delta.total_seconds())

    # Keep status as pending/flagged during evaluation
    await db.commit()

    # Trigger background scoring
    background_tasks.add_task(
        run_scoring_task,
        str(interview.id),
        interview.job_role,
        interview.candidate_name,
        questions_data,
        code_info,
        len(all_coding_qs)
    )

    return {"status": "processing", "message": "Scoring started in background"}


@router.post("/evaluate-interview")
async def evaluate_interview_endpoint(
    body: EvaluateInterviewRequest,
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    db: AsyncSession = Depends(get_db),
    x_invite_token: Optional[str] = Header(None, alias="x-invite-token"),
):
    """Generate final qualitative evaluation summary."""
    log.info(f"Generating full evaluation for interview {body.interview_id}")
    
    # Authorization Check
    import uuid
    res = await db.execute(select(Interview).where(Interview.id == uuid.UUID(body.interview_id)))
    interview = res.scalar_one_or_none()
    
    if not interview:
        raise HTTPException(404, "Interview not found")
        
    permission_granted = False
    if ctx and ctx.user:
        if str(interview.tenant_id) == str(ctx.tenant_id):
            if ctx.role in [Role.ADMIN, Role.MANAGER]:
                permission_granted = True
            elif ctx.role == Role.RECRUITER and str(interview.recruiter_id) == str(ctx.user.id):
                permission_granted = True
    elif x_invite_token and interview.invite_token == x_invite_token:
        permission_granted = True
        from utils import check_access_status, raise_access_blocked_exception
        access_status = check_access_status(interview, interview)
        if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
            raise_access_blocked_exception(access_status, interview)
        
    if not permission_granted:
        log.warning(f"Unauthorized evaluation attempt for interview: {body.interview_id}")
        raise HTTPException(403, "Access denied")

    msgs_res = await db.execute(
        select(InterviewMessage)
        .where(InterviewMessage.interview_id == interview.id)
        .order_by(InterviewMessage.created_at)
    )
    code_res = await db.execute(
        select(CodeSubmission).where(CodeSubmission.interview_id == interview.id)
    )

    evaluation = await evaluate_interview(
        job_role=interview.job_role,
        messages_list=[_message_to_dict(m) for m in msgs_res.scalars().all()],
        code_submissions=[{"language": s.language, "passed_tests": s.passed_tests, "total_tests": s.total_tests, "code": s.code} for s in code_res.scalars().all()]
    )

    # Sync result back to main record
    interview.overall_score = evaluation.get("overall_score")
    interview.ai_recommendation = evaluation.get("recommendation")
    
    await db.commit()

    try:
        await send_ats_webhook(str(interview.id), db)
    except Exception as w_err:
        log.error(f"Failed to send ATS webhook inside evaluate_interview_endpoint: {w_err}")

    return evaluation
