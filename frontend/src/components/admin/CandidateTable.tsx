import { 
  BadgeCheck, Clock, CheckCircle2, 
  XCircle, ExternalLink, Loader2 
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Candidate {
  id: string;
  candidate_name: string;
  job_role: string;
  status: string;
  overall_score: number | null;
  created_at: string;
}

interface CandidateTableProps {
  candidates: Candidate[];
  loading: boolean;
  onSelect: (candidate: Candidate) => void;
}

export function CandidateTable({ candidates, loading, onSelect }: CandidateTableProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="bg-success/20 text-success px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight flex items-center gap-1 w-fit"><CheckCircle2 size={10} /> Completed</span>;
      case "pending":
        return <span className="bg-secondary text-white px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight flex items-center gap-1 w-fit"><Clock size={10} /> Pending</span>;
      case "in_progress":
        return <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight flex items-center gap-1 w-fit animate-pulse"><Loader2 size={10} className="animate-spin" /> In Progress</span>;
      case "flagged":
        return <span className="bg-destructive/20 text-destructive px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight flex items-center gap-1 w-fit"><XCircle size={10} /> Flagged</span>;
      default:
        return <span className="bg-secondary text-white px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight">{status}</span>;
    }
  };

  const getScoreColor = (score: number | null) => {
    if (score === null) return "text-muted-foreground";
    if (score >= 70) return "text-success";
    if (score >= 40) return "text-yellow-400";
    return "text-destructive";
  };

  return (
    <div className="card-elevated border border-border/50 rounded-md overflow-hidden bg-background/50 backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-secondary/20 text-left border-b border-border/50">
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Candidate</th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Role</th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Score</th>
              <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Date</th>
              <th className="px-6 py-4 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary/50 mx-auto" />
                </td>
              </tr>
            ) : candidates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  No candidates found for this recruiter.
                </td>
              </tr>
            ) : (
              candidates.map((candidate) => (
                <tr 
                  key={candidate.id} 
                  className="group hover:bg-primary/5 transition-colors cursor-pointer"
                  onClick={() => onSelect(candidate)}
                >
                  <td className="px-6 py-4">
                    <span className="font-medium">{candidate.candidate_name || "Unknown Candidate"}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {candidate.job_role}
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(candidate.status)}
                  </td>
                  <td className="px-6 py-4">
                    <div className={`font-bold ${getScoreColor(candidate.overall_score)}`}>
                      {candidate.overall_score !== null ? `${candidate.overall_score}%` : "N/A"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-foreground">
                    {new Date(candidate.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="outline" size="sm" className="gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      View Report <ExternalLink size={12} />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
