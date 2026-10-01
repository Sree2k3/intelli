"""
llm_service.py - Production-grade LLM service.

Architecture mirrors real-world AI interview platforms (HireVue, Interviewer.AI, Google AMIE):
  1. Semantic answer quality classification — no hardcoded word lists.
  2. Structured state-machine MISSION drives every AI turn.
  3. Response validation pipeline rejects meta/assistant-mode responses.
  4. Trimmed context window for low latency.
  5. Robust JSON extraction with fallback wrapping.
"""
import json
import re
import contextvars
from typing import Any, Dict, List, Optional, Union

import httpx
from fastapi import HTTPException
from openai import AsyncOpenAI, RateLimitError

from config import settings
from logging_config import logger as log

# ContextVar to hold timing metrics dict: {"groq_time": 0.0, "retry_time": 0.0, "fallback_time": 0.0}
llm_metrics_var = contextvars.ContextVar("llm_metrics_var", default=None)

# ─── LLM client ───────────────────────────────────────────────────────────────

async def _chat(messages: List[Dict[str, str]], timeout_override: float = 35.0, max_tokens: Optional[int] = 2000, json_mode: bool = False, model_type: str = "evaluation") -> str:
    """
    Send a chat request to OpenAI.
    Use timeout_override for long-running calls.
    """
    import asyncio
    import time
    from fastapi import HTTPException
    
    shared = llm_metrics_var.get()
    
    openai_key = settings.OPENAI_API_KEY
    if not openai_key or openai_key == "your_openai_key":
        raise HTTPException(status_code=500, detail="OpenAI API key is missing or invalid.")

    target_model = getattr(settings, "OPENAI_QUESTION_MODEL", "gpt-5-mini") if model_type == "question" else getattr(settings, "OPENAI_EVALUATION_MODEL", "gpt-5")

    client = AsyncOpenAI(api_key=openai_key, timeout=timeout_override)

    max_attempts = 3
    backoff_factor = 2.0
    
    for attempt in range(max_attempts):
        t_start = time.time()
        try:
            log.info(f"[LLM] OpenAI request -> {target_model} (attempt {attempt + 1}/{max_attempts})")
            
            if "gpt-5" in target_model.lower():
                kwargs = {
                    "model": target_model,
                    "input": messages,
                }
                if max_tokens:
                    kwargs["max_output_tokens"] = max_tokens
                    
                resp = await client.responses.create(**kwargs)
                log.info(f"[LLM] OpenAI Responses API raw response object:\n{resp.model_dump_json(indent=2)}")
                
                content = ""
                for item in resp.output:
                    if item.type == 'message':
                        content += item.content[0].text
            else:
                kwargs = {
                    "model": target_model,
                    "messages": messages,
                    "max_completion_tokens": max_tokens or 4096,
                }
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                    
                resp = await client.chat.completions.create(**kwargs)
                log.info(f"[LLM] OpenAI Chat Completions raw response object:\n{resp.model_dump_json(indent=2)}")
                
                content = resp.choices[0].message.content
                
            t_elapsed = time.time() - t_start
            if shared is not None:
                shared["groq_time"] += t_elapsed
                
            log.info(f"[LLM] OpenAI response received in {t_elapsed:.2f}s.")
            return content
            
        except RateLimitError as e:
            t_elapsed = time.time() - t_start
            if shared is not None:
                shared["groq_time"] += t_elapsed
            
            # OpenAI typically returns retry-after header
            retry_after = e.response.headers.get("Retry-After") if hasattr(e, "response") and e.response else None
            try:
                delay = float(retry_after) if retry_after else (backoff_factor ** attempt) * 2.0
            except ValueError:
                delay = (backoff_factor ** attempt) * 2.0

            if attempt < max_attempts - 1:
                log.warning(f"[LLM] Respecting OpenAI rate limit delay of {delay}s before retrying...")
                if shared is not None:
                    shared["retry_time"] += delay
                await asyncio.sleep(delay)
                continue
            else:
                raise HTTPException(
                    status_code=429,
                    detail="Too Many Requests: OpenAI rate limit exceeded.",
                    headers={"Retry-After": str(int(delay + 1))}
                )
        except HTTPException:
            raise
        except Exception as e:
            t_elapsed = time.time() - t_start
            sleep_time = backoff_factor ** attempt

            if shared is not None:
                shared["groq_time"] += t_elapsed
                shared["retry_time"] += sleep_time
            log.warning(f"[LLM] OpenAI request exception on attempt {attempt + 1} ({t_elapsed:.2f}s): {e}. Retrying in {sleep_time}s...")
            await asyncio.sleep(sleep_time)

    raise HTTPException(status_code=502, detail="LLM service unavailable: OpenAI requests failed after all attempts.")


