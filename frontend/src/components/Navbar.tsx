import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Briefcase, Menu, X, LogOut, ShieldCheck, Building, Sun, Moon, ChevronDown } from "lucide-react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useSidebarContext } from "@/contexts/SidebarContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";



export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLight, setIsLight] = useState(() => document.documentElement.classList.contains('light'));
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, redirectToScalozLogin } = useAuth();
  const { isHovered } = useSidebarContext();

  const handleAuthNavigation = (e: React.MouseEvent) => {
    e.preventDefault();
    redirectToScalozLogin();
  };

  const toggleTheme = () => {
    const newTheme = !isLight;
    setIsLight(newTheme);
    if (newTheme) {
      document.documentElement.classList.add('light');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const isReportOnly = sessionStorage.getItem("is_sso_report_only") === "true";
  const hideSidebar = (!user && location.pathname === "/") || location.pathname === "/auth" || location.pathname === "/reset-password" || isReportOnly;

  return (
    <nav className={`fixed top-0 left-0 right-0 ${!hideSidebar ? 'md:left-64' : ''} z-50 bg-background/95 backdrop-blur-md border-b border-border/10 shadow-sm no-print transition-all duration-300 ease-in-out`}>
      <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6">

        {/* Left Side: Logo (only if sidebar is hidden) */}
        <div className="flex items-center">
          {hideSidebar && (
            <Link to="/" className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/30 glow-effect">
                <Briefcase className="h-5 w-5 text-cyan-500" />
              </div>
              <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-blue-500">Xevyte</span>
            </Link>
          )}
        </div>

        {/* Right Side: Admin Profile / Info */}
        <div className="flex items-center gap-4">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-3 px-2 py-1.5 h-auto hover:bg-secondary/20">
                  <div className="flex flex-col items-end text-right">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1 uppercase tracking-tighter">
                      {user.role === 'super_admin' ? <ShieldCheck className="h-3 w-3 text-primary" /> : <Building className="h-3 w-3 text-muted-foreground" />}
                      {user.role?.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                      {user.tenant_name || (user as any).tenantName || (user as any).tenant || localStorage.getItem('xeviewer_tenant') || 'No Tenant'}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-2 rounded-md bg-background/95 backdrop-blur-md">
                <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border/10 mb-1 truncate select-none">
                  {user.email}
                </div>
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer rounded-md font-medium">
                  <LogOut className="h-4 w-4 mr-2" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={handleAuthNavigation}>Sign In</Button>
              <Button variant="hero" size="sm" onClick={handleAuthNavigation}>Get Started</Button>
            </div>
          )}

          {!isReportOnly && (
            <button className="md:hidden text-muted-foreground ml-2" onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl">
            <div className="container mx-auto px-4 py-4 flex flex-col gap-2">
              <Link to="/" onClick={() => setMobileOpen(false)}
                className="px-4 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-secondary transition-colors">
                Home
              </Link>
              <Link to="/dashboard" onClick={() => setMobileOpen(false)}
                className="px-4 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-secondary transition-colors">
                Dashboard
              </Link>
              <Link to="/interview" onClick={() => setMobileOpen(false)}
                className="px-4 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-secondary transition-colors">
                Interview
              </Link>
              {user?.role !== 'recruiter' && (
                <Link to="/admin" onClick={() => setMobileOpen(false)}
                  className="px-4 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-secondary transition-colors">
                  Admin
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

