import asyncio
from sqlalchemy import text
from database import AsyncSessionLocal

async def migrate_submissions():
    print("Starting CodeSubmission migration...")
    async with AsyncSessionLocal() as session:
        try:    
            # 1. Add question_id column
            await session.execute(text("ALTER TABLE code_submissions ADD COLUMN IF NOT EXISTS question_id UUID REFERENCES coding_questions(id) ON DELETE CASCADE;"))
            print("Added question_id to code_submissions")
        except Exception as e:
            await session.rollback()
            print(f"Error adding question_id: {e}")

        try:
            # 2. Add index for performance
            await session.execute(text("CREATE INDEX IF NOT EXISTS idx_code_submissions_question_id ON code_submissions(question_id);"))
            print("Added index idx_code_submissions_question_id")
        except Exception as e:
            await session.rollback()
            print(f"Error adding index: {e}")

        await session.commit()
    print("CodeSubmission migration finished.")

if __name__ == "__main__":
    asyncio.run(migrate_submissions())
