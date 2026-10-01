import uuid
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, Interview, InterviewQuestion, Membership
from config import settings
from llm_service import generate_questions

log = logging.getLogger("backend")

router = APIRouter(tags=["ATS"])

class ATSInterviewCreateRequest(BaseModel):
    candidate_name: str
    candidate_email: str
    job_role: str
    interview_level: str
    parsed_skills: Optional[Any] = None
    JD: Optional[str] = None
    candidate_id: Optional[int] = None

@router.post("/create-interview", status_code=status.HTTP_201_CREATED)
async def create_interview(
    body: ATSInterviewCreateRequest,
    x_ats_token: str = Header(..., alias="X-ATS-Token"),
    db: AsyncSession = Depends(get_db)
):
    # 1. Validate X-ATS-Token header
    expected_token = getattr(settings, "ATS_API_KEY", "test_ats_secret_token")
    if x_ats_token != expected_token:
        log.warning(f"Unauthorized ATS access attempt with token: {x_ats_token}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid ATS Token"
        )

    # 2. Get JD/skills text for question generation
    jd_text = ""
    if body.JD:
        jd_text = body.JD
    elif body.parsed_skills:
        if isinstance(body.parsed_skills, list):
            jd_text = ", ".join(body.parsed_skills)
        else:
            jd_text = str(body.parsed_skills)
            
    if not jd_text.strip():
        jd_text = f"Job Role: {body.job_role}, Level: {body.interview_level}"

    # 3. Resolve default User and Tenant
    user_stmt = select(User).where(User.email == "admin@gmail.com")
    user_res = await db.execute(user_stmt)
    user = user_res.scalar_one_or_none()
    if not user:
        user_res = await db.execute(select(User).limit(1))
        user = user_res.scalar_one_or_none()
        
    if not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No default user found in system database to assign interview ownership."
        )
        
    tenant_id = None
    member_stmt = select(Membership).where(Membership.user_id == user.id).limit(1)
    member_res = await db.execute(member_stmt)
    membership = member_res.scalar_one_or_none()
    if membership:
        tenant_id = membership.tenant_id

    # 4. Generate AI questions using existing LLM service
    try:
        questions_data = await generate_questions(jd_text, experience_level=body.interview_level)
    except Exception as e:

        log.error(f"Failed to generate questions via LLM: {e}")
        # fallback questions if LLM fails, so the integration doesn't break
        questions_data = [
            {"question_text": f"What is your experience working as a {body.job_role}?", "question_type": "technical", "difficulty": "medium"},
            {"question_text": "Explain a challenging project you worked on and how you resolved issues.", "question_type": "technical", "difficulty": "hard"},
            {"question_text": "How do you handle disagreement with senior developers in your team?", "question_type": "behavioral", "difficulty": "medium"}
        ]

    # 5. Create interview session in DB
    invite_token = str(uuid.uuid4())
    interview_id = uuid.uuid4()
    
    # Store candidates' ATS ID inside structured_memory
    structured_memory = {
        "skill_scores": {}, "weak_areas": [], "strong_areas": [], 
        "current_focus_skill": "", "difficulty_level": 1, "state": "INTRO"
    }
    if body.candidate_id is not None:
        structured_memory["ats_candidate_id"] = body.candidate_id

    from utils import generate_base62_short_code
    short_code = None
    for _ in range(10):
        code = generate_base62_short_code()
        existing = await db.execute(select(Interview.id).where(Interview.short_code == code))
        if not existing.scalar_one_or_none():
            short_code = code
            break
            
    if not short_code:
        raise HTTPException(status_code=500, detail="Failed to generate a unique short code")

    interview = Interview(
        id=interview_id,
        user_id=user.id,
        tenant_id=tenant_id,
        manager_id=user.id,
        recruiter_id=user.id,
        created_by=user.id,
        candidate_id=uuid.uuid4(),
        candidate_name=body.candidate_name,
        candidate_email=body.candidate_email,
        candidate_experience=body.interview_level,
        job_role=body.job_role,
        invite_token=invite_token,
        short_code=short_code,
        jd_text=jd_text,
        save_video_recording=False,
        show_candidate_video=True,
        duration_minutes=30,
        status="pending",
        current_round="behavioral",
        structured_memory=structured_memory
    )
    db.add(interview)

    # Prepend default questions and save all questions
    from routers.ai import DEFAULT_QUESTIONS
    all_questions = []
    for q in DEFAULT_QUESTIONS:
        all_questions.append({**q, "selected": True})
        
    for q in questions_data:
        all_questions.append({**q, "selected": True})

    # Ensure current_round aligns with active questions
    has_behavioral = any(q.get("question_type") == "behavioral" for q in all_questions)
    interview.current_round = "behavioral" if has_behavioral else "technical"

    inserted_questions = []
    for idx, q in enumerate(all_questions):
        new_q = InterviewQuestion(
            interview_id=interview_id,
            tenant_id=tenant_id,
            question_text=q.get("question_text", "Sample Question?"),
            question_type=q.get("question_type", "technical").strip().lower() if q.get("question_type", "").strip().lower() in ["technical", "coding", "behavioral"] else "technical",
            difficulty=q.get("difficulty", "medium").strip().lower() if q.get("difficulty", "").strip().lower() in ["easy", "medium", "hard"] else "medium",
            selected=q.get("selected", True),
            order_index=idx,
            source=q.get("source", "generated"),
            rubric={"tag": q.get("tag")} if q.get("tag") else None
        )
        db.add(new_q)
        inserted_questions.append(new_q)

    await db.commit()

    # Interview Link Format: {settings.AI_INTERVIEW_BASE_URL}/i/{short_code}
    interview_link = f"{settings.AI_INTERVIEW_BASE_URL}/i/{short_code}"

    return {
        "interview_id": str(interview_id),
        "generated_questions": [q.question_text for q in inserted_questions if q.source == "generated" or q.question_text not in [dq["question_text"] for dq in DEFAULT_QUESTIONS]],
        "interview_link": interview_link
    }