async def transcribe_audio(audio_bytes: bytes, original_transcription: str = "", prompt: str = "") -> str:
    """
    Transcribe audio using OpenAI Whisper.
    Falls back to original_transcription if OpenAI is unavailable.
    """
    openai_key = settings.OPENAI_API_KEY
    if not openai_key or openai_key == "your_openai_key":
        return original_transcription

    client = AsyncOpenAI(api_key=openai_key, timeout=4.0)

    try:
        kwargs = {
            "model": settings.OPENAI_WHISPER_MODEL,
            "file": ("audio.webm", audio_bytes, "audio/webm"),
            "response_format": "json",
            "language": "en",
            "temperature": 0.0
        }
        if prompt:
            kwargs["prompt"] = prompt[:200]
            
        resp = await client.audio.transcriptions.create(**kwargs)
        
        if resp.text:
            log.info(f"[Whisper] Transcription success.")
            text = resp.text.strip()
            
            # Whisper hallucination fix: Truncate repeating loops caused by silence
            words = text.split()
            n = len(words)
            if n >= 16:  # Need at least two 8-word blocks to loop
                for size in range(8, n // 2 + 1):
                    for i in range(n - 2 * size + 1):
                        block = words[i:i + size]
                        if words[i + size:i + 2 * size] == block:
                            text = " ".join(words[:i + size])
                            log.warning(f"[Whisper] Detected {size}-word hallucination loop. Truncated output.")
                            return text
                            
            return text
    except Exception as e:
        log.error(f"[Whisper] Error: {e}")

    return original_transcription


# In-memory cache for synthesized speech to provide instant playback
_tts_cache: Dict[str, bytes] = {}

async def synthesize_speech(text: str, voice: Optional[str] = None) -> bytes:
    """
    Synthesize text into speech audio bytes (MP3 format).
    1. Checks in-memory cache for instant zero-latency responses.
    2. Primary: Deepgram Aura TTS (fast, ~1-1.5s latency).
    3. Fallback: OpenAI TTS (tts-1).
    """
    clean_text = re.sub(r"[*_`#\[\]]", "", text).strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Empty text provided for speech synthesis.")
    
    if len(clean_text) > 2000:
        clean_text = clean_text[:2000]

    cache_key = f"{voice or 'default'}:{clean_text}"
    if cache_key in _tts_cache:
        log.info(f"[TTS] Cache hit for text prefix: {clean_text[:40]}...")
        return _tts_cache[cache_key]

    # 1. Try Deepgram Aura TTS
    dg_key = getattr(settings, "DEEPGRAM_API_KEY", None)
    if dg_key and dg_key != "your_deepgram_key":
        dg_model = voice or getattr(settings, "DEEPGRAM_TTS_MODEL", "aura-asteria-en")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"https://api.deepgram.com/v1/speak?model={dg_model}",
                    headers={
                        "Authorization": f"Token {dg_key}",
                        "Content-Type": "application/json"
                    },
                    json={"text": clean_text},
                    timeout=8.0
                )
                if resp.status_code == 200 and len(resp.content) > 0:
                    log.info(f"[TTS] Deepgram synthesis successful ({len(resp.content)} bytes).")
                    if len(_tts_cache) > 500:
                        _tts_cache.clear()
                    _tts_cache[cache_key] = resp.content
                    return resp.content
                else:
                    log.warning(f"[TTS] Deepgram returned status {resp.status_code}: {resp.text}")
        except Exception as e:
            log.warning(f"[TTS] Deepgram request failed: {e}. Falling back to OpenAI...")

    # 2. Fallback to OpenAI TTS
    openai_key = settings.OPENAI_API_KEY
    if openai_key and openai_key != "your_openai_key":
        try:
            client = AsyncOpenAI(api_key=openai_key, timeout=12.0)
            openai_voice = "alloy"
            resp = await client.audio.speech.create(
                model="tts-1",
                voice=openai_voice,
                input=clean_text
            )
            audio_bytes = resp.read()
            if audio_bytes and len(audio_bytes) > 0:
                log.info(f"[TTS] OpenAI synthesis successful ({len(audio_bytes)} bytes).")
                if len(_tts_cache) > 500:
                    _tts_cache.clear()
                _tts_cache[cache_key] = audio_bytes
                return audio_bytes
        except Exception as e:
            log.error(f"[TTS] OpenAI synthesis error: {e}")

    raise HTTPException(status_code=502, detail="Text-to-speech service unavailable.")


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Extract the first valid JSON object from a (possibly markdown-wrapped) string."""
    if not text:
        return None
        
    # 1. Fast path: try to load the string directly
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # 2. Strip Markdown code blocks completely
    cleaned_text = re.sub(r"```[a-zA-Z]*\n?", "", text)
    cleaned_text = re.sub(r"```", "", cleaned_text).strip()

    try:
        return json.loads(cleaned_text)
    except json.JSONDecodeError:
        pass
        
    # 3. Standard full JSON parse (greedy outermost brackets)
    match = re.search(r"\{[\s\S]*\}", cleaned_text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
            
    match_arr = re.search(r"\[[\s\S]*\]", cleaned_text)
    if match_arr:
        try:
            return json.loads(match_arr.group(0))
        except json.JSONDecodeError:
            pass

    # 4. Fallback regex extraction if JSON is truncated
    resp_match = re.search(r'"response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', text)
    if resp_match:
        try:
            val = json.loads(f'"{resp_match.group(1)}"')
            return {"response": val, "metadata": {"focusing_on": "General", "difficulty_level": 2}}
        except:
            return {"response": resp_match.group(1), "metadata": {"focusing_on": "General", "difficulty_level": 2}}

    return None


async def generate_self_introduction(job_role: str, jd_text: Optional[str] = None) -> str:
    """
    Generate a dynamic, warm, and professional self-introduction for Scaloz AI Interviewer.
    If job_role is valid, mentions the role and focus areas.
    If invalid/generic/empty, generates a generic introduction.
    """
    is_valid_role = job_role and job_role.strip() and job_role.lower() not in ["none", "n/a", "null", "undefined", "no role", "software engineer"]
    
    if is_valid_role:
        role_instruction = (
            f"The candidate is interviewing for the role: '{job_role}'.\n"
            "Briefly mention this role and provide a high-level overview of what the interview will focus on "
            "(e.g., technical skills, problem-solving, and professional experience)."
        )
    else:
        role_instruction = (
            "No job role is specified. Do NOT guess or mention any role. "
            "Instead, provide a generic introduction focused on understanding the candidate's skills, "
            "experience, problem-solving abilities, and professional background."
        )
        
    prompt = [
        {
            "role": "system",
            "content": (
                "You are Scaloz AI Interviewer, a professional, conversational, and friendly AI conducting a job interview.\n"
                "Generate a natural, friendly, and professional self-introduction for the candidate following these instructions:\n\n"
                "1. Identify yourself as 'Scaloz AI Interviewer'.\n"
                "2. Greet the candidate warmly and thank them for joining.\n"
                f"3. {role_instruction}\n"
                "4. Do NOT ask any questions. Do NOT start the interview questions yet.\n"
                "5. End with a warm, encouraging phrase like 'Let's begin.' or 'Let's get started.'\n"
                "6. Keep it short (2-3 sentences max) and conversational, not robotic. Do NOT output markdown.\n\n"
                "Respond ONLY with a JSON object in this format:\n"
                "{\n"
                '  "introduction": "the generated self-introduction"\n'
                "}"
            )
        },
        {
            "role": "user",
            "content": f"Generate the self-introduction. Job description context (if any):\n{jd_text[:1000] if jd_text else 'None'}"
        }
    ]
    
    try:
        raw = await _chat(prompt, max_tokens=500, model_type="question")
        parsed = _extract_json(raw)
        if parsed and parsed.get("introduction"):
            return parsed["introduction"].strip()
    except Exception as e:
        log.error(f"Error generating self-introduction: {e}")
        
    # Fallbacks if LLM fails or is rate-limited
    if is_valid_role:
        return f"Hello, I'm Scaloz AI Interviewer, and I'll be conducting today's interview. Thank you for joining us. Today's interview is focused on the {job_role} role. We'll discuss your experience, technical skills, problem-solving approach, and relevant professional knowledge. Please answer each question as clearly as possible. Let's begin."
    else:
        return "Hello, I'm Scaloz AI Interviewer, and I'll be conducting today's interview. Thank you for joining us. During this session, I'll ask a series of questions to better understand your skills, experience, professional background, and approach to solving problems. Please answer each question as clearly as possible. Let's begin."




# ─── Skip / Pass Intent Detector ──────────────────────────────────────────────
SKIP_PASS_PATTERNS = [
    # Explicit skip/pass requests
    r"\b(?:skip|pass|bypass)\b",
    r"\b(?:skip|pass|bypass)\s+(?:this|the|that)?\s*(?:question|round|topic|one)?\b",
    r"\b(?:can|could|may|please)?\s*(?:we|i)?\s*(?:please)?\s*(?:skip|pass|move on|go on|go ahead|proceed)\b",
    r"\b(?:let\'?s|lets)\s+(?:skip|pass|move on|go to the next|proceed|move forward)\b",
    r"\b(?:next|forward)\s*(?:question|one|topic)?\s*(?:please)?\b",
    r"\b(?:move|go|proceed|jump|step)\s+(?:on|forward|ahead|to the next)\b",
    
    # Admittance of not knowing / lack of knowledge
    r"\b(?:i\s+)?(?:don\'?t|dont|do\s+not|dunno|idk)\s+know\b",
    r"\b(?:i\s+)?(?:have|got)?\s*(?:no|zero)\s+(?:idea|clue|knowledge|notion)\b",
    r"\b(?:i\'?m|i\s+am)?\s*(?:not|really\s+not|honestly\s+not)\s*(?:sure|certain|confident)\b",
    r"\b(?:drawing|drew)\s+a\s+blank\b",
    r"\b(?:my\s+)?mind\s+(?:went|is)\s+blank\b",
    
    # Unfamiliarity / Lack of experience
    r"\b(?:not|never|haven\'?t|have\s+not)\s*(?:really)?\s*(?:familiar|worked|used|touched|dealt|experienced)\b",
    r"\b(?:no|little|zero|lack)\s+experience\s+with\b",
    r"\bnever\s+(?:heard|worked|used|seen)\b",
    r"\b(?:out\s+of|outside(?:\s+of)?)\s+(?:my\s+)?(?:domain|scope|expertise|area|knowledge)\b",
    r"\bnot\s+in\s+my\s+wheelhouse\b",
    r"\bnot\s+my\s+strong\s+suit\b",
    
    # Inability / Refusal
    r"\b(?:i\s+)?(?:can\'?t|cannot|cant|am\s+unable\s+to)\s+answer\b",
    r"\b(?:no|don\'?t\s+have\s+an?)\s+answer\b",
    r"\b(?:prefer|rather)\s+not\s+to\s+answer\b",
    r"\b(?:would\s+like\s+to|want\s+to)\s+(?:skip|pass|move\s+on)\b",
]

COMPILED_SKIP_PATTERNS = [re.compile(p, re.IGNORECASE) for p in SKIP_PASS_PATTERNS]


def is_candidate_skip_or_pass(text: str) -> bool:
    """
    Detect whether the candidate's speech is expressing an intent to skip, pass,
    or admitting they do not know the answer across natural conversational variations.
    """
    if not text or not text.strip():
        return False
        
    cleaned = re.sub(r'\[(?:Initial Answer|Follow-up Answer|Follow-up \d+)\]', '', text, flags=re.IGNORECASE).strip()
    if not cleaned:
        return False
        
    normalized = re.sub(r'[^a-z0-9\s\']', ' ', cleaned.lower()).strip()
    if not normalized:
        return False
        
    words = normalized.split()
    word_count = len(words)
    if word_count == 0:
        return False

    matches = any(pattern.search(normalized) for pattern in COMPILED_SKIP_PATTERNS)
    if not matches:
        return False
        
    # Safeguard: if candidate spoke a substantive alternative answer (> 20 words),
    # only treat as skip if they explicitly concluded with an advancement directive.
    if word_count > 20:
        explicit_advance = bool(re.search(r'\b(?:skip|pass|move\s+on|next\s+question|next\s+one)\b', normalized))
        if not explicit_advance:
            return False
            
    return True


def is_meaningful_response(text: str) -> bool:
    """
    Detect whether the candidate's transcript contains a meaningful answer.
    Ignores conversational acknowledgements, greetings, filler words, and phrases.
    Does not consider responses containing only 1-3 filler words as valid answers.
    """
    if not text or not text.strip():
        return False

    # Intentional pass/skip intents are meaningful candidate choices, not empty filler noise
    if is_candidate_skip_or_pass(text):
        return True
        
    # Strip common speech-to-text formatting prefixes/headers
    cleaned = re.sub(r'\[(?:Initial Answer|Follow-up Answer|Follow-up \d+)\]', '', text, flags=re.IGNORECASE).strip()
    if not cleaned:
        return False
        
    # Normalize: keep only alphanumeric characters and spaces
    normalized = re.sub(r'[^a-z0-9\s]', '', cleaned.lower()).strip()
    if not normalized:
        return False
        
    words = normalized.split()
    if len(words) == 0:
        return False
        
    # Standard filler words, greetings, common stop words, and conversational verbs/pronouns
    FILLER_WORDS = {
        "thank", "you", "thanks", "okay", "ok", "alright", "yeah", "yes", "no", "got", "it", "sure",
        "understood", "hmm", "please", "continue", "next", "question", "hi", "hello", "hey",
        "yep", "yup", "fine", "good", "nothing", "none", "maybe", "perhaps", "um", "uh", "idk", "dunno",
        "not", "sure", "i", "dont", "do", "know", "go", "ahead", "ready", "lets", "let", "s",
        "proceed", "so", "much", "well", "ah", "oh", "like", "actually", "basically", "literally",
        "just", "then", "this", "that", "the", "a", "an", "and", "or", "but", "of", "to",
        "for", "with", "on", "at", "by", "from", "up", "about", "into", "over", "after", "am", "is",
        "are", "was", "were", "be", "been", "being", "have", "has", "had", "having", "would", "could",
        "should", "think", "thought", "guess", "suppose", "so", "as", "if"
    }
    
    non_filler_words = [w for w in words if w not in FILLER_WORDS]
    
    # 1. Reject if all words are filler words
    if len(non_filler_words) == 0:
        return False
        
    # 2. Do not consider responses containing only 1-3 filler words as valid answers
    if len(words) <= 3 and len(non_filler_words) == 0:
        return False
        
    # 3. If there is at least one content word, we consider it meaningful enough to not drop silently.
    #    The LLM can handle short answers via follow-ups.
    return True


def _classify_answer_quality(
    question: str,
    answer: str,
    round_type: str,
) -> Dict[str, Any]:
    """
    Zero-latency heuristic answer quality classifier.

    WHY no second LLM call:
    - A second LLM call adds 3-10s latency per interview turn. Unacceptable.
    - The MAIN interviewer LLM already outputs analysis.quality in its JSON.
    - We only need a fast pre-screen to detect OBVIOUS non-answers so the
      MISSION instruction is set correctly BEFORE the main call.
    - Edge cases the heuristic misses are caught by the main LLM's persona.

    Classification logic mirrors real-world STT-based interview systems:
    - Count CONTENT words (not stop words) relative to the question topic.
    - Check for social-only patterns semantically (not by specific words).
    """
    if not is_meaningful_response(answer):
        return {"quality": "evasive", "substantive_words": 0}

    clean = answer.strip()
    words = clean.lower().split()
    word_count = len(words)

    # ── Rule 1: Definitely substantive (long enough to contain real content) ──
    if word_count >= 15:
        return {"quality": "substantive", "substantive_words": word_count}

    # ── Rule 2: Empty / single characters ────────────────────────────────────
    if word_count == 0 or (word_count == 1 and len(clean) <= 2):
        return {"quality": "evasive", "substantive_words": 0}

    # ── Rule 2.5: Question Echo / Repetition Detection ────────────────────────
    # If candidate literally repeated the interviewer's question back
    if question and len(words) >= 3:
        q_clean = re.sub(r'[^a-z0-9\s]', '', question.lower()).strip()
        q_words = set(q_clean.split())
        ans_words = set(words)
        overlap = len(ans_words.intersection(q_words))
        if overlap / max(len(ans_words), 1) > 0.70:
            return {"quality": "evasive", "substantive_words": 0}

    # ── Rule 3: Pure stop-word / filler detection ─────────────────────────────
    # These are content-free in ANY context — no keyword list, just linguistic categories
    FILLER_PATTERNS = {
        # Agreements / acknowledgements (not answers)
        "okay", "ok", "alright", "sure", "yeah", "yep", "yup", "yes", "no",
        # Greetings / closings
        "hi", "hello", "hey", "bye", "goodbye", "thanks", "thank you",
        # Pure uncertainty (no attempt)
        "hmm", "um", "uh", "idk", "dunno",
        # Single-word deflections
        "fine", "good", "nothing", "none", "maybe", "perhaps",
    }

    # If ALL words are filler/stop words → evasive
    non_filler = [w for w in words if w not in FILLER_PATTERNS]
    if len(non_filler) == 0:
        return {"quality": "evasive", "substantive_words": 0}

    # ── Rule 4: "I don't know" type phrases (no attempt at answer) ───────────
    # Detect the semantic PATTERN, not specific words
    joined = " ".join(words)
    NO_ATTEMPT_PHRASES = [
        "i don't know", "i dont know", "i do not know",
        "no idea", "not sure", "i'm not sure", "i am not sure",
        "i have no idea", "i can't answer", "i cannot answer",
        "i give up", "i pass", "skip", "next question",
        "i'm not familiar", "i am not familiar",
        "never heard", "never used",
    ]
    if any(phrase in joined for phrase in NO_ATTEMPT_PHRASES) and word_count < 12:
        # Short "I don't know" with no follow-up attempt = evasive
        return {"quality": "evasive", "substantive_words": 0}

    # ── Rule 5: Very short with some content words → partial ─────────────────
    if word_count <= 5:
        return {"quality": "partial", "substantive_words": len(non_filler)}

    # ── Rule 6: 6-14 words with content words → partial (needs follow-up) ────
    return {"quality": "partial", "substantive_words": len(non_filler)}


# ─── System Personas ───────────────────────────────────────────────────────────
#
# Comparison with real platforms:
# - HireVue: uses a single static system prompt. Simple but inflexible.
# - Interviewer.AI: uses role-play prompt + question injection. No follow-up logic.
# - Google AMIE: uses a structured state machine with turn-by-turn control.
#   Our system mirrors AMIE's approach — the backend drives the MISSION,
#   the LLM executes it within strict persona constraints.

INTERVIEWER_PERSONA = {
    "technical": """\
