import asyncio
from sqlalchemy import select
from database import AsyncSessionLocal
from models import Interview, CodingQuestion, CodeSubmission

async def check():
    async with AsyncSessionLocal() as s:
        res = await s.execute(select(Interview).order_by(Interview.created_at.desc()).limit(1))
        interview = res.scalar()
        if not interview:
            print("No interviews found.")
            return
            
        print(f"Latest Interview: {interview.candidate_name} ({interview.id})")
        print(f"Current coding_score in DB: {interview.coding_score}")
        
        qs_res = await s.execute(select(CodingQuestion).where(CodingQuestion.interview_id == interview.id))
        qs = qs_res.scalars().all()
        print(f"Coding Questions count: {len(qs)}")
        for q in qs:
            print(f"  - Q: {q.title} (ID: {q.id})")
            
        subs_res = await s.execute(select(CodeSubmission).where(CodeSubmission.interview_id == interview.id))
        subs = subs_res.scalars().all()
        print(f"Submissions count: {len(subs)}")
        for sub in subs:
            print(f"  - Sub: Q_ID: {sub.question_id}, Tests: {sub.passed_tests}/{sub.total_tests}")

if __name__ == "__main__":
    asyncio.run(check())
