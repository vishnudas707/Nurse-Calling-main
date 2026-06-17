import { authHeaders } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

export type ApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
};

async function parseResponse<T>(resp: Response): Promise<ApiResult<T>> {
  const text = await resp.text();
  let data: T & { success?: boolean; error?: string } = {} as T;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: resp.status,
        data: {} as T,
        error: resp.ok ? "Invalid server response" : text || resp.statusText || "Request failed",
      };
    }
  }
  const error = !resp.ok
    ? data.error || `Request failed (${resp.status})`
    : data.success === false
      ? data.error || "Request failed"
      : undefined;
  return { ok: resp.ok && data.success !== false, status: resp.status, data, error };
}

export async function adminGet<T>(path: string): Promise<ApiResult<T>> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { ...authHeaders() },
  });
  return parseResponse<T>(resp);
}

export async function adminPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(resp);
}

export async function adminPut<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(resp);
}

export async function adminDelete<T>(path: string): Promise<ApiResult<T>> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  return parseResponse<T>(resp);
}

export function normalizeRole(role?: string): string {
  const r = (role || "user").toLowerCase();
  if (r === "super_admin" || r === "superadmin") return "super_admin";
  if (r === "admin" || r === "a") return "admin";
  return "user";
}
