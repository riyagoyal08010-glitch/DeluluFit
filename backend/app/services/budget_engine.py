"""Deterministic budget arithmetic. No I/O; fully unit-tested.

Sign convention (the only one used anywhere):
    every transaction amount is stored positive;
    net_spending = sum(expenses) - sum(refunds);
    remaining    = budget_amount - net_spending   (negative means over budget).
"""

from __future__ import annotations

import calendar
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

Period = Literal["daily", "weekly", "monthly"]
CENT = Decimal("0.01")


def period_bounds(period: Period, anchor: date) -> tuple[date, date]:
    """Inclusive [start, end] of the period containing `anchor`. Weeks run Monday-Sunday."""
    if period == "daily":
        return anchor, anchor
    if period == "weekly":
        start = anchor - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=6)
    if period == "monthly":
        last = calendar.monthrange(anchor.year, anchor.month)[1]
        return anchor.replace(day=1), anchor.replace(day=last)
    raise ValueError(f"unknown period {period!r}")


@dataclass(frozen=True)
class Txn:
    kind: Literal["expense", "refund"]
    amount: Decimal
    currency: str
    occurred_on: date


@dataclass(frozen=True)
class BudgetSummary:
    period: Period
    start: date
    end: date
    currency: str
    budget_amount: Decimal | None
    expenses: Decimal
    refunds: Decimal
    net_spending: Decimal
    remaining: Decimal | None
    utilization: Decimal | None  # fraction of the budget used; None when no positive budget
    over_budget: bool
    excluded_other_currency: int
    transaction_count: int


def summarize(*, period: Period, anchor: date, currency: str, budget_amount: Decimal | None,
              transactions: Iterable[Txn]) -> BudgetSummary:
    start, end = period_bounds(period, anchor)
    expenses = refunds = Decimal("0")
    excluded = counted = 0
    for t in transactions:
        if not (start <= t.occurred_on <= end):
            continue
        if t.amount <= 0:
            raise ValueError("transaction amounts must be positive; the kind carries the sign")
        if t.currency != currency:
            excluded += 1
            continue
        counted += 1
        if t.kind == "expense":
            expenses += t.amount
        elif t.kind == "refund":
            refunds += t.amount
        else:  # pragma: no cover - guarded by DB constraint
            raise ValueError(f"unknown transaction kind {t.kind!r}")
    net = (expenses - refunds).quantize(CENT, ROUND_HALF_UP)
    remaining = None if budget_amount is None else (budget_amount - net).quantize(CENT, ROUND_HALF_UP)
    utilization = None
    if budget_amount is not None and budget_amount > 0:
        utilization = (net / budget_amount).quantize(Decimal("0.0001"), ROUND_HALF_UP)
    over = budget_amount is not None and net > budget_amount
    return BudgetSummary(period=period, start=start, end=end, currency=currency, budget_amount=budget_amount,
                         expenses=expenses.quantize(CENT), refunds=refunds.quantize(CENT), net_spending=net,
                         remaining=remaining, utilization=utilization, over_budget=over,
                         excluded_other_currency=excluded, transaction_count=counted)


def daily_net(transactions: Iterable[Txn], currency: str, start: date, end: date) -> list[tuple[date, Decimal]]:
    totals: dict[date, Decimal] = {}
    for t in transactions:
        if t.currency != currency or not (start <= t.occurred_on <= end):
            continue
        sign = Decimal(1) if t.kind == "expense" else Decimal(-1)
        totals[t.occurred_on] = totals.get(t.occurred_on, Decimal(0)) + sign * t.amount
    out = []
    day = start
    while day <= end:
        out.append((day, totals.get(day, Decimal(0)).quantize(CENT)))
        day += timedelta(days=1)
    return out
