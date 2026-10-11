import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { vi } from "vitest";

import { Providers, ROUTER_FUTURE, routes } from "@/app/App";
import type { SessionResponse } from "@/types/api";

export type Handler = (init: RequestInit | undefined, url: URL) => { status: number; body?: unknown } | Promise<never>;

/** Stub global fetch with handlers keyed by "METHOD /path". Unknown requests fail the test loudly. */
export function mockApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request in test: ${key}`);
    const { status, body } = await handler(init, url);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const USER: SessionResponse = {
  csrf_token: "csrf-test-token",
  user: { id: "u1", email: "student@example.test", role: "student", created_at: "2026-10-01T00:00:00Z",
          has_profile: true, onboarding_completed: false },
};

export const unauthenticated: Handler = () => ({
  status: 401, body: { error: { code: "not_authenticated", message: "Please sign in to continue.", details: null,
                                request_id: "r1" } },
});

export function renderApp(path: string) {
  // Same caching as production (createQueryClient: staleTime 30 s), so refresh tests fail if an
  // invalidation is missing; only retries are disabled to keep failure tests fast.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path], future: ROUTER_FUTURE });
  const view = render(<Providers client={client}><RouterProvider router={router} future={{ v7_startTransition: true }} /></Providers>);
  return { ...view, router };
}
