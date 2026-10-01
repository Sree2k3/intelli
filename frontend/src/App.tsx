import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { Loader2, Brain } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider, useSidebarContext } from "@/contexts/SidebarContext";
import { AppLoading } from "@/components/AppLoading";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";


// Lazy load pages for production performance
const Index = lazy(() => import("./pages/Index"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Interview = lazy(() => import("./pages/Interview"));
const CandidateInterview = lazy(() => import("./pages/CandidateInterview"));
const Results = lazy(() => import("./pages/Results"));
const ReportsHistory = lazy(() => import("./pages/ReportsHistory"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const SuperAdminDashboard = lazy(() => import("./pages/SuperAdminDashboard"));
const SSO = lazy(() => import("./pages/SSO"));
const NotFound = lazy(() => import("./pages/NotFound"));
const InterviewDetails = lazy(() => import("./pages/InterviewDetails").then(module => ({ default: module.InterviewDetails })));

const queryClient = new QueryClient();

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const isReportOnly = sessionStorage.getItem("is_sso_report_only") === "true";
  const hideSidebar = (!user && location.pathname === "/") || location.pathname.startsWith("/take-interview") || location.pathname.startsWith("/i/") || isReportOnly;

  useEffect(() => {
    if (isReportOnly && location.pathname !== "/results" && location.pathname !== "/auth/sso" && !location.pathname.startsWith("/take-interview") && !location.pathname.startsWith("/i/")) {
      const reportPath = sessionStorage.getItem("sso_report_path") || "/results";
      navigate(reportPath, { replace: true });
    }
  }, [isReportOnly, location.pathname, navigate]);

  const hideFooter = 
    location.pathname.startsWith("/take-interview") || 
    location.pathname.startsWith("/i/") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/dashboard") ||
    location.pathname.startsWith("/results") ||
    location.pathname.startsWith("/history") ||
    location.pathname.startsWith("/reports") ||
    location.pathname.startsWith("/interview");

  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-hidden">
      {!hideSidebar && <Sidebar />}
      <main className={`flex-1 min-w-0 max-w-full flex flex-col min-h-screen transition-all duration-300 overflow-x-hidden ${!hideSidebar ? 'md:ml-64' : ''}`}>
        <div className="flex-1 min-w-0 max-w-full w-full overflow-x-hidden">
          {children}
        </div>
        {!hideFooter && (
          <footer className="w-full bg-background border-t border-border/10 py-6 mt-auto relative z-10">
            <div className="container mx-auto px-4 flex justify-center items-center">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
                © 2026 Xevyte AI. Intelligent hiring at scale.
              </p>
            </div>
          </footer>
        )}
      </main>
    </div>
  );
};

const App = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <SidebarProvider>
                <MainLayout>
                  <Suspense fallback={<AppLoading />}>
                    <Routes>
                      <Route path="/" element={
                        <ProtectedRoute>
                          <Index />
                        </ProtectedRoute>
                      } />
                      <Route path="/dashboard" element={
                        <ProtectedRoute>
                          <AdminDashboard />
                        </ProtectedRoute>
                      } />
                      <Route path="/interview" element={
                        <ProtectedRoute>
                          <Interview />
                        </ProtectedRoute>
                      } />
                      <Route path="/take-interview" element={<CandidateInterview />} />
                      <Route path="/i/:shortCode" element={<CandidateInterview />} />
                      <Route path="/results" element={
                        <ProtectedRoute>
                          <Results />
                        </ProtectedRoute>
                      } />
                      <Route path="/history" element={
                        <ProtectedRoute>
                          <ReportsHistory />
                        </ProtectedRoute>
                      } />
                      <Route path="/reports" element={
                        <ProtectedRoute>
                          <ReportsHistory />
                        </ProtectedRoute>
                      } />
                      <Route path="/admin" element={
                        <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                          <Admin />
                        </ProtectedRoute>
                      } />
                      <Route path="/admin/dashboard" element={
                        <ProtectedRoute>
                          <AdminDashboard />
                        </ProtectedRoute>
                      } />
                      <Route path="/admin/interviews/:id" element={
                        <ProtectedRoute>
                          <InterviewDetails />
                        </ProtectedRoute>
                      } />
                      <Route path="/super-admin" element={
                        <ProtectedRoute allowedRoles={["super_admin"]}>
                          <SuperAdminDashboard />
                        </ProtectedRoute>
                      } />
                      <Route path="/auth/sso" element={<SSO />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </MainLayout>
              </SidebarProvider>
            </BrowserRouter>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
