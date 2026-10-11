import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { dashboardApis } from "@/test/fixtures";
import { mockApi, renderApp, unauthenticated, USER } from "@/test/utils";

describe("registration form", () => {
  it("validates on the client before sending anything", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": unauthenticated });
    const user = userEvent.setup();
    renderApp("/register");
    await user.click(await screen.findByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByText("Please confirm you understand this.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "aaaaaaaaaaaa");
    await user.type(screen.getByLabelText("Confirm password"), "something else");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Choose a less predictable password.")).toBeInTheDocument();
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    // Only the startup session check reached the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the server's duplicate-email error on the email field", async () => {
    mockApi({
      "GET /api/v1/auth/session": unauthenticated,
      "POST /api/v1/auth/register": () => ({ status: 409, body: { error: { code: "email_taken",
        message: "An account with this email already exists. Try signing in." } } }),
    });
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "taken@example.test");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse battery");
    await user.click(screen.getByLabelText(/not medical advice/));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("An account with this email already exists.")).toBeInTheDocument();
  });

  it("toggles password visibility", async () => {
    mockApi({ "GET /api/v1/auth/session": unauthenticated });
    const user = userEvent.setup();
    renderApp("/register");
    const password = await screen.findByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("login", () => {
  it("shows a generic error for wrong credentials and stays on the page", async () => {
    mockApi({
      "GET /api/v1/auth/session": unauthenticated,
      "POST /api/v1/auth/login": () => ({ status: 401, body: { error: { code: "invalid_credentials",
        message: "Email or password is incorrect." } } }),
    });
    const user = userEvent.setup();
    const { router } = renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), "a@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Email or password is incorrect.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("signs in, sends the CSRF token afterwards, and reaches the dashboard", async () => {
    const fetchMock = mockApi({
      "GET /api/v1/auth/session": unauthenticated,
      "POST /api/v1/auth/login": () => ({ status: 200, body: USER }),
      "POST /api/v1/auth/logout": () => ({ status: 204 }),
      ...dashboardApis,
    });
    const user = userEvent.setup();
    const { router } = renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), USER.user.email);
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(await screen.findByText("No meals logged today")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Sign out" })[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    const logout = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/logout") && i?.method === "POST");
    expect((logout?.[1]?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-test-token");
  });

  it("explains when the server cannot be reached", async () => {
    mockApi({ "GET /api/v1/auth/session": () => Promise.reject(new TypeError("Failed to fetch")) });
    renderApp("/login");
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
  });
});

