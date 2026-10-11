# DeluluFit frontend — implementation status

_Last updated: 2026-10-11. Nothing here is committed yet._

## Verified results

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` (frontend) | passes |
| Frontend tests | `npm test` (frontend) | **82 passed, 0 failed** (7 files; 19 new budget tests); full suite run 3× consecutively, all green |
| Production build | `npm run build` (frontend) | passes; main JS 454 kB (138 kB gzip), Nutrition chunk 398 kB (111 kB gzip, lazy) |
| Backend tests | `python -m pytest` (backend) | **238 passed** (last run in the meal-logging phase; no backend code changed in the nutrition or budget phases) |
| Live API check | frontend request shapes replayed through the Vite proxy against the real backend | register 201; search; food detail; preview; create 201 / identical replay 200 (same meal); saved estimate equals preview; day view; edit → estimate version 2; delete 204; missing CSRF 403 |
| Live nutrition check | requests replayed against the real backend | `/nutrition/summary?days=7` (and with `end`), `/meals/day` without a date (server picks today), `/targets` before/after setting one: shapes match `src/types/api.ts`; per-day `incomplete`/`complete` statuses and `unavailable` sodium come through |
| Live budget check | requests replayed against the real backend | set budget; expense + identical replay (same id); over-refund 422 with server message; refund; summary totals (expenses/refunds/net/remaining/utilisation/by category); list for the summary range; delete expense with refunds → `has_refunds`; edit; meal deleted → linked expense kept and unlinked, net unchanged; weekly budget not compared with a daily view; trend; end budget |
| Contrast | token pairs computed | all text/background pairs ≥ 5.0:1 |

Deliberate-breakage checks confirmed: the duplicate-submission test fails
when idempotency-key reuse is removed; the nutrition tests fail if unknown
days are charted as zero; the budget refresh tests fail if the dashboard or
post-meal-deletion invalidation is removed. Tests now use the production
cache settings (30 s staleTime), so a missing invalidation is detectable.

Not run: Playwright browser tests, manual screen-reader testing. The UI was
not inspected visually in a browser in this session.

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
- **Profile**: email, display name, sign out.

## Demo data only (clearly labelled; real accounts see "not available yet")
Mess menu, Suggestions, dashboard menu card. In demo mode the Meals,
Nutrition and Budget pages show their sample versions and make no API calls.

## Not implemented
Onboarding wizard, custom date ranges on the Nutrition page (the API accepts
`start`/`end` up to 92 days), target setting/editing UI (the API supports it),
averages (deliberately not computed), filtering transactions by kind or
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
- Budget summary applies whichever budget is in force on the viewed date to
  the whole period (a weekly budget started on Sunday is compared with
  spending from the preceding Monday). This is the backend's rule.
- Transaction dates are plain dates; the form defaults to the device's date.
- There is no per-expense "refunded so far" field; the server enforces the
  refund limit and its message is shown.
- Mess fees have no special handling beyond the Mess category; logging a
  meal never creates an expense, so nothing is counted twice automatically.
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
