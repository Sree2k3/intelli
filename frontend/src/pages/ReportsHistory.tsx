import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  getReportsHistory,
  exportReportsCsv,
  ReportItem,
  ReportsFilterParams,
  ReportsHistoryResponse,
} from "@/lib/api";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Download,
  RefreshCw,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  User,
  X,
  Calendar,
  RotateCcw,
} from "lucide-react";

export default function ReportsHistory() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── State synced with search params ──────────────────────────────────────────
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [roleFilter, setRoleFilter] = useState(searchParams.get("job_role") || "all");
  const [interviewerFilter, setInterviewerFilter] = useState(searchParams.get("interviewer") || "all");
  const [scoreTierFilter, setScoreTierFilter] = useState(searchParams.get("score_range") || "all");
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") || "");
  const [sortBy, setSortBy] = useState(searchParams.get("sort_by") || "date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(
    (searchParams.get("sort_order") as "asc" | "desc") || "desc"
  );
  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1", 10));
  const [pageSize, setPageSize] = useState(parseInt(searchParams.get("page_size") || "10", 10));

  // ── Data & Loading State ───────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [reportsData, setReportsData] = useState<ReportsHistoryResponse | null>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // reset to page 1 on new search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Sync state to URL search parameters
  useEffect(() => {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (statusFilter !== "all") params.status = statusFilter;
    if (roleFilter !== "all") params.job_role = roleFilter;
    if (interviewerFilter !== "all") params.interviewer = interviewerFilter;
    if (scoreTierFilter !== "all") params.score_range = scoreTierFilter;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (sortBy !== "date" && sortBy !== "created_at") params.sort_by = sortBy;
    if (sortOrder !== "desc") params.sort_order = sortOrder;
    if (page > 1) params.page = String(page);
    if (pageSize !== 10) params.page_size = String(pageSize);

    setSearchParams(params, { replace: true });
  }, [
    debouncedSearch,
    statusFilter,
    roleFilter,
    interviewerFilter,
    scoreTierFilter,
    dateFrom,
    dateTo,
    sortBy,
    sortOrder,
    page,
    pageSize,
    setSearchParams,
  ]);

  // ── Fetch Data ─────────────────────────────────────────────────────────────
  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const normalizedSortBy = sortBy === "created_at" ? "date" : sortBy;
      const params: ReportsFilterParams = {
        search: debouncedSearch || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        job_role: roleFilter !== "all" ? roleFilter : undefined,
        interviewer: interviewerFilter !== "all" ? interviewerFilter : undefined,
        score_range: scoreTierFilter !== "all" ? scoreTierFilter : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        sort_by: normalizedSortBy,
        sort_order: sortOrder,
        page,
        page_size: pageSize,
      };

      const res = await getReportsHistory(params);
      setReportsData(res);
    } catch (err: any) {
      console.error("Failed to load reports history:", err);
      toast({
        title: "Error loading reports",
        description: err.message || "Could not retrieve interview history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [
    debouncedSearch,
    statusFilter,
    roleFilter,
    interviewerFilter,
    scoreTierFilter,
    dateFrom,
    dateTo,
    sortBy,
    sortOrder,
    page,
    pageSize,
    toast,
  ]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // ── CSV Export ─────────────────────────────────────────────────────────────
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const normalizedSortBy = sortBy === "created_at" ? "date" : sortBy;
      const params: ReportsFilterParams = {
        search: debouncedSearch || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        job_role: roleFilter !== "all" ? roleFilter : undefined,
        interviewer: interviewerFilter !== "all" ? interviewerFilter : undefined,
        score_range: scoreTierFilter !== "all" ? scoreTierFilter : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        sort_by: normalizedSortBy,
        sort_order: sortOrder,
      };

      const blob = await exportReportsCsv(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const timestamp = new Date().toISOString().slice(0, 10);
      a.download = `interview_reports_${timestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Complete",
        description: "Your interview history CSV report has been downloaded.",
      });
    } catch (err: any) {
      console.error("CSV Export failed:", err);
      toast({
        title: "Export Failed",
        description: err.message || "Failed to download CSV export",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  // ── Clear All Filters ──────────────────────────────────────────────────────
  const handleResetFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setRoleFilter("all");
    setInterviewerFilter("all");
    setScoreTierFilter("all");
    setDateFrom("");
    setDateTo("");
    setSortBy("date");
    setSortOrder("desc");
    setPage(1);
  };

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (debouncedSearch) count++;
    if (statusFilter !== "all") count++;
    if (roleFilter !== "all") count++;
    if (interviewerFilter !== "all") count++;
    if (scoreTierFilter !== "all") count++;
    if (dateFrom) count++;
    if (dateTo) count++;
    if ((sortBy !== "date" && sortBy !== "created_at") || sortOrder !== "desc") count++;
    return count;
  }, [
    debouncedSearch,
    statusFilter,
    roleFilter,
    interviewerFilter,
    scoreTierFilter,
    dateFrom,
    dateTo,
    sortBy,
    sortOrder,
  ]);

  // ── Column Sorting Handlers ────────────────────────────────────────────────
  const handleHeaderSort = (columnKey: string, defaultDir: "asc" | "desc" = "asc") => {
    const currentKey = sortBy === "created_at" ? "date" : sortBy;
    if (currentKey === columnKey) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(columnKey);
      setSortOrder(defaultDir);
    }
    setPage(1);
  };

  const renderSortIcon = (columnKey: string) => {
    const currentKey = sortBy === "created_at" ? "date" : sortBy;
    const isActive = currentKey === columnKey;
    if (isActive) {
      return sortOrder === "asc" ? (
        <ArrowUp className="h-3 w-3 text-primary shrink-0" />
      ) : (
        <ArrowDown className="h-3 w-3 text-primary shrink-0" />
      );
    }
    return (
      <ArrowUpDown className="h-3 w-3 text-muted-foreground/35 group-hover:text-muted-foreground/80 shrink-0 transition-colors" />
    );
  };

  const getStatusLabel = (val: string) => {
    switch (val) {
      case "completed":
        return "Completed";
      case "in_progress":
        return "In Progress";
      case "pending":
        return "Pending";
      case "flagged":
        return "Flagged";
      case "failed":
        return "Failed";
      default:
        return val;
    }
  };

  const getScoreTierLabel = (val: string) => {
    switch (val) {
      case "excellent":
        return "85%+";
      case "good":
        return "70-84%";
      case "needs_review":
        return "50-69%";
      case "critical":
        return "<50%";
      default:
        return val;
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatDate = (isoString: string) => {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "").toLowerCase();
    switch (s) {
      case "completed":
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 font-medium">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case "in_progress":
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30 font-medium">
            <Clock className="w-3 h-3 mr-1 animate-pulse" />
            In Progress
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 font-medium">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
      case "flagged":
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30 font-medium">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Flagged
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 font-medium">
            <AlertCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-secondary text-foreground border-border font-medium capitalize">
            {status}
          </Badge>
        );
    }
  };

  const getScoreBadge = (score: number | null) => {
    if (score === null || score === undefined) {
      return <span className="text-muted-foreground text-xs font-mono">—</span>;
    }

    let colorClasses = "bg-muted text-foreground border-border";
    if (score >= 85) {
      colorClasses = "bg-emerald-500/15 text-emerald-500 border-emerald-500/30 font-semibold";
    } else if (score >= 70) {
      colorClasses = "bg-blue-500/15 text-blue-500 border-blue-500/30 font-semibold";
    } else if (score >= 50) {
      colorClasses = "bg-amber-500/15 text-amber-500 border-amber-500/30 font-medium";
    } else {
      colorClasses = "bg-red-500/15 text-red-500 border-red-500/30 font-medium";
    }

    return (
      <Badge variant="outline" className={`${colorClasses} px-2 py-0.5 text-xs`}>
        {Math.round(score)}%
      </Badge>
    );
  };



  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-8 space-y-4">
        {/* ── Page Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-border/40">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              History
            </h1>
            {reportsData && !loading && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-secondary/80 text-muted-foreground border border-border/60">
                {reportsData.total.toLocaleString()} record{reportsData.total !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadReports}
              disabled={loading}
              className="text-xs flex items-center gap-1.5 h-8 px-3 rounded-lg border-border/70 hover:bg-secondary/60 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleExportCsv}
              disabled={exporting || loading || reportsData?.items.length === 0}
              className="text-xs flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs transition-colors"
            >
              <Download className={`h-3.5 w-3.5 ${exporting ? "animate-bounce" : ""}`} />
              Export CSV
            </Button>
          </div>
        </div>

        {/* ── Filters Section ──────────────────────────────────────────────── */}
        <div className="bg-card border border-border/70 rounded-xl p-3 shadow-xs space-y-2.5">
          {/* Row 1: Search box on left, Date fields & Reset on right */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px] max-w-xl">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Search by role, candidate, or interviewer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-7 text-xs bg-background border-border/70 h-8 rounded-lg w-full"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Right Group: From & To Date Range & Clear Filters */}
            <div className="flex items-center gap-2 shrink-0">
              {/* From & To Date Range */}
              <div className="flex items-center gap-1.5 bg-background border border-border/70 rounded-lg px-2.5 h-8 text-xs shadow-2xs">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] font-medium text-muted-foreground select-none">From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="bg-transparent border-0 p-0 text-xs text-foreground focus:outline-none w-[110px] cursor-pointer"
                />
                <span className="text-muted-foreground/30 select-none">|</span>
                <span className="text-[11px] font-medium text-muted-foreground select-none">To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="bg-transparent border-0 p-0 text-xs text-foreground focus:outline-none w-[110px] cursor-pointer"
                />
                {(dateFrom || dateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setDateFrom("");
                      setDateTo("");
                      setPage(1);
                    }}
                    className="text-muted-foreground hover:text-foreground ml-0.5 p-0.5"
                    title="Clear dates"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Reset Filters Button */}
              {activeFiltersCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-dashed border-border/70 hover:border-border hover:bg-secondary/50 shrink-0"
                >
                  <RotateCcw className="h-3 w-3" />
                  Clear Filters
                  <Badge variant="secondary" className="ml-0.5 text-[10px] px-1.5 py-0 h-4">
                    {activeFiltersCount}
                  </Badge>
                </Button>
              )}
            </div>
          </div>

          {/* Row 2: Clean 4-column filter dropdowns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-border/40">
            {/* Status Filter */}
            <Select
              value={statusFilter}
              onValueChange={(val) => {
                setStatusFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className={`w-full h-8 text-xs bg-background border-border/70 rounded-lg ${statusFilter !== "all" ? "border-primary/50 text-primary font-medium" : ""}`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span className={statusFilter !== "all" ? "text-primary font-semibold" : "font-medium text-foreground"}>Status</span>
                  {statusFilter !== "all" && (
                    <span className="text-primary truncate">: {getStatusLabel(statusFilter)}</span>
                  )}
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="flagged">Flagged</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>

            {/* Job Role Filter */}
            <Select
              value={roleFilter}
              onValueChange={(val) => {
                setRoleFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className={`w-full h-8 text-xs bg-background border-border/70 rounded-lg ${roleFilter !== "all" ? "border-primary/50 text-primary font-medium" : ""}`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span className={roleFilter !== "all" ? "text-primary font-semibold" : "font-medium text-foreground"}>Role</span>
                  {roleFilter !== "all" && (
                    <span className="text-primary truncate">: {roleFilter}</span>
                  )}
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {reportsData?.facets?.job_roles?.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Score Tier Filter */}
            <Select
              value={scoreTierFilter}
              onValueChange={(val) => {
                setScoreTierFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className={`w-full h-8 text-xs bg-background border-border/70 rounded-lg ${scoreTierFilter !== "all" ? "border-primary/50 text-primary font-medium" : ""}`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span className={scoreTierFilter !== "all" ? "text-primary font-semibold" : "font-medium text-foreground"}>Score</span>
                  {scoreTierFilter !== "all" && (
                    <span className="text-primary truncate">: {getScoreTierLabel(scoreTierFilter)}</span>
                  )}
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="excellent">Excellent (85%+)</SelectItem>
                <SelectItem value="good">Good (70-84%)</SelectItem>
                <SelectItem value="needs_review">Needs Review (50-69%)</SelectItem>
                <SelectItem value="critical">Critical (&lt;50%)</SelectItem>
              </SelectContent>
            </Select>

            {/* Interviewer Filter */}
            <Select
              value={interviewerFilter}
              onValueChange={(val) => {
                setInterviewerFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className={`w-full h-8 text-xs bg-background border-border/70 rounded-lg ${interviewerFilter !== "all" ? "border-primary/50 text-primary font-medium" : ""}`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span className={interviewerFilter !== "all" ? "text-primary font-semibold" : "font-medium text-foreground"}>Created By</span>
                  {interviewerFilter !== "all" && (
                    <span className="text-primary truncate">: {interviewerFilter}</span>
                  )}
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {reportsData?.facets?.interviewers?.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Reports Data Table ───────────────────────────────────────────── */}
        <div className="bg-card border border-border/70 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-secondary/40">
                <TableRow className="border-border/60 hover:bg-transparent">
                  {/* Role */}
                  <TableHead
                    className="text-xs font-semibold px-4 py-3 cursor-pointer select-none group hover:text-primary transition-colors min-w-[160px]"
                    onClick={() => handleHeaderSort("role", "asc")}
                    title="Sort by Role"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={sortBy === "role" ? "text-primary font-bold" : "text-foreground"}>
                        Role
                      </span>
                      {renderSortIcon("role")}
                    </div>
                  </TableHead>

                  {/* Candidate */}
                  <TableHead
                    className="text-xs font-semibold px-4 py-3 cursor-pointer select-none group hover:text-primary transition-colors min-w-[160px]"
                    onClick={() => handleHeaderSort("candidate", "asc")}
                    title="Sort by Candidate Name"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={sortBy === "candidate" ? "text-primary font-bold" : "text-foreground"}>
                        Candidate
                      </span>
                      {renderSortIcon("candidate")}
                    </div>
                  </TableHead>

                  {/* Created By */}
                  <TableHead
                    className="text-xs font-semibold px-4 py-3 cursor-pointer select-none group hover:text-primary transition-colors min-w-[140px]"
                    onClick={() => handleHeaderSort("interviewer", "asc")}
                    title="Sort by Created By"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={sortBy === "interviewer" ? "text-primary font-bold" : "text-foreground"}>
                        Created By
                      </span>
                      {renderSortIcon("interviewer")}
                    </div>
                  </TableHead>

                  {/* Date */}
                  <TableHead
                    className="text-xs font-semibold px-4 py-3 cursor-pointer select-none group hover:text-primary transition-colors min-w-[150px]"
                    onClick={() => handleHeaderSort("date", "desc")}
                    title="Sort by Date"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={(sortBy === "date" || sortBy === "created_at") ? "text-primary font-bold" : "text-foreground"}>
                        Date
                      </span>
                      {renderSortIcon("date")}
                    </div>
                  </TableHead>

                  {/* Status */}
                  <TableHead
                    className="text-xs font-semibold px-4 py-3 cursor-pointer select-none group hover:text-primary transition-colors min-w-[120px]"
                    onClick={() => handleHeaderSort("status", "asc")}
                    title="Sort by Status"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={sortBy === "status" ? "text-primary font-bold" : "text-foreground"}>
                        Status
                      </span>
                      {renderSortIcon("status")}
                    </div>
                  </TableHead>

                  {/* Score */}
                  <TableHead
                    className="text-xs font-semibold px-4 py-3 cursor-pointer select-none group hover:text-primary transition-colors min-w-[90px]"
                    onClick={() => handleHeaderSort("score", "desc")}
                    title="Sort by Score"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={sortBy === "score" ? "text-primary font-bold" : "text-foreground"}>
                        Score
                      </span>
                      {renderSortIcon("score")}
                    </div>
                  </TableHead>

                  {/* Actions */}
                  <TableHead className="text-xs font-semibold text-foreground px-4 py-3 text-right min-w-[80px]">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  // Loading skeletons
                  Array.from({ length: pageSize }).map((_, idx) => (
                    <TableRow key={idx} className="border-border/40">
                      <TableCell colSpan={7} className="py-4 px-4">
                        <div className="h-5 bg-secondary/60 rounded animate-pulse w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : !reportsData || reportsData.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
                        <div className="h-12 w-12 rounded-full bg-secondary/80 flex items-center justify-center text-muted-foreground">
                          <FileText className="h-6 w-6" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">
                            No interview records found
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            {activeFiltersCount > 0
                              ? "Try adjusting your search criteria or resetting applied filters."
                              : "No interviews have been recorded in this workspace yet."}
                          </p>
                        </div>
                        {activeFiltersCount > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleResetFilters}
                            className="text-xs mt-2"
                          >
                            Reset All Filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  reportsData.items.map((row: ReportItem) => {
                    const resultsUrl = `/results?id=${row.id}`;
                    return (
                      <TableRow
                        key={`${row.id}-${row.session_id || "single"}`}
                        className="border-border/40 hover:bg-secondary/20 transition-colors"
                      >
                        {/* Role Details */}
                        <TableCell className="px-4 py-2.5">
                          <div className="font-semibold text-xs text-foreground flex items-center gap-1.5 flex-wrap">
                            <span title={row.job_role || ""}>{row.job_role || "—"}</span>
                            {row.is_multi_candidate && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-secondary/70">
                                Batch
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        {/* Candidate */}
                        <TableCell className="px-4 py-2.5">
                          <div>
                            <div className="font-medium text-xs text-foreground flex items-center gap-1.5">
                              <User className="h-3 w-3 text-muted-foreground shrink-0" />
                              {row.candidate_name || "Unassigned"}
                            </div>
                            {row.candidate_email && (
                              <div className="text-[10px] text-muted-foreground pl-[18px] truncate max-w-[180px]">
                                {row.candidate_email}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Interviewer */}
                        <TableCell className="px-4 py-2.5">
                          <span className="text-xs text-muted-foreground">
                            {row.interviewer_name || "—"}
                          </span>
                        </TableCell>

                        {/* Date & Duration */}
                        <TableCell className="px-4 py-2.5">
                          <div>
                            <div className="text-xs text-foreground whitespace-nowrap">
                              {formatDate(row.date)}
                            </div>
                            {row.duration_minutes && (
                              <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                {row.duration_minutes} min
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell className="px-4 py-2.5">
                          {getStatusBadge(row.status)}
                        </TableCell>

                        {/* Overall Score */}
                        <TableCell className="px-4 py-2.5">
                          {getScoreBadge(row.overall_score)}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="px-4 py-2.5 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate(resultsUrl)}
                            className="text-xs h-7 px-3 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 font-medium"
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* ── Table Footer & Pagination ──────────────────────────────────── */}
          {reportsData && reportsData.total > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border/50 bg-secondary/20">
              <div className="text-xs text-muted-foreground">
                Showing{" "}
                <span className="font-semibold text-foreground">
                  {(page - 1) * pageSize + 1}
                </span>{" "}
                to{" "}
                <span className="font-semibold text-foreground">
                  {Math.min(page * pageSize, reportsData.total)}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-foreground">
                  {reportsData.total}
                </span>{" "}
                results
              </div>

              <div className="flex items-center gap-4">
                {/* Page Size Selector */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>Rows:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(val) => {
                      setPageSize(Number(val));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="h-7 w-16 text-xs bg-background border-border/70">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Page Navigation */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setPage(1)}
                    disabled={page <= 1 || loading}
                    title="First Page"
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    title="Previous Page"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>

                  <span className="text-xs font-medium text-foreground px-2">
                    {page} / {reportsData.total_pages || 1}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setPage((p) => Math.min(reportsData.total_pages, p + 1))}
                    disabled={page >= reportsData.total_pages || loading}
                    title="Next Page"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setPage(reportsData.total_pages)}
                    disabled={page >= reportsData.total_pages || loading}
                    title="Last Page"
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
