/**
 * src/lib/api.ts — Local backend API layer.
 *
 * All Supabase calls (supabase.from / supabase.functions.invoke / direct fetch)
 * are replaced with calls to the local FastAPI backend via the shim client
 * or direct REST calls to VITE_API_BASE_URL.
 *
 * The public function signatures are 100% preserved so no page/component changes.
 */
import { supabase, createClient, getStoredToken } from "@/integrations/backend/client";
import { getScalozLoginUrl } from "@/lib/utils";
import { encryptPayload, decryptPayload } from "@/lib/encryption";

export const BASE = import.meta.env.VITE_API_BASE_URL || "";

// ── Candidate client (token-based, no JWT) ─────────────────────────────────

function candidateClient(token: string) {
  return createClient(BASE, "local-dev-key", {
    global: { headers: { "x-invite-token": token } },
  });
}

// ── Shared fetch with current JWT token ────────────────────────────────────

export function getTenantIdentifier(): string | null {
  let tenant = localStorage.getItem("xeviewer_tenant");
  if (!tenant) {
    try {
      const userRaw = localStorage.getItem("xeviewer_user");
      if (userRaw) {
        const u = JSON.parse(userRaw);
        tenant = u.tenant_id || u.tenant || null;
      }
    } catch (_) {}
  }
  if (!tenant && typeof window !== "undefined" && window.location) {
    const parts = window.location.hostname.split(".");
    if (parts.length === 2 && parts[1] === "localhost" && !["www", "localhost"].includes(parts[0])) {
      tenant = parts[0];
    } else if (parts.length >= 3 && !["www", "aiinterview", "aiinterviewtest", "localhost", "127"].includes(parts[0]) && isNaN(Number(parts[0]))) {
      tenant = parts[0];
    }
    if (tenant) {
      try {
        localStorage.setItem("xeviewer_tenant", tenant);
      } catch (_) {}
    }
  }
  return tenant || null;
}

/**
 * Safely extracts a clean, human-readable error message and code from any API error structure.
 * Guaranteed to NEVER return '[object Object]'.
 */
export function formatApiError(
  err: any,
  fallbackMessage: string = "An unexpected error occurred"
): { message: string; code?: string; detail?: any } {
  if (!err) return { message: fallbackMessage };

  if (typeof err === "string") {
    if (err === "[object Object]" || !err.trim()) {
      return { message: fallbackMessage };
    }
    return { message: err.trim() };
  }

  const code = err.code || err.detail?.code;

  // 1. Structured detail object from FastAPI HTTPException(detail={code: ..., message: ...})
  if (typeof err.detail === "object" && err.detail !== null) {
    if (Array.isArray(err.detail)) {
      const msg = err.detail
        .map((e: any) => (typeof e === "string" ? e : e?.msg || e?.message || JSON.stringify(e)))
        .filter(Boolean)
        .join(", ");
      return { message: msg || fallbackMessage, code, detail: err.detail };
    }
    const message = err.detail.message || err.detail.msg || err.detail.error;
    if (typeof message === "string" && message !== "[object Object]" && message.trim()) {
      return { message: message.trim(), code: err.detail.code || code, detail: err.detail };
    }
  }

  // 2. String detail
  if (typeof err.detail === "string" && err.detail !== "[object Object]" && err.detail.trim()) {
    return { message: err.detail.trim(), code, detail: err };
  }

  // 3. String message
  if (typeof err.message === "string" && err.message !== "[object Object]" && err.message.trim()) {
    return { message: err.message.trim(), code, detail: err };
  }

  // 4. String error
  if (typeof err.error === "string" && err.error !== "[object Object]" && err.error.trim()) {
    return { message: err.error.trim(), code, detail: err };
  }

  return { message: fallbackMessage, code, detail: err };
}

export async function authFetch(path: string, options: RequestInit = {}) {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Attach tenant context for admin/dashboard routes
  const tenant = getTenantIdentifier();
  if (tenant) headers["X-Tenant-ID"] = tenant;

  if (options.body && typeof options.body === "string" && headers["Content-Type"] === "application/json") {
    try {
      const parsedBody = JSON.parse(options.body);
      const encryptedBody = await encryptPayload(parsedBody);
      options.body = JSON.stringify(encryptedBody);
    } catch (e) {
      console.warn("Skipping encryption for payload:", e);
    }
  }

  let fullUrl = `${BASE}${path}`;
  fullUrl = fullUrl.replace(/\/api\/api\//g, "/api/");

  const res = await fetch(fullUrl, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401) {
      // Only redirect to login for admin/recruiter pages, NOT candidate interview pages
      const isCandidatePage = window.location.pathname.startsWith("/take-interview") || window.location.pathname.startsWith("/i/");
      if (!isCandidatePage) {
        localStorage.removeItem("xeviewer_token");
        localStorage.removeItem("xeviewer_user");
        localStorage.removeItem("xeviewer_tenant");
        window.location.replace(getScalozLoginUrl());
      }
    }
    const errRaw = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    const err = await decryptPayload(errRaw).catch(() => errRaw);
    const parsed = formatApiError(err, res.statusText || "Request failed");
    const e = new Error(parsed.message);
    (e as any).code = parsed.code;
    (e as any).detail = parsed.detail;
    throw e;
  }
  const raw = await decryptJson(res);
  return decryptPayload(raw);
}

