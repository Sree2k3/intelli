import { useState, useEffect, useRef } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, ArrowRight, Loader2, CheckCircle2, AlertCircle,
  Code2, Lightbulb, MessageSquare, Clock, Play,
  Volume2, VolumeX, Mic, MicOff, Keyboard, AudioLines,
  Pencil, RotateCcw, Video, Wifi, ShieldCheck, Check, X, Mail, Maximize,
} from "lucide-react";

export const requestAppFullscreen = () => {
  try {
    const doc = document as any;
    const isAlreadyFs = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.msFullscreenElement ||
      doc.mozFullScreenElement
    );
    if (isAlreadyFs) return;

    const elem = document.documentElement as any;
    const requestMethod =
      elem.requestFullscreen ||
      elem.webkitRequestFullscreen ||
      elem.msRequestFullscreen ||
      elem.mozRequestFullScreen;

    if (requestMethod) {
      const promise = requestMethod.call(elem);
      if (promise && typeof promise.catch === "function") {
        promise.catch((err: any) => {
          console.warn("[Fullscreen] Request rejected (usually requires direct user gesture):", err?.message || err);
        });
      }
    }
  } catch (err: any) {
    console.warn("[Fullscreen] Failed to request fullscreen:", err);
  }
};
import { useToast } from "@/hooks/use-toast";
import {
  getInterviewByToken, getInterviewByShortCode, getCandidateQuestions, submitCandidateAnswer,
  updateInterviewStatus, executeCode, saveCandidateDetails, submitInterviewForScoring,
  uploadIdImage, getCandidateQuestionsByInterviewId, transcribeAudio, verifyCandidateEmail,
} from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import VoiceInterviewAgent from "@/components/interview/VoiceInterviewAgent";
import CodingRound from "@/components/interview/CodingRound";
import IdentityVerification from "@/components/interview/IdentityVerification";
import CameraMonitor, { CameraMonitorHandle } from "@/components/interview/CameraMonitor";
import { interviewAudioBus } from "@/lib/interviewAudioBus";
import ErrorBoundary from "@/components/ErrorBoundary";

const typeIcons: Record<string, any> = {
  technical: Lightbulb,
  behavioral: MessageSquare,
};

const typeLabels: Record<string, string> = {
  technical: "Technical",
  behavioral: "Behavioral",
};

const TYPE_SORT_ORDER: Record<string, number> = {
  technical: 1,
  behavioral: 2,
};

interface Question {
  id: string;
  question_text: string;
  question_type: string;
  difficulty: string;
  candidate_answer: string | null;
  order_index: number;
}

// ─── Phase helpers ──────────────────────────────────────────────────────────
type Phase = 1 | 2 | 3;

const phaseConfig: Record<number, { label: string; icon: any; color: string; bgColor: string; description: string; questionType: string }> = {
  1: {
    label: "Technical Round",
    icon: Keyboard,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    description: "AI-powered voice interview covering technical concepts",
    questionType: "technical",
  },
  2: {
    label: "Behavioral Round",
    icon: AudioLines,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    description: "AI-powered voice interview on situational scenarios",
    questionType: "behavioral",
  },
  3: {
    label: "Coding Round",
    icon: Code2,
    color: "text-primary",
    bgColor: "bg-primary/10",
    description: "Solve a coding challenge with a live code editor",
    questionType: "coding",
  },
};

/**
 * Divide questions into 2 phases based on index.
 * Questions are pre-sorted: Technical → Behavioral
 * Phase 1 (Technical) = text-to-text
 * Phase 2 (Behavioral)= TTS + STT voice
 */
function getPhaseForIndex(idx: number, total: number, questions?: Question[]): Phase {
  if (total <= 0) return 1;

  // If we have actual questions, determine phase by question type
  if (questions && questions[idx]) {
    const q = questions[idx];
    if (q.question_type === "technical") return 1;
    if (q.question_type === "behavioral") return 2;
    if (q.question_type === "coding") return 3;
    // Fallback to type mapping if needed
  }

  // Simple split if types aren't available
  const p1End = Math.ceil(total / 2);
  if (idx < p1End) return 1;
  return 2;
}