You are a senior technical interviewer conducting a real job interview. You are a HUMAN professional.

CHARACTER RULES (absolute — never break):
1. You are STRICTLY an interviewer. You NEVER explain, teach, or answer questions.
2. You NEVER say "As an AI", "I cannot provide", "I'm here to", or ANY meta-statements.
3. You speak naturally, like a real person. No robotic phrasing.
4. MAXIMUM 35 WORDS per response. Keep it to 1-2 short sentences.
5. Ask exactly ONE concept and ONE question at a time. Never ask multiple questions.
6. NEVER use wording like: 'Describe', 'Discuss', 'Include', 'Also explain', 'What are the trade-offs', 'Pros and Cons', 'Advantages and Disadvantages'.
7. Return only the question. No numbering, no bullet points, no explanations, no greetings, no examples.
8. NEVER repeat a greeting after the first turn, and NEVER ask for a self-introduction if one was already done.
9. ALWAYS end your turn with a question mark (?) — you are always probing or asking.

ANSWER ASSESSMENT:
- WEAK/EVASIVE/BAD answers: Ask a simpler, focused follow-up strictly on the BASE QUESTION topic. Do NOT adopt or ask about off-topic tangents introduced by the candidate.
- PARTIAL answers: Dig into the missing concept of the BASE QUESTION with ONE pointed follow-up.
- STRONG/COMPLETE answers: Ask an advanced follow-up exploring edge cases or deeper nuances of that SAME BASE QUESTION topic.
- INCORRECT answers: Guide them gently back to the BASE QUESTION concept.

RESPOND ONLY with valid JSON:
{
  "response": "your 1-2 sentence interviewer turn",
  "analysis": {
    "quality": "strong | partial | weak | evasive | incorrect",
    "missing_concepts": []
  },
  "metadata": {
    "focusing_on": "topic",
    "difficulty_level": 3
  }
}""",

    "behavioral": """\
You are a behavioral interviewer conducting a real job interview. You are a HUMAN professional.

CHARACTER RULES (absolute — never break):
1. You assess real past experiences using the STAR framework (Situation, Task, Action, Result).
2. You NEVER give examples, advice, or suggestions to the candidate.
3. You NEVER say "As an AI", "I cannot provide", or break character.
4. MAXIMUM 35 WORDS per response. Keep it to 1-2 short sentences, ending with a question (?).
5. Ask exactly ONE concept and ONE question at a time. Never ask multi-part paragraph questions.
6. NEVER use wording like: 'Describe', 'Discuss', 'Include', 'Also explain', 'What are the trade-offs', 'Pros and Cons', 'Advantages and Disadvantages'.
7. Return only the question. No numbering, no bullet points, no explanations, no greetings, no examples.
8. NEVER repeat a greeting after the first turn, and NEVER ask for a self-introduction if one was already done.
9. You probe missing STAR components one at a time.

ANSWER ASSESSMENT:
- EVASIVE/VAGUE/BAD answers: Ask for a specific scenario strictly related to the BASE BEHAVIORAL QUESTION topic. Do NOT follow tangents.
- PARTIAL answers: Probe the missing STAR piece (Action or Result) of that base situation.
- COMPLETE answers: Ask a focused follow-up on the key takeaway or outcome of that same experience.