/** Convenience: parse and decrypt any Response object. */
async function decryptJson(res: Response) {
  const raw = await res.json();
  return decryptPayload(raw);
}

// ═══════════════════════════════════════════════════════════════════════════
// Recruiter: JD-based workflow
// ═══════════════════════════════════════════════════════════════════════════

export interface InterviewSetupMetadata {
  jobRoleId?: string | null;
  departmentId?: string | null;
  department?: string | null;
  skillTags?: string[];
  difficultyLevel?: string;
  questionCount?: number;
  codingCount?: number;
  interviewStage?: string;
  seniorityLevel?: string;
  experienceMin?: number;
  experienceMax?: number;
  interviewLanguage?: string;
  linkExpiryDays?: number;
  requireCamera?: boolean;
  detectTabSwitch?: boolean;
  blockCopyPaste?: boolean;
  maxRetakeAttempts?: number;
}

export async function getRolesMaster(): Promise<Array<{ id: string; name: string; department?: string }>> {
  try {
    const res = await authFetch("/api/rest/v1/roles-master");
    return Array.isArray(res) ? res : [];
  } catch (err) {
    console.warn("Failed to fetch roles master:", err);
    return [];
  }
}

export async function getDepartmentsMaster(): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await authFetch("/api/rest/v1/departments-master");
    return Array.isArray(res) ? res : [];
  } catch (err) {
    console.warn("Failed to fetch departments master:", err);
    return [];
  }
}

