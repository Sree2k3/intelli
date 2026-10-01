import time
import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy import and_, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import (
    User, Interview, CodingQuestion, CodeSubmission,
    CodeExecuteRequest, CodeSubmitRequest, InterviewSession
)
from auth import get_optional_user
from judge0_client import get_judge0_client
from utils import _coding_question_to_dict
from logging_config import logger as log
from auth_rbac import get_user_context, get_optional_user_context, UserContext, Role, Permission
from question_similarity import find_duplicate_in_list

router = APIRouter(prefix="", tags=["Coding Assessments"])

# ─── UTILS (from main.py) ────────────────────────────────────────────────────────

def _extract_func_name(code: str, language: str) -> str:
    """Extract the user's function name from their code (Python only)."""
    import re
    
    if language == "python":
        # Check for class Solution pattern first (LeetCode style)
        m = re.search(r"class\s+Solution\b.*?def\s+([a-zA-Z_]\w*)\s*\(", code, re.DOTALL)
        if m and m.group(1) != "__init__": return m.group(1)
        # Standalone function
        for match in re.finditer(r"def\s+([a-zA-Z_]\w*)\s*\(", code):
            name = match.group(1)
            if name not in ("__init__", "__str__", "__repr__"): return name
            
    return "solution"
    return "solution"

def _is_equivalent(actual: str, expected: str) -> bool:
    """Compare actual output to expected output with fuzzy matching."""
    import json
    actual = actual.strip()
    expected = expected.strip()
    if not actual and not expected: return True
    if not actual or not expected: return False
    if actual == expected: return True
    
    # Numeric comparison (handles "6" vs "6.0" etc.)
    try:
        if float(actual) == float(expected): return True
    except: pass

    # JSON comparison (handles "[1, 2, 3]" vs "[1,2,3]")
    try:
        a_obj = json.loads(actual)
        e_obj = json.loads(expected)
        if a_obj == e_obj: return True
    except: pass
    
    # Normalized string comparison (aggressive whitespace removal, quote normalization)
    def norm(s):
        return s.replace(" ", "").replace("\n", "").replace("\t", "").replace("\r", "").replace('"', "'").strip()
    
    a_norm = norm(actual)
    e_norm = norm(expected)
    if a_norm == e_norm: return True
    
    # Try one more fuzzy match for lists/arrays if string comparison failed
    # e.g. [1,2] vs [1, 2] vs (1, 2)
    def clean_format(s):
        return s.replace("[", "").replace("]", "").replace("(", "").replace(")", "").replace("{", "").replace("}", "")
    return norm(clean_format(actual)) == norm(clean_format(expected))

