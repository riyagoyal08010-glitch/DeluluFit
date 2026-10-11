# DeluluFit frontend — decisions

## F1. Stack and versions
React 18.3 + TypeScript 5.7 + Vite 6.0, Tailwind CSS **3.4** (pinned; the
repository guidance says not to move to v4), React Router 6.28 (v7 future
flags enabled), TanStack Query 5, React Hook Form 7 + Zod 3, Recharts 2.15,
lucide-react, Vitest 2 + React Testing Library. All versions are pinned
exactly and recorded in `package-lock.json`. Newer releases existed, some
published a day earlier; established late-2024 releases were chosen to
limit supply-chain risk. Recharts 2.x is no longer actively developed
(npm notice) — upgrading to v3 is a known follow-up.

## F2. Structure: feature folders plus shared layers
`src/app` (providers, routes), `src/components/{ui,layout,nutrition,meals}`
(shared), `src/features/<feature>` (pages and feature logic), `src/lib`
(API client, formatting), `src/types` (API types), `src/mocks` (demo data
only), `src/test` (setup, helpers, fixtures). No component library: the
handful of primitives needed is small and fits the visual direction.

## F3. Design tokens live in one place (palette superseded by F29)
Colours are CSS variables in `src/styles/index.css` (space-separated RGB) and
exposed to Tailwind with semantic names (`canvas`, `surface`, `surface-raised`,
`ink`, `ink-muted`, `accent`, `success`, `warning`, `danger`, `info`, `line`).
Components never use raw hex values. Measured contrast of every text token on
every surface is ≥ 5.0:1 (lowest: muted text on raised surface, 5.02). The
muted surface `#4A5C6A` is used for borders only, not behind text. Glass
(blur) is used only for the sticky top bar, sidebar and bottom bar.

## F4. Real authentication, no simulated login
The backend's session auth already exists and is tested, so login,
registration, session restore and sign-out call it for real. The session is
an HttpOnly cookie; the CSRF token is held in memory only (never
`localStorage`) and sent on unsafe requests. In development the Vite dev
server proxies `/api` to the backend, so the app and API share an origin.

## F5. Demo mode is separate from authentication
"Explore with sample data" (landing page) enters a demo state that makes no
API calls, creates no account and saves nothing. A persistent banner and a
"Demo data" badge on every sample card identify it. Demo fixtures live in
`src/mocks/demoData.ts`, which production data-access code never imports.
Demo meal nutrients are computed from the real per-100 g values in the
backend dataset with the backend's formula and display rounding; prices,
menus and suggestions are invented examples.

## F6. No silent fallback to demo data
A live request that fails shows an error state with a retry button. It is
never replaced by sample data.

## F7. Live screens that aren't built say so
For real accounts, screens without an implemented UI show a "not available
yet" card describing what's coming, with no controls. No dead buttons.

## F8. Live data: dashboard and meals (updated)
The dashboard uses three existing, tested endpoints (`/profile`,
`/meals/day`, `/budget/summary`) so a new account sees genuine empty states.
The Meals page (logging and history) is also live. Other features are not
wired to the API yet.

## F9. Unknown is never shown as zero
Totals use the API's statuses: unknown values render as "—", partial totals as
"≥ value" with a "Partial" badge (and "At least" for screen readers).

## F10. Charts only where they help
One chart (7-day nutrient trend, Nutrition page), always paired with an
equivalent data table for screen readers. The page is lazy-loaded so the
charting library (~385 kB) isn't in the main bundle.

## F11. Navigation
Desktop (≥ 1024 px): floating sidebar card with all destinations (see F29). Smaller screens:
bottom tab bar with the five primary destinations plus a menu drawer with
all of them. One `NAV_ITEMS` list feeds all three.

## F12. Fonts (superseded by F29)
System font stack (Inter / Plus Jakarta Sans are used only if installed). No
web-font download, so no third-party requests and no layout shift.

## F13. Estimates come from the backend, including previews
The portion editor shows an estimate before saving. Rather than repeating the
nutrition arithmetic in TypeScript, a read-only backend endpoint
`GET /foods/{id}/estimate` (added for this) runs the same engine used when
saving; a backend test asserts the saved estimate equals the preview. The
frontend never calculates or sums nutrients: draft meals show per-item
previews, and the meal total appears after the server saves it.

## F14. Duplicate-submission protection
The Save button is disabled while saving, and each meal request carries an
idempotency key. The key is reused only when the identical payload is
retried (for example after a timeout), so the backend returns the original
meal instead of creating a second one; any edit to the draft gets a new key.