export async function createInterviewFromJD(
  jdText: string,
  saveVideoRecording: boolean = false,
  showCandidateVideo: boolean = true,
  durationMinutes: number = 30,
  candidateName?: string,
  candidateEmail?: string,
  jobRole?: string,
  experienceLevel: string = "junior_mid",
  proctoringEnabled: boolean = true,
  proctoringMaxStrikes: number = 3,
  proctoringScoreCutoff: number = 70,
  proctoringMaxStrikesAction: string = "flag_review",
  proctoringCutoffAction: string = "manual_review",
  evaluationScoreCutoff: number = 60,
  evaluationCutoffAction: string = "manual_review",
  availableFrom?: string,
  availableUntil?: string,
  interviewName?: string,
  interviewerName?: string,
  setupMetadata?: InterviewSetupMetadata
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const inviteToken = crypto.randomUUID();

  const insertPayload: any = {
    user_id: user.id,
    candidate_name: candidateName || "",
    candidate_email: candidateEmail || "",
    candidate_experience: experienceLevel,
    job_role: jobRole || "From JD",
    interview_name: interviewName || (jobRole ? `${jobRole} Interview` : "Technical Assessment"),
    interviewer_name: interviewerName || user.user_metadata?.full_name || user.email || null,
    status: "pending",
    current_round: "technical",
    invite_token: inviteToken,
    jd_file_path: jdText.substring(0, 500),
    save_video_recording: saveVideoRecording,
    show_candidate_video: showCandidateVideo,
    duration_minutes: durationMinutes,
    proctoring_enabled: proctoringEnabled,
    proctoring_max_strikes: proctoringMaxStrikes,
    proctoring_score_cutoff: proctoringScoreCutoff,
    proctoring_max_strikes_action: proctoringMaxStrikesAction,
    proctoring_cutoff_action: proctoringCutoffAction,
    evaluation_score_cutoff: evaluationScoreCutoff,
    evaluation_cutoff_action: evaluationCutoffAction,
    available_from: availableFrom || null,
    available_until: availableUntil || null,
    timezone: "Asia/Kolkata",
    grace_period_minutes: 0,
    job_role_id: setupMetadata?.jobRoleId || null,
    department_id: setupMetadata?.departmentId || null,
    department: setupMetadata?.department || null,
    skill_tags: setupMetadata?.skillTags || [],
    difficulty_level: setupMetadata?.difficultyLevel || "Medium",
    question_count: setupMetadata?.questionCount ?? 5,
    coding_count: setupMetadata?.codingCount ?? 2,
    interview_stage: setupMetadata?.interviewStage || "Screening",
    seniority_level: setupMetadata?.seniorityLevel || "Mid",
    experience_min: setupMetadata?.experienceMin ?? 2,
    experience_max: setupMetadata?.experienceMax ?? 5,
    interview_language: setupMetadata?.interviewLanguage || "English",
    link_expiry_days: setupMetadata?.linkExpiryDays ?? 7,
    require_camera: setupMetadata?.requireCamera ?? true,
    detect_tab_switch: setupMetadata?.detectTabSwitch ?? true,
    block_copy_paste: setupMetadata?.blockCopyPaste ?? true,
    max_retake_attempts: setupMetadata?.maxRetakeAttempts ?? 1,
  };

  const { data, error } = await supabase
    .from("interviews")
    .insert(insertPayload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateInterviewSettings(
  interviewId: string,
  updates: {
    interview_name?: string;
    interviewer_name?: string;
    save_video_recording?: boolean;
    show_candidate_video?: boolean;
    duration_minutes?: number;
    job_role?: string;
    job_role_id?: string | null;
    department_id?: string | null;
    department?: string | null;
    skill_tags?: string[];
    difficulty_level?: string;
    question_count?: number;
    coding_count?: number;
    interview_stage?: string;
    seniority_level?: string;
    experience_min?: number;
    experience_max?: number;
    interview_language?: string;
    link_expiry_days?: number;
    require_camera?: boolean;
    detect_tab_switch?: boolean;
    block_copy_paste?: boolean;
    max_retake_attempts?: number;
    jd_file_path?: string;
    candidate_experience?: string;
    proctoring_enabled?: boolean;
    proctoring_max_strikes?: number;
    proctoring_score_cutoff?: number;
    proctoring_max_strikes_action?: string;
    proctoring_cutoff_action?: string;
    evaluation_score_cutoff?: number;
    evaluation_cutoff_action?: string;
    evaluation_rubric?: any[];
    available_from?: string | null;
    available_until?: string | null;
  }
) {
  const { data, error } = await supabase
    .from("interviews")
    .update(updates as any)
    .eq("id", interviewId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function generateQuestions(interviewId: string, jdText: string, customInstructions?: string) {
  const payload: any = { interview_id: interviewId, jd_text: jdText };
  if (customInstructions?.trim()) {
    payload.custom_instructions = customInstructions.trim();
  }
  return authFetch("/functions/v1/generate-questions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateQuestionSelection(interviewId: string, questions: any[]) {
  // First try batch update endpoint for optimal performance and atomic operation
  try {
    const selections = questions.map((q) => ({ id: q.id, selected: !!q.selected }));
    await authFetch("/rest/v1/interview_questions_batch", {
      method: "PATCH",
      body: JSON.stringify({ selections }),
    });
    return;
  } catch (batchErr) {
    console.warn("Batch selection update failed, falling back to parallel PATCHes:", batchErr);
  }

  // Fallback: Fire all PATCH requests in parallel
  await Promise.all(
    questions.map((q) =>
      authFetch(`/rest/v1/interview_questions/${q.id}`, {
        method: "PATCH",
        body: JSON.stringify({ selected: q.selected }),
      })
    )
  );
}

export async function editQuestion(
  questionId: string,
  updates: { question_text?: string; question_type?: string; difficulty?: string }
) {
  return authFetch(`/rest/v1/interview_questions/${questionId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function addCustomQuestion(
  interviewId: string,
  questionText: string,
  questionType: string = "technical",
  difficulty: string = "medium"
) {
  return authFetch("/rest/v1/interview_questions", {
    method: "POST",
    body: JSON.stringify({
      interview_id: interviewId,
      question_text: questionText,
      question_type: questionType,
      difficulty,
      selected: true,
    }),
  });
}

export async function deleteQuestion(questionId: string) {
  return authFetch(`/rest/v1/interview_questions/${questionId}`, {
    method: "DELETE",
  });
}

export async function getInterviewQuestions(interviewId: string) {
  const { data, error } = await (supabase as any)
    .from("interview_questions")
    .select("*")
    .eq("interview_id", interviewId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return data;
}

export async function generateInterviewLink(interviewId: string) {
  if (!interviewId) throw new Error("interviewId is required to generate an interview link");
  const data = await authFetch(`/rest/v1/interviews/${interviewId}`);
  if (data?.short_code) {
    return `${window.location.origin}/i/${data.short_code}`;
  }
  if (!data?.invite_token) throw new Error("Interview has no invite token — cannot generate link");
  return `${window.location.origin}/take-interview?token=${data.invite_token}`;
}

export async function getInterviewByShortCode(shortCode: string) {
  const res = await fetch(`${BASE}/rest/v1/interviews/by-short-code/${shortCode}`);
  if (!res.ok) {
    const errRaw = await decryptJson(res).catch(() => ({ detail: "Not found" }));
    const err = await decryptPayload(errRaw).catch(() => errRaw);
    const parsed = formatApiError(err, "Interview not found");
    const e = new Error(parsed.message);
    (e as any).code = parsed.code;
    (e as any).detail = parsed.detail;
    throw e;
  }
  return decryptJson(res);
}


// ═══════════════════════════════════════════════════════════════════════════
// Candidate: question-based test (invite token, no JWT)
// ═══════════════════════════════════════════════════════════════════════════

export async function getCandidateQuestions(token: string) {
  const client = candidateClient(token);
  // Get interview first
  const { data: interview, error: intErr } = await (client as any)
    .from("interviews")
    .select("id")
    .eq("invite_token", token)
    .single();
  if (intErr) throw intErr;

  const { data, error } = await (client as any)
    .from("interview_questions")
    .select("*")
    .eq("interview_id", interview.id)
    .eq("selected", true)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getCandidateQuestionsByInterviewId(token: string, interviewId: string) {
  const client = candidateClient(token);
  const { data, error } = await (client as any)
    .from("interview_questions")
    .select("*")
    .eq("interview_id", interviewId)
    .eq("selected", true)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return data;
}

export async function submitCandidateAnswer(token: string, questionId: string, answer: string) {
  const res = await fetch(`${BASE}/rest/v1/interview_questions/${questionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-invite-token": token,
    },
    body: JSON.stringify({ candidate_answer: answer }),
  });
  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? err.error ?? "Failed to submit answer");
  }
}

export async function saveCandidateDetails(
  token: string,
  name: string,
  email: string,
  experience: string,
) {
  // Get interview id from token
  const r = await fetch(`${BASE}/rest/v1/interviews/by-token/${token}`);
  if (!r.ok) throw new Error("Interview not found");
  const interview = await r.json();

  const res = await fetch(`${BASE}/rest/v1/interviews/by-token/${token}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-invite-token": token,
    },
    body: JSON.stringify({
      candidate_name: name,
      candidate_email: email,
      candidate_experience: experience,
    }),
  });
  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? err.error ?? "Failed to save details");
  }
}

export async function uploadIdImage(token: string, blob: Blob) {
  const formData = new FormData();
  formData.append("file", blob, "id_image.jpg");

  const res = await fetch(`${BASE}/rest/v1/interviews/by-token/${token}/upload-id`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail ?? "Failed to upload ID image");
  }
  return decryptJson(res) as Promise<{ success: boolean; candidate_id_url: string }>;
}

export async function getUploadPresignedUrl(token: string, filename: string) {
  const res = await fetch(`${BASE}/rest/v1/interviews/by-token/${token}/upload-url?filename=${filename}`);
  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Failed to get upload URL");
  }
  return decryptJson(res) as Promise<{ url: string; key: string }>;
}

export async function initiateMultipartUpload(token: string) {
  const res = await fetch(`${BASE}/rest/v1/interviews/by-token/${token}/initiate-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-invite-token": token,
    },
  });
  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Failed to initiate upload");
  }
  return decryptJson(res) as Promise<{ upload_id: string; s3_key: string; bucket: string }>;
}

