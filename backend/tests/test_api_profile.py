"""Profile, onboarding, preferences, allergies, institutions, messes and nutrition targets."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import models as m
from tests import factories as f
from tests.api_helpers import error_code, register


def test_profile_create_update_and_bundle(client: TestClient) -> None:
    user = register(client, display_name=None)
    assert user.get("/api/v1/profile").json()["profile"] is None
    res = user.put("/api/v1/profile", json={"display_name": "  Asha   K ", "height_cm": "160.5", "weight_kg": "55",
                                            "activity_level": "moderate", "dietary_pattern": "vegetarian",
                                            "onboarding_step": 2})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["display_name"] == "Asha K"
    assert body["height_cm"] == "160.5"
    assert body["onboarding_step"] == 2
    assert body["timezone"] == "Asia/Kolkata" and body["currency"] == "INR"
    # Onboarding progress never moves backwards.
    res = user.put("/api/v1/profile", json={"display_name": "Asha", "onboarding_step": 1})
    assert res.json()["onboarding_step"] == 2
    bundle = user.get("/api/v1/profile").json()
    assert bundle["profile"]["display_name"] == "Asha"
    assert bundle["preferences"] == [] and bundle["allergies"] == [] and bundle["active_target"] is None


def test_profile_validation(client: TestClient) -> None:
    user = register(client)
    for body in ({"display_name": "   "}, {"display_name": "A", "timezone": "Mars/Base"},
                 {"display_name": "A", "height_cm": "20"}, {"display_name": "A", "currency": "inr"},
                 {"display_name": "A", "dietary_pattern": "carnivore"},
                 {"display_name": "A", "hostel_id": "00000000-0000-0000-0000-000000000001"}):
        assert user.put("/api/v1/profile", json=body).status_code == 422, body


def test_onboarding_requires_a_profile_and_is_idempotent(client: TestClient) -> None:
    user = register(client, display_name=None)
    res = user.post("/api/v1/profile/complete-onboarding")
    assert res.status_code == 422
    assert error_code(res) == "profile_incomplete"
    user.put("/api/v1/profile", json={"display_name": "Asha"})
    first = user.post("/api/v1/profile/complete-onboarding").json()["onboarding_completed_at"]
    second = user.post("/api/v1/profile/complete-onboarding").json()["onboarding_completed_at"]
    assert first is not None and first == second
    assert user.get("/api/v1/auth/session").json()["user"]["onboarding_completed"] is True


def test_institution_and_hostel_selection(client: TestClient) -> None:
    user = register(client)
    inst = user.post("/api/v1/institutions", json={"name": "IIT  Example"}).json()
    again = user.post("/api/v1/institutions", json={"name": "iit example!"}).json()
    assert inst["id"] == again["id"]  # deduplicated by normalized name
    other = user.post("/api/v1/institutions", json={"name": "Other College"}).json()
    hostel = user.post(f"/api/v1/institutions/{inst['id']}/hostels", json={"name": "Hostel 4"}).json()
    assert [h["id"] for h in user.get(f"/api/v1/institutions/{inst['id']}/hostels").json()] == [hostel["id"]]
    assert [i["name"] for i in user.get("/api/v1/institutions", params={"q": "iit"}).json()] == ["IIT Example"]
    bad = user.put("/api/v1/profile", json={"display_name": "A", "institution_id": other["id"],
                                            "hostel_id": hostel["id"]})
    assert bad.status_code == 422
    ok = user.put("/api/v1/profile", json={"display_name": "A", "institution_id": inst["id"],
                                           "hostel_id": hostel["id"]})
    assert ok.status_code == 200
    bundle = user.get("/api/v1/profile").json()
    assert bundle["institution"]["id"] == inst["id"] and bundle["hostel"]["id"] == hostel["id"]


def test_blank_hostel_and_mess_names_are_validation_errors(client: TestClient) -> None:
    user = register(client)
    inst = user.post("/api/v1/institutions", json={"name": "Some College"}).json()
    hostel = user.post(f"/api/v1/institutions/{inst['id']}/hostels", json={"name": "   "})
    assert hostel.status_code == 422
    mess = user.post("/api/v1/messes", json={"name": " \t "})
    assert mess.status_code == 422


def test_messes_are_private_to_their_owner(client: TestClient, make_client: Callable[[], TestClient]) -> None:
    alice, bob = register(client), register(make_client())
    assert alice.post("/api/v1/messes", json={"name": "North Mess"}).status_code == 201
    dup = alice.post("/api/v1/messes", json={"name": "North Mess"})
    assert dup.status_code == 409
    assert bob.post("/api/v1/messes", json={"name": "North Mess"}).status_code == 201  # names are per user
    assert len(alice.get("/api/v1/messes").json()) == 1
    assert len(bob.get("/api/v1/messes").json()) == 1


def test_preferences_are_deduplicated_and_linked_to_foods(client: TestClient, db: Session) -> None:
    food = f.make_food(db, "Paneer")
    db.add(m.FoodAlias(food_id=food.id, alias="paneer", normalized_alias="paneer"))
    db.commit()
    user = register(client)
    res = user.put("/api/v1/profile/preferences", json={"items": [
        {"label": "Paneer", "preference": "like"}, {"label": "paneer!", "preference": "dislike"},
        {"label": "Karela", "preference": "avoid"}]})
    assert res.status_code == 200
    rows = {r["label"]: r for r in res.json()}
    assert set(rows) == {"paneer!", "Karela"}  # last duplicate wins
    assert rows["paneer!"]["preference"] == "dislike" and rows["paneer!"]["food_id"] == str(food.id)
    assert rows["Karela"]["food_id"] is None
    bad = user.put("/api/v1/profile/preferences", json={"items": [{"label": "!!!", "preference": "like"}]})
    assert bad.status_code == 422


def test_allergies_replace_and_validate(client: TestClient) -> None:
    user = register(client)
    assert user.put("/api/v1/profile/allergies", json={"items": [{"allergen": "other"}]}).status_code == 422
    res = user.put("/api/v1/profile/allergies", json={"items": [
        {"allergen": "peanut", "severity": "severe"}, {"allergen": "peanut", "severity": "mild"},
        {"allergen": "other", "custom_label": "Kiwi"}, {"allergen": "milk", "custom_label": "ignored"}]})
    assert res.status_code == 200
    rows = {r["allergen"]: r for r in res.json()}
    assert rows["peanut"]["severity"] == "mild"
    assert rows["other"]["custom_label"] == "Kiwi"
    assert rows["milk"]["custom_label"] is None
    assert user.put("/api/v1/profile/allergies", json={"items": []}).json() == []


def test_self_set_energy_target_floor(client: TestClient) -> None:
    user = register(client)
    low = user.put("/api/v1/targets/active", json={"source": "self_set", "energy_kcal": 1000})
    assert low.status_code == 422
    assert error_code(low) == "unsafe_target"
    pro = user.put("/api/v1/targets/active", json={"source": "professional", "energy_kcal": 1000})
    assert pro.status_code == 200


def test_target_value_validation(client: TestClient) -> None:
    user = register(client)
    for body in ({"source": "self_set"}, {"source": "self_set", "energy_kcal": 9000},
                 {"source": "self_set", "protein_g": -1}, {"source": "self_set", "fibre_g": 151},
                 {"source": "guess", "protein_g": 50}):
        assert user.put("/api/v1/targets/active", json=body).status_code == 422, body


def test_target_history_and_replacement(client: TestClient) -> None:
    user = register(client)
    user.put("/api/v1/profile", json={"display_name": "A"})
    today = date.today()
    first = user.put("/api/v1/targets/active", json={"source": "self_set", "protein_g": 50}).json()
    # Same start date replaces the target rather than stacking history.
    second = user.put("/api/v1/targets/active", json={"source": "self_set", "protein_g": 60}).json()
    history = user.get("/api/v1/targets").json()
    assert [t["id"] for t in history] == [second["id"]] and first["id"] != second["id"]
    future = (today + timedelta(days=10)).isoformat()
    third = user.put("/api/v1/targets/active", json={"source": "self_set", "protein_g": 70,
                                                     "effective_from": future}).json()
    history = {t["id"]: t for t in user.get("/api/v1/targets").json()}
    assert history[second["id"]]["effective_to"] == (today + timedelta(days=9)).isoformat()
    assert history[third["id"]]["effective_to"] is None
    earlier = user.put("/api/v1/targets/active", json={"source": "self_set", "protein_g": 80,
                                                       "effective_from": today.isoformat()})
    assert earlier.status_code == 422
    assert user.get("/api/v1/profile").json()["active_target"]["id"] == third["id"]
    assert user.delete("/api/v1/targets/active").status_code == 204
    assert user.delete("/api/v1/targets/active").status_code == 404


def test_targets_are_private(client: TestClient, make_client: Callable[[], TestClient]) -> None:
    alice, bob = register(client), register(make_client())
    alice.put("/api/v1/targets/active", json={"source": "self_set", "protein_g": 50})
    assert bob.get("/api/v1/targets").json() == []
    assert bob.delete("/api/v1/targets/active").status_code == 404
    assert len(alice.get("/api/v1/targets").json()) == 1


def test_clients_cannot_label_targets_as_reference_estimates(client: TestClient) -> None:
    user = register(client)
    res = user.put("/api/v1/targets/active", json={"source": "reference_estimate", "protein_g": 50})
    assert res.status_code == 422 and error_code(res) == "unsupported_source"
    assert user.get("/api/v1/targets").json() == []
