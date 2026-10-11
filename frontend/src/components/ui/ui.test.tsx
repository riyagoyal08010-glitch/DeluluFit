import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Badge, EmptyState, ErrorState, Progress, Tooltip } from "./Feedback";
import { Checkbox, Input, Select } from "./Field";
import { Soup } from "lucide-react";
import { MemoryRouter } from "react-router-dom";

import { Card } from "./Card";
import { DayStrip } from "./DayStrip";
import { ImagePanel } from "./ImagePanel";

describe("Button", () => {
  it("is disabled and announces busy while loading", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it never submits forms by accident", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("form fields", () => {
  it("links labels, hints and errors to the input", () => {
    const { rerender } = render(<Input label="Email" hint="We never share it." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAccessibleDescription("We never share it.");
    expect(input).not.toHaveAttribute("aria-invalid");
    rerender(<Input label="Email" hint="We never share it." error="Enter a valid email address." />);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email address.");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
  });

  it("marks optional fields in text, not only by styling", () => {
    render(<Input label="Name" optional />);
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("renders select options and checkbox labels accessibly", async () => {
    render(<>
      <Select label="Nutrient" options={[{ value: "a", label: "Energy" }, { value: "b", label: "Protein" }]} />
      <Checkbox label="I agree" error="Please confirm." />
    </>);
    await userEvent.selectOptions(screen.getByLabelText("Nutrient"), "b");
    expect(screen.getByLabelText("Nutrient")).toHaveValue("b");
    const box = screen.getByLabelText("I agree");
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(box).toHaveAttribute("aria-invalid", "true");
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Confirm" description="Are you sure?"
              footer={<><button type="button">First</button><button type="button">Last</button></>} />
    </>
  );
}

describe("Dialog", () => {
  it("moves focus in, traps Tab, closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Confirm" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Are you sure?");
    expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe("feedback components", () => {
  it("shows tooltips on keyboard focus and hides them on Escape", async () => {
    const user = userEvent.setup();
    render(<Tooltip label="About energy" content="Lower bound.">i</Tooltip>);
    await user.tab();
    const trigger = screen.getByRole("button", { name: "About energy" });
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Lower bound.");
    expect(trigger).toHaveAccessibleDescription("Lower bound.");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("clamps progress and exposes its value", () => {
    render(<><Progress value={1.7} label="Budget used" /><Progress value={0.25} label="Quarter" /></>);
    expect(screen.getByRole("progressbar", { name: "Budget used" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar", { name: "Quarter" })).toHaveAttribute("aria-valuenow", "25");
  });

  it("renders empty and error states with recovery", async () => {
    const retry = vi.fn();
    render(<>
      <EmptyState icon={Soup} title="No menu yet">Upload one later.</EmptyState>
      <ErrorState message="Network down" onRetry={retry} />
      <Badge tone="warning">Partial</Badge>
    </>);
    expect(screen.getByRole("heading", { name: "No menu yet" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Network down");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByText("Partial")).toBeInTheDocument();
  });
});

describe("glass design components", () => {
  it("applies the requested surface material", () => {
    render(<><Card aria-label="a">x</Card><Card aria-label="b" surface="solid">y</Card><Card aria-label="c" raised>z</Card></>);
    expect(screen.getByRole("region", { name: "a" }).className).toContain("glass-card");
    expect(screen.getByRole("region", { name: "b" }).className).toContain("surface-solid");
    expect(screen.getByRole("region", { name: "c" }).className).toContain("glass-elevated");
  });

  it("keeps image-panel artwork decorative and its content accessible", () => {
    render(<ImagePanel scene="bowl" aria-label="Hero"><h2>Readable title</h2></ImagePanel>);
    const panel = screen.getByRole("region", { name: "Hero" });
    expect(screen.getByRole("heading", { name: "Readable title" })).toBeInTheDocument();
    // Every SVG in the panel is hidden from assistive technology.
    for (const svg of panel.querySelectorAll("svg")) expect(svg.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("links past days and today to meal history, and never links future days", () => {
    render(<MemoryRouter><DayStrip today="2026-10-08" hrefFor={(d) => `/history/${d}`} /></MemoryRouter>);
    // 8 Oct 2026 is a Thursday: the week runs Mon 5 – Sun 11.
    const strip = screen.getByRole("navigation", { name: "This week" });
    const links = Array.from(strip.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      ["/history/2026-10-05", "/history/2026-10-06", "/history/2026-10-07", "/history/2026-10-08"]);
    const today = screen.getByRole("link", { name: /Thursday, 8 October, today: meals/ });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(screen.getByLabelText("Friday, 9 October (upcoming)").tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: /Sunday, 11 October/ })).not.toBeInTheDocument();
  });
});
