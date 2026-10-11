import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/components/layout/navigation";
import { dashboardApis, emptyDay } from "@/test/fixtures";
import { mockApi, renderApp, unauthenticated, USER } from "@/test/utils";

function enterDemoMode() {
  window.sessionStorage.setItem("delulufit:demo", "1");
}

describe("routing and protection", () => {
  it("redirects signed-out visitors from the app to login", async () => {
    mockApi({ "GET /api/v1/auth/session": unauthenticated });
    const { router } = renderApp("/app/budget");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("shows a not-found page for unknown addresses", async () => {
    mockApi({ "GET /api/v1/auth/session": unauthenticated });
    renderApp("/nowhere");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("lists every destination in the sidebar and marks the current page", async () => {
    enterDemoMode();
    renderApp("/app/budget");
    const sidebar = await screen.findByRole("complementary", { name: "Sidebar" });
    const links = within(sidebar).getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/app/") ||
                                                                       a.getAttribute("href") === "/app");
    for (const item of NAV_ITEMS) expect(within(sidebar).getByRole("link", { name: item.label })).toBeInTheDocument();
    expect(links.length).toBeGreaterThanOrEqual(NAV_ITEMS.length);
    expect(within(sidebar).getByRole("link", { name: "Budget" })).toHaveAttribute("aria-current", "page");
    expect(within(sidebar).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("puts the five primary destinations in the mobile tab bar", async () => {
    enterDemoMode();
    renderApp("/app");
    const bar = await screen.findByRole("navigation", { name: "Quick navigation" });
    expect(within(bar).getAllByRole("link").map((a) => a.textContent))
      .toEqual(NAV_ITEMS.filter((i) => i.primary).map((i) => i.label));
    // Hidden on large screens by class; the sidebar is the large-screen navigation.
    expect(bar.className).toContain("lg:hidden");
  });

  it("opens the mobile menu, navigates, and closes it", async () => {
    enterDemoMode();
    const user = userEvent.setup();
    const { router } = renderApp("/app");
    const open = await screen.findByRole("button", { name: "Open menu" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    await user.click(open);
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    expect(within(drawer).getByRole("button", { name: "Close menu" })).toHaveFocus();
    await user.click(within(drawer).getByRole("link", { name: "Suggestions" }));
    expect(router.state.location.pathname).toBe("/app/suggestions");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("shows honest empty states for a new account", async () => {
    mockApi({ "GET /api/v1/auth/session": () => ({ status: 200, body: USER }), ...dashboardApis });
    renderApp("/app");
    expect(await screen.findByText("No meals logged today")).toBeInTheDocument();
    expect(await screen.findByText("No spending recorded yet")).toBeInTheDocument();
    // Live accounts have no menu data yet, so no menu card is shown (only the "View menu" action).
    expect(screen.queryByRole("region", { name: /Today's mess menu/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument();
    // Quick actions are real links.
    expect(screen.getByRole("link", { name: "Log a meal" })).toHaveAttribute("href", "/app/meals");
    expect(screen.getByRole("link", { name: "View menu" })).toHaveAttribute("href", "/app/menu");
  });

  it("shows an error with retry instead of falling back to sample data", async () => {
    let calls = 0;
    mockApi({
      "GET /api/v1/auth/session": () => ({ status: 200, body: USER }),
      "GET /api/v1/profile": () => ({ status: 200, body: { profile: { display_name: "Ravi", timezone: "Asia/Kolkata" } } }),
      "GET /api/v1/budget/summary": dashboardApis["GET /api/v1/budget/summary"],
      "GET /api/v1/meals/day": () => (++calls === 1
        ? { status: 500, body: { error: { code: "internal_error", message: "Something went wrong on our side." } } }
        : emptyDay),
    });
    const user = userEvent.setup();
    renderApp("/app");
    expect(await screen.findByRole("heading", { name: /Ravi/ })).toBeInTheDocument();
    const alerts = await screen.findAllByText("Something went wrong on our side.");
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(await screen.findByText("No meals logged today")).toBeInTheDocument();
  });

  it("labels partial totals and items without data", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => ({ status: 200, body: USER }),
      ...dashboardApis,
    });
    // Demo mode exercises the same components with a lunch that has an item missing from the food list.
    enterDemoMode();
    renderApp("/app");
    expect(await screen.findByText(/Demo mode\./)).toBeInTheDocument();
    expect(screen.getAllByText("Demo data").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Partial").length).toBeGreaterThan(0);
    expect(screen.getByText("Aloo sabzi · no data")).toBeInTheDocument();
    expect(screen.getAllByText(/≥/).length).toBeGreaterThan(0);
  });
});

describe("pages", () => {
  it("landing page explains demo mode before entering it", async () => {
    mockApi({ "GET /api/v1/auth/session": unauthenticated });
    const user = userEvent.setup();
    const { router } = renderApp("/");
    expect(await screen.findByRole("link", { name: "Create a free account" })).toHaveAttribute("href", "/register");
    await user.click(screen.getByRole("button", { name: "Explore with sample data" }));
    const dialog = screen.getByRole("dialog", { name: "Explore with sample data" });
    expect(dialog).toHaveTextContent("Nothing you do is saved");
    await user.click(within(dialog).getByRole("button", { name: "Start demo" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(await screen.findByText(/Demo mode\./)).toBeInTheDocument();
  });

  it("unbuilt screens say so to real accounts and offer no dead controls", async () => {
    mockApi({ "GET /api/v1/auth/session": () => ({ status: 200, body: USER }) });
    renderApp("/app/menu");
    expect(await screen.findByRole("heading", { name: "Menu upload isn't available yet" })).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(within(main).queryAllByRole("button")).toHaveLength(0);
  });

  it("demo pages render their labelled sample content", async () => {
    enterDemoMode();
    const user = userEvent.setup();
    renderApp("/app/suggestions");
    expect(await screen.findByText("Dinner isn't logged yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss suggestion: Dinner isn't logged yet" }));
    expect(screen.queryByText("Dinner isn't logged yet")).not.toBeInTheDocument();
  });

  it("exit demo returns to a signed-out state", async () => {
    enterDemoMode();
    mockApi({ "GET /api/v1/auth/session": unauthenticated });
    const user = userEvent.setup();
    const { router } = renderApp("/app/profile");
    await user.click((await screen.findAllByRole("button", { name: "Exit demo" }))[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(window.sessionStorage.getItem("delulufit:demo")).toBeNull();
  });
});
