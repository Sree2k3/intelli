import asyncio
from sqlalchemy import select
from database import AsyncSessionLocal
from models import Interview, InterviewQuestion, CodingQuestion

async def check():
    async with AsyncSessionLocal() as s:
        res = await s.execute(select(Interview).order_by(Interview.created_at.desc()).limit(1))
        interview = res.scalar()
        if not interview:
            print("No interviews found.")
            return
            
        print(f"Latest Interview: {interview.candidate_name} ({interview.id})")
        
        iqs_res = await s.execute(select(InterviewQuestion).where(InterviewQuestion.interview_id == interview.id))
        iqs = iqs_res.scalars().all()
        print(f"InterviewQuestion count: {len(iqs)}")
        for iq in iqs:
            print(f"  - IQ: {iq.question_type}: {iq.question_text[:50]}")
            
        cqs_res = await s.execute(select(CodingQuestion).where(CodingQuestion.interview_id == interview.id))
        cqs = cqs_res.scalars().all()
        print(f"CodingQuestion count: {len(cqs)}")
        for cq in cqs:
            print(f"  - CQ: {cq.title}")

if __name__ == "__main__":
    asyncio.run(check())
