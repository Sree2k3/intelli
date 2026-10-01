import asyncio
from sqlalchemy import text
from database import AsyncSessionLocal

async def upgrade_database():
    print("Starting DB migration...")
    async with AsyncSessionLocal() as session:
        # 1. Add question_id to interview_messages if not exists
        try:
            await session.execute(text("ALTER TABLE interview_messages ADD COLUMN question_id UUID REFERENCES interview_questions(id) ON DELETE SET NULL;"))
            print("Added question_id to interview_messages")
        except Exception as e:
            await session.rollback()
            if "already exists" in str(e).lower() or "duplicate column" in str(e).lower():
                print("question_id column already exists.")
            else:
                print(f"Error adding question_id: {e}")

        # 2. Add Score Constraints to interviews
        for col in ["overall_score", "technical_score", "coding_score", "behavioral_score"]:
            try:
                await session.execute(text(f"ALTER TABLE interviews ADD CONSTRAINT interviews_{col}_bounds CHECK ({col} BETWEEN 0 AND 100);"))
                print(f"Added bounds for {col}")
            except Exception as e:
                await session.rollback()
                print(f"Skipped boundary check {col}: {e}")
                
        # 3. Add AI Score Constraint to interview_questions
        try:
            await session.execute(text("ALTER TABLE interview_questions ADD CONSTRAINT questions_score_bounds CHECK (ai_score BETWEEN 0 AND 100);"))
            print("Added questions_score_bounds")
        except Exception as e:
            await session.rollback()
            print(f"Skipped questions_score_bounds: {e}")

        await session.commit()
    print("DB migration finished.")

if __name__ == "__main__":
    asyncio.run(upgrade_database())
