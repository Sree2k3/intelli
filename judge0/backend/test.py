import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from database import engine, get_db
from models import InterviewQuestion
from llm_service import generate_questions
import uuid

async def run_test():
    async for db in get_db():
        try:
            questions_data = await generate_questions("java fwelfow ogwuehgo ogwouhg")
            print("Generated questions data:", questions_data)
            
            inserted = []
            for idx, q in enumerate(questions_data):
                new_q = InterviewQuestion(
                    interview_id=uuid.uuid4(),
                    question_text=q.get("question_text", "Sample Question?"),
                    question_type=q.get("question_type", "technical").strip().lower() if q.get("question_type", "").strip().lower() in ["technical", "coding", "behavioral"] else "technical",
                    difficulty=q.get("difficulty", "medium").strip().lower() if q.get("difficulty", "").strip().lower() in ["easy", "medium", "hard"] else "medium",
                    selected=False,
                    order_index=idx,
                    source="generated"
                )
                db.add(new_q)
                inserted.append(new_q)
            
            await db.commit()
            print("Successfully committed to DB!")
        except Exception as e:
            print("Exception during DB commit or generation:")
            import traceback
            traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(run_test())
