import { FlaskConical, LogOut, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/Button";
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
  return cn("flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
            isActive ? "bg-action text-ink-inverse shadow-pill" : "text-ink-muted hover:bg-white/70 hover:text-ink");
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
    <aside className="glass-elevated fixed bottom-4 left-4 top-4 z-30 hidden w-60 flex-col rounded-card px-4 py-6 lg:flex"
           aria-label="Sidebar">
      <Link to="/app" className="mb-8 rounded-control px-2"><Brand /></Link>
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
      <ul className="glass-elevated pointer-events-auto flex items-center gap-1.5 rounded-full p-1.5">
        {NAV_ITEMS.filter((i) => i.primary).map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} end={to === "/app"} title={label}
                     className={({ isActive }) => cn("grid h-12 w-12 place-items-center rounded-full transition-colors",
                                                     isActive ? "bg-action text-ink-inverse shadow-pill"
                                                              : "bg-white/70 text-ink hover:bg-white")}>
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
      <div className="absolute inset-0 bg-[rgb(36_55_70/0.18)] backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <div id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu"
           className="glass-elevated absolute inset-y-2 left-2 flex w-72 max-w-[85vw] flex-col rounded-card px-4 py-5">
        <div className="mb-6 flex items-center justify-between">
          <Brand />
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close menu"
                  className="rounded-full p-2 text-ink-muted hover:bg-white/70 hover:text-ink">
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
      <div className="glass-subtle flex flex-wrap items-center justify-between gap-2 rounded-card border-warning/30 px-4 py-2.5 text-sm text-warning">
        <span className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span><strong className="font-semibold">Demo mode.</strong> Everything here is sample data. Nothing is saved and this is not an account.</span>
        </span>
        <button type="button" onClick={exitDemo} className="rounded-full px-3 py-1 font-medium underline-offset-2 hover:bg-white/60 hover:underline">
          Exit demo
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const { state } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (state.status === "loading") return <div className="mx-auto max-w-content px-4"><LoadingState label="Checking your session" /></div>;
  if (state.status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="min-h-screen lg:pl-[17rem]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-action focus:px-4 focus:py-2 focus:text-ink-inverse">
        Skip to content
      </a>
      <DesktopSidebar />
      <header className="glass sticky top-0 z-20 flex items-center justify-between border-b border-white/60 px-4 py-2.5 lg:hidden">
        <Link to="/app" className="rounded-control"><Brand /></Link>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}
                aria-controls="mobile-menu" className="grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink hover:bg-white">
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>
      <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      {state.status === "demo" && <DemoBanner />}
      {/* Bottom padding leaves room for the floating tab bar so it never covers content. */}
      <main id="main" tabIndex={-1} className="mx-auto max-w-content px-4 pb-32 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}
