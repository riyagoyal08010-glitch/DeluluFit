import { ArrowRight, FlaskConical, LogOut, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";

import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/Feedback";
import { useSession } from "@/features/auth/session";
import { cn } from "@/lib/cn";

import { Brand } from "./Brand";
import { NAV_ITEMS } from "./navigation";

/*
 * Navigation uses one set of destinations everywhere (NAV_ITEMS):
 *   desktop  floating glass sidebar with every destination
 *   mobile   floating circular bottom bar with the five primary destinations,
 *            plus a menu drawer (top bar) with every destination
 * The active destination is always a filled slate shape, as in the reference.
 */

function navClass(isActive: boolean): string {
  // Text links, no pills: the active page is black and underlined, the rest felt gray.
  return cn("flex items-center gap-3 py-2 text-sm transition-colors duration-300 ease-glide",
            isActive ? "text-ink underline decoration-1 underline-offset-[6px]" : "text-ink-muted hover:text-ink");
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <li key={to}>
          <NavLink to={to} end={to === "/app"} onClick={onNavigate} className={({ isActive }) => navClass(isActive)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SessionFooter() {
  const { state, logout, exitDemo } = useSession();
  const [busy, setBusy] = useState(false);
  if (state.status === "demo") {
    return <Button variant="secondary" size="sm" className="w-full" onClick={exitDemo}>Exit demo</Button>;
  }
  if (state.status !== "authenticated") return null;
  return (
    <div className="space-y-2">
      <p className="truncate px-1 text-xs text-ink-muted" title={state.user.email}>{state.user.email}</p>
      <Button variant="ghost" size="sm" className="w-full justify-start" loading={busy} icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
              onClick={async () => { setBusy(true); await logout(); }}>
        Sign out
      </Button>
    </div>
  );
}

export function DesktopSidebar() {
  return (
    <aside className="fixed bottom-0 left-0 top-0 z-30 hidden w-60 flex-col border-r border-line bg-canvas px-8 py-8 lg:flex"
           aria-label="Sidebar">
      <Link to="/app" className="mb-12 rounded-control"><Brand /></Link>
      <nav aria-label="Main" className="flex-1"><NavList /></nav>
      <SessionFooter />
    </aside>
  );
}

/** Floating circular bottom bar for phones and tablets: the five primary destinations. */
export function MobileTabBar() {
  return (
    <nav aria-label="Quick navigation"
         className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:hidden">
      <ul className="glass-dark pointer-events-auto flex items-center gap-1 rounded-full p-1.5">
        {NAV_ITEMS.filter((i) => i.primary).map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} end={to === "/app"} title={label}
                     className={({ isActive }) => cn("grid h-12 w-12 place-items-center rounded-full transition-colors",
                                                     isActive ? "bg-white text-ink"
                                                              : "text-white/70 hover:bg-white/10 hover:text-white")}>
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Full navigation drawer for small screens (opened from the top bar). */
function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu"
           className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-ink bg-canvas px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <Brand />
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close menu"
                  className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Main" className="flex-1"><NavList onNavigate={onClose} /></nav>
        <SessionFooter />
      </div>
    </div>
  );
}

export function DemoBanner() {
  const { exitDemo } = useSession();
  return (
    <div role="status" className="mx-auto max-w-content px-4 pt-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-ink bg-sheet px-4 py-2.5 text-sm text-ink shadow-card">
        <span className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span><strong className="font-semibold">Demo mode.</strong> Everything here is sample data. Nothing is saved and this is not an account.</span>
        </span>
        <button type="button" onClick={exitDemo} className="rounded-full border border-ink px-4 py-1 hover:bg-surface-raised">
          Exit demo
        </button>
      </div>
    </div>
  );
}

/** Shown on the dashboard to an account that put setup off ("Finish later"). */
function SetupReminder() {
  return (
    <div className="glass-subtle mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card px-4 py-3 text-sm">
      <p>Your setup isn't finished. Everything you've already saved is kept.</p>
      <ButtonLink to="/app/onboarding" variant="secondary" size="sm" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
        Finish setup
      </ButtonLink>
    </div>
  );
}

export function AppShell() {
  const { state, onboardingDeferred } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (state.status === "loading") return <div className="mx-auto max-w-content px-4"><LoadingState label="Checking your session" /></div>;
  if (state.status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // The server says setup was never finished: offer it, unless the student chose "Finish later".
  // The onboarding page lives outside this shell, so this can't redirect to itself.
  const setupPending = state.status === "authenticated" && !state.user.onboarding_completed;
  if (setupPending && !onboardingDeferred) return <Navigate to="/app/onboarding" replace />;

  return (
    <div className="min-h-screen lg:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-action focus:px-4 focus:py-2 focus:text-ink-inverse">
        Skip to content
      </a>
      <DesktopSidebar />
      <header className="glass sticky top-0 z-20 flex items-center justify-between border-b border-line px-4 py-3 lg:hidden">
        <Link to="/app" className="rounded-control"><Brand /></Link>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}
                aria-controls="mobile-menu" className="grid h-10 w-10 place-items-center rounded-full text-ink ring-1 ring-inset ring-ink hover:bg-surface-raised">
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>
      <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      {state.status === "demo" && <DemoBanner />}
      {/* Bottom padding leaves room for the floating tab bar so it never covers content. */}
      <main id="main" tabIndex={-1} className="mx-auto max-w-content px-4 pb-32 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
        {setupPending && location.pathname === "/app" && <SetupReminder />}
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}
