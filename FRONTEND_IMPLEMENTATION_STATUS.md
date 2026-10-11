# DeluluFit frontend — implementation status

_Last updated: 2026-10-11. Nothing here is committed yet._

## Verified results

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` (frontend) | passes |
| Frontend tests | `npm test` (frontend) | **50 passed, 0 failed** (5 files; 16 new meal-logging tests) |
| Production build | `npm run build` (frontend) | passes; main JS 433 kB (132 kB gzip), Nutrition chunk 385 kB (107 kB gzip, lazy) |
| Backend tests | `python -m pytest` (backend) | **238 passed** (2 new for the estimate preview) |
| Live API check | frontend request shapes replayed through the Vite proxy against the real backend | register 201; search; food detail; preview; create 201 / identical replay 200 (same meal); saved estimate equals preview; day view; edit → estimate version 2; delete 204; missing CSRF 403 |
| Contrast | token pairs computed | all text/background pairs ≥ 5.0:1 |

A deliberate-breakage check confirmed the duplicate-submission test fails
when the idempotency-key reuse is removed.

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
- **Profile**: email, display name, sign out.

## Demo data only (clearly labelled; real accounts see "not available yet")
Nutrition (7-day chart), Mess menu, Budget, Suggestions, dashboard menu card.
In demo mode the Meals page also shows sample meals and makes no API calls.

## Not implemented
Onboarding wizard, nutrition history page in live mode (`/nutrition/summary`
exists), budget editing UI, menu upload/review, suggestions, profile editing,
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
