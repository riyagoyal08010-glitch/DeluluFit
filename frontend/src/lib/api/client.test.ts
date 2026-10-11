import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest, setCsrfToken, setUnauthorizedHandler } from "./client";

function respond(status: number, body?: unknown, raw?: string) {
  const fetchMock = vi.fn(async () => new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  setCsrfToken(null);
  setUnauthorizedHandler(null);
});

describe("apiRequest", () => {
  it("sends credentials, JSON and the CSRF token only on unsafe methods", async () => {
    const fetchMock = respond(200, { ok: true });
    setCsrfToken("tok");
    await apiRequest("/api/v1/thing", { method: "POST", body: { a: 1 } });
    await apiRequest("/api/v1/thing", { query: { date: "2026-10-11", empty: "", none: undefined } });
    const [postUrl, post] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [getUrl, get] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(postUrl).toBe("/api/v1/thing");
    expect(post.credentials).toBe("include");
    expect((post.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok");
    expect((post.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(post.body).toBe('{"a":1}');
    expect(getUrl).toBe("/api/v1/thing?date=2026-10-11");
    expect((get.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
  });

  it("normalizes the backend error envelope", async () => {
    respond(422, { error: { code: "validation_failed", message: "Some fields are invalid.",
                            details: [{ loc: ["body", "email"], msg: "Value error, Enter a valid email address." }],
                            request_id: "req-1" } });
    const err = await apiRequest("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect([apiErr.status, apiErr.code, apiErr.message, apiErr.requestId])
      .toEqual([422, "validation_failed", "Some fields are invalid.", "req-1"]);
    expect(apiErr.fieldErrors()).toEqual({ email: "Enter a valid email address." });
  });

  it("turns a non-JSON server failure into a safe generic error", async () => {
    respond(502, undefined, "<html>Bad gateway</html>");
    await expect(apiRequest("/x")).rejects.toMatchObject({ status: 502, code: "server_error" });
  });

  it("reports network failures without leaking internals", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(apiRequest("/x")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("propagates aborts as aborts, not as network errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(apiRequest("/x")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("calls the unauthorized handler on 401 unless the caller opts out", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    respond(401, { error: { code: "session_expired", message: "Your session has expired." } });
    await expect(apiRequest("/x")).rejects.toMatchObject({ code: "session_expired" });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(apiRequest("/x", { skipUnauthorizedHandler: true })).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handles empty 204 responses and rejects an empty 200", async () => {
    respond(204);
    await expect(apiRequest("/x", { method: "DELETE" })).resolves.toBeUndefined();
    respond(200, undefined, "");
    await expect(apiRequest("/x")).rejects.toMatchObject({ code: "invalid_response" });
  });
});
