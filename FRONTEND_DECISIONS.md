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
- **Type:** (superseded by F31: Manrope) Inter, self-hosted (`@fontsource/inter` 5.2.8, latin and
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

## F31. Manrope for all text (headings only since F32)
All text (headings, body, forms, tables, numbers and the wordmark) uses
**Manrope**, self-hosted via `@fontsource/manrope` 5.2.8, weights 300–600.
Inter and a brief Playfair Display heading trial were removed. Headings keep
F30's rhythm: light h1 with a semibold emphasis word, tracking −0.01em.
Fonts are imported per weight (`@fontsource/manrope/400.css`), not per subset:
the per-subset files declare no `unicode-range`, so importing latin and
latin-ext together let the latin-ext face shadow basic Latin (that also
affected the earlier Inter imports). The per-weight files carry the ranges,
so browsers download only the subsets a page uses; latin-ext's range covers
₹ (U+20B9). Whether Manrope draws ₹ itself, or the browser falls back to a
system font for that one glyph, has not been checked visually.

## F32. Deep-ocean glass theme (colours superseded by F34)
The whole interface moved from pale blue-grey glass to a dark, deep-ocean
system. Structure, components and layouts from F30 are unchanged; only the
tokens, glass materials and a handful of hardcoded colours changed.
- **Colour tokens** (`src/styles/index.css`). The brief's values were the
  starting point; four were adjusted after the contrast audit:

  | Token | Value | Use |
  |---|---|---|
  | background | #071B2C | page |
  | background-2 | #0B263B | top of page gradient |
  | sheet | #092134 | inset wells, input fill, progress track |
  | surface | #103A56 | solid surface, chart tooltips |
  | surface-raised | #164E70 | hover, skeletons, secondary buttons |
  | text-primary / heading | #F5FAFC | main text |
  | text-muted | #B4CAD8 | supporting text |
  | text-subtle | #9AB6C8 | eyebrows, placeholders (brief: #8CAABD, 4.0:1 on elevated glass) |
  | accent | #84C0D8 | links, icons, selected labels (brief's #4B91B5 is 3.5:1, too low for text) |
  | accent-strong / accent-light | #A4D3E9 | link hover, focus ring, ice highlights |
  | accent-soft | #4B91B5 | ocean: charts, input borders, art |
  | accent-tint | #14425E | selected backgrounds |
  | teal | #3FA0A5 | partial-data chart bars, art |
  | action | #A4D3E9 | primary buttons, active nav (dark #071B2C text, 10.9:1) |
  | success / warning / danger / info | #6ED3A0 / #F0C36E / #F8A298 / #8CC6DE | status (danger lightened from #F48C82) |
  | line | #2B5670 | dividers (≈ rgba(164,211,233,.18)) |

- **Background:** midnight gradient (#0B263B → #071B2C) with restrained radial
  light: ocean blue from the top-left, faint teal at the right edge. No flat
  black, no neon.
- **Glass levels** (each differs in opacity, blur and border):
  `.glass-card` rgba(17,54,78,.65), blur 18; `.glass-subtle` .42, blur 10;
  `.glass-elevated` rgba(22,66,94,.80), blur 24 (dialogs, sidebar, tab bar,
  auth form; the brief's rgba(25,76,105,.72) left accent and danger text below
  4.5:1); `.glass-dark` rgba(7,27,44,.6) over imagery; `.glass` (header)
  rgba(11,38,59,.8); `.surface-solid` #103A56 at .97, no blur, for dense
  content. Borders rgba(164,211,233,.12–.24). Without backdrop-filter, or with
  prefers-reduced-transparency, every glass becomes opaque navy.
- **Typography:** (superseded by F33) Manrope for headings (h1–h3, wordmark), Inter for body,
  buttons, labels, forms and data. Both self-hosted per weight (300–600).
- **Controls:** primary buttons are ice blue with dark text; secondary
  buttons are raised navy with a line border; inputs sit in a dark well with an
  ocean border (3.5:1 against the card, meets the 3:1 non-text rule).
  `color-scheme: dark` gives native selects, date pickers and scrollbars a
  dark appearance.
- **Focus:** a two-layer ring (dark gap, then ice #A4D3E9), 7:1 against the
  page, so it shows on every surface.
- **Navigation:** dark translucent sidebar (desktop) and floating bottom bar
  (mobile); inactive icons #B4CAD8 (5.7:1), active item a filled ice circle
  with dark icon; labels unchanged (screen-reader text and title).
- **Charts:** complete days ice-ocean #84C0D8; partial days teal at 60 %. The
  table, tooltip and "Partial" label carry the meaning, not colour.
  Tooltip text is forced to near-white (Recharts otherwise colours item text
  with the bar colour).
- **Image panels:** ocean gradient (#071B2C → #164E70 → #4B91B5) with ice and
  teal light; a midnight overlay keeps near-white text at ≥ 7:1.
- **Audit:** `contrast-ocean` script composites each glass level over the
  lightest point of the page. Worst normal-text pair 5.08:1 (subtle on
  elevated glass); all non-text checks ≥ 3:1. The ocean blue (#4B91B5, 3.5:1)
  never carries text.

## F33. Editorial serif typography (supersedes F31 and F32's Manrope/Inter)
Requested: "Sage" for display and "Amor" for body, from two specimen images.
- **Font files found:** none. No Sage or Amor files exist in the repository or
  among the installed Windows fonts. Sage is a commercial typeface credited to
  New Tropical Design Studio; "Amor" in the second image cannot be tied to one
  specific family. Neither was downloaded, and nothing in the app is labelled
  Sage or Amor.
- **Implemented instead (both SIL Open Font License 1.1, self-hosted via
  Fontsource):**
  - **Playfair Display** 5.2.8 (weights 400/500/600) for display: a
    high-contrast transitional/Didone serif with hairline serifs, the closest
    open match to Sage's editorial contrast.
  - **Newsreader** 5.2.10 (weights 300/400/500/600) for body: a refined text
    serif with a delicate light weight like the Amor specimen, but built for
    small sizes. Chosen over Cormorant Garamond, whose tiny x-height (0.39 em)
    and old-style default figures hurt numbers and dense UI.
- **Where each is used:** Playfair Display (`font-display`): brand wordmark,
  landing hero, auth-panel line, page titles (h1), card and section headings
  (h2), dialog titles, empty-state headlines. Newsreader (`font-sans`, the
  default): body copy, navigation, buttons, labels, inputs, food names,
  nutrition and budget values, tables, transaction lists, metadata, errors, and
  h3 (meal names and list group titles inside dense content).
- **Tokens** (`:root` in `src/styles/index.css`, mapped in
  `tailwind.config.ts`): `--font-display`, `--font-body`,
  `--leading-display` 1.12, `--leading-body` 1.6, `--tracking-display`
  −0.012em, `--text-body` 17px. h1 regular, h2 medium, responsive sizes as
  before (page titles 30px → 40px from sm; landing hero 48px → 72px).
- **Size:** Newsreader's x-height (0.43 em) is smaller than the previous sans,
  so Tailwind's body steps moved up one notch: xs 13px, sm 15px, base 17px
  (heading sizes unchanged).
- **Numbers:** both faces were inspected with opentype.js. Newsreader defaults
  to lining, tabular figures; Playfair defaults to old-style, so headings set
  `lining-nums`. The body and `.metric` set `lining-nums tabular-nums`,
  so kcal, grams, decimals and ₹ amounts align. Both latin-ext subsets contain
  ₹ (U+20B9).
- **Loading:** per-weight CSS with `unicode-range`, so only the subsets a page
  uses download; `font-display: swap`. Each family has a metric-matched local
  fallback ("Newsreader Fallback", "Playfair Display Fallback", both
  `local("Georgia")`) with size-adjust and ascent/descent overrides computed
  from the font files, to minimise layout shift when the web font swaps in.
  Fallback stack after that: Georgia, Times New Roman, serif.
- **Unchanged:** the deep-ocean palette, glass levels and every component's
  behaviour (F32).

## F34. Onboarding follows the backend's own progress and completion flags
Verified in `backend/app` before building: registration creates a profile at
`onboarding_step` 1 only when a name is given; `PUT /profile` accepts
`onboarding_step` and only ever raises it (frozen once complete);
`POST /profile/complete-onboarding` is idempotent and needs a profile (422
`profile_incomplete`); the session's `onboarding_completed` is true only after
it. No endpoint is gated on completion (`OnboardedAuth` is unused).
- **Saving is per step, through the existing endpoints.** The wizard reuses
  `PersonalProfileForm` (wizard mode: "Save and continue" also sends
  `onboarding_step`), `PreferencesEditor`, `AllergiesEditor`,
  `TargetsManager` and `BudgetSettings`, which gained only optional callbacks
  that report unsaved state. No draft endpoint was invented; no backend or
  database change was needed.
- **Progress is server state.** Continue records the next step with
  `PUT /profile`, re-sending the profile just fetched from the server (the
  endpoint replaces every field) and skipping the write if the server is
  already further on. A refresh opens `?step=` if it isn't beyond the saved
  step, otherwise the saved step.
- **Unsaved is never presented as saved.** Visited steps stay mounted (hidden),
  so Back and Continue keep typed input. Continue is refused while a list or
  the target/budget form has unsaved changes. The review shows only server
  data and lists anything still unsaved.
- **Routing uses the server's flag, not a guess.** Registration goes to setup.
  In the app shell, a session with `onboarding_completed: false` is redirected
  to `/app/onboarding`, which sits outside the shell (so it can't redirect to
  itself) and sends completed accounts to `/app`. "Finish later" suppresses
  the redirect for that account in this tab until the next sign-in or
  sign-out, and the dashboard shows a reminder. Accounts created before the
  wizard report not completed, so they are offered setup at each sign-in until
  they finish it.
- **Finishing** awaits `complete-onboarding`, invalidates every `["live"]`
  query, marks the session completed from the server's response, then shows
  the dashboard.
- **Wording:** optional steps are labelled and skippable ("Skip for now"); no
  target or budget is pre-filled; targets are the student's own numbers and a
  professional's target "isn't verified"; allergies are "recorded for your
  reference" and never used to call a food safe.
- **Demo mode** shows a labelled notice on the setup address, never redirects
  and makes no API calls.

## F34. Four-colour palette (supersedes F32's colours)
The site uses exactly four colours. Layering comes from transparency of these
four only; no other hue appears anywhere (checked in the built CSS).

| Palette token | Value | Used for |
|---|---|---|
| `--palette-abyss` | #06141B | page, input wells, text on primary buttons, shadows, overlays |
| `--palette-navy` | #11212D | cards, panels, header, sidebar, tab bar, dialogs, tooltips |
| `--palette-mist` | #CCD0CF | supporting text, borders, input outlines, partial-day chart bars, illustration strokes |
| `--palette-white` | #FFFFFF | primary text, headings, links, primary buttons, active navigation, complete-day chart bars |

- **Semantic tokens** (`--color-*` in `src/styles/index.css`) now point at a
  palette variable, so component classes are unchanged. Translucent tokens are
  built in `tailwind.config.ts` with a `tint()` helper: `surface-raised` =
  white 8 %, `accent-tint` = white 12 %, `line` = mist 22 %.
- **Glass levels:** navy at 45 % (subtle), 72 % (card), 85 % (header), 90 %
  (elevated), opaque (solid, dense content); borders mist 12–24 %; shadows and
  overlays in abyss. Fallbacks (no backdrop-filter / reduced transparency) are
  opaque navy.
- **Status without colour:** success, warning, danger and info no longer have
  hues (white or mist). They are distinguished by wording ("Partial",
  "Needs review", "over budget"), icons (alert icon on field errors) and
  `role="alert"`, which was already the case. Danger buttons keep their
  outline and wording ("Delete permanently"). This is a deliberate trade-off of
  the four-colour rule: errors are less eye-catching than in a red/amber scheme.
- **Links:** white like body text, so inline links in sentences are always
  underlined (sign-in/up switches, landing footer); navigation links are
  buttons or nav items.
- **Charts:** complete days white, partial days mist at 45 % (3.2:1 against
  the card, 4.9:1 between the two); "Partial" is still written in the table and
  tooltip.
- **Tailwind defaults removed:** the default border grey (#E5E7EB), ring blue,
  ring-offset white and preflight placeholder grey (#9CA3AF) were replaced with
  palette values, so they cannot leak into any element.
- **Favicon and theme-color** use the palette (#11212D tile, white bowl, mist
  details; theme-color #06141B).
- **Contrast** (four-colour audit, composited layers): worst text pair 6.99:1
  (mist on white-12 % tint); white on cards ≥ 15:1; mist on cards ≥ 9:1;
  primary button text 18.7:1; text on image overlay 8.8:1; input borders
  10:1; focus ring 14:1. No failures.

## F36. Landing page after the Parkly reference (monochrome kept)
The landing page was rebuilt to match the structure and motion of
https://parkly-hack.vercel.app/: a sticky blurred top bar; a full-viewport hero
with a faint 80px grid that follows the pointer, rising specks, a pulsing-dot
pill, a two-line extra-bold headline whose second word is grey and drifts, two
pill buttons and a trust strip; hovering mock cards (desktop only) beside the
hero; numbered "How it works" cards with a big ghost step number, a black icon
tile and an underline that grows on hover; a four-figure stat row; an inverse
(black) band with a drifting headline word and three frosted rows; a short
call to action; an inverse FAQ accordion with a rotating "+"; and a hairline
footer. Sections below the hero reveal once they scroll into view
(IntersectionObserver; immediately where it is missing, e.g. jsdom).
- **Honest numbers only:** the reference's social-proof figures ("50+ cities",
  "10,000+ bookings", star ratings) were not copied. The stat row states
  product promises (one source per estimate, zero unknowns shown as zero,
  three records kept apart, 30-day history) and the hero cards are labelled as
  sample values.
- **Palette:** still F35's four greys plus black and white, built from
  black/white transparency. One deliberate exception copied from the
  reference: emerald for the pulsing "live" dot and the "Left today" budget
  card in the hero (Tailwind `emerald-50/100/400/600/700`). Nothing else is
  chromatic.
- **Type:** Inter 700 and 800 were added (self-hosted, per-weight files) for
  the landing display type (`font-extrabold`, tracking −0.025em, line-height
  0.88). F35's "never heavier than 400 above 45px" rule therefore applies to
  the app, not the landing page.
- **Buttons:** two new variants, `outline` (hairline black pill that inverts
  on hover) and `outlineInverse` (the same on black).
- **Motion** lives in `src/styles/index.css` (`reveal-up`, `reveal-scale`,
  `stagger-*`, `float-word`, `float-dot`, `pulse-ring`, `scroll-hint`, and the
  `hover`/`float-up` keyframes used inline). All of it collapses under
  `prefers-reduced-motion`; reveals use fill-mode `both`, so nothing stays
  hidden.
- **Unchanged:** the demo dialog, the "Create a free account" link and the
  "Explore with sample data" button (the app test depends on both), and the
  signed-in variant (every call to action becomes "Open dashboard").


## F37. Suggestions are the backend's ranked menu, never a feed of invented cards
The Suggestions page shows `GET /menus/{id}/suggestions` for the student's own
confirmed menus on a chosen date, exactly as the backend ranks them. It does
not add reminders, "cheaper option" comparisons or data-gap cards, because no
endpoint produces them; the earlier demo cards of that kind were replaced by a
fixture in the real response shape.
- **Groups are the server's.** Sections are rendered in a fixed order
  (Suggested for you, Also on the menu, Check first) from each dish's `group`;
  the integer `score` and `rule_version` are received but never shown, and
  cards are keyed by `menu_item_id`.
- **Explanations are quoted, not rewritten.** `reasons` and `cautions` are
  shown as the server words them; every caution carries an icon and the word
  "Caution", `allergen_listed` adds a "Check first" badge, and the page-level
  `allergy_notice` appears once in an "Allergy" panel. The UI never says a
  dish is safe.
- **Unknown stays unknown.** Reference nutrition is labelled "per N g of the
  reference food, not a portion" with reported / "No data" / "Not in source"
  per nutrient; a missing price reads "No price printed on the menu", never
  "Free".
- **Menus for a date are picked client-side** (`GET /menus?limit=50`,
  `menu_date` and `has_confirmed`, newest `updated_at` first), each confirmed
  one as its own section, until the API has a date filter. Branching uses
  `confirmed`, not `status`, so a confirmed menu with a newer draft still
  shows suggestions.
- **"Log this" is a link, not a log.** It opens `/app/meals` with
  `menu_meal`, `menu_item`, `meal_type`, `food` and `name`; the composer reads
  them once, removes them from the address (no stale re-prefill on refresh),
  opens the portion step or the manual form, and sends `menu_meal_id` and
  `menu_item_id` only on an explicit Save, and only while a linked dish is
  still in the draft. The backend's `menu_unavailable` and
  `menu_item_mismatch` refusals get a plain-language hint.
- **Cache:** every menu query lives under `["live", "menus"]`; saving
  preferences, allergies or the profile calls `invalidateMenus`, since the
  ranking depends on them. Demo mode never queries: the demo branch renders
  the fixture directly, the live components are not mounted, and their
  queries are additionally guarded with `enabled: !isDemo`. "Log this" is
  disabled in demo ("Not available in demo").

## F35. Monochrome editorial world (supersedes F33 and F34's four colours)
Chosen by the owner on 2026-10-11 from a reference ("monopo saigon" style), replacing
PRODUCT.md's earlier four-colour serif constraints. White paper, black type, greys for
annotation (#6D6D6D, 5.3:1), hairline rules (black at 14 %), no shadows and no blur. Cards,
inputs, panels and images have 0px corners; buttons and tags are full pills (filled black for
the one primary action, 1px black outline otherwise, white fill on black bands). Inter
(self-hosted, weights 300/400/600) stands in for the reference's Roobert; large type whispers
at 300 and nothing above 45px is heavier than 400. Status is told by wording, icons and
`role="alert"`; only errors and destructive actions have a hue (oxblood #A52D25, 6.9:1).
Motion uses one curve, cubic-bezier(0.19, 1, 0.22, 1), and stops for reduced motion. The one
chromatic element is a decorative band (`.iridescent`) that never sits behind text; its
colours are set by F38. Not yet checked visually in a browser.

## F38. The owner's logo, and its colours as the one accent
The logo (DELULU behind a glass "Mess & Macros" plate, supplied 2026-10-11) is shipped
unchanged as WebP (`src/assets/brand/delulu-logo.webp`, 1093 px, and a 640 px copy; the
original JPEG is kept in `src/assets/brand/source/`, not bundled; provenance sidecars record
the origin). It appears large on the landing hero, the sign-in/register panel and the setup
rail, each time on its own dark ground (#28282A) so its edges don't show. Where it's too small
to read (header, sidebar, favicon) a compact SVG mark derived from it is used: four tilted
stems in the logo's gradient under a frosted bracketed plate. The product name in text stays
"DeluluFit". The accent band now uses the logo's own gradient, sampled from its letters: sky
#95B5E5 → indigo #3B4872 → lavender #A09FC7 (replacing F35's sage/amber/oxblood ribbon).

## F39. Rounded, lifted boxes (amends F35's sharp, flat surfaces)
Asked for by the owner on 2026-10-11: every box in the interface has curved corners and
sits a little above the page. Radius tokens are now 20px for cards, panels, dialogs and
image bands (`rounded-card`), 12px for inputs, tiles and notices (`rounded-control`) and
28px for sheets; buttons and tags stay full pills. Elevation is two layered black shadows
at low opacity (`shadow-card` at rest; `shadow-float` for dialogs, popovers, the mobile tab
bar and the inverse image bands), applied inside the surface classes so every Card, and the
few bordered boxes that don't use Card, lift the same way. Card borders drop from 14 % to
10 % black since the shadow now carries the separation. F35's monochrome palette, type and
pill buttons are unchanged; only its "0px corners, no shadows" rule is replaced.
