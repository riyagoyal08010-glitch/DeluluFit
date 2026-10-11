from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from app.schemas.common import DecimalStr, OptionalDecimalStr, ORMModel

PeriodLit = Literal["daily", "weekly", "monthly"]
KindLit = Literal["expense", "refund"]
CategoryLit = Literal["mess", "outside_food", "groceries", "beverages", "snacks", "other"]
# Amounts are normalized to cents on input so responses match what is stored (NUMERIC(12, 2)).
Money = Annotated[Decimal, AfterValidator(lambda v: v.quantize(Decimal("0.01")))]


class BudgetIn(BaseModel):
    period: PeriodLit
    amount: Money = Field(ge=0, le=Decimal("9999999999.99"), decimal_places=2)
    effective_from: date | None = None


class BudgetOut(ORMModel):
    id: uuid.UUID
    period: str
    amount: DecimalStr
    currency: str
    effective_from: date
    effective_to: date | None


class TransactionIn(BaseModel):
    kind: KindLit
    amount: Money = Field(gt=0, le=Decimal("9999999999.99"), decimal_places=2)
    category: CategoryLit
    occurred_on: date
    description: str | None = Field(default=None, max_length=200)
    meal_log_id: uuid.UUID | None = None
    refund_of_id: uuid.UUID | None = None
    idempotency_key: uuid.UUID | None = None


class TransactionUpdate(BaseModel):
    amount: Money | None = Field(default=None, gt=0, le=Decimal("9999999999.99"), decimal_places=2)
    category: CategoryLit | None = None
    occurred_on: date | None = None
    description: str | None = Field(default=None, max_length=200)


class TransactionOut(ORMModel):
    id: uuid.UUID
    kind: str
    amount: DecimalStr
    currency: str
    category: str
    occurred_on: date
    description: str | None
    meal_log_id: uuid.UUID | None
    refund_of_id: uuid.UUID | None
    created_at: datetime


class SummaryOut(BaseModel):
    period: str
    start: date
    end: date
    currency: str
    budget_amount: OptionalDecimalStr
    expenses: DecimalStr
    refunds: DecimalStr
    net_spending: DecimalStr
    remaining: OptionalDecimalStr
    utilization: OptionalDecimalStr
    over_budget: bool
    excluded_other_currency: int
    transaction_count: int
    has_budget: bool
    by_category: dict[str, DecimalStr]
    explanation: str


class TrendPoint(BaseModel):
    date: date
    net_spending: DecimalStr


class BudgetOverview(BaseModel):
    active: BudgetOut | None
    history: list[BudgetOut]
