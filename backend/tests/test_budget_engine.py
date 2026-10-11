"""Pure budget arithmetic and period boundaries."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services.budget_engine import Txn, daily_net, period_bounds, summarize


@pytest.mark.parametrize(("period", "anchor", "expected"), [
    ("daily", date(2026, 10, 7), (date(2026, 10, 7), date(2026, 10, 7))),
    ("weekly", date(2026, 10, 5), (date(2026, 10, 5), date(2026, 10, 11))),   # Monday
    ("weekly", date(2026, 10, 11), (date(2026, 10, 5), date(2026, 10, 11))),  # Sunday
    ("weekly", date(2026, 12, 30), (date(2026, 12, 28), date(2027, 1, 3))),   # spans a year end
    ("monthly", date(2026, 2, 14), (date(2026, 2, 1), date(2026, 2, 28))),
    ("monthly", date(2028, 2, 29), (date(2028, 2, 1), date(2028, 2, 29))),    # leap year
    ("monthly", date(2026, 12, 31), (date(2026, 12, 1), date(2026, 12, 31))),
])
def test_period_bounds(period: str, anchor: date, expected: tuple[date, date]) -> None:
    assert period_bounds(period, anchor) == expected  # type: ignore[arg-type]


def test_unknown_period_is_rejected() -> None:
    with pytest.raises(ValueError):
        period_bounds("yearly", date(2026, 1, 1))  # type: ignore[arg-type]


def t(kind: str, amount: str, on: date, currency: str = "INR") -> Txn:
    return Txn(kind, Decimal(amount), currency, on)  # type: ignore[arg-type]


def test_summarize_net_remaining_and_utilization() -> None:
    on = date(2026, 10, 7)
    s = summarize(period="weekly", anchor=on, currency="INR", budget_amount=Decimal("500"), transactions=[
        t("expense", "200.10", on), t("expense", "99.90", date(2026, 10, 11)), t("refund", "50", on),
        t("expense", "1000", date(2026, 10, 4)),       # previous week
        t("expense", "75", on, currency="USD"),        # other currency
    ])
    assert s.expenses == Decimal("300.00") and s.refunds == Decimal("50.00")
    assert s.net_spending == Decimal("250.00") and s.remaining == Decimal("250.00")
    assert s.utilization == Decimal("0.5000") and s.over_budget is False
    assert s.transaction_count == 3 and s.excluded_other_currency == 1


def test_summarize_without_budget_or_with_zero_budget() -> None:
    on = date(2026, 10, 7)
    none = summarize(period="daily", anchor=on, currency="INR", budget_amount=None,
                     transactions=[t("expense", "10", on)])
    assert none.remaining is None and none.utilization is None and none.over_budget is False
    zero = summarize(period="daily", anchor=on, currency="INR", budget_amount=Decimal("0"),
                     transactions=[t("expense", "10", on)])
    assert zero.remaining == Decimal("-10.00") and zero.utilization is None and zero.over_budget is True


def test_refunds_can_make_net_spending_negative() -> None:
    on = date(2026, 10, 7)
    s = summarize(period="daily", anchor=on, currency="INR", budget_amount=Decimal("100"),
                  transactions=[t("refund", "30", on)])
    assert s.net_spending == Decimal("-30.00") and s.remaining == Decimal("130.00")


def test_non_positive_amounts_are_rejected() -> None:
    on = date(2026, 10, 7)
    with pytest.raises(ValueError):
        summarize(period="daily", anchor=on, currency="INR", budget_amount=None,
                  transactions=[t("expense", "-5", on)])


def test_daily_net_fills_every_day() -> None:
    start, end = date(2026, 10, 1), date(2026, 10, 4)
    rows = daily_net([t("expense", "10", date(2026, 10, 2)), t("refund", "4", date(2026, 10, 2)),
                      t("expense", "7", date(2026, 10, 4)), t("expense", "9", date(2026, 10, 5))],
                     "INR", start, end)
    assert rows == [(date(2026, 10, 1), Decimal("0.00")), (date(2026, 10, 2), Decimal("6.00")),
                    (date(2026, 10, 3), Decimal("0.00")), (date(2026, 10, 4), Decimal("7.00"))]
