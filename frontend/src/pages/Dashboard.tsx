import { useEffect, useState, useRef } from "react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import {
  Users, Clock, CheckCircle2, AlertTriangle, Plus, Search, Filter,
  MoreVertical, Play, Eye, Loader2, Trash2, RotateCcw, RotateCw,
  FileText, Award, Briefcase, Activity, X, Video, ChevronLeft, Download
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getInterviews, deleteInterview } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PermissionGate } from "@/components/auth/PermissionGate";
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

const statusStyles: Record<string, string> = {
  completed: "bg-success/10 text-success",
  in_progress: "bg-primary/10 text-primary",
  pending: "bg-warning/10 text-warning",
  flagged: "bg-destructive/10 text-destructive",
  scheduled: "bg-warning/10 text-warning",
};

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [secureVideoUrl, setSecureVideoUrl] = useState("");
  const [selectedVideoName, setSelectedVideoName] = useState<string>("");
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [videoRealDuration, setVideoRealDuration] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);

  useEffect(() => {
    const fetchSecureUrl = async () => {
      if (!selectedVideo) {
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

      // If it's a local storage file (starts with / or contains /uploads/), just play it normally
      if (selectedVideo.startsWith('/') || selectedVideo.includes('/uploads/')) {
        if (selectedVideo.startsWith('http')) {
          fetchAsBlob(selectedVideo);
        } else {
          const BASE_URL = import.meta.env.VITE_API_BASE_URL 
            ? import.meta.env.VITE_API_BASE_URL.replace(/\/api$/, '') 
            : "http://localhost:8000";
          fetchAsBlob(`${BASE_URL}${selectedVideo}`);
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
          body: JSON.stringify({ s3_url: selectedVideo })
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
  }, [selectedVideo]);


  useEffect(() => {
    if (!authLoading && user) {
      const role = (user.role || "").toLowerCase();
      if (role === "super_admin") {
        navigate("/super-admin");
      } else if (["admin", "manager", "recruiter"].includes(role)) {
        navigate("/admin/dashboard");
      }
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      loadInterviews();
    }
  }, [user]);

  const loadInterviews = async () => {
    try {
      const data = await getInterviews();
      setInterviews(data || []);
    } catch (err: any) {
      toast({ title: "Error loading interviews", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const handleViewVideo = async (interviewId: string, candidateName: string) => {
    setVideoLoading(true);
    setVideoError(null);
    setVideoDuration(null);
    setVideoProgress(0);
    setIsDragging(false);
    setIsPlaying(true);
    setVideoRealDuration(0);
    setSelectedVideoName(candidateName);
    setSelectedInterviewId(interviewId);
    try {
      let BASE = import.meta.env.VITE_API_BASE_URL || "";
      if (BASE && !BASE.startsWith("/") && !BASE.startsWith("http")) BASE = `/${BASE}`;
      const token = localStorage.getItem("xeviewer_token");
      const res = await fetch(`${BASE}/rest/v1/interviews/${interviewId}/video-url`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "No recording available" }));
        throw new Error(err.detail ?? "Recording not found");
      }
      const { url } = await res.json();
      const fullUrl = url.startsWith("http") ? url : `${BASE.replace(/\/api$/, "")}${url}`;
      setSelectedVideo(fullUrl);
    } catch (err: any) {
      toast({ title: "No Recording", description: err.message, variant: "destructive" });
    } finally {
      setVideoLoading(false);
    }
  };

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadRecording = async () => {
    if (!selectedVideo) return;
    try {
      setIsDownloading(true);
      const safeName = (selectedVideoName || 'Candidate').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Interview_Recording_${safeName}_${selectedInterviewId ? selectedInterviewId.substring(0, 8) : 'proctored'}.webm`;

      // Always fetch directly from backend streaming download endpoint (ensures webm_fixer seekable duration & cues)
      if (selectedInterviewId) {
        const token = localStorage.getItem("xeviewer_token") || "";
        const BASE = import.meta.env.VITE_API_BASE_URL || "";
        const apiUrl = BASE.replace(/\/api$/, "");
        const downloadEndpoint = `${apiUrl}/api/recruiter/interview/${selectedInterviewId}/recording/download`;

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
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            toast({ title: "Download Completed", description: `Saved as ${filename}` });
            return;
          }
        } catch (fetchErr) {
          console.warn("Backend stream download failed:", fetchErr);
        }

        const downloadUrlWithToken = `${downloadEndpoint}?token=${encodeURIComponent(token)}`;
        const a = document.createElement('a');
        a.href = downloadUrlWithToken;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast({ title: "Download Started", description: "Browser download initiated." });
        return;
      }

      // 3. Fallback to direct fetch of selectedVideo
      try {
        let downloadUrl = selectedVideo;
        if (downloadUrl.startsWith('/uploads/')) {
          const BASE_URL = import.meta.env.VITE_API_BASE_URL 
            ? import.meta.env.VITE_API_BASE_URL.replace(/\/api$/, '') 
            : "http://localhost:8000";
          downloadUrl = `${BASE_URL}${downloadUrl}`;
        }
        const response = await fetch(downloadUrl);
        if (response.ok) {
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          toast({ title: "Download Started", description: `Saved as ${filename}` });
          return;
        }
      } catch (e) {
        console.warn("Direct blob download failed, falling back to anchor:", e);
      }

      window.open(selectedVideo, '_blank');
    } catch (err: any) {
      toast({ title: "Download Failed", description: err.message || "Could not download recording", variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteInterview(id);
      setInterviews(interviews.filter(i => i.id !== id));
      toast({ title: "Interview deleted", description: "The interview record and video have been removed." });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const filteredInterviews = interviews.filter((i) => {
    const matchesSearch =
      i.candidate_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.job_role?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" || i.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const stats = [
    { label: "Total Interviews", value: interviews.length, icon: Users, change: "" },
    { label: "Pending", value: interviews.filter((i) => i.status === "pending").length, icon: Clock, change: "" },
    { label: "In Progress", value: interviews.filter((i) => i.status === "in_progress").length, icon: Clock, change: "" },
    { label: "Completed", value: interviews.filter((i) => i.status === "completed").length, icon: CheckCircle2, change: "" },
    { label: "Flagged", value: interviews.filter((i) => i.status === "flagged").length, icon: AlertTriangle, change: "" },
  ];

  // Only block on auth — show skeleton for data loading (not a black screen)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-16">
        <header className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="h-14 w-14 rounded-md bg-primary/10 flex items-center justify-center text-primary shadow-lg shadow-primary/10 border border-primary/20">
              <Briefcase size={32} />
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">Candidate Workspace</h1>
              <p className="text-sm text-muted-foreground font-semibold mt-1 tracking-wide uppercase opacity-70">Manage your interview journey and track progress</p>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-secondary/10 p-2 rounded-md border border-border/50 shadow-inner">
            <div className="px-4 py-2 flex items-center gap-2 border-r border-border/50 mr-2">
              <div className={`h-2 w-2 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]`} />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-success">Active Session</span>
            </div>
            <PermissionGate permission="create_interview">
              <Link to="/interview">
                <Button variant="hero" className="gap-2 rounded-md h-10 px-6 font-bold shadow-lg shadow-primary/20">
                  <Plus size={18} /> New Interview
                </Button>
              </Link>
            </PermissionGate>
          </div>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-12"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {[
              { label: "Assigned Interviews", value: interviews.length, icon: FileText, color: "text-primary", delay: 0.1 },
              { label: "Completed", value: interviews.filter((i) => i.status === "completed").length, icon: CheckCircle2, color: "text-success", delay: 0.2 },
              { label: "Pending Tasks", value: interviews.filter((i) => i.status === "pending" || i.status === "scheduled").length, icon: Clock, color: "text-yellow-500", delay: 0.3 },
              { label: "AI Scored", value: interviews.filter((i) => i.overall_score !== null).length, icon: Award, color: "text-primary", delay: 0.4 },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: s.delay }}
                className="card-elevated p-8 group transition-all relative overflow-hidden hover:shadow-lg"
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 blur-3xl -mr-12 -mt-12 rounded-full transition-all group-hover:bg-primary/10" />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className={`h-12 w-12 rounded-md ${s.color.replace('text-', 'bg-')}/10 flex items-center justify-center border border-border/50 group-hover:scale-110 transition-transform`}>
                      <s.icon className={`h-6 w-6 ${s.color}`} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-4xl font-semibold tracking-tighter">{s.value}</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground opacity-70">{s.label}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="card-elevated overflow-hidden">
            <div className="p-4 sm:p-8 border-b border-border/30 bg-transparent flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-3">
                  <Activity size={20} className="text-primary" /> Active Opportunities
                </h2>
                <p className="text-sm text-muted-foreground mt-1">Track your pending and completed assessments</p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full md:w-auto">
                <div className="relative group flex-1 sm:flex-initial">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <input
                    placeholder="Search role or status..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-11 rounded-md bg-background/50 border border-border/50 pl-12 pr-4 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 w-full sm:w-64 transition-all"
                  />
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-11 w-11 rounded-md border-border/50 bg-background/50 hover:bg-secondary transition-all relative">
                      <Filter className="h-5 w-5" />
                      {statusFilter !== "all" && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 border-border/50 bg-background/95 backdrop-blur-md p-2 rounded-md shadow-2xl">
                    <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground opacity-60">Display Filter</div>
                    <DropdownMenuItem onClick={() => setStatusFilter("all")} className={`rounded-md px-3 py-2 mt-1 cursor-pointer transition-colors ${statusFilter === "all" ? "bg-primary/10 text-primary font-bold" : "hover:bg-secondary text-white"}`}>
                      All Interviews
                    </DropdownMenuItem>
                    {["completed", "pending", "in_progress", "flagged"].map((status) => (
                      <DropdownMenuItem
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`rounded-md px-3 py-2 mt-1 cursor-pointer capitalize transition-colors ${statusFilter === status ? "bg-primary/10 text-primary font-bold" : "hover:bg-secondary text-white"}`}
                      >
                        {status.replace('_', ' ')}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-secondary/20">
                    <th className="px-6 py-4 text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.2em]">Assessment Name</th>
                    <th className="px-6 py-4 text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.2em]">Application Role</th>
                    <th className="px-6 py-4 text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.2em] text-center">Current Status</th>
                    <th className="px-6 py-4 text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.2em]">Performance</th>
                    <th className="px-6 py-4 text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.2em]">Phase</th>
                    <th className="px-6 py-4 text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.2em]">Scheduled Date</th>
                    <th className="px-6 py-4 text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.2em] text-right pr-8">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {loading ? (
                    // Skeleton rows while interviews load
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/20">
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-4 py-4">
                            <div className="h-4 rounded bg-secondary/60 animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filteredInterviews.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                        {interviews.length === 0 ? "No interviews yet. Start your first one!" : "No matching interviews."}
                      </td>
                    </tr>
                  ) : (
                    filteredInterviews.map((interview) => (
                      <motion.tr
                        key={interview.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="group hover:bg-primary/5 transition-colors"
                      >
                        <td className="px-6 py-6">
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-md bg-secondary/50 border border-border/50 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                              <FileText size={20} />
                            </div>
                            <div>
                              <p className="font-bold text-lg group-hover:text-primary transition-colors">Technical Assessment</p>
                              <p className="text-xs text-muted-foreground">ID: {interview.id.substring(0, 8)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-6">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-foreground">{interview.job_role}</span>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground opacity-60 tracking-wider mt-0.5">Full Stack Round</span>
                          </div>
                        </td>
                        <td className="px-6 py-6 text-center">
                          <span className={`inline-flex items-center justify-center min-w-[90px] h-6 px-2 rounded-lg text-[10px] font-bold uppercase tracking-widest ${
                            interview.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' :
                            interview.status === 'in_progress' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20' :
                            interview.status === 'flagged' ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20' :
                            interview.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                            interview.status === 'rejected' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20' :
                            interview.status === 'selected' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/20' :
                            interview.status === 'scheduled' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                            'bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/20'
                            }`}>
                            {interview.status?.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-6 py-6">
                          {interview.overall_score !== null ? (
                            <div className="flex flex-col">
                              <span className={`text-xl font-semibold tracking-tighter ${interview.overall_score >= 70 ? "text-success" : interview.overall_score >= 40 ? "text-primary" : "text-destructive"}`}>
                                {interview.overall_score}%
                              </span>
                              <div className="w-20 h-1 bg-secondary rounded-full overflow-hidden mt-1">
                                <div className={`h-full bg-current opacity-50`} style={{ width: `${interview.overall_score}%` }} />
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs font-bold text-muted-foreground opacity-50 uppercase tracking-widest">Awaiting Results</span>
                          )}
                        </td>
                        <td className="px-6 py-6 text-sm text-muted-foreground font-medium capitalize">{interview.current_round}</td>
                        <td className="px-6 py-6">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{new Date(interview.created_at).toLocaleDateString()}</span>
                            <span className="text-[10px] text-muted-foreground opacity-60">Applied Date</span>
                          </div>
                        </td>
                        <td className="px-6 py-6 text-right pr-8">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="hero"
                              size="sm"
                              className="rounded-md h-9 px-5 font-bold"
                              onClick={() => navigate(interview.short_code ? `/i/${interview.short_code}` : `/take-interview?token=${interview.invite_token}`)}
                              disabled={interview.status === 'completed'}
                            >
                              {interview.status === 'completed' ? 'Submitted' : 'Resume'}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-md hover:bg-secondary/80">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 border-border/50 bg-background/95 backdrop-blur-md p-2 rounded-md">
                                <DropdownMenuItem onClick={() => navigate(`/results?id=${interview.id}`)} className="rounded-md gap-3 cursor-pointer">
                                  <Eye className="h-4 w-4 text-primary" />
                                  <span className="font-medium text-sm">View Result</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="rounded-md gap-3 cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                                  onClick={() => handleDelete(interview.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  <span className="font-medium text-sm">Delete Record</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Video Modal */}
      {selectedVideo && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => { setSelectedVideo(null); setVideoDuration(null); setVideoError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setSelectedVideo(null); setVideoError(null); }
            if (e.key === "ArrowLeft" && videoRef.current) videoRef.current.currentTime -= 10;
            if (e.key === "ArrowRight" && videoRef.current) videoRef.current.currentTime += 10;
            if (e.key === " " && videoRef.current) {
              e.preventDefault();
              if (isPlaying) videoRef.current.pause();
              else videoRef.current.play();
              setIsPlaying(!isPlaying);
            }
          }}
          tabIndex={0}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="bg-zinc-950/90 border border-zinc-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] text-zinc-100"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4.5 bg-zinc-900/40 backdrop-blur-md flex items-center justify-between shrink-0 border-b border-zinc-900">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => { setSelectedVideo(null); setVideoDuration(null); setVideoError(null); }}
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
                  {selectedVideoName && (
                    <p className="text-[10px] text-zinc-400 mt-0.5">{selectedVideoName}</p>
                  )}
                </div>
              </div>

              <button
                onClick={() => { setSelectedVideo(null); setVideoDuration(null); setVideoError(null); }}
                className="h-8 w-8 rounded-full border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-800 hover:text-white flex items-center justify-center text-zinc-400 transition-all active:scale-95"
                title="Close Dialog"
              >
                <X size={16} />
              </button>
            </div>

            {/* Player Container */}
            <div className="bg-zinc-950 flex-1 relative flex flex-col justify-center min-h-[45vh] max-h-[60vh] w-full p-4 overflow-hidden select-none">
              {videoError ? (
                <div className="text-zinc-500 flex flex-col items-center justify-center gap-3 py-16">
                  <div className="h-14 w-14 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
                    <AlertTriangle size={24} />
                  </div>
                  <p className="text-sm font-medium text-zinc-200">Unable to play video</p>
                  <p className="text-xs text-zinc-500 max-w-sm text-center">{videoError}</p>
                  <Button variant="ghost" size="sm" className="text-xs text-zinc-400 border border-zinc-800 mt-2 hover:bg-zinc-900" onClick={() => setSelectedVideo(null)}>Close</Button>
                </div>
              ) : (
                <div className="relative w-full h-full max-h-[55vh] rounded-xl overflow-hidden border border-zinc-900 shadow-2xl bg-zinc-950 flex items-center justify-center">
                  <video
                    key={selectedVideo}
                    ref={videoRef}
                    src={secureVideoUrl}
                    autoPlay
                    playsInline
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    className="w-full h-full max-h-[55vh] object-contain rounded-xl"

                    onTimeUpdate={() => {
                      if (videoRef.current && videoRealDuration > 0 && !isDragging) {
                        const pct = (videoRef.current.currentTime / videoRealDuration) * 100;
                        setVideoProgress(isNaN(pct) ? 0 : pct);
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
                            setVideoRealDuration(video.duration);
                            const m = Math.floor(video.duration / 60);
                            const s = Math.floor(video.duration % 60);
                            setVideoDuration(`${m}:${String(s).padStart(2, '0')}`);
                          }
                        };
                        video.addEventListener("timeupdate", restore);
                      } else if (video.duration > 0) {
                        setVideoRealDuration(video.duration);
                        const m = Math.floor(video.duration / 60);
                        const s = Math.floor(video.duration % 60);
                        setVideoDuration(`${m}:${String(s).padStart(2, '0')}`);
                      }
                    }}

                    onError={() => {
                      setVideoError(
                        "The video could not be loaded. The recording may have expired or the S3 link is no longer valid. Try reopening the player."
                      );
                    }}
                  />
                </div>
              )}
            </div>

            {/* Seek Controls & Progress Bar */}
            {!videoError && (
              <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-900 flex flex-col gap-4">
                {/* Timeline Slider */}
                <div className="flex items-center gap-3.5 w-full">
                  <span className="text-[10px] font-mono text-zinc-400 min-w-[42px] text-right">
                    {videoRef.current && !isNaN(videoRef.current.currentTime)
                      ? `${Math.floor(videoRef.current.currentTime / 60)}:${String(Math.floor(videoRef.current.currentTime % 60)).padStart(2, '0')}`
                      : "0:00"}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={videoProgress}
                    onMouseDown={() => setIsDragging(true)}
                    onMouseUp={() => {
                      setIsDragging(false);
                      if (videoRef.current && videoRealDuration > 0) {
                        videoRef.current.currentTime = (videoProgress / 100) * videoRealDuration;
                      }
                    }}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVideoProgress(val);
                      if (videoRef.current && videoRealDuration > 0) {
                        videoRef.current.currentTime = (val / 100) * videoRealDuration;
                      }
                    }}
                    style={{
                      background: `linear-gradient(to right, #00D2FF 0%, #00D2FF ${videoProgress}%, #27272a ${videoProgress}%, #27272a 100%)`
                    }}
                    className="flex-1 h-1 bg-zinc-800 hover:h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 focus:outline-none transition-all duration-150"
                  />
                  <span className="text-[10px] font-mono text-zinc-400 min-w-[42px]">
                    {videoDuration || (videoRealDuration > 0 ? `${Math.floor(videoRealDuration / 60)}:${String(Math.floor(videoRealDuration % 60)).padStart(2, '0')}` : "0:00")}
                  </span>
                </div>

                {/* Actions Row */}
                <div className="flex items-center justify-between">
                  {/* Left: Skip & Playback controls */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { if (videoRef.current) videoRef.current.currentTime -= 10; }}
                      className="h-9 px-3.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white rounded-lg active:scale-95 transition-all text-xs font-semibold flex items-center gap-1.5"
                      title="Rewind 10 seconds"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> -10s
                    </button>

                    <button
                      onClick={() => {
                        if (videoRef.current) {
                          if (isPlaying) videoRef.current.pause();
                          else videoRef.current.play();
                          setIsPlaying(!isPlaying);
                        }
                      }}
                      className="h-10 w-10 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 transition-all duration-300 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:shadow-[0_0_20px_rgba(6,182,212,0.6)] active:scale-95"
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? (
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
                      onClick={() => { if (videoRef.current) videoRef.current.currentTime += 10; }}
                      className="h-9 px-3.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white rounded-lg active:scale-95 transition-all text-xs font-semibold flex items-center gap-1.5"
                      title="Forward 10 seconds"
                    >
                      +10s <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Middle: Branding label */}
                  <span className="hidden sm:inline-block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                    Proctored Session Recording
                  </span>

                  {/* Right: Quick Close Button */}
                  <button
                    onClick={() => { setSelectedVideo(null); setVideoDuration(null); setVideoError(null); }}
                    className="h-9 px-4 bg-zinc-900 hover:bg-zinc-850 text-xs font-bold text-destructive hover:bg-destructive/10 rounded-lg border border-zinc-800 transition-all active:scale-95"
                  >
                    ✕ Close Player
                  </button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t border-zinc-900 bg-zinc-900/20 backdrop-blur-md flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Video size={14} className="text-cyan-500" />
                <span>AI Interview Proctoring Verified</span>
              </div>
              {selectedVideo && (
                <Button
                  variant="outline"
                  className="rounded-lg border-zinc-800 hover:border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white h-10 px-5 gap-2 text-xs font-bold transition-all active:scale-95"
                  onClick={handleDownloadRecording}
                  disabled={isDownloading}
                >
                  {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 
                  {isDownloading ? "Downloading..." : "Download Recording"}
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
