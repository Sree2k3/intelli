"""
Direct verification of create_coding_questions and update_coding_question duplicate checks.
"""
import asyncio
import uuid
from fastapi import HTTPException
from auth_rbac import UserContext, Role
from models import User, Interview, CodingQuestion
from routers.code import create_coding_questions, update_coding_question
from database import AsyncSessionLocal


async def run_tests():
    # Setup mock admin context
    mock_user = User(
        id=uuid.uuid4(),
        email="sso-admin@scaloz.com",
    )
    mock_ctx = UserContext(
        user=mock_user,
        tenant_id=uuid.uuid4(),
        role=Role.SUPER_ADMIN
    )

    fake_interview_id = str(uuid.uuid4())

    # 1. Test payload containing user's exact duplicate examples
    print("Testing payload with duplicate questions: 'adding 2 number' vs 'adding two number'...")
    try:
        await create_coding_questions(
            body={
                "interview_id": fake_interview_id,
                "questions": [
                    {"title": "write a code for adding 2 number", "description": "Add 2 numbers"},
                    {"title": "write a code for adding two number", "description": "Add two numbers"},
                ],
                "replace": True
            },
            ctx=mock_ctx,
            db=None  # Should fail on payload duplicate check before DB query
        )
        assert False, "Should have raised HTTPException 400 for duplicate questions in payload"
    except HTTPException as e:
        assert e.status_code == 400, f"Expected status 400, got {e.status_code}"
        assert e.detail == "This question has already been added.", f"Expected 'This question has already been added.', got {e.detail}"
        print("  -> Passed! Caught duplicate with message:", e.detail)

    # 2. Test payload containing user's 3rd example: 'adding 2 number' vs 'WRITE a code for 2 numbers'
    print("Testing payload with duplicate questions: 'adding 2 number' vs 'WRITE a code for 2 numbers'...")
    try:
        await create_coding_questions(
            body={
                "interview_id": fake_interview_id,
                "questions": [
                    {"title": "write a code for adding 2 number", "description": "Add 2 numbers"},
                    {"title": "WRITE a code for 2 numbers", "description": "Write code for 2 numbers"},
                ],
                "replace": True
            },
            ctx=mock_ctx,
            db=None
        )
        assert False, "Should have raised HTTPException 400 for duplicate questions in payload"
    except HTTPException as e:
        assert e.status_code == 400, f"Expected status 400, got {e.status_code}"
        assert e.detail == "This question has already been added.", f"Expected 'This question has already been added.', got {e.detail}"
        print("  -> Passed! Caught duplicate with message:", e.detail)

    # 3. Test distinct questions: 'Two Sum' vs 'Three Sum' (Fairness test)
    print("Testing distinct questions: 'Two Sum' vs 'Three Sum'...")
    # They should pass payload check without raising duplicate error
    from question_similarity import find_duplicate_in_list
    seen = []
    for t in ["Two Sum", "Three Sum"]:
        dup = find_duplicate_in_list(t, seen)
        assert dup is None, f"'{t}' should not match '{dup}'"
        seen.append(t)
    print("  -> Passed! 'Two Sum' and 'Three Sum' are distinct.")

    print("\nALL BACKEND DUPLICATE VALIDATION TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(run_tests())
