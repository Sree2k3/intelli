/**
 * src/integrations/supabase/client.ts
 *
 * LOCAL BACKEND SHIM
 * ------------------
 * Instead of the real Supabase SDK we expose a thin compatibility object
 * whose surface area exactly matches what the rest of the codebase uses:
 *
 *   supabase.auth.getUser()
 *   supabase.auth.signUp()
 *   supabase.auth.signInWithPassword()
 *   supabase.auth.signOut()
 *   supabase.auth.onAuthStateChange()
 *   supabase.auth.getSession()
 *
 *   supabase.from(table).select().eq().order().limit().single() → data/error
 *   supabase.from(table).insert().select().single()
 *   supabase.from(table).update().eq().select().single()
 *
 *   supabase.functions.invoke(name, { body })
 *
 * All network calls go to VITE_API_BASE_URL (http://localhost:8000).
 */

const BASE = import.meta.env.VITE_API_BASE_URL || "";
import { getScalozLoginUrl } from "@/lib/utils";
import { encryptPayload, decryptPayload } from "@/lib/encryption";

// ─── Token storage (mirrors Supabase localStorage persistence) ───────────────

const TOKEN_KEY = "xeviewer_token";
const USER_KEY = "xeviewer_user";

function saveSession(token: string, user: any) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("xeviewer_tenant");
}
export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredUser(): any | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function getTenant(): string | null {
  let tenant = localStorage.getItem("xeviewer_tenant");
  if (!tenant) {
    try {
      const userRaw = localStorage.getItem(USER_KEY);
      if (userRaw) {
        const u = JSON.parse(userRaw);
        tenant = u.tenant_id || u.tenant || null;
      }
    } catch (_) {}
  }
  if (!tenant && typeof window !== "undefined" && window.location) {
    const parts = window.location.hostname.split(".");
    if (parts.length === 2 && parts[1] === "localhost" && !["www", "localhost"].includes(parts[0])) {
      tenant = parts[0];
    } else if (parts.length >= 3 && !["www", "aiinterview", "aiinterviewtest", "localhost", "127"].includes(parts[0]) && isNaN(Number(parts[0]))) {
      tenant = parts[0];
    }
    if (tenant) {
      try {
        localStorage.setItem("xeviewer_tenant", tenant);
      } catch (_) {}
    }
  }
  return tenant || null;
}

// ─── Fetch helper ────────────────────────────────────────────────────────────

async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<{ data: T | null; error: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  
  const t = token ?? getStoredToken();
  if (t) {
    headers["Authorization"] = `Bearer ${t}`;
  }

  const tenant = getTenant();
  if (tenant) headers["X-Tenant-ID"] = tenant;

  if (options.body && typeof options.body === "string" && headers["Content-Type"] === "application/json") {
    try {
      const parsedBody = JSON.parse(options.body);
      const encryptedBody = await encryptPayload(parsedBody);
      options.body = JSON.stringify(encryptedBody);
    } catch (e) {
      console.warn("Skipping encryption for payload:", e);
    }
  }

  try {
    const res = await fetch(`${BASE}${path}`, { ...options, headers });
    if (!res.ok) {
      if (res.status === 401) {
        // Only redirect to login for admin/recruiter pages, NOT candidate interview pages
        const isCandidatePage = window.location.pathname.startsWith("/take-interview") || window.location.pathname.startsWith("/i/");
        if (!isCandidatePage) {
          localStorage.removeItem("xeviewer_token");
          localStorage.removeItem("xeviewer_user");
          localStorage.removeItem("xeviewer_tenant");
          window.location.replace(getScalozLoginUrl());
        }
      }
      const errRaw = await res.json().catch(() => ({ detail: res.statusText }));
      const err = await decryptPayload(errRaw).catch(() => errRaw);
      return { data: null, error: { message: err.detail ?? err.error ?? res.statusText } };
    }
    const raw = await res.json();
    const data = await decryptPayload(raw);
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message } };
  }
}

// ─── Auth state listeners ────────────────────────────────────────────────────

type AuthChangeCallback = (event: string, session: any) => void;
const _listeners: AuthChangeCallback[] = [];

function _notifyListeners(event: string, session: any) {
  _listeners.forEach((cb) => cb(event, session));
}

// ─── Query builder ───────────────────────────────────────────────────────────