def _build_harness(user_code: str, language: str, func_name: str = "solution") -> str:
    """Build a test harness that wraps user code for execution (Python only)."""
    if language == "python":
        # This harness:
        # 1. Defines user code at module scope
        # 2. Reads stdin as JSON input
        # 3. Finds and calls the user's function
        # 4. Captures both print() output and return values
        return (
            "import sys, json, inspect, io, ast\n"
            "from typing import List, Optional, Dict, Any, Tuple, Set\n"
            "import math, collections, heapq, bisect, functools, itertools\n"
            "\n"
            f"{user_code}\n"
            "\n"
            "def __run_test():\n"
            "    try:\n"
            "        _input_text = sys.stdin.read().strip()\n"
            "        _args = []\n"
            "        _kwargs = {}\n"
            "        if _input_text:\n"
            "            # Attempt to parse as keyword arguments (e.g., 'nums=[1,2,3], target=9')\n"
            "            if '=' in _input_text and ',' in _input_text:\n"
            "                try:\n"
            "                    # Split by comma followed by optional space, but only if not inside brackets\n"
            "                    # For simplicity, we split by common comma-space and use ast.literal_eval\n"
            "                    _parts = _input_text.split(', ')\n"
            "                    for _p in _parts:\n"
            "                        if '=' in _p:\n"
            "                            _k, _v = _p.split('=', 1)\n"
            "                            _kwargs[_k.strip()] = ast.literal_eval(_v.strip())\n"
            "                except:\n"
            "                    _kwargs = {}\n"
            "\n"
            "            if not _kwargs:\n"
            "                try:\n"
            "                    _parsed = json.loads(_input_text)\n"
            "                    _args = _parsed if isinstance(_parsed, list) else [_parsed]\n"
            "                except:\n"
            "                    _args = [_input_text]\n"
            "\n"
            "        # Find the target function\n"
            "        _target = None\n"
            "        if 'Solution' in globals():\n"
            "            _sol = globals()['Solution']()\n"
            f"            _target = getattr(_sol, '{func_name}', None)\n"
            "        if not _target:\n"
            f"            _target = globals().get('{func_name}')\n"
            "        if not _target:\n"
            "            for _n, _o in globals().items():\n"
            "                if callable(_o) and not _n.startswith('_') and _n not in ('print',):\n"
            "                    _target = _o\n"
            "                    break\n"
            "        if not _target:\n"
            f"            raise NameError(\"Function '{func_name}' not found\")\n"
            "\n"
            "        _sig = inspect.signature(_target)\n"
            "        _params = [p for p in _sig.parameters.values() if p.name != 'self']\n"
            "        _n_params = len(_params)\n"
            "\n"
            "        # Capture stdout from the function call\n"
            "        _old_stdout = sys.stdout\n"
            "        _capture = io.StringIO()\n"
            "        sys.stdout = _capture\n"
            "\n"
            "        # Call the function dynamically\n"
            "        if _kwargs:\n"
            "            _res = _target(**_kwargs)\n"
            "        else:\n"
            "            if _n_params == 0:\n"
            "                _res = _target()\n"
            "            elif _n_params == 1:\n"
            "                _res = _target(_args if len(_args) != 1 else _args[0])\n"
            "            else:\n"
            "                _res = _target(*_args)\n"
            "\n"
            "        sys.stdout = _old_stdout\n"
            "        _printed = _capture.getvalue().strip()\n"
            "\n"
            "        # Output priority: return value > printed output\n"
            "        if _res is not None:\n"
            "            print(json.dumps(_res))\n"
            "        elif _printed:\n"
            "            print(_printed)\n"
            "    except Exception as e:\n"
            "        sys.stdout = sys.__stdout__\n"
            "        print(f'Runtime Error: {e}', file=sys.stderr)\n"
            "        sys.exit(1)\n"
            "\n"
            "__run_test()\n"
        )
    
    elif language == "cpp":
        headers = (
            "#include <iostream>\n"
            "#include <string>\n"
            "#include <vector>\n"
            "#include <algorithm>\n"
            "#include <map>\n"
            "#include <set>\n"
            "#include <cmath>\n"
            "using namespace std;\n\n"
        )
        if headers not in user_code:
            user_code = headers + user_code
            
        main_harness = (
            "\n\n"
            "int main() {\n"
            "    string input_data;\n"
            "    string line;\n"
            "    while (getline(cin, line)) {\n"
            "        input_data += line + \"\\n\";\n"
            "    }\n"
            "    // Trim trailing newline if any\n"
            "    if (!input_data.empty() && input_data.back() == '\\n') input_data.pop_back();\n"
            "    \n"
            "    Solution sol;\n"
            "    cout << sol.solution(input_data);\n"
            "    return 0;\n"
            "}\n"
        )
        # We only append main if they haven't written one
        if "int main(" not in user_code and "int main ()" not in user_code:
            return user_code + main_harness
        return user_code

    elif language == "c":
        headers = (
            "#include <stdio.h>\n"
            "#include <stdlib.h>\n"
            "#include <string.h>\n"
            "#include <math.h>\n\n"
        )
        if headers not in user_code:
            user_code = headers + user_code
            
        main_harness = (
            "\n\n"
            "int main() {\n"
            "    char buffer[4096];\n"
            "    char input_data[16384] = \"\";\n"
            "    while (fgets(buffer, sizeof(buffer), stdin)) {\n"
            "        strcat(input_data, buffer);\n"
            "    }\n"
            "    // Trim trailing newline if any\n"
            "    int len = strlen(input_data);\n"
            "    if (len > 0 && input_data[len-1] == '\\n') input_data[len-1] = '\\0';\n"
            "    \n"
            "    solution(input_data);\n"
            "    return 0;\n"
            "}\n"
        )
        # We only append main if they haven't written one
        if "int main(" not in user_code and "int main ()" not in user_code:
            return user_code + main_harness
        return user_code

    elif language == "java":
        # For Java, they must write `class Solution`. We will wrap it in a Main class.
        if "class Solution" in user_code and "public static void main" not in user_code:
            return (
                "import java.util.*;\n"
                "import java.io.*;\n\n"
                f"{user_code}\n\n"
                "public class SolutionHarness {\n"
                "    public static void main(String[] args) {\n"
                "        try {\n"
                "            Scanner scanner = new Scanner(System.in);\n"
                "            StringBuilder input = new StringBuilder();\n"
                "            while (scanner.hasNextLine()) {\n"
                "                input.append(scanner.nextLine()).append(\"\\n\");\n"
                "            }\n"
                "            Solution sol = new Solution();\n"
                "            System.out.print(sol.solution(input.toString().trim()));\n"
                "        } catch (Exception e) {\n"
                "            e.printStackTrace();\n"
                "        }\n"
                "    }\n"
                "}\n"
            )
        return user_code

    return user_code

