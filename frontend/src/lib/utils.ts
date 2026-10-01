import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getScalozLoginUrl(): string {
  // 1. Check if we have a stored origin from a previous SSO handoff
  const storedUrl = localStorage.getItem("scaloz_origin_url");
  if (storedUrl) return storedUrl;

  // 2. Check if we have an environment variable defined
  const envUrl = import.meta.env.VITE_SCALOZ_URL;
  if (envUrl) return envUrl;

  // 3. Fallback based on the current hostname (automatic environment detection for fresh sessions)
  const currentHost = window.location.hostname;
  
  // Local environment detection
  if (currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost.endsWith('.localhost')) {
    return "http://localhost:3001";
  }
  
  // Production fallback
  return "https://apps.scaloz.com";
}

export function isUrlValue(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

export function normalizeAppCode(value: string): string {
  return value.trim().toLowerCase();
}

export function extractCurrentApp(payload: any): string {
  if (!payload) return "";

  // Priority: current_app -> app_id -> aud (only if not a URL)
  if (payload.current_app && !isUrlValue(String(payload.current_app))) {
    return String(payload.current_app);
  }
  if (payload.app_id && !isUrlValue(String(payload.app_id))) {
    return String(payload.app_id);
  }
  const aud = payload.aud;
  if (Array.isArray(aud)) {
    for (const a of aud) {
      if (a && !isUrlValue(String(a))) {
        return String(a);
      }
    }
  } else if (aud && !isUrlValue(String(aud))) {
    return String(aud);
  }
  return "";
}