function buildQueryBuilder(table: string, inviteToken?: string) {
  type Row = Record<string, any>;

  let _method: "GET" | "POST" | "PATCH" | "DELETE" = "GET";
  let _body: Row | null = null;
  const _filters: Record<string, any> = {};
  let _orderField: string | null = null;
  let _orderAsc = true;
  let _limitVal: number | null = null;
  let _isSingle = false;
  let _selectFields = "*";

  const qb: any = {
    select(fields = "*") {
      _selectFields = fields;
      return qb;
    },
    insert(row: Row | Row[]) {
      _method = "POST";
      _body = Array.isArray(row) ? row[0] : row;
      return qb;
    },
    update(row: Partial<Row>) {
      _method = "PATCH";
      _body = row;
      return qb;
    },
    delete() {
      _method = "DELETE";
      return qb;
    },
    eq(field: string, value: any) {
      _filters[field] = value;
      return qb;
    },
    order(field: string, opts?: { ascending?: boolean }) {
      _orderField = field;
      _orderAsc = opts?.ascending !== false;
      return qb;
    },
    limit(n: number) {
      _limitVal = n;
      return qb;
    },
    single() {
      _isSingle = true;
      return qb;
    },

    // Thenable — execute when awaited
    then(resolve: (v: any) => any, reject?: (e: any) => any) {
      return qb._execute().then(resolve, reject);
    },

    async _execute(): Promise<{ data: any; error: any }> {
      const extraHeaders: Record<string, string> = {};
      if (inviteToken) extraHeaders["x-invite-token"] = inviteToken;

      // ── READ ──────────────────────────────────────────────────────────────
      if (_method === "GET") {
        // Special case: interviews by invite token (candidate flow)
        if (table === "interviews" && _filters["invite_token"]) {
          const token = _filters["invite_token"];
          const { data, error } = await apiFetch(
            `/rest/v1/interviews/by-token/${token}`,
            { method: "GET", headers: extraHeaders },
          );
          return { data: _isSingle ? data : [data], error };
        }

        // interview_questions by interview_id
        if (table === "interview_questions" && _filters["interview_id"]) {
          const qs = new URLSearchParams({ interview_id: _filters["interview_id"] });
          if (_filters["selected"] !== undefined) qs.set("selected", String(_filters["selected"]));
          const { data, error } = await apiFetch(
            `/rest/v1/interview_questions?${qs}`,
            { method: "GET", headers: extraHeaders },
          );
          return { data, error };
        }

        // interview_messages by interview_id
        if (table === "interview_messages" && _filters["interview_id"]) {
          const { data, error } = await apiFetch(
            `/rest/v1/interview_messages?interview_id=${_filters["interview_id"]}`,
            { method: "GET", headers: extraHeaders },
          );
          return { data, error };
        }

        // code_submissions by interview_id
        if (table === "code_submissions" && _filters["interview_id"]) {
          const { data, error } = await apiFetch(
            `/rest/v1/code_submissions?interview_id=${_filters["interview_id"]}`,
            { method: "GET", headers: extraHeaders },
          );
          return { data, error };
        }

        // coding_questions by interview_id
        if (table === "coding_questions" && _filters["interview_id"]) {
          const { data, error } = await apiFetch(
            `/rest/v1/coding_questions?interview_id=${_filters["interview_id"]}`,
            { method: "GET", headers: extraHeaders },
          );
          return { data, error };
        }

        // interviews list
        if (table === "interviews" && !_filters["id"] && !_filters["invite_token"]) {
          const { data, error } = await apiFetch("/rest/v1/interviews", { method: "GET" });
          return { data, error };
        }

        // single interview by id
        if (table === "interviews" && _filters["id"]) {
          const { data, error } = await apiFetch(`/rest/v1/interviews/${_filters["id"]}`, { method: "GET" });
          return { data: _isSingle ? data : [data], error };
        }

        return { data: null, error: { message: `Unsupported GET on ${table}` } };
      }

      // ── INSERT / CREATE ───────────────────────────────────────────────────
      if (_method === "POST") {
        if (table === "interviews") {
          const { data, error } = await apiFetch("/rest/v1/interviews", {
            method: "POST",
            body: JSON.stringify(_body),
          });
          return { data: _isSingle ? data : [data], error };
        }
        if (table === "interview_messages") {
          // Messages are saved server-side by ai-interview endpoint; skip
          return { data: _body, error: null };
        }
        return { data: null, error: { message: `Unsupported POST on ${table}` } };
      }

      // ── UPDATE / PATCH ────────────────────────────────────────────────────
      if (_method === "PATCH") {
        if (table === "interviews") {
          // Candidate token update
          if (inviteToken && _filters["id"]) {
            const { data, error } = await apiFetch(
              `/rest/v1/interviews/by-token/${inviteToken}`,
              { method: "PATCH", body: JSON.stringify(_body), headers: extraHeaders },
            );
            return { data: _isSingle ? data : [data], error };
          }
          const id = _filters["id"];
          if (!id) return { data: null, error: { message: "Missing id for PATCH interviews" } };
          const { data, error } = await apiFetch(`/rest/v1/interviews/${id}`, {
            method: "PATCH",
            body: JSON.stringify(_body),
          });
          return { data: _isSingle ? data : [data], error };
        }
        if (table === "interview_questions") {
          const id = _filters["id"];
          if (!id) return { data: null, error: { message: "Missing id for PATCH interview_questions" } };
          const { data, error } = await apiFetch(
            `/rest/v1/interview_questions/${id}`,
            { method: "PATCH", body: JSON.stringify(_body), headers: extraHeaders },
          );
          return { data: _isSingle ? data : [data], error };
        }
        return { data: null, error: { message: `Unsupported PATCH on ${table}` } };
      }

      return { data: null, error: { message: "Unknown method" } };
    },
  };
  return qb;
}

