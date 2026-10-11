"""Budgets, expenses and refunds through the HTTP API, including cross-user isolation."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import models as m
from tests import factories as f
from tests.api_helpers import ApiUser, error_code, register


def _expense(user: ApiUser, amount: str, on: date, **kw: object) -> dict:  # type: ignore[type-arg]
    res = user.post("/api/v1/budget/transactions", json={"kind": "expense", "amount": amount, "category": "mess",
                                                        "occurred_on": on.isoformat(), **kw})
    assert res.status_code in (200, 201), res.text
    return res.json()  # type: ignore[no-any-return]


def test_weekly_summary_with_expenses_and_refunds(client: TestClient) -> None:
    user = register(client)
    monday = date(2026, 10, 5)
    assert user.put("/api/v1/budget/active", json={"period": "weekly", "amount": "700.00",
                                                   "effective_from": "2026-10-01"}).status_code == 200
    exp = _expense(user, "120.50", monday)
    _expense(user, "80", monday + timedelta(days=6), category="outside_food")
    _expense(user, "999", monday - timedelta(days=1))  # previous week, excluded
    refund = user.post("/api/v1/budget/transactions", json={
        "kind": "refund", "amount": "20.50", "category": "mess", "occurred_on": monday.isoformat(),
        "refund_of_id": exp["id"]})
    assert refund.status_code == 201
    s = user.get("/api/v1/budget/summary", params={"date": "2026-10-08"}).json()
    assert (s["start"], s["end"]) == ("2026-10-05", "2026-10-11")
    assert s["expenses"] == "200.50" and s["refunds"] == "20.50" and s["net_spending"] == "180.00"
    assert s["remaining"] == "520.00" and s["utilization"] == "0.2571"
    assert s["over_budget"] is False and s["has_budget"] is True and s["transaction_count"] == 3
    assert s["by_category"] == {"mess": "100.00", "outside_food": "80.00"}


def test_summary_period_override_does_not_apply_a_mismatched_budget(client: TestClient) -> None:
    user = register(client)
    user.put("/api/v1/budget/active", json={"period": "weekly", "amount": "700", "effective_from": "2026-10-01"})
    _expense(user, "50", date(2026, 10, 20))
    s = user.get("/api/v1/budget/summary", params={"date": "2026-10-20", "period": "monthly"}).json()
    assert (s["start"], s["end"]) == ("2026-10-01", "2026-10-31")
    assert s["has_budget"] is False and s["budget_amount"] is None and s["remaining"] is None
    assert s["net_spending"] == "50.00"


def test_over_budget_flag(client: TestClient) -> None:
    user = register(client)
    user.put("/api/v1/budget/active", json={"period": "daily", "amount": "100", "effective_from": "2026-10-01"})
    _expense(user, "100.01", date(2026, 10, 10))
    s = user.get("/api/v1/budget/summary", params={"date": "2026-10-10"}).json()
    assert s["over_budget"] is True and s["remaining"] == "-0.01"


def test_refund_rules(client: TestClient) -> None:
    user = register(client)
    on = date(2026, 10, 10)
    exp = _expense(user, "100", on)

    def refund(amount: str, of: str | None) -> Any:
        body = {"kind": "refund", "amount": amount, "category": "mess", "occurred_on": on.isoformat()}
        if of:
            body["refund_of_id"] = of
        return user.post("/api/v1/budget/transactions", json=body)

    assert refund("60", exp["id"]).status_code == 201
    over = refund("40.01", exp["id"])
    assert over.status_code == 422
    ok = refund("40", exp["id"])
    assert ok.status_code == 201
    refund_of_refund = refund("1", ok.json()["id"])
    assert refund_of_refund.status_code == 422
    assert refund("5", None).status_code == 201  # standalone refund (e.g. mess rebate) is allowed
    expense_with_link = user.post("/api/v1/budget/transactions", json={
        "kind": "expense", "amount": "5", "category": "mess", "occurred_on": on.isoformat(),
        "refund_of_id": exp["id"]})
    assert expense_with_link.status_code == 422
    # The expense cannot shrink below what was refunded, nor be deleted while refunds exist.
    assert user.patch(f"/api/v1/budget/transactions/{exp['id']}", json={"amount": "99"}).status_code == 422
    blocked = user.delete(f"/api/v1/budget/transactions/{exp['id']}")
    assert blocked.status_code == 422 and error_code(blocked) == "has_refunds"


def test_transaction_validation(client: TestClient) -> None:
    user = register(client)
    base = {"kind": "expense", "amount": "10", "category": "mess", "occurred_on": "2026-10-10"}
    for change in ({"amount": "0"}, {"amount": "-5"}, {"amount": "1.001"}, {"kind": "loan"},
                   {"category": "rent"}, {"occurred_on": "not-a-date"}):
        assert user.post("/api/v1/budget/transactions", json={**base, **change}).status_code == 422, change
    assert user.put("/api/v1/budget/active", json={"period": "yearly", "amount": "1"}).status_code == 422
    assert user.put("/api/v1/budget/active", json={"period": "daily", "amount": "-1"}).status_code == 422


def test_idempotent_transaction_replay(client: TestClient) -> None:
    user = register(client)
    key = str(uuid.uuid4())
    body = {"kind": "expense", "amount": "45", "category": "snacks", "occurred_on": "2026-10-10",
            "idempotency_key": key}
    first = user.post("/api/v1/budget/transactions", json=body)
    replay = user.post("/api/v1/budget/transactions", json=body)
    assert first.status_code == 201 and replay.status_code == 200
    assert first.json()["id"] == replay.json()["id"]
    assert user.get("/api/v1/budget/transactions").json()["total"] == 1


def test_update_and_delete_transaction(client: TestClient) -> None:
    user = register(client)
    exp = _expense(user, "30", date(2026, 10, 10), description="tea")
    res = user.patch(f"/api/v1/budget/transactions/{exp['id']}", json={"amount": "35", "description": None,
                                                                      "category": None})
    assert res.status_code == 200
    body = res.json()
    assert body["amount"] == "35.00" and body["description"] is None and body["category"] == "mess"
    assert user.delete(f"/api/v1/budget/transactions/{exp['id']}").status_code == 204
    assert user.get("/api/v1/budget/transactions").json()["total"] == 0


def test_cross_user_access_is_prevented(client: TestClient, make_client: Callable[[], TestClient],
                                        db: Session) -> None:
    alice, bob = register(client), register(make_client())
    exp = _expense(alice, "100", date(2026, 10, 10))
    alice_log = f.make_meal_log(db, db.get(m.User, uuid.UUID(alice.id)))  # type: ignore[arg-type]
    db.commit()
    url = f"/api/v1/budget/transactions/{exp['id']}"
    assert bob.patch(url, json={"amount": "1"}).status_code == 404
    assert bob.delete(url).status_code == 404
    steal = bob.post("/api/v1/budget/transactions", json={
        "kind": "refund", "amount": "10", "category": "mess", "occurred_on": "2026-10-10",
        "refund_of_id": exp["id"]})
    assert steal.status_code == 404
    link = bob.post("/api/v1/budget/transactions", json={
        "kind": "expense", "amount": "10", "category": "mess", "occurred_on": "2026-10-10",
        "meal_log_id": str(alice_log.id)})
    assert link.status_code == 404
    assert bob.get("/api/v1/budget/transactions").json()["total"] == 0
    assert bob.get("/api/v1/budget/summary", params={"date": "2026-10-10"}).json()["net_spending"] == "0.00"
    assert alice.get(url.rsplit("/", 1)[0]).json()["total"] == 1


def test_budget_replacement_and_history(client: TestClient) -> None:
    user = register(client)
    first = user.put("/api/v1/budget/active", json={"period": "weekly", "amount": "700",
                                                    "effective_from": "2026-10-01"}).json()
    second = user.put("/api/v1/budget/active", json={"period": "monthly", "amount": "3000",
                                                     "effective_from": "2026-11-01"}).json()
    overview = user.get("/api/v1/budget").json()
    assert overview["active"]["id"] == second["id"]
    closed = next(b for b in overview["history"] if b["id"] == first["id"])
    assert closed["effective_to"] == "2026-10-31"
    early = user.put("/api/v1/budget/active", json={"period": "daily", "amount": "1",
                                                    "effective_from": "2026-10-15"})
    assert early.status_code == 422
    # The budget in force on a past date is the one used for that date's summary.
    s = user.get("/api/v1/budget/summary", params={"date": "2026-10-15"}).json()
    assert s["period"] == "weekly" and s["budget_amount"] == "700.00"


def test_trend_has_one_point_per_day(client: TestClient) -> None:
    user = register(client)
    points = user.get("/api/v1/budget/trend", params={"days": 7}).json()
    assert len(points) == 7 and all(p["net_spending"] == "0.00" for p in points)
    assert user.get("/api/v1/budget/trend", params={"days": 0}).status_code == 422
