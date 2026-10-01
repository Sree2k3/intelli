/**
 * useAuth.tsx — Local-backend JWT auth hook.
 *
 * Drop-in replacement for the Supabase-based hook.
 * The auth object shape (user.id, user.email, user.user_metadata.full_name)
 * is identical so every consumer in Dashboard, Interview, etc. works unchanged.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/backend/client";
import { getScalozLoginUrl, normalizeAppCode, extractCurrentApp } from "@/lib/utils";

interface LocalUser {
  id: string;
  email: string;
  full_name?: string;
  role?: string;
  tenant_id?: string;
  tenant_name?: string;
  user_metadata: { full_name?: string };
  apps?: string[];
  current_app?: string;
}

interface LocalSession {
  access_token: string;
  user: LocalUser;
}

interface AuthContextType {
  user: LocalUser | null;
  session: LocalSession | null;
  loading: boolean;
  /** True once the backend /auth/v1/user sync has completed (role is authoritative). */
  roleResolved: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  redirectToScalozLogin: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now;
  } catch (e) {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleResolved, setRoleResolved] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      // Candidates taking an interview should not have their token query param intercepted/deleted by the SSO flow.
      if (window.location.pathname.startsWith("/take-interview") || window.location.pathname.startsWith("/i/")) {
        setRoleResolved(true);
        setLoading(false);
        return;
      }

      // Intercept SSO token from URL (check multiple possible parameter names)
      const urlParams = new URLSearchParams(window.location.search);
      const tokenKeys = ["scaloz_token", "sso_token", "ssl_token", "token", "access_token"];
      let foundToken = null;
      let foundKey = null;

      for (const key of tokenKeys) {
        if (urlParams.has(key)) {
          foundToken = urlParams.get(key);
          foundKey = key;
          break;
        }
      }

      // Intercept origin environment if passed by Scaloz
      const passedOrigin = urlParams.get("origin") || urlParams.get("scaloz_url") || urlParams.get("scaloz_origin");
      if (passedOrigin) {
        localStorage.setItem("scaloz_origin_url", passedOrigin);
      }

      if (foundToken && foundKey) {
        if (isTokenExpired(foundToken)) {
          console.warn("SSO token in URL is expired");
          localStorage.removeItem("xeviewer_token");
          localStorage.removeItem("xeviewer_user");
          localStorage.removeItem("xeviewer_tenant");
          setUser(null);
          setSession(null);
        } else {
          localStorage.setItem("xeviewer_token", foundToken);

          try {
            const payload = JSON.parse(atob(foundToken.split('.')[1]));

            const rawRole = payload.role || payload.userRole || "admin";
            const rawRoleLower = String(rawRole).toLowerCase().replace(/_/g, " ").replace(/-/g, " ");
            let userRole: string;
            if (rawRoleLower === "employee" || rawRoleLower === "candidate") {
              userRole = "recruiter";
            } else if (rawRoleLower === "manger" || rawRoleLower === "manager" || rawRoleLower === "program manager") {
              userRole = "manager";
            } else if (rawRoleLower === "admin" || rawRoleLower === "subadmin" || rawRoleLower === "sub admin") {
              userRole = "admin";
            } else {
              userRole = "recruiter"; // safe default
            }

            const userEmail = payload.email || payload.sub || "sso-user@scaloz.com";
            const userName = payload.name || payload.fullName || payload.full_name || (
              (payload.firstName || "") + " " + (payload.lastName || "")
            ).trim() || "SSO User";
            // Use email as fallback id; backend will resolve the real UUID via the /me endpoint
            const userId = payload.sub || payload.id || "sso-user";
            let tenantId = payload.tenant || payload.tenantId || payload.tenant_id || null;
            if (!tenantId && typeof window !== "undefined" && window.location) {
              const parts = window.location.hostname.split(".");
              if (parts.length >= 3 && !["www", "aiinterview", "aiinterviewtest", "localhost"].includes(parts[0])) {
                tenantId = parts[0];
              }
            }
            const tenantName = payload.tenantName || payload.tenant_name || tenantId || "SSO Tenant";
            const currentAppVal = extractCurrentApp(payload);

            const userObj: LocalUser = {
              id: userId,
              email: userEmail,
              role: userRole,
              full_name: userName,
              tenant_id: tenantId || undefined,
              tenant_name: tenantName,
              user_metadata: { full_name: userName },
              apps: (payload.apps || []).map((a: string) => normalizeAppCode(a)),
              current_app: currentAppVal ? normalizeAppCode(currentAppVal) : undefined,
            };

            if (tenantId) {
              localStorage.setItem("xeviewer_tenant", tenantId);
            }

            // Persist immediately for fast render
            localStorage.setItem("xeviewer_user", JSON.stringify(userObj));
            setUser(userObj);
            setSession({ access_token: foundToken, user: userObj });
            setLoading(false);

            const syncRoleFromBackend = async (token: string, base: LocalUser) => {
              try {
                const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || "/api";
                const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
                let tenant = localStorage.getItem("xeviewer_tenant") || base.tenant_id || (base as any).tenant || null;
                if (!tenant && typeof window !== "undefined" && window.location) {
                  const parts = window.location.hostname.split(".");
                  if (parts.length === 2 && parts[1] === "localhost" && !["www", "localhost"].includes(parts[0])) {
                    tenant = parts[0];
                  } else if (parts.length >= 3 && !["www", "aiinterview", "aiinterviewtest", "localhost", "127"].includes(parts[0]) && isNaN(Number(parts[0]))) {
                    tenant = parts[0];
                  }
                }
                if (tenant) headers["X-Tenant-ID"] = tenant;

                const meRes = await fetch(`${API_URL}/auth/v1/user`, {
                  headers
                });
                if (meRes.ok) {
                  let meData = await meRes.json();
                  if (meData && meData.encrypted) {
                    const { decryptPayload } = await import("@/lib/encryption");
                    meData = await decryptPayload(meData);
                  }
                  const updatedUser: LocalUser = {
                    ...base,
                    id: meData.id || base.id,
                    role: meData.role || base.role,
                  };
                  localStorage.setItem("xeviewer_user", JSON.stringify(updatedUser));
                  setUser(updatedUser);
                  setSession({ access_token: token, user: updatedUser });
                }
              } catch (_) {
                // Non-fatal: keep the JWT-derived role
              } finally {
                setRoleResolved(true);
              }
            };
            syncRoleFromBackend(foundToken, userObj);
          } catch (e) {
            console.error("Failed to decode token", e);
            setRoleResolved(true); // unblock waiting components even if decode fails
          }
        }

        urlParams.delete(foundKey);
        const newSearch = urlParams.toString() ? `?${urlParams.toString()}` : "";
        window.history.replaceState({}, document.title, window.location.pathname + newSearch + window.location.hash);
      }

      // Fast path: read from localStorage synchronously on first mount.
      const storedToken = localStorage.getItem("xeviewer_token");
      const storedUserRaw = localStorage.getItem("xeviewer_user");
      if (storedToken && storedUserRaw) {
        if (isTokenExpired(storedToken)) {
          console.warn("Stored token is expired");
          localStorage.removeItem("xeviewer_token");
          localStorage.removeItem("xeviewer_user");
          localStorage.removeItem("xeviewer_tenant");
          setUser(null);
          setSession(null);
          setRoleResolved(true);
          setLoading(false);
        } else {
          try {
            const storedUser = JSON.parse(storedUserRaw);
            if (storedUser.role === "manger") {
              storedUser.role = "manager";
            }
            const sess = { access_token: storedToken, user: storedUser };
            setSession(sess as LocalSession);
            setUser(storedUser);
            setLoading(false);

            // Async helper: background-sync role/UUID from backend
            const refreshStoredUser = async () => {
              try {
                const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || "/api";
                const headers: Record<string, string> = { Authorization: `Bearer ${storedToken}` };
                let tenant = localStorage.getItem("xeviewer_tenant") || storedUser?.tenant_id || storedUser?.tenant || null;
                if (!tenant && typeof window !== "undefined" && window.location) {
                  const parts = window.location.hostname.split(".");
                  if (parts.length === 2 && parts[1] === "localhost" && !["www", "localhost"].includes(parts[0])) {
                    tenant = parts[0];
                  } else if (parts.length >= 3 && !["www", "aiinterview", "aiinterviewtest", "localhost", "127"].includes(parts[0]) && isNaN(Number(parts[0]))) {
                    tenant = parts[0];
                  }
                }
                if (tenant) headers["X-Tenant-ID"] = tenant;

                const meRes = await fetch(`${API_URL}/auth/v1/user`, {
                  headers
                });
                if (meRes.ok) {
                  let meData = await meRes.json();
                  if (meData && meData.encrypted) {
                    const { decryptPayload } = await import("@/lib/encryption");
                    meData = await decryptPayload(meData);
                  }
                  const refreshedUser: LocalUser = {
                    ...storedUser,
                    id: meData.id || storedUser.id,
                    role: meData.role || storedUser.role,
                  };
                  localStorage.setItem("xeviewer_user", JSON.stringify(refreshedUser));
                  setUser(refreshedUser);
                  setSession({ access_token: storedToken, user: refreshedUser });
                }
              } catch (_) {
                // Non-fatal
              } finally {
                setRoleResolved(true);
              }
            };
            refreshStoredUser();
          } catch (_) {
            setRoleResolved(true);
            setLoading(false);
          }
        }
      } else {
        // No stored token — role is trivially "resolved" (null user)
        setRoleResolved(true);
        setLoading(false);
      }
    };

    initAuth();

    // Still subscribe to auth state changes (handles sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (sess && isTokenExpired(sess.access_token)) {
        console.warn("Auth state changed session token is expired");
        localStorage.removeItem("xeviewer_token");
        localStorage.removeItem("xeviewer_user");
        localStorage.removeItem("xeviewer_tenant");
        setUser(null);
        setSession(null);
      } else {
        setSession(sess as LocalSession | null);
        setUser((sess as LocalSession | null)?.user ?? null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  const redirectToScalozLogin = () => {
    const currentPath = window.location.pathname + window.location.search + window.location.hash;
    if (currentPath && currentPath !== "/" && !currentPath.startsWith("/auth/sso")) {
      localStorage.setItem("sso_redirect_path", currentPath);
    }
    window.location.replace(getScalozLoginUrl());
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, roleResolved, signUp, signIn, signOut, redirectToScalozLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    return {
      user: null,
      session: null,
      loading: true,
      roleResolved: false,
      signUp: async () => ({ error: new Error("Not in AuthProvider") }),
      signIn: async () => ({ error: new Error("Not in AuthProvider") }),
      signOut: async () => { },
      redirectToScalozLogin: () => { },
    } as AuthContextType;
  }
  return context;
}

