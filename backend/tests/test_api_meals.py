"""Meal logging API: foods, meals, items, estimates, history, summaries and isolation."""

from __future__ import annotations

import copy
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import models as m
from app.services.nutrition.normalize import normalize_food_name
from app.services.nutrition.seed import load_seed, read_seed_file
from tests.api_helpers import CSRF_HEADER, ApiUser, error_code, register

DATA = read_seed_file()
NUTRIENTS = {f["canonical_name"]: f["nutrients"] for f in DATA["foods"]}
# A fixed past instant: 2026-09-20 19:00 UTC is 2026-09-21 00:30 in Asia/Kolkata.
LATE_EVENING_UTC = "2026-09-20T19:00:00+00:00"


@pytest.fixture
def foods(db: Session) -> dict[str, uuid.UUID]:
    load_seed(db, DATA)
    db.commit()
    return {name: fid for fid, name in db.execute(select(m.Food.id, m.Food.canonical_name))}


def _ago(**kw: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(**kw)).isoformat()


def _serving(user: ApiUser, food_id: uuid.UUID, label_start: str) -> str:
    servings = user.get(f"/api/v1/foods/{food_id}").json()["servings"]
    return next(s["id"] for s in servings if s["label"].startswith(label_start))


def _meal(user: ApiUser, items: list[dict[str, Any]], **kw: Any) -> Any:
    body = {"meal_type": "lunch", "consumed_at": _ago(hours=1), "items": items, **kw}
    return user.post("/api/v1/meals", json=body)


def _kcal(name: str, grams: str) -> Decimal:
    return Decimal(NUTRIENTS[name]["energy_kcal"]) * Decimal(grams) / 100


# --- authentication and CSRF -----------------------------------------------------------------

def test_meal_and_food_endpoints_require_authentication(client: TestClient) -> None:
    for method, url in (("get", "/api/v1/meals"), ("post", "/api/v1/meals"), ("get", "/api/v1/foods/search?q=dal"),
                        ("get", "/api/v1/meals/day"), ("get", "/api/v1/nutrition/summary?days=7"),
                        ("get", f"/api/v1/meals/{uuid.uuid4()}")):
        assert getattr(client, method)(url).status_code == 401, url


def test_creating_a_meal_requires_csrf(client: TestClient) -> None:
    register(client)
    res = client.post("/api/v1/meals", json={"meal_type": "lunch", "consumed_at": _ago(hours=1), "items": []})
    assert res.status_code == 403 and error_code(res) == "csrf_failed"


# --- foods -----------------------------------------------------------------------------------

