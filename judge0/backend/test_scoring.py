import asyncio
import uuid
import sys
import logging
from database import AsyncSessionLocal
from routers.results import run_scoring_task
from models import Interview, InterviewQuestion, CodingQuestion, CodeSubmission
from sqlalchemy import select, and_
from utils import _question_to_dict

logger = logging.getLogger("intellihire")
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler()
logger.addHandler(handler)

async def test():
    interview_id = "6a53ede4-756c-4123-9880-28e40d95549b"
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Interview).where(Interview.id == uuid.UUID(interview_id)))
        interview = res.scalar_one_or_none()
        if not interview:
            print("Interview not found")
            return
            
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
        
        cq_result = await db.execute(
            select(CodingQuestion).where(CodingQuestion.interview_id == interview.id)
        )
        all_coding_qs = cq_result.scalars().all()

        cs_result = await db.execute(
            select(CodeSubmission).where(CodeSubmission.interview_id == interview.id)
        )
        code_subs = cs_result.scalars().all()

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
        
        questions_data = [_question_to_dict(q) for q in questions]

        print(f"Starting task directly with {len(questions_data)} questions...")
        
        # We need to test the actual evaluation hanging
        await run_scoring_task(
            interview_id=str(interview.id),
            job_role=interview.job_role or "Unknown",
            candidate_name="Test Cand",
            questions_data=questions_data,
            code_info=code_info,
            total_coding_count=len(all_coding_qs)
        )
        print("Task finished.")

if __name__ == "__main__":
    asyncio.run(test())