## F15. Mutations refresh by invalidation
Every meal change invalidates all `["live","meals",...]` queries (meal days,
lists and the dashboard), so no screen shows stale totals. Demo queries use a
separate `"demo"` key prefix and are never touched.

## F16. No silent food matching in the UI
A food is linked only when the student picks a search result. Low-confidence
and similar-spelling results carry a "Check this is right" badge. A dish that
is not listed is saved by name with unknown nutrition (shown as "no data",
never zero). Nothing is logged from a menu automatically.

## F17. Meal times use the device timezone
Date and time inputs are interpreted in the device's timezone and sent with
its UTC offset (the backend requires an offset and rejects future times).
The server groups meals by the profile timezone; the mismatch case is a
known limitation.

## F18. Nutrition analytics show only what the backend computes
The Nutrition page uses `/meals/day` (one day, with meals and sources) and
`/nutrition/summary` (7 or 30 days; the backend allows up to 92). The frontend
does not compute averages or sums: with partial days an average would
mislead, and nutrition arithmetic belongs to the backend. Charts plot the
server's display values; a day with nothing known is a gap, never a zero bar.

## F19. "Today" comes from the server
When no date is chosen, the page asks the backend for "today", which it
resolves in the profile timezone. Navigating moves from the date the server
returned, so device and profile timezones can't silently shift the window.
Period navigation moves the end date by the full period length, so windows
never overlap.

## F20. Targets are shown per day, as the student's own numbers
`GET /targets` returns daily targets (the backend's 1200 kcal floor for
self-set energy makes them daily amounts). The page shows the target in effect on the
selected day next to that day's recorded estimate, with its source and
dates. Targets are never multiplied across periods, never invented, and no
"met / not met" judgement is made. Setting targets in the UI is not built
yet; the empty state says so.

## F21. Money stays a decimal string
Amounts are validated as strings (at most 10 integer digits and 2 decimal
places, matching NUMERIC(12, 2)) and sent exactly as typed. The frontend
never adds, subtracts or converts money: every total, remainder and
utilisation comes from `GET /budget/summary`. "Over budget" wording strips the
sign from the server's string instead of computing it. `Number()` is used
only to format for display and to size bars.

## F22. Budget data shares one cache prefix
All budget queries (summary, overview, transactions, trend) and the
dashboard's budget card live under `["live","budget"]`, so a single
invalidation after any budget or transaction change refreshes everything.
Deleting a meal also invalidates budget data, because the server unlinks
(and keeps) expenses that pointed at that meal.

## F23. Tests use production cache settings
The test QueryClient uses the same 30 s staleTime as production (only retries
are disabled), so tests that check refresh-after-mutation fail if an
invalidation is missing. Testing Library's async timeout is 3 s because cold
tests can exceed the 1 s default when all test files run in parallel.

## F24. The profile form always sends every field
`PUT /profile` replaces the whole profile; omitted fields revert to their
defaults (verified live: currency back to INR, college cleared). The form
therefore sends all fields, including ones not shown as changed, and only
re-syncs from the server when there are no unsaved edits.

## F25. List editors keep a draft and a saved baseline
Preferences and allergies are edited as drafts and saved as a whole list.
The saved baseline is the server's save response (then any refetch), so a
failed save never changes what is shown as saved and a successful one never
flashes "unsaved".

## F26. Account-endpoint 401s don't trigger the global sign-out
Change password and delete account return 401 for a wrong password, so they
opt out of the client's automatic "session expired" handling and decide
locally: wrong password → field/dialog error; `not_authenticated` or
`session_expired` → clear the session and go to login.

## F27. Account deletion clears everything client-side first
After the server confirms deletion, the CSRF token and the entire query
cache are cleared and the session becomes signed out (carrying the
confirmation notice), before the login screen shows. A test proves the next
person to sign in on the same tab never sees the deleted account's cached
data within the 30 s cache window.