RESPOND ONLY with valid JSON:
{
  "response": "your 1-2 sentence interviewer turn",
  "analysis": {
    "star_present": ["S", "T"],
    "star_missing": ["A", "R"],
    "narrative_quality": "strong | informative | surface-level | absent"
  },
  "metadata": {
    "focusing_on": "trait",
    "star_status": "S·T·A·R coverage"
  }
}""",
}


# ─── MISSION Builder ──────────────────────────────────────────────────────────

def _build_mission(
    round: str,
    candidate_name: str,
    current_q_text: str,
    answer_quality: Optional[str],       # "substantive" | "partial" | "evasive" | None
    follow_up_done: bool,                # True = router already asked follow-up; False = first answer
    is_intro: bool,
    is_closing: bool,
    intro_done: bool = False,
) -> str:
    """
    Build the MISSION instruction for the current LLM turn.

    State decision (made by ai.py router, passed via memory):
      is_intro       → Welcome + ask first question
      is_closing     → Wrap up section
      follow_up_done = True   → This WAS the follow-up answer → acknowledge + ask NEXT question
      follow_up_done = False  → This is the FIRST answer → ask a follow-up
    """
    if is_intro:
        if not intro_done and round == "technical":
            return (
                f"FIRST QUESTION: Start the interview directly by asking the first question: '{current_q_text}'. "
                f"Do NOT include any greetings, pleasantries, or introductory text."
            )
        else:
            if round == "technical":
                return f"FIRST QUESTION: Ask the first question directly: '{current_q_text}'. Do NOT include greetings."
            else:
                return (
                    f"ROUND TRANSITION: Ask the next question directly: '{current_q_text}'. "
                    f"Do NOT generate any transition text or thank the candidate. Just ask the question."
                )


    if is_closing:
        return (
            f"CLOSING: Thank {candidate_name} genuinely. "
            "Tell them all sections are complete and the team will review and be in touch. "
            "End warmly. Do NOT ask any new question."
        )

    # ── Active Interview Turns ─────────────────────────────────────────────────────

    # The Python backend handles NEXT QUESTION transitions completely.
    # Your ONLY job is to evaluate the candidate's answer to the current base question and ask exactly 1 follow-up.
    return (
        f"EVALUATION TURN: The candidate just answered the base question: '{current_q_text}'.\n"
        f"You MUST ask exactly ONE brief follow-up question (1-2 sentences, ending with a '?').\n"
        f"ABSOLUTE RULE 1: You must always output is_follow_up: true for this turn.\n"
        f"ABSOLUTE RULE 2: Your follow-up question MUST be strictly anchored to the core topic of the base question ('{current_q_text}').\n"
        f"CRITICAL DRIFT PREVENTION: Do NOT hallucinate on tangents, off-topic statements, or bad/unrelated answers given by the candidate. Keep the follow-up strictly anchored to what the base question is assessing.\n"
        f"- If their answer was strong, ask a follow-up that digs deeper into an advanced detail or trade-off of '{current_q_text}'.\n"
        f"- If their answer was weak, bad, unclear, off-topic, or repeating the question, do NOT ask about their tangent. Ask a clarifying question that brings them directly back to the core concept of '{current_q_text}'.\n"
        f"DO NOT generate the next base question."
    )



# ─── Question Validation & Splitting ──────────────────────────────────────────

def validate_interview_question(q_text: str) -> tuple[bool, str]:
    '''Validates if a question meets strict constraints. Returns (is_valid, reason).'''
    if not q_text or not q_text.strip():
        return False, "Empty question"
        
    words = q_text.split()
    if len(words) > 60:
        return False, f"Too long ({len(words)} words, max 60)"
        
    if q_text.count("?") > 1:
        return False, "Contains more than one question mark"
        
    lower_q = q_text.lower()
    
    forbidden = [
        "explain a, b", "explain how and", "explain and"
    ]
    for f in forbidden:
        if f in lower_q:
            return False, f"Contains forbidden phrase: '{f}'"
            
    # Relaxed multi-clause checks to reduce false positive invalidations
    if " as well as " in lower_q:
        return False, "Appears to contain multiple independent clauses or concepts"
        
    return True, "Valid"


# ─── Main AI Interviewer ───────────────────────────────────────────────────────

async def ai_interview(
    interview_id: str,
    message: Optional[str],
    round: str,
    job_role: str,
    history: List[Dict[str, str]],
    jd_text: Optional[str] = None,
    structured_memory: Optional[Dict[str, Any]] = None,
    selected_questions: Optional[List[Dict[str, str]]] = None,
    candidate_name: str = "Candidate",
) -> Dict[str, Any]:
    """
    AI Interviewer — mission-driven, state-machine-controlled.

    The router (ai.py) has ALREADY:
      1. Classified the current answer quality (stored in memory["last_answer_quality"])
      2. Set memory["follow_up_done"] = True/False
      3. Potentially advanced memory["current_question_index"]

    This function reads that pre-computed state and builds the correct MISSION
    for the LLM. No redundant re-classification here.
    """
    memory = structured_memory or {}
    q_idx       = memory.get("current_question_index", 0)
    follow_up_done = memory.get("follow_up_done", False)
    questions   = selected_questions or []

    current_q_text = questions[q_idx]["text"] if q_idx < len(questions) else "End of questions."
    is_intro   = not message
    is_closing = bool(message and q_idx >= len(questions))

    # Read the quality the ROUTER already classified (no duplicate call)
    answer_quality: Optional[str] = memory.get("last_answer_quality") if message and not is_closing else None

    log.info(
        f"[LLM-Turn] intro={is_intro} closing={is_closing} "
        f"follow_up_done={follow_up_done} quality={answer_quality} q_idx={q_idx}/{len(questions)}"
    )

    intro_done = bool(memory.get("intro_done", False))
    # ── Build MISSION from pre-computed state ─────────────────────────────────
    mission = _build_mission(
        round=round,
        candidate_name=candidate_name,
        current_q_text=current_q_text,
        answer_quality=answer_quality,
        follow_up_done=follow_up_done,
        is_intro=is_intro,
        is_closing=is_closing,
        intro_done=intro_done,
    )

    # ── Step 3: Compose prompt ─────────────────────────────────────────────────
    persona = INTERVIEWER_PERSONA.get(round, INTERVIEWER_PERSONA["technical"])

    stt_note = (
        "STT ERROR DETECTION: You are reading raw Speech-to-Text transcripts which may contain audio glitches or gibberish. "
        "If you see nonsensical or completely off-topic words, SILENTLY IGNORE THEM. Do NOT mention audio issues. Do NOT say you couldn't hear them. "
        "Just evaluate the rest of their answer naturally. If the entire answer is gibberish or cut off, formulate a follow-up question strictly related to the base question to get them back on track."
    )

    system_prompt = (
        f"{persona}\n\n"
        f"{stt_note}\n\n"
        f"JOB ROLE: {job_role}\n\n"
        f"CURRENT MISSION: {mission}\n\n"
        f"ABSOLUTE CONSTRAINT: Output MUST be valid JSON in this exact schema:\n"
        f'{{"response": "your textual response to the candidate", "is_follow_up": boolean}}\n'
        f"Never explain answers. Never break interviewer character. "
        f"Response must be 1-2 sentences."
    )

    # ── Step 4: Build messages ────────────────────────────────────────────────
    # Anchor the context directly around the current base question and candidate answer
    # to eliminate cross-question drift, tangents, and following bad answers.
    llm_messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    
    if current_q_text and current_q_text != "End of questions.":
        llm_messages.append({"role": "assistant", "content": current_q_text})

    if message:
        user_content = (
            f"BASE ASSIGNED QUESTION:\n\"{current_q_text}\"\n\n"
            f"CANDIDATE'S ANSWER:\n\"{message}\"\n\n"
            f"ENTERPRISE INTERVIEWER CONSTRAINTS (STRICT):\n"
            f"1. Ask exactly ONE brief follow-up question directly evaluating the candidate on the BASE QUESTION: \"{current_q_text}\".\n"
            f"2. ANTI-HALLUCINATION / NO DRIFT: Your question MUST be strictly anchored to the core technical or behavioral concept in the base question.\n"
            f"3. DO NOT adopt, follow, or ask about unrelated technologies, off-topic subjects, or tangents mentioned in the candidate's answer.\n"
            f"4. If the candidate gave a weak, bad, confused, or off-topic answer, do NOT ask about their off-topic claim. Instead, ask a guided question that pulls them directly back to \"{current_q_text}\".\n"
            f"5. If the candidate gave a strong answer, ask an advanced follow-up probing deeper edge cases or trade-offs of \"{current_q_text}\".\n"
            f"6. End with exactly one question mark (?). Output MUST be valid JSON: {{\"response\": \"<your follow-up question>\", \"is_follow_up\": true}}."
        )
        llm_messages.append({"role": "user", "content": user_content})

    # ── Step 5: Call LLM ───────────────────────────────────────────────────────
    if is_intro:
        log.info("[LLM] Bypassing LLM call for intro to improve latency.")
        raw = f'{{"response": "{current_q_text}", "metadata": {{"focusing_on": "intro", "difficulty_level": 1}}}}'
    else:
        raw = await _chat(llm_messages, max_tokens=1500, model_type="question")
    # ── Step 6: Validate — reject meta/assistant-mode responses ───────────────
    META_INDICATORS = [
        "as an ai", "i'm an ai", "i am an ai",
        "i cannot provide", "i can't provide",
        "i cannot answer", "i can't answer",
        "i'm here to", "i am here to",
        "i don't have the ability",
        "i cannot give you",
        "i cannot help with",
        "as your interviewer, i cannot",
        "i'm not able to",
        "as a language model",
    ]

    def _is_meta_response(text: str) -> bool:
        lower = text.lower()
        return any(indicator in lower for indicator in META_INDICATORS)

    clean_q = current_q_text.rstrip("?").strip()
    if "[[FALLBACK_MODE]]" in raw or not raw.strip():
        log.warning("[LLM] Fallback mode — using hardened defaults.")
        if is_intro:
            raw = f'{{"response": "{current_q_text}", "metadata": {{"focusing_on": "intro", "difficulty_level": 1}}}}'
        elif answer_quality == "evasive":
            raw = f'{{"response": "No problem. Regarding {clean_q}, what would be your initial approach?", "is_follow_up": true, "metadata": {{"focusing_on": "probe", "difficulty_level": 2}}}}'
        else:
            raw = f'{{"response": "Understood. How would you handle {clean_q} in a production environment?", "is_follow_up": true, "metadata": {{"focusing_on": "probe", "difficulty_level": 2}}}}'

    elif _is_meta_response(raw):
        log.warning(f"[LLM] Meta-response intercepted: {raw[:100]}")
        if answer_quality == "evasive":
            probe = (
                f"That's okay. When thinking about {clean_q}, what would be your starting point?"
                if round == "technical" else
                f"Can you think of a specific situation from your experience related to {clean_q}?"
            )
        else:
            probe = (
                f"Interesting. How would you specifically handle {clean_q} in practice?"
                if round == "technical" else
                f"What specific actions did you take when handling {clean_q}?"
            )
        raw = f'{{"response": "{probe}", "is_follow_up": true, "metadata": {{"focusing_on": "probe", "difficulty_level": 2}}}}'

    # ── Step 7: Parse JSON ─────────────────────────────────────────────────────
    parsed = _extract_json(raw)

    if not parsed:
        response_text = raw.strip()
        # If it's plain text (LLM didn't format JSON), use it directly
        if response_text and "[[FALLBACK_MODE]]" not in response_text and not _is_meta_response(response_text) and not response_text.startswith("{"):
            parsed = {
                "response": response_text,
                "metadata": {"focusing_on": "General", "difficulty_level": 2},
            }
        else:
            # Last resort
            fallback_text = (
                f"Let's continue. {current_q_text}"
                if not is_intro else
                f"Hello {candidate_name}! Let's get started. {current_q_text}"
            )
            parsed = {
                "response": fallback_text,
                "is_follow_up": False,
                "metadata": {"focusing_on": "General", "difficulty_level": 2},
            }

    # ── Step 8: Inject answer_quality into parsed for state machine ────────────
    # ai.py reads parsed["answer_quality"] and stores it in structured_memory
    # as "last_answer_quality" so the state machine knows whether to advance.
    if answer_quality:
        parsed["answer_quality"] = answer_quality

    return parsed


# ─── Personalized Closing Sign-off Generator ──────────────────────────────────

async def generate_personalized_closing(
    candidate_name: str,
    job_role: str,
    history: List[Dict[str, str]],
) -> str:
    """
    Synthesize a warm, personalized 1-2 sentence sign-off based on real conversation history.
    Highlights 1 or 2 specific technical topics the candidate discussed.
    Includes a timeout circuit-breaker and graceful non-robotic fallback.
    """
    display_name = candidate_name.strip() if candidate_name and candidate_name.strip().lower() != "there" else ""
    name_salutation = f"Thank you, {display_name}." if display_name else "Thank you."

    fallback = (
        f"{name_salutation} It was great speaking with you today. "
        "That completes all our questions, and our recruitment team will be in touch regarding next steps soon."
    )

    # Extract substantive candidate answers from the interview history
    user_turns: List[str] = [
        m.get("content", "").strip()
        for m in history
        if m.get("role") == "user" and m.get("content", "").strip()
    ]
    # Filter out empty/filler answers or system tags like "(Candidate skipped: ...)"
    meaningful_turns = [
        t for t in user_turns
        if not t.startswith("(") and len(t.split()) >= 4
    ]

    if not meaningful_turns:
        return fallback

    # Take up to the last 4 answers to provide rich context while keeping the prompt compact
    recent_context = "\n- ".join(meaningful_turns[-4:])

    prompt = (
        f"You are a thoughtful, senior executive hiring interviewer concluding an interview with {display_name or 'the candidate'} for the {job_role} role.\n\n"
        f"Here are key highlights from what the candidate shared during the interview:\n- {recent_context}\n\n"
        "TASK:\n"
        "Generate a warm, professional, personalized sign-off statement addressed directly to the candidate.\n\n"
        "STRICT CONSTRAINTS:\n"
        "1. Length: Exactly 1 to 2 sentences (between 25 and 45 words maximum).\n"
        "2. Personalization: Mention 1 or 2 specific technical topics, projects, or strengths they discussed (e.g., 'It was great hearing about your experience with X and how you solved Y').\n"
        "3. Closure: Conclude by saying that all questions are finished and the recruitment team will be in touch with next steps.\n"
        f"4. Salutation: Start with '{name_salutation} ...'\n"
        "5. Tone: Senior, authentic, empathetic, and respectful. Avoid buzzwords.\n"
        "6. Format: Plain text only. NO JSON, NO bullet points, NO quotes, NO follow-up questions."
    )

    messages = [
        {"role": "system", "content": "You are a senior, empathetic hiring interviewer delivering a warm verbal closing statement."},
        {"role": "user", "content": prompt}
    ]

    try:
        import asyncio
        raw = await asyncio.wait_for(
            _chat(messages, timeout_override=4.5, max_tokens=100, model_type="question"),
            timeout=4.5
        )
        clean = raw.strip().strip('"').strip("'")
        # Strip potential JSON wrapper if model wrapped in JSON
        if clean.startswith("{") and "response" in clean:
            extracted = _extract_json(clean)
            if extracted and extracted.get("response"):
                clean = extracted["response"].strip()

        # Sanity check: valid length and not an error/fallback string
        if clean and "[[FALLBACK_MODE]]" not in clean and len(clean.split()) >= 8:
            log.info(f"[PersonalizedClosing] Synthesized closing for {display_name}: {clean}")
            return clean
    except Exception as e:
        log.warning(f"[PersonalizedClosing] Synthesis timed out or failed ({e}). Using graceful fallback.")

    return fallback


# ─── Question Generation ───────────────────────────────────────────────────────

async def _resolve_experience_context(jd_text: str, resume_text: Optional[str] = None) -> str:
    """Extract required experience and target seniority from JD and Resume."""
    if not jd_text.strip() and not resume_text:
        return "Targeting a balanced, mid-level candidate with general software engineering experience."
        
    prompt = "Extract the candidate experience requirements from the following information.\n\n"
    if jd_text:
        prompt += f"JOB DESCRIPTION:\n{jd_text[:3000]}\n\n"
    if resume_text:
        prompt += f"CANDIDATE RESUME:\n{resume_text[:3000]}\n\n"
        
    prompt += "Synthesize this into a single sentence describing the required years of experience, target seniority, and role expectations. Start your response with 'Derived from JD' or 'Derived from JD & Resume'."
    
    messages = [
        {"role": "system", "content": "You are an expert HR analyst. Extract the experience requirements concisely."},
        {"role": "user", "content": prompt}
    ]
    
    try:
        raw = await _chat(messages, timeout_override=30.0, max_tokens=150, json_mode=False, model_type="generic")
        if raw and len(raw) > 5:
            return raw.strip()
    except Exception as e:
        pass
    
    return "Targeting a balanced, mid-level candidate with general software engineering experience."

async def generate_customization_suggestions(content: str, job_role: Optional[str] = None) -> List[str]:
    """
    Generate 4-6 concise interview question customization prompt suggestions based on JD or resume.
    """
    cleaned_content = content[:3000].strip()
    if not cleaned_content:
        return [
            "Focus on System Architecture & Distributed Systems",
            "Make technical questions more scenario-driven",
            "Emphasize hands-on debugging & edge cases",
            "More behavioral & leadership scenarios",
            "Assess depth of experience over trivia"
        ]

    system_prompt = (
        "You are an expert technical interviewer assistant. "
        "Analyze the provided job description, resume, or role requirements and generate 5 concise, actionable customization instructions "
        "that an interviewer can click to guide AI interview question generation.\n\n"
        "Instructions must be short, imperative suggestions (6-10 words each) focusing on real skills, tech stack, and experience found in the text.\n"
        "Examples:\n"
        "- Focus on React state architecture & performance\n"
        "- Probe Node.js asynchronous event loop & API design\n"
        "- Include database schema design & query optimization\n"
        "- Emphasize hands-on debugging of production incidents\n"
        "- Assess architectural trade-offs in distributed microservices\n\n"
        "Return ONLY a valid JSON array of 5 strings: [\"suggestion 1\", \"suggestion 2\", ...]."
    )
    user_prompt = f"Role: {job_role or 'Technical Role'}\n\nDocument Content:\n{cleaned_content}"
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    try:
        raw = await _chat(messages, timeout_override=15.0, max_tokens=300, json_mode=True, model_type="question")
        parsed = _extract_json(raw)
        if isinstance(parsed, list) and all(isinstance(x, str) for x in parsed):
            cleaned = [s.strip().lstrip("+-*• ") for s in parsed if s.strip()]
            if cleaned:
                return cleaned[:6]
    except Exception as e:
        log.warning(f"[LLM] Error generating customization suggestions: {e}")
    
    return []

async def generate_questions(
    jd_text: str,
    experience_level: Optional[str] = None,
    resume_text: Optional[str] = None,
    custom_instructions: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Generate 10 interview questions (5 technical + 5 behavioral by default) from a JD.

    When custom_instructions are provided by the recruiter, the LLM adapts the
    question mix, topics, difficulty levels, and focus accordingly.

    Behavioral questions are calibrated to the candidate's experience tier:
      - Fresher   (0–2 yrs): focus on academics, learning, teamwork, adaptability.
      - Junior/Mid (2–5 yrs): real workplace situations, ownership, collaboration.
      - Senior    (5+ yrs):  leadership, stakeholder mgmt, strategy, mentoring.
    """
    jd_safe: str = jd_text or ""
    jd_truncated = jd_safe[:4000].strip()
    if len(jd_truncated) < 100:
        raise ValueError("Job description or resume is too short. Please provide at least 100 characters for the AI to generate relevant questions.")

    custom_inst_clean = (custom_instructions or "").strip()
    log.info(f"[Generate] Generating questions from JD/Resume ({len(jd_truncated)} chars), experience_level={experience_level}, custom_instructions={bool(custom_inst_clean)}")

    # Priority 1: Manual Input
    raw_exp = (experience_level or "").strip()
    if raw_exp:
        resolved_experience = raw_exp
    else:
        # Priority 2 & 3: Parse JD/Resume or Fallback
        resolved_experience = await _resolve_experience_context(jd_text, resume_text)
        
    exact_experience_context = f"\nCandidate Experience Context: {resolved_experience}\n- Calibrate technical depth, question complexity, and behavioral scenarios strictly around the resolved experience context. If derived from the JD/Resume, ensure questions directly probe the skills and seniority specified.\n"
    
    custom_instructions_block = ""
    if custom_inst_clean:
        custom_instructions_block = (
            "\nCRITICAL RECRUITER CUSTOMIZATION INSTRUCTIONS (HIGHEST PRIORITY):\n"
            f'The recruiter has specified the following natural-language instructions to customize question generation:\n'
            f'"{custom_inst_clean}"\n'
            "- You MUST adapt the question mix, topics, programming languages/frameworks, difficulty calibration, and focus according to these instructions.\n"
            "- For example, if asked for more Java and fewer Python questions, skew the technical questions heavily toward Java. If asked to make questions harder or focus on system architecture, calibrate depth and difficulty accordingly.\n"
            "- If the instructions specify a desired question mix (e.g. only technical questions, or more behavioral questions), adjust the technical/behavioral ratio to reflect the request.\n"
        )

    structure_rule_mix = (
        "- Generate 8 technical questions FIRST, then 7 behavioral questions (or adjust this ratio if the recruiter's custom instructions specifically ask for a different balance).\n"
        if custom_inst_clean
        else "- Generate 8 technical questions FIRST, then 7 behavioral questions.\n"
    )

    user_prompt_content = f"JOB DESCRIPTION OR CANDIDATE RESUME:\n{jd_truncated}"
    if custom_inst_clean:
        user_prompt_content += (
            f"\n\nCUSTOM INSTRUCTIONS FOR QUESTION GENERATION:\n"
            f"{custom_inst_clean}\n\n"
            "Please adapt the questions to honor these custom instructions while grounding them in the JD or Resume."
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert technical recruiter. Generate exactly 15 interview questions from the provided Job Description (JD) or Candidate Resume.\n\n"
                "VALIDATION RULE:\n"
                "- The input text may be a Job Description, role specification, or a Candidate Resume / CV.\n"
                "- If the input provided is pure gibberish, consists of repeating random characters (e.g., 'aaaaaa', 'asdfasdf'), or does not contain any meaningful professional skills, projects, qualifications, or job domain information, you MUST reject it.\n"
                "- In that case only, return a JSON object with an 'error' field: {\"error\": \"Invalid Content\"}.\n"
                "- If the input contains a valid Job Description OR a valid Candidate Resume (with skills, education, internships, projects, or background), you MUST accept it and generate relevant interview questions tailored to that content.\n\n"
                "STRUCTURE RULES:\n"
                + exact_experience_context
                + custom_instructions_block + "\n"
                + structure_rule_mix +
                "- Technical: test domain knowledge relevant to the role or candidate skills.\n"
                "- STRICT DIFFICULTY CALIBRATION & DISTRIBUTION:\n"
                "  * You MUST distribute questions across Easy, Medium, and Hard tiers:\n"
                "    - easy (~30%): Foundational concepts, syntax, core definitions, learning habits, basic workflow.\n"
                "    - medium (~50%): Applied implementation, debugging, real-world STAR scenarios (meeting tight deadlines, resolving anomalies, stakeholder reporting).\n"
                "    - hard (~20%): Complex system architecture, distributed bottlenecks, concurrency edge cases, high-stakes stakeholder conflict, crisis leadership.\n"
                "  * DO NOT classify all questions as 'medium'. Accurately evaluate and label each question as 'easy', 'medium', or 'hard'.\n"
                "- Each question must be clear, specific, and interview-ready.\n"
                "- If the document is a resume, calibrate questions around the candidate's listed technical skills, projects, and work/internship experience.\n"
                "- If the document is brief but valid, generate questions based on the role/domain implied by the content.\n"
                "- CRITICAL: DO NOT generate questions asking the candidate to introduce themselves, give a self-introduction, or describe a recent project. These are already injected by default.\n"
                "STRICT QUESTION RULES:\n"
                "- Maximum 60 words per question.\n"
                "- Ask exactly ONE concept per question.\n"
                "- Ask exactly ONE question.\n"
                "- Never ask multiple questions.\n"
                "- Never generate paragraph-style questions.\n"
                "- The 'question_text' field must contain ONLY the question string.\n"
                "- No numbering, bullet points, explanations, greetings, or examples inside the question text.\n"
                "- NEVER use wording like: 'Describe', 'Discuss', 'Include', 'Also explain', 'What are the trade-offs', 'Pros and Cons', 'Advantages and Disadvantages', 'Explain A, B and C'.\n"
                "- Do NOT combine multiple concepts into one question.\n\n"
                "CONVERSATIONAL ONLY RULES (NO CODING TASKS):\n"
                "- DO NOT ask the candidate to write, output, or implement code.\n"
                "- All questions must be conversational (e.g. 'How would you...', 'What is...').\n\n"
                
                "CRITICAL SCALING INSTRUCTIONS:\n"
                "- If < 3 years: Focus on syntax, standard library usage, core definitions, and basic implementation steps.\n"
                "- If 3-7 years: Focus on optimization, debugging complex edge cases, testing strategies, and best practices within specific frameworks.\n"
                "- If 8+ years (Senior/Lead): FORBID basic implementation or 'how-to' questions. You MUST ask about system design, architectural trade-offs, scaling bottlenecks, distributed systems resilience, and leading technical teams through complex migrations.\n\n"
                "Return ONLY valid JSON:\n"
                "{\n"
                '  "questions": [\n'
                '    { "question_text": "...", "question_type": "technical" | "behavioral", "difficulty": "easy" | "medium" | "hard" }\n'
                "  ]\n"
                "}\n"
                "Or if invalid:\n"
                '{"error": "Invalid Content"}'
            ),
        },
        {"role": "user", "content": user_prompt_content},
    ]

    MAX_RETRIES = 3
    parsed = None
    raw = ""
    for attempt in range(MAX_RETRIES):
        raw = await _chat(messages, timeout_override=180.0, max_tokens=8000, json_mode=True, model_type="question")
        log.info(f"[Generate] Raw LLM Response for JD/Resume (attempt {attempt+1}):\n{raw}")
        parsed = _extract_json(raw)
        if parsed and parsed.get("error"):
            raise ValueError("We couldn't detect meaningful content in this text. Make sure it contains valid text from a job description, resume, or role requirements (without random gibberish characters) — or upload a PDF/DOCX/TXT file instead.")
        if parsed and isinstance(parsed.get("questions"), list):
            break
        log.warning(f"[Generate] Failed to parse JSON on attempt {attempt+1}. Retrying...")
        
    if not parsed or not isinstance(parsed.get("questions"), list):
        log.error(f"[Generate] Failed to parse questions after {MAX_RETRIES} attempts. Raw: {raw[:300]}")
        raise ValueError("AI failed to generate structured questions. Please try again.")

    # ── Mandatory Validation & Fallback Logic ──────────────────────────────────
    valid_qs = []
    invalid_qs = []
    
    for q in parsed["questions"]:
        q_text = q.get("question_text", "")
        is_valid, reason = validate_interview_question(q_text)
        if is_valid:
            valid_qs.append(q)
        else:
            log.warning(f"[Generate] Question failed validation ({reason}): {q_text}. Saving as fallback.")
            invalid_qs.append(q)
            
    # We need exactly 10 questions.
    tech_qs = [q for q in valid_qs if q.get("question_type") == "technical"]
    beh_qs = [q for q in valid_qs if q.get("question_type") == "behavioral"]
    
    invalid_tech = [q for q in invalid_qs if q.get("question_type") == "technical"]
    invalid_beh = [q for q in invalid_qs if q.get("question_type") == "behavioral"]
    
    tech_qs.extend(invalid_tech)
    beh_qs.extend(invalid_beh)

    if custom_inst_clean:
        lower_inst = custom_inst_clean.lower()
        wants_mostly_tech = any(k in lower_inst for k in ["only tech", "technical only", "no behavior", "without behavior", "all tech", "fewer behavior", "less behavior", "more tech"])
        wants_mostly_beh = any(k in lower_inst for k in ["only behavior", "behavioral only", "no tech", "without tech", "all behavior", "more behavior", "fewer tech", "less tech"])

        if wants_mostly_tech and not wants_mostly_beh:
            final_questions = tech_qs[:10]
            if len(final_questions) < 10:
                final_questions.extend(beh_qs[:10 - len(final_questions)])
        elif wants_mostly_beh and not wants_mostly_tech:
            final_questions = beh_qs[:10]
            if len(final_questions) < 10:
                final_questions.extend(tech_qs[:10 - len(final_questions)])
        else:
            # Topic or difficulty customization: keep balanced 5 tech + 5 behavioral if both available
            target_tech = min(len(tech_qs), 5)
            target_beh = min(len(beh_qs), 5)
            final_questions = tech_qs[:target_tech] + beh_qs[:target_beh]
            if len(final_questions) < 10:
                remaining = tech_qs[target_tech:] + beh_qs[target_beh:]
                final_questions.extend(remaining[:10 - len(final_questions)])
    else:
        # Default behavior: exactly 5 technical, 5 behavioral
        final_questions = tech_qs[:5] + beh_qs[:5]
        if len(final_questions) < 10:
            remaining = tech_qs[5:] + beh_qs[5:]
            needed = 10 - len(final_questions)
            final_questions.extend(remaining[:needed])
        
    if not final_questions:
        raise ValueError("AI failed to generate any valid questions. Please try again.")

    log.info(f"[Generate] Successfully created {len(final_questions)} validated questions (custom={bool(custom_inst_clean)}).")
    return final_questions

