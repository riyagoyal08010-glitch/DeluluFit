/**
 * The only place the app talks HTTP.
 *
 * - Base URL from VITE_API_BASE_URL ("" = same origin; the dev server proxies /api).
 * - Session is an HttpOnly cookie, so every request sends credentials. No token is
 *   ever stored in localStorage.
 * - Unsafe methods send the per-session CSRF token held in memory.
 * - Every failure becomes an ApiError with a stable `code`; callers never parse
 *   raw responses. There is no fallback to demo data on failure.
 */

export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const CSRF_HEADER = "X-CSRF-Token";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, details: unknown = null, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Field-level messages from a 422 validation response, keyed by field name. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as Array<{ loc?: unknown[]; msg?: string }>) {
      const field = d.loc?.[d.loc.length - 1];
      if (typeof field === "string" && d.msg) out[field] = d.msg.replace(/^Value error, /, "");
    }
    return out;
  }
}

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Called once by the auth provider so an expired session signs the UI out everywhere. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
  /** Auth endpoints handle their own 401s (e.g. wrong password) without signing out. */
  skipUnauthorizedHandler?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (UNSAFE.has(method) && csrfToken) headers[CSRF_HEADER] = csrfToken;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "We couldn't reach DeluluFit. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = (payload as { error?: { code?: string; message?: string; details?: unknown; request_id?: string } })
      ?.error;
    const error = envelope?.code
      ? new ApiError(response.status, envelope.code, envelope.message ?? "Request failed.", envelope.details ?? null,
                     envelope.request_id ?? null)
      : new ApiError(response.status, response.status >= 500 ? "server_error" : "http_error",
                     response.status >= 500 ? "Something went wrong on our side. Please try again."
                                            : "The request could not be completed.");
    if (error.isUnauthorized && !options.skipUnauthorizedHandler) onUnauthorized?.();
    throw error;
  }
  if (payload === null) {
    throw new ApiError(response.status, "invalid_response", "The server sent an unexpected response.");
  }
  return payload as T;
}