## F28. Targets: provenance as stored, never interpreted
Sources are labelled as stored ("Set by you", "From a professional, as you
entered it"); a professional target is never described as verified or
prescribed. Inputs allow one decimal place because targets are stored to
0.1. No defaults are suggested and no met/not-met judgement is made.

## F29. Light editorial redesign (replaces the dark palette)
Based on a soft, editorial reference (blue-and-white porcelain). Light theme
only.
- **Layers:** pale blue page (#E6EBF3) → warm-white sheet (#F8F7F4, the main
  content panel on large screens) → white cards. Selected states use a pale
  periwinkle tint (#DCE7F7).
- **Colour:** headings and actions in a deep muted blue (#3F65A0). The
  reference's lighter blue (#5B7FBF) measures only 3.3–4.0:1, so it is used
  for large display headings (≥ 30 px, ≥ 3:1) and decoration only. Semantic
  colours were darkened for light backgrounds. Every normal-text pair is
  ≥ 4.70:1 (audited with a script over the tokens).
- **Type:** Montserrat, self-hosted via `@fontsource/montserrat` 5.2.8 (latin
  and latin-ext, which covers ₹), weights 400/500/600. Headings are medium
  weight with wide letter-spacing; small tracked "eyebrow" labels. No
  third-party font requests.
- **Shape:** pill buttons (solid blue primary, white pill secondary), 24 px
  card radius, 32 px sheet radius, very soft blue-tinted shadows.
- **Imagery:** original SVG illustrations (bowl, thali, chai, coin jar) in
  `components/illustrations/Porcelain.tsx`, coloured with token classes;
  decorative only (aria-hidden). No photos or stock assets.
- **Shell:** floating white sidebar on desktop; light frosted top bar and
  bottom tab bar on mobile with a tinted active pill.
Token names stayed semantic (canvas, surface, ink, accent…), so components
did not need renaming; new tokens: sheet, heading, accent-soft, accent-tint,
on-accent.

## F30. Premium glass redesign (supersedes F29's palette and Montserrat)
Based on a glassmorphism fitness reference (frosted panels over a pale blue
field, large image cards, light/bold headlines, capsule day selector,
floating round bottom nav). Light theme only.
- **Tokens** (space-separated RGB in `src/styles/index.css`, mapped in
  `tailwind.config.ts`): page #DCE5EF with soft radial light; text #243746;
  muted text #4D6072; accent #3E6189 (links, small accents); action slate
  #2E4456 (primary buttons, active nav); success #2B6E4F, warning #855600,
  danger #A63A3A, info #2C628A; line #CCD7E3. The reference's lighter blues
  (accent-soft #789DC4 at 2.22:1, accent-light #B7D0E8 at 1.25:1) are
  **decorative only**: chart bars, illustration fills, rings. They never
  carry text. Every normal-text pair measures ≥ 4.79:1 (audit script).
- **Type:** Inter, self-hosted (`@fontsource/inter` 5.2.8, latin and
  latin-ext, weights 300–600). Light h1 with a semibold emphasis word
  ("Good morning, **Asha**"), tight tracking (−0.01em). Wide tracking was
  removed except for the small uppercase eyebrow (0.08em). Montserrat was
  uninstalled.
- **Glass variants:** `.glass-card` (white 62 %, blur 18 px; default Card),
  `.glass-subtle` (48 %), `.glass-elevated` (84 %, blur 24 px; dialogs,
  sidebar, tab bar, auth form), `.glass-dark` (slate 62 %, white text; chips
  and buttons over imagery), `.surface-solid` (92 %, no blur). Blur is
  used selectively: dense content (meal composer, meal history items,
  transaction list, profile form, targets, landing feature tiles) sits on
  the solid surface. `@supports not (backdrop-filter)` and
  `prefers-reduced-transparency` switch every glass to a near-opaque fill.
- **Imagery:** no licensed food photography is available, so
  `ImagePanel` renders a "cinematic" scene: a slate-to-mist gradient,
  a key light and one of the porcelain SVG illustrations. A slate overlay
  (62 % on mobile, a left-to-right fade from md) keeps white text ≥ 5:1. The
  art is aria-hidden and never implies what anyone ate or what a mess serves.
  Real photos can be dropped in later behind the same overlay.
- **Navigation:** the same five primary destinations (Home, Meals,
  Nutrition, Budget, Profile) everywhere. Desktop: floating glass sidebar.
  Mobile: frosted top bar with a menu drawer (all destinations) plus a
  floating round bottom bar of icon circles with screen-reader labels; the
  active item is a filled slate circle. Safe-area padding is respected.
- **Dashboard:** greeting header, a week `DayStrip` (past days and today
  link to that day's meal history; future days are not links), a hero image
  panel with today's real totals (partial values marked "≥"/"Partial",
  unknown shown as "—"), budget, meals and quick actions. **The mess-menu
  card appears only when menu data exists** (today: demo mode only). The
  live dashboard no longer shows an empty "No menu yet" card.
- **Charts:** complete days in accent-soft, partial days in accent-light;
  the table and tooltip still say "Partial", so colour is not the only cue.
  Tooltips stay solid white for legibility.
- **Segmented controls:** glass track, active segment filled slate with
  white text.