# ─── Coding Questions AI Generation ──────────────────────────────────────────

def normalize_coding_question_dict(q: Dict[str, Any], default_difficulty: str = "medium") -> Dict[str, Any]:
    """Normalize and validate a coding question dictionary."""
    title = str(q.get("title") or q.get("question_text") or "Coding Challenge").strip()
    description = str(q.get("description") or q.get("problem_statement") or "").strip()
    
    diff = str(q.get("difficulty") or default_difficulty).strip().lower()
    if diff not in ["easy", "medium", "hard"]:
        diff = "medium"

    examples = q.get("examples") if isinstance(q.get("examples"), list) else []
    constraints = q.get("constraints") if isinstance(q.get("constraints"), list) else []
    hints = q.get("hints") if isinstance(q.get("hints"), list) else []
    
    starter_code = q.get("starter_code")
    if not isinstance(starter_code, dict):
        starter_code = {"python": str(starter_code or "def solution():\n    pass")}
    elif "python" not in starter_code:
        first_val = next(iter(starter_code.values()), "def solution():\n    pass")
        starter_code["python"] = str(first_val)

    raw_test_cases = q.get("test_cases") if isinstance(q.get("test_cases"), list) else []
    normalized_tcs = []
    for tc in raw_test_cases:
        if not isinstance(tc, dict):
            continue
        expected = (
            tc.get("expected_output") or
            tc.get("expectedOutput") or
            tc.get("output") or
            tc.get("Output") or
            ""
        )
        inp = tc.get("input", tc.get("Input", ""))
        normalized_tcs.append({
            "input": str(inp),
            "expected_output": str(expected),
            "is_hidden": bool(tc.get("is_hidden", False)),
        })

    # If test cases were missing but examples exist, derive basic test cases from examples
    if not normalized_tcs and examples:
        for idx, ex in enumerate(examples):
            if isinstance(ex, dict) and "input" in ex and "output" in ex:
                normalized_tcs.append({
                    "input": str(ex["input"]),
                    "expected_output": str(ex["output"]),
                    "is_hidden": idx > 0,
                })

    return {
        "title": title,
        "difficulty": diff,
        "description": description,
        "examples": examples,
        "constraints": [str(c) for c in constraints],
        "hints": [str(h) for h in hints],
        "starter_code": starter_code,
        "test_cases": normalized_tcs,
    }


