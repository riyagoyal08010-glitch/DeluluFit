import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { Brand } from "@/components/layout/Brand";
import { ButtonLink } from "@/components/ui/Button";
import { LoginPage, RegisterPage } from "@/features/auth/AuthPages";
import { SessionProvider } from "@/features/auth/session";
import { BudgetPage } from "@/features/budget/BudgetPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { LandingPage } from "@/features/landing/LandingPage";
import { MealsPage } from "@/features/meals/MealsPage";
import { MenuPage } from "@/features/menu/MenuPage";
import { OnboardingPage } from "@/features/onboarding/OnboardingPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { SuggestionsPage } from "@/features/recommendations/SuggestionsPage";
import { ApiError } from "@/lib/api/client";

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <Brand />
      <div aria-hidden="true" className="iridescent mt-10 h-24 w-48" />
      <h1 className="mt-10 text-5xl tracking-[-0.035em]">Page not found</h1>
      <p className="mt-2 text-sm text-ink-muted">That address doesn't match anything in DeluluFit.</p>
      <ButtonLink to="/" className="mt-6">Go to the home page</ButtonLink>
    </main>
  );
}

export const routes: RouteObject[] = [
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  // Outside AppShell: setup has its own focused layout, and the shell's setup redirect can't loop.
  { path: "/app/onboarding", element: <OnboardingPage /> },
  {
    path: "/app",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "meals", element: <MealsPage /> },
      // Loaded on demand: it is the only page that uses the charting library.
      { path: "nutrition", lazy: async () => ({ Component: (await import("@/features/nutrition/NutritionPage")).NutritionPage }) },
      { path: "menu", element: <MenuPage /> },
      { path: "budget", element: <BudgetPage /> },
      { path: "suggestions", element: <SuggestionsPage /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];

/** Opt in to React Router v7 behaviour now, so the eventual upgrade changes nothing. */
export const ROUTER_FUTURE = {
  v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retry network hiccups once; never retry client errors such as 401/403/404/422.
        retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

export function App() {
  const [client] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes, { future: ROUTER_FUTURE }));
  return <Providers client={client}><RouterProvider router={router} future={{ v7_startTransition: true }} /></Providers>;
}
