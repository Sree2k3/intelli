import { useState } from "react";
import { 
  FileText, CheckCircle2, Search, Loader2, 
  ChevronRight, Mail, BarChart3 
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Recruiter {
  id: string;
  full_name: string;
  email: string;
  total_interviews: number;
  completed_interviews: number;
}

interface RecruiterListProps {
  recruiters: Recruiter[];
  loading: boolean;
  onSelect: (recruiter: Recruiter) => void;
}

export function RecruiterList({ recruiters, loading, onSelect }: RecruiterListProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = recruiters.filter(r => 
    r.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search recruiters..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-secondary/30 border border-border/50 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="card-elevated border border-border/50 rounded-md overflow-hidden bg-background/50 backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-secondary/20 text-left border-b border-border/50">
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Recruiter</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Metrics</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Performance</th>
                <th className="px-6 py-4 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary/50 mx-auto" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                    No recruiters found.
                  </td>
                </tr>
              ) : (
                filtered.map((recruiter) => {
                  const completionRate = recruiter.total_interviews > 0 
                    ? Math.round((recruiter.completed_interviews / recruiter.total_interviews) * 100)
                    : 0;
                    
                  return (
                    <tr 
                      key={recruiter.id} 
                      className="group hover:bg-primary/5 transition-colors cursor-pointer"
                      onClick={() => onSelect(recruiter)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-medium">{recruiter.full_name}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail size={12} /> {recruiter.email}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <span className="text-xs text-muted-foreground">Total</span>
                            <span className="font-semibold flex items-center gap-1">
                              <FileText size={14} className="text-blue-400" />
                              {recruiter.total_interviews}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-muted-foreground">Done</span>
                            <span className="font-semibold flex items-center gap-1">
                              <CheckCircle2 size={14} className="text-success" />
                              {recruiter.completed_interviews}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="w-full max-w-[120px] space-y-1">
                          <div className="flex justify-between text-[10px] uppercase font-bold tracking-tighter">
                            <span>Efficiency</span>
                            <span>{completionRate}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary transition-all" 
                              style={{ width: `${completionRate}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button variant="ghost" size="icon" className="group-hover:translate-x-1 transition-transform">
                          <ChevronRight className="h-5 w-5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
