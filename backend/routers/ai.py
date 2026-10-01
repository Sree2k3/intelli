import asyncio
import uuid
import re
import json
import io
import fitz  # PyMuPDF
import docx
from typing import Any, Dict, List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Header, File, UploadFile, Form, Response
from sqlalchemy import and_, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import (
    AIInterviewRequest, 
    GenerateQuestionsRequest, 
    GenerateCodingQuestionsRequest,
    RecommendCodingTypesRequest,
    TTSRequest,
    Interview, 
    InterviewQuestion, 
    InterviewMessage,
    CodingQuestion,
    User
)
from auth import get_current_user, get_optional_user
from utils import _question_to_dict
from llm_service import (
    ai_interview,
    generate_questions,
    generate_ai_coding_questions,
    recommend_coding_challenge_types,
    transcribe_audio,
    synthesize_speech,
    _chat,
    _extract_json,
    _classify_answer_quality,
    is_meaningful_response,
    is_candidate_skip_or_pass,
    generate_personalized_closing,
    generate_customization_suggestions
)
from logging_config import logger as log
from config import settings
from question_similarity import find_duplicate_in_list

router = APIRouter(prefix="/api/functions/v1", tags=["AI"])

# Standardized opening questions for every interview
DEFAULT_QUESTIONS = [
    {
        "question_text": "To start things off, could you please give me a brief self-introduction?",
        "question_type": "technical",
        "difficulty": "easy",
        "source": "generated",
        "tag": "technical/intro"
    },
    {
        "question_text": "Now, could you walk me through a recent project you are proud of, detailing your specific contributions, the architecture, and the technologies you used?",
        "question_type": "technical",
        "difficulty": "medium",
        "source": "generated",
        "tag": "technical/experience"
    }
]

@router.post("/transcribe")
async def transcribe_endpoint(
    audio: UploadFile = File(...),
    original_text: str = Form(""),
    prompt: str = Form(""),
):
    """Refine phonetic transcript using actual audio via Whisper."""
    try:
        audio_bytes = await audio.read()
        perfected_text = await transcribe_audio(audio_bytes, original_text, prompt)
        return {"text": perfected_text}
    except Exception as e:
        log.error(f"Error in transcribe_endpoint: {e}")
        return {"text": original_text}


@router.post("/tts")
async def tts_endpoint(body: TTSRequest):
    """Synthesize text into speech audio for candidate interview playback and stream recording."""
    try:
        audio_bytes = await synthesize_speech(body.text, body.voice)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error in tts_endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai-interview")
