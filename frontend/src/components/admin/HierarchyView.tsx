import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronRight, ChevronDown, Users, 
  UserCheck, Briefcase, FileText, 
  Award, TrendingUp, Mail, Clock,
  CheckCircle2, Settings2, Trash2,
  Shield, UserPlus, Save, Eye,
  Search, X, ChevronLeft, Filter, XCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  getAdminManagerRecruiters, 
  getAdminRecruiterCandidates,
  adminUpdateMemberRole
} from "@/lib/api";
import { SkeletonRow } from "./Skeletons";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const formatStatusLabel = (status: string) => {
  if (!status) return "";
  if (status.toLowerCase() === 'failed') return 'Invitation failed';
  if (status.toLowerCase() === 'in_progress') return 'In progress';
  const clean = status.replace(/_/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
};

interface HierarchyViewProps {
  managers: any[];
  onSelectCandidate: (candidate: any) => void;
  onRefresh?: () => void;
}

export function HierarchyView({ managers, onSelectCandidate, onRefresh }: HierarchyViewProps) {
  const [selectedMember, setSelectedMember] = useState<any>(null);

  return (
    <div className="space-y-4">
      {managers.map((manager) => (
        <ManagerNode 
          key={manager.id} 
          manager={manager} 
          onSelectCandidate={onSelectCandidate}
          onManage={() => setSelectedMember({ ...manager, role: 'manager' })}
          onRecruiterManage={(rec: any) => setSelectedMember({ ...rec, role: 'recruiter' })}
        />
      ))}

      {selectedMember && (
        <ManageMemberModal 
          member={selectedMember} 
          managers={managers}
          onClose={() => setSelectedMember(null)}
          onSuccess={() => {
            setSelectedMember(null);
            onRefresh?.();
          }}
        />
      )}
    </div>
  );
}

function ManageMemberModal({ member, onClose, onSuccess }: { member: any, managers: any[], onClose: () => void, onSuccess: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [role, setRole] = useState(member.role);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!user?.tenant_id) return;
    setLoading(true);
    try {
      await adminUpdateMemberRole(member.membership_id, role);
      toast({ title: "Updated", description: `${member.full_name}'s access role has been updated.` });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border/50 rounded-md p-8 shadow-2xl">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-2xl font-black flex items-center gap-3">
            <Settings2 className="text-primary h-6 w-6" /> Manage Member
          </DialogTitle>
          <DialogDescription className="text-muted-foreground font-medium">
            Edit AI Interview Access Role for <strong>{member.full_name}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground">User information</Label>
            <div className="p-4 rounded-md bg-secondary/10 border border-border/30 space-y-1">
               <p className="font-bold text-foreground">{member.full_name}</p>
               <p className="text-xs text-muted-foreground">{member.email}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground">AI interview access role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-12 rounded-md bg-background/50 border-border/50">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border/50 rounded-md">
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="recruiter">Recruiter</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-3 mt-8">
          <Button 
            variant="outline" 
            className="flex-1 rounded-md h-12 font-bold"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button 
            className="flex-1 rounded-md h-12 gap-2 font-bold shadow-lg shadow-primary/20"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? <Clock className="animate-spin" size={18} /> : <Save size={18} />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManagerNode({ manager, onSelectCandidate, onManage, onRecruiterManage }: { manager: any, onSelectCandidate: (c: any) => void, onManage: () => void, onRecruiterManage: (rec: any) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [recruiters, setRecruiters] = useState<any[]>([]);
  const [directCandidateCount, setDirectCandidateCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [managerCandidatesExpanded, setManagerCandidatesExpanded] = useState(false);
  const [managerCandidates, setManagerCandidates] = useState<any[]>([]);
  const [managerCandidatesPage, setManagerCandidatesPage] = useState(1);
  const candidatesPerPage = 10;

  const toggle = async (e: React.MouseEvent) => {
    // Don't toggle if manage button is clicked
    if ((e.target as HTMLElement).closest('button')) return;
    if (!expanded) {
      setLoading(true);
      try {
        const [recsData, mgrCandidatesData] = await Promise.all([
          getAdminManagerRecruiters(manager.id),
          getAdminRecruiterCandidates(manager.id, 1, 1000, true).catch(() => ({ total: 0, candidates: [] }))
        ]);
        setRecruiters(recsData);
        const resolvedMgrCandidates = mgrCandidatesData?.candidates || mgrCandidatesData?.items || (Array.isArray(mgrCandidatesData) ? mgrCandidatesData : []);
        setManagerCandidates(resolvedMgrCandidates);
        setDirectCandidateCount(mgrCandidatesData?.total ?? resolvedMgrCandidates.length ?? 0);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  const toggleManagerCandidates = () => {
    setManagerCandidatesExpanded(!managerCandidatesExpanded);
  };

  return (
    <div className="card-elevated overflow-hidden border-l-4 border-l-blue-500 bg-blue-500/[0.03] dark:bg-blue-500/[0.015]">
      <div 
        className="p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4 cursor-pointer hover:bg-secondary/10 transition-colors"
        onClick={toggle}
      >
        <div className="flex items-center gap-3.5 shrink-0 min-w-0">
          <div className="h-10 w-10 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <h3 className="font-bold text-sm sm:text-base text-foreground tracking-tight whitespace-nowrap">
                {manager.full_name}
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25 shrink-0">
                🛡️ Manager
              </span>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 whitespace-nowrap">
              <Mail size={12} className="shrink-0 text-muted-foreground/70" /> 
              <span>{manager.email}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap xl:flex-nowrap justify-between xl:justify-end shrink-0">
          <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 bg-background/80 dark:bg-zinc-900/80 px-2.5 py-1.5 rounded-lg border border-border/40 shadow-sm">
            <div className="text-center px-1.5 min-w-[42px]">
              <p className="text-[10px] font-medium text-muted-foreground">Recruiters</p>
              <p className="text-sm sm:text-base font-bold text-foreground leading-tight">{manager.recruiter_count}</p>
            </div>
            <div className="h-5 w-[1px] bg-border/40" />
            <div className="text-center px-1.5 min-w-[42px]">
              <p className="text-[10px] font-medium text-muted-foreground">Candidates</p>
              <p className="text-sm sm:text-base font-bold text-foreground leading-tight">{manager.candidate_count}</p>
            </div>
            <div className="h-5 w-[1px] bg-border/40" />
            <div className="text-center px-1.5 min-w-[36px]">
              <p className="text-[10px] font-medium text-amber-500">Pending</p>
              <p className="text-sm sm:text-base font-bold text-amber-500 leading-tight">{manager.pending_count ?? 0}</p>
            </div>
            <div className="h-5 w-[1px] bg-border/40" />
            <div className="text-center px-1.5 min-w-[36px]">
              <p className="text-[10px] font-medium text-destructive">Flagged</p>
              <p className="text-sm sm:text-base font-bold text-destructive leading-tight">{manager.flagged_count ?? 0}</p>
            </div>
            <div className="h-5 w-[1px] bg-border/40" />
            <div className="text-center px-1.5 min-w-[42px]">
              <p className="text-[10px] font-medium text-emerald-500">Completed</p>
              <p className="text-sm sm:text-base font-bold text-emerald-500 leading-tight">{manager.completed_count ?? 0}</p>
            </div>
            <div className="h-5 w-[1px] bg-border/40" />
            <div className="text-center px-1.5 min-w-[36px]">
              <p className="text-[10px] font-medium text-red-500">Rejected</p>
              <p className="text-sm sm:text-base font-bold text-red-500 leading-tight">{manager.rejected_count ?? 0}</p>
            </div>
            <div className="h-5 w-[1px] bg-border/40" />
            <div className="text-center px-1.5 min-w-[36px]">
              <p className="text-[10px] font-medium text-violet-500">Selected</p>
              <p className="text-sm sm:text-base font-bold text-violet-500 leading-tight">{manager.selected_count ?? 0}</p>
            </div>
          </div>

          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 px-3 rounded-md border-border/50 text-xs font-semibold hover:bg-primary/10 hover:text-primary transition-all gap-1.5 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onManage();
            }}
          >
            <Settings2 size={14} /> Manage
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/30 bg-background/30"
          >
            <div className="p-6 pl-12 space-y-6">
              {loading ? (
                <div className="space-y-2">
                  <SkeletonRow />
                  <SkeletonRow />
                </div>
              ) : (
                <>
                  {/* Manager's own directly created interviews (Collapsible & Paginated) */}
                  {directCandidateCount > 0 && (() => {
                    const completedDirectCount = managerCandidates.filter(c => ['completed', 'selected', 'rejected'].includes(c.status)).length;
                    const pendingDirectCount = managerCandidates.filter(c => c.status === 'pending').length;
                    const flaggedDirectCount = managerCandidates.filter(c => c.status === 'flagged').length;
                    const totalPages = Math.ceil(managerCandidates.length / candidatesPerPage);
                    const paginated = managerCandidates.slice(
                      (managerCandidatesPage - 1) * candidatesPerPage,
                      managerCandidatesPage * candidatesPerPage
                    );
                    return (
                      <div className="border border-border/20 rounded-md overflow-hidden bg-card/20 shadow-sm">
                        {/* Section Trigger Header */}
                        <div 
                          onClick={toggleManagerCandidates}
                          className="p-4 flex items-center justify-between cursor-pointer hover:bg-secondary/10 transition-all border-b border-border/10"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400">
                              {managerCandidatesExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </div>
                            <div>
                              <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                                🛡️ Manager Candidates
                              </h4>
                              <div className="flex flex-wrap gap-3 sm:gap-4 mt-0.5">
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-semibold">
                                  <Users size={10} className="text-blue-500" /> {directCandidateCount} Candidates
                                </span>
                                <span className="text-[10px] text-success flex items-center gap-1 font-semibold">
                                  <CheckCircle2 size={10} /> {completedDirectCount} Completed
                                </span>
                                <span className="text-[10px] text-yellow-500 flex items-center gap-1 font-semibold">
                                  <Clock size={10} /> {pendingDirectCount} Pending
                                </span>
                                {flaggedDirectCount > 0 && (
                                  <span className="text-[10px] text-destructive flex items-center gap-1 font-semibold">
                                    <Shield size={10} /> {flaggedDirectCount} Flagged
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Section Content */}
                        <AnimatePresence>
                          {managerCandidatesExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="bg-background/20"
                            >
                              <div className="p-3 pl-10 space-y-1 border-t border-border/10">
                                {managerCandidates.length === 0 ? (
                                  <p className="text-xs text-muted-foreground p-3">No candidates found.</p>
                                ) : (
                                  <>
                                    {paginated.map((candidate) => (
                                      <div 
                                        key={candidate.id}
                                        className="flex items-center justify-between p-3 rounded-md hover:bg-primary/5 transition-colors cursor-pointer group"
                                        onClick={() => onSelectCandidate(candidate)}
                                      >
                                        <div className="flex items-center gap-3">
                                          <div className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                          <div>
                                            <p className="text-sm font-medium group-hover:text-primary transition-colors">{candidate.candidate_name || "Unknown"}</p>
                                            <p className="text-[10px] text-muted-foreground">{candidate.job_role}</p>
                                          </div>
                                        </div>
                                        <div className="flex items-center justify-end gap-6 ml-auto">
                                          <div className="text-right">
                                            <p className="text-[10px] font-bold text-muted-foreground">{candidate.current_round || "Technical"}</p>
                                            <p className="text-[9px] text-muted-foreground font-semibold">Type</p>
                                          </div>
                                          <div className="text-right">
                                            <p className="text-[10px] font-bold text-primary">{candidate.overall_score || 0}%</p>
                                            <p className="text-[9px] text-muted-foreground font-semibold">Score</p>
                                          </div>
                                          <div className="text-right w-24">
                                            <p className="text-[10px] font-bold">{new Date(candidate.created_at).toLocaleDateString()}</p>
                                            <p className="text-[9px] text-muted-foreground font-semibold">Date</p>
                                          </div>
                                          <div className={`inline-flex items-center justify-center text-xs h-5 px-2 rounded-lg font-medium min-w-[75px] text-center ${
                                            candidate.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' :
                                            candidate.status === 'in_progress' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20' :
                                            candidate.status === 'flagged' ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20' :
                                            candidate.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                                            candidate.status === 'rejected' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20' :
                                            candidate.status === 'selected' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/20' :
                                            'bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/20'
                                          }`}>
                                            {formatStatusLabel(candidate.status)}
                                          </div>
                                          <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-all" />
                                        </div>
                                      </div>
                                    ))}

                                    {/* Pagination */}
                                    {totalPages > 1 && (
                                      <div className="flex items-center justify-between border-t border-border/10 pt-3 mt-2 px-3">
                                        <span className="text-[10px] text-muted-foreground font-semibold">
                                          Page {managerCandidatesPage} of {totalPages} ({managerCandidates.length} candidates)
                                        </span>
                                        <div className="flex gap-2">
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 rounded-md border border-border/30 hover:bg-primary/10"
                                            disabled={managerCandidatesPage === 1}
                                            onClick={(e) => { e.stopPropagation(); setManagerCandidatesPage(prev => prev - 1); }}
                                          >
                                            <ChevronLeft size={12} />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 rounded-md border border-border/30 hover:bg-primary/10"
                                            disabled={managerCandidatesPage === totalPages}
                                            onClick={(e) => { e.stopPropagation(); setManagerCandidatesPage(prev => prev + 1); }}
                                          >
                                            <ChevronRight size={12} />
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })()}

                  {/* Reporting Recruiters List */}
                  {recruiters.length > 0 && (
                    <div>
                      <h4 className="text-xs uppercase font-black text-muted-foreground tracking-widest mb-3">
                        Reporting Recruiters ({recruiters.length})
                      </h4>
                      <div className="space-y-3">
                        {recruiters.map(recruiter => (
                          <RecruiterNode 
                            key={recruiter.id} 
                            recruiter={{ ...recruiter, manager_id: manager.id }} 
                            onSelectCandidate={onSelectCandidate}
                            onManage={() => onRecruiterManage({ ...recruiter, manager_id: manager.id })}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {directCandidateCount === 0 && recruiters.length === 0 && (
                    <p className="text-sm text-muted-foreground p-4">No candidates or reporting recruiters assigned to this manager.</p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RecruiterNode({ recruiter, onSelectCandidate, onManage }: { recruiter: any, onSelectCandidate: (c: any) => void, onManage: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const toggle = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (!expanded && candidates.length === 0) {
      setLoading(true);
      try {
        const data = await getAdminRecruiterCandidates(recruiter.id, 1, 1000);
        setCandidates(data?.candidates || data?.items || (Array.isArray(data) ? data : []));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  const totalPages = Math.ceil(candidates.length / itemsPerPage);
  const paginatedCandidates = candidates.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="card-elevated overflow-hidden">
      <div 
        className="p-3.5 sm:p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3 cursor-pointer hover:bg-secondary/10 transition-colors"
        onClick={toggle}
      >
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <h4 className="font-bold text-sm text-foreground whitespace-nowrap">
                {recruiter.full_name}
              </h4>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border/50 shrink-0">
                Recruiter
              </span>
            </div>
            {recruiter.email && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 whitespace-nowrap">
                <Mail size={11} className="shrink-0 text-muted-foreground/70" />
                <span>{recruiter.email}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap xl:flex-nowrap justify-between xl:justify-end shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 bg-background/80 dark:bg-zinc-900/80 p-1.5 rounded-lg border border-border/40 shadow-sm">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-semibold px-2 py-0.5 rounded bg-secondary/10">
              <Users size={11} className="text-primary" /> {recruiter.total_interviews} Candidates
            </span>
            <span className="text-[10px] text-emerald-500 flex items-center gap-1 font-semibold px-2 py-0.5 rounded bg-emerald-500/10">
              <CheckCircle2 size={11} /> {recruiter.completed_interviews} Completed
            </span>
            <span className="text-[10px] text-amber-500 flex items-center gap-1 font-semibold px-2 py-0.5 rounded bg-amber-500/10">
              <Clock size={11} /> {recruiter.pending_count ?? (recruiter.total_interviews - recruiter.completed_interviews)} Pending
            </span>
            {(recruiter.flagged_count ?? 0) > 0 && (
              <span className="text-[10px] text-destructive flex items-center gap-1 font-semibold px-2 py-0.5 rounded bg-destructive/10">
                <Shield size={11} /> {recruiter.flagged_count} Flagged
              </span>
            )}
            <span className="text-[10px] text-violet-500 flex items-center gap-1 font-semibold px-2 py-0.5 rounded bg-violet-500/10">
              <Award size={11} /> {recruiter.selected_count ?? 0} Selected
            </span>
            <span className="text-[10px] text-red-500 flex items-center gap-1 font-semibold px-2 py-0.5 rounded bg-red-500/10">
              <XCircle size={11} /> {recruiter.rejected_count ?? 0} Rejected
            </span>
          </div>

          <Button 
            variant="outline" 
            size="xs" 
            className="h-7 px-3 text-xs font-semibold border-border/40 rounded-md hover:bg-primary/10 hover:text-primary transition-all shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onManage();
            }}
          >
            Manage
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/20 bg-background/50"
          >
            <div className="p-2 pl-10 space-y-1">
              {loading ? (
                <SkeletonRow />
              ) : candidates.length === 0 ? (
                <p className="text-[10px] text-muted-foreground p-3">No candidates found.</p>
              ) : (
                <>
                  {paginatedCandidates.map(candidate => (
                    <div 
                      key={candidate.id}
                      className="flex items-center justify-between p-3 rounded-md hover:bg-primary/5 transition-colors cursor-pointer group"
                      onClick={() => onSelectCandidate(candidate)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                        <div>
                          <p className="text-sm font-medium group-hover:text-primary transition-colors">{candidate.candidate_name || "Unknown"}</p>
                          <p className="text-[10px] text-muted-foreground">{candidate.job_role}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-6 ml-auto">
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-muted-foreground">{candidate.current_round || "Technical"}</p>
                          <p className="text-[9px] text-muted-foreground font-semibold">Type</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-primary">{candidate.overall_score || 0}%</p>
                          <p className="text-[9px] text-muted-foreground font-semibold">Score</p>
                        </div>
                        <div className="text-right w-24">
                          <p className="text-[10px] font-bold">{new Date(candidate.created_at).toLocaleDateString()}</p>
                          <p className="text-[9px] text-muted-foreground font-semibold">Date</p>
                        </div>
                        <div className={`inline-flex items-center justify-center text-xs h-5 px-2 rounded-lg font-medium min-w-[75px] text-center ${
                          candidate.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' :
                          candidate.status === 'in_progress' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20' :
                          candidate.status === 'flagged' ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20' :
                          candidate.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                          candidate.status === 'rejected' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20' :
                          candidate.status === 'selected' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/20' :
                          'bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/20'
                        }`}>
                          {formatStatusLabel(candidate.status)}
                        </div>
                        <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-all" />
                      </div>
                    </div>
                  ))}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-border/10 pt-3 mt-2 px-3">
                      <span className="text-[10px] text-muted-foreground font-semibold">
                        Page {currentPage} of {totalPages} ({candidates.length} candidates)
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-md border border-border/30 hover:bg-primary/10"
                          disabled={currentPage === 1}
                          onClick={(e) => { e.stopPropagation(); setCurrentPage(prev => prev - 1); }}
                        >
                          <ChevronLeft size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-md border border-border/30 hover:bg-primary/10"
                          disabled={currentPage === totalPages}
                          onClick={(e) => { e.stopPropagation(); setCurrentPage(prev => prev + 1); }}
                        >
                          <ChevronRight size={12} />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