export async function getPartPresignedUrl(token: string, partNumber: number) {
  const res = await fetch(
    `${BASE}/rest/v1/interviews/by-token/${token}/upload-url?part_number=${partNumber}`,
    {
      headers: { "x-invite-token": token },
    }
  );
  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Failed to get part upload URL");
  }
  return decryptJson(res) as Promise<{ url: string; upload_id: string; part_number: number; s3_key: string }>;
}

export async function completeMultipartUpload(
  token: string,
  parts: Array<{ PartNumber: number; ETag: string }>,
  uploadId?: string
) {
  const res = await fetch(`${BASE}/rest/v1/interviews/by-token/${token}/complete-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-invite-token": token,
    },
    body: JSON.stringify({
      parts,
      ...(uploadId && { upload_id: uploadId }),
    }),
  });
  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Failed to complete upload");
  }
  return decryptJson(res);
}

export async function submitInterviewForScoring(interviewId: string, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-invite-token"] = token;
  else {
    const jwt = getStoredToken();
    if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  }

  const res = await fetch(`${BASE}/functions/v1/score-answers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ interview_id: interviewId })
  });

  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Failed to trigger scoring");
  }
  return decryptJson(res);
}

// ═══════════════════════════════════════════════════════════════════════════
// AI Interview (legacy / shared)
// ═══════════════════════════════════════════════════════════════════════════

