# Product

<!-- impeccable:product-schema 1 -->

> Written by `/impeccable init` on 2026-10-11 from repository evidence. The
> interview questions went unanswered, so every line marked **(inferred)** is
> an assumption drawn from the code and docs, awaiting the owner's
> confirmation. Unmarked lines are stated directly in the repository
> (`DECISIONS.md`, `IMPLEMENTATION_PLAN.md`, app copy).

## Platform

web

Responsive web app (React, Vite). Mobile layout has a floating bottom
navigation; desktop has a sidebar. No native wrapper.

## Users

- **Primary:** students in India who eat at their hostel or college mess
  (the app's own copy: "For students eating in hostel messes"). Amounts are in
  ₹.
- **Situation (inferred):** mostly on a phone, around mealtimes or shortly
  after, logging what they actually ate. Occasionally at a desk, reviewing
  trends or budgets.
- **Job:** know roughly what they're eating and spending without pretending to
  a precision the data can't support.
- **Other audiences (inferred):** none. Mess staff, parents and institutions
  are not users today. Accounts are private to the student.

## Product Purpose

DeluluFit brings three things together: the mess menu (what was planned), the
meals a student logs (what was actually eaten) and their food spending. It
shows nutrition as **estimates with their source**, and says plainly when
something isn't known.

Success means a student can log a meal in a few steps, trust that the numbers
are honest (partial and unknown values are marked, never filled in), and see
what's left of a food budget. The app is for everyday awareness and budgeting,
not medical or diet advice.

## Positioning

- **Honesty about uncertainty is the product.** Unknown nutrients are never
  shown as zero (D6). Partial totals are marked "≥" or "Partial". Every
  estimate shows its source (USDA FoodData Central reference foods) and keeps
  a versioned history (D8).
- **Planned isn't eaten.** A menu entry is never counted as consumption. Only
  logged meals count (D9: no silent food matching).
- **Food and money are separate records** (D13), so nothing is counted twice.
  Logging a meal never creates an expense.
- **Built around the hostel mess**, not generic calorie counting: mess menus,
  canteen and outside food, mess fees as a budget category.

## Operating Context

- Workflows: search a food, choose a portion (grams or a serving), review the
  estimate, save. Dishes not in the list can still be logged by name with
  unknown nutrition. Edit or delete meals later. Review daily, 7-day and 30-day
  nutrition. Record expenses and refunds against a daily, weekly or monthly
  budget. Manage profile, preferences, allergies and nutrition targets.
  Onboarding sets up the profile.
- **Demo mode:** a clearly labelled sample persona ("Asha") with fictional
  data. Nothing is saved and no account is created. Demo data must never mix
  with live data.
- Dates follow the profile's timezone. Meal times are entered in the device's
  timezone.

## Capabilities and Constraints

- **Working:** email and password accounts (server-side sessions, CSRF),
  onboarding, meal logging and history, nutrition day view and trends,
  targets with provenance, budgets (expenses, refunds, category breakdown),
  profile and settings, account deletion with client cache clearing.
- **Being built or not built:** mess menu upload from a photo (with review and
  confirm), the menu → meal flow, suggestions, data export, college and hostel
  creation.
- **Data limits:** the reference dataset has no sugars or sodium, so they show
  as "No data". No food has a default serving. Targets cover energy, protein,
  carbohydrate, fat and fibre.
- **Terminology:** "estimate", "Partial", "No data", "mess", "planned vs
  eaten", "Needs review" / "Confirmed" for menus.
- **Technical:** FastAPI and PostgreSQL backend. React 18, TypeScript and
  Tailwind CSS 3.4 frontend (Tailwind must stay on 3.4). No paid services
  without approval.

## Brand Commitments

- **Name:** DeluluFit, with a bowl-shaped logo mark.
- **Voice (inferred from current copy):** honest, calm and plain. States
  limits openly ("won't exactly match your mess's recipes"). No hype, no
  diet-culture pressure, no moralising about food. Whether the voice should
  lean into the playful "delulu" name is **undecided**.
- **Binding visual constraints set by the owner:**
  - only four colours: #06141B, #11212D, #CCD0CF and #FFFFFF;
  - headings in an editorial high-contrast serif and body text in a refined
    serif, matching the "Sage" and "Amor" references. Free substitutes are
    used because those fonts aren't licensed.

## Evidence on Hand

- **Real:** the USDA FoodData Central-derived reference dataset, and the
  working app with its demo persona (`frontend/src/mocks/demoData.ts`, clearly
  labelled as fictional).
- **Absent (inferred: none known):** real users, testimonials, partner
  colleges, usage statistics, press or food photography. Future surfaces must
  not invent any of these. Illustrations are original SVGs and never imply
  what anyone ate.

## Product Principles

1. **Never fake precision.** Unknown stays unknown, partial is labelled, and
   sources are shown. A gap is more honest than a guess.
2. **Planned is not eaten, and spent is not eaten.** Menus, meals and money
   stay distinct, and the interface never blurs them.
3. **Respect the student.** Private by default, no judgement about food
   choices, no medical claims.
4. **Fast in the moment.** Logging a meal at the mess should take seconds on
   a phone. Depth (trends, provenance) is available but never in the way.
5. **Real data or clearly labelled sample data.** Never a quiet mix of the
   two.

## Accessibility & Inclusion

- Target **WCAG 2.2 AA** (`IMPLEMENTATION_PLAN.md`, phase 12). Contrast is
  audited against composited glass surfaces. Status is never conveyed by colour
  alone (wording, icons, `role="alert"`). Charts have table equivalents.
  Reduced motion and reduced transparency are respected.
- Indian English and ₹ formatting (`en-IN`). Support for languages other than
  English is **undecided**.
