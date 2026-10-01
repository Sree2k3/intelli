import asyncio
from sqlalchemy import select
from database import AsyncSessionLocal
from models import InterviewQuestion, Interview

async def main():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Interview.id, Interview.tenant_id).limit(5))
        print("--- Interviews ---")
        for row in result.all():
            print(f"Interview ID: {row[0]} | Tenant ID: {row[1]}")
            
        result = await session.execute(select(InterviewQuestion.id, InterviewQuestion.interview_id, InterviewQuestion.tenant_id).limit(5))
        print("--- Interview Questions ---")
        for row in result.all():
            print(f"Question ID: {row[0]} | Interview ID: {row[1]} | Tenant ID: {row[2]}")

if __name__ == "__main__":
    asyncio.run(main())
