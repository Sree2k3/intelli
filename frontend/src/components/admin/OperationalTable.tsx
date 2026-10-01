import { useState, useEffect, useCallback } from "react";
import { 
  Table, TableBody, TableCell, 
  TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { 
  Search, Filter, Calendar, 
  User, ShieldCheck, Briefcase,
  CheckCircle2, Clock, AlertCircle,
  ArrowUpRight, Download, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight,
  Play, MoreVertical, Image, Eye, Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { getAdminOperationalTable } from "@/lib/api";
import { motion } from "framer-motion";
import { SkeletonRow } from "./Skeletons";
import { useAuth } from "@/hooks/useAuth";

interface OperationalTableProps {
  onSelectCandidate: (candidate: any) => void;
  onViewScreenshot?: (candidate: any) => void;
  onViewRecording?: (interviewId: string, candidateName?: string) => void;
  onDeleteCandidate?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  initialRecruiterId?: string | null;
  initialRecruiterName?: string;
  initialStatusFilter?: string;
  managersList?: any[];
  recruitersList?: any[];
}

const formatStatusLabel = (status: string) => {
  if (!status) return "";
  if (status.toLowerCase() === 'failed') return 'Invitation failed';
  if (status.toLowerCase() === 'in_progress') return 'In progress';
  const clean = status.replace(/_/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
};

export function OperationalTable({ onSelectCandidate, onViewScreenshot, onViewRecording, onDeleteCandidate, onViewDetails, initialRecruiterId, initialRecruiterName, initialStatusFilter = "", managersList = [], recruitersList = [] }: OperationalTableProps) {
  const { user } = useAuth();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: initialStatusFilter || "",
    search: "",
    dateRange: "",
    manager: "all",
    recruiter: initialRecruiterName || "all",
    score: ""
  });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // Keep track of the active backend recruiter ID. If user manually changes the recruiter dropdown,
  // we clear the backend ID to fetch all or use the client-side filter.
  const [activeRecruiterId, setActiveRecruiterId] = useState<string | null>(initialRecruiterId || null);

  useEffect(() => {
    if (initialStatusFilter !== undefined) {
      setFilters(prev => ({ ...prev, status: initialStatusFilter }));
    }
  }, [initialStatusFilter]);

  useEffect(() => {
    // If the recruiter dropdown changes to something else, we clear the backend ID
    // so that we can fetch all candidates and rely on client-side filtering.
    if (filters.recruiter !== initialRecruiterName) {
      setActiveRecruiterId(null);
    }
  }, [filters.recruiter, initialRecruiterName]);

  useEffect(() => {
    loadData();
  }, [filters.status, activeRecruiterId]);

  const getCandidateDisplay = useCallback((row: any) => {
    const raw = (row.candidate || row.candidate_name || row.name || "").toString().trim();
    const placeholders = ["unknown", "null", "none", "unknown candidate", "unassigned candidate", "unassigned (invite pending)", "candidate", "n/a"];
    if (raw && !placeholders.includes(raw.toLowerCase())) {
      if (raw.includes('@')) {
        const prefix = raw.split('@')[0].replace(/[._-]/g, ' ');
        return prefix.replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Candidate";
      }
      return raw;
    }
    const email = (row.candidate_email || row.email || "").toString().trim();
    if (email && !placeholders.includes(email.toLowerCase())) {
      const prefix = email.split('@')[0].replace(/[._-]/g, ' ');
      return prefix.replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Candidate";
    }
    return "Unknown";
  }, []);

  const getManagerDisplay = useCallback((row: any) => {
    const raw = (row.manager || row.manager_name || "").toString().trim();
    const placeholders = ["", "unknown", "null", "none", "n/a"];
    if (raw && !placeholders.includes(raw.toLowerCase())) {
      return raw;
    }
    if (row.manager_email) return row.manager_email;
    if (row.manager_id && managersList?.length > 0) {
      const found = managersList.find((m: any) => m.id === row.manager_id);
      if (found) return found.full_name || found.email || "N/A";
    }
    if (user?.role === 'manager') {
      return user.full_name || user.email || "N/A";
    }
    if (managersList?.length === 1 && managersList[0]?.full_name) {
      return managersList[0].full_name;
    }
    return raw || "N/A";
  }, [managersList, user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const queryArgs: any = {};
      if (filters.status) {
        queryArgs.status = filters.status;
      }
      if (activeRecruiterId) {
        queryArgs.recruiter_id = activeRecruiterId;
      }
      const res = await getAdminOperationalTable(queryArgs);
      const normalized = (res || []).map((row: any) => {
        const candDisp = getCandidateDisplay(row);
        const mgrDisp = getManagerDisplay(row);
        return {
          ...row,
          candidate: candDisp,
          candidate_name: candDisp,
          manager: mgrDisp,
          manager_name: mgrDisp,
          recruiter: (row.recruiter && row.recruiter !== "N/A")
            ? row.recruiter
            : (user?.role === 'recruiter' ? (user.full_name || "N/A") : (row.recruiter || "N/A")),
        };
      });
      setData(normalized);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = data.filter(item => {
    const candidateStr = (getCandidateDisplay(item) + " " + (item.candidate_email || "")).toString();
    const recruiterStr = (item.recruiter || "").toString();
    const managerStr = (getManagerDisplay(item) + " " + (item.manager_email || "")).toString();
    const roleStr = (item.role || "").toString();
    const searchLower = (filters.search || "").toLowerCase();

    const matchesSearch = candidateStr.toLowerCase().includes(searchLower) ||
      recruiterStr.toLowerCase().includes(searchLower) ||
      managerStr.toLowerCase().includes(searchLower) ||
      roleStr.toLowerCase().includes(searchLower);
    
    let matchesDate = true;
    if (filters.dateRange && item.date) {
       const itemDate = new Date(item.date).getTime();
       if (!isNaN(itemDate)) {
         const now = new Date();
         const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
         const day = 24 * 60 * 60 * 1000;
         
         if (filters.dateRange === "today") {
            matchesDate = itemDate >= todayStart;
         } else if (filters.dateRange === "7days") {
            matchesDate = itemDate >= todayStart - 6 * day;
         } else if (filters.dateRange === "30days") {
            matchesDate = itemDate >= todayStart - 29 * day;
         }
       }
    }
    
    const matchesManager = filters.manager === "all" || item.manager === filters.manager;
    const matchesRecruiter = filters.recruiter === "all" || item.recruiter === filters.recruiter;
    
    let matchesScore = true;
    if (filters.score) {
      const score = parseInt(item.score) || 0;
      if (filters.score === "90-100" && (score < 90 || score > 100)) matchesScore = false;
      else if (filters.score === "80-89" && (score < 80 || score >= 90)) matchesScore = false;
      else if (filters.score === "70-79" && (score < 70 || score >= 80)) matchesScore = false;
      else if (filters.score === "60-69" && (score < 60 || score >= 70)) matchesScore = false;
      else if (filters.score === "50-59" && (score < 50 || score >= 60)) matchesScore = false;
      else if (filters.score === "40-49" && (score < 40 || score >= 50)) matchesScore = false;
      else if (filters.score === "30-39" && (score < 30 || score >= 40)) matchesScore = false;
      else if (filters.score === "20-29" && (score < 20 || score >= 30)) matchesScore = false;
      else if (filters.score === "10-19" && (score < 10 || score >= 20)) matchesScore = false;
      else if (filters.score === "0-9" && (score < 0 || score >= 10)) matchesScore = false;
    }
    
    return matchesSearch && matchesDate && matchesManager && matchesRecruiter && matchesScore;
  });

  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const isAdminOrSuper = user?.role === 'admin' || user?.role === 'super_admin';

  const uniqueManagers = isAdminOrSuper
    ? managersList.map((m: any) => m.full_name).filter(Boolean)
    : Array.from(new Set(data.map(item => item.manager))).filter(m => m && m !== "N/A");

  let uniqueRecruiters: string[] = [];
  if (isAdminOrSuper) {
    if (filters.manager && filters.manager !== "all") {
      // Find recruiters associated with this manager in managersList if possible
      const selectedManager = managersList.find((m: any) => m.full_name === filters.manager);
      if (selectedManager && selectedManager.recruiters) {
        uniqueRecruiters = selectedManager.recruiters.map((r: any) => r.full_name).filter(Boolean);
      } else {
        // Fallback: filter from data items matching selected manager
        uniqueRecruiters = Array.from(new Set(data.filter(item => item.manager === filters.manager).map(item => item.recruiter))).filter(Boolean);
      }
    } else if (recruitersList && recruitersList.length > 0) {
      uniqueRecruiters = recruitersList.map((r: any) => r.full_name).filter(Boolean);
    } else {
      uniqueRecruiters = Array.from(new Set(data.map(item => item.recruiter))).filter(Boolean);
    }
  } else if (user?.role === 'manager') {
    uniqueRecruiters = recruitersList.map((r: any) => r.full_name).filter(Boolean);
  } else {
    uniqueRecruiters = Array.from(new Set(data.map(item => item.recruiter))).filter(Boolean);
  }

  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      let start = Math.max(1, currentPage - 2);
      const end = Math.min(totalPages, start + maxVisiblePages - 1);
      
      if (end - start < maxVisiblePages - 1) {
        start = Math.max(1, end - maxVisiblePages + 1);
      }
      
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }
    return pages;
  };

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      {/* Filters Toolbar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 w-full min-w-0">
        <div className="relative flex-1 min-w-0 max-w-full lg:max-w-xs xl:max-w-sm group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="Search candidate, recruiter or role..." 
            value={filters.search}
            onChange={(e) => setFilters({...filters, search: e.target.value})}
            className="w-full pl-8 pr-3 h-8 sm:h-8.5 bg-background dark:bg-zinc-900 shadow-sm border border-border/70 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder:text-muted-foreground"
          />
        </div>
        
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <select 
            className="h-8 sm:h-8.5 px-2 pr-6 rounded-md bg-background dark:bg-zinc-900 shadow-sm border border-border/70 focus:outline-none focus:ring-2 focus:ring-primary/40 text-xs font-medium cursor-pointer appearance-none bg-no-repeat bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[position:calc(100%_-_6px)_center] bg-[size:12px_12px]"
            value={filters.status}
            onChange={(e) => { setFilters({...filters, status: e.target.value}); setCurrentPage(1); }}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed Delivery</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="flagged">Flagged</option>
            <option value="selected">Selected</option>
            <option value="rejected">Rejected</option>
          </select>

          {user?.role !== 'manager' && user?.role !== 'recruiter' && (
            <select 
              className="h-8 sm:h-8.5 px-2 pr-6 rounded-md bg-background dark:bg-zinc-900 shadow-sm border border-border/70 focus:outline-none focus:ring-2 focus:ring-primary/40 text-xs font-medium cursor-pointer appearance-none bg-no-repeat bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[position:calc(100%_-_6px)_center] bg-[size:12px_12px]"
              value={filters.manager}
              onChange={(e) => { setFilters({ ...filters, manager: e.target.value, recruiter: "all" }); setCurrentPage(1); }}
            >
              <option value="all">All Managers</option>
              {uniqueManagers.map(m => <option key={m as string} value={m as string}>{m as string}</option>)}
            </select>
          )}

          {user?.role !== 'recruiter' && (
            <select 
              className="h-8 sm:h-8.5 px-2 pr-6 rounded-md bg-background dark:bg-zinc-900 shadow-sm border border-border/70 focus:outline-none focus:ring-2 focus:ring-primary/40 text-xs font-medium cursor-pointer appearance-none bg-no-repeat bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[position:calc(100%_-_6px)_center] bg-[size:12px_12px]"
              value={filters.recruiter}
              onChange={(e) => { setFilters({...filters, recruiter: e.target.value}); setCurrentPage(1); }}
            >
              <option value="all">All Recruiters</option>
              {uniqueRecruiters.map(r => <option key={r as string} value={r as string}>{r as string}</option>)}
            </select>
          )}

          <select 
            className="h-8 sm:h-8.5 px-2 pr-6 rounded-md bg-background dark:bg-zinc-900 shadow-sm border border-border/70 focus:outline-none focus:ring-2 focus:ring-primary/40 text-xs font-medium cursor-pointer appearance-none bg-no-repeat bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[position:calc(100%_-_6px)_center] bg-[size:12px_12px]"
            value={filters.score || ""}
            onChange={(e) => { setFilters({...filters, score: e.target.value}); setCurrentPage(1); }}
          >
            <option value="">All Scores</option>
            <option value="90-100">90 - 100</option>
            <option value="80-89">80 - 89</option>
            <option value="70-79">70 - 79</option>
            <option value="60-69">60 - 69</option>
            <option value="50-59">50 - 59</option>
            <option value="40-49">40 - 49</option>
            <option value="30-39">30 - 39</option>
            <option value="20-29">20 - 29</option>
            <option value="10-19">10 - 19</option>
            <option value="0-9">0 - 9</option>
          </select>

          <select 
            className="h-8 sm:h-8.5 px-2 pr-6 rounded-md bg-background dark:bg-zinc-900 shadow-sm border border-border/70 focus:outline-none focus:ring-2 focus:ring-primary/40 text-xs font-medium cursor-pointer appearance-none bg-no-repeat bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[position:calc(100%_-_6px)_center] bg-[size:12px_12px]"
            value={filters.dateRange || ""}
            onChange={(e) => setFilters({...filters, dateRange: e.target.value})}
          >
            <option value="">All Time</option>
            <option value="today">Today</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
          </select>
        </div>
      </div>

      {/* Table Card */}
      <div className="card-elevated overflow-hidden border border-border/40 rounded-lg w-full max-w-full">
        <div className="overflow-x-auto w-full max-w-full">
          <Table className="w-full table-fixed text-left min-w-[700px]">
            <TableHeader className="border-b border-border/40 bg-secondary/15">
              <TableRow className="border-border/30 hover:bg-transparent">
                <TableHead className={`font-semibold text-xs py-3 px-3 sm:px-4 text-muted-foreground ${user?.role === 'manager' ? 'w-[26%]' : 'w-[22%]'}`}>Candidate</TableHead>
                <TableHead className={`font-semibold text-xs py-3 px-2.5 sm:px-3 text-muted-foreground ${user?.role === 'manager' ? 'w-[18%]' : 'w-[14%]'}`}>Recruiter</TableHead>
                {user?.role !== 'manager' && (
                  <TableHead className="font-semibold text-xs py-3 px-2.5 sm:px-3 text-muted-foreground w-[14%]">Manager</TableHead>
                )}
                <TableHead className={`font-semibold text-xs py-3 px-2.5 sm:px-3 text-muted-foreground ${user?.role === 'manager' ? 'w-[21%]' : 'w-[17%]'}`}>Interview / role</TableHead>
                <TableHead className={`font-semibold text-xs py-3 px-2 text-center text-muted-foreground ${user?.role === 'manager' ? 'w-[9%]' : 'w-[8%]'}`}>Score</TableHead>
                <TableHead className={`font-semibold text-xs py-3 px-2 text-center text-muted-foreground ${user?.role === 'manager' ? 'w-[12%]' : 'w-[11%]'}`}>Status</TableHead>
                <TableHead className="font-semibold text-xs py-3 px-2.5 sm:px-3 text-right text-muted-foreground w-[9%]">Date</TableHead>
                <TableHead className="font-semibold text-xs py-3 px-2 text-center text-muted-foreground w-[5%] min-w-[40px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))
              ) : paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={user?.role !== 'manager' ? 8 : 7} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                      <AlertCircle size={40} className="opacity-20" />
                      <p className="font-medium text-lg">No candidate data matches your filters</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((row) => (
                  <TableRow 
                    key={row.id} 
                    className="border-border/20 hover:bg-primary/5 transition-colors cursor-pointer group"
                    onClick={() => onSelectCandidate(row)}
                  >
                    <TableCell className="py-2.5 px-3 sm:px-4">
                      {(() => {
                        const candDisp = getCandidateDisplay(row);
                        const initial = candDisp ? candDisp.charAt(0).toUpperCase() : "?";
                        return (
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                              {initial}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-bold text-xs sm:text-sm group-hover:text-primary transition-colors truncate block" title={candDisp}>
                                {candDisp}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="py-2.5 px-2.5 sm:px-3">
                      <div className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
                        <User size={13} className="text-muted-foreground shrink-0" />
                        <span className="truncate block" title={row.recruiter}>{row.recruiter}</span>
                      </div>
                    </TableCell>
                    {user?.role !== 'manager' && (
                      <TableCell className="py-2.5 px-2.5 sm:px-3">
                        <div className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
                          <ShieldCheck size={13} className="text-blue-500 dark:text-blue-400 shrink-0" />
                          <span className="truncate block" title={getManagerDisplay(row)}>{getManagerDisplay(row)}</span>
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="py-2.5 px-2.5 sm:px-3">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs sm:text-sm font-bold truncate block" title={row.role}>{row.role}</span>
                        <span className="text-[10px] text-muted-foreground truncate block">Technical round</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 px-2 text-center">
                       <span className={`text-xs sm:text-sm font-black ${row.score >= 70 ? 'text-success' : row.score >= 40 ? 'text-primary' : 'text-destructive'}`}>
                          {row.score !== null ? `${row.score}%` : 'N/A'}
                       </span>
                    </TableCell>
                    <TableCell className="py-2.5 px-2 text-center">
                      <span 
                        onClick={(e) => {
                          if (row.status === 'flagged' && onViewScreenshot) {
                            e.stopPropagation();
                            onViewScreenshot(row);
                          }
                        }}
                        className={`inline-flex items-center justify-center min-w-[72px] max-w-full h-5 px-1.5 rounded-md text-[11px] font-semibold select-none truncate ${
                          row.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' :
                          row.status === 'in_progress' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20' :
                          row.status === 'flagged' ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 hover:bg-red-500/25 cursor-pointer gap-1 transition-all duration-200' :
                          row.status === 'pending' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                          row.status === 'failed' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30' :
                          row.status === 'rejected' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20' :
                          row.status === 'selected' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/20' :
                          row.status === 'scheduled' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                          'bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/20'
                        }`}
                      >
                        {row.status === 'flagged' && <AlertCircle size={10} />}
                        <span className="truncate">{formatStatusLabel(row.status)}</span>
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5 px-2.5 sm:px-3 text-right">
                      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">{new Date(row.date).toLocaleDateString()}</span>
                    </TableCell>
                    <TableCell className="py-2.5 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-md hover:bg-secondary/40 data-[state=open]:bg-secondary/40"
                            >
                              <MoreVertical size={14} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 rounded-md border border-border/50 bg-background/95 backdrop-blur-md p-1 shadow-xl">
                            <DropdownMenuItem
                              className="flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer text-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectCandidate(row);
                              }}
                            >
                              <ArrowUpRight size={14} className="text-primary" />
                              View Results
                            </DropdownMenuItem>
                            {row.video_url && onViewRecording && (
                              <>
                                <DropdownMenuSeparator className="my-1" />
                                <DropdownMenuItem
                                  className="flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer text-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onViewRecording(row.id, row.candidate_name);
                                  }}
                                >
                                  <Play size={14} className="text-blue-400" />
                                  View Video
                                </DropdownMenuItem>
                              </>
                            )}
                            {row.status === 'flagged' && onViewScreenshot && (
                              <>
                                <DropdownMenuSeparator className="my-1" />
                                <DropdownMenuItem
                                  className="flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer text-sm text-destructive focus:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onViewScreenshot(row);
                                  }}
                                >
                                  <Image size={14} />
                                  View Screenshot
                                </DropdownMenuItem>
                              </>
                            )}
                            {onViewDetails && (
                              <>
                                <DropdownMenuSeparator className="my-1" />
                                <DropdownMenuItem
                                  className="flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer text-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onViewDetails(row.interview_id || row.id);
                                  }}
                                >
                                  <Eye size={14} className="text-muted-foreground" />
                                  View Details
                                </DropdownMenuItem>
                              </>
                            )}
                            {onDeleteCandidate && (
                              <>
                                <DropdownMenuSeparator className="my-1" />
                                <DropdownMenuItem
                                  className="flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer text-sm text-destructive focus:text-destructive focus:bg-destructive/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteCandidate(row.id);
                                  }}
                                >
                                  <Trash2 size={14} />
                                  Delete Profile
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination Controls */}
      {!loading && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 px-1">
          <p className="text-xs sm:text-sm text-muted-foreground">
            Showing <span className="font-bold text-foreground">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-bold text-foreground">{Math.min(currentPage * itemsPerPage, filteredData.length)}</span> of <span className="font-bold text-foreground">{filteredData.length}</span> candidates
          </p>
          <div className="flex items-center shadow-sm rounded-md border border-border/50 overflow-hidden bg-background">
            <Button 
              variant="ghost" 
              className="rounded-none h-8 w-8 p-0 border-r border-border/50 hover:bg-secondary/20"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              <ChevronsLeft size={15} />
            </Button>
            <Button 
              variant="ghost" 
              className="rounded-none h-8 w-8 p-0 border-r border-border/50 hover:bg-secondary/20"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft size={15} />
            </Button>
            
            {getPageNumbers().map(pageNum => (
              <Button
                key={pageNum}
                variant={currentPage === pageNum ? "default" : "ghost"}
                className={`rounded-none h-8 w-8 p-0 border-r border-border/50 text-xs font-medium ${currentPage === pageNum ? "bg-primary text-primary-foreground hover:bg-primary/90" : "hover:bg-secondary/20 text-foreground"}`}
                onClick={() => setCurrentPage(pageNum)}
              >
                {pageNum}
              </Button>
            ))}

            <Button 
              variant="ghost" 
              className="rounded-none h-8 w-8 p-0 border-r border-border/50 hover:bg-secondary/20"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight size={15} />
            </Button>
            <Button 
              variant="ghost" 
              className="rounded-none h-8 w-8 p-0 hover:bg-secondary/20"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronsRight size={15} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
