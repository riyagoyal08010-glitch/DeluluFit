import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiError, setCsrfToken, setUnauthorizedHandler } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import type { SessionResponse, SessionUser } from "@/types/api";

/**
 * Session state for the whole app.
 *
 *   authenticated  a real server-side session (HttpOnly cookie) confirmed by the API
 *   demo           sample data only: no API calls, nothing saved, not an account
 *   anonymous      signed out
 *
 * Demo mode is deliberately separate from authentication; it never sends
 * credentials or pretends to have signed anyone in.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "anonymous"; connectionError?: string; notice?: string }
  | { status: "authenticated"; user: SessionUser }
  | { status: "demo" };

interface SessionContextValue {
  state: SessionState;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string | null) => Promise<void>;
  logout: () => Promise<void>;
  enterDemo: () => void;
  exitDemo: () => void;
  /** Forget the session locally (no API call): clears the CSRF token and every cached query. */
  clearLocalSession: (notice?: string) => void;
  /** True when this signed-in account chose "Finish later" during setup in this browser tab. */
  onboardingDeferred: boolean;
  deferOnboarding: () => void;
  /** Record that the server confirmed setup is complete (from its complete-onboarding response). */
  markOnboardingComplete: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const DEMO_KEY = "delulufit:demo";

function readDemoFlag(): boolean {
  try {
    return window.sessionStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

/*
 * "Finish setup later" lasts for this tab until the next sign-in or sign-out, so an account the
 * server reports as not set up is offered setup again on its next sign-in, but is never forced
 * through it. Keyed by account so it can't carry over to someone else on the same tab.
 */
const DEFER_PREFIX = "delulufit:onboarding-later:";

function readDeferred(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(DEFER_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

function clearDeferred(): void {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(DEFER_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable: nothing was stored */
  }
}

function writeDemoFlag(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(DEMO_KEY, "1");
    else window.sessionStorage.removeItem(DEMO_KEY);
  } catch {
    /* storage unavailable: demo lasts for this page load only */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>(() => (readDemoFlag() ? { status: "demo" } : { status: "loading" }));
  const [deferredFor, setDeferredFor] = useState<string | null>(null);

  const signedOut = useCallback(() => {
    setCsrfToken(null);
    queryClient.clear();
    clearDeferred();
    setDeferredFor(null);
    setState({ status: "anonymous" });
  }, [queryClient]);

  const accept = useCallback((res: SessionResponse) => {
    writeDemoFlag(false);
    setCsrfToken(res.csrf_token);
    setDeferredFor(readDeferred(res.user.id) ? res.user.id : null);
    setState({ status: "authenticated", user: res.user });
  }, []);

  // A fresh sign-in (not a restored session) offers setup again.
  const acceptSignIn = useCallback((res: SessionResponse) => {
    clearDeferred();
    accept(res);
  }, [accept]);

  useEffect(() => {
    setUnauthorizedHandler(signedOut);
    return () => setUnauthorizedHandler(null);
  }, [signedOut]);

  useEffect(() => {
    if (state.status !== "loading") return;
    const controller = new AbortController();
    authApi.session(controller.signal).then(accept).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && err.isUnauthorized) setState({ status: "anonymous" });
      else setState({ status: "anonymous",
                      connectionError: err instanceof ApiError ? err.message : "Could not check your session." });
    });
    return () => controller.abort();
  }, [state.status, accept]);

  const value = useMemo<SessionContextValue>(() => ({
    state,
    login: async (email, password) => acceptSignIn(await authApi.login(email, password)),
    register: async (email, password, displayName) => acceptSignIn(await authApi.register(email, password, displayName)),
    logout: async () => {
      try {
        await authApi.logout();
      } finally {
        signedOut();
      }
    },
    enterDemo: () => {
      writeDemoFlag(true);
      setCsrfToken(null);
      queryClient.clear();
      setState({ status: "demo" });
    },
    clearLocalSession: (notice?: string) => {
      setCsrfToken(null);
      queryClient.clear();
      clearDeferred();
      setDeferredFor(null);
      setState({ status: "anonymous", notice });
    },
    onboardingDeferred: state.status === "authenticated" && deferredFor === state.user.id,
    deferOnboarding: () => {
      if (state.status !== "authenticated") return;
      try {
        window.sessionStorage.setItem(DEFER_PREFIX + state.user.id, "1");
      } catch {
        /* storage unavailable: the choice lasts for this page load only */
      }
      setDeferredFor(state.user.id);
    },
    markOnboardingComplete: () => {
      setState((s) => (s.status === "authenticated" ? { ...s, user: { ...s.user, onboarding_completed: true } } : s));
    },
    exitDemo: () => {
      writeDemoFlag(false);
      queryClient.clear();
      setState({ status: "anonymous" });
    },
  }), [state, deferredFor, accept, acceptSignIn, signedOut, queryClient]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/** "demo" when showing sample data, "live" for a real account. */
export function useDataMode(): "demo" | "live" {
  return useSession().state.status === "demo" ? "demo" : "live";
}
