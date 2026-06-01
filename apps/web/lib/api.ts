function normalizeApiBaseUrl(value: string | undefined): string {
  const configured = value?.replace(/\/$/, "") || "/api";
  if (typeof window === "undefined" || process.env.NODE_ENV !== "production") {
    return configured;
  }
  try {
    const url = new URL(configured, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}`.replace(/\/$/, "") || "/api" : "/api";
  } catch {
    return "/api";
  }
}

export const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function csrfHeaders(): Record<string, string> {
  return { "x-nmth-csrf": "1" };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...csrfHeaders(),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 403 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nmth:api-forbidden", { detail: { path, body } }));
    }
    throw new ApiError(body, response.status);
  }
  return response.json() as Promise<T>;
}

export function formatRelativeDelay(dateLike?: string | Date | null): string {
  if (!dateLike) return "-";
  const date = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
