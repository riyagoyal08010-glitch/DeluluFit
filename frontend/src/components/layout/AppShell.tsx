import { FlaskConical, LogOut, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/Feedback";
import { useSession } from "@/features/auth/session";
import { cn } from "@/lib/cn";

import { Brand } from "./Brand";
import { NAV_ITEMS } from "./navigation";

function navClass(isActive: boolean): string {
  return cn("flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors",
            isActive ? "bg-surface-raised text-ink" : "text-ink-muted hover:bg-surface-raised/50 hover:text-ink");
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <li key={to}>
          <NavLink to={to} end={to === "/app"} onClick={onNavigate} className={({ isActive }) => navClass(isActive)}>
            {({ isActive }) => (
              <>
                <Icon className={cn("h-5 w-5", isActive && "text-accent")} aria-hidden="true" />
                {label}
              </>
            )}
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
    <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line/30 px-4 py-6 lg:flex"
           aria-label="Sidebar">
      <Link to="/app" className="mb-8 rounded-control px-2"><Brand /></Link>
      <nav aria-label="Main" className="flex-1"><NavList /></nav>
      <SessionFooter />
    </aside>
  );
}

/** Bottom tab bar for phones and tablets: the five most used destinations. */
export function MobileTabBar() {
  return (
    <nav aria-label="Quick navigation"
         className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line/30 pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV_ITEMS.filter((i) => i.primary).map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} end={to === "/app"}
                     className={({ isActive }) => cn("flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                                                     isActive ? "text-accent" : "text-ink-muted hover:text-ink")}>
              <Icon className="h-5 w-5" aria-hidden="true" />
              {label}
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
      <div className="absolute inset-0 bg-canvas/80" aria-hidden="true" onClick={onClose} />
      <div id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu"
           className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line/30 bg-surface px-4 py-5">
        <div className="mb-6 flex items-center justify-between">
          <Brand />
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close menu"
                  className="rounded-control p-2 text-ink-muted hover:bg-surface-raised hover:text-ink">
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
    <div role="status" className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
      <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span><strong className="font-semibold">Demo mode.</strong> Everything here is sample data. Nothing is saved and this is not an account.</span>
        </span>
        <button type="button" onClick={exitDemo} className="rounded-control px-2 py-1 font-medium underline-offset-2 hover:underline">
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
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-ink-inverse">
        Skip to content
      </a>
      <DesktopSidebar />
      <header className="glass sticky top-0 z-20 flex items-center justify-between border-b border-line/30 px-4 py-3 lg:hidden">
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}
                aria-controls="mobile-menu" className="rounded-control p-2 text-ink-muted hover:bg-surface-raised hover:text-ink">
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link to="/app" className="rounded-control"><Brand /></Link>
        <span className="w-9" aria-hidden="true" />
      </header>
      <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      {state.status === "demo" && <DemoBanner />}
      <main id="main" tabIndex={-1} className="mx-auto max-w-content px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}