async def generate_ai_coding_questions(
    source_text: str,
    difficulty: Optional[str] = "medium",
    count: int = 2,
    custom_instructions: Optional[str] = None,
    challenge_types: Optional[List[str]] = None,
    is_raw_problem: bool = False
) -> List[Dict[str, Any]]:
    """
    Generate or parse structured coding interview problems using AI.

    If is_raw_problem is True:
      Parses raw recruiter-pasted problem text into structured coding questions.
    If is_raw_problem is False:
      Synthesizes new coding challenges grounded in the Job Description or prompt.
    """
    cleaned_source = (source_text or "").strip()
    if len(cleaned_source) < 20:
        raise ValueError("Please provide a more detailed Job Description, role summary, or problem description.")

    target_count = max(1, min(5, count or 2))
    target_diff = (difficulty or "medium").strip().lower()
    if target_diff not in ["easy", "medium", "hard", "mixed"]:
        target_diff = "medium"

    log.info(f"[CodingAI] Generating {target_count} coding questions (diff={target_diff}, is_raw={is_raw_problem})")

    diff_instruction = (
        "Generate a diverse mix of problems (e.g. 1 easy and 1 medium/hard)."
        if target_diff == "mixed"
        else f"Each problem must have difficulty calibrated to '{target_diff}'."
    )

    custom_block = ""
    if custom_instructions and custom_instructions.strip():
        custom_block = f"\nRECRUITER CUSTOM TOPIC / INSTRUCTIONS:\n\"{custom_instructions.strip()}\"\n- Prioritize these specific technical topics, concepts, or algorithms.\n"

    types_block = ""
    if challenge_types and len(challenge_types) > 0:
        cleaned_types = [t.strip() for t in challenge_types if t and t.strip()]
        if cleaned_types:
            types_list_str = "\n".join(f"- {ct}" for ct in cleaned_types)
            types_block = (
                f"\nTARGET CODING CHALLENGE TYPES (MANDATORY REQUIREMENT):\n"
                f"The recruiter has explicitly selected and mandated the following challenge types:\n"
                f"{types_list_str}\n"
                f"CRITICAL: Each generated problem MUST directly align with and test one of these designated challenge types. Do not ignore them or substitute generic problems.\n"
            )

    if is_raw_problem:
        system_content = (
            "You are an expert at parsing raw coding interview problems into structured challenge objects.\n"
            "Analyze the provided text and extract or create complete coding problems.\n"
            "Return ONLY valid JSON matching this schema:\n"
            "{\n"
            '  "questions": [\n'
            '    {\n'
            '      "title": string,\n'
            '      "difficulty": "easy" | "medium" | "hard",\n'
            '      "description": string,\n'
            '      "examples": [{"input": string, "output": string, "explanation": string}],\n'
            '      "constraints": [string],\n'
            '      "hints": [string],\n'
            '      "starter_code": {"python": string},\n'
            '      "test_cases": [{"input": string, "expected_output": string, "is_hidden": bool}]\n'
            '    }\n'
            '  ]\n'
            "}\n"
            "CRITICAL:\n"
            "- starter_code MUST ONLY contain the function signature/boilerplate and an empty placeholder ('pass'). DO NOT leak the solution in starter_code.\n"
            "- test_cases MUST have at least 4 test cases with 'input' and 'expected_output'. Mark the first 1-2 as is_hidden: false, and others as is_hidden: true."
        )
        user_content = f"Parse the following text into structured coding problem(s):\n\n{cleaned_source[:8000]}"
    else:
        system_content = (
            f"You are an expert technical interviewer and staff engineer crafting high-fidelity coding assessments.\n"
            f"Generate exactly {target_count} realistic, practical coding interview problems "
            f"STRICTLY AND 100% GROUNDED in the provided Job Description, candidate resume context, target role, technical stack, and requested Challenge Types.\n\n"
            f"DIFFICULTY CALIBRATION: {diff_instruction}\n"
            + custom_block
            + types_block +
            "\n"
            "STRICT DOMAIN GROUNDING & ANTI-CLICHÉ ENFORCEMENT (NON-NEGOTIABLE):\n"
            "1. ABSOLUTE PROHIBITION ON GENERIC LEETCODE CLICHÉS: Under NO circumstances should you produce generic textbook algorithms or competitive programming puzzles (such as Two Sum, Reverse Linked List, Longest Substring Without Repeating Characters, Valid Parentheses, Binary Search, or Fibonacci).\n"
            "2. SIMULATE REAL-WORLD PRODUCTION ENGINEERING: Every single problem MUST simulate an authentic, day-to-day engineering task that an engineer in this exact position would solve:\n"
            "   - If 'Frontend State & DOM Logic' is requested: Create real frontend state or rendering tasks (e.g. state management store with undo/redo, reactive event diffing, form validation engine, virtual DOM tree traversal).\n"
            "   - If 'Async Fetch & Debounce' is requested: Create real async handling tasks (e.g. debouncing API requests, request throttling queue, exponential backoff retries, chunk stream reader).\n"
            "   - If 'REST API & JSON Transforms' is requested: Create real API tasks (e.g. nested payload normalization, query string parameter parser, schema validation, pagination cursor encoder/decoder).\n"
            "   - If 'Async Queues & Concurrency' is requested: Create real concurrency tasks (e.g. bounded worker pool, task dependency topological scheduler, thread-safe token bucket rate limiter).\n"
            "   - If 'Database Queries & Data Modeling' is requested: Create real query/data tasks (e.g. in-memory relational hash join, B-tree index lookup simulator, SQL query filter evaluator).\n"
            "   - If 'Data Pipelines & Transformations' is requested: Create real data engineering tasks (e.g. stream anomaly detector, CSV/JSON record deduplicator, moving average aggregator).\n"
            "   - If 'System & Architecture Design' / 'Code Refactoring' is requested: Create real modular design tasks (e.g. cache invalidator, pluggable pipeline orchestrator, dependency container).\n"
            "3. DOMAIN-SPECIFIC STORY & CONTEXT: The title, problem scenario, variables, and explanations MUST use the terminology and domain context of the provided Job Description or Resume (e.g. fintech, e-commerce, healthcare, analytics, SaaS).\n\n"
            "REQUIREMENTS FOR EACH CODING PROBLEM:\n"
            "1. Title: Crisp, realistic engineering title (e.g. 'Debounced Search Query Dispatcher', 'User State Diff & Store Reducer', 'API Payload Schema Normalizer', 'Streaming Anomaly Window Filter').\n"
            "2. Description: Detailed problem statement, real-world context, input/output requirements, edge cases, and which challenge type it assesses.\n"
            "3. Examples: 2-3 realistic domain examples with input, output, and step-by-step explanations.\n"
            "4. Constraints: Array/string bounds, value limits, and expected time/space complexity.\n"
            "5. Hints: 1-2 progressive engineering hints for candidates who get stuck.\n"
            "6. Starter Code: Clean Python boilerplate (e.g. `def solution(...)` or meaningful function name `def debounce_dispatcher(...)`). "
            "MUST contain ONLY the signature, typed parameters, docstring, and 'pass'. NEVER include the actual solution.\n"
            "7. Test Cases: Exactly 4-6 diverse test cases:\n"
            "   - First 1-2 test cases MUST have is_hidden: false (public sample cases matching examples).\n"
            "   - Remaining 2-4 test cases MUST have is_hidden: true (hidden evaluation tests including edge cases: empty, single element, large values).\n"
            "   - 'input' must be a valid Python literal string or arguments representation (e.g. '[1, 2, 3], 4').\n"
            "   - 'expected_output' must be the exact expected return value as a string (e.g. '[0, 1]' or 'true' or '5').\n\n"
            "Return ONLY valid JSON matching this schema:\n"
            "{\n"
            '  "questions": [\n'
            '    {\n'
            '      "title": string,\n'
            '      "difficulty": "easy" | "medium" | "hard",\n'
            '      "description": string,\n'
            '      "examples": [{"input": string, "output": string, "explanation": string}],\n'
            '      "constraints": [string],\n'
            '      "hints": [string],\n'
            '      "starter_code": {"python": string},\n'
            '      "test_cases": [{"input": string, "expected_output": string, "is_hidden": bool}]\n'
            '    }\n'
            '  ]\n'
            "}"
        )
        user_content = f"Job Description / Candidate Context:\n{cleaned_source[:8000]}"

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content}
    ]

    MAX_RETRIES = 2
    parsed = None
    raw = ""
    for attempt in range(MAX_RETRIES):
        raw = await _chat(messages, timeout_override=120.0, max_tokens=6000, json_mode=True, model_type="question")
        log.info(f"[CodingAI] Raw response received ({len(raw)} chars, attempt {attempt + 1})")
        parsed = _extract_json(raw)
        if parsed and isinstance(parsed.get("questions"), list) and len(parsed["questions"]) > 0:
            break
        log.warning(f"[CodingAI] JSON parse retry on attempt {attempt + 1}")

    if not parsed or not isinstance(parsed.get("questions"), list):
        log.error(f"[CodingAI] Failed to parse coding questions. Raw: {raw[:300]}")
        raise ValueError("AI failed to generate structured coding questions. Please try again.")

    normalized_questions = []
    seen_titles = set()
    for q in parsed["questions"]:
        if not isinstance(q, dict):
            continue
        norm = normalize_coding_question_dict(q, default_difficulty=target_diff if target_diff != "mixed" else "medium")
        if not norm["title"] or not norm["description"]:
            continue
        clean_t = norm["title"].lower()
        if clean_t in seen_titles:
            continue
        seen_titles.add(clean_t)
        normalized_questions.append(norm)

    if not normalized_questions:
        raise ValueError("No valid coding problems could be generated from the given prompt. Please try providing more details.")

    log.info(f"[CodingAI] Successfully generated {len(normalized_questions)} coding questions.")
    return normalized_questions[:target_count]


