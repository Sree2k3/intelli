import asyncio
from sqlalchemy import select
from database import AsyncSessionLocal
from models import Interview

async def check():
    async with AsyncSessionLocal() as s:
        res = await s.execute(select(Interview).where(Interview.candidate_name == '0.5').limit(1))
        interview = res.scalar()
        if interview:
            print(f"Interview ID: {interview.id}")
            print(f"  Candidate: {interview.candidate_name}")
            print(f"  Overall Score: {interview.overall_score}")
            print(f"  Coding Score: {interview.coding_score}")
            print(f"  Status: {interview.status}")
        else:
            print("Candidate 0.5 not found.")

if __name__ == "__main__":
    asyncio.run(check())
