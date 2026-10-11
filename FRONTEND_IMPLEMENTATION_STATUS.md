# DeluluFit frontend — implementation status

_Last updated: 2026-10-11. Nothing here is committed yet._

## Verified results

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` (frontend) | passes |
| Frontend tests | `npm test` (frontend) | **107 passed, 0 failed** (8 files; 3 new tests for Card surfaces, ImagePanel and DayStrip; the live-dashboard test now asserts no menu card without menu data) |
| Production build | `npm run build` (frontend) | passes; main JS 500 kB (150 kB gzip; Vite prints its >500 kB advisory), Nutrition chunk 398 kB (111 kB gzip, lazy) |
| Backend tests | `python -m pytest` (backend) | **238 passed** (last run in the meal-logging phase; no backend code changed in the nutrition, budget or profile phases) |
| Live API check | frontend request shapes replayed through the Vite proxy against the real backend | register 201; search; food detail; preview; create 201 / identical replay 200 (same meal); saved estimate equals preview; day view; edit → estimate version 2; delete 204; missing CSRF 403 |
| Live nutrition check | requests replayed against the real backend | `/nutrition/summary?days=7` (and with `end`), `/meals/day` without a date (server picks today), `/targets` before/after setting one: shapes match `src/types/api.ts`; per-day `incomplete`/`complete` statuses and `unavailable` sodium come through |
| Live budget check | requests replayed against the real backend | set budget; expense + identical replay (same id); over-refund 422 with server message; refund; summary totals (expenses/refunds/net/remaining/utilisation/by category); list for the summary range; delete expense with refunds → `has_refunds`; edit; meal deleted → linked expense kept and unlinked, net unchanged; weekly budget not compared with a daily view; trend; end budget |
| Live profile/account check | real backend + disposable DB (port 54329) | full-body PUT keeps fields, partial body resets them (why the form always sends all fields); preference de-duplication; "other" allergy needs a label; self-set 1000 kcal → `unsafe_target`, professional accepted; wrong current password → 401 and session stays valid; delete with wrong confirmation (422) or password (401) deletes nothing; successful delete → 204, session gone, no rows left for the user in the tables checked, shared institution kept with attribution cleared |
| Contrast | token audit script (text composited over glass and page) | glass redesign: every normal-text pair ≥ 4.79:1; white on image overlay and dark glass 5.06:1; accent-soft (2.22) and accent-light (1.25) are decorative only and carry no text |
| Redesign build check | built CSS inspected | glass variants, backdrop-filter fallback (`@supports not`) and `prefers-reduced-transparency` rules generated; Inter bundled locally (no external font requests) |

Deliberate-breakage checks confirmed: the duplicate-submission test fails
when idempotency-key reuse is removed; the nutrition tests fail if unknown
days are charted as zero; the budget refresh tests fail if the dashboard or
post-meal-deletion invalidation is removed; the cross-account privacy test
fails if the query cache is not cleared on account deletion. Tests now use the production
cache settings (30 s staleTime), so a missing invalidation is detectable.

Not run: Playwright browser tests, manual screen-reader testing. The glass
redesign (decision F30) has **not been inspected visually in a browser**: no
browser tool was available, so layout, blur and illustration rendering are
verified only by tests, type-check, build output, CSS inspection and the
contrast script.

## Uses the real backend
- **Auth**: sign in, register, session restore, sign out, auto sign-out on
  expired session.
- **Dashboard**: profile name, today's nutrition totals and meal timeline,
  budget summary; refreshed after every meal change.
- **Meals → Log a meal**: food search (`GET /foods/search`, debounced 300 ms,
  stale requests cancelled), food details and servings (`GET /foods/{id}`),
  portion editor with a live estimate from `GET /foods/{id}/estimate`,
  manual "not in food list" items, meal type / date / time / where / note,
  review and remove foods, save via `POST /meals` with an idempotency key.
- **Meals → History**: day view (`GET /meals/day`), previous/next day and
  date picker, per-item nutrients, edit an item's portion
  (`PATCH /meals/{id}/items/{item}`), remove an item, add a food to an
  existing meal (`POST /meals/{id}/items`), edit meal details
  (`PATCH /meals/{id}`), delete a meal with confirmation (`DELETE /meals/{id}`).
- **Nutrition → Day**: `GET /meals/day` (server-chosen today, or a picked
  date; previous/next day): all seven nutrient totals with complete / partial /
  no-data status and item counts, reference data sources, items without data,
  energy per meal, and the target in effect that day (`GET /targets`) beside the
  recorded estimate.
- **Nutrition → 7 / 30 days**: `GET /nutrition/summary`: range totals, days
  with meals, a per-day bar chart (energy, protein, carbohydrate, fat, fibre;
  gaps for unknown days, lighter bars for partial days) plus an equivalent
  table; previous/next period. Refreshed after any meal change.
- **Budget**: overview from `GET /budget/summary` (server-chosen period and
  today by default; Daily / Weekly / Monthly; previous / next / current using
  the server's period boundaries): net spending, expenses, refunds, budget,
  remaining or amount over, share used, by category, other-currency notice,
  the server's explanation. Transactions for that period from
  `GET /budget/transactions` (20 at a time, up to 100): add expense (optional
  link to a meal on that date), record a refund (standalone or for an
  expense), edit amount / category / date / note, delete with confirmation
  (server's `has_refunds` message shown). Last 14 days from `GET /budget/trend`.
  Budget settings from `GET /budget`, `PUT /budget/active`,
  `DELETE /budget/active`: set or change (period, amount, optional start
  date), end with confirmation, past budgets. Every change refreshes the
  Budget page and the dashboard card; deleting a meal also refreshes budget
  views.
- **Profile & settings** (`/app/profile`): section links; personal profile
  from `GET /profile`, saved with `PUT /profile` (always sends every field,
  since the endpoint replaces the whole profile): name, eating pattern,
  optional height / weight / activity, currency, time zone, college and
  hostel (search existing colleges with `GET /institutions`, hostels with
  `GET /institutions/{id}/hostels`); unsaved-edit protection and discard.
  Food preferences (`PUT /profile/preferences`) and allergies
  (`PUT /profile/allergies`) as drafts saved as a whole list, with a saved
  baseline that never changes on failure. Nutrition targets: current target
  with provenance, past targets, set / change (source, five nutrients,
  optional start date, note) via `PUT /targets/active`, end via
  `DELETE /targets/active`. Account: email, change password
  (`POST /auth/change-password`), sign out, account deletion
  (`POST /auth/delete-account`) with password + typed DELETE confirmation;
  on success the session and all cached queries are cleared before showing
  the signed-out login screen.

## Demo data only (clearly labelled; real accounts see "not available yet")
Mess menu, Suggestions, dashboard menu card. In demo mode the Meals,
Nutrition and Budget pages show their sample versions and make no API calls.

## Not implemented
Onboarding wizard, custom date ranges on the Nutrition page (the API accepts
`start`/`end` up to 92 days), target setting/editing UI (the API supports it),
creating new colleges or hostels from the profile page (the API supports it;
not built), data export (no backend support), averages (deliberately not
computed), filtering transactions by kind or
category (the API filters by date only), changing a transaction's type or
links after creation (the API doesn't allow it), currency choice or conversion
(budgets use the profile currency), menu upload/review, suggestions, profile editing,
account deletion UI, password reset (no backend support), recent/favourite
foods quick-log (no backend support), Playwright tests.

## Known limitations
- Times are entered in the **device's** timezone and sent with its offset;
  the server files meals under the date in the **profile** timezone. If the
  two differ, a late-night meal can appear under a neighbouring date.
- No food has a default serving in the dataset, so the student must pick a
  serving size (or use grams) to get an estimate.
- Millilitres are offered only for foods the backend can convert
  (`supported_units`).
- Meals are always recorded with source "manual"; food eaten outside the mess
  is described with the optional "Where" field.
- Nutrition dates are profile-timezone dates chosen by the server; meal
  times are still entered in the device timezone (see above).
- Sugars and sodium are always "No data": the current reference dataset does
  not include them.
- Targets cover energy, protein, carbohydrate, fat and fibre only, and are
  compared on single days only.
- `PUT /targets/active` echoes values with more than one decimal place
  (e.g. 60.55) although they are stored rounded (60.6). The UI only accepts
  one decimal place and re-reads targets after saving, so it never shows the
  echoed value.
- Height, weight and activity are stored but not used by any calculation.
- Account deletion: uploaded images are removed best-effort after the
  database commit; server logs keep an internal account id; hosting backups
  are outside the app's control. The confirmation dialog says so.
- Budget summary applies whichever budget is in force on the viewed date to
  the whole period (a weekly budget started on Sunday is compared with
  spending from the preceding Monday). This is the backend's rule.
- Transaction dates are plain dates; the form defaults to the device's date.
- There is no per-expense "refunded so far" field; the server enforces the
  refund limit and its message is shown.
- Mess fees have no special handling beyond the Mess category; logging a
  meal never creates an expense, so nothing is counted twice automatically.
- Glass redesign: cinematic panels use SVG illustrations, not photographs
  (no licensed photos available). Blur cost on low-end phones is untested;
  the fallbacks cover browsers without `backdrop-filter` and users who ask
  for reduced transparency.
- The mess-menu summary on the dashboard is shown only in demo mode until a
  menu API exists.
- Recharts 2.x is no longer actively developed (move to v3 later).
- Test-only shim in `src/test/setup.ts` for a jsdom/Node `Request` AbortSignal
  incompatibility.
- Vite binds to `localhost` (IPv6 `::1` on this machine): open
  `http://localhost:5173`.

## Run locally
```powershell
# Terminal 1 — backend (from backend\)
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — frontend (from frontend\)
npm install        # first time only
npm run dev        # http://localhost:5173
```
The backend needs its disposable PostgreSQL instance (port 54329) running and
migrated (`alembic upgrade head`) with foods loaded (`python scripts/load_food_seed.py`).