async def recommend_coding_challenge_types(
    content: str,
    job_role: Optional[str] = None,
    skills: Optional[List[str]] = None,
    seniority: Optional[str] = None,
    min_exp: Optional[Union[int, str]] = None,
    max_exp: Optional[Union[int, str]] = None,
    custom_instructions: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Performs AI-based semantic analysis of full JD, resume, project descriptions,
    work history, and libraries to dynamically recommend relevant coding challenge types.

    Prioritization:
    - Uses Job Description as the PRIMARY assessment criteria (what needs to be evaluated).
    - Uses Candidate Resume for context (candidate's practical tech stack & seniority).
    - Extracts skills, libraries, frameworks, architectures even when explicit job titles or skill tags are missing.
    - If the input is insufficient (non-technical document, receipt, random text, sparse input),
      requests clarification rather than hallucinating or inventing types.
    """
    cleaned_content = (content or "").strip()
    role_str = (job_role or "").strip()
    skills_list = [s.strip() for s in (skills or []) if s and s.strip()]
    custom_str = (custom_instructions or "").strip()

    # Quick check for completely empty or sparse input
    if len(cleaned_content) < 30 and not role_str and not skills_list:
        return {
            "needs_clarification": True,
            "message": "The provided document or text does not contain sufficient technical details, job requirements, or skills to recommend coding challenge types. Please provide a technical job description or resume, or specify focus topics.",
            "types": []
        }

    # Build context prompt
    context_lines = []
    if role_str:
        context_lines.append(f"Target Role / Title: {role_str}")
    if skills_list:
        context_lines.append(f"Specified Skills / Tags: {', '.join(skills_list)}")
    if seniority:
        context_lines.append(f"Seniority Level: {seniority}")
    if min_exp is not None or max_exp is not None:
        context_lines.append(f"Experience Range: {min_exp or 0} to {max_exp or '+'} years")
    if custom_str:
        context_lines.append(f"Recruiter Notes / Instructions: {custom_str}")

    metadata_block = "\n".join(context_lines)

    system_prompt = (
        "You are an elite technical interview designer and staff architect.\n"
        "Your task is to perform deep semantic analysis of the provided document (which may be a Job Description, "
        "a candidate Resume/CV, project descriptions, or technical specifications) and recommend the most relevant, "
        "practical, and modern Coding Challenge Types for technical evaluation.\n\n"
        "KEY EVALUATION CRITERIA:\n"
        "1. JD VS RESUME PRIORITIZATION:\n"
        "   - Use the Job Description (JD) as the PRIMARY assessment criteria for what must be evaluated.\n"
        "   - Use the Resume as supporting context to align with the candidate's actual hands-on background and level.\n"
        "2. SEMANTIC EXTRACTION WITHOUT LABELS:\n"
        "   - The document might be unstructured prose, a fresher resume without job titles, or project bullet points.\n"
        "   - Infer the actual programming languages, frameworks, patterns, and problem types from project descriptions, "
        "libraries mentioned (e.g. React, Next.js, Django, FastAPI, PyTorch, Pandas, SQL, Docker, Redux), and technical responsibilities.\n"
        "3. CRITICAL - INSUFFICIENT INFORMATION CHECK (NO HALLUCINATIONS):\n"
        "   - If the text is NOT technical, is an invoice/receipt, random letters/sentences, administrative notice with no technical role context, "
        "or is too vague to determine any engineering requirements, DO NOT invent or guess technical types.\n"
        "   - Set \"needs_clarification\": true and explain politely in \"message\" why more technical information is required.\n"
        "4. GRANULAR, MEANINGFUL CHALLENGE TYPES:\n"
        "   - When technical details are present, recommend 4 to 8 crisp, specific challenge types.\n"
        "   - Keep each type title concise, punchy, and professional (around 2 to 4 words, under 32 characters, e.g. 'Data Cleaning & EDA', 'Frontend DOM & State', 'ML Model Validation', 'REST API & Transforms') so they fit neatly in 2-column UI cards.\n"
        "   - Avoid vague one-word labels like 'Coding' or 'Hard'. Use informative, skill-targeted types such as:\n"
        "     * Frontend: 'Frontend State & DOM Logic', 'Async Fetch & Debounce', 'Component Design & Props', 'CSS & Responsive Layout'\n"
        "     * Backend: 'REST API & JSON Transforms', 'Async Queues & Concurrency', 'Database Queries & Data Modeling', 'Authentication & Middleware'\n"
        "     * Full-Stack: 'Full-Stack Data Flow', 'API Integration & State Sync', 'Caching & In-Memory Store'\n"
        "     * Data/ML: 'Data Pipelines & Transformations', 'Data Aggregation & Grouping', 'Data Cleaning & Normalization', 'Model Feature Engineering'\n"
        "     * Systems/DevOps: 'System & Architecture Design', 'CLI Tool & Stream Processing', 'Concurrency & Worker Pools'\n"
        "     * Core Algorithms: 'Data Structures & Algorithms', 'Dynamic Programming & Memoization', 'Graph & Tree Traversal', 'Two Pointers & Sliding Window'\n\n"
        "OUTPUT SCHEMA (JSON ONLY):\n"
        "{\n"
        '  "needs_clarification": boolean,\n'
        '  "message": string,\n'
        '  "types": [string]\n'
        "}"
    )

    user_prompt = f"Metadata / Role Info:\n{metadata_block if metadata_block else 'None provided'}\n\nDocument Text:\n{cleaned_content[:8000]}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    try:
        raw = await _chat(messages, timeout_override=25.0, max_tokens=1000, json_mode=True, model_type="question")
        parsed = _extract_json(raw)
        if isinstance(parsed, dict) and "needs_clarification" in parsed:
            needs_clarification = bool(parsed.get("needs_clarification"))
            types = parsed.get("types") or []
            message = parsed.get("message") or ""

            # Sanitize types: clean string list, unique, max 8
            cleaned_types = []
            for t in types:
                if isinstance(t, str):
                    s = t.strip()
                    if s and s not in cleaned_types:
                        cleaned_types.append(s)

            if needs_clarification:
                return {
                    "needs_clarification": True,
                    "message": message or "The provided document does not contain sufficient technical details to recommend challenge types. Please provide a technical job description or resume.",
                    "types": []
                }

            if cleaned_types:
                return {
                    "needs_clarification": False,
                    "message": "",
                    "types": cleaned_types[:8]
                }
    except Exception as e:
        log.warning(f"[RecommendCodingTypes] AI call failed: {e}. Falling back to heuristic extraction.")

    # Fallback heuristic if LLM call timed out or failed
    combined_text = f"{role_str} {' '.join(skills_list)} {cleaned_content}".lower()

    # Check if text has any programming or technical keywords
    tech_keywords = [
        "python", "javascript", "typescript", "react", "node", "java", "c++", "c#", "golang", "go",
        "rust", "sql", "database", "api", "frontend", "backend", "fullstack", "full stack",
        "data", "machine learning", "ml", "ai", "devops", "cloud", "aws", "docker", "algorithms",
        "software", "developer", "engineer", "html", "css", "vue", "angular", "fastapi", "django"
    ]
    has_tech = any(re.search(rf"\b{re.escape(k)}\b", combined_text) for k in tech_keywords)

    if not has_tech:
        return {
            "needs_clarification": True,
            "message": "The provided document does not contain technical keywords, skills, or job duties to recommend coding challenge types. Please provide a technical job description or resume.",
            "types": []
        }

    # Generate heuristic fallback types based on detected keywords
    fallback_types = []
    if any(k in combined_text for k in ["react", "vue", "angular", "frontend", "css", "dom"]):
        fallback_types.extend(["Frontend State & DOM Logic", "Async Fetch & Debounce", "Component Design & Props"])
    if any(k in combined_text for k in ["backend", "api", "rest", "node", "express", "fastapi", "django", "spring"]):
        fallback_types.extend(["REST API & JSON Transforms", "Database Queries & Data Modeling", "Async Queues & Concurrency"])
    if any(k in combined_text for k in ["data", "pandas", "numpy", "pipeline", "etl", "machine learning", "ml", "sql"]):
        fallback_types.extend(["Data Pipelines & Transformations", "Data Aggregation & Grouping", "Database Queries & Data Modeling"])
    if any(k in combined_text for k in ["system", "architecture", "microservices", "distributed", "cache", "redis"]):
        fallback_types.extend(["System & Architecture Design", "Caching & In-Memory Store"])

    fallback_types.extend(["Data Structures & Algorithms", "Code Refactoring & Clean Code"])

    # Deduplicate preserving order
    seen = set()
    final_fallback = [t for t in fallback_types if not (t in seen or seen.add(t))]

    return {
        "needs_clarification": False,
        "message": "",
        "types": final_fallback[:6]
    }


# ─── Evaluation ───────────────────────────────────────────────────────────────

async def score_answers(
    job_role: str,
    candidate_name: str,
    questions: List[Dict[str, Any]],
    code_info: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Score all interview answers and produce evaluation breakdown.

    Anchors coding score to objective test execution results.
    Weights:
      - Technical: 40%
      - Behavioral: 30%
      - Coding: 30% (hard-capped by test results)
    """
    # Check if all candidate answers are filler or empty (no meaningful response)
    all_filler = True
    for q in questions:
        ans = q.get("candidate_answer", "")
        if ans and is_meaningful_response(ans):
            all_filler = False
            break
            
    if all_filler:
        return {
            "per_question": [
                {
                    "question_index": i,
                    "score": 0,
                    "feedback": "No meaningful answer was provided; only acknowledgements or filler speech were detected."
                }
                for i in range(len(questions))
            ],
            "technical_score": 0,
            "coding_score": 0,
            "behavioral_score": 0,
            "overall_score": 0,
            "recommendation": "not_recommend",
            "summary": "No meaningful answer was provided and only acknowledgements/filler speech were detected."
        }

    qa_pairs = "\n\n".join(
        f"Q{i+1} [{q['question_type'].upper()}/{q['difficulty']}][Tag: {q.get('rubric', {}).get('tag') if q.get('rubric') else 'none'}]: {q['question_text']}\n"
        f"Answer: {q.get('candidate_answer') or '(no answer provided)'}"
        for i, q in enumerate(questions)
    )

    # Build objective code execution context
    code_execution_context = ""
    if code_info:
        lines = []
        for idx, c in enumerate(code_info):
            passed = c.get("passed_tests", 0)
            total = c.get("total_tests", 0)
            lang = c.get("language", "unknown")
            pct = round(passed / total * 100) if total > 0 else 0
            lines.append(
                f"Submission {idx+1}: Language={lang}, Tests={passed}/{total} ({pct}% pass rate)"
            )
        code_execution_context = (
            "\n\nOBJECTIVE CODE RESULTS (these override AI opinion on coding score):\n"
            + "\n".join(lines)
            + "\nRULE: If <30% tests pass, coding_score MUST be below 40."
            + "\nRULE: If 100% tests pass, coding_score should be 85+."
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert hiring evaluator. Score each answer rigorously and fairly.\n\n"
                "SCORING RULES:\n"
                "- Score 0-100 per question based on accuracy, depth, practical experience, and relevance.\n"
                "- EXPLICIT PARTIAL CREDIT: If an answer is partially correct but misses some details, award partial credit (e.g., 40-70). Never use binary pass/fail scoring.\n"
                "- A blank/evasive/noise answer (e.g., 'okay', 'I don't know') scores 0-15 max.\n"
                "- A partial answer scores 30-60 depending on what was covered.\n"
                "- A strong, complete answer scores 70-95.\n"
                "- PENALIZE generic, textbook, or AI-sounding answers that lack real-world implementation details.\n"
                "- REWARD answers containing practical experience, trade-offs, debugging scenarios, and deep technical reasoning (for technical questions).\n"
                "- For self-introductions or behavioral questions, evaluate based on communication clarity, structure, and professional presentation instead of deep technical reasoning.\n"
                "- Evaluate based on the expected experience level for the role.\n"
                "- Do NOT reward wrong answers with high scores for effort.\n"
                "- Coding score MUST reflect objective test execution results (provided below).\n"
                "- STT LENIENCY: This transcript is generated by Speech-to-Text. You MUST aggressively account for phonetic hallucinations (e.g., 'bacon engineer' means 'backend engineer', 'fast AVI' means 'FastAPI'). Apply phonetic correction before scoring. Do NOT penalize the candidate for STT errors.\n\n"
                "CRITICAL SCALING INSTRUCTIONS:\n"
                "- If < 3 years: Focus on syntax, standard library usage, core definitions, and basic implementation steps.\n"
                "- If 3-7 years: Focus on optimization, debugging complex edge cases, testing strategies, and best practices within specific frameworks.\n"
                "- If 8+ years (Senior/Lead): FORBID basic implementation or 'how-to' questions. You MUST ask about system design, architectural trade-offs, scaling bottlenecks, distributed systems resilience, and leading technical teams through complex migrations.\n\n"
                "Return ONLY valid JSON:\n"
                "{\n"
                '  "summary": "3-4 sentence honest candidate summary",\n'
                '  "strengths": "Provide a comprehensive summary of the candidate\'s strengths based on their answers.",\n'
                '  "weaknesses": "Provide a comprehensive summary of the candidate\'s weaknesses.",\n'
                '  "missing_concepts": ["List", "of", "missing", "or", "incorrect", "concepts"],\n'
                '  "per_question": [\n'
                '    { "question_index": 0, "feedback": "2-3 sentence specific feedback", "score": 0-100 }\n'
                "  ],\n"
                '  "recommendation": "strongly_recommend" | "recommend" | "maybe" | "not_recommend",\n'
                '  "technical_score": 0-100,\n'
                '  "coding_score": 0-100,\n'
                '  "behavioral_score": 0-100,\n'
                '  "overall_score": 0-100\n'
                "}"
            ),
        },
        {
            "role": "user",
            "content": (
                f"Job Role: {job_role}\n\n"
                f"Candidate: {candidate_name}\n\n"
                f"Questions & Answers:\n{qa_pairs}"
                f"{code_execution_context}"
            ),
        },
    ]

    import json
    log.info(f"\n{'='*50}\n[Evaluate] EVALUATION LLM REQUEST:\n{json.dumps(messages, indent=2)}\n{'='*50}\n")
    
    raw = await _chat(messages, max_tokens=2500)  # Low temp for consistent scoring
    
    log.info(f"\n{'='*50}\n[Evaluate] RAW EVALUATION RESPONSE:\n{raw}\n{'='*50}\n")
    
    evaluation = _extract_json(raw)
    if not evaluation:
        raise ValueError("Failed to parse AI scoring response.")

    # ── Hard-cap coding score based on test results ────────────────────────────
    if code_info:
        total_passed = sum(c.get("passed_tests", 0) for c in code_info)
        total_tests = sum(c.get("total_tests", 0) for c in code_info)
        if total_tests > 0:
            pass_rate = total_passed / total_tests
            if pass_rate == 0:
                evaluation["coding_score"] = min(evaluation.get("coding_score", 0), 30)
            elif pass_rate < 0.5:
                evaluation["coding_score"] = min(evaluation.get("coding_score", 0), 60)

    # ── Recalculate overall from weighted components ───────────────────────────
    weights = {"technical_score": 0.4, "behavioral_score": 0.3, "coding_score": 0.3}
    weighted_sum = 0.0
    weight_total = 0.0
    for key, weight in weights.items():
        val = evaluation.get(key)
        if val is not None:
            weighted_sum += val * weight
            weight_total += weight
    if weight_total > 0:
        evaluation["overall_score"] = round(weighted_sum / weight_total)

    return evaluation


