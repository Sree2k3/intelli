import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { LayoutDashboard, Video, Settings, ShieldCheck, Home, Briefcase, History } from "lucide-react";
import { useSidebarContext } from "@/contexts/SidebarContext";

export function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();

  // Don't show sidebar on public landing page or auth pages if not logged in
  if (!user && (location.pathname === "/" || location.pathname === "/auth" || location.pathname === "/reset-password")) {
    return null;
  }
  
  // Actually, SaaS platforms usually show sidebar everywhere once logged in, 
  // or maybe the user wants it on all pages except auth.
  if (location.pathname === "/auth" || location.pathname === "/reset-password") return null;

  const getDashboardLink = () => {
    if (user?.role === 'super_admin') return "/super-admin";
    return "/dashboard";
  };

  const navItems = [
    { label: "Home", href: "/", icon: Home, show: true },
    { label: "Create Interview", href: "/interview", icon: Video, show: user?.role !== 'super_admin' },
    { label: "Dashboard", href: getDashboardLink(), icon: LayoutDashboard, show: user?.role !== 'super_admin' },
    { label: "History", href: "/history", icon: History, show: user?.role !== 'super_admin' },
  ];

  return (
    <>
      {/* Mobile spacing block */}
      <div className="md:hidden h-16" />
      
      {/* Desktop Sidebar */}
      <aside 
        className="fixed left-0 top-0 bottom-0 z-40 bg-[#0b3d91] border-r border-border/10 hidden md:flex flex-col overflow-x-hidden w-64 text-white shadow-2xl"
      >
        {/* Prominent Enterprise Logo */}
        <div className="flex h-24 items-center justify-center mt-1 mb-5 px-4 shrink-0 w-full overflow-hidden">
          <Link to={getDashboardLink()} className="flex items-center justify-center w-full h-full">
            <img 
              src="/ai-interview-logo.png" 
              alt="AI Interview" 
              className="max-w-full max-h-full object-contain pointer-events-none drop-shadow-[0_0_8px_rgba(255,255,255,0.15)] opacity-95 hover:opacity-100 transition-all duration-300" 
            />
          </Link>
        </div>
        <div className="flex flex-col gap-2 px-3">
          {navItems.filter(item => item.show).map((item) => {
            const isActive = location.pathname === item.href || 
              (item.label === "Dashboard" && location.pathname.includes("dashboard")) ||
              (item.label === "History" && (location.pathname.startsWith("/history") || location.pathname.startsWith("/reports")));
            return (
              <Link 
                key={item.label} 
                to={item.href}
                className={`flex items-center gap-3 py-2.5 rounded-md transition-all duration-200 overflow-hidden px-4 mx-3 ${isActive ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="font-medium whitespace-nowrap">
                  {item.label}
                </span>
              </Link>
            );
          })}

          <PermissionGate permission="add_admin">
            <Link 
              to="/admin"
              className={`flex items-center gap-3 py-2.5 rounded-md transition-all duration-200 overflow-hidden px-4 mx-3 ${location.pathname === "/admin" ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
            >
              <Settings className="h-5 w-5 shrink-0" />
              <span className="font-medium whitespace-nowrap">
                Admin
              </span>
            </Link>
          </PermissionGate>

          <PermissionGate permission="view_dashboard">
            {user?.role === 'super_admin' && (
              <Link 
                to="/super-admin"
                className={`flex items-center gap-3 py-2.5 rounded-md transition-all duration-200 overflow-hidden px-4 mx-3 ${location.pathname.includes("super-admin") ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                <ShieldCheck className="h-5 w-5 shrink-0" />
                <span className="font-medium whitespace-nowrap">
                  Platform
                </span>
              </Link>
            )}
          </PermissionGate>
        </div>
      </aside>
    </>
  );
}