def test_food_search_detail_and_match(client: TestClient, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    hits = user.get("/api/v1/foods/search", params={"q": "roti"}).json()["results"]
    assert hits[0]["canonical_name"] == "Roti / chapati" and hits[0]["match_kind"] == "exact"
    assert user.get("/api/v1/foods/search", params={"q": ""}).status_code == 422

    detail = user.get(f"/api/v1/foods/{foods['Roti / chapati']}").json()
    assert detail["reference_mass_g"] == "100.00"
    assert detail["nutrients"]["energy_kcal"]["status"] == "reported"
    assert detail["nutrients"]["energy_kcal"]["display"] == "299"
    assert detail["nutrients"]["sodium_mg"] == {"value": None, "display": None, "unit": "mg",
                                                "status": "not_in_source"}
    assert detail["provenance"]["source_food_id"] == "2707713"
    assert detail["supported_units"] == ["g", "serving"]
    assert "ml" in user.get(f"/api/v1/foods/{foods['Milk (whole)']}").json()["supported_units"]
    assert user.get(f"/api/v1/foods/{uuid.uuid4()}").status_code == 404

    tea = user.get("/api/v1/foods/match", params={"name": "tea"}).json()
    assert tea["status"] == "needs_confirmation" and tea["reason"] == "low_confidence"
    unknown = user.get("/api/v1/foods/match", params={"name": "Mess special"}).json()
    assert unknown["status"] == "unknown" and unknown["candidates"] == []


# --- creating meals and totals ------------------------------------------------------------------

def test_create_meal_with_dataset_and_manual_items(client: TestClient, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    roti = foods["Roti / chapati"]
    res = _meal(user, [
        {"food_id": str(roti), "quantity": "2", "unit": "serving", "serving_id": _serving(user, roti, "1 medium")},
        {"food_id": str(foods["Dal"]), "quantity": "150", "unit": "g", "note": "extra thick"},
        {"display_name": "Mess special curry", "quantity": "1", "unit": "serving"},
    ], note="Hostel lunch")
    assert res.status_code == 201, res.text
    meal = res.json()
    assert meal["meal_type"] == "lunch" and meal["note"] == "Hostel lunch" and meal["source"] == "manual"
    roti_item, dal_item, manual = meal["items"]
    assert roti_item["estimated_mass_g"] == "80.00" and roti_item["mass_source"] == "serving_reference"
    assert roti_item["estimate"]["confidence"] == "MEDIUM"  # serving sizes vary
    assert Decimal(roti_item["estimate"]["nutrients"]["energy_kcal"]["value"]) == _kcal("Roti / chapati", "80")
    assert roti_item["estimate"]["provenance"]["dataset_version"] == "2024-10-31"
    assert dal_item["estimate"]["confidence"] == "HIGH" and dal_item["note"] == "extra thick"
    assert manual["is_manual"] is True and manual["food"] is None and manual["match_confidence"] == "UNKNOWN"
    assert manual["estimate"]["method"] == "unavailable"
    assert manual["estimate"]["nutrients"]["energy_kcal"] == {"value": None, "display": None, "unit": "kcal",
                                                              "status": "no_estimate"}

    energy = meal["totals"]["nutrients"]["energy_kcal"]
    expected = _kcal("Roti / chapati", "80") + _kcal("Dal", "150")
    assert Decimal(energy["total"]) == expected
    assert energy["status"] == "incomplete" and energy["known_items"] == 2 and energy["missing_items"] == 1
    assert energy["display"] == str(expected.quantize(Decimal("1"), "ROUND_HALF_UP"))
    assert meal["totals"]["complete"] is False and "lower bounds" in meal["totals"]["note"]
    sodium = meal["totals"]["nutrients"]["sodium_mg"]
    assert sodium["total"] is None and sodium["status"] == "unavailable"


def test_empty_meal_has_empty_not_zero_totals(client: TestClient) -> None:
    user = register(client)
    meal = _meal(user, []).json()
    assert meal["items"] == [] and meal["totals"]["item_count"] == 0
    energy = meal["totals"]["nutrients"]["energy_kcal"]
    assert energy["status"] == "empty" and energy["total"] is None


def test_millilitres_convert_only_where_supported(client: TestClient, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    meal = _meal(user, [{"food_id": str(foods["Milk (whole)"]), "quantity": "200", "unit": "ml"},
                        {"food_id": str(foods["Dal"]), "quantity": "200", "unit": "ml"}]).json()
    milk, dal = meal["items"]
    assert milk["estimated_mass_g"] == "206.27" and milk["serving"] is None
    assert "fl oz" in milk["estimate"]["provenance"]["portion_basis"]
    # Dal has no volume reference: the item is kept, its nutrition is unknown, nothing is guessed.
    assert dal["estimated_mass_g"] is None and dal["mass_source"] == "unknown"
    assert dal["estimate"]["method"] == "unavailable" and dal["estimate"]["reason"] == "no_volume_reference"


@pytest.mark.parametrize("item", [
    {"quantity": "100", "unit": "g"},                                       # neither food nor name
    {"display_name": "Tea", "quantity": "0", "unit": "g"},
    {"display_name": "Tea", "quantity": "-1", "unit": "g"},
    {"display_name": "Tea", "quantity": "10001", "unit": "g"},
    {"display_name": "Tea", "quantity": "abc", "unit": "g"},
    {"display_name": "Tea", "quantity": "1", "unit": "cup"},
    {"display_name": "Tea", "quantity": "1", "unit": "g", "serving_id": str(uuid.uuid4())},
    {"display_name": "x" * 161, "quantity": "1", "unit": "g"},
    {"display_name": "Tea", "quantity": "1", "unit": "g", "note": "n" * 281},
])
def test_invalid_items_are_rejected(client: TestClient, item: dict[str, Any]) -> None:
    user = register(client)
    assert _meal(user, [item]).status_code == 422


def test_quantity_precision_is_validated(client: TestClient) -> None:
    user = register(client)
    res = _meal(user, [{"display_name": "Tea", "quantity": "1.005", "unit": "g"}])
    assert res.status_code == 422 and error_code(res) == "invalid_portion"


@pytest.mark.parametrize("change", [
    {"meal_type": "brunch"}, {"meal_type": None}, {"consumed_at": "2026-09-20T08:00:00"},  # naive time
    {"consumed_at": "not a time"}, {"note": "n" * 501},
])
def test_invalid_meal_fields_are_rejected(client: TestClient, change: dict[str, Any]) -> None:
    user = register(client)
    assert _meal(user, [], **change).status_code == 422


def test_future_meals_and_missing_fields_are_rejected(client: TestClient) -> None:
    user = register(client)
    future = _meal(user, [], consumed_at=(datetime.now(timezone.utc) + timedelta(hours=2)).isoformat())
    assert future.status_code == 422 and error_code(future) == "future_meal"
    assert user.post("/api/v1/meals", json={"items": []}).status_code == 422
    assert _meal(user, [{"display_name": "Tea", "quantity": "1", "unit": "g"}] * 31).status_code == 422
    other = _meal(user, [], meal_type="other")
    assert other.status_code == 201 and other.json()["meal_type"] == "other"


def test_serving_of_another_food_and_unknown_food_are_rejected(client: TestClient,
                                                               foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    naan_serving = _serving(user, foods["Naan"], "1")
    res = _meal(user, [{"food_id": str(foods["Paratha"]), "quantity": "1", "unit": "serving",
                        "serving_id": naan_serving}])
    assert res.status_code == 422 and error_code(res) == "invalid_portion"
    res = _meal(user, [{"food_id": str(uuid.uuid4()), "quantity": "1", "unit": "g"}])
    assert res.status_code == 422 and error_code(res) == "food_unavailable"


def test_failed_item_rolls_back_the_whole_meal(client: TestClient, db: Session,
                                               foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    res = _meal(user, [{"food_id": str(foods["Dal"]), "quantity": "100", "unit": "g"},
                       {"food_id": str(uuid.uuid4()), "quantity": "1", "unit": "g"}])
    assert res.status_code == 422
    for model in (m.MealLog, m.ConsumedItem, m.NutritionEstimate):
        assert db.scalar(select(func.count()).select_from(model)) == 0


# --- editing ---------------------------------------------------------------------------------

def test_add_update_and_remove_items(client: TestClient, db: Session, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    meal = _meal(user, [{"food_id": str(foods["Dal"]), "quantity": "100", "unit": "g"}]).json()
    url = f"/api/v1/meals/{meal['id']}"
    res = user.post(f"{url}/items", json={"food_id": str(foods["Steamed white rice"]), "quantity": "200",
                                          "unit": "g"})
    assert res.status_code == 201
    items = res.json()["items"]
    assert [i["position"] for i in items] == [0, 1]
    dal_id = items[0]["id"]

    res = user.patch(f"{url}/items/{dal_id}", json={"quantity": "250"})
    assert res.status_code == 200
    dal = res.json()["items"][0]
    assert dal["estimated_mass_g"] == "250.00" and dal["estimate"]["version"] == 2
    assert Decimal(dal["estimate"]["nutrients"]["energy_kcal"]["value"]) == _kcal("Dal", "250")
    # The earlier estimate is kept unchanged.
    versions = db.execute(select(m.NutritionEstimate.estimate_version, m.NutritionEstimate.energy_kcal,
                                 m.NutritionEstimate.is_current)
                          .where(m.NutritionEstimate.consumed_item_id == uuid.UUID(dal_id))
                          .order_by(m.NutritionEstimate.estimate_version)).all()
    assert [(v, k, c) for v, k, c in versions] == [(1, _kcal("Dal", "100"), False), (2, _kcal("Dal", "250"), True)]

    # A note-only edit does not create a new estimate version.
    res = user.patch(f"{url}/items/{dal_id}", json={"note": "less salt"})
    assert res.json()["items"][0]["estimate"]["version"] == 2 and res.json()["items"][0]["note"] == "less salt"

    # Switching to a different food marks the item as corrected and recalculates.
    res = user.patch(f"{url}/items/{dal_id}", json={"food_id": str(foods["Sambar"])})
    switched = res.json()["items"][0]
    assert switched["food"]["canonical_name"] == "Sambar" and switched["display_name"] == "Sambar"
    assert switched["estimate"]["version"] == 3
    assert db.scalar(select(m.ConsumedItem.is_user_corrected).where(m.ConsumedItem.id == uuid.UUID(dal_id)))

    assert user.patch(f"{url}/items/{dal_id}", json={"quantity": "0"}).status_code == 422
    res = user.delete(f"{url}/items/{dal_id}")
    assert res.status_code == 200 and [i["id"] for i in res.json()["items"]] == [items[1]["id"]]
    assert user.delete(f"{url}/items/{dal_id}").status_code == 404


def test_update_and_delete_meal_keeps_expenses(client: TestClient, db: Session) -> None:
    user = register(client)
    meal = _meal(user, [{"display_name": "Tea", "quantity": "150", "unit": "ml"}]).json()
    url = f"/api/v1/meals/{meal['id']}"
    res = user.patch(url, json={"meal_type": "snacks", "note": "  evening   tea "})
    assert res.status_code == 200 and res.json()["meal_type"] == "snacks" and res.json()["note"] == "evening tea"
    expense = user.post("/api/v1/budget/transactions", json={"kind": "expense", "amount": "15", "category": "beverages",
                                                            "occurred_on": meal["log_date"], "meal_log_id": meal["id"]})
    assert expense.status_code == 201
    assert user.delete(url).status_code == 204
    assert user.get(url).status_code == 404
    assert db.scalar(select(func.count()).select_from(m.ConsumedItem)) == 0
    assert db.scalar(select(func.count()).select_from(m.NutritionEstimate)) == 0
    # Spending stays recorded; only its link to the deleted meal is removed.
    txn = user.get("/api/v1/budget/transactions").json()["items"][0]
    assert txn["id"] == expense.json()["id"] and txn["meal_log_id"] is None


def test_historical_estimates_survive_reference_data_updates(client: TestClient, db: Session,
                                                             foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    before = _meal(user, [{"food_id": str(foods["Dal"]), "quantity": "100", "unit": "g"}]).json()
    old_kcal = before["items"][0]["estimate"]["nutrients"]["energy_kcal"]["value"]
    revised = copy.deepcopy(DATA)
    dal = next(f for f in revised["foods"] if normalize_food_name(f["canonical_name"]) == "dal")
    dal["nutrients"]["energy_kcal"] = "999"
    dal["nutrients"]["dataset_version"] = "2099-01-01"
    load_seed(db, revised)
    db.commit()
    again = user.get(f"/api/v1/meals/{before['id']}").json()
    assert again["items"][0]["estimate"]["nutrients"]["energy_kcal"]["value"] == old_kcal
    assert again["items"][0]["estimate"]["provenance"]["dataset_version"] == "2024-10-31"
    after = _meal(user, [{"food_id": str(foods["Dal"]), "quantity": "100", "unit": "g"}]).json()
    assert Decimal(after["items"][0]["estimate"]["nutrients"]["energy_kcal"]["value"]) == Decimal("999")
    assert after["items"][0]["estimate"]["provenance"]["dataset_version"] == "2099-01-01"


def test_inactive_food_cannot_be_newly_logged_but_history_remains(client: TestClient, db: Session,
                                                                  foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    meal = _meal(user, [{"food_id": str(foods["Papad"]), "quantity": "10", "unit": "g"}]).json()
    db.execute(m.Food.__table__.update().where(m.Food.id == foods["Papad"]).values(is_active=False))
    db.commit()
    res = _meal(user, [{"food_id": str(foods["Papad"]), "quantity": "10", "unit": "g"}])
    assert res.status_code == 422 and error_code(res) == "food_unavailable"
    kept = user.get(f"/api/v1/meals/{meal['id']}").json()["items"][0]
    assert kept["food"]["canonical_name"] == "Papad" and kept["estimate"]["method"] == "per_reference_mass"


# --- idempotency -------------------------------------------------------------------------------

def test_idempotent_meal_creation(client: TestClient, db: Session) -> None:
    user = register(client)
    key = str(uuid.uuid4())
    body = {"meal_type": "breakfast", "consumed_at": _ago(hours=2), "idempotency_key": key,
            "items": [{"display_name": "Poha", "quantity": "1", "unit": "serving"}]}
    first = user.post("/api/v1/meals", json=body)
    replay = user.post("/api/v1/meals", json=body)
    assert first.status_code == 201 and replay.status_code == 200
    assert first.json()["id"] == replay.json()["id"]
    changed = user.post("/api/v1/meals", json={**body, "meal_type": "dinner"})
    assert changed.status_code == 409 and error_code(changed) == "idempotency_conflict"
    assert db.scalar(select(func.count()).select_from(m.MealLog)) == 1


# --- history, dates and pagination -------------------------------------------------------------

def test_local_date_boundaries_follow_profile_timezone(client: TestClient) -> None:
    user = register(client)  # default timezone Asia/Kolkata (UTC+05:30)
    ist = _meal(user, [], consumed_at=LATE_EVENING_UTC).json()
    assert ist["log_date"] == "2026-09-21"
    assert [m_["id"] for m_ in user.get("/api/v1/meals/day", params={"date": "2026-09-21"}).json()["meals"]] == \
        [ist["id"]]
    assert user.get("/api/v1/meals/day", params={"date": "2026-09-20"}).json()["meals"] == []
    user.put("/api/v1/profile", json={"display_name": "A", "timezone": "UTC"})
    utc = _meal(user, [], consumed_at=LATE_EVENING_UTC).json()
    assert utc["log_date"] == "2026-09-20"
    # Already-logged meals keep the date they were logged under.
    assert user.get(f"/api/v1/meals/{ist['id']}").json()["log_date"] == "2026-09-21"
    # Moving a meal's time recomputes its date in the current timezone.
    moved = user.patch(f"/api/v1/meals/{ist['id']}", json={"consumed_at": "2026-09-22T12:00:00+05:30"}).json()
    assert moved["log_date"] == "2026-09-22"


def test_list_filters_and_pagination(client: TestClient) -> None:
    user = register(client)
    ids = [_meal(user, [], consumed_at=f"2026-09-{d:02d}T08:00:00+05:30").json()["id"] for d in (10, 11, 12)]
    page = user.get("/api/v1/meals", params={"limit": 2}).json()
    assert page["total"] == 3 and [x["id"] for x in page["items"]] == [ids[2], ids[1]]
    rest = user.get("/api/v1/meals", params={"limit": 2, "offset": 2}).json()
    assert [x["id"] for x in rest["items"]] == [ids[0]]
    ranged = user.get("/api/v1/meals", params={"start": "2026-09-11", "end": "2026-09-12"}).json()
    assert ranged["total"] == 2
    assert user.get("/api/v1/meals", params={"start": "2026-09-12", "end": "2026-09-11"}).status_code == 422
    assert user.get("/api/v1/meals", params={"limit": 101}).status_code == 422


def test_day_and_range_summaries(client: TestClient, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    _meal(user, [{"food_id": str(foods["Dal"]), "quantity": "100", "unit": "g"}],
          consumed_at="2026-09-10T08:00:00+05:30")
    _meal(user, [{"food_id": str(foods["Dal"]), "quantity": "50", "unit": "g"},
                 {"display_name": "Unknown snack", "quantity": "1", "unit": "serving"}],
          consumed_at="2026-09-10T20:00:00+05:30", meal_type="dinner")
    day = user.get("/api/v1/meals/day", params={"date": "2026-09-10"}).json()
    assert len(day["meals"]) == 2
    energy = day["totals"]["nutrients"]["energy_kcal"]
    assert Decimal(energy["total"]) == _kcal("Dal", "150") and energy["status"] == "incomplete"

    summary = user.get("/api/v1/nutrition/summary", params={"start": "2026-09-09", "end": "2026-09-11"}).json()
    assert [d["date"] for d in summary["days"]] == ["2026-09-09", "2026-09-10", "2026-09-11"]
    assert [d["meal_count"] for d in summary["days"]] == [0, 2, 0]
    assert summary["days"][0]["totals"]["nutrients"]["energy_kcal"]["status"] == "empty"
    assert summary["days_with_meals"] == 1
    assert Decimal(summary["totals"]["nutrients"]["energy_kcal"]["total"]) == _kcal("Dal", "150")

    week = user.get("/api/v1/nutrition/summary", params={"days": 7, "end": "2026-09-10"}).json()
    assert (week["start"], week["end"], len(week["days"])) == ("2026-09-04", "2026-09-10", 7)
    month = user.get("/api/v1/nutrition/summary", params={"days": 30, "end": "2026-09-30"}).json()
    assert (month["start"], len(month["days"])) == ("2026-09-01", 30)
    assert user.get("/api/v1/nutrition/summary", params={"start": "2026-01-01", "end": "2026-06-01"}).status_code \
        == 422
    assert user.get("/api/v1/nutrition/summary").status_code == 422


# --- isolation ---------------------------------------------------------------------------------

def test_users_cannot_access_each_others_meals(client: TestClient, make_client: Callable[[], TestClient],
                                               foods: dict[str, uuid.UUID]) -> None:
    alice, bob = register(client), register(make_client())
    meal = _meal(alice, [{"food_id": str(foods["Dal"]), "quantity": "100", "unit": "g"}]).json()
    item_id = meal["items"][0]["id"]
    url = f"/api/v1/meals/{meal['id']}"
    assert bob.get(url).status_code == 404
    assert bob.get(f"{url}/nutrition").status_code == 404
    assert bob.patch(url, json={"note": "mine"}).status_code == 404
    assert bob.delete(url).status_code == 404
    assert bob.post(f"{url}/items", json={"display_name": "x", "quantity": "1", "unit": "g"}).status_code == 404
    assert bob.patch(f"{url}/items/{item_id}", json={"quantity": "1"}).status_code == 404
    assert bob.delete(f"{url}/items/{item_id}").status_code == 404
    # An item cannot be reached through another meal either, even one the attacker owns.
    own = _meal(bob, []).json()
    assert bob.patch(f"/api/v1/meals/{own['id']}/items/{item_id}", json={"quantity": "1"}).status_code == 404
    assert bob.get("/api/v1/meals").json()["total"] == 1
    bob_day = bob.get("/api/v1/meals/day", params={"date": meal["log_date"]}).json()["meals"]
    assert [x["id"] for x in bob_day] == [own["id"]]
    # Alice's meal is untouched.
    after = alice.get(url).json()
    assert after["items"][0]["estimated_mass_g"] == "100.00" and after["note"] is None


def test_logout_blocks_meal_access(client: TestClient) -> None:
    user = register(client)
    meal = _meal(user, []).json()
    assert user.post("/api/v1/auth/logout").status_code == 204
    assert client.get(f"/api/v1/meals/{meal['id']}").status_code == 401
    assert client.post("/api/v1/meals", json={}, headers={CSRF_HEADER: user.csrf}).status_code == 401


# --- portion preview -----------------------------------------------------------------------------

def test_estimate_preview_matches_saving_and_writes_nothing(client: TestClient, db: Session,
                                                            foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    roti = foods["Roti / chapati"]
    serving = _serving(user, roti, "1 medium")
    url = f"/api/v1/foods/{roti}/estimate"
    preview = user.get(url, params={"quantity": "2", "unit": "serving", "serving_id": serving})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["food"]["canonical_name"] == "Roti / chapati" and body["serving"]["id"] == serving
    assert body["estimated_mass_g"] == "80.00" and body["confidence"] == "MEDIUM"
    assert body["nutrients"]["sodium_mg"]["status"] == "not_in_source"
    assert body["provenance"]["dataset_version"] == "2024-10-31"
    for model in (m.MealLog, m.ConsumedItem, m.NutritionEstimate):
        assert db.scalar(select(func.count()).select_from(model)) == 0
    saved = _meal(user, [{"food_id": str(roti), "quantity": "2", "unit": "serving", "serving_id": serving}]).json()
    assert saved["items"][0]["estimate"]["nutrients"] == body["nutrients"]


def test_estimate_preview_validation(client: TestClient, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    dal = foods["Dal"]
    no_volume = user.get(f"/api/v1/foods/{dal}/estimate", params={"quantity": "200", "unit": "ml"}).json()
    assert no_volume["method"] == "unavailable" and no_volume["reason"] == "no_volume_reference"
    no_serving = user.get(f"/api/v1/foods/{dal}/estimate", params={"quantity": "1", "unit": "serving"}).json()
    assert no_serving["reason"] == "serving_not_selected" and no_serving["estimated_mass_g"] is None
    naan_serving = _serving(user, foods["Naan"], "1")
    for params in ({"quantity": "0", "unit": "g"}, {"quantity": "1.005", "unit": "g"}, {"quantity": "1", "unit": "cup"},
                   {"quantity": "1", "unit": "serving", "serving_id": naan_serving}, {"unit": "g"}):
        assert user.get(f"/api/v1/foods/{dal}/estimate", params=params).status_code == 422, params
    missing = user.get(f"/api/v1/foods/{uuid.uuid4()}/estimate", params={"quantity": "1", "unit": "g"})
    assert missing.status_code == 422 and error_code(missing) == "food_unavailable"
    client.cookies.clear()
    assert client.get(f"/api/v1/foods/{dal}/estimate", params={"quantity": "1", "unit": "g"}).status_code == 401
