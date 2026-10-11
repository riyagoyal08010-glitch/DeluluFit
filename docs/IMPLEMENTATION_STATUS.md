# DeluluFit — implementation status

_Last updated: 2026-10-11._

Checkpoint commit: `a316fb2 feat: establish DeluluFit database and backend foundation`.
Everything listed under "This phase" is **uncommitted and awaiting review**.

The application is not complete or production-ready. There is no frontend,
no meal logging API, no menu upload or extraction, and no recommendations.

> **Update (2026-10-11, menu upload milestone):** the paragraph above
> describes the state at the start of the nutrition phase. Meal logging, the
> frontend and the menu API (upload, review, extraction worker, suggestions)
> now exist as uncommitted work; see "Menu upload milestone" below.

## Completed

### In the checkpoint commit (`a316fb2`)

* **Schema**: 26 tables (SQLAlchemy models + Alembic revision `0001`) with
  CHECK constraints, composite ownership foreign keys, partial unique indexes
  and triggers that make confirmed menu versions, `food_nutrients` rows and
  `nutrition_estimates` rows immutable.
* **Auth**: registration, login, logout, change password, account deletion;
  Argon2id password hashing; opaque session tokens stored as SHA-256 digests;
  per-session CSRF token (`user_sessions.csrf_token`) checked on unsafe methods;
  in-process rate limiting.
* **Profile & onboarding**, institutions/hostels, messes, food preferences,
  allergies, nutrition targets (with a 1200 kcal floor for self-set energy).
* **Budget**: deterministic engine (daily / Monday–Sunday weekly / monthly
  periods, expenses minus refunds), budgets with history, transactions with
  idempotency keys and refund rules.
* **Reference data**: 60 curated foods from USDA FNDDS with a build script
  (see `backend/data/README.md`).
* `.gitignore`.

### This phase (uncommitted)

* **Fixed — app did not start**: `app/main.py` imported six route modules and
  a worker that do not exist. It now registers only the implemented routers
  (health, auth, profile, budget), and the extraction worker is started only
  when extraction is enabled.
* **Fixed — change password ignored the password rules** applied at
  registration (`aaaaaaaaaaaa` was accepted).
* **Fixed — blank hostel name returned HTTP 500** (unhandled CHECK violation);
  a blank mess name returned a misleading 409. Both are now 422.
* **Fixed — money amounts echoed the client's precision** (`"35"` on PATCH
  but `"35.00"` on GET). Inputs are normalized to cents.
* **Hardened — concurrent refunds**: the original expense row is locked while
  the "refunds ≤ expense" rule is checked.
* **Nutrition engine** (`app/services/nutrition/`), deterministic and Decimal-based:
  `normalize` (food-name normalization shared with stored keys), `matching`
  (alias matching; ambiguous / low-confidence / partial / multi-item names
  return candidates and require confirmation), `confidence` (weakest-link
  combination), `units` (quantity validation; g / serving / ml conversion),
  `calculator` (proportional scaling, missing values stay missing, totals
  flag lower bounds), `provenance` (engine version `nutrition-1.0.0` and input
  snapshot), `estimates` (versioned, history-preserving persistence),
  `catalog` (DB reads), `seed` (validated, idempotent, versioning loader).
* `scripts/load_food_seed.py`, `backend/.env.example`, `backend/requirements.txt`,
  `backend/requirements-dev.txt`, `backend/data/README.md`, this document.
* Tests: API tests for auth, profile, targets, budget and health; budget
  engine unit tests; nutrition engine unit and DB tests; dataset audit; two
  new DB tests for `user_sessions.csrf_token` and `food_aliases.confidence`.

No schema change was needed, so there is no new migration.

### Menu upload milestone (uncommitted, 2026-10-11)

Inspection found the milestone already largely implemented by earlier
uncommitted work (models in `app/db/models/menus.py`, migration `0004`,
`app/services/storage`, `app/services/menu_images.py`,
`app/services/menu_service.py`, `app/api/routes/menus.py`,
`tests/test_api_menus.py`). This milestone verified it and closed the gaps:

* **Model** (unchanged schema, see DECISIONS D17): `mess_menus` (owner,
  optional `mess_id` → institution/hostel, timestamps), `menu_uploads`
  (private storage key, content type, size, sha256, dimensions),
  `menu_extraction_jobs` (status for later OCR/extraction),
  `menu_versions.meal_type_hint`, `menu_days.menu_date`.
* **Added — mess link**: `POST /menus` accepts an optional `mess_id`, checked
  against the student's own messes before any file is written (422
  `mess_unavailable`); summaries and details return `mess_id`.
* **Hardened — deletion** collects storage keys only from uploads owned by
  the deleting student, and a failed file delete is logged with its key.
* **Documented** the upload limits (`MAX_UPLOAD_BYTES`, `MAX_IMAGE_PIXELS`,
  `NORMALIZED_IMAGE_MAX_SIDE`, `UPLOAD_RATE_LIMIT_PER_HOUR`) and storage
  settings in `backend/.env.example`; menu endpoints in `docs/API.md`;
  decisions D17–D19 in `DECISIONS.md`.
* **Tests added**: `tests/test_api_menu_uploads.py` (unauthenticated
  upload/retrieve/delete, list isolation with two students' menus, retrieval
  without storage details, invalid date / meal period / mess id, own vs
  foreign mess, failed file cleanup on delete, deleting one menu leaves other
  files alone, storage-key traversal refused by `LocalStorage`);
  `tests/test_db_integrity.py` (mess ownership composite FK; the `0004`
  CHECK constraints on `menu_versions.meal_type_hint` and
  `menu_items.source`).
