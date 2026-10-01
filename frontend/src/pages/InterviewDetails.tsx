import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Briefcase,
  Calendar,
  Settings,
  Users,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowUpRight,
  Clock,
  Brain,
  Monitor,
  Video,
  Eye,
  RotateCcw,
  Loader2,
  Mail
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { authFetch, resendInterviewCandidate, generateInterviewLink } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export function InterviewDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCandidateGroup, setSelectedCandidateGroup] = useState<any>(null);
  const [resendingEmails, setResendingEmails] = useState<Record<string, boolean>>({});

  const groupedCandidates = useMemo(() => {
    const candidates = data?.candidates;
    if (!candidates) return [];
    
    const groups: Record<string, any> = {};
    candidates.forEach((c: any, index: number) => {
      // Group by email, fallback to name, fallback to index
      const key = c.email || c.name || `unknown-${index}`;
      
      if (!groups[key]) {
        groups[key] = {
          candidate_name: c.name || "Unknown",
          candidate_email: c.email || "",
          total_interviews: 0,
          latest_status: c.status,
          history: []
        };
      }
      
      groups[key].history.push(c);
      groups[key].total_interviews += 1;
    });

    return Object.values(groups).map((group: any) => {
      // Sort history descending by created_at
      group.history.sort((a: any, b: any) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
      });
      // The latest status is the status of the most recent item
      if (group.history.length > 0) {
        // Evaluation outcomes take top precedence, followed by in-progress sessions, then invitation status
        const evaluationOutcome = group.history.find((h: any) => ['rejected', 'selected', 'completed', 'flagged'].includes(h.status));
        if (evaluationOutcome) {
          group.latest_status = evaluationOutcome.status;
        } else {
          const inProgress = group.history.find((h: any) => h.status === 'in_progress');
          if (inProgress) {
            group.latest_status = 'in_progress';
          } else {
            group.latest_status = group.history[0].status;
          }
        }
      }
      return group;
    });
  }, [data?.candidates]);

  const fetchDetails = useCallback(async (showLoading = true) => {
    if (!id) return;
    try {
      if (showLoading) setLoading(true);
      const result = await authFetch(`/rest/v1/interviews/${id}/details`);
      setData(result);
    } catch (err: any) {
      console.error("Failed to fetch interview details:", err);
      setError(err.message || "Failed to load interview details");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetails(true);
  }, [fetchDetails]);

  const handleResend = async (candidateEmail: string) => {
    if (!id || !candidateEmail) return;
    try {
      setResendingEmails(prev => ({ ...prev, [candidateEmail]: true }));
      const activeRole = data?.info?.job_role || "Interview";
      const subject = `AI Interview Invitation - ${activeRole}`;
      
      let link = "";
      try {
        link = await generateInterviewLink(id);
      } catch (linkErr) {
        link = `${window.location.origin}/take-interview?token=${data?.info?.invite_token || id}`;
      }

      const accessNote = (data?.info?.available_from && data?.info?.available_until)
        ? `- You can access the interview only within the scheduled window (${new Date(data.info.available_from).toLocaleString()} – ${new Date(data.info.available_until).toLocaleString()}).`
        : `- You can access the interview anytime using the link below.`;

      const companyName = user?.tenant_name || "Recruitment Team";
      const body =
        `Dear Candidate,\n\n` +
        `You have been invited to participate in an AI Interview for the ${activeRole} position.\n\n` +
        `Interview Details:\n` +
        `- Job Role: ${activeRole}\n` +
        `- Interview Duration: ${data?.info?.duration_minutes || 30} minutes\n\n` +
        `Interview Link:\n` +
        `${link}\n\n` +
        `Please ensure that:\n` +
        `- You have a stable internet connection.\n` +
        `- Your camera and microphone are enabled.\n` +
        `${accessNote}\n\n` +
        `We wish you all the best.\n\n` +
        `Regards,\n` +
        `${companyName}`;

      await resendInterviewCandidate(id, candidateEmail, subject, body);
      toast({
        title: "Invitation Sent",
        description: `Invitation successfully resent to ${candidateEmail}.`,
      });
      await fetchDetails(false);
    } catch (err: any) {
      console.error("Failed to resend invitation:", err);
      toast({
        variant: "destructive",
        title: "Invitation Not Sent",
        description: err.message || `Could not send invitation email to ${candidateEmail}.`,
      });
      await fetchDetails(false);
    } finally {
      setResendingEmails(prev => ({ ...prev, [candidateEmail]: false }));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans selection:bg-primary/20 flex flex-col">
        <Navbar />
        <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <Skeleton className="h-8 w-64 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center p-4 pt-24">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-red-200 dark:border-red-900/50 p-8 max-w-md w-full text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Error Loading Details</h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-6">{error || "Could not find interview data"}</p>
            <Button onClick={() => navigate('/admin/dashboard')} className="w-full">
              Back to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { info, summary, candidates } = data;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 font-sans selection:bg-primary/20 flex flex-col">
      <Navbar />
      
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 space-y-8">
        
        {/* Header & Back Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (window.history.length > 2) {
                  navigate(-1);
                } else {
                  navigate('/dashboard');
                }
              }}
              className="h-9 w-9 rounded-lg border border-border/40 hover:bg-secondary/20 text-muted-foreground hover:text-foreground"
              title="Go Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold text-foreground">Interview Details</h1>
          </div>
            <div className="flex items-center gap-2">
               <span className={`inline-flex items-center justify-center min-w-[90px] h-7 px-3 rounded-full text-xs font-bold uppercase tracking-wider select-none ${
                 info.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' :
                 info.status === 'selected' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30' :
                 info.status === 'rejected' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30' :
                 info.status === 'flagged' ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30' :
                 info.status === 'in_progress' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30' :
                 info.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30' :
                 info.status === 'failed' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30' :
                 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
               }`}>
                 {info.status === 'in_progress' ? 'IN PROGRESS' :
                  info.status === 'failed' ? 'INVITATION FAILED' :
                  (info.status || 'ACTIVE')}
               </span>
            </div>
          </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Interview Information */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-lg">Interview Information</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Role</p>
                <p className="font-medium text-lg">{info.job_role}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Created Date</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">
                      {info.created_at ? new Date(info.created_at).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Type</p>
                  <p className="font-medium text-sm mt-1">{info.is_multi_candidate ? 'Multi-Candidate' : 'Single Candidate'}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Scheduled By</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{info.recruiter_name || 'Unknown'}</span>
                </div>
              </div>
              {info.available_until && (
                <div>
                  <p className="text-sm text-muted-foreground">Deadline</p>
                  <p className="font-medium text-sm text-amber-600 dark:text-amber-400 mt-1">
                    {new Date(info.available_until).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Configuration Settings */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden lg:col-span-2"
          >
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-lg">Configuration</h3>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              
              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Brain className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Questions</p>
                  <p className="font-semibold mt-1">
                    {info.technical_questions_count || 0} Tech, {info.behavioral_questions_count || 0} Behav, {info.coding_questions_count || 0} Code
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-semibold mt-1">{info.duration_minutes || 30} Minutes</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Passing Score</p>
                  <p className="font-semibold mt-1">{info.passing_score || 70}%</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Monitor className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Proctoring</p>
                  <p className="font-semibold mt-1">
                    {info.proctoring_enabled ? `Enabled (${info.proctoring_max_strikes || 3} strikes)` : 'Disabled'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Video className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Video Recording</p>
                  <p className="font-semibold mt-1">
                    {info.save_video_recording ? 'Enabled' : 'Disabled'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Eye className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Camera Visible</p>
                  <p className="font-semibold mt-1">
                    {info.show_candidate_video ? 'Yes' : 'No'}
                  </p>
                </div>
              </div>

            </div>
          </motion.div>
        </div>

        {/* Candidate Summary Stats */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5" /> Candidate Summary
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
              <p className="text-sm text-muted-foreground mb-1">Total Invited</p>
              <p className="text-2xl font-bold">{summary.total_invited}</p>
            </div>

            <div className={`bg-white dark:bg-zinc-900 rounded-xl shadow-sm border p-4 ${
              (summary.failed_invites || 0) > 0
                ? "border-rose-500/40 bg-rose-500/5 dark:bg-rose-950/20"
                : "border-zinc-200 dark:border-zinc-800"
            }`}>
              <p className="text-sm text-muted-foreground mb-1 flex items-center justify-between">
                <span>Failed Invites</span>
                {(summary.failed_invites || 0) > 0 && (
                  <span className="inline-flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                )}
              </p>
              <p className={`text-2xl font-bold ${(summary.failed_invites || 0) > 0 ? "text-rose-500" : "text-muted-foreground"}`}>
                {summary.failed_invites || 0}
              </p>
            </div>
            
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
              <p className="text-sm text-muted-foreground mb-1">Started</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{summary.started}</p>
            </div>
            
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
              <p className="text-sm text-muted-foreground mb-1">Completed</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{summary.completed}</p>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
              <p className="text-sm text-muted-foreground mb-1">Passed</p>
              <p className="text-2xl font-bold text-emerald-500">{summary.passed}</p>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
              <p className="text-sm text-muted-foreground mb-1">Failed</p>
              <p className="text-2xl font-bold text-rose-500">{summary.failed}</p>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
              <p className="text-sm text-muted-foreground mb-1">Flagged</p>
              <p className="text-2xl font-bold text-amber-500">{summary.flagged}</p>
            </div>

          </div>
        </motion.div>

        {/* Candidate List Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <h3 className="font-semibold text-lg">Candidate List</h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-6 py-4 font-semibold">Candidate</th>
                  <th className="px-6 py-4 font-semibold">Latest Status</th>
                  <th className="px-6 py-4 font-semibold text-center">Total Interviews</th>
                  <th className="px-6 py-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {groupedCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                      No candidates found for this interview.
                    </td>
                  </tr>
                ) : (
                  groupedCandidates.map((group: any, idx: number) => (
                    <tr 
                      key={group.candidate_email || idx}
                      className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground">{group.candidate_name}</div>
                        <div className="text-muted-foreground text-xs mt-1">{group.candidate_email || 'No email provided'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center justify-center min-w-[90px] h-6 px-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider select-none ${
                          group.latest_status === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                          group.latest_status === 'flagged' ? 'bg-red-500/15 text-red-600 dark:text-red-400' :
                          group.latest_status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                          group.latest_status === 'in_progress' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' :
                          group.latest_status === 'rejected' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' :
                          group.latest_status === 'selected' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400' :
                          group.latest_status === 'failed' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 font-semibold' :
                          'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                        }`}>
                          {group.latest_status === 'failed' ? 'INVITATION FAILED' : group.latest_status || "Unknown"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="font-bold text-foreground bg-secondary/30 px-2.5 py-1 rounded-md text-xs">
                          {group.total_interviews}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {group.candidate_email && (group.latest_status === 'failed' || group.latest_status === 'pending') && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={resendingEmails[group.candidate_email]}
                              className={`rounded-md text-xs font-bold gap-1.5 h-8 ${
                                group.latest_status === 'failed'
                                  ? "border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                                  : "border-border hover:bg-primary/10 hover:text-primary"
                              }`}
                              onClick={() => handleResend(group.candidate_email)}
                            >
                              {resendingEmails[group.candidate_email] ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
                                  Sending...
                                </>
                              ) : (
                                <>
                                  <RotateCcw size={12} />
                                  {group.latest_status === 'failed' ? 'Retry Invite' : 'Resend'}
                                </>
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="rounded-md hover:bg-primary/10 hover:text-primary font-bold gap-2"
                            onClick={() => setSelectedCandidateGroup(group)}
                          >
                            View History <ArrowUpRight size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

      </main>

      {/* Candidate History Modal */}
      {selectedCandidateGroup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border/50 rounded-xl w-full max-w-4xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col"
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-border/30 bg-secondary/10 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                  <Users className="text-primary" size={20} /> Candidate History
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-semibold">{selectedCandidateGroup.candidate_name}</span>
                  <span className="text-muted-foreground/40">•</span>
                  <span className="text-sm text-muted-foreground">{selectedCandidateGroup.candidate_email}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full hover:bg-secondary/30 h-8 w-8"
                onClick={() => setSelectedCandidateGroup(null)}
              >
                <XCircle size={20} className="text-muted-foreground hover:text-foreground" />
              </Button>
            </div>

            {/* Modal Body / Table */}
            <div className="overflow-y-auto flex-1 p-0">
              <table className="w-full text-sm text-left">
                <thead className="text-[10px] font-semibold text-zinc-500 uppercase bg-zinc-50/50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3">Interview Role</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Score</th>
                    <th className="px-6 py-3">Configuration</th>
                    <th className="px-6 py-3">Recruiter</th>
                    <th className="px-6 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {selectedCandidateGroup.history.map((attempt: any, idx: number) => (
                    <tr key={attempt.id || idx} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-foreground">{info.job_role}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {info.created_at ? new Date(info.created_at).toLocaleString() : 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center justify-center min-w-[80px] h-6 px-2.5 rounded-md text-[9px] font-bold uppercase tracking-wider select-none ${
                          attempt.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                          attempt.status === 'flagged' ? 'bg-red-500/15 text-red-600 dark:text-red-400' :
                          attempt.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                          attempt.status === 'in_progress' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' :
                          attempt.status === 'rejected' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' :
                          attempt.status === 'selected' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400' :
                          attempt.status === 'failed' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 font-semibold' :
                          'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                        }`}>
                          {attempt.status === 'failed' ? 'INVITATION FAILED' : attempt.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {attempt.score !== null ? (
                           <div className="flex items-center gap-2">
                             <div className="h-1.5 w-12 bg-secondary rounded-full overflow-hidden">
                               <div className="h-full bg-primary" style={{ width: `${attempt.score}%` }} />
                             </div>
                             <span className="font-bold text-primary text-xs">{attempt.score}%</span>
                           </div>
                        ) : (
                          <span className="text-muted-foreground/50 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1.5 flex-wrap max-w-[150px]">
                           {(info.technical_questions_count || info.behavioral_questions_count || info.coding_questions_count) ? (
                             <>
                               {info.technical_questions_count > 0 && <span className="px-1.5 py-0.5 bg-secondary/50 rounded text-[9px] font-medium">{info.technical_questions_count} Tech</span>}
                               {info.behavioral_questions_count > 0 && <span className="px-1.5 py-0.5 bg-secondary/50 rounded text-[9px] font-medium">{info.behavioral_questions_count} Behav</span>}
                               {info.coding_questions_count > 0 && <span className="px-1.5 py-0.5 bg-secondary/50 rounded text-[9px] font-medium">{info.coding_questions_count} Code</span>}
                             </>
                           ) : <span className="text-muted-foreground/50 text-xs">Default</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs font-medium">{info.recruiter_name || 'Unknown'}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {attempt.status === 'failed' && selectedCandidateGroup.candidate_email && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={resendingEmails[selectedCandidateGroup.candidate_email]}
                              className="rounded-md text-xs font-bold gap-1.5 h-7 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                              onClick={() => handleResend(selectedCandidateGroup.candidate_email)}
                            >
                              {resendingEmails[selectedCandidateGroup.candidate_email] ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
                                  Sending...
                                </>
                              ) : (
                                <>
                                  <RotateCcw size={12} />
                                  Retry Invite
                                </>
                              )}
                            </Button>
                          )}
                          {attempt.view_result_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="rounded-md hover:bg-primary/10 hover:text-primary font-bold gap-1.5 text-xs h-7"
                              onClick={() => {
                                navigate(`/admin/dashboard?view=candidate&id=${attempt.view_result_id}`);
                              }}
                            >
                              Results <ArrowUpRight size={12} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-border/30 bg-secondary/5 flex justify-end">
               <Button variant="outline" onClick={() => setSelectedCandidateGroup(null)} className="h-8 text-xs font-bold px-4">
                 Close
               </Button>
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
}
