import { useState, useEffect, useRef, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, UserCheck, FileText, CheckCircle2,
  BarChart3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutDashboard,
  TrendingUp, AlertCircle, Award, Calendar,
  Search, Filter, ArrowUpRight, ArrowRight, Download,
  Activity, ShieldCheck,
  Clock, Brain, Briefcase, Plus, Play, MoreVertical, Trash2, AlertTriangle, X, Video, Eye, Loader2,
  XCircle, ShieldAlert, Sparkles, Check, HelpCircle
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  getAdminDashboardStats,
  getAdminManagers,
  getAdminTrends,
  getAdminLeaderboard,
  getAdminPipeline,
  getAdminCandidateResult,
  getAdminManagerRecruiters,
  getRecruiterStats,
  getAdminOperationalTable,
  getRecruiterInterviewResult,
  getRecruiterInterviewRecording,
  getRecruiterInterviewReport,
  deleteInterview,
  adminAddMember,
  BASE
} from "@/lib/api";
import { StatsCard } from "@/components/admin/StatsCard";
import { HierarchyView } from "@/components/admin/HierarchyView";
import { OperationalTable } from "@/components/admin/OperationalTable";
import {
  InterviewTrendChart,
  RecruiterPerformanceChart
} from "@/components/admin/AdminCharts";
import { SkeletonCard, SkeletonChart, SkeletonRow } from "@/components/admin/Skeletons";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { exportAdminReportPDF } from "@/lib/pdf-export";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const formatStatusLabel = (status: string) => {
  if (!status) return "";
  if (status.toLowerCase() === 'failed') return 'Invitation failed';
  if (status.toLowerCase() === 'in_progress') return 'In progress';
  const clean = status.replace(/_/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
};

// Module-level in-memory cache to make re-visiting Dashboard instantaneous (0ms delay)
let dashboardCache: {
  stats?: any;
  managers?: any[];
  trends?: any[];
  leaderboard?: any[];
  pipeline?: any[];
  recentInterviews?: any[];
  recruiters?: any[];
} = (() => {
  try {
    const cachedStats = sessionStorage.getItem("dashboard_cache_stats");
    const cachedPipeline = sessionStorage.getItem("dashboard_cache_pipeline");
    const cachedInterviews = sessionStorage.getItem("dashboard_cache_interviews");
    return {
      stats: cachedStats ? JSON.parse(cachedStats) : undefined,
      pipeline: cachedPipeline ? JSON.parse(cachedPipeline) : undefined,
      recentInterviews: cachedInterviews ? JSON.parse(cachedInterviews) : undefined,
    };
  } catch {
    return {};
  }
})();

export default function AdminDashboard() {
  const { toast } = useToast();
  const { user, loading: authLoading, redirectToScalozLogin, roleResolved } = useAuth();
  const navigate = useNavigate();

  // Navigation & View State
  const [view, setView] = useState<"overview" | "hierarchy" | "operational" | "candidate" | "recruiters" | "interviews">("overview");
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [candidateResult, setCandidateResult] = useState<any>(null);
  const [recruiters, setRecruiters] = useState<any[]>(dashboardCache.recruiters || []);
  const [recentInterviews, setRecentInterviews] = useState<any[]>(dashboardCache.recentInterviews || []);
  const [selectedRecruiterId, setSelectedRecruiterId] = useState<string | null>(null);
  const [showRecording, setShowRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [secureVideoUrl, setSecureVideoUrl] = useState("");
  const [recordingInterviewId, setRecordingInterviewId] = useState<string | null>(null);
  const [recordingCandidateName, setRecordingCandidateName] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [screenshotUrls, setScreenshotUrls] = useState<string[]>([]);
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState(0);
  const [screenshotCandidate, setScreenshotCandidate] = useState<any>(null);
  const [showAddRecruiterModal, setShowAddRecruiterModal] = useState(false);
  const [newRecruiterEmail, setNewRecruiterEmail] = useState("");
  const [newRecruiterName, setNewRecruiterName] = useState("");
  const [isSubmittingRecruiter, setIsSubmittingRecruiter] = useState(false);

  useEffect(() => {
    if (!authLoading && user && user.role === 'super_admin') {
      window.location.href = '/super-admin';
    }
  }, [user, authLoading]);

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

  // Data State with instant cache hydration
  const [stats, setStats] = useState<any>(dashboardCache.stats || null);
  const [managers, setManagers] = useState<any[]>(dashboardCache.managers || []);
  const [trends, setTrends] = useState<any[]>(dashboardCache.trends || []);
  const [leaderboard, setLeaderboard] = useState<any[]>(dashboardCache.leaderboard || []);
  const [pipeline, setPipeline] = useState<any[]>(dashboardCache.pipeline || []);
  const [isLoading, setIsLoading] = useState({
    stats: !dashboardCache.stats,
    hierarchy: !dashboardCache.managers || dashboardCache.managers.length === 0,
    trends: !dashboardCache.trends || dashboardCache.trends.length === 0,
    leaderboard: !dashboardCache.leaderboard || dashboardCache.leaderboard.length === 0,
    pipeline: !dashboardCache.pipeline || dashboardCache.pipeline.length === 0,
    table: !dashboardCache.recentInterviews || dashboardCache.recentInterviews.length === 0
  });
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [managerFilter, setManagerFilter] = useState("");
  const [recruiterFilter, setRecruiterFilter] = useState("");
  const [displayRecruiters, setDisplayRecruiters] = useState<any[]>([]);
  const [recentInterviewsSearch, setRecentInterviewsSearch] = useState("");
  const [recentInterviewsDateRange, setRecentInterviewsDateRange] = useState("");
  const [scoreFilter, setScoreFilter] = useState("");
  const [hierarchySearch, setHierarchySearch] = useState("");
  const [operationalStatusFilter, setOperationalStatusFilter] = useState("");

  const recentInterviewsRef = useRef<HTMLDivElement>(null);
  const [highlightFilter, setHighlightFilter] = useState(false);

  const handleKpiCardClick = (targetStatus: string | null) => {
    setStatusFilter(targetStatus);
    setHighlightFilter(true);
    setTimeout(() => setHighlightFilter(false), 2200);

    setTimeout(() => {
      if (recentInterviewsRef.current) {
        recentInterviewsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        const el = document.getElementById("recent-interviews-section");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  };

  const filteredInterviews = useMemo(() => {
    let list = recentInterviews;

    if (statusFilter === "candidates") {
      const seen = new Set<string>();
      const uniqueList: any[] = [];
      for (const item of recentInterviews) {
        const email = (item.candidate_email || "").trim().toLowerCase();
        if (email) {
          if (!seen.has(email)) {
            seen.add(email);
            uniqueList.push(item);
          }
        }
      }
      // Fallback: If any candidate email rows were not present in recentInterviews, include valid name rows to fulfill count
      if (uniqueList.length < (stats?.total_candidates || 0)) {
        for (const item of recentInterviews) {
          const email = (item.candidate_email || "").trim().toLowerCase();
          const name = (item.candidate_name || item.candidate || "").trim().toLowerCase();
          if (!email && name && name !== "unknown" && name !== "unassigned candidate" && name !== "unassigned (invite pending)") {
            if (!seen.has(name)) {
              seen.add(name);
              uniqueList.push(item);
              if (uniqueList.length >= (stats?.total_candidates || 0)) break;
            }
          }
        }
      }
      list = uniqueList;
    } else if (statusFilter) {
      const sf = statusFilter.toLowerCase().trim();
      if (sf === "completed") {
        list = list.filter(i => 
          i.progress_status === "completed" || 
          ["completed", "selected", "rejected", "flagged"].includes((i.status || "").toLowerCase()) || 
          (i.overall_score !== null && i.overall_score !== undefined)
        );
      } else if (sf === "pending") {
        list = list.filter(i => 
          i.progress_status === "pending" || 
          ["pending", "sent", ""].includes((i.status || "").toLowerCase())
        );
      } else if (sf === "in_progress") {
        list = list.filter(i => 
          i.progress_status === "in_progress" || 
          (i.status || "").toLowerCase() === "in_progress"
        );
      } else if (sf === "selected") {
        list = list.filter(i => 
          i.hiring_decision === "selected" || 
          (i.status || "").toLowerCase() === "selected" || 
          (i.overall_score !== null && Number(i.overall_score) >= 60)
        );
      } else if (sf === "rejected") {
        list = list.filter(i => 
          i.hiring_decision === "rejected" || 
          (i.status || "").toLowerCase() === "rejected" || 
          (i.overall_score !== null && Number(i.overall_score) < 60)
        );
      } else if (sf === "under_review") {
        list = list.filter(i => 
          i.hiring_decision === "under_review" || 
          ((i.progress_status === "completed" || ["completed", "selected", "rejected", "flagged"].includes((i.status || "").toLowerCase())) && 
           (i.status || "").toLowerCase() !== "selected" && 
           (i.status || "").toLowerCase() !== "rejected" && 
           (i.status || "").toLowerCase() !== "flagged")
        );
      } else if (sf === "flagged") {
        list = list.filter(i => 
          i.integrity_status === "flagged" || 
          (i.status || "").toLowerCase() === "flagged"
        );
      } else if (sf === "clean") {
        list = list.filter(i => 
          i.integrity_status === "clean" || 
          ((i.progress_status === "completed" || ["completed", "selected", "rejected"].includes((i.status || "").toLowerCase())) && 
           (i.status || "").toLowerCase() !== "flagged")
        );
      } else {
        list = list.filter(i => 
          (i.status || "").toLowerCase() === sf ||
          i.progress_status === sf ||
          i.hiring_decision === sf ||
          i.integrity_status === sf
        );
      }
    }

    return list.filter(i => {
      if (scoreFilter) {
        const score = parseInt(i.score) || 0;
        if (scoreFilter === "90-100" && (score < 90 || score > 100)) return false;
        if (scoreFilter === "80-89" && (score < 80 || score >= 90)) return false;
        if (scoreFilter === "70-79" && (score < 70 || score >= 80)) return false;
        if (scoreFilter === "60-69" && (score < 60 || score >= 70)) return false;
        if (scoreFilter === "50-59" && (score < 50 || score >= 60)) return false;
        if (scoreFilter === "40-49" && (score < 40 || score >= 50)) return false;
        if (scoreFilter === "30-39" && (score < 30 || score >= 40)) return false;
        if (scoreFilter === "20-29" && (score < 20 || score >= 30)) return false;
        if (scoreFilter === "10-19" && (score < 10 || score >= 20)) return false;
        if (scoreFilter === "0-9" && (score < 0 || score >= 10)) return false;
      }

      const q = recentInterviewsSearch.toLowerCase().trim();
      if (q) {
        const matchesCand = (i.candidate_name || i.candidate || "Unknown").toLowerCase().includes(q);
        const matchesEmail = (i.candidate_email || "").toLowerCase().includes(q);
        const matchesRole = (i.role || "").toLowerCase().includes(q);
        const matchesRec = (i.recruiter || "").toLowerCase().includes(q);
        const matchesMgr = (i.manager || i.manager_name || "").toLowerCase().includes(q);
        if (!matchesCand && !matchesEmail && !matchesRole && !matchesRec && !matchesMgr) return false;
      }

      if (recentInterviewsDateRange && i.created_at) {
        const itemDate = new Date(i.created_at).getTime();
        if (!isNaN(itemDate)) {
          const now = new Date();
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const day = 24 * 60 * 60 * 1000;
          if (recentInterviewsDateRange === "today" && itemDate < todayStart) return false;
          if (recentInterviewsDateRange === "7days" && itemDate < todayStart - 6 * day) return false;
          if (recentInterviewsDateRange === "30days" && itemDate < todayStart - 29 * day) return false;
        }
      }
      return true;
    });
  }, [recentInterviews, statusFilter, managerFilter, recruiterFilter, scoreFilter, recentInterviewsSearch, recentInterviewsDateRange, stats?.total_candidates]);

  const recent10Interviews = useMemo(() => {
    return filteredInterviews.slice(0, 10);
  }, [filteredInterviews]);

  // Score Distribution Buckets (0-20%, 20-40%, 40-60%, 60-80%, 80-100%)
  // Calculated from completed interviews with non-null scores
  const scoreBuckets = useMemo(() => {
    const buckets = [
      { range: '0-20%', count: 0 },
      { range: '20-40%', count: 0 },
      { range: '40-60%', count: 0 },
      { range: '60-80%', count: 0 },
      { range: '80-100%', count: 0 },
    ];

    if (!recentInterviews || recentInterviews.length === 0) return buckets;

    for (const item of recentInterviews) {
      const isCompleted = item.progress_status === 'completed' || 
        ['completed', 'selected', 'rejected', 'flagged'].includes((item.status || '').toLowerCase());
      if (!isCompleted) continue;

      const rawScore = item.overall_score ?? item.score;
      if (rawScore === null || rawScore === undefined || rawScore === '' || isNaN(Number(rawScore))) {
        continue;
      }

      const score = Math.min(100, Math.max(0, Number(rawScore)));
      if (score >= 0 && score < 20) {
        buckets[0].count++;
      } else if (score >= 20 && score < 40) {
        buckets[1].count++;
      } else if (score >= 40 && score < 60) {
        buckets[2].count++;
      } else if (score >= 60 && score < 80) {
        buckets[3].count++;
      } else if (score >= 80 && score <= 100) {
        buckets[4].count++;
      }
    }

    return buckets;
  }, [recentInterviews]);

  const maxScoreBucketCount = useMemo(() => {
    return Math.max(...scoreBuckets.map(b => b.count), 1);
  }, [scoreBuckets]);

  const totalScoredInterviews = useMemo(() => {
    return scoreBuckets.reduce((acc, b) => acc + b.count, 0);
  }, [scoreBuckets]);

  useEffect(() => {
    if (user?.role === 'manager') {
      setDisplayRecruiters(recruiters || []);
    } else if (user?.role === 'admin') {
      if (managerFilter) {
        const manager = managers.find((m: any) => m.full_name === managerFilter);
        if (manager) {
          getAdminManagerRecruiters(manager.id)
            .then(setDisplayRecruiters)
            .catch(console.error);
        }
      } else {
        setDisplayRecruiters(recruiters || []);
        setRecruiterFilter("");
      }
    }
  }, [managerFilter, recruiters, user?.role, managers]);

  useEffect(() => {
    // Wait for the backend /auth/v1/user sync to finish so we use the authoritative role
    if (user && roleResolved) {
      loadInitialData();
    }
  }, [user?.id, user?.role, roleResolved]);

  /** Normalize operational-table rows to the same shape the template expects */
  const normalizeInterviewRow = (row: any) => {
    const rawName = (row.candidate_name || row.candidate || row.name || "").trim();
    const rawEmail = (row.candidate_email || row.email || "").trim();
    const placeholders = ["unknown", "null", "none", "unknown candidate", "unassigned candidate", "unassigned (invite pending)", "candidate", "n/a"];
    const isUnassigned = !rawName || placeholders.includes(rawName.toLowerCase());
    const validEmail = rawEmail && !placeholders.includes(rawEmail.toLowerCase()) ? rawEmail : null;
    let displayName = isUnassigned
      ? (validEmail ? validEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : "Unknown")
      : rawName;
    if (displayName.includes('@')) {
      const prefix = displayName.split('@')[0].replace(/[._-]/g, ' ');
      displayName = prefix.replace(/\b\w/g, c => c.toUpperCase()) || "Candidate";
    }

    const rawStatus = (row.status || "").toLowerCase().trim();
    const scoreVal = row.overall_score ?? row.score ?? null;
    const hasViolations = Boolean(row.violation_screenshot && row.violation_screenshot.length > 0) || rawStatus === "flagged";

    // 1. Progress Status (pending, in_progress, completed)
    const progressStatus = row.progress_status || (
      ["completed", "selected", "rejected", "flagged"].includes(rawStatus) || (scoreVal !== null && scoreVal !== undefined)
        ? "completed"
        : rawStatus === "in_progress"
        ? "in_progress"
        : "pending"
    );

    // 2. Hiring Decision (selected, rejected, under_review, None)
    const hiringDecision = row.hiring_decision || (
      progressStatus === "completed"
        ? (rawStatus === "selected" || (scoreVal !== null && Number(scoreVal) >= 60 && rawStatus !== "rejected")
            ? "selected"
            : rawStatus === "rejected" || (scoreVal !== null && Number(scoreVal) < 60 && rawStatus !== "selected")
            ? "rejected"
            : "under_review")
        : null
    );

    // 3. Integrity Status (flagged, clean, None)
    const integrityStatus = row.integrity_status || (
      progressStatus === "completed"
        ? (rawStatus === "flagged" ? "flagged" : "clean")
        : null
    );

    return {
      ...row,
      candidate: displayName,
      candidate_name: displayName,
      is_unassigned: isUnassigned,
      overall_score: scoreVal,
      score: scoreVal,
      created_at: row.created_at ?? row.date ?? null,
      progress_status: progressStatus,
      hiring_decision: hiringDecision,
      integrity_status: integrityStatus,
    };
  };

  /** Load candidates for a specific recruiter from the backend */
  const loadRecruiterCandidates = async (recruiterId: string) => {
    setDrillDownLoading(true);
    try {
      const data = await getAdminOperationalTable({ recruiter_id: recruiterId });
      const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : [];
      setRecentInterviews(rows.map(normalizeInterviewRow));
    } catch (err: any) {
      console.error("Failed to load recruiter candidates:", err);
      toast({ title: "Error", description: "Failed to load recruiter candidates", variant: "destructive" });
    } finally {
      setDrillDownLoading(false);
    }
  };

  /** Clear recruiter scope and reload all candidates */
  const clearRecruiterScope = async () => {
    if (selectedRecruiterId) {
      setSelectedRecruiterId(null);
      setRecruiterFilter("");
      setDrillDownLoading(true);
      try {
        const data = await getAdminOperationalTable();
        const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : [];
        setRecentInterviews(rows.map(normalizeInterviewRow));
      } catch (err: any) {
        console.error("Failed to reload all candidates:", err);
      } finally {
        setDrillDownLoading(false);
      }
    }
  };

  useEffect(() => {
    if (view === "overview" && selectedRecruiterId) {
      clearRecruiterScope();
    }
  }, [view, selectedRecruiterId]);

  const loadInitialData = async () => {
    if (!user) return;
    if (!dashboardCache.stats) {
      setIsLoading({ stats: true, hierarchy: true, trends: true, leaderboard: true, pipeline: true, table: true });
    }
    try {
      if (user?.role === 'recruiter') {
        getRecruiterStats().then(s => {
          setStats(s);
          dashboardCache.stats = s;
          try { sessionStorage.setItem("dashboard_cache_stats", JSON.stringify(s)); } catch {}
          setIsLoading(p => ({...p, stats: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, stats: false})); });

        getAdminTrends(14).then(t => {
          setTrends(t);
          dashboardCache.trends = t;
          setIsLoading(p => ({...p, trends: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, trends: false})); });

        getAdminPipeline().then(p => {
          setPipeline(p);
          dashboardCache.pipeline = p;
          try { sessionStorage.setItem("dashboard_cache_pipeline", JSON.stringify(p)); } catch {}
          setIsLoading(p => ({...p, pipeline: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, pipeline: false})); });

        getAdminOperationalTable().then(i => {
          const rows = Array.isArray(i) ? i : Array.isArray((i as any)?.data) ? (i as any).data : [];
          const normalized = rows.map(normalizeInterviewRow);
          setRecentInterviews(normalized);
          dashboardCache.recentInterviews = normalized;
          try { sessionStorage.setItem("dashboard_cache_interviews", JSON.stringify(normalized.slice(0, 50))); } catch {}
          setIsLoading(p => ({...p, table: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, table: false})); });

        getAdminManagers().then(m => {
          setManagers(m);
          dashboardCache.managers = m;
        }).catch(console.error);
        setIsLoading(p => ({...p, hierarchy: false, leaderboard: false}));
      } else {
        getAdminDashboardStats().then(s => {
          setStats(s);
          dashboardCache.stats = s;
          try { sessionStorage.setItem("dashboard_cache_stats", JSON.stringify(s)); } catch {}
          setIsLoading(p => ({...p, stats: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, stats: false})); });

        getAdminManagers().then(m => {
          setManagers(m);
          dashboardCache.managers = m;
          setIsLoading(p => ({...p, hierarchy: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, hierarchy: false})); });

        getAdminTrends(14).then(t => {
          setTrends(t);
          dashboardCache.trends = t;
          setIsLoading(p => ({...p, trends: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, trends: false})); });

        getAdminLeaderboard().then(l => {
          setLeaderboard(l);
          dashboardCache.leaderboard = l;
          setIsLoading(p => ({...p, leaderboard: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, leaderboard: false})); });

        getAdminPipeline().then(p => {
          setPipeline(p);
          dashboardCache.pipeline = p;
          try { sessionStorage.setItem("dashboard_cache_pipeline", JSON.stringify(p)); } catch {}
          setIsLoading(p => ({...p, pipeline: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, pipeline: false})); });

        getAdminOperationalTable().then(i => {
          const rows = Array.isArray(i) ? i : Array.isArray((i as any)?.data) ? (i as any).data : [];
          const normalized = rows.map(normalizeInterviewRow);
          setRecentInterviews(normalized);
          dashboardCache.recentInterviews = normalized;
          try { sessionStorage.setItem("dashboard_cache_interviews", JSON.stringify(normalized.slice(0, 50))); } catch {}
          setIsLoading(p => ({...p, table: false}));
        }).catch(err => { console.error(err); setIsLoading(p => ({...p, table: false})); });

        if (user?.role === 'manager' && user?.id) {
          getAdminManagerRecruiters(user.id).then(r => {
            setRecruiters(r);
            dashboardCache.recruiters = r;
          }).catch(console.error);
        } else if ((user?.role === 'admin' || user?.role === 'super_admin') && user?.id) {
          getAdminManagerRecruiters("all").then(r => {
            setRecruiters(r);
            dashboardCache.recruiters = r;
          }).catch(console.error);
        }
      }
    } catch (err: any) {
      console.error("Dashboard sync error:", err);
      toast({ 
        title: "Error", 
        description: err.message || "Failed to sync dashboard data", 
        variant: "destructive" 
      });
    }
  };

  const handleSelectCandidate = (candidate: any) => {
    navigate(`/results?id=${candidate.id}`);
  };

  const formatVideoTime = (secs: number) => {
    if (isNaN(secs)) return "00:00";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setVideoCurrentTime(videoRef.current.currentTime);
      const dur = videoRef.current.duration;
      if (dur && dur !== Infinity && !isNaN(dur) && videoDuration !== dur) {
        setVideoDuration(dur);
      }
    }
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
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
  };

  const handleSeek = (newTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setVideoCurrentTime(newTime);
    }
  };

  const skipTime = (amount: number) => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      const actualDur = (dur && dur !== Infinity && !isNaN(dur)) ? dur : videoDuration;
      if (actualDur > 0) {
        videoRef.current.currentTime = Math.max(0, Math.min(actualDur, videoRef.current.currentTime + amount));
      } else {
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + amount);
      }
    }
  };

  const handleAddRecruiterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRecruiterEmail.trim() || !newRecruiterName.trim()) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    if (!user?.tenant_id) {
      toast({ title: "Error", description: "Tenant context not found", variant: "destructive" });
      return;
    }
    setIsSubmittingRecruiter(true);
    try {
      await adminAddMember(
        newRecruiterEmail.trim(),
        'recruiter',
        user.tenant_id,
        user.id,
        newRecruiterName.trim()
      );
      toast({ title: "Recruiter Added", description: `Successfully invited ${newRecruiterName}` });
      setShowAddRecruiterModal(false);
      setNewRecruiterEmail("");
      setNewRecruiterName("");
      // Refresh the recruiter list
      loadInitialData();
    } catch (err: any) {
      toast({ title: "Error Adding Recruiter", description: err.message || "Failed to add recruiter", variant: "destructive" });
    } finally {
      setIsSubmittingRecruiter(false);
    }
  };

  const handleViewRecording = async (interviewId: string, candidateName?: string) => {
    try {
      setRecordingInterviewId(interviewId);
      setRecordingCandidateName(candidateName || null);
      const res = await getRecruiterInterviewRecording(interviewId);
      let url = res.video_url;

      // Handle local storage relative paths
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

  const handleDownloadRecording = async (candidateInterviewId?: string, candidateName?: string) => {
    const targetId = candidateInterviewId || recordingInterviewId || (selectedCandidate ? selectedCandidate.id : null);
    const resolvedName = candidateName || recordingCandidateName || selectedCandidate?.candidate_name || 'Candidate';
    const safeName = resolvedName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const defaultFilename = `Interview_Recording_${safeName}_${targetId ? targetId.substring(0, 8) : 'proctored'}.webm`;

    try {
      setIsDownloadingRecording(true);
      toast({ title: "Downloading Recording", description: `Preparing download for ${resolvedName}...` });

      // Always fetch directly from backend streaming download endpoint (ensures webm_fixer seekable duration & cues)
      if (targetId) {
        const token = localStorage.getItem("xeviewer_token") || "";
        const apiUrl = BASE.replace(/\/api$/, "");
        const downloadEndpoint = `${apiUrl}/api/recruiter/interview/${targetId}/recording/download`;

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

      // 3. Fallback if targetId is missing but videoUrl exists directly
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

  const handleViewReport = async (interviewId: string) => {
    try {
      const res = await getRecruiterInterviewReport(interviewId);
      setReportData(res);
      setShowReport(true);
    } catch (err) {
      toast({ title: "Error", description: "Could not load AI report", variant: "destructive" });
    }
  };

  const handleDeleteCandidate = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this candidate profile? This action cannot be undone.")) return;
    try {
      await deleteInterview(id);
      toast({ title: "Success", description: "Candidate profile deleted successfully" });
      loadInitialData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to delete candidate profile", variant: "destructive" });
    }
  };

  const handleViewScreenshot = (interview: any) => {
    const rawScreenshots = interview.violation_screenshot;
    if (rawScreenshots) {
      let urls: string[] = [];
      if (Array.isArray(rawScreenshots)) {
        urls = rawScreenshots;
      } else if (typeof rawScreenshots === 'string') {
        // If it looks like a JSON array string, parse it
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

      const serverUrl = import.meta.env.VITE_API_BASE_URL
        ? import.meta.env.VITE_API_BASE_URL.replace(/\/api$/, "")
        : "http://localhost:8000";
        
      const resolvedUrls = urls.map((item: any) => {
        const urlStr = typeof item === 'string' ? item : item.url;
        if (urlStr && typeof urlStr === 'string' && urlStr.startsWith('/')) {
          return `${serverUrl}${urlStr}`;
        }
        return urlStr;
      }).filter(Boolean);

      if (resolvedUrls.length > 0) {
        setScreenshotUrls(resolvedUrls);
        setCurrentScreenshotIndex(0);
        setScreenshotCandidate(interview);
        setShowScreenshot(true);
      } else {
        toast({
          title: "No Screenshot Available",
          description: "This flagged interview does not have a recorded violation screenshot.",
          variant: "default"
        });
      }
    } else {
      toast({
        title: "No Screenshot Available",
        description: "This flagged interview does not have a recorded violation screenshot.",
        variant: "default"
      });
    }
  };

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-background text-foreground selection:bg-primary/30 overflow-hidden">
      <Navbar />

      <main className="flex-1 min-h-0 flex flex-col pt-16 overflow-hidden">
        {/* Fixed Header */}
        <header className="bg-background z-20 px-4 sm:px-6 lg:px-8 py-4 border-b border-border/10 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-3 w-full max-w-full min-w-0">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
              {user?.role === 'recruiter' ? 'Recruiter Dashboard' : user?.role === 'manager' ? 'Manager Dashboard' : 'Admin Dashboard'}
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm font-medium mt-0.5 truncate">Manage interviews and review candidate performance</p>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <div className="flex items-center gap-1 card-elevated p-1 bg-background rounded-[8px] shrink-0">
              {user?.role === 'admin' ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("overview")}
                    className={`rounded-[8px] h-8 px-3 sm:px-3.5 text-xs font-semibold transition-all ${view === 'overview' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                  >
                    Overview
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("hierarchy")}
                    className={`rounded-[8px] h-8 px-3 sm:px-3.5 text-xs font-semibold transition-all ${view === 'hierarchy' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                  >
                    Hierarchy
                  </Button>
                  {/* Candidates module commented out per request
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { clearRecruiterScope(); setView("operational"); }}
                    className={`rounded-[8px] h-8 px-3 sm:px-3.5 text-xs font-semibold transition-all ${view === 'operational' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                  >
                    Candidates
                  </Button>
                  */}
                </>
              ) : user?.role === 'manager' ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("overview")}
                    className={`rounded-[8px] h-8 px-3 sm:px-3.5 text-xs font-semibold transition-all ${view === 'overview' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                  >
                    Overview
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("recruiters")}
                    className={`rounded-[8px] h-8 px-3 sm:px-3.5 text-xs font-semibold transition-all ${view === 'recruiters' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                  >
                    My Team
                  </Button>
                  {/* Candidates module commented out per request
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { clearRecruiterScope(); setView("operational"); }}
                    className={`rounded-[8px] h-8 px-3 sm:px-3.5 text-xs font-semibold transition-all ${view === 'operational' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                  >
                    Candidates
                  </Button>
                  */}
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("overview")}
                    className={`rounded-[8px] h-8 px-3 sm:px-3.5 text-xs font-semibold transition-all ${view === 'overview' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                  >
                    Overview
                  </Button>
                  {/* Candidates module commented out per request
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("operational")}
                    className={`rounded-[8px] h-8 px-3 sm:px-3.5 text-xs font-semibold transition-all ${view === 'operational' ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'}`}
                  >
                    Candidates
                  </Button>
                  */}
                </>
              )}
            </div>

            <Button
              variant="hero"
              className="rounded-[8px] h-8 sm:h-9 px-3 sm:px-3.5 gap-1.5 shadow-sm shadow-primary/20 font-bold text-xs shrink-0"
              onClick={() => navigate('/interview')}
            >
              <Plus size={15} /> New Interview
            </Button>
          </div>
        </header>

        {/* Scrollable Content Container */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 lg:px-8 py-5 z-10 w-full max-w-full min-w-0">
          <div className="max-w-7xl mx-auto w-full min-w-0">
            <AnimatePresence>
              {view === "overview" && (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-8"
                >
                  {/* Consolidated Dashboard Overview */}
                  {/* Top Level: Section 1 (Interview Progress) & Pipeline Funnel */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Section 1: Interview Progress & Volume (col-span-8) */}
                    <div className="lg:col-span-8 card-elevated rounded-[8px] border border-border/50 bg-background/60 p-4 sm:p-5 flex flex-col justify-between shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-border/30 min-h-[54px]">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-foreground tracking-tight">Interview Status Overview</h2>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">Execution status across all created invitations and sessions</p>
                        </div>
                        <div className="flex items-center gap-2.5 bg-muted/40 px-3 h-8 rounded-[8px] border border-border/40 shrink-0 self-start sm:self-start sm:mt-0.5">
                          <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Completion Rate:</span>
                          {isLoading.stats || !stats ? (
                            <div className="h-4 w-10 bg-muted/80 rounded-[4px] animate-pulse" />
                          ) : (
                            <span className="text-xs font-bold text-foreground whitespace-nowrap">{stats?.completion_rate || 0}%</span>
                          )}
                          <div className="h-2 w-20 sm:w-24 bg-muted rounded-full overflow-hidden shrink-0">
                            <div
                              className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                              style={{ width: `${Math.min(100, stats?.completion_rate || 0)}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* 4 Progress KPI Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3.5">
                        {[
                          {
                            id: null,
                            label: "Total interviews",
                            val: stats?.total_interviews,
                            subtext: "All scheduled & invites",
                            icon: Users,
                            borderActive: "border-primary/50",
                            bgActive: "bg-primary/[0.04]",
                            ringActive: "ring-primary/20",
                            text: "text-primary",
                            bgIcon: "bg-primary/10",
                            borderIcon: "border-primary/20",
                            badge: null
                          },
                          {
                            id: 'pending',
                            label: "Pending",
                            val: stats?.pending_interviews,
                            subtext: "Awaiting candidate",
                            icon: Clock,
                            borderActive: "border-amber-500/50",
                            bgActive: "bg-amber-500/[0.04]",
                            ringActive: "ring-amber-500/20",
                            text: "text-amber-500",
                            bgIcon: "bg-amber-500/10",
                            borderIcon: "border-amber-500/20",
                            badge: null
                          },
                          {
                            id: 'in_progress',
                            label: "In progress",
                            val: stats?.in_progress_count,
                            subtext: "Active live sessions",
                            icon: Activity,
                            borderActive: "border-blue-500/50",
                            bgActive: "bg-blue-500/[0.04]",
                            ringActive: "ring-blue-500/20",
                            text: "text-blue-500",
                            bgIcon: "bg-blue-500/10",
                            borderIcon: "border-blue-500/20",
                            badge: null
                          },
                          {
                            id: 'completed',
                            label: "Completed",
                            val: stats?.completed_interviews,
                            subtext: "Finished interviews",
                            icon: CheckCircle2,
                            borderActive: "border-emerald-500/50",
                            bgActive: "bg-emerald-500/[0.04]",
                            ringActive: "ring-emerald-500/20",
                            text: "text-emerald-500",
                            bgIcon: "bg-emerald-500/10",
                            borderIcon: "border-emerald-500/20",
                            badge: stats && stats.completed_interviews > 0 && stats.completed_interviews === stats.total_interviews ? "All finished" : null
                          },
                        ].map((card, i) => {
                          const isActive = statusFilter === card.id;
                          return (
                            <motion.div
                              key={i}
                              whileHover={{ y: -2, scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                              onClick={() => handleKpiCardClick(card.id)}
                              className={`card-elevated p-3 border transition-all duration-300 cursor-pointer rounded-[8px] relative group flex flex-col justify-between overflow-hidden shadow-sm ${
                                isActive
                                  ? `${card.borderActive} ${card.bgActive} ring-2 ${card.ringActive} shadow-md`
                                  : 'border-border/50 hover:border-primary/40 bg-background hover:bg-secondary/5'
                              }`}
                            >
                              <div className="flex items-center justify-between relative z-10">
                                <div className={`h-8 w-8 rounded-[8px] ${card.bgIcon} flex items-center justify-center ${card.text} shadow-sm border ${card.borderIcon} group-hover:scale-105 transition-transform`}>
                                  <card.icon size={15} />
                                </div>
                                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              <div className="mt-2.5 relative z-10">
                                {isLoading.stats || !stats ? (
                                  <div className="h-7 w-16 bg-muted/80 rounded-[8px] animate-pulse my-0.5" />
                                ) : (
                                  <p className="text-2xl font-extrabold tracking-tight text-foreground leading-none">{card.val ?? 0}</p>
                                )}
                                <p className="text-xs font-semibold text-foreground/90 mt-1">{card.label}</p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Score Distribution Chart (col-span-4) */}
                    <div className="lg:col-span-4 card-elevated border border-border/50 rounded-[8px] bg-background/60 p-4 sm:p-5 flex flex-col justify-between shadow-sm">
                      <div className="flex items-start justify-between pb-3 border-b border-border/30 min-h-[54px]">
                        <div>
                          <h3 className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-primary" />
                            Score Distribution
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">Candidate scores across completed interviews</p>
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col justify-end pt-3">
                        {(isLoading.stats || isLoading.table || !stats) ? (
                          <SkeletonChart />
                        ) : totalScoredInterviews === 0 ? (
                          <div className="h-full min-h-[105px] flex flex-col items-center justify-center text-center p-2">
                            <BarChart3 className="h-7 w-7 text-muted-foreground/30 mb-1.5" />
                            <p className="text-xs font-semibold text-muted-foreground">No scored interviews yet</p>
                            <p className="text-[11px] text-muted-foreground/50 mt-0.5">Completed interviews with scores will appear here</p>
                          </div>
                        ) : (
                          <div className="w-full">
                            <div className="grid grid-cols-5 gap-2 sm:gap-2.5 items-end h-[105px]">
                              {scoreBuckets.map((bucket, idx) => {
                                const heightPercent = bucket.count > 0 
                                  ? Math.max(10, Math.round((bucket.count / maxScoreBucketCount) * 100))
                                  : 0;
                                const sharePercent = totalScoredInterviews > 0 
                                  ? Math.round((bucket.count / totalScoredInterviews) * 100) 
                                  : 0;
                                return (
                                  <div 
                                    key={idx} 
                                    className="flex flex-col items-center justify-end h-full group"
                                    title={`${bucket.range}: ${bucket.count} candidate${bucket.count === 1 ? '' : 's'} (${sharePercent}%)`}
                                  >
                                    {/* Count label above bar */}
                                    <span className={`text-[11px] sm:text-xs font-bold mb-1 tabular-nums transition-colors ${
                                      bucket.count > 0 ? 'text-foreground group-hover:text-primary' : 'text-muted-foreground/40'
                                    }`}>
                                      {bucket.count}
                                    </span>

                                    {/* Bar Track & Fill */}
                                    <div className="w-full h-[64px] bg-secondary/40 dark:bg-secondary/20 rounded-[6px] p-0.5 flex flex-col justify-end overflow-hidden border border-border/20 group-hover:border-primary/30 transition-colors">
                                      <motion.div
                                        initial={{ height: 0 }}
                                        animate={{ height: `${heightPercent}%` }}
                                        transition={{ duration: 0.5, ease: "easeOut", delay: idx * 0.04 }}
                                        className={`w-full rounded-[4px] bg-primary group-hover:bg-primary/90 transition-colors ${
                                          bucket.count === 0 ? 'hidden' : ''
                                        }`}
                                      />
                                    </div>

                                    {/* Range label below bar */}
                                    <span className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground mt-1.5 text-center whitespace-nowrap block group-hover:text-foreground transition-colors">
                                      {bucket.range}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Mid Level: Candidate Outcomes & Proctoring/Integrity */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Section 2: Candidate Outcomes & Decisions (col-span-7) */}
                    <div className="lg:col-span-7 card-elevated rounded-[8px] border border-border/50 bg-background/60 p-4 sm:p-5 flex flex-col justify-between shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-border/30 min-h-[54px]">
                        <div>
                          <div className="flex items-center gap-2">
                            <Award className="h-4 w-4 text-emerald-500" />
                            <h2 className="text-base font-bold text-foreground tracking-tight">Candidate Outcomes</h2>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">AI evaluation performance & hiring choices on completed tests</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-start sm:mt-0.5">
                          <span className="h-7 px-2.5 rounded-[8px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-bold flex items-center justify-center whitespace-nowrap">
                            {isLoading.stats || !stats ? "Selection Rate: ...%" : `Selection Rate: ${stats?.selection_rate || 0}%`}
                          </span>
                        </div>
                      </div>

                      {/* 4 Outcome Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3.5">
                        {[
                          {
                            id: 'selected',
                            label: "Selected",
                            val: stats?.selected_candidates,
                            subtext: "Met cutoff (≥60%)",
                            icon: Award,
                            borderActive: "border-emerald-500/50",
                            bgActive: "bg-emerald-500/[0.04]",
                            ringActive: "ring-emerald-500/20",
                            text: "text-emerald-500",
                            bgIcon: "bg-emerald-500/10",
                            borderIcon: "border-emerald-500/20"
                          },
                          {
                            id: 'rejected',
                            label: "Rejected",
                            val: stats?.rejected_candidates,
                            subtext: "Below score cutoff",
                            icon: XCircle,
                            borderActive: "border-rose-500/50",
                            bgActive: "bg-rose-500/[0.04]",
                            ringActive: "ring-rose-500/20",
                            text: "text-rose-500",
                            bgIcon: "bg-rose-500/10",
                            borderIcon: "border-rose-500/20"
                          },
                          {
                            id: 'under_review',
                            label: "Under review",
                            val: stats?.under_review_count,
                            subtext: "Awaiting decision",
                            icon: HelpCircle,
                            borderActive: "border-violet-500/50",
                            bgActive: "bg-violet-500/[0.04]",
                            ringActive: "ring-violet-500/20",
                            text: "text-violet-500",
                            bgIcon: "bg-violet-500/10",
                            borderIcon: "border-violet-500/20"
                          },
                          {
                            id: null,
                            label: "Average score",
                            val: stats?.avg_score !== undefined && stats?.avg_score !== null ? `${stats.avg_score}%` : null,
                            subtext: "Scored candidate avg",
                            icon: Brain,
                            borderActive: "border-indigo-500/50",
                            bgActive: "bg-indigo-500/[0.04]",
                            ringActive: "ring-indigo-500/20",
                            text: "text-indigo-500",
                            bgIcon: "bg-indigo-500/10",
                            borderIcon: "border-indigo-500/20",
                            isMetricOnly: true
                          },
                        ].map((card, i) => {
                          const isActive = card.id && statusFilter === card.id;
                          return (
                            <motion.div
                              key={i}
                              whileHover={card.isMetricOnly ? {} : { y: -2, scale: 1.01 }}
                              whileTap={card.isMetricOnly ? {} : { scale: 0.99 }}
                              onClick={card.isMetricOnly ? undefined : () => handleKpiCardClick(card.id)}
                              className={`card-elevated p-3 border transition-all duration-300 rounded-[8px] relative group flex flex-col justify-between overflow-hidden shadow-sm ${
                                card.isMetricOnly ? 'cursor-default' : 'cursor-pointer'
                              } ${
                                isActive
                                  ? `${card.borderActive} ${card.bgActive} ring-2 ${card.ringActive} shadow-md`
                                  : 'border-border/50 hover:border-primary/40 bg-background hover:bg-secondary/5'
                              }`}
                            >
                              <div className="flex items-center justify-between relative z-10">
                                <div className={`h-8 w-8 rounded-[8px] ${card.bgIcon} flex items-center justify-center ${card.text} shadow-sm border ${card.borderIcon} group-hover:scale-105 transition-transform`}>
                                  <card.icon size={15} />
                                </div>
                                {!card.isMetricOnly && (
                                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                )}
                              </div>
                              <div className="mt-2.5 relative z-10">
                                {isLoading.stats || !stats ? (
                                  <div className="h-7 w-16 bg-muted/80 rounded-[8px] animate-pulse my-0.5" />
                                ) : (
                                  <p className="text-2xl font-extrabold tracking-tight text-foreground leading-none">{card.val ?? 0}</p>
                                )}
                                <p className="text-xs font-semibold text-foreground/90 mt-1">{card.label}</p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Section 3: Proctoring & Integrity Monitoring (col-span-5) */}
                    <div className="lg:col-span-5 card-elevated rounded-[8px] border border-border/50 bg-background/60 p-4 sm:p-5 flex flex-col justify-between shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-border/30 min-h-[54px]">
                        <div>
                          <div className="flex items-center gap-2">
                            <ShieldAlert className="h-4 w-4 text-red-500" />
                            <h2 className="text-base font-bold text-foreground tracking-tight">Proctoring Summary</h2>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">Biometric & anti-cheating tracking</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-start sm:mt-0.5">
                          <span className="h-7 px-2.5 rounded-[8px] bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 text-xs font-bold flex items-center justify-center whitespace-nowrap">
                            {isLoading.stats || !stats ? "...% Clean" : `${stats?.integrity_rate ?? 100}% Clean`}
                          </span>
                        </div>
                      </div>

                      {/* 2 Integrity Cards */}
                      <div className="grid grid-cols-2 gap-3 mt-3.5">
                        {[
                          {
                            id: 'flagged',
                            label: "Flagged alerts",
                            val: stats?.cheating_alert_count,
                            subtext: "Proctoring violations",
                            icon: AlertTriangle,
                            borderActive: "border-red-500/50",
                            bgActive: "bg-red-500/[0.04]",
                            ringActive: "ring-red-500/20",
                            text: "text-red-500",
                            bgIcon: "bg-red-500/10",
                            borderIcon: "border-red-500/20",
                            badge: "Review evidence"
                          },
                          {
                            id: 'clean',
                            label: "Verified clean",
                            val: stats?.clean_interviews_count,
                            subtext: "Zero flags detected",
                            icon: ShieldCheck,
                            borderActive: "border-teal-500/50",
                            bgActive: "bg-teal-500/[0.04]",
                            ringActive: "ring-teal-500/20",
                            text: "text-teal-500",
                            bgIcon: "bg-teal-500/10",
                            borderIcon: "border-teal-500/20",
                            badge: "Compliant"
                          },
                        ].map((card, i) => {
                          const isActive = statusFilter === card.id;
                          return (
                            <motion.div
                              key={i}
                              whileHover={{ y: -2, scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                              onClick={() => handleKpiCardClick(card.id)}
                              className={`card-elevated p-3 border transition-all duration-300 cursor-pointer rounded-[8px] relative group flex flex-col justify-between overflow-hidden shadow-sm ${
                                isActive
                                  ? `${card.borderActive} ${card.bgActive} ring-2 ${card.ringActive} shadow-md`
                                  : 'border-border/50 hover:border-primary/40 bg-background hover:bg-secondary/5'
                              }`}
                            >
                              <div className="flex items-center justify-between relative z-10">
                                <div className={`h-8 w-8 rounded-[8px] ${card.bgIcon} flex items-center justify-center ${card.text} shadow-sm border ${card.borderIcon} group-hover:scale-105 transition-transform`}>
                                  <card.icon size={15} />
                                </div>
                                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              <div className="mt-2.5 relative z-10">
                                {isLoading.stats || !stats ? (
                                  <div className="h-7 w-16 bg-muted/80 rounded-[8px] animate-pulse my-0.5" />
                                ) : (
                                  <p className="text-2xl font-extrabold tracking-tight text-foreground leading-none">{card.val ?? 0}</p>
                                )}
                                <p className="text-xs font-semibold text-foreground/90 mt-1">{card.label}</p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  </div>


                  {/* Recent Activity Section */}
                  <div
                    id="recent-interviews-section"
                    ref={recentInterviewsRef}
                    className={`card-elevated p-5 sm:p-7 border rounded-[8px] bg-background/50 transition-all duration-500 scroll-mt-6 ${
                      highlightFilter ? 'ring-2 ring-primary/50 shadow-lg border-primary/40 bg-primary/[0.02]' : 'border-border/50'
                    }`}
                  >
                    {/* Active Filter Notification Banner */}
                    {statusFilter && (
                      <div className="flex items-center justify-between p-3 px-4 rounded-[8px] bg-primary/10 border border-primary/30 mb-5 animate-in fade-in slide-in-from-top-1">
                        <div className="flex items-center gap-2.5">
                          <Filter className="h-4 w-4 text-primary shrink-0" />
                          <span className="text-xs sm:text-sm font-semibold text-foreground">
                            Active Filter:
                          </span>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-[8px] text-xs font-bold uppercase tracking-wider bg-primary text-primary-foreground">
                            {statusFilter === 'candidates' ? 'Unique Candidates' : statusFilter.replace('_', ' ')}
                          </span>
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            ({filteredInterviews.length} {filteredInterviews.length === 1 ? 'interview' : 'interviews'} found)
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatusFilter(null)}
                          className="h-7 px-2.5 text-xs font-bold text-primary hover:bg-primary/20 gap-1 rounded-[8px]"
                        >
                          <X className="h-3.5 w-3.5" /> Clear Filter
                        </Button>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <div className="flex items-center gap-2.5">
                        <Clock className="h-5 w-5 text-primary shrink-0" />
                        <h3 className="text-base font-bold tracking-tight text-foreground">
                          Recent Interviews
                        </h3>
                      </div>

                      <div className="relative group w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <input
                          placeholder="Search candidate, role, email..."
                          className="h-9 w-full rounded-[8px] bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 shadow-sm pl-9 pr-8 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all placeholder:text-muted-foreground"
                          value={recentInterviewsSearch}
                          onChange={(e) => setRecentInterviewsSearch(e.target.value)}
                        />
                        {recentInterviewsSearch && (
                          <button
                            type="button"
                            onClick={() => setRecentInterviewsSearch("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs p-0.5 rounded-full hover:bg-muted"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {(isLoading.table || drillDownLoading) ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <tbody className="divide-y divide-border/10">
                            {Array(5).fill(0).map((_, i) => <SkeletonRow key={i} />)}
                          </tbody>
                        </table>
                      </div>
                    ) : recentInterviews.length === 0 ? (
                      <EmptyState icon={Briefcase} title="No Interviews" description="Once created, interviews will appear here." />
                    ) : filteredInterviews.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-border rounded-[8px] bg-secondary/5 my-4">
                        <Search className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
                        <h3 className="text-lg font-bold text-foreground">No results found</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {statusFilter 
                            ? `We couldn't find any ${statusFilter === 'candidates' ? 'candidate' : statusFilter.replace('_', ' ')} interviews.`
                            : `We couldn't find any interviews matching "${recentInterviewsSearch}"`}
                        </p>
                        {statusFilter && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setStatusFilter(null)}
                            className="mt-4 font-semibold rounded-[8px]"
                          >
                            Clear filter
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-muted-foreground border-b border-border/30 text-xs sm:text-sm font-semibold">
                              <th className="pb-3 px-4 font-semibold text-left w-[24%] min-w-[200px]">Candidate</th>
                              <th className="pb-3 px-3 font-semibold text-left w-[13%] min-w-[130px]">Status</th>
                              <th className="pb-3 px-3 font-semibold text-left w-[14%] min-w-[130px]">Decision</th>
                              <th className="pb-3 px-3 font-semibold text-left w-[13%] min-w-[120px]">Proctoring</th>
                              <th className="pb-3 px-3 font-semibold text-left w-[12%] min-w-[110px]">Score</th>
                              <th className="pb-3 px-3 font-semibold text-left w-[11%] min-w-[100px]">Date</th>
                              <th className="pb-3 px-4 font-semibold text-right w-[13%] min-w-[130px]">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/10">
                            {recent10Interviews.map((interview) => {
                              const isRowActive = statusFilter && (
                                (interview.status || "").toLowerCase() === statusFilter.toLowerCase() ||
                                interview.progress_status === statusFilter.toLowerCase() ||
                                interview.hiring_decision === statusFilter.toLowerCase() ||
                                interview.integrity_status === statusFilter.toLowerCase()
                              );
                              return (
                                <tr key={interview.id} className={`hover:bg-primary/5 transition-colors group ${isRowActive && highlightFilter ? 'bg-primary/5' : ''}`}>
                                  <td className="py-3 px-4 align-middle min-w-[200px]">
                                    <div className="flex items-center gap-3">
                                      <div className={`h-8 w-8 rounded-[8px] flex items-center justify-center text-xs font-bold shrink-0 ${
                                        interview.is_unassigned ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary'
                                      }`}>
                                        {interview.is_unassigned ? '?' : interview.candidate_name?.charAt(0)?.toUpperCase()}
                                      </div>
                                      <div className="flex flex-col min-w-0">
                                        <span className="font-bold text-foreground group-hover:text-primary transition-colors truncate text-sm leading-tight">
                                          {interview.candidate_name}
                                        </span>
                                        {interview.role && (
                                          <div className="mt-0.5">
                                            <span className="inline-flex items-center px-1.5 py-0.5 bg-muted/60 text-[10px] rounded-[6px] text-foreground/80 font-medium whitespace-nowrap">
                                              {interview.role}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </td>

                                  {/* Status Column */}
                                  <td className="py-3 px-3 align-middle whitespace-nowrap min-w-[130px]">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-semibold border ${
                                      interview.progress_status === 'completed'
                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                        : interview.progress_status === 'in_progress'
                                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 animate-pulse'
                                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                    }`}>
                                      {interview.progress_status === 'completed' && <CheckCircle2 className="h-3 w-3" />}
                                      {interview.progress_status === 'in_progress' && <Activity className="h-3 w-3" />}
                                      {interview.progress_status === 'pending' && <Clock className="h-3 w-3" />}
                                      {interview.progress_status === 'completed' ? 'Completed' : interview.progress_status === 'in_progress' ? 'In progress' : 'Pending'}
                                    </span>
                                  </td>

                                  {/* Decision Column */}
                                  <td className="py-3 px-3 align-middle whitespace-nowrap min-w-[130px]">
                                    {interview.progress_status !== 'completed' ? (
                                      <span className="text-xs text-muted-foreground/60">—</span>
                                    ) : (
                                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-semibold border ${
                                        interview.hiring_decision === 'selected'
                                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                          : interview.hiring_decision === 'rejected'
                                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                                          : 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30'
                                      }`}>
                                        {interview.hiring_decision === 'selected' && <Check className="h-3 w-3" />}
                                        {interview.hiring_decision === 'rejected' && <X className="h-3 w-3" />}
                                        {interview.hiring_decision === 'under_review' && <Clock className="h-3 w-3" />}
                                        {interview.hiring_decision === 'selected' ? 'Selected' : interview.hiring_decision === 'rejected' ? 'Rejected' : 'Under Review'}
                                      </span>
                                    )}
                                  </td>

                                  {/* Proctoring Column */}
                                  <td className="py-3 px-3 align-middle whitespace-nowrap min-w-[120px]">
                                    {interview.progress_status !== 'completed' ? (
                                      <span className="text-xs text-muted-foreground/60">—</span>
                                    ) : interview.integrity_status === 'flagged' ? (
                                      <span
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleViewScreenshot(interview);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/25 cursor-pointer transition-colors"
                                        title="Click to view violation screenshot"
                                      >
                                        <AlertTriangle className="h-3 w-3" /> Flagged
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-semibold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                                        <ShieldCheck className="h-3 w-3" /> Clean
                                      </span>
                                    )}
                                  </td>

                                  {/* Score Column */}
                                  <td className="py-3 px-3 align-middle whitespace-nowrap min-w-[110px]">
                                    {interview.overall_score !== null && interview.overall_score !== undefined ? (
                                      <div className="flex items-center gap-2.5">
                                        <div className="h-1.5 w-12 bg-secondary rounded-full overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${
                                              Number(interview.overall_score) >= 70
                                                ? 'bg-emerald-500'
                                                : Number(interview.overall_score) >= 50
                                                ? 'bg-primary'
                                                : 'bg-rose-500'
                                            }`}
                                            style={{ width: `${Math.min(100, Math.max(0, Number(interview.overall_score)))}%` }}
                                          />
                                        </div>
                                        <span className={`text-xs font-bold tabular-nums ${
                                          Number(interview.overall_score) >= 70
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : Number(interview.overall_score) >= 50
                                            ? 'text-primary'
                                            : 'text-rose-600 dark:text-rose-400'
                                        }`}>
                                          {interview.overall_score}%
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* Date Column */}
                                  <td className="py-3 px-3 align-middle text-muted-foreground text-xs font-medium whitespace-nowrap min-w-[100px]">
                                    {interview.created_at ? new Date(interview.created_at).toLocaleDateString() : '—'}
                                  </td>

                                  {/* Actions Column */}
                                  <td className="py-3 px-4 align-middle text-right whitespace-nowrap min-w-[130px]">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2.5 rounded-[8px] hover:bg-primary/10 hover:text-primary font-bold gap-1 text-xs"
                                        onClick={() => handleSelectCandidate(interview)}
                                      >
                                        Results <ArrowUpRight size={13} />
                                      </Button>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="rounded-[8px] hover:bg-primary/10 hover:text-primary h-8 w-8">
                                            <MoreVertical size={15} />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-40 rounded-[8px]">
                                          {interview.video_url && (
                                            <DropdownMenuItem
                                              className="cursor-pointer rounded-[8px] font-medium text-xs text-primary focus:text-primary"
                                              onClick={() => handleViewRecording(interview.id, interview.candidate_name)}
                                            >
                                              <Play className="mr-2 h-3.5 w-3.5" />
                                              Watch Recording
                                            </DropdownMenuItem>
                                          )}
                                          <DropdownMenuItem
                                            className="cursor-pointer rounded-[8px] font-medium text-xs"
                                            onClick={() => {
                                              if (interview.interview_id) {
                                                navigate(`/admin/interviews/${interview.interview_id}`);
                                              } else {
                                                navigate(`/admin/interviews/${interview.id}`);
                                              }
                                            }}
                                          >
                                            <Eye className="mr-2 h-3.5 w-3.5" />
                                            View Details
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer rounded-[8px] font-medium text-xs"
                                            onClick={() => handleDeleteCandidate(interview.id)}
                                          >
                                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                                            Delete Profile
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Recent 10 Footer Action */}
                      {filteredInterviews.length > 0 && (
                        <div className="flex items-center justify-end mt-5 pt-4 border-t border-border/30">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate("/history")}
                            className="h-9 px-4 rounded-[8px] border-border/80 hover:bg-primary/10 hover:text-primary hover:border-primary/40 text-xs font-semibold gap-2 shadow-sm transition-all shrink-0"
                            title="Open full interview history and reports"
                          >
                            <span>View All Interviews</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  </div>
                </motion.div>
              )}

              {view === "recruiters" && (
                <motion.div
                  key="recruiters"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-6"
                >
                  {/* Team Management Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-8 bg-secondary/5 border border-border/40 rounded-md shadow-inner mb-6">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
                        <Users className="text-primary" size={24} /> My Recruiting Team
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1">Hire, onboard, and manage recruiters assigned to your tenant organization.</p>
                    </div>
                    {user?.role === 'admin' && (
                      <Button
                        variant="hero"
                        onClick={() => toast({
                          title: "Information",
                          description: "User onboarding is controlled by Scaloz. Please add recruiters in your Scaloz Workspace.",
                          variant: "default"
                        })}
                        className="rounded-md h-11 px-6 gap-2 font-bold shadow-lg shadow-primary/20"
                      >
                        <Plus size={18} /> Add Recruiter
                      </Button>
                    )}
                  </div>

                  {(!recruiters || recruiters.length === 0) ? (
                    <EmptyState
                      icon={Users}
                      title="No Recruiters Yet"
                      description="Start building your recruiting team to help run technical candidate assessments."
                      actionLabel={user?.role === 'admin' ? "Add Recruiter" : undefined}
                      onAction={user?.role === 'admin' ? () => toast({
                        title: "Information",
                        description: "User onboarding is controlled by Scaloz. Please add recruiters in your Scaloz Workspace.",
                        variant: "default"
                      }) : undefined}
                    />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {(recruiters || []).map((rec) => (
                        <div 
                          key={rec.id} 
                          className="card-elevated p-6 border border-border/50 rounded-md bg-secondary/5 space-y-4 group hover:bg-secondary/10 transition-all cursor-pointer"
                          onClick={async () => {
                            setSelectedRecruiterId(rec.id);
                            setRecruiterFilter(rec.full_name);
                            setView("operational");
                            await loadRecruiterCandidates(rec.id);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="h-12 w-12 rounded-md bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                              {rec.full_name.charAt(0)}
                            </div>

                          </div>
                          <div>
                            <h3 className="text-lg font-bold group-hover:text-primary transition-colors">{rec.full_name}</h3>
                            <p className="text-xs text-muted-foreground">{rec.email}</p>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="p-2 rounded-md bg-background/50 border border-border/30 text-center">
                              <p className="text-xs font-bold">{rec.completed_interviews}</p>
                              <p className="text-[10px] font-semibold text-muted-foreground">Done</p>
                            </div>
                            <div className="p-2 rounded-md bg-background/50 border border-border/30 text-center">
                              <p className="text-xs font-bold">{rec.total_interviews - rec.completed_interviews}</p>
                              <p className="text-[10px] font-semibold text-muted-foreground">Pending</p>
                            </div>
                            <div className="p-2 rounded-md bg-background/50 border border-border/30 text-center">
                              <p className="text-xs font-bold">{rec.total_interviews}</p>
                              <p className="text-[10px] font-semibold text-muted-foreground">Total</p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            className="w-full rounded-md gap-2 border-border/50"
                            onClick={async () => {
                              setSelectedRecruiterId(rec.id);
                              setRecruiterFilter(rec.full_name);
                              setView("operational");
                              await loadRecruiterCandidates(rec.id);
                            }}
                          >
                            View Candidates <ArrowUpRight size={14} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {view === "hierarchy" && user?.role === "admin" && (
                <motion.div
                  key="hierarchy"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-6"
                >
                  {/* Search & Filter Bar */}
                  <div className="flex flex-col md:flex-row gap-4 mb-8">
                    <div className="relative flex-1 group">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <input
                        type="text"
                        placeholder="Search managers..."
                        className="w-full pl-12 pr-4 h-14 bg-secondary/20 border border-border/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                        value={hierarchySearch}
                        onChange={(e) => setHierarchySearch(e.target.value)}
                      />
                    </div>
                  </div>

                  {isLoading.hierarchy ? (
                    <div className="space-y-6">
                      <SkeletonCard /><SkeletonCard /><SkeletonCard />
                    </div>
                  ) : managers.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      title="No Managers Found"
                      description="Start by creating a manager to manage recruiters and interviews."
                      actionLabel="Add Manager"
                      onAction={() => navigate("/admin")}
                    />
                  ) : (() => {
                    const filteredManagers = managers.filter(m => !hierarchySearch || (m.full_name || "").toLowerCase().includes(hierarchySearch.toLowerCase()) || (m.email || "").toLowerCase().includes(hierarchySearch.toLowerCase()));
                    return filteredManagers.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-border rounded-md bg-secondary/5">
                        <Search className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
                        <h3 className="text-lg font-bold text-foreground">No results found</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          We couldn't find any managers matching "{hierarchySearch}"
                        </p>
                      </div>
                    ) : (
                      <HierarchyView
                        managers={filteredManagers}
                        onSelectCandidate={handleSelectCandidate}
                        onRefresh={loadInitialData}
                      />
                    );
                  })()}
                </motion.div>
              )}

              {/* Candidates module commented out per request
              {view === "operational" && (
                <motion.div
                  key="operational"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="w-full min-w-0 max-w-full overflow-hidden"
                >
                  <OperationalTable 
                    onSelectCandidate={handleSelectCandidate} 
                    onViewScreenshot={handleViewScreenshot} 
                    onViewRecording={handleViewRecording}
                    onDeleteCandidate={handleDeleteCandidate}
                    onViewDetails={(id) => navigate(`/admin/interviews/${id}`)}
                    initialRecruiterId={selectedRecruiterId}
                    initialRecruiterName={recruiterFilter}
                    initialStatusFilter={operationalStatusFilter}
                    managersList={managers}
                    recruitersList={recruiters}
                  />
                </motion.div>
              )}
              */}

              {view === "candidate" && (
                <motion.div
                  key="candidate"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-6"
                >
                  {/* Breadcrumbs and Back Button */}
                  <div className="flex flex-col gap-4 mb-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <button
                        onClick={() => setView("overview")}
                        className="hover:text-foreground font-medium transition-colors"
                      >
                        Dashboard
                      </button>
                      <span>&rarr;</span>
                      <button
                        onClick={() => setView("operational")}
                        className="hover:text-foreground font-medium transition-colors"
                      >
                        Candidates
                      </button>
                      <span>&rarr;</span>
                      <span className="text-foreground font-semibold">Candidate Profile</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-md border border-border/50 hover:bg-secondary/20 gap-1 font-bold"
                        onClick={() => setView("overview")}
                      >
                        <ChevronLeft size={16} /> Back to Dashboard
                      </Button>
                    </div>
                  </div>
                  {drillDownLoading ? (
                    <div className="space-y-8">
                      <div className="h-40 w-full bg-secondary/10 rounded-md animate-pulse" />
                      <div className="grid grid-cols-3 gap-6">
                        <SkeletonCard /><SkeletonCard /><SkeletonCard />
                      </div>
                      <SkeletonChart />
                    </div>
                  ) : candidateResult ? (
                    <div className="space-y-8">
                      {/* Candidate Profile Header */}
                      <div className="card-elevated border border-border/50 rounded-md p-10 bg-secondary/5 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 blur-[120px] -mr-48 -mt-48 rounded-full" />

                        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                          <div className="space-y-4">
                            <div className={`px-4 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-[0.2em] w-fit ${candidateResult.status === 'flagged' ? 'bg-destructive/20 text-destructive' :
                              candidateResult.ai_score >= 70 ? 'bg-success/20 text-success' : 'bg-yellow-500/20 text-yellow-500'
                              }`}>
                              {candidateResult.status === 'flagged' ? 'AI Evaluation: Proctoring Violation' : `AI Evaluation: ${candidateResult.ai_score >= 70 ? 'Strong Candidate' : 'Qualified'}`}
                            </div>
                            <div>
                              <h2 className="text-5xl lg:text-6xl font-semibold tracking-tighter mb-2">{candidateResult.candidate_name}</h2>
                              <p className="text-2xl text-primary font-bold">{candidateResult.applied_role}</p>
                            </div>
                            <div className="flex flex-wrap gap-3">
                              <div className="px-4 py-2 bg-secondary/50 rounded-md border border-border/30 text-sm font-medium flex items-center gap-2">
                                <Users size={16} className="text-primary" /> {candidateResult.recruiter_name || user?.full_name}
                              </div>
                              <div className="px-4 py-2 bg-secondary/50 rounded-md border border-border/30 text-sm font-medium flex items-center gap-2">
                                <Clock size={16} className="text-blue-400" /> Duration: {candidateResult.interview_duration || "N/A"}
                              </div>
                              <div className="px-4 py-2 bg-secondary/50 rounded-md border border-border/30 text-sm font-medium flex items-center gap-2">
                                <Calendar size={16} className="text-primary" /> {candidateResult.interview_date ? new Date(candidateResult.interview_date).toLocaleDateString() : "N/A"}
                              </div>
                              <div className="px-4 py-2 bg-secondary/50 rounded-md border border-border/30 text-sm font-medium flex items-center gap-2">
                                <ShieldCheck size={16} className={candidateResult.id_verification_status === 'Verified' ? "text-success" : "text-yellow-500"} /> ID: {candidateResult.id_verification_status}
                              </div>
                            </div>
                          </div>

                          <div className="text-center lg:text-right space-y-2">
                            <div className={`text-8xl lg:text-9xl font-semibold leading-none tracking-tighter ${candidateResult.ai_score >= 70 ? 'text-success drop-shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'text-primary drop-shadow-[0_0_15px_rgba(155,135,245,0.3)]'
                              }`}>
                              {candidateResult.ai_score || 0}%
                            </div>
                            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">AI Match Score</p>
                          </div>
                        </div>
                      </div>

                      {/* Core Scores */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                          { label: "Technical Proficiency", score: candidateResult.technical_score, color: "from-blue-500 to-blue-400" },
                          { label: "Communication Skills", score: candidateResult.communication_score, color: "from-primary to-blue-400" },
                          { label: "Overall Fit", score: candidateResult.ai_score, color: "from-blue-500 to-cyan-400" },
                        ].map((s, i) => (
                          <div key={i} className="card-elevated p-8 border border-border/50 rounded-md bg-secondary/5 group hover:bg-secondary/10 transition-colors">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">{s.label}</p>
                            <div className="flex items-end justify-between mb-4">
                              <span className="text-5xl font-semibold tracking-tighter">{s.score || 0}%</span>
                              <div className="h-10 w-10 rounded-full bg-secondary/50 flex items-center justify-center group-hover:scale-110 transition-transform">
                                <ArrowUpRight size={20} className="text-primary" />
                              </div>
                            </div>
                            <div className="h-3 w-full bg-secondary/30 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${s.score || 0}%` }}
                                transition={{ duration: 1, delay: 0.5 }}
                                className={`h-full bg-gradient-to-r ${s.color}`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* AI Report & Evidence */}
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-8">
                          <div className="card-elevated p-10 border border-border/50 rounded-md bg-secondary/5">
                            <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                              <Brain size={24} className="text-primary" /> AI Evaluation Insights
                            </h3>
                            <div className="space-y-6 text-muted-foreground leading-relaxed">
                              <div className="p-6 rounded-md bg-primary/5 border border-primary/20">
                                <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-3">AI Recommendation</p>
                                <p className="text-lg italic text-foreground/90 font-medium leading-relaxed">
                                  "{candidateResult.ai_recommendation || "No assessment recommendation provided."}"
                                </p>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-3">
                                  <p className="text-xs font-semibold uppercase tracking-widest text-success">Key Strengths</p>
                                  <ul className="space-y-2">
                                    {['Excellent technical depth', 'Articulate communication', 'Problem-solving speed'].map((s, i) => (
                                      <li key={i} className="flex items-center gap-2 text-sm">
                                        <CheckCircle2 size={14} className="text-success" /> {s}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="space-y-3">
                                  <p className="text-xs font-semibold uppercase tracking-widest text-primary">Development Areas</p>
                                  <ul className="space-y-2">
                                    {['Could improve code optimization', 'Better edge case handling'].map((s, i) => (
                                      <li key={i} className="flex items-center gap-2 text-sm">
                                        <AlertCircle size={14} className="text-primary" /> {s}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-8">
                          <div className="card-elevated p-8 border border-border/50 rounded-md bg-secondary/5">
                            <h3 className="text-lg font-bold mb-6 flex items-center gap-3">
                              <ShieldCheck size={20} className="text-destructive" /> Integrity Analysis
                            </h3>
                            <div className="space-y-4">
                              {[
                                { label: "Device Detection", val: candidateResult.proctoring_alerts?.mobile || 0 },
                                { label: "Multiple People", val: candidateResult.proctoring_alerts?.multi_person || 0 },
                                { label: "Eye Gaze Anomalies", val: candidateResult.proctoring_alerts?.gaze || 0 },
                              ].map((item, i) => (
                                <div key={i} className="flex items-center justify-between p-4 rounded-md bg-background/50 border border-border/30">
                                  <span className="text-sm font-medium text-muted-foreground">{item.label}</span>
                                  <span className={`text-lg font-bold ${item.val > 2 ? 'text-destructive' : 'text-foreground'}`}>
                                    {item.val} Alerts
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="card-elevated p-8 border border-border/50 rounded-md bg-secondary/5">
                            <h3 className="text-lg font-bold mb-6 flex items-center gap-3">
                              <FileText size={20} className="text-primary" /> Recruiter Actions
                            </h3>
                            <div className="space-y-3">
                              <Button
                                variant="outline"
                                className="w-full h-14 rounded-md border-border/50 gap-3"
                                onClick={() => handleViewRecording(selectedCandidate.id)}
                                disabled={!candidateResult.video_url}
                              >
                                <Activity size={18} /> Watch Recording
                              </Button>
                              {candidateResult.video_url && (
                                <Button
                                  variant="outline"
                                  className="w-full h-14 rounded-md border-border/50 gap-3"
                                  onClick={() => handleDownloadRecording(selectedCandidate.id, candidateResult.candidate_name)}
                                  disabled={isDownloadingRecording}
                                >
                                  {isDownloadingRecording ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                                  {isDownloadingRecording ? "Downloading Recording..." : "Download Recording"}
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                className="w-full h-14 rounded-md border-border/50 gap-3"
                                onClick={() => handleViewReport(selectedCandidate.id)}
                              >
                                <Brain size={18} /> Detailed AI Report
                              </Button>
                              <Button variant="hero" className="w-full h-14 rounded-md gap-3">
                                <Download size={18} /> Download PDF
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      icon={AlertCircle}
                      title="Analysis Unavailable"
                      description="We couldn't retrieve the detailed evaluation for this candidate."
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Modals */}
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
                      <span className="text-zinc-200 font-semibold">
                        {recordingCandidateName || candidateResult?.candidate_name || selectedCandidate?.candidate_name || "Proctored Candidate"}
                      </span>
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
                      controls={true}
                      autoPlay
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
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

              {/* Custom Control Bar (Integrates into the modal itself) */}
              {videoUrl && (
                <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-900 flex flex-col gap-4">
                  {/* Timeline Slider */}
                  <div className="flex items-center gap-3.5 w-full">
                    <span className="text-[10px] font-mono text-zinc-400 min-w-[42px] text-right">
                      {formatVideoTime(videoCurrentTime)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 100}
                      step={0.1}
                      value={videoCurrentTime}
                      onChange={(e) => handleSeek(parseFloat(e.target.value))}
                      className="flex-1 h-1 bg-zinc-800 hover:h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 focus:outline-none transition-all duration-150"
                      style={{
                        background: `linear-gradient(to right, #00D2FF 0%, #00D2FF ${(videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0)}%, #27272a ${(videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0)}%, #27272a 100%)`
                      }}
                    />
                    <span className="text-[10px] font-mono text-zinc-400 min-w-[42px]">
                      {formatVideoTime(videoDuration)}
                    </span>
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center justify-between">
                    {/* Left: Skip & Playback controls */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => skipTime(-10)}
                        className="h-9 px-3.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white rounded-lg active:scale-95 transition-all text-xs font-semibold flex items-center gap-1.5"
                        title="Rewind 10 seconds"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
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
                        onClick={() => skipTime(10)}
                        className="h-9 px-3.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white rounded-lg active:scale-95 transition-all text-xs font-semibold flex items-center gap-1.5"
                        title="Forward 10 seconds"
                      >
                        +10s
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>

                    {/* Middle: Video length details */}
                    {candidateResult?.applied_role && (
                      <span className="hidden sm:inline-block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                        {candidateResult.applied_role} Assessment
                      </span>
                    )}

                    {/* Right: Quick Jump Controls */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mr-1.5">Jump:</span>
                      {[0.25, 0.5, 0.75].map((pct) => (
                        <button
                          key={pct}
                          onClick={() => {
                            const dur = videoRef.current?.duration;
                            const actualDur = (dur && dur !== Infinity && !isNaN(dur)) ? dur : videoDuration;
                            if (actualDur > 0) {
                              handleSeek(actualDur * pct);
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
                    onClick={() => handleDownloadRecording(recordingInterviewId || selectedCandidate?.id, recordingCandidateName || selectedCandidate?.candidate_name)}
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

        {showAddRecruiterModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border/50 rounded-md w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-border/30 flex items-center justify-between bg-secondary/10">
                <h3 className="text-xl font-bold flex items-center gap-3">
                  <Plus size={20} className="text-primary" /> Add New Recruiter
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAddRecruiterModal(false)}
                  className="rounded-full"
                >
                  <Plus className="rotate-45" />
                </Button>
              </div>

              <form onSubmit={handleAddRecruiterSubmit} className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Full Name</label>
                  <input
                    type="text"
                    placeholder="Enter full name"
                    value={newRecruiterName}
                    onChange={(e) => setNewRecruiterName(e.target.value)}
                    required
                    className="w-full px-4 h-12 bg-secondary/20 border border-border/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Email Address</label>
                  <input
                    type="email"
                    placeholder="Enter email address"
                    value={newRecruiterEmail}
                    onChange={(e) => setNewRecruiterEmail(e.target.value)}
                    required
                    className="w-full px-4 h-12 bg-secondary/20 border border-border/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                  />
                </div>

                <div className="p-4 rounded-md bg-primary/5 border border-primary/10 flex items-start gap-3">
                  <AlertCircle className="text-primary shrink-0 mt-0.5" size={16} />
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    An onboarding invite will be issued immediately to this email. A temporary account password (`Admin@123`) will be prepared for their initial sign-in.
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-md border-border/50"
                    onClick={() => setShowAddRecruiterModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmittingRecruiter}
                    className="rounded-md font-bold min-w-[100px]"
                  >
                    {isSubmittingRecruiter ? "Creating..." : "Add Recruiter"}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showReport && reportData && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card border border-border/50 rounded-md w-full max-w-2xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col"
            >
              <div className="p-8 border-b border-border/30 bg-secondary/10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-md border border-border/50 hover:bg-secondary/20 gap-1 font-bold h-8 px-3 text-xs"
                      onClick={() => setShowReport(false)}
                    >
                      <ChevronLeft size={14} /> Back
                    </Button>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Dashboard</span>
                      <span>&rarr;</span>
                      <span>Candidates</span>
                      <span>&rarr;</span>
                      <span className="text-foreground font-semibold">AI Detailed Report</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-semibold tracking-tight">AI Detailed Report</h3>
                    <p className="text-sm text-muted-foreground">Comprehensive candidate evaluation</p>
                  </div>
                </div>
              </div>

              <div className="p-8 overflow-y-auto space-y-8">
                <section className="space-y-4">
                  <h4 className="text-[10px] font-semibold uppercase tracking-widest text-primary">Executive Summary</h4>
                  <p className="text-foreground/80 leading-relaxed font-medium bg-secondary/20 p-6 rounded-md border border-border/30 italic">
                    "{reportData.ai_summary}"
                  </p>
                </section>

                <div className="grid grid-cols-2 gap-8">
                  <section className="space-y-4">
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-success">Strengths</h4>
                    <ul className="space-y-3">
                      {reportData.strengths?.map((s: string, i: number) => (
                        <li key={i} className="flex items-center gap-3 text-sm">
                          <div className="h-2 w-2 rounded-full bg-success" /> {s}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="space-y-4">
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-primary">Development Areas</h4>
                    <ul className="space-y-3">
                      {reportData.weaknesses?.map((w: string, i: number) => (
                        <li key={i} className="flex items-center gap-3 text-sm">
                          <div className="h-2 w-2 rounded-full bg-primary" /> {w}
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                <section className="p-6 rounded-md bg-secondary/10 border border-border/30">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Final AI Recommendation</h4>
                    <span className={`px-4 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-[0.2em] ${reportData.recommendation === 'Hire' ? 'bg-success/20 text-success' : 'bg-primary/20 text-primary'
                      }`}>
                      {reportData.recommendation}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Based on technical depth, behavioral consistency, and coding performance.</p>
                </section>

                {reportData.suspicious_activity_alerts && Object.values(reportData.suspicious_activity_alerts).some((v: any) => v > 0) && (
                  <section className="p-6 rounded-md bg-destructive/10 border border-destructive/20">
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-destructive mb-4">Security Warnings</h4>
                    <div className="flex flex-wrap gap-4">
                      {Object.entries(reportData.suspicious_activity_alerts).map(([key, val]: [string, any]) => val > 0 && (
                        <div key={key} className="px-3 py-2 rounded-md bg-background/50 border border-destructive/10 text-xs font-bold flex items-center gap-2">
                          <AlertCircle size={14} className="text-destructive" /> {key}: {val}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <div className="p-8 border-t border-border/30 bg-secondary/5 flex justify-end gap-3">
                <Button variant="outline" className="rounded-md border-border/50 h-12 px-8" onClick={() => exportAdminReportPDF(reportData)}>Export Report</Button>
              </div>
            </motion.div>
          </div>
        )}

        {showScreenshot && screenshotCandidate && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border/50 rounded-md w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-border/30 bg-secondary/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-md border border-border/50 hover:bg-secondary/20 gap-1 font-bold h-8 px-3 text-xs"
                      onClick={() => setShowScreenshot(false)}
                    >
                      <ChevronLeft size={14} /> Back
                    </Button>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Dashboard</span>
                      <span>&rarr;</span>
                      <span>Candidates</span>
                      <span>&rarr;</span>
                      <span className="text-foreground font-semibold">Flagged Review</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-3 text-destructive animate-pulse-glow">
                      <AlertTriangle className="text-destructive" size={20} /> Proctoring Violation Proof
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Visual evidence captured for candidate: <span className="font-bold text-foreground">{screenshotCandidate.candidate || screenshotCandidate.candidate_name}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 overflow-y-auto flex-1 flex flex-col md:grid md:grid-cols-12 md:gap-6 space-y-4 md:space-y-0">
                {/* Left side: Evidence Image */}
                <div className="md:col-span-7 flex flex-col justify-center">
                  <div className="w-full aspect-video bg-zinc-950 rounded-md overflow-hidden border border-border/30 flex items-center justify-center shadow-inner relative group mx-auto max-h-[300px]">
                    {screenshotUrls.length > 0 ? (
                      <>
                        <img
                          src={screenshotUrls[currentScreenshotIndex]}
                          alt={`Violation Evidence ${currentScreenshotIndex + 1}`}
                          className="w-full h-full max-h-[300px] object-contain group-hover:scale-[1.01] transition-transform duration-500"
                        />

                        {screenshotUrls.length > 1 && (
                          <>
                            <button
                              onClick={() => setCurrentScreenshotIndex((prev) => (prev === 0 ? screenshotUrls.length - 1 : prev - 1))}
                              className="absolute left-3 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg rounded-full h-9 w-9 flex items-center justify-center transition-all hover:scale-110 active:scale-95 z-10"
                            >
                              <ChevronLeft size={18} />
                            </button>
                            <button
                              onClick={() => setCurrentScreenshotIndex((prev) => (prev === screenshotUrls.length - 1 ? 0 : prev + 1))}
                              className="absolute right-3 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg rounded-full h-9 w-9 flex items-center justify-center transition-all hover:scale-110 active:scale-95 z-10"
                            >
                              <ChevronRight size={18} />
                            </button>

                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 backdrop-blur-md text-foreground rounded-full text-[10px] font-bold border border-white/10 shadow-lg flex items-center gap-1.5">
                              {screenshotUrls.map((_, idx) => (
                                <div
                                  key={idx}
                                  className={`h-1 w-1 rounded-full transition-all duration-300 ${idx === currentScreenshotIndex ? 'bg-primary w-2.5' : 'bg-white/40'
                                    }`}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      <div className="text-muted-foreground flex flex-col items-center gap-2">
                        <AlertCircle size={40} className="opacity-20" />
                        <p className="text-xs">Screenshot not available.</p>
                      </div>
                    )}
                    <div className="absolute top-3 right-3 px-2 py-0.5 bg-destructive text-foreground rounded-lg text-[9px] font-semibold uppercase tracking-widest shadow-lg">
                      VIOLATION SNAPSHOT {screenshotUrls.length > 1 ? `${currentScreenshotIndex + 1}/${screenshotUrls.length}` : ""}
                    </div>
                  </div>
                </div>

                {/* Right side: Explanation and strikes */}
                <div className="md:col-span-5 flex flex-col justify-between gap-4">
                  <div className="p-4 rounded-md bg-secondary/10 border border-border/30 flex flex-col justify-center space-y-2 flex-1">
                    <h4 className="font-bold text-foreground text-sm">Automatic Policy Flags</h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      The automated proctoring AI detects gaze anomalies, secondary electronic devices, and multiple humans in the camera viewport. A screenshot is captured the instant a strike occurs.
                    </p>
                  </div>

                  <div className="p-4 rounded-md bg-destructive/5 border border-destructive/10">
                    <span className="text-[10px] font-semibold uppercase text-destructive tracking-widest block mb-2">Strike Counts During Session</span>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-md bg-black/40 border border-border/10">
                        <span className="block text-[9px] text-muted-foreground font-medium mb-0.5">Mobile Use</span>
                        <span className="text-base font-bold text-foreground">{screenshotCandidate.proctoring_strikes?.mobile || 0}</span>
                      </div>
                      <div className="p-2 rounded-md bg-black/40 border border-border/10">
                        <span className="block text-[9px] text-muted-foreground font-medium mb-0.5">Multi-Person</span>
                        <span className="text-base font-bold text-foreground">{screenshotCandidate.proctoring_strikes?.multi_person || 0}</span>
                      </div>
                      <div className="p-2 rounded-md bg-black/40 border border-border/10">
                        <span className="block text-[9px] text-muted-foreground font-medium mb-0.5">Look Away</span>
                        <span className="text-base font-bold text-foreground">{(screenshotCandidate.proctoring_strikes?.gaze !== undefined ? screenshotCandidate.proctoring_strikes.gaze : screenshotCandidate.proctoring_strikes?.strikeCount) || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-border/30 bg-secondary/5 flex justify-end gap-3">
                <Button variant="outline" className="rounded-md border-border/50 h-10 px-6 text-xs" onClick={() => window.open(screenshotUrls[currentScreenshotIndex] || '', '_blank')}>Open Fullsize</Button>
              </div>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  );
}
