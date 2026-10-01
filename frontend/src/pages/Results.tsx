import { useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, CheckCircle2, AlertTriangle, Brain,
  MessageSquare, Heart, Shield, Loader2, 
  Activity, Clock, ChevronLeft, ChevronRight,
  Code2, Play, Video, X, Sliders,
  User, Briefcase, Calendar, ShieldCheck, Maximize2,
  Terminal, RotateCcw
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { 
  RadialBarChart, RadialBar, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell 
} from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/backend/client";
import { 
  getInterviewMessages, getCodingQuestions, getCodeSubmissions,
  getRecruiterInterviewRecording, BASE, submitInterviewForScoring
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { exportResultsPDF } from "@/lib/pdf-export";

export default function Results() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const interviewId = searchParams.get("id");
  const { toast } = useToast();
  const isReportOnly = sessionStorage.getItem("is_sso_report_only") === "true";

  const [interview, setInterview] = useState<any>(null);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [interviewQuestions, setInterviewQuestions] = useState<any[]>([]);
  const [codingQuestions, setCodingQuestions] = useState<any[]>([]);
  const [codeSubmissions, setCodeSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState(0);
  const isMounted = useRef(true);
  const pollCountRef = useRef(0);

  // Video State
  const [showRecording, setShowRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [secureVideoUrl, setSecureVideoUrl] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isScoringTriggered, setIsScoringTriggered] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [activeScoreMetricId, setActiveScoreMetricId] = useState<string>("overall");
  const [showIdPhotoZoom, setShowIdPhotoZoom] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  useEffect(() => {
    const fetchSecureUrl = async () => {
      if (!videoUrl) {
        setSecureVideoUrl("");
        return;
      }

      const fetchAsBlob = async (url: string) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("Failed to fetch video");
          const blob = await res.blob();
          setSecureVideoUrl(URL.createObjectURL(blob));
        } catch (e) {
          console.error("Failed to load video as blob", e);
          setSecureVideoUrl(url); // Fallback
        }
      };

      // Check if already a presigned URL to prevent double-signing
      if (videoUrl.startsWith('http') && (videoUrl.toLowerCase().includes('signature=') || 
videoUrl.toLowerCase().includes('x-amz-signature='))) {
        fetchAsBlob(videoUrl);
        return;
      }
      // If it's a local storage file (starts with / or contains /uploads/), just play it normally
      if (videoUrl.startsWith('/') || videoUrl.includes('/uploads/')) {
        if (videoUrl.startsWith('http')) {
          fetchAsBlob(videoUrl);
        } else {
          const BASE_URL = import.meta.env.VITE_API_BASE_URL 
            ? import.meta.env.VITE_API_BASE_URL.replace(/\/api$/, '') 
            : "http://localhost:8000";
          fetchAsBlob(`${BASE_URL}${videoUrl}`);
        }
        return;
      }
      try {
        let API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || "/api";
        if (API_URL && !API_URL.startsWith("/") && !API_URL.startsWith("http")) API_URL = `/${API_URL}`;
        const token = localStorage.getItem("xeviewer_token");
        
        const response = await fetch(`${API_URL}/rest/v1/interviews/vip-pass`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ s3_url: videoUrl })
        });
        if (response.ok) {
          const data = await response.json();
          fetchAsBlob(data.presigned_url);
        } else {
          console.error("Backend refused to generate VIP pass.");
        }
      } catch (error) {
        console.error("Failed to connect to backend for VIP pass:", error);
      }
    };
    fetchSecureUrl();
  }, [videoUrl]);

  const handleViewRecording = async () => {
    if (!interviewId) return;
    try {
      const res = await getRecruiterInterviewRecording(interviewId);
      let url = res.video_url;
      if (url && url.startsWith('/uploads/')) {
        const serverUrl = BASE.replace(/\/api$/, "");
        url = `${serverUrl}${url}`;
      }
      setVideoUrl(url);
      setShowRecording(true);
    } catch (err) {
      toast({ title: "Error", description: "Could not load recording", variant: "destructive" });
    }
  };

  const [isDownloadingRecording, setIsDownloadingRecording] = useState(false);

  const handleDownloadRecording = async () => {
    if (!interviewId) return;
    try {
      setIsDownloadingRecording(true);
      const safeName = (interview?.candidate_name || 'Candidate').replace(/[^a-zA-Z0-9_-]/g, '_');
      const defaultFilename = `Interview_Recording_${safeName}_${interviewId.substring(0, 8)}.webm`;

      // Always fetch directly from backend streaming download endpoint (ensures webm_fixer seekable duration & cues)
      if (interviewId) {
        const token = localStorage.getItem("xeviewer_token") || "";
        const apiUrl = BASE.replace(/\/api$/, "");
        const downloadEndpoint = `${apiUrl}/api/recruiter/interview/${interviewId}/recording/download`;

        try {
          const res = await fetch(downloadEndpoint, {
            cache: 'no-store',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
          if (res.ok) {
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = defaultFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            toast({ title: "Download Completed", description: `Saved as ${defaultFilename}` });
            return;
          }
        } catch (fetchErr) {
          console.warn("Backend stream download failed, falling back to direct browser link:", fetchErr);
        }

        // Direct browser navigation download (server sends Content-Disposition: attachment)
        const downloadUrlWithToken = `${downloadEndpoint}?token=${encodeURIComponent(token)}`;
        const a = document.createElement('a');
        a.href = downloadUrlWithToken;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast({ title: "Download Started", description: "Browser download initiated." });
        return;
      }

      // 3. Fallback if interviewId missing but videoUrl exists directly
      if (videoUrl) {
        try {
          const res = await fetch(videoUrl);
          if (res.ok) {
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = defaultFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            toast({ title: "Download Completed", description: `Saved as ${defaultFilename}` });
            return;
          }
        } catch (_) {}

        window.open(videoUrl, '_blank');
      }
    } catch (err: any) {
      console.error("Failed to download recording:", err);
      toast({ title: "Download Failed", description: err.message || "Could not download recording", variant: "destructive" });
    } finally {
      setIsDownloadingRecording(false);
    }
  };


  // Build structured transcript items once (combining messages, evaluated interview questions, and coding questions)
  const transcriptItems = useMemo(() => {
    const items: any[] = [];
    const seenQuestionIds = new Set<string>();

    // 1. Parse Q&A pairs directly from chat messages to capture all conversation turns & follow-ups
    if (messages.length > 0) {
      let exchangeIndex = 1;
      let currentQid: string | null = null;
      let qIndex = 0;
      let currentCategory: "technical" | "behavioral" | "coding" = "technical";

      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === "ai" || messages[i].role === "assistant") {
          const isIntro = messages[i].metadata?.is_intro || messages[i].metadata?.agent_metadata?.focusing_on === "intro";
          const qid = messages[i].question_id;
          const isFollowUp = (qid !== null && qid !== undefined) && (qid === currentQid) && !isIntro;

          if (qid) seenQuestionIds.add(qid);

          // Fetch ai_feedback & ai_score for this specific question from interviewQuestions
          const qObj = qid ? interviewQuestions.find((q: any) => q.id === qid) : null;

          if (!isFollowUp) {
            if (!isIntro) {
              currentQid = qid;
              qIndex++;
            }
            exchangeIndex = 1;

            // Determine category for base question
            if (isIntro) {
              currentCategory = "behavioral";
            } else if (qObj?.question_type) {
              const qt = qObj.question_type.toLowerCase();
              if (qt.includes("behav")) currentCategory = "behavioral";
              else if (qt.includes("cod")) currentCategory = "coding";
              else currentCategory = "technical";
            } else if (messages[i].round) {
              const mr = messages[i].round.toLowerCase();
              if (mr.includes("behav")) currentCategory = "behavioral";
              else if (mr.includes("cod")) currentCategory = "coding";
              else currentCategory = "technical";
            } else {
              currentCategory = "technical";
            }
          } else {
            exchangeIndex++;
          }

          const userMsg = (messages[i + 1]?.role === "user") ? messages[i + 1] : null;

          let labelStr = "";
          if (isIntro) {
            labelStr = "Introduction";
          } else if (isFollowUp) {
            labelStr = `Follow-up ${exchangeIndex - 1} — Question ${qIndex}`;
          } else {
            const roundType = (qObj?.question_type || messages[i].round || currentCategory || "technical");
            labelStr = `Question ${qIndex} — ${roundType.charAt(0).toUpperCase() + roundType.slice(1)}`;
          }

          const feedback = qObj?.ai_feedback || null;
          const score = qObj?.ai_score !== undefined && qObj?.ai_score !== null ? qObj.ai_score : null;

          items.push({
            type: "qa",
            category: currentCategory,
            label: labelStr,
            question: messages[i].content,
            answer: userMsg?.content || "(No response)",
            ai_feedback: feedback,
            score: score,
            question_id: qid,
          });

          if (userMsg) i++;
        }
      }
    }

    // 2. Append any evaluated questions from interviewQuestions that were NOT in messages
    if (interviewQuestions.length > 0) {
      interviewQuestions.forEach((q: any, idx: number) => {
        if (!seenQuestionIds.has(q.id)) {
          const roundType = q.question_type || "technical";
          const labelStr = `Question ${idx + 1} — ${roundType.charAt(0).toUpperCase() + roundType.slice(1)}${messages.length > 0 ? " (Unanswered)" : ""}`;
          
          let cat: "technical" | "behavioral" | "coding" = "technical";
          const qt = (q.question_type || "").toLowerCase();
          if (qt.includes("behav")) cat = "behavioral";
          else if (qt.includes("cod")) cat = "coding";
          else cat = "technical";

          items.push({
            type: "qa",
            category: cat,
            label: labelStr,
            question: q.question_text,
            answer: q.candidate_answer || "(No response)",
            ai_feedback: q.ai_feedback || null,
            score: q.ai_score !== undefined && q.ai_score !== null ? q.ai_score : null,
            question_id: q.id,
          });
        }
      });
    }

    // 3. Parse Coding Challenge items
    codingQuestions.forEach((q: any, idx: number) => {
      const submission = codeSubmissions.find((s: any) => s.question_id === q.id);
      items.push({
        type: "coding",
        category: "coding",
        label: `Coding Challenge ${idx + 1} — ${q.title}`,
        question: q.description,
        difficulty: q.difficulty || "medium",
        submission: submission,
      });
    });

    return items;
  }, [messages, interviewQuestions, codingQuestions, codeSubmissions]);

  // Helper to reliably retrieve category for any transcript item
  const getItemCategory = (item: any): "technical" | "behavioral" | "coding" => {
    if (item.category) return item.category;
    if (item.type === "coding") return "coding";
    const label = (item.label || "").toLowerCase();
    if (label.includes("behav") || label.includes("intro")) return "behavioral";
    if (label.includes("cod")) return "coding";
    return "technical";
  };

  // Category counts for the filter buttons
  const categoryCounts = useMemo(() => {
    let tech = 0;
    let behav = 0;
    let code = 0;
    transcriptItems.forEach((item) => {
      const cat = getItemCategory(item);
      if (cat === "technical") tech++;
      else if (cat === "behavioral") behav++;
      else if (cat === "coding") code++;
    });
    return { technical: tech, behavioral: behav, coding: code, total: transcriptItems.length };
  }, [transcriptItems]);

  // Open/Close dedicated category questions view
  const viewCategory = searchParams.get("view") as "technical" | "behavioral" | "coding" | "all" | null;

  useEffect(() => {
    setCurrentPage(1);
  }, [viewCategory]);

  const openCategoryView = (category: "technical" | "behavioral" | "coding" | "all") => {
    setCurrentPage(1);
    const newParams = new URLSearchParams(searchParams);
    newParams.set("view", category);
    navigate(`?${newParams.toString()}`, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeCategoryView = () => {
    setCurrentPage(1);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("view");
    navigate(`?${newParams.toString()}`, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleBackFromReport = () => {
    if (document.referrer && document.referrer.includes("/history")) {
      navigate("/history");
      return;
    }
    navigate("/dashboard");
  };

  // Resolve clean job role (handling raw placeholders like "From JD")
  const resolvedRole = useMemo(() => {
    const rawRole = interview?.job_role?.trim();
    const isPlaceholder = !rawRole || [
      "from jd", "from_jd", "unknown", "n/a", "na", "job", "position", "none", "null", "undefined", "title", "role"
    ].includes(rawRole.toLowerCase());

    if (!isPlaceholder) return rawRole;

    // 1. Try extracting explicit Job Title from JD text (e.g. "Job Title: Java Backend Developer")
    if (interview?.jd_file_path) {
      const match = interview.jd_file_path.match(/(?:job\s*title|role|position)\s*:\s*([^\n\r,]+)/i);
      if (match && match[1]) {
        const extracted = match[1].replace(/[\(\[].*?[\)\]]/g, "").trim();
        if (extracted.length > 2 && extracted.length < 50) return extracted;
      }
      // Secondary pattern like "A Java Developer designs..."
      const secMatch = interview.jd_file_path.match(/(?:an?|the)?\s*([A-Za-z0-9+#.\s]{2,25}?\s+(?:developer|engineer|analyst|manager|specialist|architect|designer|lead))\b/i);
      if (secMatch && secMatch[1]) {
        const secExtracted = secMatch[1].trim();
        if (secExtracted.length > 2 && secExtracted.length < 50) return secExtracted;
      }
    }

    // 2. Try interview_name if it has a meaningful role
    const intName = interview?.interview_name?.trim();
    if (intName) {
      const cleaned = intName.replace(/from\s*_?\s*jd/gi, "").replace(/interview|assessment/gi, "").trim();
      if (cleaned.length > 2) return `${cleaned} Developer`;
    }

    // 3. Fall back to skill tags or default
    if (interview?.skill_tags && Array.isArray(interview.skill_tags) && interview.skill_tags.length > 0) {
      return `${interview.skill_tags[0]} Assessment`;
    }

    return "Technical Assessment";
  }, [interview]);

  const handleExportPDF = async () => {
    if (!interview) return;
    try {
      toast({ title: "Generating PDF...", description: "Please wait while we prepare your report." });
      exportResultsPDF(interview, evaluation, transcriptItems);
      toast({ title: "PDF Exported", description: "Your results report has been downloaded." });
    } catch (err: any) {
      console.error("PDF export failed:", err);
      toast({
        title: "Export Failed",
        description: err?.message || "Could not generate PDF report.",
        variant: "destructive",
      });
    }
  };


  useEffect(() => {
    isMounted.current = true;
    pollCountRef.current = 0; // reset on each fresh page load
    if (user && interviewId) {
      loadResults();
    }
    return () => {
      isMounted.current = false;
    };
  }, [user, interviewId]);

  const loadResults = async () => {
    try {
      const { data: interviewData } = await supabase
        .from("interviews")
        .select("*")
        .eq("id", interviewId)
        .single();

      if (!interviewData) {
        if (isMounted.current) setLoading(false);
        return;
      }

      if (!interviewData.video_url) {
        try {
          const recRes = await getRecruiterInterviewRecording(interviewId!);
          if (recRes?.video_url) {
            interviewData.video_url = recRes.video_url;
          }
        } catch (_) {}
      }

      if (isMounted.current) setInterview(interviewData);

      const msgData = await getInterviewMessages(interviewId!);
      const sortedMessages = (msgData || []).sort((a: any, b: any) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (timeA !== timeB) return timeA - timeB;
        const isIntroA = a.metadata?.is_intro || !a.question_id;
        const isIntroB = b.metadata?.is_intro || !b.question_id;
        if (isIntroA && !isIntroB) return -1;
        if (!isIntroA && isIntroB) return 1;
        if (a.role === "user" && b.role === "ai") return -1;
        if (a.role === "ai" && b.role === "user") return 1;
        return a.id.localeCompare(b.id);
      });
      if (isMounted.current) setMessages(sortedMessages);

      // Fetch interview Q&A questions (for transcript)
      try {
        const { data: iqData } = await supabase
          .from("interview_questions")
          .select("id, question_text, question_type, candidate_answer, ai_score, ai_feedback, order_index")
          .eq("interview_id", interviewId)
          .eq("selected", true)
          .order("order_index", { ascending: true });
        if (isMounted.current) setInterviewQuestions(iqData || []);
      } catch (iqErr) {
        console.error("Error loading interview questions:", iqErr);
      }

      try {
        const { data: questionsData, error: qErr } = await supabase
          .from("coding_questions")
          .select("*")
          .eq("interview_id", interviewId)
          .order("order_index", { ascending: true });
        if (qErr) throw qErr;

        const submissionsData = await getCodeSubmissions(interviewId!);
        if (isMounted.current) {
          setCodingQuestions(questionsData || []);
          setCodeSubmissions(submissionsData || []);
        }
      } catch (codingErr) {
        console.error("Error loading coding details:", codingErr);
      }

      const isTerminal = ['flagged', 'selected', 'rejected'].includes(interviewData.status);

      // Show results if scoring is complete, flagged, selected, rejected, OR completed
      if (interviewData.overall_score !== null || isTerminal || interviewData.status === 'completed') {
        if (isMounted.current) {
          setEvaluation({
            overall_score: interviewData.overall_score ?? 0,
            technical_score: interviewData.technical_score ?? 0,
            behavioral_score: interviewData.behavioral_score,
            coding_score: interviewData.coding_score,
            recommendation: interviewData.ai_recommendation || (interviewData.status === 'flagged' ? "Assessment terminated due to proctoring violation." : "AI Assessment is pending or unavailable."),
            categories: interviewData.structured_memory?.categories || {
              technical_knowledge: interviewData.technical_score ?? 0,
              communication: interviewData.behavioral_score ?? 0,
              behavioral_traits: interviewData.behavioral_score ?? 0,
              confidence: Math.round(((interviewData.technical_score ?? 0) + (interviewData.behavioral_score ?? 0)) / 2) || 0,
            },
            emotions: interviewData.structured_memory?.emotions || {
              confident: (interviewData.overall_score || 0) > 70 ? 75 : 45,
              calm: (interviewData.overall_score || 0) > 60 ? 70 : 40,
              engaged: 65,
              nervous: (interviewData.overall_score || 0) < 50 ? 65 : 25,
              hesitant: (interviewData.overall_score || 0) < 60 ? 60 : 20,
            },
            strengths: interviewData.structured_memory?.strengths || (interviewData.status === 'flagged' ? ["N/A - Terminated"] : ["No strengths recorded"]),
            weaknesses: interviewData.structured_memory?.weaknesses || (interviewData.status === 'flagged' ? ["Proctoring violation detected"] : ["No weaknesses recorded"]),
            rubric_summary: interviewData.structured_memory?.rubric_summary || null,
            evaluation_rubric: interviewData.structured_memory?.evaluation_rubric || interviewData.evaluation_rubric || null,
          });
        }
      }

      // If scoring is not complete, keep polling — up to 60 attempts
      // First 6 polls: every 5s (fast), thereafter every 10s (up to ~10 min total)
      if (interviewData.overall_score === null && interviewData.status === 'completed') {
        pollCountRef.current += 1;
        const MAX_POLLS = 60;
        if (pollCountRef.current <= MAX_POLLS) {
          const delay = pollCountRef.current <= 6 ? 5000 : 10000;
          setTimeout(() => {
            if (isMounted.current) loadResults();
          }, delay);
        }
        // If we've exceeded retries and still no score, show results anyway with 0 score
        if (pollCountRef.current > MAX_POLLS && !evaluation && isMounted.current) {
          setEvaluation({
            overall_score: 0,
            technical_score: 0,
            behavioral_score: 0,
            recommendation: "Scoring timed out. Please use the Re-Score button below to retry.",
            categories: { technical_knowledge: 0, communication: 0, behavioral_traits: 0, confidence: 0 },
            emotions: { confident: 50, calm: 50, engaged: 50, nervous: 30, hesitant: 30 },
            strengths: ["Scoring pending — please retry"],
            weaknesses: ["Score not yet available"],
          });
        }
      }
    } catch (err: any) {
      if (isMounted.current) toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    if (isMounted.current) setLoading(false);
  };

  const handleTriggerScoring = async () => {
    if (!interviewId) return;
    setIsScoringTriggered(true);
    try {
      toast({ title: "Analysis Started", description: "Scoring task has been triggered. Please wait..." });
      await submitInterviewForScoring(interviewId);
      setTimeout(() => {
        if (isMounted.current) loadResults();
      }, 3000);
    } catch (err: any) {
      toast({ title: "Trigger Failed", description: err.message, variant: "destructive" });
      setIsScoringTriggered(false);
    }
  };



  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!interview || !evaluation) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center card-elevated p-12 rounded-md border border-border/10 max-w-md bg-card">
          <Loader2 className="h-16 w-16 text-primary mx-auto mb-6 animate-spin opacity-50" />
          <h2 className="text-2xl font-bold mb-2">Results Processing</h2>
          <p className="text-muted-foreground mb-8">
            Assessment results are being analyzed.
          </p>
          {!isReportOnly && (
            <Button variant="hero" className="w-full h-12 rounded-md" onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
          )}
        </div>
      </div>
    );
  }

  const overallScore = Math.round(evaluation.overall_score || 0);

  const didQA = messages.length > 0 || interviewQuestions.length > 0;
  const didCoding = codingQuestions.length > 0;

  const categories = [];

  if (didQA) {
    categories.push(
      { name: "Confidence", score: evaluation.categories?.confidence || 0, icon: Shield, color: "#F472B6" },
      { name: "Communication", score: evaluation.categories?.communication || 0, icon: MessageSquare, color: "#00D1FF" },
      { name: "Behavioral traits", score: evaluation.categories?.behavioral_traits || 0, icon: Heart, color: "#00D1FF" },
      { name: "Technical Knowledge", score: evaluation.categories?.technical_knowledge || 0, icon: Brain, color: "#A855F7" }
    );
  }

  if (didCoding || evaluation.categories?.coding_ability !== undefined) {
    categories.push(
      { name: "Coding Ability", score: evaluation.categories?.coding_ability || evaluation.coding_score || overallScore, icon: Code2, color: "#10B981" },
      { name: "Problem Solving", score: evaluation.categories?.problem_solving || evaluation.coding_score || overallScore, icon: Brain, color: "#F59E0B" }
    );
  }

  if (categories.length === 0) {
    categories.push({ name: "Assessment Score", score: overallScore, icon: Shield, color: "#00D1FF" });
  }

  // Helper to extract a crisp, high-signal 1-sentence AI feedback snippet (capped ~130-150 chars, no raw numbers)
  const getConciseFeedback = (feedbackText: string | undefined | null, fallback: string): string => {
    if (!feedbackText || typeof feedbackText !== "string" || !feedbackText.trim()) {
      return fallback;
    }
    // Clean out markdown bold/italic tags, raw scores like 40/100 or 40%, and extra whitespace
    const clean = feedbackText
      .replace(/[*_#`]/g, "")
      .replace(/\b\d+\s*\/\s*100\b/g, "")
      .replace(/\b\d+%\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const sentences = clean.split(/(?<=[.!?])\s+/);
    const firstSentence = sentences[0]?.trim();
    if (firstSentence && firstSentence.length >= 25 && firstSentence.length <= 150) {
      return firstSentence;
    }
    if (clean.length >= 25 && clean.length <= 140) {
      return clean;
    }
    if (clean.length > 140) {
      return clean.slice(0, 137).trim() + "...";
    }
    return fallback;
  };

  const cutoff = interview.evaluation_score_cutoff ?? 60;
  const techScore = evaluation.categories?.technical_knowledge ?? evaluation.technical_score ?? interview?.technical_score;
  const codeScore = evaluation.categories?.coding_ability ?? evaluation.coding_score ?? interview?.coding_score;
  const behavScore = evaluation.categories?.behavioral_traits ?? evaluation.categories?.communication ?? evaluation.behavioral_score ?? interview?.behavioral_score;

  // Dynamic qualitative AI feedback summaries (zero number duplication)
  const overallDynamicFeedback = (() => {
    if (overallScore >= 80) {
      return "Exemplary performance demonstrating deep conceptual understanding and structured problem solving across criteria.";
    }
    if (overallScore >= cutoff) {
      return "Solid candidate performance meeting enterprise benchmarks with consistent competency across evaluated criteria.";
    }
    if (overallScore >= 40) {
      return "Candidate showed basic familiarity with core concepts, but answers lacked technical depth to meet benchmark standards.";
    }
    return "Responses exhibited significant knowledge gaps or insufficient detail to satisfy benchmark requirements.";
  })();

  const techDynamicFeedback = (() => {
    const techQuestions = (evaluation.per_question || []).filter((q: any) => q.question_type === "technical" && q.feedback);
    const validTech = techQuestions.find((q: any) => q.score > 0 && q.feedback && q.feedback.length > 25) || techQuestions[0];
    if (validTech && validTech.feedback) {
      return getConciseFeedback(
        validTech.feedback,
        Math.round(Number(techScore ?? 0)) >= 60
          ? "Demonstrated solid domain accuracy and conceptual depth across technical questions."
          : "Technical responses lacked required depth and missed key practical domain considerations."
      );
    }
    return Math.round(Number(techScore ?? 0)) >= 60
      ? "Demonstrated solid domain accuracy and conceptual depth across technical questions."
      : "Technical responses lacked required depth and missed key practical domain considerations.";
  })();

  const behavDynamicFeedback = (() => {
    const behavQuestions = (evaluation.per_question || []).filter((q: any) => q.question_type === "behavioral" && q.feedback);
    const validBehav = behavQuestions.find((q: any) => q.score > 0 && q.feedback && q.feedback.length > 25) || behavQuestions[0];
    if (validBehav && validBehav.feedback) {
      return getConciseFeedback(
        validBehav.feedback,
        Math.round(Number(behavScore ?? 0)) >= 60
          ? "Clear verbal articulation, professional poise, and structured conversational flow."
          : "Responses were brief or lacked sufficient situational context to demonstrate competency."
      );
    }
    return Math.round(Number(behavScore ?? 0)) >= 60
      ? "Clear verbal articulation, professional poise, and structured conversational flow."
      : "Responses were brief or lacked sufficient situational context to demonstrate competency.";
  })();

  const codingDynamicFeedback = (() => {
    const numCodeScore = Math.round(Number(codeScore || 0));
    if (numCodeScore >= 80) {
      return "Clean algorithmic structure; successfully satisfied automated test suites and core challenge edge cases.";
    }
    if (numCodeScore >= 50) {
      return "Correct core algorithmic logic; passed primary test cases with minor edge-case or performance limits.";
    }
    if (numCodeScore > 0) {
      return "Partial test execution; encountered logic errors or failed edge-case constraints during test runs.";
    }
    return "No passing unit test cases recorded; solution encountered execution errors or was left unsubmitted.";
  })();

  // Interactive Score Chart Metrics definition with dynamic AI takeaways
  const availableScoreMetrics: { id: string; label: string; shortLabel: string; score: number; color: string; description: string }[] = [
    {
      id: "overall",
      label: "Overall Performance",
      shortLabel: "Overall",
      score: overallScore,
      color: "#00D1FF",
      description: overallDynamicFeedback,
    },
  ];

  if (techScore !== undefined && techScore !== null) {
    availableScoreMetrics.push({
      id: "technical",
      label: "Technical Knowledge",
      shortLabel: "Technical",
      score: Math.round(Number(techScore)),
      color: "#818CF8",
      description: techDynamicFeedback,
    });
  }

  if ((didCoding || codeScore !== undefined) && codeScore !== null) {
    availableScoreMetrics.push({
      id: "coding",
      label: "Coding & Logic",
      shortLabel: "Coding",
      score: Math.round(Number(codeScore || 0)),
      color: "#10B981",
      description: codingDynamicFeedback,
    });
  }

  if (behavScore !== undefined && behavScore !== null) {
    availableScoreMetrics.push({
      id: "behavioral",
      label: "Communication & Soft Skills",
      shortLabel: "Behavioral",
      score: Math.round(Number(behavScore)),
      color: "#EC4899",
      description: behavDynamicFeedback,
    });
  }

  const activeMetric = availableScoreMetrics.find(m => m.id === activeScoreMetricId) || availableScoreMetrics[0];
  const activeScore = activeMetric.score;
  const radialData = [{ name: activeMetric.shortLabel, value: activeScore, fill: activeMetric.color }];
  const passedCutoff = activeScore >= cutoff;

  const emotions = Object.entries(evaluation.emotions || {}).map(([label, value]) => ({
    label: label.charAt(0).toUpperCase() + label.slice(1),
    value: value as number,
  }));

  // Calculate AI Answering Percentage
  const aiFlaggedCount = interviewQuestions.filter(q => q.ai_feedback?.includes("AI Detection Warning")).length;
  const totalEvaluatedQuestions = interviewQuestions.length; // use all questions instead of just evaluated
  const aiPercentage = totalEvaluatedQuestions > 0 ? Math.round((aiFlaggedCount / totalEvaluatedQuestions) * 100) : 0;


  // ── Dedicated Category Questions Page View ─────────────────────────────────
  // Opened when user clicks Technical, Behavioral, Coding, or All buttons
  if (viewCategory && ["technical", "behavioral", "coding", "all"].includes(viewCategory)) {
    const currentCategoryItems = viewCategory === "all" 
      ? transcriptItems 
      : transcriptItems.filter((item) => getItemCategory(item) === viewCategory);

    const totalCategoryItems = currentCategoryItems.length;
    const totalPages = Math.max(1, Math.ceil(totalCategoryItems / pageSize));
    const activePage = Math.min(Math.max(1, currentPage), totalPages);
    const startIndex = (activePage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalCategoryItems);
    const paginatedItems = currentCategoryItems.slice(startIndex, endIndex);

    const handlePageChange = (newPage: number) => {
      const target = Math.min(Math.max(1, newPage), totalPages);
      setCurrentPage(target);
      const containerEl = document.getElementById("category-questions-container");
      if (containerEl) {
        containerEl.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };

    const categoryTitles: Record<string, { title: string; subtitle: string; icon: any; color: string; bg: string }> = {
      technical: {
        title: "Technical Questions & Responses",
        subtitle: "Evaluated domain expertise, technical problem solving, and architecture knowledge.",
        icon: Terminal,
        color: "text-primary",
        bg: "bg-primary/10",
      },
      behavioral: {
        title: "Behavioral Questions & Responses",
        subtitle: "Candidate self-introduction, communication poise, soft skills, and situational responses.",
        icon: Brain,
        color: "text-purple-500 dark:text-purple-400",
        bg: "bg-purple-500/10",
      },
      coding: {
        title: "Coding Challenges & Submissions",
        subtitle: "Automated test suite executions, candidate code submissions, and AI algorithm review.",
        icon: Code2,
        color: "text-emerald-500 dark:text-emerald-400",
        bg: "bg-emerald-500/10",
      },
      all: {
        title: "Complete Interview Transcript",
        subtitle: "Complete log of all questions, candidate responses, and submissions captured from this session.",
        icon: MessageSquare,
        color: "text-primary",
        bg: "bg-primary/10",
      },
    };

    const currentMeta = categoryTitles[viewCategory];
    const IconComp = currentMeta.icon;

    return (
      <div className="min-h-screen bg-background text-foreground font-sans w-full max-w-full overflow-x-hidden">
        <div className="no-print">
          <Navbar />
        </div>

        <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-16 min-w-0 box-border">
          {/* Top Breadcrumb & Return to Report Button */}
          <div className="flex items-center justify-between gap-4 mb-4 no-print min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap min-w-0">
              <button 
                onClick={() => navigate("/dashboard")} 
                className="hover:text-foreground font-medium transition-colors cursor-pointer"
              >
                Dashboard
              </button>
              <span className="text-muted-foreground/40">/</span>
              <button 
                onClick={closeCategoryView} 
                className="hover:text-foreground font-medium transition-colors cursor-pointer"
              >
                Interview Report
              </button>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-foreground font-semibold capitalize">{viewCategory} Answers</span>
            </div>

            <Button 
              variant="outline" 
              size="sm" 
              className="rounded-lg border border-border/70 bg-card hover:bg-secondary/60 text-foreground shadow-xs gap-1.5 text-xs h-8 px-3 font-semibold transition-all cursor-pointer flex items-center shrink-0"
              onClick={closeCategoryView}
            >
              <ChevronLeft size={15} className="text-primary stroke-[2.5]" />
              <span>Back to Interview Report</span>
            </Button>
          </div>

          {/* Dedicated Header Card */}
          <div className="card-elevated rounded-xl border border-border/60 p-4 sm:p-5 bg-card shadow-xs mb-5 w-full max-w-full overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight text-foreground truncate">
                    {currentMeta.title}
                  </h1>
                  <Badge variant="outline" className="text-[11px] font-bold px-2 py-0.5 bg-primary/10 text-primary border-primary/20 shrink-0">
                    {totalCategoryItems} {totalCategoryItems === 1 ? "Item" : "Items"}
                  </Badge>
                </div>

                {/* Candidate & Role banner */}
                <div className="flex items-center gap-2.5 pt-0.5 text-xs text-muted-foreground/80 flex-wrap min-w-0 break-words">
                  <span className="flex items-center gap-1 font-semibold text-foreground shrink-0">
                    <User size={13} className="text-primary" /> {interview.candidate_name || "Candidate"}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Briefcase size={13} /> {resolvedRole}
                  </span>
                  {viewCategory === "technical" && techScore !== undefined && (
                    <>
                      <span>•</span>
                      <span className="font-bold text-primary shrink-0">Technical Score: {Math.round(Number(techScore))}%</span>
                    </>
                  )}
                  {viewCategory === "behavioral" && behavScore !== undefined && (
                    <>
                      <span>•</span>
                      <span className="font-bold text-purple-500 dark:text-purple-400 shrink-0">Behavioral Score: {Math.round(Number(behavScore))}%</span>
                    </>
                  )}
                  {viewCategory === "coding" && codeScore !== undefined && (
                    <>
                      <span>•</span>
                      <span className="font-bold text-emerald-500 dark:text-emerald-400 shrink-0">Coding Score: {Math.round(Number(codeScore))}%</span>
                    </>
                  )}
                </div>
              </div>

              {/* Three Simple Category Switcher Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap self-start lg:self-auto shrink-0 bg-secondary/30 p-1 rounded-xl border border-border/40">
                <button
                  type="button"
                  onClick={() => openCategoryView("technical")}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    viewCategory === "technical"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <Terminal size={12} />
                  <span>Technical</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                    viewCategory === "technical" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    {categoryCounts.technical}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => openCategoryView("behavioral")}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    viewCategory === "behavioral"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <Brain size={12} />
                  <span>Behavioral</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                    viewCategory === "behavioral" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    {categoryCounts.behavioral}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => openCategoryView("coding")}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    viewCategory === "coding"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <Code2 size={12} />
                  <span>Coding</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                    viewCategory === "coding" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    {categoryCounts.coding}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Question Items (Only belonging to this category) */}
          <div id="category-questions-container" className="card-elevated rounded-xl border border-border/50 p-5 sm:p-8 bg-card shadow-xs w-full max-w-full overflow-hidden min-w-0">
            {totalCategoryItems === 0 ? (
              <div className="text-center py-16 px-4 rounded-xl border border-dashed border-border/60 bg-muted/10 space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                  <IconComp size={22} className={currentMeta.color} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">No {viewCategory} questions or submissions recorded</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    There are no items recorded under the {viewCategory} category for this candidate's session.
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={closeCategoryView} className="text-xs h-8 px-3">
                    Return to Report Dashboard
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Pagination & Filter Toolbar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-6 border-b border-border/40 text-xs">
                  <div className="text-muted-foreground font-medium">
                    Showing <span className="font-bold text-foreground">{startIndex + 1}–{endIndex}</span> of <span className="font-bold text-foreground">{totalCategoryItems}</span> questions
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-[11px]">Per page:</span>
                    <div className="inline-flex rounded-lg border border-border/50 bg-secondary/20 p-0.5">
                      {[5, 10, 20].map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => {
                            setPageSize(size);
                            setCurrentPage(1);
                          }}
                          className={`px-2.5 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                            pageSize === size
                              ? "bg-primary text-primary-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-8 min-w-0">
                  {paginatedItems.map((item, index) => (
                    <div key={startIndex + index} className="relative pl-6 sm:pl-8 border-l border-border/50 space-y-4 min-w-0">
                      <div className="absolute -left-1 top-0 h-2 w-2 rounded-full bg-primary" />
                      
                      {item.type === "qa" ? (
                        <>
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-primary uppercase tracking-[0.25em]">
                                {item.label}
                              </span>
                              {item.score !== null && item.score !== undefined && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                  Score: {Math.round(item.score)}/100
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm sm:text-base font-bold text-foreground/90 italic leading-relaxed break-words [overflow-wrap:anywhere]">
                              "{item.question}"
                            </h4>
                          </div>

                          <div className="card-elevated p-4 sm:p-6 rounded-lg bg-white/[0.02] border border-border/50 space-y-3 min-w-0 overflow-hidden">
                            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-2">
                              <CheckCircle2 size={12} className="text-success/60" /> Candidate Response
                            </span>
                            <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed font-normal whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {item.answer}
                            </p>
                          </div>

                          {/* AI Question Feedback temporarily commented out per user request
                          {item.ai_feedback && (
                            <div className="space-y-1.5 bg-primary/5 p-4 rounded-lg border border-primary/15 min-w-0">
                              <span className="text-[9px] font-semibold text-primary uppercase tracking-widest flex items-center gap-1.5">
                                <Brain size={12} /> AI Question Feedback
                              </span>
                              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
                                {item.ai_feedback}
                              </p>
                            </div>
                          )}
                          */}
                        </>
                      ) : (
                        <>
                          <div className="space-y-2 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-bold text-primary uppercase tracking-[0.25em]">
                                {item.label}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest ${
                                item.difficulty === "easy" ? "bg-success/10 text-success" :
                                item.difficulty === "medium" ? "bg-warning/10 text-warning" :
                                "bg-destructive/10 text-destructive"
                              }`}>
                                {item.difficulty}
                              </span>
                            </div>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
                              {item.question}
                            </p>
                          </div>

                          {item.submission ? (
                            <div className="card-elevated p-4 sm:p-6 rounded-lg bg-white/[0.02] border border-border/50 space-y-4 min-w-0 overflow-hidden">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-2">
                                  <CheckCircle2 size={12} className={item.submission.passed_tests === item.submission.total_tests && item.submission.total_tests > 0 ? "text-success" : "text-warning"} /> 
                                  Candidate Code Response ({item.submission.language})
                                </span>
                                <span className={`text-[9px] font-semibold uppercase tracking-widest flex items-center gap-1.5 ${
                                  item.submission.passed_tests === item.submission.total_tests && item.submission.total_tests > 0 ? "text-success" : "text-warning"
                                }`}>
                                  <Activity size={10} /> Test Cases Passed: {item.submission.passed_tests}/{item.submission.total_tests}
                                </span>
                              </div>
                              <pre className="font-mono text-xs text-foreground/90 bg-black/60 p-4 rounded-lg overflow-x-auto border border-border/50 whitespace-pre max-h-[450px] overflow-y-auto max-w-full w-full">
                                <code>{item.submission.code}</code>
                              </pre>
                              {/* AI Code Review Feedback temporarily commented out per user request
                              {item.submission.ai_feedback && (
                                <div className="space-y-2 mt-2 bg-primary/5 p-4 rounded-lg border border-primary/15 min-w-0">
                                  <span className="text-[9px] font-semibold uppercase tracking-widest text-primary flex items-center gap-2">
                                    <Brain size={12} /> Code Review Feedback
                                  </span>
                                  <p className="text-xs text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">{item.submission.ai_feedback}</p>
                                </div>
                              )}
                              */}
                            </div>
                          ) : (
                            <div className="card-elevated p-5 sm:p-6 rounded-lg bg-white/[0.01] border border-dashed border-white/10 text-center py-8">
                              <p className="text-xs text-muted-foreground/50 italic">No solution submitted for this challenge.</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Bottom Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 mt-8 border-t border-border/40">
                    <div className="text-xs text-muted-foreground">
                      Page <span className="font-bold text-foreground">{activePage}</span> of <span className="font-bold text-foreground">{totalPages}</span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={activePage <= 1}
                        onClick={() => handlePageChange(activePage - 1)}
                        className="h-8 px-2.5 text-xs font-semibold gap-1 rounded-lg disabled:opacity-40"
                      >
                        <ChevronLeft size={14} /> Prev
                      </Button>

                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                          <button
                            key={pageNum}
                            type="button"
                            onClick={() => handlePageChange(pageNum)}
                            className={`w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center ${
                              activePage === pageNum
                                ? "bg-primary text-primary-foreground shadow-xs"
                                : "border border-border/50 hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {pageNum}
                          </button>
                        ))}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={activePage >= totalPages}
                        onClick={() => handlePageChange(activePage + 1)}
                        className="h-8 px-2.5 text-xs font-semibold gap-1 rounded-lg disabled:opacity-40"
                      >
                        Next <ChevronRight size={14} />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom Back Button */}
          <div className="mt-8 flex items-center justify-between gap-4 flex-wrap min-w-0">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={closeCategoryView}
              className="rounded-lg h-9 px-4 text-xs font-semibold gap-1.5"
            >
              <ChevronLeft size={14} /> Back to Interview Report
            </Button>

            <div className="flex items-center gap-2 flex-wrap">
              {viewCategory !== "technical" && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => openCategoryView("technical")}
                  className="rounded-lg h-9 px-3 text-xs font-semibold text-primary gap-1"
                >
                  <Terminal size={12} /> Technical ({categoryCounts.technical})
                </Button>
              )}
              {viewCategory !== "behavioral" && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => openCategoryView("behavioral")}
                  className="rounded-lg h-9 px-3 text-xs font-semibold text-purple-500 gap-1"
                >
                  <Brain size={12} /> Behavioral ({categoryCounts.behavioral})
                </Button>
              )}
              {viewCategory !== "coding" && categoryCounts.coding > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => openCategoryView("coding")}
                  className="rounded-lg h-9 px-3 text-xs font-semibold text-emerald-500 gap-1"
                >
                  <Code2 size={12} /> Coding ({categoryCounts.coding})
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans w-full max-w-full overflow-x-hidden">
      <div className="no-print">
        <Navbar />
      </div>
      
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 min-w-0 box-border">
        {/* Breadcrumbs and Back Button */}
        {!isReportOnly && (
          <div className="flex items-center justify-between gap-4 mb-3 no-print">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <button 
                onClick={() => navigate("/dashboard")} 
                className="hover:text-foreground font-medium transition-colors"
              >
                Dashboard
              </button>
              <span className="text-muted-foreground/40">/</span>
              <button 
                onClick={() => navigate("/history")} 
                className="hover:text-foreground font-medium transition-colors"
              >
                History
              </button>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-foreground font-medium">Interview Report</span>
            </div>

            <Button 
              variant="outline" 
              size="sm" 
              className="rounded-[8px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs gap-1.5 text-xs h-8 px-2.5 font-semibold transition-all duration-150 cursor-pointer flex items-center"
              onClick={handleBackFromReport}
            >
              <ChevronLeft size={14} className="text-primary stroke-[2.5]" />
              <span>Back</span>
            </Button>
          </div>
        )}

        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -6 }} 
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5 pb-4 border-b border-border/50"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                Interview Report
              </h1>
              {interview.status && (
                <div>
                  {interview.status === "completed" && (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 font-medium gap-1 text-[11px] h-5 px-2">
                      <CheckCircle2 className="w-3 h-3" /> Completed
                    </Badge>
                  )}
                  {interview.status === "flagged" && (
                    <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30 font-medium gap-1 text-[11px] h-5 px-2">
                      <AlertTriangle className="w-3 h-3" /> Flagged
                    </Badge>
                  )}
                  {interview.status === "in_progress" && (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 font-medium gap-1 text-[11px] h-5 px-2">
                      <Clock className="w-3 h-3 animate-pulse" /> In Progress
                    </Badge>
                  )}
                  {interview.status === "pending" && (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 font-medium gap-1 text-[11px] h-5 px-2">
                      <Clock className="w-3 h-3" /> Pending
                    </Badge>
                  )}
                  {!["completed", "flagged", "in_progress", "pending"].includes(interview.status) && (
                    <Badge variant="outline" className="bg-secondary text-foreground border-border font-medium text-[11px] h-5 px-2 capitalize">
                      {interview.status}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Candidate & Assessment Metadata strip */}
            <div className="flex flex-wrap items-center gap-y-1 gap-x-2 text-xs text-muted-foreground">
              {/* Candidate Info */}
              <div className="flex items-center gap-1.5 font-semibold text-foreground whitespace-nowrap">
                <User className="h-3 w-3 text-primary shrink-0" />
                <span className="text-[13px]">{interview.candidate_name || "Candidate"}</span>
                {interview.candidate_email && (
                  <span className="text-muted-foreground font-normal text-[11px]">({interview.candidate_email})</span>
                )}
              </div>

              <span className="text-muted-foreground/30 select-none">•</span>

              {/* Job Role */}
              <div className="flex items-center gap-1.5 text-foreground/85 whitespace-nowrap text-xs font-medium">
                <Briefcase className="h-3 w-3 text-muted-foreground shrink-0" />
                <span>{resolvedRole}</span>
              </div>

              <span className="text-muted-foreground/30 select-none">•</span>

              {/* Date */}
              <div className="flex items-center gap-1.5 text-muted-foreground whitespace-nowrap text-xs">
                <Calendar className="h-3 w-3 shrink-0" />
                <span>
                  {new Date(interview.actual_started_at || interview.started_at || interview.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {interview.video_url && (
              <>
                <Button 
                  variant="outline" size="sm" 
                  className="rounded-[8px] h-8 px-3 text-xs gap-1.5 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 font-medium no-print shadow-xs"
                  onClick={handleViewRecording}
                >
                  <Play size={13} /> View Video
                </Button>
                <Button 
                  variant="outline" size="sm" 
                  className="rounded-[8px] h-8 px-3 text-xs gap-1.5 border-border/70 hover:bg-secondary/40 text-foreground font-medium no-print shadow-xs"
                  onClick={handleDownloadRecording}
                  disabled={isDownloadingRecording}
                >
                  {isDownloadingRecording ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} 
                  {isDownloadingRecording ? "Downloading..." : "Download"}
                </Button>
              </>
            )}
            <Button 
              variant="outline" size="sm" 
              className="rounded-[8px] h-8 px-3 text-xs gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 font-medium no-print shadow-xs"
              onClick={() => setShowEvidenceModal(true)}
            >
              <Shield size={13} /> Proctoring Evidence
            </Button>
            <Button 
              variant="default" size="sm" 
              className="rounded-[8px] h-8 px-3.5 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-xs no-print"
              onClick={handleExportPDF}
            >
              <Download size={13} /> Export PDF
            </Button>
          </div>
        </motion.div>

        {interview.status === 'completed' && interview.overall_score === null && (
          <div className="mb-6 p-4 rounded-md border border-primary/30 bg-primary/10 text-primary flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Loader2 className="h-5 w-5 animate-spin shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-sm">AI Analysis Pending</h3>
                <p className="text-xs opacity-90 mt-1">The AI is currently analyzing this candidate's interview. Full scores and recommendations will appear here automatically once finished.</p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleTriggerScoring}
              disabled={isScoringTriggered}
              className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 transition-all font-semibold flex items-center gap-2 self-start sm:self-auto shrink-0"
            >
              {isScoringTriggered ? "Triggering..." : "⚡ Trigger AI Analysis"}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-stretch">
          {/* Circular Score (Interactive) */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }} 
            animate={{ opacity: 1, scale: 1 }}
            className="lg:col-span-6 rounded-xl border border-border/50 p-4 sm:p-5 bg-card flex flex-col justify-between shadow-xs transition-all"
          >
            {/* Top row: Title */}
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                  <Activity className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-xs font-bold text-foreground">Performance Score</h3>
              </div>
            </div>

            {/* Middle Section: Radial Gauge + Benchmark status */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-5 py-3">
              <div className="relative w-32 h-32 sm:w-36 sm:h-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart 
                    innerRadius="80%" 
                    outerRadius="100%" 
                    data={radialData} 
                    startAngle={90} 
                    endAngle={-270}
                  >
                    <RadialBar 
                      dataKey="value" 
                      cornerRadius={8} 
                      background={{ fill: "rgba(255,255,255,0.05)" }}
                      isAnimationActive={true}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground transition-all duration-300">
                    {activeScore}
                  </span>
                  <span className="text-[10px] font-semibold text-muted-foreground/50">/ 100</span>
                </div>
              </div>

              <div className="flex flex-col items-center sm:items-start text-center sm:text-left space-y-1.5 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap justify-center sm:justify-start">
                  <span 
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                      passedCutoff 
                        ? 'bg-success/10 text-success border-success/20' 
                        : 'bg-destructive/10 text-destructive border-destructive/20'
                    }`}
                  >
                    {activeMetric.id === "overall" 
                      ? (passedCutoff ? 'Recommended' : 'Not Recommended')
                      : (passedCutoff ? 'Meets Benchmark' : 'Below Benchmark')}
                  </span>
                  <span className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/20 font-medium">
                    Cutoff: {cutoff}%
                  </span>
                </div>

                <div className="text-xs font-semibold text-foreground/90">
                  {activeMetric.label}
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                  {activeMetric.description}
                </p>

                {interview.status === 'flagged' && activeMetric.id === "overall" && (
                  <div className="flex items-center gap-1 text-[10px] font-semibold text-destructive mt-0.5">
                    <AlertTriangle size={11} />
                    <span>Proctoring Violation Recorded</span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row: Clickable metric breakdown pills */}
            <div className={`grid gap-1.5 pt-2.5 border-t border-border/30 ${
              availableScoreMetrics.length === 4 ? 'grid-cols-2 sm:grid-cols-4' :
              availableScoreMetrics.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
            }`}>
              {availableScoreMetrics.map(m => {
                const isSelected = activeMetric.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setActiveScoreMetricId(m.id)}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-primary/60 bg-primary/10 shadow-xs ring-1 ring-primary/40'
                        : 'border-border/30 bg-muted/20 hover:bg-muted/40 hover:border-border/60'
                    }`}
                  >
                    <div className="text-[10px] font-medium text-muted-foreground truncate">{m.shortLabel}</div>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-sm font-bold text-foreground" style={{ color: isSelected ? m.color : undefined }}>
                        {m.score}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">/100</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* ID Verification Card */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }} 
            animate={{ opacity: 1, scale: 1 }} 
            transition={{ delay: 0.05 }}
            className="lg:col-span-6 rounded-xl border border-border/50 p-4 sm:p-5 bg-card flex flex-col justify-between shadow-xs transition-all"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-success/10 flex items-center justify-center text-success">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-xs font-bold text-foreground">ID Verification</h3>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20 text-[10px] font-semibold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                Verified
              </span>
            </div>

            {/* Candidate Photo - Properly Fitted & Aligned */}
            <div className="flex-1 flex items-center justify-center my-auto py-2">
              <div 
                onClick={() => interview.candidate_id_url && setShowIdPhotoZoom(true)}
                className={`relative w-full max-w-[340px] sm:max-w-[380px] h-[195px] sm:h-[210px] rounded-lg overflow-hidden border border-border/40 bg-black/60 flex items-center justify-center shadow-xs ${
                  interview.candidate_id_url ? 'cursor-pointer hover:border-primary/50 transition-all' : ''
                }`}
              >
                {interview.candidate_id_url ? (
                  <img 
                    src={interview.candidate_id_url.startsWith('http') ? interview.candidate_id_url : `${(import.meta.env.VITE_API_BASE_URL || "").replace(/\/api$/, "")}${interview.candidate_id_url}`} 
                    alt="Candidate ID Snapshot" 
                    className="w-full h-full object-contain" 
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/40 gap-1.5 p-2 text-center">
                    <User className="w-8 h-8 stroke-[1.5]" />
                    <span className="text-xs italic">No image captured</span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>



          {/* AI Answering Percentage */}
          {aiPercentage > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="lg:col-span-12 card-elevated rounded-md border border-primary/20 p-5 sm:p-8 bg-primary/5 flex items-center justify-between"
            >
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-primary flex items-center gap-2 mb-1">
                  <Brain size={14} /> AI Answering Detected
                </h3>
                <p className="text-[11px] text-foreground/60">
                  A portion of the candidate's answers exhibited strong signs of being generated by an AI.
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-primary">{aiPercentage}%</div>
                <div className="text-[9px] uppercase tracking-widest text-primary/70">Of Answers Flagged</div>
              </div>
            </motion.div>
          )}

          {/* Enterprise Evaluation Rubric Breakdown */}
          {evaluation?.evaluation_rubric && evaluation.evaluation_rubric.length > 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="lg:col-span-12 card-elevated rounded-lg border border-border/40 p-4 sm:p-5 bg-card shadow-xs"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3.5 pb-3 border-b border-border/40">
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-foreground/90 flex items-center gap-1.5">
                    <Sliders size={15} className="text-primary shrink-0" /> Enterprise Evaluation Criteria Breakdown
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Performance evaluated against configured enterprise parameters and custom weights.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap self-start sm:self-auto">
                  {interview.evaluation_score_cutoff !== undefined && (
                    <span className="px-2 py-0.5 rounded bg-secondary/70 border border-border/50 text-[10px] font-semibold text-foreground/80">
                      Benchmark: {interview.evaluation_score_cutoff}% Cutoff
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-[10px] font-semibold text-primary uppercase tracking-wider">
                    Weighted Scoring
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                {evaluation.evaluation_rubric.map((item: any) => {
                  const score = evaluation.rubric_summary?.[item.id] ?? 
                    (item.id === "technical_correctness" ? evaluation.technical_score :
                     item.id === "communication_quality" ? evaluation.behavioral_score :
                     item.id === "confidence" ? evaluation.emotions?.confident : evaluation.overall_score) ?? 0;
                  return (
                    <div 
                      key={item.id} 
                      className="p-3 rounded-lg bg-secondary/15 hover:bg-secondary/30 border border-border/40 hover:border-primary/30 transition-all flex flex-col justify-between gap-1.5"
                      title={item.description || item.name}
                    >
                      {/* Criteria Name */}
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-xs text-foreground/90 tracking-tight leading-snug">
                          {item.name}
                        </span>
                        {item.is_custom && (
                          <span className="px-1 py-0 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[8px] font-medium shrink-0">
                            Custom
                          </span>
                        )}
                      </div>

                      {/* Weight and Score */}
                      <div className="flex items-baseline justify-between pt-0.5">
                        <span className="text-[11px] text-muted-foreground font-medium">
                          Weight: {item.weight}%
                        </span>
                        <span className={`text-sm font-bold ${score >= 70 ? "text-emerald-500 dark:text-emerald-400" : score >= 50 ? "text-primary" : "text-destructive"}`}>
                          {score}%
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="h-1.5 w-full bg-secondary/60 rounded-full overflow-hidden mt-0.5">
                        <motion.div 
                          initial={{ width: 0 }} 
                          animate={{ width: `${score}%` }} 
                          transition={{ duration: 0.8 }}
                          className={`h-full rounded-full ${score >= 70 ? "bg-emerald-500 dark:bg-emerald-400" : score >= 50 ? "bg-primary" : "bg-destructive"}`} 
                        />
                      </div>

                      {/* Description commented out per user request for clean, non-truncated UI */}
                      {/* {item.description && (
                        <p className="text-[10px] text-muted-foreground/60 truncate leading-tight">
                          {item.description}
                        </p>
                      )} */}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : categories.length > 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="lg:col-span-12 card-elevated rounded-md border border-border/10 p-5 sm:p-8 bg-card"
            >
              <h3 className="text-xs font-semibold uppercase tracking-widest mb-8 text-foreground/40">Score Breakdown</h3>
              <div className="space-y-6">
                {categories.map((cat) => (
                  <div key={cat.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <cat.icon size={14} className="text-muted-foreground/40" />
                        <span className="text-[11px] font-bold text-foreground/70">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                         <span className="text-xs font-bold text-foreground/90">{cat.score}%</span>
                      </div>
                    </div>
                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${cat.score}%` }} transition={{ duration: 1 }}
                        className="h-full rounded-full" style={{ backgroundColor: cat.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : null}


          {/* Interview Questions & Detailed Responses Hub Card */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: 0.3 }}
            className="lg:col-span-12 card-elevated rounded-xl border border-border/50 p-5 sm:p-6 bg-card shadow-xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-3 border-b border-border/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <MessageSquare size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Interview Questions & Detailed Responses</h3>
                  <p className="text-[11px] text-muted-foreground">Select a category to view the complete questions, candidate answers, and scoring breakdown.</p>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border/30 self-start sm:self-auto">
                {transcriptItems.length} Total Captured Turns
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {/* Technical Card */}
              <div 
                onClick={() => openCategoryView("technical")}
                className="p-4 rounded-xl border border-border/60 hover:border-primary/50 bg-secondary/15 hover:bg-primary/[0.03] transition-all cursor-pointer group flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                      <Terminal size={14} />
                    </div>
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-bold">
                      {categoryCounts.technical} Questions
                    </Badge>
                  </div>
                  <h4 className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                    Technical Questions
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    In-depth technical domain questions, architecture inquiries, and follow-ups.
                  </p>
                </div>
                <div className="pt-3 mt-3 border-t border-border/30 flex items-center justify-between text-xs font-semibold text-primary">
                  <span>View Answers</span>
                  <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              {/* Behavioral Card */}
              <div 
                onClick={() => openCategoryView("behavioral")}
                className="p-4 rounded-xl border border-border/60 hover:border-purple-500/50 bg-secondary/15 hover:bg-purple-500/[0.03] transition-all cursor-pointer group flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="w-7 h-7 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                      <Brain size={14} />
                    </div>
                    <Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 text-[10px] font-bold">
                      {categoryCounts.behavioral} Questions
                    </Badge>
                  </div>
                  <h4 className="text-xs font-bold text-foreground group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                    Behavioral Questions
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Candidate self-introduction, situational responses, communication, and soft skills.
                  </p>
                </div>
                <div className="pt-3 mt-3 border-t border-border/30 flex items-center justify-between text-xs font-semibold text-purple-600 dark:text-purple-400">
                  <span>View Answers</span>
                  <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              {/* Coding Card */}
              <div 
                onClick={() => openCategoryView("coding")}
                className="p-4 rounded-xl border border-border/60 hover:border-emerald-500/50 bg-secondary/15 hover:bg-emerald-500/[0.03] transition-all cursor-pointer group flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="w-7 h-7 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <Code2 size={14} />
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] font-bold">
                      {categoryCounts.coding} Challenges
                    </Badge>
                  </div>
                  <h4 className="text-xs font-bold text-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    Coding Challenges
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Code submissions, unit test results, algorithmic complexity, and feedback.
                  </p>
                </div>
                <div className="pt-3 mt-3 border-t border-border/30 flex items-center justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <span>View Answers</span>
                  <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Recording Modal */}
      <AnimatePresence>
        {showRecording && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="bg-zinc-950/90 border border-zinc-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] text-zinc-100"
            >
              {/* Header */}
              <div className="px-6 py-4 bg-zinc-900/40 backdrop-blur-md flex items-center justify-between shrink-0 border-b border-zinc-900">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setShowRecording(false)}
                    className="h-9 px-3 rounded-lg border border-zinc-800 bg-zinc-900/30 text-zinc-300 hover:text-white hover:bg-zinc-800/50 hover:border-zinc-700 transition-all flex items-center gap-1.5 text-xs font-semibold active:scale-95"
                  >
                    <ChevronLeft size={14} /> Back
                  </button>
                  <div className="h-4 w-[1px] bg-zinc-800" />
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2 tracking-tight">
                      <div className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
                      Interview Recording
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-0.5">
                      <span>Dashboard</span>
                      <span>&rarr;</span>
                      <span>Candidates</span>
                      <span>&rarr;</span>
                      {interview?.candidate_name && (
                        <span className="text-zinc-200 font-semibold">{interview.candidate_name}</span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowRecording(false)}
                  className="h-8 w-8 rounded-full border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-800 hover:text-white flex items-center justify-center text-zinc-400 transition-all active:scale-95"
                  title="Close Dialog"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Video Player Container */}
              <div className="bg-zinc-950 flex-1 relative flex flex-col justify-center min-h-[45vh] max-h-[60vh] w-full p-4 overflow-hidden select-none">
                {videoUrl ? (
                  <div className="relative w-full h-full max-h-[55vh] rounded-xl overflow-hidden border border-zinc-900 shadow-2xl bg-zinc-950 flex items-center justify-center">
                    <video
                      ref={videoRef}
                      src={secureVideoUrl}
                      autoPlay
                      onTimeUpdate={() => {
                        if (videoRef.current) {
                          setVideoCurrentTime(videoRef.current.currentTime);
                          const dur = videoRef.current.duration;
                          if (dur && dur !== Infinity && !isNaN(dur) && videoDuration !== dur) {
                            setVideoDuration(dur);
                          }
                        }
                      }}
                      onLoadedMetadata={(e) => {
                        const video = e.currentTarget;
                        if (video.duration === Infinity || isNaN(video.duration)) {
                          video.currentTime = 1e101;
                          const restore = () => {
                            video.removeEventListener("timeupdate", restore);
                            video.currentTime = 0;
                            if (video.duration !== Infinity && !isNaN(video.duration)) {
                              setVideoDuration(video.duration);
                            }
                          };
                          video.addEventListener("timeupdate", restore);
                        } else if (video.duration > 0) {
                          setVideoDuration(video.duration);
                        }
                      }}
                      onPlay={() => setIsVideoPlaying(true)}
                      onPause={() => setIsVideoPlaying(false)}
                      className="w-full h-full max-h-[55vh] object-contain rounded-xl"
                    />
                  </div>
                ) : (
                  <div className="text-zinc-500 flex flex-col items-center justify-center gap-3 py-16">
                    <div className="h-14 w-14 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
                      <AlertTriangle size={24} />
                    </div>
                    <p className="text-sm font-medium">Recording not available for playback.</p>
                  </div>
                )}
              </div>

              {/* Custom Control Bar */}
              {videoUrl && (
                <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-900 flex flex-col gap-4">
                  {/* Timeline Slider */}
                  <div className="flex items-center gap-3.5 w-full">
                    <span className="text-[10px] font-mono text-zinc-400 min-w-[42px] text-right">
                      {(() => {
                        const secs = videoCurrentTime;
                        if (isNaN(secs)) return "00:00";
                        const h = Math.floor(secs / 3600);
                        const m = Math.floor((secs % 3600) / 60);
                        const s = Math.floor(secs % 60);
                        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                      })()}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 100}
                      step={0.1}
                      value={videoCurrentTime}
                      onChange={(e) => {
                        const newTime = parseFloat(e.target.value);
                        if (videoRef.current) {
                          videoRef.current.currentTime = newTime;
                          setVideoCurrentTime(newTime);
                        }
                      }}
                      className="flex-1 h-1 bg-zinc-800 hover:h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 focus:outline-none transition-all duration-150"
                      style={{
                        background: `linear-gradient(to right, #00D2FF 0%, #00D2FF ${(videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0)}%, #27272a ${(videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0)}%, #27272a 100%)`
                      }}
                    />
                    <span className="text-[10px] font-mono text-zinc-400 min-w-[42px]">
                      {(() => {
                        const secs = videoDuration;
                        if (isNaN(secs)) return "00:00";
                        const h = Math.floor(secs / 3600);
                        const m = Math.floor((secs % 3600) / 60);
                        const s = Math.floor(secs % 60);
                        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                      })()}
                    </span>
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center justify-between">
                    {/* Left: Skip & Playback controls */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
                          }
                        }}
                        className="h-9 px-3.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white rounded-lg active:scale-95 transition-all text-xs font-semibold flex items-center gap-1.5"
                        title="Rewind 10 seconds"
                      >
                        -10s
                      </button>

                      <button
                        onClick={() => {
                          if (videoRef.current) {
                            if (isVideoPlaying) {
                              videoRef.current.pause();
                            } else {
                              videoRef.current.play();
                            }
                          }
                        }}
                        className="h-10 w-10 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 transition-all duration-300 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:shadow-[0_0_20px_rgba(6,182,212,0.6)] active:scale-95"
                        title={isVideoPlaying ? "Pause" : "Play"}
                      >
                        {isVideoPlaying ? (
                          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                            <rect x="6" y="4" width="4" height="16" />
                            <rect x="14" y="4" width="4" height="16" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 fill-current ml-0.5" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          if (videoRef.current) {
                            const dur = videoRef.current.duration;
                            const actualDur = (dur && dur !== Infinity && !isNaN(dur)) ? dur : videoDuration;
                            if (actualDur > 0) {
                              videoRef.current.currentTime = Math.min(actualDur, videoRef.current.currentTime + 10);
                            } else {
                              videoRef.current.currentTime += 10;
                            }
                          }
                        }}
                        className="h-9 px-3.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white rounded-lg active:scale-95 transition-all text-xs font-semibold flex items-center gap-1.5"
                        title="Forward 10 seconds"
                      >
                        +10s
                      </button>
                    </div>

                    {/* Middle: Video length details */}
                    {interview?.job_role && (
                      <span className="hidden sm:inline-block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                        {interview.job_role} Assessment
                      </span>
                    )}
                    {/* Right: Quick Jump Controls */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mr-1.5">Jump:</span>
                      {[0.25, 0.5, 0.75].map((pct) => (
                        <button
                          key={pct}
                          onClick={() => {
                            if (videoRef.current) {
                              const dur = videoRef.current.duration;
                              const actualDur = (dur && dur !== Infinity && !isNaN(dur)) ? dur : videoDuration;
                              if (actualDur > 0) {
                                videoRef.current.currentTime = actualDur * pct;
                                setVideoCurrentTime(actualDur * pct);
                              }
                            }
                          }}
                          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-850 text-[10px] font-bold text-zinc-400 hover:text-zinc-200 rounded-md border border-zinc-800 transition-all active:scale-95"
                        >
                          {pct * 100}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="px-6 py-4 border-t border-zinc-900 bg-zinc-900/20 backdrop-blur-md flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Video size={14} className="text-cyan-500" />
                  <span>Proctored Session Recording</span>
                </div>
                {videoUrl && (
                  <Button
                    variant="outline"
                    className="rounded-lg border-zinc-800 hover:border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white h-10 px-5 gap-2 text-xs font-bold transition-all active:scale-95"
                    onClick={handleDownloadRecording}
                    disabled={isDownloadingRecording}
                  >
                    {isDownloadingRecording ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 
                    {isDownloadingRecording ? "Downloading..." : "Download Recording"}
                  </Button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Proctoring Evidence Modal */}
      <Dialog open={showEvidenceModal} onOpenChange={setShowEvidenceModal}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-warning" />
              Proctoring Evidence
            </DialogTitle>
            <DialogDescription>
              Review timestamps, violation reasons, and captured screenshots for this candidate's session.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-muted p-4 rounded-md border border-border/50 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Mobile Phone Strikes</p>
                <p className="text-2xl font-bold text-warning">{interview?.proctoring_strikes?.mobile || 0}</p>
              </div>
              <div className="bg-muted p-4 rounded-md border border-border/50 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Multiple Persons Strikes</p>
                <p className="text-2xl font-bold text-warning">{interview?.proctoring_strikes?.multi_person || 0}</p>
              </div>
              <div className="bg-muted p-4 rounded-md border border-border/50 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Eye Movement Strikes</p>
                <p className="text-2xl font-bold text-warning">{interview?.proctoring_strikes?.gaze || 0}</p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-lg mb-4">Captured Screenshots</h3>
              {(() => {
                const rawScreenshots = interview?.violation_screenshot;
                let urls: any[] = [];
                
                if (Array.isArray(rawScreenshots)) {
                  urls = rawScreenshots;
                } else if (typeof rawScreenshots === 'string' && rawScreenshots.trim() !== '') {
                  const trimmed = rawScreenshots.trim();
                  if (trimmed.startsWith('[')) {
                    try {
                      urls = JSON.parse(trimmed);
                    } catch (e) {
                      urls = [rawScreenshots];
                    }
                  } else {
                    urls = [rawScreenshots];
                  }
                } else if (rawScreenshots && typeof rawScreenshots === 'object') {
                  urls = [rawScreenshots];
                }

                if (urls.length === 0) {
                  return (
                    <div className="p-8 text-center bg-muted/30 rounded-md border border-dashed border-border/50">
                      <p className="text-muted-foreground">No screenshots captured during this interview.</p>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {urls.map((item: any, idx: number) => {
                      let url = typeof item === 'string' ? item : item.url;
                      const reason = typeof item === 'object' && item.reason ? item.reason : "Proctoring Violation";
                      const timestamp = typeof item === 'object' && item.timestamp ? new Date(item.timestamp).toLocaleString() : "Unknown Time";
                      
                      if (url && typeof url === 'string' && url.startsWith('/')) {
                        const serverUrl = import.meta.env.VITE_API_BASE_URL
                          ? import.meta.env.VITE_API_BASE_URL.replace(/\/api$/, '')
                          : "http://localhost:8000";
                        url = `${serverUrl}${url}`;
                      }

                      return (
                        <div key={idx} className="bg-card rounded-md border border-border/50 overflow-hidden shadow-sm flex flex-col">
                          <div className="w-full h-40 bg-black flex items-center justify-center relative overflow-hidden">
                            <img src={url} alt={`Violation ${idx+1}`} className="max-w-full max-h-full object-contain" />
                          </div>
                          <div className="p-3 bg-muted/30">
                            <p className="text-sm font-semibold text-warning">{reason}</p>
                            <p className="text-xs text-muted-foreground mt-1">{timestamp}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Candidate Photo Full-view Modal */}
      <Dialog open={showIdPhotoZoom} onOpenChange={setShowIdPhotoZoom}>
        <DialogContent className="max-w-xl p-0 overflow-hidden bg-background border-border">
          <DialogHeader className="p-4 border-b border-border/40">
            <DialogTitle className="text-sm font-semibold flex items-center justify-between">
              <span>Candidate Check-in Snapshot</span>
              <span className="text-xs text-muted-foreground font-normal">{interview?.candidate_name}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Verified identity photo captured during onboarding check-in.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-black/60 flex items-center justify-center max-h-[70vh]">
            {interview?.candidate_id_url && (
              <img 
                src={interview.candidate_id_url.startsWith('http') ? interview.candidate_id_url : `${(import.meta.env.VITE_API_BASE_URL || "").replace(/\/api$/, "")}${interview.candidate_id_url}`} 
                alt="Candidate Verification Zoom" 
                className="max-h-[60vh] w-auto rounded-md object-contain border border-white/10"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