export async function sendInterviewMessage(
  interviewId: string,
  message: string | null,
  round: string,
  jobRole: string,
  inviteToken?: string,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s hard timeout

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (inviteToken) headers["x-invite-token"] = inviteToken;

    const res = await fetch(`${BASE}/functions/v1/ai-interview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ interview_id: interviewId, message, round, job_role: jobRole }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Failed to send message");
    }
    return await decryptJson(res);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchInterviewClosing(
  interviewId: string,
  candidateName?: string,
  jobRole?: string,
  inviteToken?: string,
): Promise<{ closing_text: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (inviteToken) headers["x-invite-token"] = inviteToken;

    const res = await fetch(`${BASE}/functions/v1/interview-closing`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        interview_id: interviewId,
        candidate_name: candidateName || "there",
        job_role: jobRole || "Software Engineer",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Closing endpoint error: ${res.statusText}`);
    }
    return await decryptJson(res);
  } catch (err) {
    console.warn("[API] fetchInterviewClosing failed or timed out. Falling back to default closing message:", err);
    const cDisp = candidateName && candidateName.trim().toLowerCase() !== "there" ? `, ${candidateName.trim()}` : "";
    return {
      closing_text: `Thank you${cDisp}. Our time for the interview has concluded. We appreciate you sharing your experience today, and our recruitment team will be in touch regarding next steps.`
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function transcribeAudio(blob: Blob, originalText: string = "", inviteToken?: string, prompt: string = "") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s max cap

  try {
    const formData = new FormData();
    formData.append("audio", blob, "audio.webm");
    formData.append("original_text", originalText);
    formData.append("prompt", prompt);

    const headers: Record<string, string> = {};
    if (inviteToken) headers["x-invite-token"] = inviteToken;

    const res = await fetch(`${BASE}/functions/v1/transcribe`, {
      method: "POST",
      headers,
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      return { text: originalText };
    }
    return await decryptJson(res); // { text: "..." }
  } catch (err) {
    console.warn("[transcribeAudio] Request aborted or error, falling back to local transcript:", err);
    return { text: originalText };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function synthesizeSpeechAudio(text: string, voice?: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  let fullUrl = `${BASE}/functions/v1/tts`;
  fullUrl = fullUrl.replace(/\/api\/api\//g, "/api/");
  const res = await fetch(fullUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`TTS failed with status ${res.status}`);
  }
  return await res.arrayBuffer();
}

export async function startInterview(interviewId: string, round: string, jobRole: string) {
  return authFetch("/functions/v1/ai-interview", {
    method: "POST",
    body: JSON.stringify({ interview_id: interviewId, message: null, round, job_role: jobRole }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Code execution
// ═══════════════════════════════════════════════════════════════════════════

export async function executeCode(
  interviewId: string,
  code: string,
  language: string,
  testCases?: any[],
  inviteToken?: string,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (inviteToken) {
    headers["x-invite-token"] = inviteToken;
  } else {
    const token = getStoredToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  // Encrypt request body to match the middleware expectation
  let requestBody: any = { interview_id: interviewId, code, language, test_cases: testCases };
  try {
    requestBody = await encryptPayload(requestBody);
  } catch (e) {
    console.warn("[executeCode] Skipping request encryption:", e);
  }

  const response = await fetch(`${BASE}/functions/v1/execute-code`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errRaw = await response.json().catch(() => ({ error: "Code execution failed" }));
    const err = await decryptPayload(errRaw).catch(() => errRaw);
    throw new Error(err.error ?? err.detail ?? "Code execution failed");
  }
  // Decrypt the response — backend uses EncryptedJSONResponse by default
  const raw = await response.json();
  return decryptPayload(raw);
}

// ═══════════════════════════════════════════════════════════════════════════
// Evaluation
// ═══════════════════════════════════════════════════════════════════════════

export async function evaluateInterview(interviewId: string, token?: string) {
  const client = token ? candidateClient(token) : supabase;
  const { data, error } = await client.functions.invoke("evaluate-interview", {
    body: { interview_id: interviewId },
  });
  if (error) throw error;
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// Interview CRUD
// ═══════════════════════════════════════════════════════════════════════════

export async function createInterview(
  jobRole: string,
  candidateName?: string,
  candidateEmail?: string,
  saveVideoRecording: boolean = false,
  showCandidateVideo: boolean = true,
  durationMinutes: number = 30,
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const inviteToken = crypto.randomUUID();

  const { data, error } = await supabase
    .from("interviews")
    .insert({
      user_id: user.id,
      candidate_name: candidateName || "",
      candidate_email: candidateEmail || "",
      job_role: jobRole,
      status: "pending",
      current_round: "technical",
      invite_token: inviteToken,
      save_video_recording: saveVideoRecording,
      show_candidate_video: showCandidateVideo,
      duration_minutes: durationMinutes,
    } as any)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getInterviewByToken(token: string) {
  const res = await fetch(`${BASE}/rest/v1/interviews/by-token/${token}`);
  if (!res.ok) {
    const errRaw = await decryptJson(res).catch(() => ({ detail: "Not found" }));
    const err = await decryptPayload(errRaw).catch(() => errRaw);
    const parsed = formatApiError(err, "Interview not found");
    const e = new Error(parsed.message);
    (e as any).code = parsed.code;
    (e as any).detail = parsed.detail;
    throw e;
  }
  return decryptJson(res);
}

export async function updateInterviewStatus(
  id: string,
  status: string,
  inviteToken?: string,
  extraFields?: Record<string, any>,
) {
  if (inviteToken) {
    const res = await fetch(`${BASE}/rest/v1/interviews/by-token/${inviteToken}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-invite-token": inviteToken,
      },
      body: JSON.stringify({ status, ...extraFields }),
    });
    if (!res.ok) {
      const err = await decryptJson(res).catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Update failed");
    }
    return decryptJson(res);
  }

  const { data, error } = await supabase
    .from("interviews")
    .update({ status, ...extraFields } as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getInterviews() {
  const { data, error } = await supabase
    .from("interviews")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function deleteInterview(id: string) {
  return authFetch(`/rest/v1/interviews/${id}`, {
    method: "DELETE",
  });
}

export async function updateInterview(id: string, updates: any) {
  const { data, error } = await supabase
    .from("interviews")
    .update(updates as any)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getInterview(id: string) {
  const { data, error } = await supabase
    .from("interviews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getInterviewMessages(interviewId: string) {
  const { data, error } = await supabase
    .from("interview_messages")
    .select("*")
    .eq("interview_id", interviewId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function extractText(file: File, signal?: AbortSignal) {
  // Fast path for plain text files: instant read in browser (<1ms), zero network overhead
  if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
    try {
      const text = await file.text();
      if (text && text.trim().length > 0) {
        return text;
      }
    } catch (_) {
      // Fallback to server endpoint if client-side reading fails
    }
  }

  const token = getStoredToken();
  const tenant = getTenantIdentifier();
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {
    "X-Bypass-Tenant": "true",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (tenant) headers["X-Tenant-ID"] = tenant;

  // 15-second safety timeout controller to guarantee the UI never spins indefinitely
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 15000);

  // Link caller signal if provided
  if (signal) {
    signal.addEventListener("abort", () => timeoutController.abort());
  }

  try {
    const res = await fetch(`${BASE}/functions/v1/extract-text`, {
      method: "POST",
      headers,
      body: formData,
      signal: timeoutController.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem("xeviewer_token");
        localStorage.removeItem("xeviewer_user");
        localStorage.removeItem("xeviewer_tenant");
        window.location.replace(getScalozLoginUrl());
      }
      const err = await decryptJson(res).catch(() => ({ detail: "Extraction failed" }));
      throw new Error(err.detail ?? "Failed to extract text from file");
    }
    const data = await decryptJson(res);
    return data.text;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError" || timeoutController.signal.aborted) {
      throw new Error("Text extraction timed out (15s). Please check your connection, upload a smaller file, or paste the text directly.");
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Coding Questions
// ═══════════════════════════════════════════════════════════════════════════

export async function parseCodingQuestions(file: File, signal?: AbortSignal) {
  const token = getStoredToken();
  const tenant = getTenantIdentifier();
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {
    "X-Bypass-Tenant": "true",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (tenant) headers["X-Tenant-ID"] = tenant;

  // 60-second safety timeout controller for LLM question parsing
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 60000);

  if (signal) {
    signal.addEventListener("abort", () => timeoutController.abort());
  }

  try {
    const res = await fetch(`${BASE}/functions/v1/parse-coding-questions`, {
      method: "POST",
      headers,
      body: formData,
      signal: timeoutController.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem("xeviewer_token");
        localStorage.removeItem("xeviewer_user");
        localStorage.removeItem("xeviewer_tenant");
        window.location.replace(getScalozLoginUrl());
      }
      const err = await decryptJson(res).catch(() => ({ detail: "Parsing failed" }));
      throw new Error(err.detail ?? "Failed to parse coding questions");
    }
    return decryptJson(res);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError" || timeoutController.signal.aborted) {
      throw new Error("Coding question extraction timed out. Please try a smaller file or add coding challenges manually.");
    }
    throw err;
  }
}

export async function generateCodingQuestions(params: {
  sourceText: string;
  difficulty?: "easy" | "medium" | "hard" | "mixed";
  count?: number;
  customInstructions?: string;
  challengeTypes?: string[];
  isRawProblem?: boolean;
}) {
  return authFetch("/functions/v1/generate-coding-questions", {
    method: "POST",
    body: JSON.stringify({
      source_text: params.sourceText,
      difficulty: params.difficulty || "medium",
      count: params.count || 2,
      custom_instructions: params.customInstructions?.trim() || undefined,
      challenge_types: params.challengeTypes && params.challengeTypes.length > 0 ? params.challengeTypes : undefined,
      is_raw_problem: !!params.isRawProblem,
    }),
  });
}

export async function recommendCodingChallengeTypes(params: {
  content: string;
  jobRole?: string;
  skills?: string[];
  seniority?: string;
  minExp?: number | string;
  maxExp?: number | string;
  customInstructions?: string;
}): Promise<{
  types: string[];
  needs_clarification: boolean;
  message: string;
}> {
  return authFetch("/functions/v1/recommend-coding-challenge-types", {
    method: "POST",
    body: JSON.stringify({
      content: params.content,
      job_role: params.jobRole,
      skills: params.skills,
      seniority: params.seniority,
      min_exp: params.minExp,
      max_exp: params.maxExp,
      custom_instructions: params.customInstructions,
    }),
  });
}


export async function createCodingQuestions(
  interviewId: string,
  questions: any[],
  replace: boolean = true
) {
  return authFetch("/rest/v1/coding_questions", {
    method: "POST",
    body: JSON.stringify({ interview_id: interviewId, questions, replace }),
  });
}

export async function editCodingQuestion(
  questionId: string,
  updates: {
    title?: string;
    description?: string;
    difficulty?: string;
    test_cases?: any[];
    examples?: any[];
    starter_code?: any;
    constraints?: any[];
    hints?: any[];
  }
) {
  return authFetch(`/rest/v1/coding_questions/${questionId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteCodingQuestion(questionId: string) {
  return authFetch(`/rest/v1/coding_questions/${questionId}`, {
    method: "DELETE",
  });
}

export async function addCodingQuestion(
  interviewId: string,
  question: {
    title: string;
    description: string;
    difficulty?: string;
    test_cases?: any[];
    examples?: any[];
    starter_code?: any;
    constraints?: any[];
    hints?: any[];
  }
) {
  return authFetch("/rest/v1/coding_questions", {
    method: "POST",
    body: JSON.stringify({
      interview_id: interviewId,
      ...question,
    }),
  });
}

export async function getCodingQuestions(interviewId: string, inviteToken?: string) {
  const headers: Record<string, string> = {};
  if (inviteToken) {
    headers["x-invite-token"] = inviteToken;
  } else {
    const token = getStoredToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}/rest/v1/coding_questions?interview_id=${interviewId}`, {
    headers,
  });

  if (!res.ok) {
    const err = await decryptJson(res).catch(() => ({ detail: "Failed to fetch" }));
    throw new Error(err.detail ?? "Failed to fetch coding questions");
  }
  return decryptJson(res);
}

export async function getCodeSubmissions(interviewId: string) {
  const { data, error } = await supabase
    .from("code_submissions")
    .select("*")
    .eq("interview_id", interviewId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}


export async function submitCodingRound(
  interviewId: string,
  questionId: string,
  code: string,
  language: string,
  inviteToken?: string,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (inviteToken) {
    headers["x-invite-token"] = inviteToken;
  } else {
    const token = getStoredToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  // Encrypt request body to match the middleware expectation
  let requestBody: any = { interview_id: interviewId, question_id: questionId, code, language };
  try {
    requestBody = await encryptPayload(requestBody);
  } catch (e) {
    console.warn("[submitCodingRound] Skipping request encryption:", e);
  }

  const res = await fetch(`${BASE}/functions/v1/submit-coding`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errRaw = await res.json().catch(() => ({ detail: "Submission failed" }));
    const err = await decryptPayload(errRaw).catch(() => errRaw);
    throw new Error(err.detail ?? "Failed to submit coding solution");
  }
  // Decrypt the response — backend uses EncryptedJSONResponse by default
  const raw = await res.json();
  return decryptPayload(raw);
}


// ---------------------------------------------------------------------------
// Admin / Tenant Management
// ---------------------------------------------------------------------------

export async function adminCreateTenant(name: string, adminEmail?: string) {
  return authFetch('/admin/v1/tenants', {
    method: 'POST',
    body: JSON.stringify({ name, admin_email: adminEmail }),
  });
}

export async function adminListTenants() {
  return authFetch('/admin/v1/tenants');
}

export async function adminListMembers(tenantId?: string) {
  const url = tenantId ? `/admin/v1/memberships?tenant_id=${tenantId}` : '/admin/v1/memberships';
  return authFetch(url);
}

export async function adminAddMember(email: string, role: string, tenantId: string, managerId?: string, fullName?: string) {
  return authFetch('/admin/v1/memberships', {
    method: 'POST',
    body: JSON.stringify({ email, role, tenant_id: tenantId, manager_id: managerId, full_name: fullName }),
  });
}

export async function adminRemoveMember(membershipId: string) {
  return authFetch(`/admin/v1/memberships/${membershipId}`, {
    method: 'DELETE',
  });
}

export async function adminUpdateMemberRole(membershipId: string, overrideRole: string | null, managerId?: string | null) {
  return authFetch(`/admin/v1/memberships/${membershipId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ override_role: overrideRole, manager_id: managerId }),
  });
}



export async function forgotPassword(email: string) {
  return authFetch('/auth/v1/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string) {
  return authFetch('/auth/v1/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

// ---------------------------------------------------------------------------
// Admin Dashboard (Hierarchical)
// ---------------------------------------------------------------------------

export async function getAdminDashboardStats() {
  return authFetch('/admin/dashboard/stats');
}

export async function getAdminManagers() {
  return authFetch('/admin/dashboard/managers');
}

export async function getAdminManagerRecruiters(managerId: string) {
  return authFetch(`/admin/dashboard/managers/${managerId}/recruiters`);
}

export async function getAdminRecruiterCandidates(recruiterId: string, page: number = 1, limit: number = 10, directOnly?: boolean) {
  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (directOnly !== undefined) {
    queryParams.append("direct_only", String(directOnly));
  }
  return authFetch(`/admin/dashboard/recruiters/${recruiterId}/candidates?${queryParams.toString()}`);
}

export async function getAdminCandidateResult(candidateId: string) {
  return authFetch(`/admin/dashboard/results/${candidateId}`);
}

export async function getAdminTrends(days: number = 30) {
  return authFetch(`/admin/dashboard/trends?days=${days}`);
}

export async function getAdminLeaderboard() {
  return authFetch(`/admin/dashboard/leaderboard`);
}


export async function getAdminPipeline() {
  return authFetch(`/admin/dashboard/pipeline`);
}


export async function getAdminOperationalTable(filters: any = {}) {
  const queryParams = new URLSearchParams();
  if (filters.manager_id) queryParams.append("manager_id", filters.manager_id);
  if (filters.recruiter_id) queryParams.append("recruiter_id", filters.recruiter_id);
  if (filters.status) queryParams.append("status", filters.status);
  if (filters.start_date) queryParams.append("start_date", filters.start_date);
  if (filters.end_date) queryParams.append("end_date", filters.end_date);
  
  return authFetch(`/admin/dashboard/operational-table?${queryParams.toString()}`);
}

// Tenant Settings
export async function getTenantSettings(tenantId: string) {
  return authFetch(`/admin/v1/tenants/${tenantId}/settings`);
}

export async function updateTenantSettings(tenantId: string, settings: any) {
  return authFetch(`/admin/v1/tenants/${tenantId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
}

// Super Admin Platform APIs
export async function getSuperAdminStats() {
  return authFetch(`/super-admin/dashboard/stats`);
}

export async function getSuperAdminTenants() {
  return authFetch(`/super-admin/tenants`);
}

export async function createSuperAdminTenant(data: any) {
  return authFetch(`/super-admin/tenant/create`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getSuperAdminTenantDetails(tenantId: string) {
  return authFetch(`/super-admin/tenant/${tenantId}`);
}

export async function updateSuperAdminTenant(tenantId: string, data: any) {
  return authFetch(`/super-admin/tenant/${tenantId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteSuperAdminTenant(tenantId: string) {
  return authFetch(`/super-admin/tenant/${tenantId}`, {
    method: 'DELETE'
  });
}
// ---------------------------------------------------------------------------
// Recruiter Specific APIs
// ---------------------------------------------------------------------------

export async function getRecruiterStats() {
  return authFetch('/recruiter/dashboard/stats');
}

export async function getRecruiterInterviews(filters: any = {}) {
  // Use getAdminOperationalTable so recruiter views get the unified candidate sessions and accurate session statuses
  return getAdminOperationalTable(filters);
}

export async function getRecruiterInterviewResult(interviewId: string) {
  return authFetch(`/recruiter/interview/${interviewId}/result`);
}

export async function getRecruiterInterviewRecording(interviewId: string, download: boolean = false) {
  return authFetch(`/recruiter/interview/${interviewId}/recording${download ? '?download=true' : ''}`);
}

export async function getRecruiterInterviewReport(interviewId: string) {
  return authFetch(`/recruiter/interview/${interviewId}/report`);
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  invite_expires_at?: string; // ISO datetime string
  cc?: string[];
  bcc?: string[];
}

export async function sendInterviewEmail(interviewId: string, payload: EmailPayload) {
  return authFetch(`/rest/v1/interviews/${interviewId}/send-email`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function addInterviewCandidate(interviewId: string, email: string, name?: string) {
  return authFetch(`/rest/v1/interviews/${interviewId}/candidates`, {
    method: "POST",
    body: JSON.stringify({ email, name }),
  });
}

export async function deleteInterviewCandidate(interviewId: string, email: string) {
  return authFetch(`/rest/v1/interviews/${interviewId}/candidates/${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
}

export async function getInterviewCandidates(interviewId: string) {
  return authFetch(`/rest/v1/interviews/${interviewId}/candidates`);
}

export async function resendInterviewCandidate(interviewId: string, email: string, subject: string, body: string) {
  return authFetch(`/rest/v1/interviews/${interviewId}/candidates/resend`, {
    method: "POST",
    body: JSON.stringify({ email, subject, body }),
  });
}

export async function revokeInterviewCandidate(interviewId: string, email: string, isRevoked: boolean) {
  return authFetch(`/rest/v1/interviews/${interviewId}/candidates/revoke`, {
    method: "POST",
    body: JSON.stringify({ email, is_revoked: isRevoked }),
  });
}

export async function verifyCandidateEmail(token: string, email: string) {
  const res = await fetch(`${BASE}/rest/v1/interviews/by-token/${token}/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const errRaw = await decryptJson(res).catch(() => ({ detail: res.statusText }));
    const err = await decryptPayload(errRaw).catch(() => errRaw);
    const parsed = formatApiError(err, "Failed to verify email");
    const e = new Error(parsed.message);
    (e as any).code = parsed.code;
    (e as any).detail = parsed.detail;
    throw e;
  }
  return decryptJson(res) as Promise<{ success: boolean; session_token: string; status: string }>;
}

export async function getCustomizationSuggestions(content: string, jobRole?: string): Promise<string[]> {
  try {
    const res = await authFetch(`${BASE}/api/functions/v1/generate-customization-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, job_role: jobRole }),
    });
    if (!res.ok) return [];
    const data = await decryptJson(res);
    return Array.isArray(data?.suggestions) ? data.suggestions : [];
  } catch (err) {
    console.error("Failed to generate suggestions:", err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Reports & History Module
// ═══════════════════════════════════════════════════════════════════════════

export interface ReportsFilterParams {
  search?: string;
  status?: string;
  job_role?: string;
  skill?: string;
  interviewer?: string;
  score_range?: string;
  year?: string | number;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface ReportItem {
  id: string;
  session_id?: string;
  short_code?: string;
  invite_token?: string;
  interview_name: string;
  job_role: string;
  candidate_name: string;
  candidate_email?: string;
  interviewer_name: string;
  status: string;
  overall_score: number | null;
  score_tier: string;
  date: string;
  duration_minutes?: number;
  is_multi_candidate?: boolean;
  skill_tags?: string[];
}

export interface ReportsHistoryResponse {
  items: ReportItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  facets: {
    job_roles: string[];
    interviewers: string[];
    years: number[];
    statuses: Record<string, number>;
    skills?: string[];
  };
  summary: {
    total_interviews: number;
    completed_interviews: number;
    avg_score: number;
    top_role: string;
  };
}

export async function getReportsHistory(params: ReportsFilterParams = {}): Promise<ReportsHistoryResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      query.set(k, String(v));
    }
  });
  return authFetch(`/api/reports/history?${query.toString()}`);
}

export async function exportReportsCsv(params: ReportsFilterParams = {}): Promise<Blob> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const tenant = getTenantIdentifier();
  if (tenant) headers["X-Tenant-ID"] = tenant;

  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      query.set(k, String(v));
    }
  });

  let fullUrl = `${BASE}/api/reports/export?${query.toString()}`;
  fullUrl = fullUrl.replace(/\/api\/api\//g, "/api/");
  const res = await fetch(fullUrl, { headers });
  if (!res.ok) {
    throw new Error("Failed to export reports CSV");
  }
  return res.blob();
}

