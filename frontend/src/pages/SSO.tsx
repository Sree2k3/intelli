import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getScalozLoginUrl, normalizeAppCode, extractCurrentApp } from "@/lib/utils";

/**
 * SSO.tsx — Scaloz SSO handoff page.
 *
 * The Scaloz tenant portal redirects to:
 *   /auth/sso?token=<JWT>&tenant=<UUID>&tenant_name=<name>
 *
 * This component:
 *  1. Parses token + tenant from the raw URL (window.location) for reliability.
 *  2. Persists them to localStorage so that apiFetch / authFetch attach them.
 *  3. Uses window.location.replace() for a clean page reload so AuthProvider
 *     re-initializes from localStorage and ProtectedRoute sees the user.
 */
export default function SSO() {
  const [status, setStatus] = useState<string>("Parsing SSO parameters...");

  useEffect(() => {
    // ── 1. Parse from raw URL (more reliable than useSearchParams) ──────
    const raw = window.location.search || "";
    const params = new URLSearchParams(raw);

    // Also check the hash in case the redirect used a fragment
    const hashParams = window.location.hash.includes("?")
      ? new URLSearchParams(window.location.hash.split("?")[1])
      : null;

    const tokenKeys = ["scaloz_token", "sso_token", "ssl_token", "token", "access_token"];
    let token = null;

    for (const key of tokenKeys) {
      const val = params.get(key) || hashParams?.get(key);
      if (val) {
        token = val;
        break;
      }
    }

    // Fallback: check if AuthProvider already intercepted and stored the token
    if (!token) {
      token = localStorage.getItem("xeviewer_token");
      console.log("[SSO] Token not in URL, retrieved from localStorage:", token ? "YES" : "NO");
    }

    const origin =
      params.get("origin") ||
      params.get("scaloz_url") ||
      params.get("scaloz_origin") ||
      hashParams?.get("origin") ||
      null;

    if (origin) {
      localStorage.setItem("scaloz_origin_url", origin);
    }

    console.log("[SSO] Raw URL:", window.location.href);
    console.log("[SSO] Token resolved:", token ? `${token.substring(0, 20)}...` : "NULL");

    if (!token) {
      console.error("[SSO] No token found in URL or localStorage — redirecting to Scaloz login");
      setStatus("No token found. Redirecting to login...");
      setTimeout(() => window.location.replace(getScalozLoginUrl()), 500);
      return;
    }

    // ── 2. Parse tenant & user details from payload ────────────────────────
    let tenant = params.get("tenant") || hashParams?.get("tenant") || localStorage.getItem("xeviewer_tenant") || null;
    let tenantName =
      params.get("tenant_name") ||
      params.get("tenantName") ||
      hashParams?.get("tenant_name") ||
      hashParams?.get("tenantName") ||
      null;

    let userRole = "admin";
    let userEmail = "sso-user@scaloz.com";
    let userName = "SSO Admin";
    let userId = "sso-user";

    let payload: any = {};
    try {
      payload = JSON.parse(atob(token.split(".")[1]));

      // Extract tenant info from token if not in URL
      if (!tenant) {
        tenant = payload.tenant || payload.tenantId || payload.tenant_id || null;
      }
      if (!tenant && typeof window !== "undefined" && window.location) {
        const parts = window.location.hostname.split(".");
        if (parts.length === 2 && parts[1] === "localhost" && !["www", "localhost"].includes(parts[0])) {
          tenant = parts[0];
        } else if (parts.length >= 3 && !["www", "aiinterview", "aiinterviewtest", "localhost", "127"].includes(parts[0]) && isNaN(Number(parts[0]))) {
          tenant = parts[0];
        }
      }
      if (!tenantName) {
        tenantName = payload.tenantName || payload.tenant_name || payload.tenant || tenant || "SSO Tenant";
      }

      const rawRole = payload.role || payload.userRole || "admin";
      const rawRoleLower = String(rawRole).toLowerCase().replace(/_/g, " ").replace(/-/g, " ");
      if (rawRoleLower === "employee" || rawRoleLower === "candidate") {
        userRole = "recruiter";
      } else if (rawRoleLower === "manger" || rawRoleLower === "manager" || rawRoleLower === "program manager") {
        userRole = "manager";
      } else if (rawRoleLower === "admin" || rawRoleLower === "subadmin" || rawRoleLower === "sub admin") {
        userRole = "admin";
      } else {
        userRole = "recruiter"; // safe default
      }

      userEmail = payload.email || payload.sub || userEmail;
      userName = payload.name || payload.fullName || payload.full_name || (
        (payload.firstName || "") + " " + (payload.lastName || "")
      ).trim() || userName;
      userId = payload.sub || payload.id || userId;
    } catch (e) {
      console.error("[SSO] Error parsing token payload:", e);
    }

    console.log("[SSO] Resolved tenant:", tenant);
    console.log("[SSO] Resolved tenantName:", tenantName);

    // ── 3. Persist to localStorage ─────────────────────────────────────
    localStorage.setItem("xeviewer_token", token);
    console.log("[SSO] ✓ Saved token to localStorage");

    if (tenant) {
      localStorage.setItem("xeviewer_tenant", tenant);
      console.log("[SSO] ✓ Saved tenant to localStorage:", tenant);
    } else {
      console.warn("[SSO] ⚠ No tenant param found — X-Tenant-ID header might be missing!");
    }

    const currentAppVal = extractCurrentApp(payload);

    const userObj = {
      id: userId,
      email: userEmail,
      role: userRole,
      full_name: userName,
      tenant_id: tenant || undefined,
      tenant_name: tenantName || tenant || "SSO Tenant",
      user_metadata: { full_name: userName },
      apps: (payload.apps || []).map((a: string) => normalizeAppCode(a)),
      current_app: currentAppVal ? normalizeAppCode(currentAppVal) : undefined,
    };
    localStorage.setItem("xeviewer_user", JSON.stringify(userObj));
    console.log("[SSO] ✓ Saved user object to localStorage:", JSON.stringify(userObj));

    // ── 3. Verify the writes actually persisted ────────────────────────
    const verifyToken = localStorage.getItem("xeviewer_token");
    const verifyTenant = localStorage.getItem("xeviewer_tenant");
    const verifyUser = localStorage.getItem("xeviewer_user");
    console.log("[SSO] Verify — token in storage:", verifyToken ? "YES" : "NO");
    console.log("[SSO] Verify — tenant in storage:", verifyTenant);
    console.log("[SSO] Verify — user in storage:", verifyUser ? "YES" : "NO");

    if (!verifyToken) {
      console.error("[SSO] FATAL: Token was NOT persisted to localStorage!");
      setStatus("Error: Could not save authentication. Please try again.");
      return;
    }


    setStatus("Authenticated! Redirecting to home...");

    // ── 4. Full page redirect (not client-side navigate) ───────────────
    // We use window.location.replace() instead of React Router navigate()
    // so that AuthProvider initializes fresh from localStorage on the new
    // page load — guaranteeing ProtectedRoute sees the user immediately.
    let redirectPath = params.get("sso_redirect_path") || hashParams?.get("sso_redirect_path");
    // Only honor stored sso_redirect_path if it is specifically a report/results path
    const storedRedirect = localStorage.getItem("sso_redirect_path");
    if (!redirectPath && storedRedirect && storedRedirect.startsWith("/results")) {
      redirectPath = storedRedirect;
    }
    localStorage.removeItem("sso_redirect_path");

    if (redirectPath) {
      if (redirectPath.startsWith("/results")) {
        sessionStorage.setItem("is_sso_report_only", "true");
        sessionStorage.setItem("sso_report_path", redirectPath);
      } else {
        sessionStorage.removeItem("is_sso_report_only");
        sessionStorage.removeItem("sso_report_path");
      }
      window.location.replace(redirectPath);
    } else {
      sessionStorage.removeItem("is_sso_report_only");
      sessionStorage.removeItem("sso_report_path");
      window.location.replace("/");
    }
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-cyan-500" />
        <h2 className="text-xl font-bold tracking-tight">Authenticating with Scaloz SSO...</h2>
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