@router.get("/status/{interview_id}")
async def get_interview_status(
    interview_id: str,
    x_ats_token: str = Header(..., alias="X-ATS-Token"),
    db: AsyncSession = Depends(get_db)
):
    expected_token = getattr(settings, "ATS_API_KEY", "test_ats_secret_token")
    if x_ats_token != expected_token:
        raise HTTPException(status_code=401, detail="Invalid ATS Token")
        
    stmt = select(Interview).where(Interview.id == interview_id)
    res = await db.execute(stmt)
    interview = res.scalar_one_or_none()
    
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
        
    return {
        "interview_id": str(interview.id),
        "status": interview.status,
        "ats_candidate_id": interview.structured_memory.get("ats_candidate_id") if interview.structured_memory else None
    }

@router.get("/results/{interview_id}")
async def get_interview_results(
    interview_id: str,
    x_ats_token: str = Header(..., alias="X-ATS-Token"),
    db: AsyncSession = Depends(get_db)
):
    expected_token = getattr(settings, "ATS_API_KEY", "test_ats_secret_token")
    if x_ats_token != expected_token:
        raise HTTPException(status_code=401, detail="Invalid ATS Token")
        
    stmt = select(Interview).where(Interview.id == interview_id)
    res = await db.execute(stmt)
    interview = res.scalar_one_or_none()
    
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
        
    if interview.status not in ["completed", "flagged"]:
        return {"status": interview.status, "message": "Evaluation pending or incomplete"}
        
    return {
        "interview_id": str(interview.id),
        "status": interview.status,
        "score_data": interview.score_data,
        "video_url": interview.video_url,
        "structured_memory": interview.structured_memory,
        "ats_candidate_id": interview.structured_memory.get("ats_candidate_id") if interview.structured_memory else None,
        "report_url": f"{settings.RESULTS_BASE_URL}/results?id={interview.id}"
    }
