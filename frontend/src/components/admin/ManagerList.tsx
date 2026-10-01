import { useState } from "react";
import { 
  Users, ChevronRight, Mail, UserCheck, 
  Search, Loader2 
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Manager {
  id: string;
  full_name: string;
  email: string;
  recruiter_count: number;
}

interface ManagerListProps {
  managers: Manager[];
  loading: boolean;
  onSelect: (manager: Manager) => void;
}

export function ManagerList({ managers, loading, onSelect }: ManagerListProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = managers.filter(m => 
    m.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search managers..."
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
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Manager</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Email</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground">Recruiters</th>
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
                    No managers found.
                  </td>
                </tr>
              ) : (
                filtered.map((manager) => (
                  <tr 
                    key={manager.id} 
                    className="group hover:bg-primary/5 transition-colors cursor-pointer"
                    onClick={() => onSelect(manager)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                          {manager.full_name[0]}
                        </div>
                        <span className="font-medium">{manager.full_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Mail size={14} />
                        {manager.email}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Users size={14} className="text-primary" />
                        <span className="font-semibold">{manager.recruiter_count}</span>
                        <span className="text-xs text-muted-foreground">Assigned</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="icon" className="group-hover:translate-x-1 transition-transform">
                        <ChevronRight className="h-5 w-5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
