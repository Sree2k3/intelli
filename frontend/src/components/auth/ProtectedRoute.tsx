import { useEffect } from "react";
import { useAuth, isTokenExpired } from "@/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading, redirectToScalozLogin, session } = useAuth();

  useEffect(() => {
    if (!loading) {
      const token = session?.access_token || localStorage.getItem("xeviewer_token");
      if (!user || isTokenExpired(token)) {
        console.log("ProtectedRoute: User not authenticated or token expired. Redirecting to Scaloz Workspace.");
        redirectToScalozLogin();
      }
    }
  }, [user, loading, redirectToScalozLogin, session]);

  if (loading) {
    return <AppLoading />;
  }

  const token = session?.access_token || localStorage.getItem("xeviewer_token");
  if (!user || isTokenExpired(token)) {
    return null; // The redirect is handled in the useEffect above.
  }

  // Enforce module-based access control
  const isSuperAdmin = user.role?.toLowerCase() === "super_admin" || user.email === "sso-admin@scaloz.com";
  const isSsoUser = !!(user.tenant_id || user.apps);

  if (isSsoUser && !isSuperAdmin) {
    const currentApp = user.current_app || "";
    const userApps = user.apps || [];
    const isAuthorized = currentApp 
      ? (userApps.length > 0 && userApps.includes(currentApp))
      : (userApps.length > 0);

    if (!isAuthorized) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-4xl font-black tracking-tight text-red-500">403 Forbidden</h1>
            <p className="text-lg text-muted-foreground font-semibold">
              You do not have access to this application.
            </p>
          </div>
        </div>
      );
    }
  }

  if (allowedRoles && user.role) {
    const userRole = user.role.toLowerCase();
    const isAllowed = allowedRoles.map(r => r.toLowerCase()).includes(userRole);
    if (!isAllowed) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-3xl font-extrabold tracking-tight text-red-500">Access Denied</h1>
            <p className="text-muted-foreground">
              Your current role ({user.role}) does not have permission to access this page.
            </p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