// ─── Functions invoker shim ──────────────────────────────────────────────────

function buildFunctions(inviteToken?: string) {
  return {
    async invoke(name: string, opts: { body?: any; headers?: Record<string, string> } = {}) {
      const extraHeaders = { ...(opts.headers || {}) };
      if (inviteToken) extraHeaders["x-invite-token"] = inviteToken;

      const { data, error } = await apiFetch(`/functions/v1/${name}`, {
        method: "POST",
        body: JSON.stringify(opts.body ?? {}),
        headers: extraHeaders,
      });
      return { data, error };
    },
  };
}

// ─── Auth shim ───────────────────────────────────────────────────────────────

const auth = {
  async signUp({ email, password, options }: any) {
    const { data, error } = await apiFetch<any>("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        full_name: options?.data?.full_name ?? null,
      }),
    });
    if (error) return { data: null, error };
    let mappedRole = data.role;
    if (mappedRole === "employee" || mappedRole === "candidate") {
      mappedRole = "recruiter";
    }
    saveSession(data.access_token, {
      id: data.user_id, email: data.email, full_name: data.full_name,
      role: mappedRole, tenant_id: data.tenant_id, tenant_name: data.tenant_name,
      user_metadata: { full_name: data.full_name },
    });
    // Persist tenant_id so authFetch sends X-Tenant-ID on every subsequent request
    if (data.tenant_id) {
      localStorage.setItem("xeviewer_tenant", data.tenant_id);
    }
    const session = {
      access_token: data.access_token,
      user: { 
        id: data.user_id, 
        email: data.email, 
        role: mappedRole,
        tenant_id: data.tenant_id,
        tenant_name: data.tenant_name,
        user_metadata: { full_name: data.full_name } 
      },
    };
    _notifyListeners("SIGNED_IN", session);
    return { data: { session, user: session.user }, error: null };
  },

  async signInWithPassword({ email, password }: any) {
    const { data, error } = await apiFetch<any>("/auth/v1/token", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (error) return { data: null, error };
    let mappedRole = data.role;
    if (mappedRole === "employee" || mappedRole === "candidate") {
      mappedRole = "recruiter";
    }
    saveSession(data.access_token, {
      id: data.user_id, email: data.email, full_name: data.full_name,
      role: mappedRole, tenant_id: data.tenant_id, tenant_name: data.tenant_name,
      user_metadata: { full_name: data.full_name },
    });
    // Persist tenant_id so authFetch sends X-Tenant-ID on every subsequent request
    if (data.tenant_id) {
      localStorage.setItem("xeviewer_tenant", data.tenant_id);
    }
    const session = {
      access_token: data.access_token,
      user: { 
        id: data.user_id, 
        email: data.email, 
        role: mappedRole,
        tenant_id: data.tenant_id,
        tenant_name: data.tenant_name,
        user_metadata: { full_name: data.full_name } 
      },
    };
    _notifyListeners("SIGNED_IN", session);
    return { data: { session, user: session.user }, error: null };
  },

  async signOut() {
    clearSession();
    _notifyListeners("SIGNED_OUT", null);
    window.location.replace(getScalozLoginUrl());
  },

  async getUser() {
    const user = getStoredUser();
    return { data: { user }, error: null };
  },

  async getSession() {
    const token = getStoredToken();
    const user = getStoredUser();
    if (!token || !user) return { data: { session: null }, error: null };
    const session = { access_token: token, user };
    return { data: { session }, error: null };
  },

  onAuthStateChange(callback: AuthChangeCallback) {
    _listeners.push(callback);
    // Replay current session immediately
    const token = getStoredToken();
    const user = getStoredUser();
    if (token && user) {
      setTimeout(() => callback("SIGNED_IN", { access_token: token, user }), 0);
    } else {
      setTimeout(() => callback("SIGNED_OUT", null), 0);
    }
    return {
      data: {
        subscription: {
          unsubscribe() {
            const idx = _listeners.indexOf(callback);
            if (idx >= 0) _listeners.splice(idx, 1);
          },
        },
      },
    };
  },

  // Exposed for SSO handoff — allows manual SIGNED_IN re-notification
  _notifyListeners,
};

// ─── Table factory (supports candidateClient pattern) ────────────────────────

function createFromFactory(inviteToken?: string) {
  return (table: string) => buildQueryBuilder(table, inviteToken);
}

// ─── Public supabase object ──────────────────────────────────────────────────

export const supabase = {
  auth,
  functions: buildFunctions(),
  from: createFromFactory(),
};

/**
 * createClient shim — used by candidateClient() in src/lib/api.ts.
 * Ignores URL/key (they now point to local backend via .env).
 * Accepts the x-invite-token via the `global.headers` option.
 */
export function createClient(_url: string, _key: string, opts?: any) {
  const inviteToken: string | undefined =
    opts?.global?.headers?.["x-invite-token"];
  return {
    auth,
    functions: buildFunctions(inviteToken),
    from: createFromFactory(inviteToken),
  };
}

export type { };  // keep as module