# ─── ROUTES ──────────────────────────────────────────────────────────────────────

@router.get("/api/rest/v1/coding_questions")
async def list_coding_questions(
    interview_id: str = Query(...),
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    invite_token: Optional[str] = Header(None, alias="x-invite-token"),
    db: AsyncSession = Depends(get_db),
):
    """List coding questions for an interview (JWT or invite token)."""
    # Resolve multi-candidate session ID to template ID
    import uuid
    obj_uuid = uuid.UUID(str(interview_id))
    
    sess_res = await db.execute(select(InterviewSession).where(InterviewSession.id == obj_uuid))
    session = sess_res.scalar_one_or_none()
    
    resolved_id = obj_uuid
    if session:
        resolved_id = session.interview_id

    # Auth Logic
    if invite_token:
        # Check both session token and invite token
        if session:
            permission_granted = session.session_token == invite_token
        else:
            r = await db.execute(select(Interview).where(and_(Interview.id == resolved_id, Interview.invite_token == invite_token)))
            permission_granted = r.scalar_one_or_none() is not None
        
        if not permission_granted:
            raise HTTPException(403, "Invalid invite token")

        # Load interview template to check access
        r_t = await db.execute(select(Interview).where(Interview.id == resolved_id))
        interview_template = r_t.scalar_one_or_none()
        if not interview_template:
            raise HTTPException(404, "Interview not found")

        # Enforce access window check
        from utils import check_access_status, raise_access_blocked_exception
        access_status = check_access_status(session or interview_template, interview_template)
        if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
            raise_access_blocked_exception(access_status, interview_template)
    elif ctx and ctx.user:
        r = await db.execute(select(Interview).where(Interview.id == resolved_id))
        interview = r.scalar_one_or_none()
        if not interview or str(interview.tenant_id) != str(ctx.tenant_id):
             raise HTTPException(403, "Forbidden")
        if ctx.role == Role.RECRUITER and str(interview.recruiter_id) != str(ctx.user.id):
             raise HTTPException(403, "Forbidden")
    else:
        raise HTTPException(401, "Not authenticated")

    result = await db.execute(select(CodingQuestion).where(CodingQuestion.interview_id == resolved_id).order_by(CodingQuestion.order_index))
    cqs = result.scalars().all()

    out = []
    for cq in cqs:
        d = _coding_question_to_dict(cq)
        if invite_token and (not ctx or not ctx.user):
            d["test_cases"] = [tc for tc in (d.get("test_cases") or []) if not tc.get("is_hidden", False)]
        out.append(d)
    return out