async def ai_interview_endpoint(
    body: AIInterviewRequest,
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
    x_invite_token: Optional[str] = Header(None, alias="x-invite-token"),
):
    """Agentic AI interviewer logic. Manages round transitions and dynamic follow-ups."""
    try:
        i_id = uuid.UUID(str(body.interview_id))
    except ValueError:
        raise HTTPException(400, "Invalid interview_id")

    from models import InterviewSession
    from sqlalchemy.orm import selectinload

    # 1. Try finding as multi-candidate session
    res_sess = await db.execute(
        select(InterviewSession)
        .options(selectinload(InterviewSession.candidate))
        .where(InterviewSession.id == i_id)
    )
    session = res_sess.scalar_one_or_none()
    
    is_session = False
    if session:
        is_session = True
        res_template = await db.execute(select(Interview).where(Interview.id == session.interview_id))
        interview = res_template.scalar_one_or_none()
        if not interview:
            raise HTTPException(404, "Interview template not found")
    else:
        # Standard flow: find as single-candidate interview
        res_inter = await db.execute(select(Interview).where(Interview.id == i_id))
        interview = res_inter.scalar_one_or_none()
        if not interview:
            raise HTTPException(404, "Interview not found")
        
    permission_granted = False
    if current_user and str(interview.user_id) == str(current_user.id):
        permission_granted = True
    elif x_invite_token:
        if is_session and session.session_token == x_invite_token:
            permission_granted = True
        elif not is_session and interview.invite_token == x_invite_token:
            permission_granted = True
        
    if not permission_granted:
        log.warning(f"Unauthorized AI interview access attempt: {i_id}")
        raise HTTPException(403, "Access denied")

    if x_invite_token:
        from utils import check_access_status, raise_access_blocked_exception
        access_status = check_access_status(session or interview, interview)
        if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
            raise_access_blocked_exception(access_status, interview)

    # Fetch Selected Questions (using template interview ID) to determine active rounds
    round_lower = body.round.strip().lower()
    q_res = await db.execute(
        select(InterviewQuestion).where(
            and_(
                InterviewQuestion.interview_id == interview.id,
                InterviewQuestion.selected == True
            )
        ).order_by(InterviewQuestion.order_index)
    )
    all_selected = q_res.scalars().all()
    
    cq_check_early = await db.execute(
        select(CodingQuestion.id).where(CodingQuestion.interview_id == interview.id).limit(1)
    )
    has_coding_early = bool(cq_check_early.scalar_one_or_none())
    
    active_question_types = set([q.question_type.strip().lower() for q in all_selected])
    active_rounds = []
    if "behavioral" in active_question_types: active_rounds.append("behavioral")
    if "technical" in active_question_types: active_rounds.append("technical")
    if has_coding_early: active_rounds.append("coding")

    standard_order = ["behavioral", "technical", "coding"]

    # Fast-forward if requested round is not active
    if round_lower not in active_rounds:
        req_idx = standard_order.index(round_lower) if round_lower in standard_order else -1
        
        next_round_candidate = None
        for cand in standard_order[req_idx+1:]:
            if cand in active_rounds:
                next_round_candidate = cand
                break
                
        if next_round_candidate == "behavioral":
            body.round = "behavioral"
            round_lower = "behavioral"
            if is_session:
                session.current_round = "behavioral"
            else:
                interview.current_round = "behavioral"
        elif next_round_candidate == "technical":
            body.round = "technical"
            round_lower = "technical"
            if is_session:
                session.current_round = "technical"
            else:
                interview.current_round = "technical"
        elif next_round_candidate == "coding":
            if is_session:
                session.current_round = "coding"
                if session.status != "flagged": session.status = "in_progress"
            else:
                interview.current_round = "coding"
                if interview.status != "flagged": interview.status = "in_progress"
            await db.commit()
            return {"shouldAdvance": True, "nextRound": "coding", "response": ""}
        else:
            if is_session:
                session.current_round = "completed"
            else:
                interview.current_round = "completed"
            await db.commit()
            return {"shouldAdvance": True, "nextRound": "completed", "response": "Your interview is complete."}

    # Now fetch history using the potentially updated body.round
    if is_session:
        session_history = session.chat_history or []
        round_messages = [m for m in session_history if m.get("round") == body.round]
        history = [{"role": m["role"], "content": m["content"]} for m in round_messages[-20:]]
    else:
        hist_result = await db.execute(
            select(InterviewMessage)
            .where(
                and_(
                    InterviewMessage.interview_id == i_id,
                    InterviewMessage.round == body.round,
                )
            )
            .order_by(InterviewMessage.created_at)
            .limit(20)
        )
        history = [{"role": m.role, "content": m.content} for m in hist_result.scalars().all()]

    # If the session is brand new (turn 1, no history yet) and the client sent "technical" while active_rounds starts with "behavioral",
    # align to active_rounds[0] so the candidate begins with the opening behavioral intro.
    if not history and not body.message and active_rounds and round_lower != active_rounds[0]:
        first_active = active_rounds[0]
        round_lower = first_active
        body.round = first_active
        if is_session:
            session.current_round = first_active
        else:
            interview.current_round = first_active

    selected_questions = [
        {"id": str(q.id), "text": q.question_text}
        for q in all_selected
        if q.question_type.strip().lower() == round_lower
    ]

    log.info(f"AI Interview turn: Round={body.round}, Q={len(selected_questions)}")

    # Initialize State
    if is_session:
        memory = dict(session.structured_memory) if session.structured_memory else {}
    else:
        memory = dict(interview.structured_memory) if interview.structured_memory else {}
    
    active_q_id = None
    if selected_questions:
        q_idx = memory.get("current_question_index", 0)
        if q_idx < len(selected_questions):
            try:
                active_q_id = uuid.UUID(selected_questions[q_idx]["id"])
            except Exception as e:
                log.error(f"Failed to resolve active_q_id: {e}")

    # Double-lock state detection for follow-up
    already_has_initial = False
    existing_answer = ""
    follow_up_done = False
    clean_message = ""

    if body.message and selected_questions and active_q_id:
        q_idx = memory.get("current_question_index", 0)
        question_turn_count = memory.get("question_turn_count", 0)

        # 1. Fetch existing persisted answer to verify ground truth
        try:
            if is_session and session.answers:
                existing_answer = (session.answers.get(str(active_q_id)) or "").strip()
                already_has_initial = "[Initial Answer]" in existing_answer
            elif not is_session:
                q_res = await db.execute(
                    select(InterviewQuestion).where(InterviewQuestion.id == active_q_id)
                )
                q_row = q_res.scalar_one_or_none()
                if q_row and q_row.candidate_answer:
                    existing_answer = (q_row.candidate_answer or "").strip()
                    already_has_initial = "[Initial Answer]" in existing_answer
        except Exception as e:
            log.error(f"Failed to check existing answer: {e}")

        # Double-Lock: Follow-up is done if turn count > 0 OR if initial answer was already stored
        follow_up_done = (question_turn_count > 0) or already_has_initial

        # Check for candidate skip/pass intent or empty filler
        is_candidate_skip = is_candidate_skip_or_pass(body.message)
        if is_candidate_skip:
            clean_message = f"(Candidate skipped: {body.message.strip()})"
            log.info(f"[AnswerSave] Candidate skip/pass intent recognized for Q{q_idx}: '{body.message.strip()}'.")
        elif is_meaningful_response(body.message):
            clean_message = body.message
        else:
            clean_message = "(No Response)"
            log.info(f"[AnswerSave] Filler detected — saving as '(No Response)' for Q{q_idx}.")

        # 2. Persist answer with strict [Initial Answer] vs [Follow-up Answer] tagging
        try:
            from sqlalchemy.orm.attributes import flag_modified
            if is_session:
                answers = dict(session.answers) if session.answers else {}
                if not follow_up_done:
                    answers[str(active_q_id)] = f"[Initial Answer]\n{clean_message}"
                else:
                    answers[str(active_q_id)] = existing_answer + f"\n\n[Follow-up Answer]\n{clean_message}"
                session.answers = answers
                flag_modified(session, "answers")
                db.add(session)
            else:
                q_res = await db.execute(
                    select(InterviewQuestion).where(InterviewQuestion.id == active_q_id)
                )
                q_row = q_res.scalar_one_or_none()
                if q_row:
                    if not follow_up_done:
                        q_row.candidate_answer = f"[Initial Answer]\n{clean_message}"
                    else:
                        q_row.candidate_answer = (
                            existing_answer
                            + f"\n\n[Follow-up Answer]\n{clean_message}"
                        )
                    db.add(q_row)
        except Exception as e:
            log.error(f"Answer save error: {e}")

    # ─────────────────────────────────────────────────────────────────────────
    # STATE MACHINE — guaranteed exactly 1 follow-up per base question
    #
    # Advance decision matrix:
    #   question_turn_count >= 1 OR follow_up_done == True OR is_idk:
    #       → ALWAYS advance to next base question (q_idx += 1), reset turn count = 0
    #   Otherwise:
    #       → First answer: ask exactly 1 follow-up strictly on the base question
    # ─────────────────────────────────────────────────────────────────────────
    stored_round = memory.get("current_round")

    # Pre-classify the current answer RIGHT NOW (sync, microseconds)
    pre_classified_quality: Optional[str] = None
    intercepted_response = None
    original_q_id = active_q_id

    if body.message:
        q_idx = memory.get("current_question_index", 0)
        question_turn_count = memory.get("question_turn_count", 0)
        
        lower_msg = body.message.lower().strip()
        is_idk = (
            is_candidate_skip_or_pass(body.message)
            or any(phrase in lower_msg for phrase in [
                "no response", "skipped", "timed out", "candidate skipped"
            ])
        )

        if q_idx < len(selected_questions):
            current_q_text_for_classify = selected_questions[q_idx]["text"]
            result = _classify_answer_quality(
                question=current_q_text_for_classify,
                answer=body.message,
                round_type=round_lower,
            )
            pre_classified_quality = result["quality"]
            memory["last_answer_quality"] = pre_classified_quality
            log.info(f"[StateMachine] quality={pre_classified_quality} | q_idx={q_idx} | turn={question_turn_count} | follow_up_done={follow_up_done}")

        # THE INTERCEPTOR (Python Turn-Counter + Double-Lock)
        # Guarantee EXACTLY 1 follow-up: If turn count >= 1 OR follow-up was already done OR candidate skipped:
        # We ALWAYS advance to the next base question and NEVER call LLM for a second follow-up.
        if question_turn_count >= 1 or follow_up_done or is_idk:
            q_idx += 1
            memory["current_question_index"] = q_idx
            memory["question_turn_count"] = 0
            log.info(f"[StateMachine] Interceptor triggered (turn={question_turn_count}, follow_up_done={follow_up_done}, idk={is_idk}). Advancing to Q{q_idx}")
            
            if q_idx < len(selected_questions):
                next_q = selected_questions[q_idx]["text"]
                clean_next = next_q
                if clean_next.lower().startswith("thank you.") or clean_next.lower().startswith("thanks."):
                    clean_next = clean_next.split(".", 1)[1].strip()

                if is_idk:
                    intercepted_response = f"No problem. {clean_next}"
                else:
                    intercepted_response = f"Thank you. {clean_next}"
        else:
            pass # LLM will handle the first follow up

        new_q_idx = memory.get("current_question_index", 0)
        if selected_questions and new_q_idx < len(selected_questions):
            active_q_id = uuid.UUID(selected_questions[new_q_idx]["id"])

    else:
        if (stored_round or "").strip().lower() != round_lower:
            memory["question_turn_count"] = 0
            memory["current_question_index"] = 0
            memory["current_round"] = body.round

    # AI Self-Introduction Generation (Turn 1)
    is_intro_turn = False
    intro_text = None
    if not body.message and not memory.get("intro_done"):
        is_intro_turn = True
        from llm_service import generate_self_introduction
        intro_text = await generate_self_introduction(job_role=interview.job_role, jd_text=interview.jd_text)
        memory["intro_done"] = True
        
        # Generate the AI Self-Introduction message but DO NOT save it to DB
        # as per the new requirements (transcript should not contain intro).

    # Detect end of round
    should_advance_round = False
    if len(selected_questions) == 0:
        should_advance_round = True
    else:
        should_advance_round = bool(
            body.message and
            memory["current_question_index"] >= len(selected_questions)
        )

    candidate_name = (session.candidate.candidate_name if (is_session and session.candidate) else interview.candidate_name) or "there"
    
    if should_advance_round:
        # Determine next active round dynamically
        try:
            curr_idx = active_rounds.index(body.round)
            next_round = active_rounds[curr_idx + 1] if curr_idx + 1 < len(active_rounds) else "completed"
        except ValueError:
            next_round = "completed"
        
        # Contextual closure text
        if next_round == "completed":
            job_title = interview.job_role or "Software Engineer"
            closing_text = await generate_personalized_closing(
                candidate_name=candidate_name,
                job_role=job_title,
                history=history
            )
        else:
            closing_text = f"Thank you, {candidate_name}. We've finished the {body.round} section. Let's move to the {next_round} part."
            
        parsed = {"response": closing_text, "metadata": {}}
    else:
        # AI Turn
        if intercepted_response:
            parsed = {"response": intercepted_response, "is_follow_up": False, "metadata": {}}
        else:
            import time
            start_time = time.time()
            parsed = await ai_interview(
                interview_id=str(i_id),
                message=body.message,
                round=body.round,
                job_role=interview.job_role,
                history=history,
                jd_text=interview.jd_text,
                structured_memory=memory,
                selected_questions=selected_questions,
                candidate_name=candidate_name
            )
            end_time = time.time()
            log.info(f"[Performance] LLM Transition took {end_time - start_time:.2f} seconds.")
            
            is_follow_up = parsed.get("is_follow_up", False)
            if body.message:
                # HARD CEILING: Under NO circumstances allow more than 1 follow-up per base question
                if follow_up_done or memory.get("question_turn_count", 0) >= 1:
                    is_follow_up = False
                    parsed["is_follow_up"] = False
                elif not is_follow_up and "?" in parsed.get("response", ""):
                    # LLM Guardrail: If it generated a question mark, it's asking a follow-up, regardless of the JSON flag.
                    is_follow_up = True
                    parsed["is_follow_up"] = True
                    
                if is_follow_up:
                    memory["question_turn_count"] = memory.get("question_turn_count", 0) + 1
                else:
                    q_idx = memory.get("current_question_index", 0) + 1
                    memory["current_question_index"] = q_idx
                    memory["question_turn_count"] = 0
                    
                    if selected_questions and q_idx < len(selected_questions):
                        active_q_id = uuid.UUID(selected_questions[q_idx]["id"])
                        next_q = selected_questions[q_idx]["text"]
                        base_resp = parsed.get("response", "Great.")
                        
                        # Strip "Thank you." from next_q if the LLM already gave a closing thought
                        if next_q.lower().startswith("thank you.") or next_q.lower().startswith("thanks."):
                            next_q = next_q.split(".", 1)[1].strip()
                        
                        # Clean up formatting to sound more human
                        if base_resp.strip().endswith((".", "!", "?")):
                            parsed["response"] = f"{base_resp.strip()} {next_q}"
                        else:
                            parsed["response"] = f"{base_resp.strip()}. {next_q}"
                    
                # If q_idx == len(selected_questions), should_advance_round is false initially,
                # but it will be handled on the next request, OR we can let the UI trigger it.
                # Since should_advance_round is computed BEFORE this LLM call, it stays False for this turn.
                # The user will receive the final response, then send an empty next request to trigger closing.

    # Sync and Save
    if not isinstance(parsed, dict):
        parsed = {"response": str(parsed), "metadata": {}}
    
    # Metadata Injection
    meta = parsed.setdefault("metadata", {})
    active_idx = int(memory.get("current_question_index", 0))
    meta["current_question_index"] = active_idx
    meta["question_turn_count"] = memory.get("question_turn_count", 0)
    meta["total_questions"] = len(selected_questions)
    meta["question_id"] = str(active_q_id) if active_q_id else None
    if parsed.get("is_follow_up"):
        meta["question_text"] = parsed.get("response")
    elif selected_questions and 0 <= active_idx < len(selected_questions):
        clean_base = selected_questions[active_idx]["text"]
        if clean_base.lower().startswith("thank you.") or clean_base.lower().startswith("thanks."):
            clean_base = clean_base.split(".", 1)[1].strip()
        meta["question_text"] = clean_base

    # Persistence
    from sqlalchemy.orm.attributes import flag_modified
    if is_session:
        session.structured_memory = dict(memory)
        flag_modified(session, "structured_memory")
        from datetime import datetime, timezone
        chat_hist = list(session.chat_history) if session.chat_history else []
        if body.message:
            q_id_to_save = original_q_id if body.message else active_q_id
            chat_hist.append({
                "role": "user",
                "content": body.message,
                "round": body.round,
                "question_id": str(q_id_to_save) if q_id_to_save else None,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        # Do not save transitions/closing messages to the transcript.
        # Only save actual questions generated by ai_interview.
        if not should_advance_round:
            chat_hist.append({
                "role": "ai",
                "content": parsed.get("response", ""),
                "round": body.round,
                "question_id": str(active_q_id) if active_q_id else None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "metadata": {
                    "shouldAdvance": should_advance_round,
                    "agent_metadata": parsed.get("metadata"),
                    "question_turn_count": memory.get("question_turn_count", 0),
                    "current_question_index": memory["current_question_index"]
                }
            })
            session.chat_history = chat_hist
            flag_modified(session, "chat_history")
        db.add(session)
    else:
        interview.structured_memory = dict(memory)
        flag_modified(interview, "structured_memory")
        db.add(interview)
        if body.message:
            db.add(InterviewMessage(
                interview_id=i_id,
                tenant_id=interview.tenant_id,
                question_id=original_q_id,
                role="user",
                content=body.message,
                round=body.round
            ))
        
        # Do not save transitions/closing messages to the transcript.
        if not should_advance_round:
            db.add(InterviewMessage(
                interview_id=i_id,
                tenant_id=interview.tenant_id,
                question_id=active_q_id,
                role="ai",
                content=parsed.get("response", ""),
                round=body.round,
                metadata_={
                    "shouldAdvance": should_advance_round,
                    "agent_metadata": parsed.get("metadata"),
                    "question_turn_count": memory.get("question_turn_count", 0),
                    "current_question_index": memory["current_question_index"]
                }
            ))

    # Advance if needed
    if should_advance_round:
        try:
            curr_idx = active_rounds.index(body.round)
            next_round = active_rounds[curr_idx + 1] if curr_idx + 1 < len(active_rounds) else "completed"
        except ValueError:
            next_round = "completed"
        
        if next_round != "completed":
            if is_session:
                session.current_round = next_round
                memory.update({"current_question_index": 0, "question_turn_count": 0, "current_round": next_round})
                session.structured_memory = dict(memory)
                flag_modified(session, "structured_memory")
                db.add(session)
            else:
                interview.current_round = next_round
                memory.update({"current_question_index": 0, "question_turn_count": 0, "current_round": next_round})
                interview.structured_memory = dict(memory)
                flag_modified(interview, "structured_memory")
                db.add(interview)
        else:
            if is_session:
                db.add(session)
            else:
                db.add(interview)

    await db.commit()
    parsed["shouldAdvance"] = bool(should_advance_round)
    parsed["nextRound"] = next_round if should_advance_round else None
    if is_intro_turn:
        parsed["introduction"] = intro_text
        parsed["isIntro"] = True
    return parsed


class InterviewClosingRequest(BaseModel):
    interview_id: str
    candidate_name: Optional[str] = "there"
    job_role: Optional[str] = "Software Engineer"


@router.post("/interview-closing")
async def interview_closing_endpoint(
    body: InterviewClosingRequest,
    db: AsyncSession = Depends(get_db),
    x_invite_token: Optional[str] = Header(None, alias="x-invite-token"),
):
    """Synthesize a personalized, warm closing sign-off when an interview concludes."""
    try:
        i_id = uuid.UUID(str(body.interview_id))
    except ValueError:
        raise HTTPException(400, "Invalid interview_id")

    from models import InterviewSession
    from sqlalchemy.orm import selectinload

    try:
        res_sess = await db.execute(
            select(InterviewSession)
            .options(selectinload(InterviewSession.candidate))
            .where(InterviewSession.id == i_id)
        )
        session = res_sess.scalar_one_or_none()
        is_session = bool(session)

        if session:
            res_template = await db.execute(select(Interview).where(Interview.id == session.interview_id))
            interview = res_template.scalar_one_or_none()
        else:
            res_inter = await db.execute(select(Interview).where(Interview.id == i_id))
            interview = res_inter.scalar_one_or_none()

        history = []
        if is_session and session:
            session_history = session.chat_history or []
            history = [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in session_history[-20:]]
            cand_name = (session.candidate.candidate_name if session.candidate else body.candidate_name) or "there"
            role = (interview.job_role if interview else body.job_role) or "Software Engineer"
        elif interview:
            hist_result = await db.execute(
                select(InterviewMessage)
                .where(InterviewMessage.interview_id == i_id)
                .order_by(InterviewMessage.created_at)
                .limit(20)
            )
            history = [{"role": m.role, "content": m.content} for m in hist_result.scalars().all()]
            cand_name = interview.candidate_name or body.candidate_name or "there"
            role = interview.job_role or body.job_role or "Software Engineer"
        else:
            cand_name = body.candidate_name or "there"
            role = body.job_role or "Software Engineer"

        closing_text = await generate_personalized_closing(
            candidate_name=cand_name,
            job_role=role,
            history=history
        )
        return {"closing_text": closing_text}
    except Exception as e:
        log.error(f"Error in interview_closing_endpoint: {e}")
        c_name = body.candidate_name.strip() if body.candidate_name and body.candidate_name.strip().lower() != "there" else ""
        c_disp = f", {c_name}" if c_name else ""
        return {
            "closing_text": f"Thank you{c_disp}. Our time for the interview has concluded. We truly appreciate you sharing your experience today, and our recruitment team will be in touch regarding next steps."
        }


@router.post("/generate-questions")
async def generate_questions_endpoint(
    body: GenerateQuestionsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate interview questions based on a JD."""
    log.info(f"Generating questions for interview: {body.interview_id}")
    try:
        # Fetch the interview first so we can read candidate_experience for experience tier
        i_id = uuid.UUID(str(body.interview_id))
        _old_t = db.info.get("tenant_id")
        db.info["tenant_id"] = None
        try:
            res = await db.execute(select(Interview).where(Interview.id == i_id))
            interview = res.scalar_one_or_none()
            if not interview:
                raise HTTPException(404, "Interview not found")

            # Clean up existing generated questions and coding questions for this interview
            # to support going back and regenerating/editing settings without duplication
            from models import InterviewQuestion, CodingQuestion
            await db.execute(delete(InterviewQuestion).where(InterviewQuestion.interview_id == i_id))
            await db.execute(delete(CodingQuestion).where(CodingQuestion.interview_id == i_id))
        finally:
            db.info["tenant_id"] = _old_t

        # Determine experience level: explicit body field takes priority, then stored interview field
        experience_level = getattr(body, "experience_level", None) or interview.candidate_experience or None
        custom_instructions = getattr(body, "custom_instructions", None) or None

        questions_data = await generate_questions(
            body.jd_text,
            experience_level=experience_level,
            custom_instructions=custom_instructions
        )
        
        interview.jd_text = body.jd_text
        interview.structured_memory = {
            "skill_scores": {}, "weak_areas": [], "strong_areas": [], 
            "current_focus_skill": "", "difficulty_level": 1, "state": "INTRO",
            "custom_instructions": custom_instructions
        }

        # Prepend default questions to the generated list
        # We use selected=True for defaults to ensure they are always included
        all_questions = []
        for q in DEFAULT_QUESTIONS:
            all_questions.append({**q, "selected": True})
        
        for q in questions_data:
            all_questions.append({**q, "selected": False})

        # Save all questions
        from utils import _question_to_dict
        inserted = []
        for idx, q in enumerate(all_questions):
            new_q = InterviewQuestion(
                interview_id=i_id,
                tenant_id=interview.tenant_id,
                question_text=q.get("question_text", "Sample Question?"),
                question_type=q.get("question_type", "technical").strip().lower() if q.get("question_type", "").strip().lower() in ["technical", "coding", "behavioral"] else "technical",
                difficulty=q.get("difficulty", "medium").strip().lower() if q.get("difficulty", "").strip().lower() in ["easy", "medium", "hard"] else "medium",
                selected=q.get("selected", False),
                order_index=idx,
                source=q.get("source", "generated"),
                rubric={"tag": q.get("tag")} if q.get("tag") else None
            )
            db.add(new_q)
            inserted.append(new_q)
        
        # Determine the initial round based on selected questions (behavioral introduction first if present)
        has_behavioral = any(q.get("question_type") == "behavioral" and q.get("selected") for q in all_questions)
        has_technical = any(q.get("question_type") == "technical" and q.get("selected") for q in all_questions)
        interview.current_round = "behavioral" if has_behavioral else ("technical" if has_technical else "coding")
        db.add(interview)

        await db.commit()
        for q in inserted: await db.refresh(q)
        
        return {"questions": [_question_to_dict(q) for q in inserted]}

        
    except ValueError as ve:
        log.error(f"Generate questions failure (LLM issue): {ve}")
        error_msg = str(ve)
        if (
            "invalid or nonsensical" in error_msg
            or "valid job description" in error_msg
            or "meaningful content" in error_msg
            or "Invalid Content" in error_msg
            or "Invalid JD" in error_msg
        ):
            raise HTTPException(status_code=400, detail=error_msg)
        raise HTTPException(status_code=503, detail=f"LLM Service Unavailable: {error_msg}")
    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        with open("traceback_error.log", "w") as f:
            f.write(tb)
            f.write(str(e))
            
        log.error(f"Generate questions failure: {e}. Traceback:\n{tb}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error during LLM generation: {str(e)}")


MAX_DOCUMENT_FILE_SIZE = 5 * 1024 * 1024  # 5MB maximum allowed file size


def _extract_document_text(content: bytes, filename: str) -> str:
    """CPU-bound text extraction from PDF/DOCX/TXT executed in a threadpool."""
    if filename.endswith(".pdf"):
        doc = fitz.open(stream=content, filetype="pdf")
        pages_text = []
        for page in doc:
            p_text = page.get_text()
            if p_text:
                pages_text.append(p_text)
        doc.close()
        return "\n".join(pages_text).strip()
    elif filename.endswith(".docx"):
        doc = docx.Document(io.BytesIO(content))
        return "\n".join([p.text for p in doc.paragraphs if p.text]).strip()
    else:
        return content.decode("utf-8", errors="ignore").strip()


@router.post("/extract-text")
async def extract_text_endpoint(
    file: UploadFile = File(...),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Extract text from resume/JD upload (PDF/DOCX/TXT). Maximum allowed file size: 5MB."""
    log.info(f"Extracting text from: {file.filename}")
    content = await file.read()
    if len(content) > MAX_DOCUMENT_FILE_SIZE:
        size_mb = round(len(content) / (1024 * 1024), 1)
        log.warning(f"File upload rejected: {file.filename} ({size_mb}MB) exceeds 5MB limit")
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum allowed size of 5MB (Uploaded: {size_mb}MB). Please upload a smaller file or paste the text directly."
        )

    filename = (file.filename or "").lower()
    try:
        text = await asyncio.to_thread(_extract_document_text, content, filename)
        if not text:
            raise ValueError("Document contains no readable text. If this is a scanned document, please paste the text directly.")
        return {"text": text}
    except ValueError as e:
        log.warning(f"Text extraction empty/unreadable: {e}")
        raise HTTPException(400, detail=str(e))
    except Exception as e:
        log.error(f"Text extraction failed: {e}")
        raise HTTPException(400, detail=f"Extraction failed: {str(e)}")


@router.post("/parse-coding-questions")
async def parse_coding_questions_endpoint(
    file: UploadFile = File(...),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Parse an uploaded file into structured coding questions using LLM. Maximum allowed file size: 5MB."""
    log.info(f"Parsing coding questions from file: {file.filename}")
    content = await file.read()
    if len(content) > MAX_DOCUMENT_FILE_SIZE:
        size_mb = round(len(content) / (1024 * 1024), 1)
        log.warning(f"Coding file upload rejected: {file.filename} ({size_mb}MB) exceeds 5MB limit")
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum allowed size of 5MB (Uploaded: {size_mb}MB). Please upload a smaller file."
        )

    filename = (file.filename or "").lower()
    try:
        text = await asyncio.to_thread(_extract_document_text, content, filename)
        if not text:
            raise ValueError("No readable text found in document")
    except Exception as e:
        log.error(f"Failed to read file for parsing: {e}")
        raise HTTPException(400, f"Failed to read file: {str(e)}")

    parse_prompt = [
        {
            "role": "system",
            "content": (
                "You are an expert technical interviewer and coding assessment evaluator.\n"
                "Analyze the provided document:\n"
                "1. If the document contains explicit coding problems, parse and structure them accurately.\n"
                "2. If the document is a Job Description (JD), candidate Resume/CV, or project specification, SYNTHESIZE 1 to 2 realistic, practical coding interview problems directly tailored to the role, technical stack, tools, and responsibilities detailed in the document.\n"
                "3. ZERO GENERIC LEETCODE CLICHÉS: Do NOT generate generic textbook puzzles like Two Sum, Reverse Linked List, or Longest Substring. Every challenge must simulate authentic engineering tasks matching the document's tech stack.\n"
                "Return ONLY valid JSON with this exact structure:\n"
                "{\"questions\": [{\"title\": string, \"difficulty\": \"easy|medium|hard\", "
                "\"description\": string, "
                "\"examples\": [{\"input\": string, \"output\": string, \"explanation\": string}], "
                "\"constraints\": [string], \"hints\": [string], "
                "\"starter_code\": {\"python\": string}, "
                "\"test_cases\": [{\"input\": string, \"expected_output\": string, \"is_hidden\": bool}]"
                "}]}\n"
                "IMPORTANT:\n"
                "- starter_code MUST ONLY contain the function signature/boilerplate and an empty placeholder ('pass'). DO NOT include the actual logic or solution.\n"
                "- test_cases MUST have at least 4 test cases with 'input' and 'expected_output'. Mark the first 1-2 as is_hidden: false, and others as is_hidden: true."
            ),
        },
        {"role": "user", "content": f"Document content (Coding problems, Job Description, or Resume):\n\n{text[:8000]}"},
    ]

    try:
        raw = await _chat(parse_prompt, max_tokens=4096, timeout_override=60.0, model_type="question")
        raw_len = len(raw) if raw else 0
        last_500 = raw[-500:] if raw_len > 500 else raw
        log.info(f"[Parse] Raw LLM response length: {raw_len}")
        log.info(f"[Parse] Last 500 chars: {last_500}")

        # Clean Markdown code fences
        cleaned_raw = raw.strip()
        if cleaned_raw.startswith("```"):
            cleaned_raw = re.sub(r"^```(?:json)?\n", "", cleaned_raw)
            cleaned_raw = re.sub(r"\n```$", "", cleaned_raw)
        cleaned_raw = cleaned_raw.strip()

        # Extract first JSON object
        match = re.search(r"\{[\s\S]*\}", cleaned_raw)
        if not match:
            log.error(f"[Parse] No JSON object found in response: {cleaned_raw}")
            raise HTTPException(400, "No JSON object found in LLM response.")

        json_str = match.group(0)

        # Try parsing the extracted JSON
        try:
            parsed = json.loads(json_str)
        except json.JSONDecodeError as jde:
            # Get context around failure index
            err_idx = jde.pos
            snippet_start = max(0, err_idx - 100)
            snippet_end = min(len(json_str), err_idx + 100)
            snippet = json_str[snippet_start:snippet_end]
            pointer = " " * (err_idx - snippet_start) + "^"
            log.error(
                f"[Parse] JSONDecodeError at pos {err_idx}: {jde.msg}\n"
                f"Snippet around error:\n"
                f"{snippet}\n"
                f"{pointer}"
            )
            raise HTTPException(400, f"Invalid JSON returned by LLM: {jde.msg} at position {err_idx}. Snippet: ...{json_str[max(0, err_idx-40):min(len(json_str), err_idx+40)]}...")

        if not isinstance(parsed, dict) or "questions" not in parsed:
            raise HTTPException(400, "LLM response is not a JSON object or is missing the 'questions' field.")

        questions = parsed["questions"]
        if not isinstance(questions, list):
            raise HTTPException(400, "'questions' field must be a list.")

        # Validate each question object to ensure it has required fields and proper types
        for idx, q in enumerate(questions):
            if not isinstance(q, dict):
                raise HTTPException(400, f"Question at index {idx} is not a valid object.")
            
            required_fields = ["title", "difficulty", "description"]
            for field in required_fields:
                if field not in q or not q[field]:
                    raise HTTPException(400, f"Question {idx} is missing required field '{field}'.")

            # Validate difficulty
            diff = str(q["difficulty"]).strip().lower()
            if diff not in ["easy", "medium", "hard"]:
                log.warning(f"Question {idx} has non-standard difficulty '{q['difficulty']}'. Normalizing to 'medium'.")
                q["difficulty"] = "medium"
            else:
                q["difficulty"] = diff

            # Ensure nested list/dict fields are initialized if missing
            if "examples" not in q or not isinstance(q["examples"], list):
                q["examples"] = []
            if "constraints" not in q or not isinstance(q["constraints"], list):
                q["constraints"] = []
            if "hints" not in q or not isinstance(q["hints"], list):
                q["hints"] = []
            if "starter_code" not in q or not isinstance(q["starter_code"], dict):
                q["starter_code"] = {"python": ""}
            if "test_cases" not in q or not isinstance(q["test_cases"], list):
                q["test_cases"] = []

            # Normalize and validate test cases
            normalized_tcs = []
            for tc in q["test_cases"]:
                if not isinstance(tc, dict):
                    continue
                expected = (
                    tc.get("expected_output") or
                    tc.get("expectedOutput") or
                    tc.get("output") or
                    tc.get("Output") or
                    ""
                )
                normalized_tcs.append({
                    "input": str(tc.get("input", tc.get("Input", ""))),
                    "expected_output": str(expected),
                    "is_hidden": bool(tc.get("is_hidden", False)),
                })
            q["test_cases"] = normalized_tcs
        
        # Deduplicate parsed problems from file
        unique_questions = []
        seen_titles: List[str] = []
        for q in questions:
            t = (q.get("title") or "").strip()
            if t and find_duplicate_in_list(t, seen_titles):
                log.info(f"Skipping duplicate parsed question from file: '{t}'")
                continue
            if t:
                seen_titles.append(t)
            unique_questions.append(q)

        return {"questions": unique_questions}
    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        log.error(f"Parsing failure: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, f"Failed to parse coding questions: {str(e)}")


@router.post("/generate-coding-questions")
async def generate_coding_questions_endpoint(
    body: GenerateCodingQuestionsRequest,
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Generate or parse structured coding interview problems using AI from JD or custom text."""
    log.info(f"Generating coding questions (diff={body.difficulty}, count={body.count}, is_raw={body.is_raw_problem})")
    try:
        questions = await generate_ai_coding_questions(
            source_text=body.source_text,
            difficulty=body.difficulty,
            count=body.count or 2,
            custom_instructions=body.custom_instructions,
            challenge_types=body.challenge_types,
            is_raw_problem=bool(body.is_raw_problem),
        )
        return {"questions": questions}
    except ValueError as ve:
        raise HTTPException(400, str(ve))
    except Exception as e:
        import traceback
        log.error(f"Error in generate-coding-questions: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, f"Failed to generate coding questions: {str(e)}")


class CustomizationSuggestionsRequest(BaseModel):
    content: str
    job_role: Optional[str] = None


@router.post("/generate-customization-suggestions")
async def generate_customization_suggestions_endpoint(
    body: CustomizationSuggestionsRequest,
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Generate 4-6 concise interview customization prompt suggestions based on JD or resume."""
    try:
        suggestions = await generate_customization_suggestions(
            content=body.content,
            job_role=body.job_role
        )
        return {"suggestions": suggestions}
    except Exception as e:
        log.warning(f"Error generating customization suggestions: {e}")
        return {"suggestions": []}


@router.post("/recommend-coding-challenge-types")
async def recommend_coding_challenge_types_endpoint(
    body: RecommendCodingTypesRequest,
    current_user: Optional[User] = Depends(get_optional_user),
):
    """
    Dynamically recommend relevant coding challenge types using AI semantic analysis
    of full JD, resume paragraphs, projects, responsibilities, and skills.
    If information is insufficient, returns needs_clarification=True.
    """
    log.info(f"Recommending coding challenge types (role={body.job_role}, skills={len(body.skills or [])})")
    try:
        result = await recommend_coding_challenge_types(
            content=body.content,
            job_role=body.job_role,
            skills=body.skills,
            seniority=body.seniority,
            min_exp=body.min_exp,
            max_exp=body.max_exp,
            custom_instructions=body.custom_instructions,
        )
        return result
    except Exception as e:
        log.warning(f"Error recommending coding challenge types: {e}")
        return {
            "needs_clarification": False,
            "message": "",
            "types": [
                "Data Structures & Algorithms",
                "REST API & JSON Transforms",
                "Frontend State & DOM Logic",
                "Database Queries & Data Modeling",
            ]
        }


