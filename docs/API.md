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

## Budget
`GET /budget`, `PUT|DELETE /budget/active`, `GET /budget/summary?date=&period=`,
`GET /budget/trend?days=`, `GET|POST /budget/transactions`,
`PATCH|DELETE /budget/transactions/{id}`.
