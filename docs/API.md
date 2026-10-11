# DeluluFit API (implemented endpoints)

Base path `/api/v1` (health under `/api`). JSON everywhere. Errors:
`{"error": {"code", "message", "details", "request_id"}}`. Decimals are
strings. Authentication: session cookie; every POST/PUT/PATCH/DELETE needs
`X-CSRF-Token` (from the login/register response). Interactive docs at
`/api/docs` outside production.

## Health
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness, no dependencies |
| GET | `/api/ready` | DB reachable + migrated, storage writable |

## Auth
`POST /auth/register`, `POST /auth/login`, `GET /auth/session`,
`POST /auth/logout`, `POST /auth/change-password`, `POST /auth/delete-account`
(`{"password", "confirmation": "DELETE"}`).

## Profile, institutions, targets
`GET|PUT /profile`, `POST /profile/complete-onboarding`,
`PUT /profile/preferences`, `PUT /profile/allergies`,
`GET|POST /institutions`, `GET|POST /institutions/{id}/hostels`,
`GET|POST /messes`, `GET /targets`, `PUT|DELETE /targets/active`.

## Foods
| Method | Path | Notes |
|---|---|---|
| GET | `/foods/search?q=&limit=` | Ranked results; `score` is a ranking key, not a probability |
| GET | `/foods/match?name=` | Interpret free text: `matched` / `needs_confirmation` / `unknown` + candidates |
| GET | `/foods/{id}` | Nutrients per reference mass with status, servings, supported units, provenance |
| GET | `/foods/{id}/estimate?quantity=&unit=&serving_id=` | Read-only preview of the estimate a portion would get if saved (same rules as saving; nothing is stored) |

## Meals
| Method | Path | Notes |
|---|---|---|
| POST | `/meals` | `{meal_type, consumed_at (with offset), note?, location_note?, idempotency_key?, items[]}`; 201 created, 200 replay, 409 key reuse with different body |
| GET | `/meals?start=&end=&limit=&offset=` | Most recent first; without dates = recent meals |
| GET | `/meals/day?date=` | Meals + totals for a local date (default today) |
| GET | `/meals/{id}` | Meal with items, current estimates, totals |
| GET | `/meals/{id}/nutrition` | Totals only |
| PATCH | `/meals/{id}` | meal_type, consumed_at, note, location_note |
| DELETE | `/meals/{id}` | 204; linked expenses are kept and unlinked |
| POST | `/meals/{id}/items` | Add an item |
| PATCH | `/meals/{id}/items/{item_id}` | Portion/food changes create a new estimate version |
| DELETE | `/meals/{id}/items/{item_id}` | Returns the updated meal |
| GET | `/nutrition/summary?start=&end=` or `?days=7[&end=]` | Per-day totals + range total; ≤ 92 days |

Item input: `food_id` (a food the student selected) **or** `display_name`
alone (manual item, nutrition unknown); `quantity` (> 0, ≤ 10000, ≤ 2 dp);
`unit` `g` | `ml` | `serving`; `serving_id` only with `serving`; `note`.

Nutrient value: `{value, display, unit, status}`; status
`estimated | unknown | not_in_source | no_estimate`. Totals:
`{total, display, unit, status, known_items, missing_items}`; status
`complete | incomplete | unavailable | empty`. `total` is null when nothing is
known — never a fake zero.

## Menus
Every menu belongs to the signed-in student; another student's menu is
always `404 not_found` (never 403, so ids cannot be probed).

| Method | Path | Notes |
|---|---|---|
| POST | `/menus` | `multipart/form-data`: `menu_date` (required, ISO date, within the past year / next 60 days), `meal_type?` (`breakfast` \| `lunch` \| `snacks` \| `dinner` \| `other`), `mess_id?` (one of your own messes), `image?` (JPEG/PNG/WebP, ≤ `MAX_UPLOAD_BYTES`, default 8 MB). 201 → menu detail. Owner comes from the session only |
| GET | `/menus?limit=&offset=` | Your menus, newest menu date first; `{items, total, limit, offset}` (limit ≤ 50) |
| GET | `/menus/{id}` | Menu detail: summary + `image {width, height, size_bytes}` + extraction state + draft/confirmed versions |
| GET | `/menus/{id}/image` | The stored photo (always JPEG), owner only; `Cache-Control: private, no-store`, sandboxing CSP |
| DELETE | `/menus/{id}` | 204. Deletes versions, dishes, upload record, extraction jobs, then the file. Meals logged from it are kept as manual meals |

Summary fields: `id, title, menu_date, meal_type_hint, mess_id, status
(processing | failed | needs_review | confirmed), has_draft, has_confirmed,
item_count, has_image, created_at, updated_at`. Storage keys and file paths
are never returned.

Upload errors: 413 `upload_too_large`; 422 `upload_empty`,
`unsupported_image_type` (decoded format is not JPEG/PNG/WebP — the file name
and declared Content-Type are ignored), `invalid_image` (not decodable /
truncated), `image_too_large` (pixel count), `menu_date_out_of_range`,
`mess_unavailable`, `validation_failed` (bad date / meal type / id format);
409 `duplicate_upload` (same photo bytes again; `details.menu_id` points at the
existing menu, so a retried upload is safe); 429 `rate_limited`; 401 / 403
`csrf_failed`.

Review and extraction (beyond the upload milestone): `POST /menus/{id}/extraction`,
`PUT /menus/{id}/draft`, `POST /menus/{id}/confirm`, `POST /menus/{id}/revise`,
`GET /menus/{id}/suggestions`.

## Budget
`GET /budget`, `PUT|DELETE /budget/active`, `GET /budget/summary?date=&period=`,
`GET /budget/trend?days=`, `GET|POST /budget/transactions`,
`PATCH|DELETE /budget/transactions/{id}`.