@router.get("/api/rest/v1/code_submissions")
async def list_code_submissions(
    interview_id: uuid.UUID = Query(...),
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    invite_token: Optional[str] = Header(None, alias="x-invite-token"),
    db: AsyncSession = Depends(get_db),
):
    """List code submissions for an interview (Recruiter JWT or invite token)."""
    sess_res = await db.execute(select(InterviewSession).where(InterviewSession.id == interview_id))
    session = sess_res.scalar_one_or_none()
    
    resolved_id = interview_id
    if session:
        resolved_id = session.interview_id

    if invite_token:
        if session:
            permission_granted = session.session_token == invite_token
        else:
            r = await db.execute(select(Interview).where(and_(Interview.id == resolved_id, Interview.invite_token == invite_token)))
            permission_granted = r.scalar_one_or_none() is not None
        if not permission_granted:
            raise HTTPException(403, "Invalid invite token")

        # Load interview template to check access
        r_t = await db.execute(select(Interview).where(Interview.id == resolved_id))
        interview_template = r_t.scalar_one_or_none()
        if not interview_template:
            raise HTTPException(404, "Interview not found")

        # Enforce access window check
        from utils import check_access_status, raise_access_blocked_exception
        access_status = check_access_status(session or interview_template, interview_template)
        if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
            raise_access_blocked_exception(access_status, interview_template)
    elif ctx and ctx.user:
        r = await db.execute(select(Interview).where(Interview.id == resolved_id))
        interview = r.scalar_one_or_none()
        if not interview or str(interview.tenant_id) != str(ctx.tenant_id):
             raise HTTPException(403, "Forbidden")
        if ctx.role == Role.RECRUITER and str(interview.recruiter_id) != str(ctx.user.id):
             raise HTTPException(403, "Forbidden")
    else:
        raise HTTPException(401, "Not authenticated")

    # For multi-candidate sessions: submissions are saved with session_id; query by that.
    # For single interviews: query by resolved_id (template interview id).
    if session:
        result = await db.execute(
            select(CodeSubmission)
            .where(CodeSubmission.session_id == session.id)
            .order_by(CodeSubmission.created_at)
        )
        log.info(f"[code_submissions] Fetching by session_id={session.id}")
    else:
        result = await db.execute(
            select(CodeSubmission)
            .where(CodeSubmission.interview_id == resolved_id)
            .order_by(CodeSubmission.created_at)
        )
        log.info(f"[code_submissions] Fetching by interview_id={resolved_id}")
    subs = result.scalars().all()
    log.info(f"[code_submissions] Found {len(subs)} submission(s)")
    return [
        {
            "id": str(s.id),
            "interview_id": str(s.interview_id),
            "question_id": str(s.question_id) if s.question_id else None,
            "language": s.language,
            "code": s.code,
            "output": s.output,
            "passed_tests": s.passed_tests,
            "total_tests": s.total_tests,
            "execution_time_ms": s.execution_time_ms,
            "status": s.status,
            "ai_feedback": s.ai_feedback,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in subs
    ]

@router.post("/api/rest/v1/coding_questions", status_code=201)
async def create_coding_questions(
    body: Dict[str, Any],
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Save coding questions for an interview (bulk or single)."""
    if not ctx or not ctx.user:
        raise HTTPException(401, "Not authenticated")

    interview_id: str = body.get("interview_id", "")
    questions: list = body.get("questions", [])
    single_mode = False
    if not questions and "title" in body:
        questions = [body]
        single_mode = True

    if not interview_id:
        raise HTTPException(422, "interview_id is required")
    if not questions:
        raise HTTPException(422, "questions list or question details are required")

    # 1. Reject duplicate titles within the questions payload itself
    seen_payload_titles: List[str] = []
    for q in questions:
        t = (q.get("title") or "").strip()
        if not t:
            continue
        dup = find_duplicate_in_list(t, seen_payload_titles)
        if dup:
            log.warning(f"Duplicate coding question detected in payload: '{t}' matches '{dup}'")
            raise HTTPException(400, "This question has already been added.")
        seen_payload_titles.append(t)

    # Verify tenant & owner
    r = await db.execute(select(Interview).where(Interview.id == uuid.UUID(str(interview_id))))
    interview = r.scalar_one_or_none()
    if not interview:
        raise HTTPException(404, "Interview not found")

    is_super = ctx.role == Role.SUPER_ADMIN or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
    same_tenant = ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id)
    is_owner = ctx.user.id and (str(interview.user_id) == str(ctx.user.id) or str(interview.recruiter_id) == str(ctx.user.id))

    if not (is_super or same_tenant or is_owner):
        raise HTTPException(403, "Forbidden")
    if ctx.role == Role.RECRUITER and not is_owner and not is_super:
        raise HTTPException(403, "Forbidden")

    # 2. If appending (replace is False), reject if duplicate already exists in DB for this interview
    if not body.get("replace", False):
        existing_cqs_res = await db.execute(
            select(CodingQuestion.title)
            .where(CodingQuestion.interview_id == uuid.UUID(str(interview_id)))
        )
        existing_titles = [row[0] for row in existing_cqs_res.all() if row[0]]
        for q in questions:
            t = (q.get("title") or "").strip()
            if not t:
                continue
            dup = find_duplicate_in_list(t, existing_titles)
            if dup:
                log.warning(f"Duplicate coding question against DB: '{t}' matches '{dup}' in interview {interview_id}")
                raise HTTPException(400, "This question has already been added.")

    # If replace flag is passed, remove existing coding questions for this interview first
    if body.get("replace", False):
        await db.execute(delete(CodingQuestion).where(CodingQuestion.interview_id == uuid.UUID(str(interview_id))))

    # Compute base order_index if appending
    max_idx = 0
    if not body.get("replace", False):
        m_r = await db.execute(
            select(CodingQuestion.order_index)
            .where(CodingQuestion.interview_id == uuid.UUID(str(interview_id)))
            .order_by(CodingQuestion.order_index.desc())
            .limit(1)
        )
        last_idx = m_r.scalar_one_or_none()
        if last_idx is not None:
            max_idx = last_idx + 1

    inserted = []
    for idx, q in enumerate(questions):
        diff = q.get("difficulty", "medium").lower()
        if diff not in ("easy", "medium", "hard"):
            diff = "medium"
        new_cq = CodingQuestion(
            interview_id=uuid.UUID(str(interview_id)),
            tenant_id=interview.tenant_id,
            title=q.get("title", f"Problem {max_idx + idx + 1}"),
            difficulty=diff,
            description=q.get("description", ""),
            examples=q.get("examples", []),
            constraints=q.get("constraints", []),
            hints=q.get("hints", []),
            starter_code=q.get("starter_code", {}),
            test_cases=q.get("test_cases", []),
            order_index=max_idx + idx,
        )
        db.add(new_cq)
        inserted.append(new_cq)

    await db.commit()
    for cq in inserted:
        await db.refresh(cq)

    log.info(f"Created {len(inserted)} coding question(s) for interview {interview_id}")
    res_list = [_coding_question_to_dict(cq) for cq in inserted]
    return res_list[0] if single_mode and len(res_list) == 1 else res_list


@router.patch("/api/rest/v1/coding_questions/{question_id}")
async def update_coding_question(
    question_id: str,
    body: Dict[str, Any],
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Update a coding question's title, description, difficulty, test_cases, etc."""
    if not ctx or not ctx.user:
        raise HTTPException(401, "Not authenticated")

    try:
        q_uuid = uuid.UUID(str(question_id).strip())
    except (ValueError, AttributeError):
        raise HTTPException(400, "Invalid question ID format")

    result = await db.execute(select(CodingQuestion).where(CodingQuestion.id == q_uuid))
    cq = result.scalar_one_or_none()
    if not cq:
        raise HTTPException(404, "Coding question not found")

    r = await db.execute(select(Interview).where(Interview.id == cq.interview_id))
    interview = r.scalar_one_or_none()
    if not interview:
        raise HTTPException(404, "Interview not found")

    is_super = ctx.role == Role.SUPER_ADMIN or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
    same_tenant = ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id)
    is_owner = ctx.user.id and (str(interview.user_id) == str(ctx.user.id) or str(interview.recruiter_id) == str(ctx.user.id))

    if not (is_super or same_tenant or is_owner):
        raise HTTPException(403, "Forbidden")
    if ctx.role == Role.RECRUITER and not is_owner and not is_super:
        raise HTTPException(403, "Forbidden")

    if "title" in body and body["title"] is not None:
        new_title = str(body["title"]).strip()
        other_cqs_res = await db.execute(
            select(CodingQuestion.title)
            .where(
                and_(
                    CodingQuestion.interview_id == cq.interview_id,
                    CodingQuestion.id != cq.id,
                )
            )
        )
        other_titles = [row[0] for row in other_cqs_res.all() if row[0]]
        dup = find_duplicate_in_list(new_title, other_titles)
        if dup:
            log.warning(f"Duplicate coding question on update: '{new_title}' matches '{dup}' in interview {cq.interview_id}")
            raise HTTPException(400, "This question has already been added.")
        cq.title = new_title
    if "description" in body and body["description"] is not None:
        cq.description = str(body["description"]).strip()
    if "difficulty" in body and body["difficulty"] is not None:
        diff = str(body["difficulty"]).strip().lower()
        if diff in ("easy", "medium", "hard"):
            cq.difficulty = diff
    if "test_cases" in body and body["test_cases"] is not None:
        cq.test_cases = body["test_cases"]
    if "examples" in body and body["examples"] is not None:
        cq.examples = body["examples"]
    if "starter_code" in body and body["starter_code"] is not None:
        cq.starter_code = body["starter_code"]
    if "constraints" in body and body["constraints"] is not None:
        cq.constraints = body["constraints"]
    if "hints" in body and body["hints"] is not None:
        cq.hints = body["hints"]

    await db.commit()
    await db.refresh(cq)
    log.info(f"Updated coding question {question_id}")
    return _coding_question_to_dict(cq)


@router.delete("/api/rest/v1/coding_questions/{question_id}")
async def delete_coding_question(
    question_id: str,
    ctx: UserContext = Depends(get_user_context),
    db: AsyncSession = Depends(get_db),
):
    """Delete a coding question from an interview (Recruiter only)."""
    if not ctx or not ctx.user:
        raise HTTPException(401, "Not authenticated")

    try:
        q_uuid = uuid.UUID(str(question_id).strip())
    except (ValueError, AttributeError):
        raise HTTPException(400, "Invalid question ID format")

    result = await db.execute(select(CodingQuestion).where(CodingQuestion.id == q_uuid))
    cq = result.scalar_one_or_none()
    if not cq:
        raise HTTPException(404, "Coding question not found")

    r = await db.execute(select(Interview).where(Interview.id == cq.interview_id))
    interview = r.scalar_one_or_none()
    if not interview:
        raise HTTPException(404, "Interview not found")

    is_super = ctx.role == Role.SUPER_ADMIN or getattr(ctx.user, "email", None) == "sso-admin@scaloz.com"
    same_tenant = ctx.tenant_id and str(interview.tenant_id) == str(ctx.tenant_id)
    is_owner = ctx.user.id and (str(interview.user_id) == str(ctx.user.id) or str(interview.recruiter_id) == str(ctx.user.id))

    if not (is_super or same_tenant or is_owner):
        raise HTTPException(403, "Forbidden")
    if ctx.role == Role.RECRUITER and not is_owner and not is_super:
        raise HTTPException(403, "Forbidden")

    await db.delete(cq)
    await db.commit()
    log.info(f"Coding question deleted: {question_id}")
    return {"message": "Coding question deleted", "id": str(question_id)}


@router.post("/api/functions/v1/execute-code")
async def execute_code_endpoint(
    body: CodeExecuteRequest,
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    invite_token: Optional[str] = Header(None, alias="x-invite-token"),
    db: AsyncSession = Depends(get_db),
):
    """Run code using Judge0 sandboxed executor."""
    if (not ctx or not ctx.user) and not invite_token: raise HTTPException(401, "Not authenticated")
    
    supported_langs = ["python", "c", "cpp", "java", "javascript"]
    if body.language.lower() not in supported_langs:
        raise HTTPException(400, f"Unsupported language: {body.language}")
        
    func_name = _extract_func_name(body.code, body.language)
    harness_code = _build_harness(body.code, body.language, func_name=func_name)

    log.info(f"[execute-code] lang={body.language}, func={func_name}, tests={len(body.test_cases or [])}")

    judge0 = get_judge0_client()
    
    # Prepare batch submissions
    batch_submissions = []
    for tc in body.test_cases or []:
        tc_input = str(tc.get("input", tc.get("Input", ""))).strip()
        
        # Safe lookup for expected output (handles 0/False correctly)
        expected_val = tc.get("expected_output")
        if expected_val is None: expected_val = tc.get("expectedOutput")
        if expected_val is None: expected_val = tc.get("output")
        if expected_val is None: expected_val = tc.get("Output")
        expected = str(expected_val if expected_val is not None else "").strip()
        
        batch_submissions.append({
            "source_code": harness_code,
            "language": body.language,
            "stdin": tc_input,
            "expected_output": expected,
        })

    # Execute all test cases in parallel via Judge0
    try:
        results = await judge0.run_batch(batch_submissions)
    except Exception as e:
        log.error(f"Judge0 execution failed: {e}")
        raise HTTPException(502, f"Code execution service unavailable: {e}")

    # Process results
    passed_count = 0
    formatted_results = []
    output_lines = []

    for i, (tc, result) in enumerate(zip(body.test_cases or [], results)):
        tc_input = str(tc.get("input", tc.get("Input", ""))).strip()
        expected_val = tc.get("expected_output") or tc.get("expectedOutput") or tc.get("output") or tc.get("Output") or ""
        expected = str(expected_val).strip()
        actual = result.get("stdout", "").strip()
        
        # Judge0 returns status_id=3 for Accepted
        passed = result.get("status_id") == 3
        
        if passed:
            passed_count += 1
        
        status = "passed" if passed else ("error" if result.get("is_error") else "failed")
        formatted_results.append({
            "id": i,
            "input": tc_input,
            "expectedOutput": expected,
            "actualOutput": actual,
            "status": status,
            "executionTime": int(result.get("time", 0) * 1000),
        })
        
        # Build human-readable output
        icon = "✓" if passed else "✗"
        output_lines.append(f"{icon} Test Case {i+1}: {status.upper()}")
        output_lines.append(f"  Input:    {tc_input}")
        output_lines.append(f"  Expected: {expected}")
        output_lines.append(f"  Output:   {actual}")
        output_lines.append("")

    summary = f"{passed_count}/{len(body.test_cases or [])} test cases passed"
    output_lines.insert(0, summary + "\n" + "─" * 40)
    
    response_payload = {
        "passedTests": passed_count,
        "totalTests": len(body.test_cases or []),
        "results": formatted_results,
        "output": "\n".join(output_lines),
    }
    log.info(f"[execute-code] Response: passedTests={passed_count}, totalTests={len(body.test_cases or [])}, result_count={len(formatted_results)}")
    return response_payload


@router.post("/api/functions/v1/submit-coding")
async def submit_coding_endpoint(
    body: CodeSubmitRequest,
    ctx: Optional[UserContext] = Depends(get_optional_user_context),
    invite_token: Optional[str] = Header(None, alias="x-invite-token"),
    db: AsyncSession = Depends(get_db),
):
    """Candidate final submission for coding round. Persists results to DB."""
    supported_langs = ["python", "c", "cpp", "java", "javascript"]
    if body.language.lower() not in supported_langs:
        raise HTTPException(400, f"Unsupported language: {body.language}")
        
    obj_uuid = uuid.UUID(str(body.interview_id))
    
    # Try resolving session
    sess_res = await db.execute(select(InterviewSession).where(InterviewSession.id == obj_uuid))
    session = sess_res.scalar_one_or_none()
    
    resolved_id = obj_uuid
    session_id = None
    if session:
        resolved_id = session.interview_id
        session_id = session.id

    res = await db.execute(select(Interview).where(Interview.id == resolved_id))
    interview = res.scalar_one_or_none()
    if not interview: raise HTTPException(404, "Interview not found")

    permission_granted = False
    if invite_token:
        if session:
            permission_granted = session.session_token == invite_token
        else:
            permission_granted = interview.invite_token == invite_token
    elif ctx and ctx.user:
        if str(interview.tenant_id) == str(ctx.tenant_id):
            permission_granted = True
            
    if not permission_granted:
        raise HTTPException(403, "Access denied")
        
    # Enforce access window check
    if invite_token:
        from utils import check_access_status, raise_access_blocked_exception
        access_status = check_access_status(session or interview, interview)
        if access_status in ("NOT_YET_AVAILABLE", "EXPIRED", "ALREADY_COMPLETED"):
            raise_access_blocked_exception(access_status, interview)

    cq_res = await db.execute(select(CodingQuestion).where(CodingQuestion.id == body.question_id))
    cq = cq_res.scalar_one_or_none()
    if not cq: raise HTTPException(404, "Coding question not found")

    func_name = _extract_func_name(body.code, body.language)
    harness_code = _build_harness(body.code, body.language, func_name=func_name)
    
    judge0 = get_judge0_client()
    
    test_cases = cq.test_cases or []
    batch_submissions = []

    for tc in test_cases:
        tc_input = str(tc.get("input", tc.get("Input", ""))).strip()
        
        # Safe lookup for expected output (handles 0/False correctly)
        expected_val = tc.get("expected_output")
        if expected_val is None: expected_val = tc.get("expectedOutput")
        if expected_val is None: expected_val = tc.get("output")
        if expected_val is None: expected_val = tc.get("Output")
        tc_expected = str(expected_val if expected_val is not None else "").strip()
        
        batch_submissions.append({
            "source_code": harness_code,
            "language": body.language,
            "stdin": tc_input,
            "expected_output": tc_expected,
        })

    # Execute all test cases in parallel via Judge0
    try:
        results = await judge0.run_batch(batch_submissions)
    except Exception as e:
        log.error(f"Judge0 submission failed: {e}")
        raise HTTPException(502, f"Code execution service unavailable: {e}")

    passed_count = 0
    test_results = []

    for i, (tc, result) in enumerate(zip(test_cases, results)):
        tc_input = str(tc.get("input", tc.get("Input", ""))).strip()
        expected_val = tc.get("expected_output") or tc.get("expectedOutput") or tc.get("output") or tc.get("Output") or ""
        tc_expected = str(expected_val).strip()
        actual = result.get("stdout", "").strip()
        
        # Judge0 returns status_id=3 for Accepted
        passed = result.get("status_id") == 3
        
        # LOGGING IS KEY
        status = "passed" if passed else ("error" if result.get("is_error") else "failed")
        log.info(f"[submit] TC#{i} for {body.language} (func={func_name}):")
        log.info(f"  Input:    {tc_input!r}")
        log.info(f"  Expected: {tc_expected!r}")
        log.info(f"  Actual:   {actual!r}")
        log.info(f"  Result:   {status}")
        
        if passed:
            passed_count += 1
        test_results.append({
            "id": i, "input": tc_input,
            "expectedOutput": tc_expected, "actualOutput": actual,
            "status": status,
        })

    score = round((passed_count / len(test_cases) * 100)) if test_cases else 0
    
    summary = f"{passed_count}/{len(test_cases)} test cases passed"
    
    # Save submission record with question_id
    sub = CodeSubmission(
        interview_id=resolved_id,
        session_id=session_id,
        tenant_id=interview.tenant_id,
        question_id=body.question_id,
        language=body.language,
        code=body.code,
        output=summary, # Save summary as output
        passed_tests=passed_count,
        total_tests=len(test_cases),
        status="completed"
    )
    db.add(sub)
    await db.flush() # Flush to get it into the session before aggregate calculation

    # Calculate aggregate coding score for the whole interview
    # We find the best submission for each assigned coding question
    log.info(f"Recalculating aggregate coding score for interview {resolved_id} (session={session_id})")
    
    # 1. Get all assigned coding questions
    questions_res = await db.execute(
        select(CodingQuestion).where(CodingQuestion.interview_id == interview.id)
    )
    all_qs = questions_res.scalars().all()
    
    # 2. Get latest/best submissions for these questions
    if session_id:
        subs_res = await db.execute(
            select(CodeSubmission).where(CodeSubmission.session_id == session_id)
        )
    else:
        subs_res = await db.execute(
            select(CodeSubmission).where(CodeSubmission.interview_id == interview.id)
        )
    all_subs = subs_res.scalars().all()
    
    # Map best score per question ID
    best_results = {} # {question_id_str: max_percent_score}
    for s in all_subs:
        if not s.question_id: continue
        qid = str(s.question_id)
        q_score = (s.passed_tests / s.total_tests * 100) if s.total_tests > 0 else 0
        if qid not in best_results or q_score > best_results[qid]:
            best_results[qid] = q_score
            
    # 3. Sum up best scores and divide by total number of questions
    total_possible_score = len(all_qs) * 100
    if total_possible_score > 0:
        sum_best_scores = sum(best_results.values())
        # We divide sum of scores by total number of questions (even if not answered)
        aggregate_score = round(sum_best_scores / len(all_qs))
    else:
        aggregate_score = 0

    log.info(f"Aggregate coding score: {aggregate_score}% (based on {len(all_qs)} questions)")
    if session:
        session.coding_score = aggregate_score
    else:
        interview.coding_score = aggregate_score
    
    await db.commit()
    
    log.info(f"Submission recorded: interview={body.interview_id}, score={score}% ({passed_count}/{len(test_cases)})")
    
    return {
        "passedTests": passed_count,
        "totalTests": len(test_cases),
        "score": score,
        "results": test_results,
        "status": "completed"
    }