async def evaluate_interview(
    job_role: str,
    messages_list: List[Dict[str, Any]],
    code_submissions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Deep evaluation using the full interview transcript.
    Returns scores + strengths, weaknesses, category breakdown, and emotional indicators.
    """
    # Check if all candidate messages are filler or empty
    candidate_messages = [m for m in messages_list if m.get("role") == "user"]
    all_filler = True
    if candidate_messages:
        for m in candidate_messages:
            if is_meaningful_response(m.get("content", "")):
                all_filler = False
                break
    else:
        all_filler = True

    if all_filler:
        return {
            "summary": "No meaningful answer was provided and only acknowledgements/filler speech were detected.",
            "strengths": [],
            "weaknesses": ["No meaningful answer was provided and only acknowledgements/filler speech were detected."],
            "missing_concepts": [],
            "per_question_feedback": [],
            "technical_score": 0,
            "behavioral_score": 0,
            "coding_score": 0,
            "overall_score": 0
        }

    transcript = "\n".join(
        f"[{m['round'].upper()}] {m['role'].upper()}: {m['content']}"
        for m in messages_list
    )
    code_info = "\n".join(
        f"Language: {s['language']}, Tests: {s.get('passed_tests', 0)}/{s.get('total_tests', 0)}, "
        f"Snippet: {str(s.get('code', ''))[:400]}"
        for s in code_submissions
    ) or "No code submissions."

    # Mode Detection
    has_coding = any(m.get("round") == "coding" for m in messages_list)
    
    if has_coding:
        schema_scores = (
            '  "technical_score": <0-100>,\n'
            '  "behavioral_score": <0-100>,\n'
            '  "coding_score": <0-100>,\n'
            '  "overall_score": <0-100>\n'
        )
        coding_rule = "- Coding score must reflect actual test pass rates if available.\n\n"
    else:
        schema_scores = (
            '  "technical_score": <0-100>,\n'
            '  "behavioral_score": <0-100>,\n'
            '  "overall_score": <0-100>\n'
        )
        coding_rule = "\n"

    evaluation_prompt = (
        f"You are a senior hiring evaluator. Analyze this complete interview transcript thoroughly.\n\n"
        f"Job Role: {job_role or 'Software Engineer'}\n\n"
        f"Full Interview Transcript:\n{transcript}\n\n"
        f"Code Submissions:\n{code_info}\n\n"
        "EVALUATION RULES:\n"
        "- Be accurate and honest. Do not inflate scores.\n"
        "- Evasive or skipped answers must lower relevant scores.\n"
        "- PENALIZE generic, template-like, or AI-sounding answers lacking practical implementation details.\n"
        "- REWARD answers containing real-world experience, specific project context, and deep technical reasoning (for technical questions).\n"
        "- For self-introductions or behavioral questions, evaluate based on communication clarity, structure, and professional presentation instead of deep technical reasoning.\n"
        "- Evaluate the candidate based on the expectations for their experience level.\n"
        "- Special focus on initial questions: evaluate the 'self-introduction' for communication and the 'project explanation' for technical depth and ownership.\n"
        "- Strong answers with correct concepts should be rewarded appropriately.\n"
        f"{coding_rule}"
        "Return ONLY valid JSON (no markdown):\n"
        "{\n"
        '  "summary": "3-4 sentence honest evaluation summary",\n'
        '  "strengths": ["specific strength 1", "specific strength 2"],\n'
        '  "weaknesses": ["specific gap 1", "specific gap 2"],\n'
        '  "missing_concepts": ["concept 1", "concept 2"],\n'
        '  "per_question_feedback": [\n'
        '    {"question_index": 0, "feedback": "feedback text", "score": <0-100>}\n'
        '  ],\n'
        f"{schema_scores}"
        "}"
    )

    messages = [
        {"role": "system", "content": "You are a senior hiring evaluator. Be accurate and specific. Return only valid JSON."},
        {"role": "user", "content": evaluation_prompt},
    ]

    raw = await _chat(messages, max_tokens=2500)
    evaluation = _extract_json(raw)
    if not evaluation:
        raise ValueError("Failed to parse AI evaluation response.")

    # Recalculate overall from weighted components
    if has_coding:
        weights = {"technical_score": 0.4, "behavioral_score": 0.3, "coding_score": 0.3}
    else:
        weights = {"technical_score": 0.6, "behavioral_score": 0.4}
        evaluation["coding_score"] = None

    weighted_sum = 0.0
    weight_total = 0.0
    for key, weight in weights.items():
        val = evaluation.get(key)
        if val is not None:
            weighted_sum += val * weight
            weight_total += weight
    
    if weight_total > 0:
        evaluation["overall_score"] = round(weighted_sum / weight_total)
    
    # If no coding questions were asked, force remove coding_score so it doesn't pollute the DB or UI
    if not has_coding and "coding_score" in evaluation:
        del evaluation["coding_score"]

    return evaluation
