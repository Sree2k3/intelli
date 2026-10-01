import os
import sys
import asyncio
from unittest.mock import AsyncMock, patch

# Add current path to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from evaluation_service import evaluate_all_answers
from llm_service import _chat
import llm_service

async def test_absent_category_normalization():
    print("Testing absent category normalization...")
    
    # Mock evaluate_single_question to return a dummy result
    with patch("evaluation_service.evaluate_single_question") as mock_eval:
        mock_eval.return_value = {
            "score": 50,
            "feedback": "Test feedback",
            "rubric_breakdown": {
                "technical_correctness": 50,
                "completeness": 50,
                "relevance": 50,
                "practical_knowledge": 50,
                "communication_quality": 50,
                "confidence": 50
            }
        }
        
        # We pass only technical questions, no behavioral, no coding
        questions = [
            {"question_text": "Q1", "question_type": "technical", "difficulty": "easy", "candidate_answer": "This is a valid candidate response with enough words."}
        ]
        
        result = await evaluate_all_answers(
            job_role="QA",
            candidate_name="Test",
            questions=questions,
            code_info=None,
            total_coding_count=0
        )
        
        # Verify behavioral and coding are None
        assert result["behavioral_score"] is None, f"Expected None behavioral score, got {result['behavioral_score']}"
        assert result["coding_score"] is None, f"Expected None coding score, got {result['coding_score']}"
        
        # Verify technical score is 50
        assert result["technical_score"] == 50, f"Expected technical score 50, got {result['technical_score']}"
        
        # Verify overall score is exactly equal to technical score (normalized)
        assert result["overall_score"] == 50, f"Expected overall score 50, got {result['overall_score']}"
        print("  => Category normalization test PASSED!")

async def test_llm_retry_and_backoff():
    print("Testing LLM request retry with backoff...")
    
    from openai import RateLimitError
    import httpx
    
    # We mock AsyncOpenAI.chat.completions.create to raise RateLimitError twice, then return success
    mock_responses = [
        RateLimitError("Rate limit exceeded", response=httpx.Response(429, request=httpx.Request("POST", "url")), body=None),
        RateLimitError("Rate limit exceeded", response=httpx.Response(429, request=httpx.Request("POST", "url")), body=None),
        AsyncMock(choices=[AsyncMock(message=AsyncMock(content="Retry success"))])
    ]
    
    call_count = 0
    async def mock_create(*args, **kwargs):
        nonlocal call_count
        resp = mock_responses[call_count]
        call_count += 1
        if isinstance(resp, Exception):
            raise resp
        return resp
        
    mock_client = AsyncMock()
    mock_client.chat.completions.create = mock_create
    
    with patch("llm_service.AsyncOpenAI", return_value=mock_client):
        # Patch asyncio.sleep to avoid waiting during tests
        with patch("asyncio.sleep") as mock_sleep:
            # Override OPENAI API key config to execute the OpenAI block
            with patch("config.settings.OPENAI_API_KEY", "valid_key"):
                res = await _chat([{"role": "user", "content": "Hello"}], timeout_override=10.0)
                
                assert res == "Retry success", f"Expected 'Retry success', got '{res}'"
                assert call_count == 3, f"Expected 3 calls, got {call_count}"
                assert mock_sleep.call_count == 2, f"Expected 2 sleep calls for backoff, got {mock_sleep.call_count}"
                print("  => LLM retry and backoff test PASSED!")

async def test_llm_failure_raises_error():
    print("Testing LLM retry exhaustion raises RuntimeError...")
    from openai import RateLimitError
    import httpx
    from fastapi import HTTPException
    
    mock_client = AsyncMock()
    # Mock to always raise RateLimitError
    mock_client.chat.completions.create.side_effect = RateLimitError("Rate limit exceeded", response=httpx.Response(429, request=httpx.Request("POST", "url")), body=None)
    
    with patch("llm_service.AsyncOpenAI", return_value=mock_client):
        with patch("asyncio.sleep") as mock_sleep:
            with patch("config.settings.OPENAI_API_KEY", "valid_key"):
                try:
                    await _chat([{"role": "user", "content": "Hello"}], timeout_override=10.0)
                    assert False, "Expected HTTPException to be raised"
                except HTTPException as e:
                    assert "LLM service unavailable" in str(e.detail) or "Too Many Requests" in str(e.detail), f"Unexpected exception: {e}"
                    print("  => LLM retry exhaustion test PASSED!")

async def test_step3_rubric_single_source_of_truth():
    print("Testing Step 3 Rubric is Single Source of Truth (no 60/40 hardcoding)...")

    custom_rubric = [
        {"id": "communication_quality", "name": "Communication Quality", "weight": 80.0},
        {"id": "technical_correctness", "name": "Technical Correctness", "weight": 20.0},
    ]

    # Two questions: Q1 (behavioral), Q2 (technical)
    questions = [
        {"question_text": "Tell me about a time you led a team.", "question_type": "behavioral", "difficulty": "medium", "candidate_answer": "In my previous role I led a cross functional team to deliver our platform on schedule."},
        {"question_text": "Explain how React reconciler works.", "question_type": "technical", "difficulty": "hard", "candidate_answer": "React reconciler creates a virtual DOM diff and commits changes efficiently."},
    ]

    eval_calls = [
        {
            "score": 82, # Q1 score
            "feedback": "Great communication",
            "rubric_breakdown": {
                "communication_quality": 90,
                "technical_correctness": 50,
            }
        },
        {
            "score": 92, # Q2 score
            "feedback": "Solid technical knowledge and explanation",
            "rubric_breakdown": {
                "communication_quality": 100,
                "technical_correctness": 60,
            }
        }
    ]

    call_idx = 0
    def mock_eval(*args, **kwargs):
        nonlocal call_idx
        res = eval_calls[call_idx]
        call_idx += 1
        return res

    with patch("evaluation_service.evaluate_single_question", side_effect=mock_eval):
        result = await evaluate_all_answers(
            job_role="Software Engineer",
            candidate_name="Alex Candidate",
            questions=questions,
            code_info=None,
            total_coding_count=0,
            evaluation_rubric=custom_rubric
        )

        # Rubric parameter averages:
        # communication_quality = round((90 + 100) / 2) = 95
        # technical_correctness = round((50 + 60) / 2) = 55
        assert result["rubric_summary"]["communication_quality"] == 95, f"Expected communication 95, got {result['rubric_summary']['communication_quality']}"
        assert result["rubric_summary"]["technical_correctness"] == 55, f"Expected technical 55, got {result['rubric_summary']['technical_correctness']}"

        # Overall score = round((95 * 80 + 55 * 20) / 100) = round((7600 + 1100) / 100) = round(8700 / 100) = 87
        # Note: If legacy 60/40 were used, it would have yielded round((92 * 0.6) + (82 * 0.4)) = 88, or tech_avg/behav_avg split.
        assert result["overall_score"] == 87, f"Expected overall_score 87 strictly from Step 3 criteria, got {result['overall_score']}"

        # Section scores exist for reporting and question organization:
        assert result["behavioral_score"] == 82, f"Expected behavioral section score 82, got {result['behavioral_score']}"
        assert result["technical_score"] == 92, f"Expected technical section score 92, got {result['technical_score']}"
        print("  => Step 3 Rubric Single Source of Truth test PASSED!")

async def main():
    await test_absent_category_normalization()
    await test_step3_rubric_single_source_of_truth()
    await test_llm_retry_and_backoff()
    await test_llm_failure_raises_error()
    print("All evaluation fixes tests completed successfully!")

if __name__ == "__main__":
    asyncio.run(main())