* **Migration**: none added. `0004` is the single head; the round-trip and
  drift tests pass, and the dev database `delulufit` (port 54329) was
  upgraded `0003 → 0004` (forward only, no reset).

Test run: from `backend/` against a separate disposable database
`delulufit_test_m1` on the 54329 instance (other sessions were running the
suite against `delulufit_test` at the same time, and the suite downgrades
and truncates its database): **289 passed, 0 failed**.

## Test results (2026-10-11)

Run from `backend/` against the disposable PostgreSQL 17 instance on port
54329 (`delulufit_test`): **185 passed, 0 failed, 0 skipped**
(22 at the checkpoint + 163 added).

| Area | Covered by |
|---|---|
| Migrations: downgrade → upgrade → downgrade → upgrade, model/migration drift | `test_migrations.py`, session fixture |
| FKs, composite ownership, CHECKs, immutability triggers, cascades | `test_db_integrity.py` |
| Registration, login, logout, hashing, expiry, CSRF, rate limit, deletion | `test_api_auth.py` |
| Cross-user isolation (transactions, refunds, meal-log links, messes, targets) | `test_api_budget.py`, `test_api_profile.py` |
| Profile, onboarding, preferences, allergies, target validation | `test_api_profile.py` |
| Budget arithmetic and periods | `test_budget_engine.py`, `test_api_budget.py` |
| App import, startup (lifespan), health, readiness | `test_api_health.py` |
| Matching, ambiguity, unknown foods, confirmation | `test_nutrition_matching.py` |
| Quantities, serving / ml conversion | `test_nutrition_units.py` |
| Proportional calculation, missing nutrients, confidence | `test_nutrition_calculator.py` |
| Estimate versioning and historical preservation | `test_nutrition_estimates.py` |
| Dataset audit and seed loader | `test_food_seed.py` |

Also run manually: `uvicorn app.main:app` started; `/api/health` and
`/api/ready` returned ok; the seed loader loaded 60 foods / 160 aliases /
175 servings (6 "Guideline amount" portions skipped) and a second run made no
changes.

Lint/type checks: there is **no configured linter** (no ruff/mypy config in
the repository). Ruff with its default rule set reports import-order and
style findings in the checkpoint code (no correctness errors apart from one
unused import in `app/db/models/menus.py`). Note that its default target
version suggests `datetime.UTC`, which does not exist on Python 3.10, so do
not auto-fix without setting `target-version = "py310"`. mypy reports 4
pre-existing errors in `profile_service.py` (untyped `dict(...)` of rows).

## Known issues and limitations

* **Local dev database is out of date.** `delulufit` (port 54329) was migrated
  with an earlier version of revision `0001`, before `csrf_token` and
  `food_aliases.confidence` were edited into it. It still has
  `user_sessions.csrf_token_hash`, so sign-in against it fails. It is on the
  disposable instance and holds no users; rebuild it with
  `alembic downgrade base` then `alembic upgrade head`. The revision was never
  applied to any shared or persistent database. From now on, schema changes
  must be new revisions, because `0001` is committed.
* `/api/ready` checks that `alembic_version` exists, not that the schema
  matches the code.
* Nutrient values were checked for internal consistency but **not re-verified
  against the USDA source** this session (FDC API rate-limited).
* Reference foods are generic US survey foods, not Indian mess recipes;
  estimates are approximations and must be presented as such.
* No food has a default serving, so `unit="serving"` without a chosen
  serving yields an "unavailable" estimate rather than a guessed portion.
* Millilitres convert only for foods with a `1 fl oz` portion.
* Rate limiting is per process.
* The CSRF cookie is readable by JavaScript by design; cross-site frontends
  must use the token from the response body.
* `docs/SECURITY.md` is referenced in code comments but does not exist.
* Menu uploads (2026-10-11):
  * A file whose delete fails after the menu rows are committed stays in
    storage as an orphan (logged as `upload_delete_failed` with its key);
    there is no sweeper job yet.
  * The duplicate check hashes the original bytes, so the same photo
    re-saved or resized by the phone is treated as a new upload.
  * The upload rate limit is in-process (resets on restart; not shared
    between workers).
  * `mess_id` can be set only when a menu is created; there is no endpoint to
    change it, and no mess deletion endpoint exists (the FK would refuse to
    delete a mess that menus reference).
  * Images are fully read into memory (bounded by `MAX_UPLOAD_BYTES`) and
    decoded synchronously in the request.
  * The S3 backend is implemented but not exercised by the test suite.
  * Running the suite while another process uses the same
    `TEST_DATABASE_URL` causes spurious failures (tables dropped/truncated
    mid-run); use a separate test database per concurrent runner.

## Remaining tasks

1. Meal logging API: create meal logs and consumed items using `matching` +
   `units`, ask for confirmation when required, store estimates via
   `estimates.record_estimate` in the same transaction, idempotency keys.
2. Food search / match endpoint and daily nutrition summary (using
   `calculator.total`, surfacing lower-bound totals and confidence).
3. Menu upload (image validation, private storage) and extraction worker.
   *(Upload, storage, list/retrieve/delete: done and verified 2026-10-11.)*
4. Menu review/confirmation flow and versioning API.
5. Recommendations.
6. Frontend (React + Vite, Tailwind CSS 3.4).
7. Verify the dataset against the FDC CSV; consider default servings per food
   with documented sources.
8. Add ruff/mypy configuration (target Python 3.10), CI, and `docs/SECURITY.md`.

## Next recommended phase

**Meal logging API on top of the nutrition engine** (task 1–2), with API
tests for confirmation flows and per-user isolation. Menu extraction and the
frontend should follow once meal logging is verified.
