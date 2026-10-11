# DeluluFit — architecture and product decisions

Each entry: the decision, why, and what it rules out. Newest last.

## D1. Modular monolith: FastAPI + PostgreSQL, one deployable backend
Routers (`app/api/routes`) are thin; business logic lives in `app/services`;
persistence in `app/db/models`. No microservices or message brokers until a
concrete need appears. *(Checkpoint `a316fb2`.)*

## D2. Server-side sessions in HttpOnly cookies, CSRF token per session
The cookie holds a random token; only its SHA-256 is stored. Unsafe methods
require `X-CSRF-Token` equal to the session's token (returned in the login
response and set in a readable cookie). Chosen over JWT so sessions can be
revoked (logout, password change) and nothing long-lived sits in
`localStorage`. Argon2id for passwords.

## D3. Database constraints back up application validation
CHECK constraints for every enumerated column, composite foreign keys that
prove ownership (e.g. a consumed menu item belongs to the logged meal), and
triggers that make confirmed menus, reference nutrient rows and nutrition
estimates immutable.

## D4. Migration history is append-only once committed
`0001` was edited in place before the first commit while applied only to
disposable databases. From the checkpoint on, every schema change is a new
revision. Revisions `0002`/`0003` were corrected before they were committed,
while still uncommitted and applied only to the disposable databases.

## D5. Nutrition engine location: `app/services/nutrition/`
The spec suggests `app/nutrition/`. The engine already lived under services
with tests; moving it would only churn imports. One module per concern
(normalize, matching, units, calculator, confidence, provenance, estimates,
catalog, seed).

## D6. Nutrient values carry an explicit status; unknown is never zero
Reference rows record `source_nutrients` (what the source provides). Status
per nutrient: reported / unknown (source covers it, no value) / not_in_source.
Item estimates: estimated / unknown / not_in_source / no_estimate. Totals:
complete / incomplete (a lower bound) / unavailable (null, not 0) / empty.

## D7. Precision: exact arithmetic, store 4 dp, round only for display
`nutrition_estimates` values are NUMERIC(14, 4) (migration `0002`). Totals are
summed from stored values; display rounds half-up (kcal and mg whole, g to
0.1). Inputs (`food_nutrients`) stay NUMERIC(8, 2) like the source.

## D8. Historical snapshot strategy: versioned, immutable estimates
Each consumed item keeps every estimate version. An estimate references the
exact `food_nutrients` row used and stores an input snapshot (portion,
reference values, dataset version, statuses, engine version). Reference
updates insert a new `food_nutrients` row; old meals keep their numbers.
Editing a portion creates a new version; the old one remains.

## D9. No silent food matching
Free text is never auto-linked when logging. The client sends `food_id` for
a food the student chose (search / match endpoints help). Unlinked items are
saved as manual items with unknown nutrition. Matching statuses: matched only
for HIGH/MEDIUM exact names; ambiguous, LOW, partial, multi-item and
similar-spelling results always need confirmation.

## D10. Search score is a ranking key, not a probability
Fixed tiers: exact 1.0, prefix 0.6–0.8, shared words 0.4–0.6, similar spelling
0.2–0.4 (difflib ratio ≥ 0.82, chosen from measured pairs: "panner"≈"paneer"
kept, "karela"≈"kela" rejected).

## D11. Portion conversion
Grams as entered; servings from source portions (FNDDS household measures);
millilitres only via a food's "1 fl oz" portion. No ml = g assumption, no
density from "1 cup" (bulk volume for solids), no invented default servings.
"Guideline amount" FNDDS portions are not portions of the food and are skipped.

## D12. Time and dates
`consumed_at` must include a UTC offset; future times (beyond 10 minutes of
clock skew) are rejected. `log_date` is the local date in the profile timezone
when the meal is logged or its time is edited; it is not rewritten when the
profile timezone changes. Summaries use inclusive local-date ranges; `days=N`
means the N days ending today (or `end`). Ranges are capped at 92 days.

## D13. Consumption and money are separate records
Logging a meal never creates an expense. Deleting a meal unlinks (does not
delete) expenses that referenced it.

## D14. Target source `reference_estimate` is reserved for the app
Clients may set `self_set` or `professional` targets. `reference_estimate`
will be used only once the app computes a target from a cited general
reference; until then it is rejected (422 `unsupported_source`).

## D15. Meal categories
breakfast, lunch, snacks, dinner, other — defined once in `app/db/enums.py`
and mirrored by CHECK constraints (migration `0003`) and the API schema (an
assertion keeps them in sync).

## D16. Empty meals are allowed
A meal may be created with no items and filled later; its totals have status
`empty` and null values.

## D17. Menu photos: one existing schema, no parallel "MessMenu" table
The upload milestone reuses the menu tables already in the schema
(`mess_menus`, `menu_uploads`, `menu_extraction_jobs`, versions → days →
meals → items) instead of adding a second menu model. Menu date and meal
period live on the version (`menu_days.menu_date`,
`menu_versions.meal_type_hint`) so a revision can correct them without
rewriting history. Processing status is derived from the draft's extraction
job (`processing | failed | needs_review | confirmed`), never stored twice.
Institution and hostel are reached through the optional `mess_id`; a menu
does not carry its own institution/hostel columns. No new migration was
needed (`0004` is the latest revision).

## D18. Menu photo storage and validation
* Private storage behind `app/services/storage` (`LocalStorage` in
  `backend/var/uploads`, gitignored and outside the frontend; or a private,
  server-side-encrypted S3 bucket). Keys are server-generated
  (`menus/<user hex>/<random uuid hex>`), checked against
  `^[a-z0-9/_-]{8,200}$`, and local paths must resolve inside the root. The
  client's filename is discarded. No public URL exists; the owner reads the
  photo through `GET /menus/{id}/image` (`private, no-store`).
* The decoded content decides acceptance (JPEG/PNG/WebP via Pillow, with
  `verify()`, a pixel-count guard and a size limit `MAX_UPLOAD_BYTES`
  checked on the Content-Length and again on the bytes read). Accepted photos
  are rotated upright and re-encoded as JPEG, so EXIF/GPS, ICC and comments
  are never stored.
* Duplicate retries: a per-student unique `(user_id, sha256)` of the original
  bytes turns a repeated upload into 409 `duplicate_upload` with the existing
  `menu_id`.
* Consistency: the file is written first; if the database transaction fails
  it is deleted. On menu deletion the rows are committed first and the files
  (only of uploads owned by that student) are deleted afterwards; a failed
  file delete is logged and the API still returns 204, so no row ever points
  at a missing file, at the cost of a possible orphaned private file.

## D19. Ownership is derived from the session only
Menu endpoints take no owner id. Every query filters on the session's user,
and another student's menu is `404 not_found`. A `mess_id` is checked against
the student's own messes (422 `mess_unavailable`) before any file is
written, and the composite FK `(mess_id, user_id) → messes(id, user_id)`
backs this up in the database.