export default function CandidateInterview() {
  const { shortCode } = useParams();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get("token");
  const [token, setToken] = useState<string | null>(() => {
    if (shortCode) {
      const savedShortCode = localStorage.getItem("interview_short_code");
      if (savedShortCode === shortCode) {
        const t = urlToken || localStorage.getItem("interview_token") || null;
        if (t && t !== "null" && t !== "undefined") return t;
      }
      return urlToken || null;
    }
    const t = urlToken || localStorage.getItem("interview_token") || null;
    if (t === "null" || t === "undefined") {
      localStorage.removeItem("interview_token");
      return null;
    }
    return t;
  });
  const { toast } = useToast();

  const [interview, setInterview] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isInvalid, setIsInvalid] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number } | null>(null);
  const [isVerifyingAccess, setIsVerifyingAccess] = useState(false);

  // Email verification gate for multi-candidate links
  const [showEmailGate, setShowEmailGate] = useState(false);
  const [emailGateInput, setEmailGateInput] = useState("");
  const [emailGateError, setEmailGateError] = useState<string | null>(null);
  const [emailGateLoading, setEmailGateLoading] = useState(false);
  const [multiCandidateToken, setMultiCandidateToken] = useState<string | null>(null);
  const [completedCandidate, setCompletedCandidate] = useState<{
    email: string;
    name?: string;
    jobRole?: string;
    completedAt?: string;
  } | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingNext, setSubmittingNext] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [terminationReason, setTerminationReason] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showSystemCheck, setShowSystemCheck] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [showIdentityVerification, setShowIdentityVerification] = useState(false);

  // Phase transition splash
  const [showPhaseSplash, setShowPhaseSplash] = useState(false);
  const [splashPhase, setSplashPhase] = useState<Phase>(1);
  const prevPhaseRef = useRef<Phase>(1);

  // Candidate details
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidateExperience, setCandidateExperience] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);

  // Code editor state for coding questions
  const [codeContent, setCodeContent] = useState("");
  const [codeLanguage, setCodeLanguage] = useState("python");
  const [codeOutput, setCodeOutput] = useState("");
  const [runningCode, setRunningCode] = useState(false);

  // Audio/Speech states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Phase 3 voice UI states
  const [showTranscriptEditor, setShowTranscriptEditor] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Agentic Voice Flow
  const [useVoiceAgent, setUseVoiceAgent] = useState(false);
  // Coding Round
  const [showCodingRound, setShowCodingRound] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [complianceAccepted, setComplianceAccepted] = useState(false);

  // Ref to the active CameraMonitor so we can imperatively stop+finalize it
  const cameraRef = useRef<CameraMonitorHandle | null>(null);
  
  // Ref to track if termination is already in progress
  const isTerminatingRef = useRef(false);

  const isInterviewActive = !showDetails && !showGuidelines && !showIdentityVerification && !showStart && !showSystemCheck && !submitted && !isUploading && interview?.id;

  const resolveShortCodeAndLoad = async () => {
    try {
      setLoading(true);
      const data = await getInterviewByShortCode(shortCode!);
      if (!data) throw new Error("Invalid interview link or data structure.");

      // Multi-candidate: show email verification gate first
      if (data.is_multi_candidate) {
        // Store the shared template token so we can call verify-email with it
        setMultiCandidateToken(data.invite_token || null);
        setShowEmailGate(true);
        setLoading(false);
        return;
      }

      if (data.invite_token) {
        setToken(data.invite_token);
        localStorage.setItem("interview_token", data.invite_token);
        if (shortCode) {
          localStorage.setItem("interview_short_code", shortCode);
        }
      } else {
        throw new Error("Invalid interview link or data structure.");
      }
    } catch (err: any) {
      console.error("Failed to resolve short code:", err);
      const code = err?.code || err?.detail?.code || "";
      const rawMsg = err?.message || (typeof err === "string" ? err : "");
      const cleanMsg = typeof rawMsg === "string" && rawMsg !== "[object Object]" ? rawMsg.trim() : "";
      const lower = (cleanMsg + " " + code).toLowerCase();

      if (code === "ALREADY_COMPLETED" || lower.includes("completed")) {
        setSubmitted(true);
        setLoading(false);
        return;
      }
      setErrorMsg(cleanMsg || "This interview invitation is invalid or has expired.");
      setIsInvalid(true);
      setLoading(false);
    }
  };

  const handleEmailGateSubmit = async () => {
    const email = emailGateInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailGateError("Please enter a valid email address.");
      return;
    }
    if (!multiCandidateToken && !shortCode) {
      setEmailGateError("Invalid interview link.");
      return;
    }
    setEmailGateLoading(true);
    setEmailGateError(null);
    try {
      // Use shortCode as the token lookup key for multi-candidate interviews
      const lookupToken = multiCandidateToken || shortCode!;
      const result = await verifyCandidateEmail(lookupToken, email);
      if (result.success && result.session_token) {
        localStorage.setItem("interview_token", result.session_token);
        if (shortCode) {
          localStorage.setItem("interview_short_code", shortCode);
        }
        setToken(result.session_token); // Update token state so details confirm save operates on the correct token
        setCandidateEmail(email); // Automatically populate verified email on details page
        setShowEmailGate(false);
        // Directly load data with the verified session token.
        await loadData(result.session_token);
      } else {
        setEmailGateError("Verification failed. Please try again.");
      }
    } catch (err: any) {
      const code = err?.code || err?.detail?.code || "";
      const rawMsg = err?.message || (typeof err === "string" ? err : "");
      const cleanMsg = typeof rawMsg === "string" && rawMsg !== "[object Object]" ? rawMsg.trim() : "";
      const combined = (cleanMsg + " " + code).toLowerCase();

      if (code === "ALREADY_COMPLETED" || combined.includes("completed")) {
        const detail = err?.detail || {};
        const candInfo = {
          email: detail.candidate_email || email,
          name: detail.candidate_name || candidateName || "",
          jobRole: detail.job_role || interview?.job_role || "",
          completedAt: detail.completed_at || "",
        };
        setCompletedCandidate(candInfo);
        if (candInfo.name) {
          setCandidateName(candInfo.name);
        }
        setCandidateEmail(candInfo.email);
        setEmailGateError(null);
        return;
      } else if (code === "EXPIRED" || combined.includes("expired")) {
        setEmailGateError("This interview link has expired. Please contact your recruiter.");
      } else if (code === "NOT_YET_AVAILABLE" || combined.includes("not yet available") || combined.includes("not available")) {
        setEmailGateError("This interview is not yet available. Please check your scheduled start time.");
      } else if (combined.includes("not authorized") || combined.includes("unauthorized") || combined.includes("forbidden") || combined.includes("revoked")) {
        setEmailGateError("You are not authorized to attend this interview. Please contact your recruiter.");
      } else if (cleanMsg) {
        setEmailGateError(cleanMsg);
      } else {
        setEmailGateError("Verification failed. Please check your email address and try again.");
      }
    } finally {
      setEmailGateLoading(false);
    }
  };

  useEffect(() => {
    // Reset all state when token/shortCode changes
    setInterview(null);
    setQuestions([]);
    setCurrentIdx(0);
    setAnswers({});
    setShowDetails(true);
    setShowGuidelines(false);
    setShowIdentityVerification(false);
    setShowStart(false);
    setSubmitted(false);
    setElapsed(0);
    setCandidateName("");
    setCandidateEmail("");
    setCandidateExperience("");
    setCodeContent("");
    setCodeOutput("");
    setIsInvalid(false);
    setErrorMsg(null);
    setShowEmailGate(false);
    setEmailGateInput("");
    setEmailGateError(null);
    setCompletedCandidate(null);
    setMultiCandidateToken(null);
    setLoading(true);

    if (shortCode) {
      const savedShortCode = localStorage.getItem("interview_short_code");
      if (savedShortCode && savedShortCode !== shortCode) {
        localStorage.removeItem("interview_token");
        localStorage.removeItem("interview_id");
        localStorage.removeItem("interview_short_code");
        if (token && !urlToken) {
          setToken(null);
          return;
        }
      }
    }

    // Prioritize token (either from url/localStorage or resolved from shortCode).
    // If we have a token, we load it. If not, we resolve the shortCode first.
    if (token) {
      loadData(token);
    } else if (shortCode) {
      resolveShortCodeAndLoad();
    } else {
      setIsInvalid(true);
      setLoading(false);
    }
  }, [token, shortCode]);

  useEffect(() => {
    if (!interview || interview.access_status !== "NOT_YET_AVAILABLE" || !interview.available_from) {
      setTimeLeft(null);
      return;
    }

    const availableTime = new Date(interview.available_from).getTime();
    const initialServerTime = interview.server_time ? new Date(interview.server_time).getTime() : Date.now();
    const offset = initialServerTime - Date.now();
    setServerTimeOffset(offset);

    const interval = setInterval(async () => {
      const estimatedServerTime = Date.now() + offset;
      const difference = availableTime - estimatedServerTime;

      if (difference <= 0) {
        clearInterval(interval);
        setTimeLeft(null);
        setIsVerifyingAccess(true);
        try {
          const activeToken = token || localStorage.getItem("interview_token");
          if (activeToken) {
            await loadData(activeToken, true);
          }
        } catch (err) {
          console.error("Revalidation failed:", err);
        } finally {
          setIsVerifyingAccess(false);
        }
      } else {
        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);
        setTimeLeft({ days, hours, minutes, seconds });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [interview, token]);

  const loadData = async (activeToken: string, force = false) => {
    if (!activeToken || activeToken === "null" || activeToken === "undefined") {
      console.warn("loadData called with invalid token:", activeToken);
      setIsInvalid(true);
      setLoading(false);
      return;
    }
    // If the interview is already loaded for this token, skip fetching again
    if (!force && interview && (interview.invite_token === activeToken || interview.id === activeToken)) {
      console.log("[Performance] Interview already loaded for activeToken, skipping redundant fetch.");
      setLoading(false);
      return;
    }
    const start = Date.now();
    try {
      localStorage.setItem("interview_token", activeToken);
      // 1. Fetch interview basic info first (required for IDs)
      const data = await getInterviewByToken(activeToken);
      
      // If a shortCode is present in the URL, verify that the token's short_code matches it.
      // If it doesn't, this token belongs to a different interview, so it is stale.
      if (shortCode && data.short_code !== shortCode) {
        throw new Error("Token does not match the current interview link.");
      }

      setInterview(data);
      if (data && data.id) {
        localStorage.setItem("interview_id", data.id);
      }
      if (data && (data.short_code || shortCode)) {
        localStorage.setItem("interview_short_code", data.short_code || shortCode!);
      }
      console.log(`[Performance] Interview loaded in ${Date.now() - start}ms`);

      // 2. Fetch questions in parallel with other restoration logic if possible
      // Actually, we can fetch interview and questions in parallel if we use token for both
      // But getCandidateQuestionsByInterviewId is cleaner if we have the ID.
      // Let's use Promise.all for interview and a dummy question fetch if possible, 
      // or just fetch them together.

      const qsPromise = getCandidateQuestionsByInterviewId(activeToken, data.id);

      // Restore candidate info if present
      if (data.candidate_name) setCandidateName(data.candidate_name);
      if (data.candidate_email) setCandidateEmail(data.candidate_email);
      if (data.candidate_experience) {
        const expNum = parseInt(data.candidate_experience, 10);
        if (!isNaN(expNum) && String(expNum) === data.candidate_experience.trim()) {
          setCandidateExperience(data.candidate_experience);
        }
      }

      if (data.status === "completed" || data.status === "flagged") {
        setSubmitted(true);
        setShowDetails(false);
        setShowStart(false);
        setShowSystemCheck(false);
      } else if (data.status === "in_progress" || data.started_at) {
        setShowDetails(false);
        setShowGuidelines(false);
        setShowIdentityVerification(false);
        setShowStart(false);
        setShowSystemCheck(false);

        if (data.current_round === "coding") {
          setShowCodingRound(true);
        } else {
          setUseVoiceAgent(true); // Restore premium AI voice interface
        }

        // Restore timer
        if (data.started_at) {
          const startTime = new Date(data.started_at).getTime();
          const now = Date.now();
          const diff = Math.floor((now - startTime) / 1000);
          setElapsed(diff > 0 ? diff : 0);
        }
      } else if (data.status === "pending" && (data.candidate_name || data.compliance_accepted || data.candidate_id_url)) {
        // If details already entered, check compliance and identity
        setShowDetails(false);
        if (data.compliance_accepted) {
          const isVideoReq = Boolean(data.save_video_recording || data.show_candidate_video || (data.proctoring_enabled !== false));
          if (data.candidate_id_url || !isVideoReq) {
            setShowStart(true);
          } else {
            setShowIdentityVerification(true);
          }
        } else {
          setShowGuidelines(true);
        }
      }

      const qs = await qsPromise;
      console.log(`[Performance] Questions loaded in ${Date.now() - start}ms`);

      // Sort by type: technical → behavioral
      // This ensures phases align with question types
      const sorted = [...(qs || [])].sort((a: Question, b: Question) => {
        const orderA = TYPE_SORT_ORDER[a.question_type] ?? 99;
        const orderB = TYPE_SORT_ORDER[b.question_type] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.order_index - b.order_index; // preserve order within same type
      });
      setQuestions(sorted);

      const existingAnswers: Record<string, string> = {};
      (qs || []).forEach((q: Question) => {
        if (q.candidate_answer) existingAnswers[q.id] = q.candidate_answer;
      });
      setAnswers(existingAnswers);

      // Restore last position
      const firstUnanswered = sorted.findIndex((q: Question) => !q.candidate_answer);
      if (firstUnanswered !== -1) {
        setCurrentIdx(firstUnanswered);
      } else if (sorted.length > 0) {
        setCurrentIdx(sorted.length - 1);
      }
    } catch (err: any) {
      console.error("[LoadData] Error:", err);

      // If we are at /i/:shortCode and activeToken failed with ANY error (including ALREADY_COMPLETED),
      // verify if activeToken was a stale token from another interview!
      if (shortCode) {
        const savedShortCode = localStorage.getItem("interview_short_code");
        if (savedShortCode !== shortCode || err.message === "Token does not match the current interview link.") {
          console.warn("[LoadData] Stale token from a different interview detected. Resolving current shortCode freshly.");
          localStorage.removeItem("interview_token");
          localStorage.removeItem("interview_id");
          localStorage.removeItem("interview_short_code");
          setToken(null);
          resolveShortCodeAndLoad();
          return;
        }
      }

      const code = err?.code || err?.detail?.code || "";
      const rawMsg = err?.message || (typeof err === "string" ? err : "");
      const cleanMsg = typeof rawMsg === "string" && rawMsg !== "[object Object]" ? rawMsg.trim() : "";
      const lower = (cleanMsg + " " + code).toLowerCase();

      if (code === "ALREADY_COMPLETED" || lower.includes("completed")) {
        setSubmitted(true);
        setLoading(false);
        return;
      }

      setErrorMsg(cleanMsg || "This link is invalid or has expired.");
      setIsInvalid(true);
      // Clean invalid token from localStorage
      localStorage.removeItem("interview_token");
      localStorage.removeItem("interview_id");
      localStorage.removeItem("interview_short_code");
      toast({ title: "Invalid interview link", description: cleanMsg || "This link is invalid or has expired.", variant: "destructive" });
    } finally {
      // Remove the synthetic delay for faster refresh
      setLoading(false);
      console.log(`[Performance] Total load time: ${Date.now() - start}ms`);
    }
  };

  // The early returns (isUploading, loading, error) have been moved to the bottom of the component logic to prevent ReferenceErrors during minification.

  const handleSaveDetails = async () => {
    if (!candidateName.trim()) {
      toast({ title: "Please enter your name", variant: "destructive" });
      return;
    }
    if (!candidateEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
      toast({ title: "Please enter a valid email address", variant: "destructive" });
      return;
    }
    const verifiedEmail = (interview?.candidate_email || "").trim().toLowerCase();
    const enteredEmail = candidateEmail.trim().toLowerCase();
    if (enteredEmail && verifiedEmail && enteredEmail !== verifiedEmail) {
      toast({ title: "Verification Error", description: "Entered email does not match the invited email address.", variant: "destructive" });
      return;
    }
    /*
    if (!candidateExperience.trim()) {
      toast({ title: "Please enter your experience", variant: "destructive" });
      return;
    }
    const expVal = parseInt(candidateExperience, 10);
    if (isNaN(expVal) || expVal < 0 || expVal > 99 || String(expVal) !== candidateExperience.trim()) {
      toast({ title: "Invalid experience", description: "Please enter a valid number of years (0-99)", variant: "destructive" });
      return;
    }
    */

    setSavingDetails(true);
    try {
      enterFullscreen();
      await saveCandidateDetails(token!, candidateName.trim(), candidateEmail.trim(), candidateExperience.trim() || "0");
      setShowDetails(false);
      setShowGuidelines(true);
    } catch (err: any) {
      toast({ title: "Error saving details", description: err.message, variant: "destructive" });
    }
    setSavingDetails(false);
  };

  const enterFullscreen = () => {
    requestAppFullscreen();
    const doc = document as any;
    const isFs = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.msFullscreenElement ||
      doc.mozFullScreenElement
    );
    setIsFullscreen(isFs);
  };

  const handleStart = () => {
    enterFullscreen();         // ← Request Fullscreen on user gesture
    setShowStart(false);       // ← HIDE start screen first
    setShowSystemCheck(true);  // ← THEN show system check
  };

  const handleSystemCheckComplete = async () => {
    enterFullscreen(); // Synchronously request fullscreen immediately on click of "Start Interview Now"!
    if (!interview) return;
    setStarting(true);
    try {
      const hasVoiceQuestions = questions.some(q => q.question_type === "technical" || q.question_type === "behavioral");
      const initialRound = questions.some(q => q.question_type === "behavioral" && q.selected)
        ? "behavioral"
        : (questions.some(q => q.question_type === "technical" && q.selected) ? "technical" : "coding");

      await updateInterviewStatus(interview.id, "in_progress", token!, { current_round: hasVoiceQuestions ? initialRound : "coding" });
      setShowSystemCheck(false);

      if (hasVoiceQuestions) {
        setUseVoiceAgent(true); // Launch the AI voice interview
      } else {
        setShowCodingRound(true); // Skip directly to coding
      }
    } catch (err: any) {
      toast({ title: "Error starting interview", description: err.message, variant: "destructive" });
      // On error, let them retry - put start check back
      setShowSystemCheck(false);
      setShowStart(true);
    }
    setStarting(false);
  };

  // Timer
  useEffect(() => {
    // Timer only runs when the interview is ACTIVE (no pre-screens, not submitted, not uploading)
    if (!showDetails && !showGuidelines && !showIdentityVerification && !showStart && !showSystemCheck && !submitted && !showPhaseSplash && !isUploading) {
      const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => clearInterval(timer);
    }
  }, [showDetails, showGuidelines, showIdentityVerification, showStart, showSystemCheck, submitted, showPhaseSplash, isUploading]);

  // Auto-submit and Soft Ending logic
  const autoSubmitFiredRef = useRef(false);
  const twoMinWarningRef = useRef(false);
  const thirtySecWarningRef = useRef(false);
  const gracePeriodStartedRef = useRef(false);
  const [isGracePeriod, setIsGracePeriod] = useState(false);
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState(50);
  const [showTwoMinBanner, setShowTwoMinBanner] = useState(false);

  useEffect(() => {
    if (!isInterviewActive || !interview || autoSubmitFiredRef.current) return;
    const maxSeconds = (interview.duration_minutes || 30) * 60;
    const remaining = maxSeconds - elapsed;

    if (remaining <= 120 && remaining > 30 && !twoMinWarningRef.current) {
      twoMinWarningRef.current = true;
      setShowTwoMinBanner(true);
      if (typeof window !== "undefined") {
        setTimeout(() => setShowTwoMinBanner(false), 3000);
      }
    }

    if (remaining <= 30 && remaining > 0 && !thirtySecWarningRef.current) {
      thirtySecWarningRef.current = true;
      toast({
        title: "30 seconds remaining",
        description: "Please finish your current response.",
      });
    }

    if (elapsed >= maxSeconds && !gracePeriodStartedRef.current) {
      gracePeriodStartedRef.current = true;
      setIsGracePeriod(true);
      if (typeof window !== "undefined") {
         interviewAudioBus.stopSpeaking();
         if (window.speechSynthesis) window.speechSynthesis.cancel();
      }
    }
  }, [elapsed, isInterviewActive, interview]);

  useEffect(() => {
    if (isGracePeriod && gracePeriodSeconds > 0) {
      const timer = setTimeout(() => setGracePeriodSeconds(s => s - 1), 1000);
      return () => clearTimeout(timer);
    } else if (isGracePeriod && gracePeriodSeconds <= 0 && !autoSubmitFiredRef.current) {
      autoSubmitFiredRef.current = true;
      handleSubmitInterview();
    }
  }, [isGracePeriod, gracePeriodSeconds]);

  // ─── Proctoring / Tab Switching Detection ──────────────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Only track if the interview is actually in progress
      if (document.visibilityState === "hidden" && isInterviewActive) {
        console.warn("[Proctor] Tab switch or window minimize detected.");
        toast({
          title: "Warning: Tab Switch Detected",
          description: "Please remain on the interview screen. Switching tabs is flagged as a violation.",
          variant: "destructive",
        });
      }
    };

    const handleWindowBlur = () => {
      if (isInterviewActive) {
        console.warn("[Proctor] Window focus lost (User might have clicked a notification or another app).");
        toast({
          title: "Warning: Focus Lost",
          description: "The interview window lost focus. Please avoid interacting with notifications or other applications.",
          variant: "destructive",
        });
      }
    };

    const checkIsFullscreen = () => {
      const doc = document as any;
      return !!(
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.msFullscreenElement ||
        doc.mozFullScreenElement
      );
    };

    const handleFullscreenChange = () => {
      const isFs = checkIsFullscreen();
      setIsFullscreen(isFs);
      if (!isFs && isInterviewActive) {
        toast({
          title: "Full Screen Required",
          description: "Please remain in full screen mode during your assessment.",
          variant: "destructive",
        });
      }
    };

    // Automatically enforce/restore fullscreen on any user gesture (click, keydown, touch) while interview is active
    const handleUserGestureEnforceFullscreen = () => {
      if (isInterviewActive && !checkIsFullscreen()) {
        requestAppFullscreen();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);

    // Multi-browser fullscreen change events
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    const preventDefault = (e: Event) => {
      if (isInterviewActive) {
        e.preventDefault();
        toast({
          title: "Action Restricted",
          description: "Right-click, copy, and paste are disabled during the assessment to ensure integrity.",
          variant: "destructive",
        });
      }
    };

    document.addEventListener("contextmenu", preventDefault);
    document.addEventListener("copy", preventDefault);
    document.addEventListener("paste", preventDefault);

    // Capture user gestures anywhere on the window to seamlessly re-engage fullscreen
    window.addEventListener("click", handleUserGestureEnforceFullscreen, { capture: true });
    window.addEventListener("keydown", handleUserGestureEnforceFullscreen, { capture: true });
    window.addEventListener("touchstart", handleUserGestureEnforceFullscreen, { capture: true });

    // Initial check
    setIsFullscreen(checkIsFullscreen());

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
      document.removeEventListener("contextmenu", preventDefault);
      document.removeEventListener("copy", preventDefault);
      document.removeEventListener("paste", preventDefault);
      window.removeEventListener("click", handleUserGestureEnforceFullscreen, { capture: true });
      window.removeEventListener("keydown", handleUserGestureEnforceFullscreen, { capture: true });
      window.removeEventListener("touchstart", handleUserGestureEnforceFullscreen, { capture: true });
    };
  }, [isInterviewActive]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  // Returns remaining time string (countdown from max duration)
  const formatTimeRemaining = () => {
    if (!interview) return "00:00";
    const maxSeconds = (interview.duration_minutes || 30) * 60;
    const remaining = Math.max(0, maxSeconds - elapsed);
    return formatTime(remaining);
  };

  // Returns true when less than 5 minutes remain
  const isTimeLow = () => {
    if (!interview) return false;
    const maxSeconds = (interview.duration_minutes || 30) * 60;
    return Math.max(0, maxSeconds - elapsed) < 300;
  };

  const currentQ = questions[currentIdx];
  const currentType = currentQ?.question_type;
  const currentPhase = getPhaseForIndex(currentIdx, questions.length, questions);

  // Phase transition detection
  useEffect(() => {
    if (!showDetails && !showGuidelines && !showStart && !submitted && currentQ) {
      if (currentPhase !== prevPhaseRef.current) {
        // Phase changed! Show splash screen
        setSplashPhase(currentPhase);
        setShowPhaseSplash(true);
        prevPhaseRef.current = currentPhase;
        // Stop any ongoing speech/listening
        stopSpeaking();
        stopListening();
      }
    }
  }, [currentIdx, showDetails, showGuidelines, showStart, submitted]);

  const handleDismissSplash = () => {
    setShowPhaseSplash(false);
  };

  const handleAnswerChange = (value: string) => {
    if (!currentQ) return;
    setAnswers((prev) => ({ ...prev, [currentQ.id]: value }));
  };

  const handleSaveAndNext = async () => {
    if (!currentQ || !token) return;
    const answer = currentType === "coding" ? codeContent : (answers[currentQ.id] || "");
    if (!answer.trim()) {
      toast({ title: "Please provide an answer before proceeding", variant: "destructive" });
      return;
    }

    setSubmittingNext(true);
    try {
      await submitCandidateAnswer(token, currentQ.id, answer);
      setAnswers((prev) => ({ ...prev, [currentQ.id]: answer }));

      // Stop speaking/listening before moving
      stopSpeaking();
      stopListening();

      if (currentIdx < questions.length - 1) {
        setCurrentIdx(currentIdx + 1);
        setCodeContent("");
        setCodeOutput("");
      }
    } catch (err: any) {
      toast({ title: "Error saving answer", description: err.message, variant: "destructive" });
    } finally {
      setSubmittingNext(false);
    }
  };

  const handleRunCode = async () => {
    if (!codeContent.trim() || !interview) return;
    setRunningCode(true);
    setCodeOutput("Running...");
    try {
      const result = await executeCode(interview.id, codeContent, codeLanguage, undefined, token!);
      setCodeOutput(result.output || "No output");
    } catch (err: any) {
      setCodeOutput(`Error: ${err.message}`);
    }
    setRunningCode(false);
  };

  const finalizeAndCompleteInterview = async () => {
    if (!interview || !token) return;
    if (isTerminatingRef.current) return;
    isTerminatingRef.current = true;
    
    setIsUploading(true);
    try {
      // 1. Mark interview as completed (safe catch to prevent blocking scoring trigger)
      try {
        await updateInterviewStatus(interview.id, "completed", token);
      } catch (statusErr) {
        console.warn("Status update was already completed or failed:", statusErr);
      }

      // 2. Trigger async scoring (non-blocking)
      submitInterviewForScoring(interview.id, token).catch((scoreErr) => {
        console.warn("Auto-scoring failed, recruiter can trigger manually:", scoreErr);
      });

      // 3. Background upload finalization
      if (interview?.save_video_recording) {
        toast({ title: "Finishing up...", description: "Your interview is complete. Video is saving in the background." });
      } else {
        toast({ title: "Finishing up...", description: "Your interview is complete. Finalizing session..." });
      }

      if (cameraRef.current) {
        console.log("[Finalize] Triggering kill switch and starting background upload...");
        cameraRef.current.stopProctoring(); // Kill switch immediately

        // Race stopAndFinalize against a 15s timeout to prevent UI hang in background
        const finalizePromise = cameraRef.current.stopAndFinalize();
        const safetyTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 15000));

        // Wait for upload to complete before proceeding
        await Promise.race([finalizePromise, safetyTimeout]).catch(err => {
          console.error("Background upload failed:", err);
        });
      } else {
        console.warn("[Finalize] cameraRef not available — skipping video finalization.");
      }

      // Set UI state after upload finishes
      handleUploadComplete();
    } catch (err: any) {
      console.error("[Finalize] Error during finalization:", err);
      toast({ title: "Error completing interview", description: err.message, variant: "destructive" });
      setIsUploading(false); // Unblock UI on error so candidate isn't stuck
    }
  };

  const handleSubmitInterview = async () => {
    if (!interview || !token) return;
    // Save current answer first
    if (currentQ) {
      const answer = currentType === "coding" ? codeContent : (answers[currentQ.id] || "");
      if (answer.trim()) {
        try {
          await submitCandidateAnswer(token, currentQ.id, answer);
        } catch (e) {
          console.warn("Failed to save final answer:", e);
        }
      }
    }

    setSubmitting(true);
    await finalizeAndCompleteInterview();
    setSubmitting(false);
  };


  const handleUploadComplete = () => {
    setIsUploading(false);
    setSubmitted(true);
    localStorage.removeItem("interview_token");
    localStorage.removeItem("interview_id");
    localStorage.removeItem("interview_short_code");
  };

  // ─── TTS (Text to Speech) — only Phase 2 & Phase 3 ─────────────────────────
  const speakQuestion = async (text: string) => {
    setIsSpeaking(true);
    try {
      await interviewAudioBus.speak(text, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => {
          setIsSpeaking(false);
          // Start listening automatically once the question is complete
          const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          if (SpeechRecognition && !recognitionRef.current && !isListening) {
            toggleListening();
          }
        },
      });
    } catch (err) {
      console.error("[CandidateInterview] speakQuestion error:", err);
      setIsSpeaking(false);
    }
  };

  const stopSpeaking = () => {
    interviewAudioBus.stopSpeaking();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  };

  // ─── STT (Speech to Text) — only Phase 3 ──────────────────────────────────
  const stopListening = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) { }
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  const startVoiceTimer = () => {
    setVoiceSeconds(0);
    voiceTimerRef.current = setInterval(() => setVoiceSeconds((s) => s + 1), 1000);
  };

  const stopVoiceTimer = () => {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  };

  const initialAnswerRef = useRef<string>("");

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      toast({ title: "Speech recognition not supported in this browser", variant: "destructive" });
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    // Guard against concurrent activation from double clicks
    if (recognitionRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      startVoiceTimer();
      // Capture the existing answer so we can append the new speech to it
      initialAnswerRef.current = answers[currentQ?.id] || "";
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      setIsListening(false);
      stopVoiceTimer();
      recognitionRef.current = null;
    };
    recognition.onerror = (event: any) => {
      if (recognitionRef.current !== recognition) return;
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      stopVoiceTimer();
      recognitionRef.current = null;
    };

    recognition.onresult = (event: any) => {
      if (recognitionRef.current !== recognition) return;
      let currentSessionTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        currentSessionTranscript += event.results[i][0].transcript;
      }
      const combined = initialAnswerRef.current 
        ? initialAnswerRef.current + " " + currentSessionTranscript
        : currentSessionTranscript;
      handleAnswerChange(combined);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      console.error("Failed to start speech recognition", err);
      recognitionRef.current = null;
    }

    // Auto-stop after 90 seconds
    setTimeout(() => {
      if (recognitionRef.current === recognition) {
        stopListening();
      }
    }, 90000);
  };

  // Auto-speak questions in Phase 2 & 3 (disabled when using the agentic VoiceInterviewAgent)
  useEffect(() => {
    if (useVoiceAgent) return;
    if (!showDetails && !showGuidelines && !showStart && !submitted && !showPhaseSplash && currentQ) {
      const phase = getPhaseForIndex(currentIdx, questions.length);
      if (phase === 2) {
        const t = setTimeout(() => speakQuestion(currentQ.question_text), 800);
        return () => clearTimeout(t);
      }
    }
  }, [currentIdx, showDetails, showStart, showPhaseSplash, useVoiceAgent]);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
      stopListening();
    };
  }, []);

  // ─── Renders ──────────────────────────────────────────────────────────────────

  if (loading || (!interview && !isInvalid && !showEmailGate && !submitted)) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center px-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <h2 className="text-xl font-semibold animate-pulse text-foreground">Loading your interview...</h2>
      </div>
    );
  }

  // ── Email Verification Gate (Multi-Candidate) ────────────────────────────
  if (showEmailGate) {
    if (completedCandidate) {
      return (
        <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
          {/* Enterprise ambient glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl h-full max-h-[600px] pointer-events-none opacity-40">
            <div className="absolute top-1/3 left-1/3 w-72 h-72 bg-emerald-500/15 rounded-full blur-[90px]" />
            <div className="absolute bottom-1/3 right-1/3 w-72 h-72 bg-cyan-500/15 rounded-full blur-[100px]" />
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="w-full max-w-md bg-card border border-border/80 rounded-2xl shadow-2xl p-8 space-y-6 relative z-10 text-center"
          >
            {/* Emerald Animated Status Hero */}
            <div className="space-y-3">
              <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/25 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>

              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 mb-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Assessment Submitted
                </div>
                <h2 className="text-2xl font-bold text-foreground tracking-tight">
                  Interview Already Completed
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  Your assessment has been finalized and securely submitted to the hiring panel.
                </p>
              </div>
            </div>

            {/* Candidate & Verification Details Card */}
            <div className="rounded-xl bg-secondary/30 border border-border/60 p-4 text-left space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-border/40">
                <span className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">
                  Candidate Verification
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                  <ShieldCheck className="h-3.5 w-3.5" /> Verified
                </span>
              </div>

              <div className="space-y-1.5">
                {completedCandidate.name && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs">Name:</span>
                    <span className="font-semibold text-foreground">{completedCandidate.name}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground text-xs">Email:</span>
                  <span className="font-mono text-xs text-foreground font-medium">{completedCandidate.email}</span>
                </div>
                {completedCandidate.jobRole && (
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-border/30">
                    <span className="text-muted-foreground text-xs">Position:</span>
                    <span className="text-xs font-medium text-foreground">{completedCandidate.jobRole}</span>
                  </div>
                )}
                {completedCandidate.completedAt && (
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-border/30">
                    <span className="text-muted-foreground text-xs">Submitted:</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(completedCandidate.completedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Assessment Integrity Notice */}
            <div className="rounded-xl bg-primary/5 border border-primary/15 p-3.5 text-left flex items-start gap-3">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                For candidate fairness and standardized evaluation integrity, completed assessments cannot be retaken. The hiring team is evaluating all submissions.
              </p>
            </div>

            {/* Enterprise Action Buttons */}
            <div className="space-y-2.5 pt-1">
              <Button
                className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
                onClick={() => {
                  setShowEmailGate(false);
                  setSubmitted(true);
                }}
              >
                View Full Completion Details <ArrowRight className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                className="w-full h-10 border-border/70 hover:bg-secondary/40 text-muted-foreground text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
                onClick={() => {
                  setCompletedCandidate(null);
                  setEmailGateInput("");
                  setEmailGateError(null);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Check with a different email address
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground/75 leading-tight">
              Questions regarding your application? Please contact your recruiter directly.
            </p>
          </motion.div>
        </div>
      );
    }

    return (
      <div className="min-h-[100dvh] w-full bg-background flex items-center justify-center px-4 relative overflow-hidden">
        {/* Ambient subtle glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl h-full max-h-[600px] pointer-events-none opacity-30">
          <div className="absolute top-1/3 left-1/3 w-64 h-64 bg-primary/15 rounded-full blur-[80px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-8 space-y-6 relative z-10"
        >
          {/* Icon */}
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 mx-auto shadow-inner">
            <Mail className="h-7 w-7 text-primary" />
          </div>

          {/* Title */}
          <div className="text-center">
            <h2 className="text-xl font-bold text-foreground mb-1">Verify Your Email</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Enter the email address your recruiter used to invite you.
            </p>
          </div>

          {/* Input */}
          <div className="space-y-3">
            <input
              type="email"
              autoFocus
              value={emailGateInput}
              onChange={(e) => { setEmailGateInput(e.target.value); setEmailGateError(null); }}
              onKeyDown={(e) => e.key === "Enter" && !emailGateLoading && handleEmailGateSubmit()}
              placeholder="you@example.com"
              className="w-full h-11 rounded-lg bg-background border border-border px-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />

            {/* Error */}
            {emailGateError && (
              <div className={`rounded-xl p-3.5 space-y-1 text-left ${
                emailGateError.toLowerCase().includes("expired")
                  ? "bg-amber-500/10 border border-amber-500/25"
                  : "bg-destructive/10 border border-destructive/25"
              }`}>
                <div className="flex items-start gap-2.5">
                  {emailGateError.toLowerCase().includes("expired") ? (
                    <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold leading-tight ${
                      emailGateError.toLowerCase().includes("expired")
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-destructive"
                    }`}>
                      {emailGateError}
                    </p>
                    {emailGateError.toLowerCase().includes("expired") && (
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        The access window for this interview has passed. Please contact your recruiter to request an extension or a new link.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <Button
              className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg flex items-center justify-center gap-2 transition-all active:scale-95"
              onClick={handleEmailGateSubmit}
              disabled={emailGateLoading || !emailGateInput.trim()}
            >
              {emailGateLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Verifying...</>
              ) : (
                <><ArrowRight className="h-4 w-4" /> Continue to Interview</>
              )}
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Your email will only be used to verify your identity for this interview.
          </p>
        </motion.div>
      </div>
    );
  }

  if (interview && interview.access_status === "NOT_YET_AVAILABLE") {
    // Beautiful timezone formatted string
    let formattedDate = "";
    try {
      const startDt = new Date(interview.available_from);
      formattedDate = startDt.toLocaleString('en-US', {
        timeZone: interview.timezone || 'Asia/Kolkata',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    } catch (e) {
      formattedDate = new Date(interview.available_from).toString();
    }

    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
        {/* Ambient glow effects */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-full max-h-[800px] pointer-events-none opacity-50">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-cyan-500/10 rounded-full blur-[85px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-600/10 rounded-full blur-[105px] animate-pulse" style={{ animationDelay: '1.5s' }} style-delayed="" />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="max-w-xl w-full text-center space-y-8 relative z-10"
        >
          <div className="space-y-3">
            <div className="h-16 w-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(6,182,212,0.15)] animate-bounce" style={{ animationDuration: '3s' }}>
              <Clock className="h-8 w-8 text-cyan-400" />
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
              Interview Not Available Yet
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your interview is scheduled to begin in the configured timezone window.
            </p>
          </div>

          {/* Timezone display box */}
          <div className="glass-card p-4 border border-border/40 rounded-xl bg-secondary/5 inline-block mx-auto max-w-md">
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-black">Scheduled Start Time</p>
            <p className="text-sm font-bold text-foreground mt-1">{formattedDate}</p>
          </div>

          {/* Countdown block */}
          {timeLeft && (
            <div className="grid grid-cols-4 gap-3 max-w-sm mx-auto">
              {[
                { label: "Days", value: timeLeft.days },
                { label: "Hours", value: timeLeft.hours },
                { label: "Mins", value: timeLeft.minutes },
                { label: "Secs", value: timeLeft.seconds },
              ].map((item, idx) => (
                <div key={idx} className="glass-card flex flex-col items-center justify-center p-3 rounded-xl border border-cyan-500/10 bg-gradient-to-b from-background to-secondary/5 relative group hover:border-cyan-400/30 transition-all duration-300">
                  <span className="text-3xl font-black font-mono text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.3)]">
                    {String(item.value).padStart(2, "0")}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">{item.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Start button or status loader */}
          <div className="pt-4 max-w-xs mx-auto">
            <Button
              className="w-full h-11 bg-primary/20 text-muted-foreground border border-border cursor-not-allowed font-bold rounded-lg flex items-center justify-center gap-2 transition-all"
              disabled={true}
            >
              {isVerifyingAccess ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                  Verifying Availability...
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-cyan-400/80" />
                  Waiting for scheduled start
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground/75 mt-3">
              The page will automatically unlock and verify access once the countdown completes.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isInvalid) {
    const isCompleted = errorMsg?.toLowerCase().includes("completed");
    const isExpired = errorMsg?.toLowerCase().includes("expired");
    return (
      <div className="min-h-[100dvh] w-full bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center p-8 bg-card border border-border rounded-2xl shadow-xl space-y-4">
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl mx-auto ${
            isCompleted
              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-500"
              : isExpired
              ? "bg-amber-500/10 border border-amber-500/20 text-amber-500"
              : "bg-destructive/10 border border-destructive/20 text-destructive"
          }`}>
            {isCompleted ? (
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            ) : isExpired ? (
              <Clock className="h-8 w-8 text-amber-500" />
            ) : (
              <AlertCircle className="h-8 w-8 text-destructive" />
            )}
          </div>
          <h2 className="text-xl font-bold text-foreground">
            {isCompleted ? "Interview Already Completed" : isExpired ? "Interview Link Expired" : "Unable to Access Interview"}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {errorMsg || "This interview link is invalid or has expired."}
          </p>
          {isCompleted && (
            <div className="pt-3 border-t border-border/40 space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your assessment responses have already been recorded and submitted to the hiring panel. For evaluation integrity, completed sessions cannot be retaken.
              </p>
              <Button
                variant="outline"
                className="w-full text-xs font-semibold"
                onClick={() => setSubmitted(true)}
              >
                View Full Submission Details
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-full max-h-[800px] pointer-events-none opacity-50">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-cyan-500/20 rounded-full blur-[80px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-600/20 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="text-center space-y-6 max-w-lg w-full relative z-10"
        >
          <div className="relative">
            <div className="h-24 w-24 rounded-full bg-gradient-to-br from-cyan-400/20 to-blue-500/20 flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(6,182,212,0.2)] border border-cyan-500/30">
              <CheckCircle2 className="h-12 w-12 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
            </div>
            <h2 className="text-4xl font-bold tracking-tight mb-3">Interview Completed!</h2>
            <p className="text-lg text-muted-foreground italic max-w-md mx-auto">"Quality is not an act, it is a habit."</p>
          </div>

          <div className="glass-card p-8 text-left space-y-6 shadow-2xl relative overflow-hidden">


            <p className="text-sm text-muted-foreground leading-relaxed">
              Thank you for your time, <span className="text-foreground font-semibold">{candidateName || candidateEmail || "Candidate"}</span>.
              Your responses have been securely submitted to our specialized hiring panel.
            </p>

            <div className="space-y-5 pt-5 border-t border-border/30">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-cyan-500" />
                What happens next?
              </h4>
              <ul className="text-sm space-y-4 text-muted-foreground">
                <li className="flex gap-3">
                  <div className="h-5 w-5 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-cyan-500/20">
                    <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                  </div>
                  <span className="leading-relaxed">Our engine is synthesizing your competency profile and technical insights.</span>
                </li>
                <li className="flex gap-3">
                  <div className="h-5 w-5 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-cyan-500/20">
                    <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                  </div>
                  <span className="leading-relaxed">Hiring leads will review the generated evaluation alongside your session transcript.</span>
                </li>
                <li className="flex gap-3">
                  <div className="h-5 w-5 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-cyan-500/20">
                    <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                  </div>
                  <span className="leading-relaxed">You will receive a formal update regarding your candidacy within 3-5 business days.</span>
                </li>
              </ul>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-bold pt-4">
            We appreciate your interest in joining the team.
          </p>
        </motion.div>
      </div>
    );
  }

  // ─── Candidate Details Screen ─────────────────────────────────────────────────
  if (showDetails) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col">
        <div className="h-16 border-b border-border/10 bg-background/60 backdrop-blur-2xl flex items-center px-6 sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/30 glow-effect">
              <Brain className="h-5 w-5 text-cyan-500" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">Xevyte</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6 relative bg-mesh flex items-center justify-center">
          <div className="w-full max-w-md z-10 my-auto">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full">
              <div className="glass-card p-6 sm:p-8 relative overflow-hidden">
                <div className="h-12 w-12 rounded-xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-4 border border-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
                  <Brain className="h-6 w-6 text-cyan-500" />
                </div>
                <h2 className="text-2xl font-bold mb-1.5 text-center tracking-tight">Welcome, Candidate</h2>
                <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm mx-auto">Please confirm your details before we begin the assessment</p>

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">Full Name <span className="text-cyan-500">*</span></label>
                    <input
                      type="text"
                      value={candidateName}
                      onChange={(e) => setCandidateName(e.target.value.replace(/[0-9]/g, ''))}
                      placeholder="Enter your full name"
                      className="w-full h-11 rounded-xl bg-secondary/30 border border-border/50 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">Email Address <span className="text-cyan-500">*</span></label>
                    <input
                      type="email"
                      value={candidateEmail}
                      onChange={(e) => !interview?.candidate_email && setCandidateEmail(e.target.value)}
                      placeholder="Enter your email address"
                      className={`w-full h-11 rounded-xl bg-secondary/30 border border-border/50 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all ${interview?.candidate_email ? 'opacity-70 cursor-not-allowed' : ''}`}
                      readOnly={!!interview?.candidate_email}
                    />
                    {interview?.candidate_email && (
                      <p className="mt-1 text-[10px] text-muted-foreground/60">Email pre-filled from your invitation.</p>
                    )}
                  </div>
                  {/* Years of Experience input box commented out */}
                  {/* <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">Years of Experience <span className="text-cyan-500">*</span></label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={candidateExperience}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        if (val.length <= 2) {
                          setCandidateExperience(val);
                        }
                      }}
                      placeholder="Enter years of experience (0-99)"
                      className="w-full h-11 rounded-xl bg-secondary/30 border border-border/50 px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                    />
                  </div> */}
                </div>

                <Button variant="hero" className="w-full h-11 rounded-xl text-sm font-bold shadow-[0_0_20px_rgba(6,182,212,0.2)]" onClick={handleSaveDetails} disabled={savingDetails}>
                  {savingDetails ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {savingDetails ? "Saving..." : "Continue to Assessment"}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Pre-Interview Guidelines & Consent ──────────────────────────────────────
  if (showGuidelines) {
    const isProctoringEnabled = interview?.proctoring_enabled !== false;
    const isVideoRequired = Boolean(interview?.save_video_recording || interview?.show_candidate_video || isProctoringEnabled);
    const maxStrikes = interview?.proctoring_max_strikes || 3;

    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col">
        <div className="h-16 border-b border-border/10 bg-background/60 backdrop-blur-2xl flex items-center px-6 sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/30 glow-effect">
              <Brain className="h-5 w-5 text-cyan-500" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 hidden sm:block">Xevyte</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:ml-2 sm:pl-2 sm:border-l border-border/50">Rules of Conduct</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-8 px-4 relative bg-mesh">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl mx-auto space-y-6 z-10 relative">
            <div className="text-center space-y-2">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Pre-Interview Guidelines</h2>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md mx-auto">Please review the assessment instructions and proctoring protocols carefully before proceeding.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-card p-4 sm:p-5 space-y-3 hover:shadow-[0_8px_30px_rgba(6,182,212,0.06)] transition-all group">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20 group-hover:scale-105 transition-transform shrink-0">
                    <Play className="h-4.5 w-4.5 text-cyan-500" />
                  </div>
                  <h4 className="font-bold text-base">Interview Process</h4>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  The assessment consists of Technical, Behavioral, and Coding rounds.
                  You will interact with our AI agent via voice. Speak clearly and ensure your microphone is configured correctly.
                </p>
              </div>

              {isProctoringEnabled && (
                <>
                  <div className="glass-card p-4 sm:p-5 space-y-3 hover:shadow-[0_8px_30px_rgba(239,68,68,0.06)] transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center border border-destructive/20 group-hover:scale-105 transition-transform shrink-0">
                        <ShieldCheck className="h-4.5 w-4.5 text-destructive" />
                      </div>
                      <h4 className="font-bold text-base">Proctoring Rules</h4>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Your camera, microphone, and screen are monitored. Tab switching, window minimization, or leaving the frame will trigger a violation strike.
                      Copy-paste is disabled.
                    </p>
                  </div>

                  <div className="glass-card p-4 sm:p-5 space-y-3 hover:shadow-[0_8px_30px_rgba(245,158,11,0.06)] transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 group-hover:scale-105 transition-transform shrink-0">
                        <AlertCircle className="h-4.5 w-4.5 text-amber-500" />
                      </div>
                      <h4 className="font-bold text-base">The {maxStrikes}-Strike Rule</h4>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      A {maxStrikes}-strike system is actively monitoring your session. You will receive warnings for minor infractions.
                      Upon the <strong className="text-amber-500">{maxStrikes === 1 ? '1st' : maxStrikes === 2 ? '2nd' : maxStrikes === 3 ? '3rd' : maxStrikes + 'th'} strike</strong>, your assessment will be <strong>automatically terminated</strong>.
                    </p>
                  </div>
                </>
              )}

              <div className="glass-card p-4 sm:p-5 space-y-3 hover:shadow-[0_8px_30px_rgba(59,130,246,0.06)] transition-all group">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 group-hover:scale-105 transition-transform shrink-0">
                    <Video className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                  <h4 className="font-bold text-base">Camera & Recording</h4>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isVideoRequired ? (
                    interview?.save_video_recording
                      ? "Camera access is mandatory. Your session will be recorded securely for the hiring panel to review."
                      : "Camera access is active for live monitoring/proctoring, but no final video recording will be saved."
                  ) : (
                    "Camera is not required for this assessment. Only microphone access is needed."
                  )}
                </p>
              </div>
            </div>

            <div className="glass-card p-4 border border-cyan-500/20 bg-cyan-500/5 shadow-[0_0_15px_rgba(6,182,212,0.06)] rounded-xl">
              <label className="flex items-start gap-3.5 cursor-pointer group">
                <div className="relative flex items-center justify-center h-5 w-5 shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={complianceAccepted}
                    onChange={(e) => setComplianceAccepted(e.target.checked)}
                    className="peer h-full w-full appearance-none rounded-md border-2 border-cyan-500/60 bg-secondary/60 checked:bg-cyan-500 checked:border-cyan-500 hover:border-cyan-400 transition-all cursor-pointer focus:ring-2 focus:ring-cyan-500/30"
                  />
                  <Check className="absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                </div>
                <span className="text-xs text-foreground/90 select-none leading-relaxed group-hover:text-foreground transition-colors">
                  {isProctoringEnabled ? (
                    <>
                      I have read and understand the interview guidelines, proctoring rules, and the {maxStrikes}-strike policy.
                      I consent to active camera monitoring and AI proctoring {interview?.save_video_recording && "and session recording"} during this assessment.
                    </>
                  ) : isVideoRequired ? (
                    <>
                      I have read and understand the interview guidelines and policy. I consent to camera access {interview?.save_video_recording && "for session recording"}.
                    </>
                  ) : (
                    <>
                      I have read and understand the interview guidelines and policy. I consent to microphone access and audio processing for this assessment.
                    </>
                  )}
                </span>
              </label>
            </div>

            <Button
              variant="hero"
              className="w-full h-11.5 rounded-xl text-sm font-bold shadow-[0_0_20px_rgba(6,182,212,0.15)]"
              disabled={!complianceAccepted || starting}
              onClick={async () => {
                requestAppFullscreen();
                setStarting(true);
                try {
                  await updateInterviewStatus(interview.id, interview.status, token!, { compliance_accepted: true });
                  setShowGuidelines(false);
                  if (isVideoRequired) {
                    setShowIdentityVerification(true);
                  } else {
                    setShowStart(true);
                  }
                } catch (e: any) {
                  toast({ title: "Error saving consent", description: e.message, variant: "destructive" });
                } finally {
                  setStarting(false);
                }
              }}
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {starting ? "Processing..." : "Acknowledge & Proceed"}
            </Button>
          </motion.div>
        </div>
      </div>
    );
  }

  // ─── Identity Verification ──────────────────────────────────────────────────
  if (showIdentityVerification) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col">
        <div className="h-16 border-b border-border/50 bg-background/80 backdrop-blur-xl flex items-center px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground">Scaloz AI</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl">
            <IdentityVerification
              inviteToken={token!}
              onVerified={(url) => {
                setInterview((prev: any) => ({ ...prev, candidate_id_url: url }));
                setShowIdentityVerification(false);
                setShowStart(true);
              }}
            />
          </motion.div>
        </div>
      </div>
    );
  }

  // ─── Start Screen ─────────────────────────────────────────────────────────────
  if (showStart) {
    const techCount = questions.filter((q) => q.question_type === "technical").length;
    const codingCount = questions.filter((q) => q.question_type === "coding").length;
    const behavioralCount = questions.filter((q) => q.question_type === "behavioral").length;

    const isPlaceholderRole = !interview?.job_role || [
      "from jd", "from_jd", "unknown", "n/a", "na", "job", "position", "none", "null", "undefined", "title", "role"
    ].includes(interview.job_role.trim().toLowerCase());

    // Intelligent context-aware assessment title
    let defaultTitle = "Technical Assessment";
    if (codingCount > 0 && techCount > 0) {
      defaultTitle = "Technical & Coding Assessment";
    } else if (codingCount > 0 && techCount === 0) {
      defaultTitle = "Coding Assessment";
    } else if (behavioralCount > 0 && techCount === 0 && codingCount === 0) {
      defaultTitle = "Behavioral Assessment";
    } else {
      defaultTitle = "Technical Assessment";
    }

    const roleTitle = !isPlaceholderRole ? interview.job_role.trim() : defaultTitle;
    const companyName = interview?.tenant_name || interview?.company_name;

    return (
      <div className="min-h-[100dvh] w-full bg-background flex flex-col">
        {/* Top bar */}
        <div className="h-16 border-b border-border/20 bg-background/70 backdrop-blur-2xl flex items-center px-6 sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/30 glow-effect">
              <Brain className="h-5 w-5 text-cyan-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold tracking-tight text-foreground">IntelliHire</span>
              {companyName && (
                <span className="text-xs text-muted-foreground hidden sm:inline">• {companyName}</span>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto px-4 py-8 relative bg-mesh flex items-center justify-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg z-10">
            <div className="glass-card p-6 sm:p-8 space-y-6 shadow-2xl border border-border/40 backdrop-blur-xl">

              {/* Title Section */}
              <div className="text-center space-y-2">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-500/30 flex items-center justify-center mx-auto mb-3 shadow-[0_0_24px_rgba(6,182,212,0.15)]">
                  <Brain className="h-6 w-6 text-cyan-500" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{roleTitle}</h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  AI-Powered Assessment • Review your session parameters below
                </p>
              </div>

              {/* Key Metrics Grid (Single, non-redundant overview ribbon) */}
              <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-secondary/30 border border-border/40">
                <div className="text-center space-y-1">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5 text-cyan-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Duration</span>
                  </div>
                  <div className="text-sm font-bold text-foreground">
                    {interview?.duration_minutes || 30} mins
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-none">Auto-submit</div>
                </div>

                <div className="text-center space-y-1 border-x border-border/30 px-1">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground">
                    <Lightbulb className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Questions</span>
                  </div>
                  <div className="text-sm font-bold text-foreground">
                    {questions.length} total
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-none">
                    {codingCount > 0 && techCount > 0 ? "Voice & Code" : codingCount > 0 ? "IDE Coding" : "Voice AI"}
                  </div>
                </div>

                <div className="text-center space-y-1">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Proctoring</span>
                  </div>
                  <div className="text-sm font-bold text-emerald-500 dark:text-emerald-400">
                    {interview?.proctoring_enabled !== false ? "Enabled" : "Standard"}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-none">AI Monitored</div>
                </div>
              </div>

              {/* Assessment Modules (Unified non-redundant breakdown) */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-0.5">
                  Interview Modules
                </div>
                <div className="space-y-2">
                  {techCount > 0 && (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-background/50 border border-border/40 hover:border-border/60 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                          <Keyboard className="h-4.5 w-4.5 text-blue-500" />
                        </div>
                        <div className="text-left">
                          <div className="text-xs font-bold text-foreground">Technical Discussion</div>
                          <div className="text-[11px] text-muted-foreground">Voice-based evaluation of core engineering concepts</div>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md border border-border/30 shrink-0">
                        {techCount} Q{techCount > 1 ? "s" : ""}
                      </span>
                    </div>
                  )}

                  {codingCount > 0 && (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-background/50 border border-border/40 hover:border-border/60 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <Code2 className="h-4.5 w-4.5 text-primary" />
                        </div>
                        <div className="text-left">
                          <div className="text-xs font-bold text-foreground">Hands-on Coding</div>
                          <div className="text-[11px] text-muted-foreground">In-browser IDE with automated test execution</div>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md border border-border/30 shrink-0">
                        {codingCount} Challenge{codingCount > 1 ? "s" : ""}
                      </span>
                    </div>
                  )}

                  {behavioralCount > 0 && (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-background/50 border border-border/40 hover:border-border/60 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                          <AudioLines className="h-4.5 w-4.5 text-emerald-500" />
                        </div>
                        <div className="text-left">
                          <div className="text-xs font-bold text-foreground">Behavioral & Situational</div>
                          <div className="text-[11px] text-muted-foreground">Communication and collaboration scenarios</div>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md border border-border/30 shrink-0">
                        {behavioralCount} Q{behavioralCount > 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Mandatory Compliance Check */}
              <div 
                onClick={() => setComplianceAccepted(!complianceAccepted)}
                className={`p-4 rounded-xl border transition-all cursor-pointer select-none flex items-start gap-3.5 ${
                  complianceAccepted 
                    ? "bg-primary/5 border-primary/40 shadow-sm" 
                    : "bg-secondary/20 border-border/60 hover:border-border/90 hover:bg-secondary/30"
                }`}
              >
                <div className="pt-0.5 shrink-0">
                  <div className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all ${
                    complianceAccepted 
                      ? "bg-primary border-primary text-primary-foreground shadow-sm" 
                      : "border-slate-400 dark:border-slate-500 bg-white dark:bg-zinc-900 hover:border-primary"
                  }`}>
                    {complianceAccepted && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                  </div>
                </div>
                <div className="flex-1 text-left">
                  <span className="text-xs font-bold text-foreground block">
                    Environment &amp; Fullscreen Agreement
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                    I have closed all background applications, enabled "Do Not Disturb" mode, and agree to remain in fullscreen. Distractions or window switches will be recorded for evaluation audit.
                  </p>
                </div>
              </div>

              {/* Action Button */}
              <Button
                variant="hero"
                className="w-full h-11.5 rounded-xl text-sm font-bold shadow-md active:scale-[0.99] transition-all"
                onClick={handleStart}
                disabled={starting || !complianceAccepted}
              >
                {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {starting ? "Starting Environment..." : "Begin Assessment"}
                {!starting && <ArrowRight className="h-4 w-4 ml-2" />}
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (showSystemCheck) {
    const isVideoRequired = Boolean(
      interview?.save_video_recording ||
      interview?.show_candidate_video ||
      (interview?.proctoring_enabled !== undefined ? interview.proctoring_enabled : true)
    );
    return (
      <div className="h-[100dvh] w-full bg-background flex flex-col">
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-3 sm:p-4">
          <SystemCheck isVideoRequired={isVideoRequired} onComplete={handleSystemCheckComplete} />
        </div>
      </div>
    );
  }

  // ─── Phase Transition Splash Screen ───────────────────────────────────────────
  if (showPhaseSplash) {
    const cfg = phaseConfig[splashPhase];
    const PhaseIcon = cfg.icon;
    return (
      <div className="h-[100dvh] w-full bg-background flex flex-col">
        <div className="h-14 border-b border-border/50 bg-background/80 backdrop-blur-xl flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
              <Brain className="h-4 w-4 text-primary" />
            </div>
            <span className="text-base font-bold tracking-tight text-foreground">Scaloz AI</span>
          </div>
          <div className={`flex items-center gap-1.5 text-sm transition-colors ${isTimeLow() ? "text-amber-500" : ""}`}>
            <Clock className={`h-3.5 w-3.5 ${isTimeLow() ? "text-amber-500" : "text-primary"}`} />
            <span className="font-mono font-semibold text-xs">Time Left: {formatTimeRemaining()}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto flex items-center justify-center px-4 py-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", duration: 0.6 }}
            className="w-full max-w-md text-center"
          >
            <div className="card-elevated rounded-md border border-border/50 p-6 sm:p-10">
              {/* Phase ring animation */}
              <div className="relative mx-auto mb-6 sm:mb-8 w-20 h-20 sm:w-24 sm:h-24">
                <motion.div
                  className={`absolute inset-0 rounded-full ${cfg.bgColor} border-2 border-current ${cfg.color}`}
                  initial={{ scale: 0 }}
                  animate={{ scale: [0, 1.2, 1] }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <PhaseIcon className={`h-8 w-8 sm:h-10 sm:w-10 ${cfg.color}`} />
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className={`text-xs font-bold uppercase tracking-widest ${cfg.color} mb-2`}>
                  Phase {splashPhase} of 3
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-2 sm:mb-3">{cfg.label}</h2>
                <p className="text-sm text-muted-foreground mb-2">{cfg.description}</p>

                {splashPhase === 1 && (
                  <p className="text-xs text-muted-foreground/80 mb-4 sm:mb-6">
                    Technical questions will appear on screen. Read carefully and type your answers. No audio features in this round.
                  </p>
                )}
                {splashPhase === 2 && (
                  <p className="text-xs text-muted-foreground/80 mb-4 sm:mb-6">
                    Coding questions will be read aloud. Use the code editor to write your solution and run it.
                  </p>
                )}
                {splashPhase === 3 && (
                  <p className="text-xs text-muted-foreground/80 mb-4 sm:mb-6">
                    Behavioral questions will be read aloud. Use the microphone to speak your answers — they'll be transcribed automatically.
                  </p>
                )}
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                <Button variant="hero" className="w-full h-11 sm:h-12" onClick={handleDismissSplash}>
                  Continue to Phase {splashPhase}
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // ─── Phase Renderers ───────────────────────────────────────────────────────
  const renderActivePhase = () => {
    if (showCodingRound) {
      return (
        <div className="h-[100dvh] w-full bg-background flex flex-col">
          <div className="h-14 border-b border-border/50 bg-background/80 backdrop-blur-xl flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <Code2 className="h-4 w-4 text-primary" />
              </div>
              <span className="text-base font-bold tracking-tight text-foreground">Coding Assessment</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <div className={`flex items-center gap-1.5 text-sm transition-colors ${isTimeLow() ? "text-amber-500" : ""}`}>
                <Clock className={`h-3.5 w-3.5 ${isTimeLow() ? "text-amber-500" : "text-primary"}`} />
                <span className={`font-mono font-semibold text-xs ${isTimeLow() ? "text-amber-500" : ""}`}>Time Left: {formatTimeRemaining()}</span>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300">
                    Submit Test
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-zinc-950 border-zinc-800 shadow-2xl sm:max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-zinc-100 text-xl font-semibold tracking-tight">Submit your assessment?</AlertDialogTitle>
                    <AlertDialogDescription className="text-zinc-400 text-sm mt-2">
                      Are you sure you want to end the interview now?
                      Your current progress will be saved and submitted for evaluation.
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="mt-6 sm:space-x-4">
                    <AlertDialogCancel className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors h-10 px-4 py-2">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleSubmitInterview}
                      className="bg-red-500 hover:bg-red-600 text-white font-medium shadow-md transition-colors border-none h-10 px-4 py-2"
                    >
                      {submitting ? "Submitting..." : "Yes, Submit Test"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          {!isFullscreen && (
            <div
              onClick={enterFullscreen}
              className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-2 px-4 text-center cursor-pointer flex items-center justify-center gap-2 transition-all shadow-md shrink-0 z-50 animate-pulse select-none"
            >
              <Maximize className="h-4 w-4" />
              <span>Full Screen is required for proctoring. Click anywhere on this screen to enable Full Screen.</span>
            </div>
          )}
          <div className="flex-1 min-h-0">
            <ErrorBoundary>
              <CodingRound
                interviewId={interview.id}
                inviteToken={token!}
                onComplete={async (results) => {
                  setShowCodingRound(false);
                  await finalizeAndCompleteInterview();
                }}
              />
            </ErrorBoundary>
          </div>
        </div>
      );
    }

    if (useVoiceAgent) {
      return (
        <div className="h-[100dvh] w-full bg-background flex flex-col overflow-hidden select-none">
          {/* Minimalist Top Header */}
          <div className="h-14 sm:h-16 border-b border-slate-200 dark:border-white/[0.03] bg-white/80 dark:bg-black/20 backdrop-blur-2xl flex items-center justify-between px-4 sm:px-8 shrink-0 relative z-50 shadow-sm">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-md bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
                <Brain className="h-4 w-4 sm:h-5 sm:w-5 text-cyan-600 dark:text-cyan-500" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs sm:text-sm font-black uppercase tracking-[0.15em] sm:tracking-[0.3em] text-slate-800 dark:text-slate-100">AI Interviewer</span>
                <span className="text-[9px] sm:text-[10px] font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-widest mt-0.5 hidden sm:block">Session: {interview?.current_round || "Active"}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-8">
              {!isFullscreen && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={enterFullscreen}
                  className="hidden sm:flex h-9 border-cyan-300 dark:border-cyan-500/50 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 animate-pulse shadow-sm dark:shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                >
                  Go Fullscreen
                </Button>
              )}
              <div className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-full border transition-all ${isTimeLow()
                ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30"
                : "bg-slate-50 dark:bg-white/[0.03] border-slate-200 dark:border-border/50"
                }`}>
                <Clock className={`h-3 w-3 sm:h-3.5 sm:w-3.5 ${isTimeLow() ? "text-amber-500 dark:text-amber-400" : "text-cyan-600 dark:text-cyan-500"}`} />
                <span className={`font-mono font-bold text-[10px] sm:text-xs ${isTimeLow() ? "text-amber-600 dark:text-amber-400" : "text-slate-600 dark:text-slate-400"}`}>
                  <span className="hidden sm:inline">Time Left: </span>{formatTimeRemaining()}
                </span>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button className="h-8 sm:h-10 px-3 sm:px-6 rounded-md border border-slate-300 dark:border-white/10 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-foreground transition-all shadow-sm dark:shadow-lg active:scale-95 bg-white dark:bg-transparent">
                    <span className="hidden sm:inline">Submit Test</span>
                    <span className="sm:hidden">Submit</span>
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-white dark:bg-background border border-slate-200 dark:border-slate-800 backdrop-blur-3xl shadow-2xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-slate-900 dark:text-foreground">Finish &amp; Submit?</AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
                      You are about to submit your interview. The AI will evaluate your responses up to this point.
                      Do you want to proceed?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-400 hover:bg-slate-200">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleSubmitInterview}
                      className="bg-cyan-600 hover:bg-cyan-700 dark:hover:bg-cyan-500 text-white dark:text-foreground border-none shadow-[0_4px_14px_0_rgb(8,145,178,0.39)] dark:shadow-[0_0_20px_rgba(8,145,178,0.2)]"
                    >
                      {submitting ? "Submitting..." : "Confirm Submission"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          {!isFullscreen && (
            <div
              onClick={enterFullscreen}
              className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-2 px-4 text-center cursor-pointer flex items-center justify-center gap-2 transition-all shadow-md shrink-0 z-50 animate-pulse select-none"
            >
              <Maximize className="h-4 w-4" />
              <span>Full Screen is required for proctoring. Click anywhere on this screen to enable Full Screen.</span>
            </div>
          )}

          {/* Main Interview Area */}
          <div className="flex-1 relative overflow-hidden">
            <AnimatePresence>
              {showTwoMinBanner && (
                <motion.div
                  initial={{ opacity: 0, y: -20, x: "-50%" }}
                  animate={{ opacity: 1, y: 0, x: "-50%" }}
                  exit={{ opacity: 0, y: -20, x: "-50%" }}
                  className="absolute top-4 left-1/2 z-[60] w-[90%] max-w-md bg-card/95 backdrop-blur-xl border border-border shadow-lg rounded-xl p-4 flex items-start gap-3 pointer-events-auto"
                >
                  <div className="p-2 bg-amber-500/10 rounded-lg shrink-0 mt-0.5">
                    <Clock className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground text-sm">2 Minutes Remaining</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your assessment is nearing completion. Please begin wrapping up your response.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <ErrorBoundary>
              <VoiceInterviewAgent
                interviewId={interview.id}
                inviteToken={token!}
                jobRole={interview.job_role}
                candidateName={candidateName}
                initialRound={interview.current_round}
                isTimeUp={isGracePeriod}
                onAdvance={(next) => {
                  if (next === "coding") {
                    setUseVoiceAgent(false);
                    setShowCodingRound(true);
                    toast({ title: "🖥️ Switching to Coding Assessment..." });
                    if (token && interview?.id) {
                      updateInterviewStatus(interview.id, "in_progress", token, { current_round: "coding" }).catch(console.error);
                    }
                  } else {
                    toast({ title: `🎯 Moving to ${next} round...` });
                    if (token && interview?.id) {
                      updateInterviewStatus(interview.id, "in_progress", token, { current_round: next }).catch(console.error);
                    }
                  }
                }}
                onComplete={async () => {
                  await finalizeAndCompleteInterview();
                }}
              />
            </ErrorBoundary>
          </div>
        </div>
      );
    }

    if (!questions || questions.length === 0) {
      return (
        <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Initializing interview questions...</p>
        </div>
      );
    }

    if (!currentQ) {
      return (
        <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center space-y-4">
          <p className="text-muted-foreground">Question not found. Trying to recover...</p>
          <Button onClick={() => setCurrentIdx(0)}>Restart Interview</Button>
        </div>
      );
    }

    const isLastQuestion = currentIdx === questions.length - 1;
    const answeredCount = Object.keys(answers).length;
    const Icon = typeIcons[currentType] || Lightbulb;
    const phaseCfg = phaseConfig[currentPhase];
    const PhaseIcon = phaseCfg.icon;

    // Phase boundaries for progress visualization
    const total = questions.length;
    const p1End = questions.filter(q => q.question_type === "technical").length;
    const hasBehavioral = questions.some(q => q.question_type === "behavioral");

    return (
      <div className="h-[100dvh] w-full bg-background flex flex-col relative overflow-hidden">
        {/* Header */}
        <div className="h-16 border-b border-border/20 bg-background/60 backdrop-blur-2xl flex items-center justify-between px-6 shrink-0 z-50 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/30 glow-effect">
              <Brain className="h-5 w-5 text-cyan-500" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 hidden sm:block">Xevyte</span>
          </div>

          {/* Phase badge */}
          <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full ${phaseCfg.bgColor} border border-current/10 shadow-sm`}>
            <PhaseIcon className={`h-4 w-4 ${phaseCfg.color}`} />
            <span className={`text-[10px] font-bold uppercase tracking-wider ${phaseCfg.color}`}>Phase {currentPhase}: {phaseCfg.label}</span>
          </div>

          <div className="flex items-center gap-5">
            {!isFullscreen && (
              <Button
                variant="outline"
                size="sm"
                onClick={enterFullscreen}
                className="h-9 rounded-full border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10 hover:border-cyan-500/50 animate-pulse-glow"
              >
                Go Fullscreen
              </Button>
            )}
            <div className="flex items-center gap-3 hidden md:flex">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Question <span className="text-foreground">{currentIdx + 1}</span> / {questions.length}
              </div>
              <div className="h-4 w-px bg-border/50" />
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/50 border border-border/50">
                <Clock className="h-3.5 w-3.5 text-cyan-500" />
                <span className="font-mono font-bold text-xs">{formatTime(elapsed)}</span>
              </div>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 rounded-full border-red-500/30 text-red-500 hover:bg-red-500/10 hover:border-red-500/50 transition-colors">
                  Submit Test
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="glass-card border-border/20">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-xl">End Interview and Submit?</AlertDialogTitle>
                  <AlertDialogDescription className="text-sm">
                    This will end your assessment immediately. Any unanswered questions will be submitted as-is and cannot be changed later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-6">
                  <AlertDialogCancel className="bg-secondary/50 border-border/50 hover:bg-secondary">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleSubmitInterview}
                    className="bg-red-500 hover:bg-red-600 text-white font-bold"
                  >
                    Submit now
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {!isFullscreen && (
          <div
            onClick={enterFullscreen}
            className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-2 px-4 text-center cursor-pointer flex items-center justify-center gap-2 transition-all shadow-md shrink-0 z-50 animate-pulse select-none"
          >
            <Maximize className="h-4 w-4" />
            <span>Full Screen is required for proctoring. Click anywhere on this screen to enable Full Screen.</span>
          </div>
        )}

        {/* Multi-phase progress bar */}
        <div className="h-1.5 bg-secondary flex">
          {/* Phase 1 segment */}
          {p1End > 0 && (
            <div className="relative" style={{ width: hasBehavioral ? `${(p1End / total) * 100}%` : "100%" }}>
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{
                  width: currentIdx < p1End
                    ? `${((currentIdx + 1) / p1End) * 100}%`
                    : "100%",
                }}
              />
            </div>
          )}
          {p1End > 0 && hasBehavioral && <div className="w-px bg-border/80" />}
          {/* Phase 2 segment */}
          {hasBehavioral && (
            <div className="relative flex-1">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{
                  width: currentIdx >= p1End
                    ? `${((currentIdx - p1End + 1) / (total - p1End)) * 100}%`
                    : "0%",
                }}
              />
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Question panel */}
          <div className={`flex-1 flex flex-col min-h-0 ${currentType === "coding" ? "lg:w-1/2" : ""}`}>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <motion.div key={currentQ.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                {/* Question type + phase badge */}
                <div className="flex items-center gap-2 mb-4">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {typeLabels[currentType]} • {currentQ.difficulty}
                  </span>
                </div>

                {/* Question text */}
                <h3 className="text-lg font-semibold text-foreground mb-6 leading-relaxed flex items-start gap-3">
                  <span className="flex-1">{currentQ.question_text}</span>
                  {/* TTS button — only in Phase 2 */}
                  {(currentPhase === 2) && (
                    <button
                      onClick={() => isSpeaking ? stopSpeaking() : speakQuestion(currentQ.question_text)}
                      className={`shrink-0 p-2 rounded-md transition-colors ${isSpeaking ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-white"}`}
                      title={isSpeaking ? "Stop reading" : "Read aloud"}
                    >
                      {isSpeaking
                        ? <VolumeX className={`h-5 w-5 animate-pulse`} />
                        : <Volume2 className="h-5 w-5" />}
                    </button>
                  )}
                </h3>

                {/* Phase-specific hint */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-md ${phaseCfg.bgColor} mb-4`}>
                  <PhaseIcon className={`h-4 w-4 ${phaseCfg.color}`} />
                  <span className={`text-xs font-medium ${phaseCfg.color}`}>{phaseCfg.description}</span>
                </div>

                {/* Answer area for non-coding questions */}
                {currentType !== "coding" && currentPhase === 1 && (
                  <div className="relative group">
                    <textarea
                      value={answers[currentQ.id] || ""}
                      onChange={(e) => handleAnswerChange(e.target.value)}
                      placeholder="Type your answer here..."
                      rows={8}
                      className="w-full rounded-md bg-secondary border border-border/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                    />
                  </div>
                )}

                {/* ─── Phase 2: Voice Interview UI ─── */}
                {currentType !== "coding" && currentPhase === 2 && (
                  <div className="flex flex-col items-center">
                    {/* Microphone area */}
                    <div className="relative flex items-center justify-center my-4">
                      {/* Outer pulsing rings when recording */}
                      {isListening && (
                        <>
                          <motion.div
                            className="absolute w-32 h-32 sm:w-44 sm:h-44 rounded-full border-2 border-emerald-400/20"
                            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                          />
                          <motion.div
                            className="absolute w-24 h-24 sm:w-36 sm:h-36 rounded-full border-2 border-emerald-400/30"
                            animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0.1, 0.6] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                          />
                          <motion.div
                            className="absolute w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-emerald-500/10"
                            animate={{ scale: [1, 1.15, 1] }}
                            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                          />
                        </>
                      )}

                      {/* Main mic button */}
                      {isSpeaking ? (
                        <div className="relative z-10 w-24 h-24 rounded-full bg-secondary/30 border border-border/50 flex items-center justify-center text-muted-foreground shadow-sm">
                          <Volume2 className="h-10 w-10 animate-pulse text-cyan-500" />
                        </div>
                      ) : (
                        <button
                          onClick={toggleListening}
                          className={`relative z-10 w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isListening
                            ? "bg-gradient-to-br from-red-500 to-red-600 text-foreground shadow-2xl shadow-red-500/30 scale-110"
                            : "bg-gradient-to-br from-emerald-500 to-emerald-600 text-foreground shadow-xl shadow-emerald-500/20 hover:shadow-2xl hover:shadow-emerald-500/30 hover:scale-105"
                            }`}
                        >
                          {isListening ? (
                            <MicOff className="h-8 w-8 sm:h-10 sm:w-10" />
                          ) : (
                            <Mic className="h-8 w-8 sm:h-10 sm:w-10" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Status text & timer */}
                    <div className="text-center mb-4">
                      {isSpeaking ? (
                        <div className="flex flex-col items-center gap-1">
                          <p className="text-sm text-cyan-500 font-semibold animate-pulse">Interviewer is speaking...</p>
                          <p className="text-[10px] text-muted-foreground">Please listen carefully to the question</p>
                        </div>
                      ) : isListening ? (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <div className="flex items-center justify-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-sm font-semibold text-red-400">Recording</span>
                            <span className="font-mono text-sm text-red-400/80">
                              {Math.floor(voiceSeconds / 60)}:{String(voiceSeconds % 60).padStart(2, "0")}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">Speak clearly — tap the button when you're done</p>
                        </motion.div>
                      ) : (
                        <div>
                          {answers[currentQ.id] ? (
                            <p className="text-sm text-emerald-400 font-medium">✓ Answer recorded — tap mic to re-record</p>
                          ) : (
                            <p className="text-sm text-muted-foreground">Tap the microphone and speak your answer</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Audio waveform bars when listening */}
                    {isListening && (
                      <div className="flex items-end justify-center gap-1 h-8 mb-4">
                        {Array.from({ length: 20 }).map((_, i) => (
                          <motion.div
                            key={i}
                            className="w-1 rounded-full bg-emerald-400"
                            animate={{
                              height: [4, Math.random() * 28 + 4, 4],
                            }}
                            transition={{
                              duration: 0.4 + Math.random() * 0.4,
                              repeat: Infinity,
                              delay: i * 0.05,
                              ease: "easeInOut",
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {/* Live transcript */}
                    {(answers[currentQ.id] || isListening) && (
                      <div className="w-full mt-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              {isListening ? "Live Transcript" : "Your Answer"}
                            </span>
                            {isListening && (
                              <span className="flex gap-0.5">
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                              </span>
                            )}
                          </div>
                          {!isListening && answers[currentQ.id] && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setShowTranscriptEditor(!showTranscriptEditor)}
                                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                              >
                                <Pencil className="h-3 w-3" />
                                {showTranscriptEditor ? "Done editing" : "Edit transcript"}
                              </button>
                              <button
                                onClick={() => { handleAnswerChange(""); setShowTranscriptEditor(false); }}
                                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Clear and re-record"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Clear
                              </button>
                            </div>
                          )}
                        </div>

                        {showTranscriptEditor && !isListening ? (
                          <textarea
                            value={answers[currentQ.id] || ""}
                            onChange={(e) => handleAnswerChange(e.target.value)}
                            rows={5}
                            className="w-full rounded-md bg-secondary border border-emerald-500/30 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none"
                            placeholder="Edit your transcribed answer..."
                          />
                        ) : (
                          <div className={`w-full rounded-md border px-4 py-3 text-sm leading-relaxed min-h-[80px] max-h-[200px] overflow-y-auto ${isListening
                            ? "bg-emerald-500/5 border-emerald-500/20 text-foreground"
                            : "bg-secondary/50 border-border/50 text-foreground/90"
                            }`}>
                            {answers[currentQ.id] || (
                              <span className="text-muted-foreground italic">Waiting for your voice...</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Empty state — no answer yet and not listening */}
                    {!answers[currentQ.id] && !isListening && (
                      <div className="w-full mt-4 rounded-md border border-dashed border-border/50 bg-secondary/20 px-6 py-8 text-center">
                        <AudioLines className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">No answer recorded yet</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Tap the green microphone button above to start speaking</p>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </div>

            {/* Navigation */}
            <div className="p-4 border-t border-border/50 flex items-center justify-between">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { stopSpeaking(); stopListening(); setCurrentIdx(Math.max(0, currentIdx - 1)); setCodeContent(""); setCodeOutput(""); }}
                disabled={currentIdx === 0}
              >
                Previous
              </Button>

              <div className="flex gap-2">
                {!isLastQuestion ? (
                  <Button variant="hero" size="sm" onClick={handleSaveAndNext} disabled={submittingNext}>
                    {submittingNext ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        Saving...
                      </>
                    ) : (
                      <>
                        Save & Next <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </>
                    )}
                  </Button>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="hero" size="sm" disabled={submitting}>
                        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                        Submit Assessment
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-white dark:bg-background border border-slate-200 dark:border-slate-800 backdrop-blur-3xl shadow-2xl">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-slate-900 dark:text-foreground">Submit Assessment?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
                          You are about to submit your interview. The AI will evaluate your responses up to this point.
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-400 hover:bg-slate-200">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleSubmitInterview}
                          className="bg-cyan-600 hover:bg-cyan-700 dark:hover:bg-cyan-500 text-white dark:text-foreground border-none shadow-[0_4px_14px_0_rgb(8,145,178,0.39)]"
                        >
                          {submitting ? "Submitting..." : "Confirm Submission"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          </div>

          {/* Code Editor (for coding questions) */}
          {currentType === "coding" && (
            <div className="lg:w-1/2 flex flex-col border-l border-border/50 min-h-0">
              <div className="flex items-center justify-between p-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Code Editor</span>
                </div>
                {/* Language Badge */}
                <div className="h-7 flex items-center justify-center rounded bg-secondary border border-border/50 px-3 text-xs font-semibold text-foreground">
                  Python
                </div>
              </div>

              <textarea
                value={codeContent}
                onChange={(e) => setCodeContent(e.target.value)}
                className="flex-1 p-4 bg-background font-mono text-sm text-foreground resize-none focus:outline-none min-h-[300px]"
                placeholder="// Write your solution here..."
                spellCheck={false}
              />

              {codeOutput && (
                <div className="p-3 border-t border-border/50 bg-secondary/30 max-h-32 overflow-y-auto">
                  <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">{codeOutput}</pre>
                </div>
              )}

              <div className="flex items-center gap-2 p-3 border-t border-border/50">
                <Button variant="hero" size="sm" onClick={handleRunCode} disabled={runningCode}>
                  {runningCode ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  Run Code
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }; // <-- Close renderActivePhase 

  // ─── Main Return Block ───────────────────────────────────────────────────────

  return (
    <>
      {/* 🔑 Single CameraMonitor instance — always mounted, never unmounted between states.
           Keeping it alive is critical: it holds the MediaRecorder, the S3 uploadId,
           and all pending part-upload promises. Unmounting it was the original bug. */}
      {interview?.id && !submitted && (
        <div className={isUploading ? "hidden" : ""}>
          <CameraMonitor
            ref={cameraRef}
            interviewId={interview.id}
            inviteToken={token!}
            isRecording={!!isInterviewActive}
            onUploadComplete={handleUploadComplete}
            initialStrikes={interview.proctoring_strikes}
            saveVideoRecording={interview.save_video_recording}
            showCandidateVideo={interview.show_candidate_video}
            proctoringEnabled={interview.proctoring_enabled !== undefined ? interview.proctoring_enabled : true}
            proctoringMaxStrikes={interview.proctoring_max_strikes !== undefined ? interview.proctoring_max_strikes : 3}
            proctoringMaxStrikesAction={interview.proctoring_max_strikes_action || "flag_review"}
            onViolation={async (msg) => {
              if (isTerminatingRef.current) return;
              isTerminatingRef.current = true;
              
              console.log("[CandidateInterview] Proctoring violation detected:", msg);
              toast({ title: "Interview Terminated", description: msg, variant: "destructive" });

              // 1. Locally mark the termination reason
              setTerminationReason(msg);

              // 2. Mark in DB as flagged immediately (so recruiter sees it even if upload fails)
              try {
                if (currentQ) {
                  const answer = currentType === "coding" ? codeContent : (answers[currentQ.id] || "");
                  if (answer.trim()) {
                    await submitCandidateAnswer(token!, currentQ.id, answer).catch(e => console.warn(e));
                  }
                }
                await updateInterviewStatus(interview.id, "flagged", token!);
                await submitInterviewForScoring(interview.id, token!).catch(e => console.warn(e));
              } catch (e) {
                console.error("[Violation] Failed to update status to flagged:", e);
              }

              // 3. Trigger the standard finalization pipeline
              setIsUploading(true);

              if (cameraRef.current) {
                console.log("[Violation] Awaiting terminal stopAndFinalize()...");
                try {
                  // This ensures the video evidence of the violation is saved to S3
                  await cameraRef.current.stopAndFinalize();
                } catch (e) {
                  console.error("[Violation] terminal stopAndFinalize failed:", e);
                  handleUploadComplete(); // Ensure we still transition to the 'Submitted' state
                }
              } else {
                handleUploadComplete();
              }
            }}
          />
        </div>
      )}

      {/* Saving overlay — shown over the top while CameraMonitor finalizes in background */}
      {isUploading && (
        <div className="fixed inset-0 z-[2000] bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
          {/* Background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-full max-h-[800px] pointer-events-none opacity-50">
            <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-cyan-500/20 rounded-full blur-[80px] animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-600/20 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="text-center space-y-6 max-w-lg w-full relative z-10"
          >
            <div className="relative">
              <div className="h-24 w-24 rounded-full bg-gradient-to-br from-cyan-400/20 to-blue-500/20 flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(6,182,212,0.2)] border border-cyan-500/30">
                <CheckCircle2 className="h-12 w-12 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
              </div>
              <h2 className="text-4xl font-bold tracking-tight mb-3">Interview Completed!</h2>
              <p className="text-lg text-muted-foreground italic max-w-md mx-auto">"Quality is not an act, it is a habit."</p>
            </div>

            <div className="glass-card p-8 text-left space-y-6 shadow-2xl relative overflow-hidden">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Thank you for your time, <span className="text-foreground font-semibold">{candidateName}</span>.
                Your responses have been securely submitted to our specialized hiring panel.
              </p>

              <div className="space-y-5 pt-5 border-t border-border/30">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-foreground flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-cyan-500" />
                  What happens next?
                </h4>
                <ul className="text-sm space-y-4 text-muted-foreground">
                  <li className="flex gap-3">
                    <div className="h-5 w-5 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-cyan-500/20">
                      <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                    </div>
                    <span className="leading-relaxed">Our engine is synthesizing your competency profile and technical insights.</span>
                  </li>
                  <li className="flex gap-3">
                    <div className="h-5 w-5 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-cyan-500/20">
                      <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                    </div>
                    <span className="leading-relaxed">Hiring leads will review the generated evaluation alongside your session transcript.</span>
                  </li>
                  <li className="flex gap-3">
                    <div className="h-5 w-5 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-cyan-500/20">
                      <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                    </div>
                    <span className="leading-relaxed">You will receive a formal update regarding your candidacy within 3-5 business days.</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-8 flex flex-col items-center justify-center space-y-3">
               <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
               <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                 {terminationReason ? "Finalizing violation report..." : "Finalizing video upload. Do not close."}
               </p>
            </div>
          </motion.div>
        </div>
      )}

      {/* Active interview screens — hidden (not unmounted) while uploading */}
      {!isUploading && renderActivePhase()}

      {/* Hidden mount point for external proctoring/ticketing scripts (embed.js) */}
      <div id="proctoring-mount-point" className="hidden pointer-events-none" aria-hidden="true" />
    </>
  );
}
// Sub-components...
function SystemCheck({ onComplete, isVideoRequired = true }: { onComplete: () => void; isVideoRequired?: boolean }) {
  const [step, setStep] = useState<'permissions' | 'audio-test' | 'done'>('permissions');
  const [micState, setMicState] = useState<'pending' | 'success' | 'warning'>('pending');
  const [camState, setCamState] = useState<'pending' | 'success' | 'warning'>('pending');
  const [internetState, setInternetState] = useState<'pending' | 'success'>('pending');
  const [checksComplete, setChecksComplete] = useState(false);

  // Audio Test States
  const [micLevel, setMicLevel] = useState(0);
  const [testTranscript, setTestTranscript] = useState("");
  const [isTestRecording, setIsTestRecording] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);

  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const testMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const testAudioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (step === 'permissions') {
      const runCheck = async () => {
        setTimeout(() => setInternetState('success'), 600);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setMicState('success');
          stream.getTracks().forEach(t => t.stop());
        } catch {
          setMicState('warning');
        }
        if (isVideoRequired) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            setCamState('success');
            stream.getTracks().forEach(t => t.stop());
          } catch {
            setCamState('warning');
          }
        } else {
          setCamState('success');
        }
        setTimeout(() => setChecksComplete(true), 800);
      };
      runCheck();
    }
  }, [step, isVideoRequired]);

  const stopAudioVisualizer = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(t => t.stop());
      } catch (_) { }
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (_) { }
      audioContextRef.current = null;
    }
    analyzerRef.current = null;
    setMicLevel(0);
  };

  const startAudioVisualizer = async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);
      analyzerRef.current = analyzer;

      const bufferLength = analyzer.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!analyzerRef.current) return;
        analyzerRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        setMicLevel(average);
        animationRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (err) {
      console.error("Failed to start audio visualizer", err);
    }
  };

  const startAudioTest = async () => {
    setStep('audio-test');
    await startAudioVisualizer();
  };

  const toggleTestRecording = async () => {
    if (isTestRecording) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) { }
        recognitionRef.current = null;
      }
      setIsTestRecording(false);
    } else {
      if (recognitionRef.current) return;

      // Ensure visualizer stream is running
      await startAudioVisualizer();
      if (!streamRef.current) {
        setTestTranscript("Microphone stream is not active. Please check permissions.");
        return;
      }

      setTestTranscript("Recording... Please say: 'I am ready for my interview today.'");
      
      const SpeechRec = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRec) {
        setTestTranscript("Speech recognition is not supported in this browser.");
        return;
      }

      try {
        const recognition = new SpeechRec();
        recognition.lang = "en-US";
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onstart = () => {
          setIsTestRecording(true);
        };

        recognition.onresult = (event: any) => {
          let transcript = "";
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setTestTranscript(transcript);
          
          if (transcript.trim().length > 3) {
            setTestSuccess(true);
            try { recognition.stop(); } catch (_) { }
          }
        };

        recognition.onerror = (event: any) => {
          console.error("Test speech recognition error:", event.error);
          if (event.error !== 'aborted') {
            setTestTranscript(`Transcription failed: ${event.error}. Please try again.`);
          }
          setIsTestRecording(false);
          recognitionRef.current = null;
        };

        recognition.onend = () => {
          setIsTestRecording(false);
          if (recognitionRef.current === recognition) {
            recognitionRef.current = null;
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err: any) {
        console.error("Failed to start speech recognition", err);
        setTestTranscript(`Failed to start recording: ${err.message || err}`);
        recognitionRef.current = null;
      }
    }
  };

  const cleanupAudio = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) { }
      recognitionRef.current = null;
    }
    stopAudioVisualizer();
    setStep('done');
  };

  // Cleanup speech resources on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) { }
      }
      stopAudioVisualizer();
    };
  }, []);

  if (step === 'permissions') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card-elevated rounded-xl border border-border/50 p-4 sm:p-6 lg:p-8 max-w-md w-full text-center space-y-4 sm:space-y-6 shadow-2xl bg-background/50 backdrop-blur-2xl"
      >
        <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <ShieldCheck className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
        </div>
        <div className="space-y-1 sm:space-y-2">
          <h3 className="text-lg sm:text-xl font-bold tracking-tight">System Check</h3>
          <p className="text-xs sm:text-sm text-muted-foreground">We need these permissions for the AI interview.</p>
        </div>

        <div className="space-y-2 sm:space-y-3 text-left">
          <CheckItem icon={Wifi} label="Network" state={internetState === 'success' ? 'success' : 'pending'} optional={false} />
          <CheckItem icon={Mic} label="Microphone" state={micState} optional={false} />
          {isVideoRequired && (
            <CheckItem icon={Video} label="Environmental Camera" state={camState} optional={false} />
          )}

          <div className="p-3 sm:p-4 rounded-md bg-amber-500/5 border border-amber-500/20 mt-2 sm:mt-4">
            <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
              <AlertCircle className="h-4 w-4 text-amber-400" />
              <span className="text-xs sm:text-sm font-bold text-amber-400">Distraction-Free Mode</span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground leading-relaxed">
              Please enable <strong>"Do Not Disturb"</strong> or <strong>"Focus Mode"</strong> and close all other applications.
              Interacting with notifications will be flagged as a violation.
            </p>
          </div>
        </div>

        <Button
          variant="hero"
          className="w-full h-10 sm:h-12"
          onClick={startAudioTest}
          disabled={!checksComplete || micState === 'warning'}
        >
          {!checksComplete ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Checking...</>
          ) : micState === 'warning' ? (
            <>Microphone Required — Check Browser Permissions</>
          ) : (
            <>Next: Voice Quality Test<ArrowRight className="h-4 w-4 ml-2" /></>
          )}
        </Button>

        {micState === 'warning' && (
          <Button
            variant="outline"
            className="w-full h-10 sm:h-12 border-amber-500/50 text-amber-500 hover:bg-amber-500/10 dark:hover:bg-amber-500/5 transition-all font-bold mt-2"
            onClick={() => {
              setStep('done');
            }}
          >
            ⚠️ Bypass System Check (Local Dev / HTTP)
          </Button>
        )}
      </motion.div>
    );
  }

  if (step === 'audio-test') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-elevated rounded-xl border border-border/50 p-4 sm:p-6 lg:p-8 max-w-md w-full text-center space-y-4 sm:space-y-6 shadow-2xl bg-background/50 backdrop-blur-2xl"
      >
        <div className="space-y-1 sm:space-y-2">
          <h3 className="text-lg sm:text-xl font-bold tracking-tight">Voice Reality Check</h3>
          <p className="text-xs sm:text-sm text-muted-foreground">Speak clearly to verify transcription quality.</p>
        </div>

        {/* Dynamic Volume Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Input Level</span>
            <span className={micLevel > 10 ? "text-emerald-400" : ""}>{micLevel > 10 ? "Signal Detected" : "Silence"}</span>
          </div>
          <div className="h-3 sm:h-4 w-full bg-secondary/50 rounded-full overflow-hidden border border-border/30">
            <motion.div
              className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500"
              animate={{ width: `${Math.min(100, (micLevel / 100) * 100)}%` }}
              transition={{ type: "spring", bounce: 0, duration: 0.1 }}
            />
          </div>
        </div>

        {/* Test Recording UI */}
        <div className="bg-secondary/30 rounded-md p-4 sm:p-6 border border-border/50 space-y-3 sm:space-y-4">
          <p className="text-xs text-muted-foreground">Say: <strong className="text-foreground">"I am ready for my interview today."</strong></p>

          <button
            onClick={toggleTestRecording}
            className={`w-full py-2.5 sm:py-3 rounded-md font-bold flex items-center justify-center gap-2 transition-all text-sm ${isTestRecording
              ? "bg-red-500/20 text-red-500 border border-red-500/50"
              : "bg-emerald-500 text-foreground shadow-lg shadow-emerald-500/20"
              }`}
          >
            {isTestRecording ? (
              <><div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> Stop Recording</>
            ) : (
              <><Mic className="h-4 w-4" /> Start Mic Test</>
            )}
          </button>

          <AnimatePresence mode="wait">
            {testTranscript ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="text-sm font-medium text-emerald-400 italic bg-background/50 p-3 rounded-md border border-emerald-500/10"
              >
                "{testTranscript}"
              </motion.div>
            ) : isTestRecording && (
              <p className="text-[10px] text-muted-foreground animate-pulse">Listening for your voice...</p>
            )}
          </AnimatePresence>
        </div>

        <Button
          variant="hero"
          className="w-full h-10 sm:h-12"
          onClick={cleanupAudio}
          disabled={!testSuccess}
        >
          {testSuccess ? "Everything Looks Good!" : "Testing Transcription..."}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>

        <Button
          variant="ghost"
          className="w-full h-10 sm:h-12 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all font-medium text-xs sm:text-sm mt-2"
          onClick={() => {
            setTestSuccess(true);
            setTestTranscript("Speech recognition test bypassed. You will be able to type your responses during the interview.");
            cleanupAudio();
          }}
        >
          Having trouble? Skip Voice Check
        </Button>
        <p className="text-[10px] text-muted-foreground">Can't see your words? Check your microphone selection.</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="card-elevated rounded-xl border border-border/50 p-6 sm:p-8 max-w-md w-full text-center space-y-4 sm:space-y-6"
    >
      <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
        <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10 text-emerald-400" />
      </div>
      <div className="space-y-2">
        <h3 className="text-xl sm:text-2xl font-bold">You're All Set!</h3>
        <p className="text-xs sm:text-sm text-muted-foreground">Environmental checks passed. The AI interviewer is ready for you.</p>
      </div>
      <Button
        variant="hero"
        className="w-full h-10 sm:h-12 shadow-xl shadow-primary/20"
        onClick={() => {
          requestAppFullscreen();
          onComplete();
        }}
      >
        Start Interview Now
        <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </motion.div>
  );
}

function CheckItem({ icon: Icon, label, state, optional }: { icon: any, label: string, state: 'pending' | 'success' | 'warning', optional?: boolean }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-md bg-secondary/40 border border-border/50">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-md ${state === 'warning' ? 'bg-amber-500/10' : 'bg-primary/10'}`}>
          <Icon className={`h-4 w-4 ${state === 'warning' ? 'text-amber-400' : 'text-primary'}`} />
        </div>
        <div>
          <span className="text-sm font-medium">{label}</span>
          {optional && <span className="text-[10px] text-muted-foreground ml-2">(optional)</span>}
        </div>
      </div>
      {state === 'pending'
        ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        : state === 'success'
          ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 drop-shadow-sm" strokeWidth={3} />
          : <div className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
            <AlertCircle className="h-3.5 w-3.5" />
            {optional ? "Not found" : "Unavailable"}
          </div>
      }
    </div>
  );
}
