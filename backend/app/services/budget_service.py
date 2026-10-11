"""Budgets and transactions: persistence, ownership and validation around budget_engine."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationFailedError
from app.db.models import BudgetTransaction, MealLog, StudentProfile, UserBudget
from app.schemas.budget import BudgetIn, SummaryOut, TransactionIn, TransactionUpdate
from app.services import budget_engine
from app.services.budget_engine import Period, Txn
from app.services.timeutil import local_today

EXPLANATION = ("Net spending = expenses - refunds for transactions dated inside this period, in your profile "
               "currency. Remaining = budget - net spending. Mess meals only count if you recorded an expense "
               "for them.")


def user_currency(db: Session, user_id: uuid.UUID) -> str:
    return db.scalar(select(StudentProfile.currency).where(StudentProfile.user_id == user_id)) or "INR"


def active_budget(db: Session, user_id: uuid.UUID) -> UserBudget | None:
    return db.scalar(select(UserBudget).where(UserBudget.user_id == user_id, UserBudget.effective_to.is_(None)))


def budget_history(db: Session, user_id: uuid.UUID) -> list[UserBudget]:
    return list(db.scalars(select(UserBudget).where(UserBudget.user_id == user_id)
                           .order_by(UserBudget.effective_from.desc(), UserBudget.created_at.desc()).limit(50)))


def budget_on(db: Session, user_id: uuid.UUID, day: date) -> UserBudget | None:
    return db.scalar(select(UserBudget).where(
        UserBudget.user_id == user_id, UserBudget.effective_from <= day,
        (UserBudget.effective_to.is_(None)) | (UserBudget.effective_to >= day))
        .order_by(UserBudget.effective_from.desc()).limit(1))


def set_budget(db: Session, user_id: uuid.UUID, data: BudgetIn) -> UserBudget:
    today = local_today(db, user_id)
    start = data.effective_from or today
    current = active_budget(db, user_id)
    if current is not None:
        if start < current.effective_from:
            raise ValidationFailedError("A new budget cannot start before the current budget started.")
        if start == current.effective_from:
            db.delete(current)
            db.flush()
        else:
            current.effective_to = start - timedelta(days=1)
    budget = UserBudget(user_id=user_id, period=data.period, amount=data.amount,
                        currency=user_currency(db, user_id), effective_from=start)
    db.add(budget)
    db.commit()
    return budget


def end_budget(db: Session, user_id: uuid.UUID) -> None:
    current = active_budget(db, user_id)
    if current is None:
        raise NotFoundError("No active budget.")
    today = local_today(db, user_id)
    if current.effective_from >= today:
        db.delete(current)
    else:
        current.effective_to = today - timedelta(days=1)
    db.commit()


def _owned_txn(db: Session, user_id: uuid.UUID, txn_id: uuid.UUID, *, lock: bool = False) -> BudgetTransaction:
    stmt = select(BudgetTransaction).where(BudgetTransaction.id == txn_id, BudgetTransaction.user_id == user_id)
    # Locking the original expense serializes concurrent refunds against it, so
    # two requests cannot both pass the "refunds <= expense" check.
    txn = db.scalar(stmt.with_for_update() if lock else stmt)
    if txn is None:
        raise NotFoundError("Transaction not found.")
    return txn


def _refunded_total(db: Session, original_id: uuid.UUID, exclude_id: uuid.UUID | None = None) -> Decimal:
    stmt = select(func.coalesce(func.sum(BudgetTransaction.amount), 0)).where(
        BudgetTransaction.refund_of_id == original_id)
    if exclude_id:
        stmt = stmt.where(BudgetTransaction.id != exclude_id)
    return Decimal(db.scalar(stmt) or 0)


def create_transaction(db: Session, user_id: uuid.UUID, data: TransactionIn) -> tuple[BudgetTransaction, bool]:
    """Returns (transaction, created). Replays with the same idempotency key return the original."""
    if data.idempotency_key:
        existing = db.scalar(select(BudgetTransaction).where(BudgetTransaction.user_id == user_id,
                                                             BudgetTransaction.idempotency_key == data.idempotency_key))
        if existing:
            return existing, False
    currency = user_currency(db, user_id)
    if data.meal_log_id:
        owned = db.scalar(select(MealLog.id).where(MealLog.id == data.meal_log_id, MealLog.user_id == user_id))
        if owned is None:
            raise NotFoundError("Meal log not found.")
    if data.kind == "refund" and data.refund_of_id:
        original = _owned_txn(db, user_id, data.refund_of_id, lock=True)
        if original.kind != "expense":
            raise ValidationFailedError("A refund must refer to an expense.")
        if original.currency != currency:
            raise ValidationFailedError("Refund currency must match the original expense.")
        if _refunded_total(db, original.id) + data.amount > original.amount:
            raise ValidationFailedError("Refunds cannot exceed the original expense amount.")
    elif data.refund_of_id:
        raise ValidationFailedError("Only refunds can refer to another transaction.")
    txn = BudgetTransaction(user_id=user_id, currency=currency, **data.model_dump())
    db.add(txn)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if data.idempotency_key:  # concurrent replay
            existing = db.scalar(select(BudgetTransaction).where(
                BudgetTransaction.user_id == user_id, BudgetTransaction.idempotency_key == data.idempotency_key))
            if existing:
                return existing, False
        raise
    return txn, True


def update_transaction(db: Session, user_id: uuid.UUID, txn_id: uuid.UUID, data: TransactionUpdate) -> BudgetTransaction:
    txn = _owned_txn(db, user_id, txn_id)
    changes = data.model_dump(exclude_unset=True)
    if "amount" in changes and changes["amount"] is None:
        raise ValidationFailedError("Amount is required.")
    new_amount = changes.get("amount", txn.amount)
    if txn.kind == "refund" and txn.refund_of_id:
        original = _owned_txn(db, user_id, txn.refund_of_id, lock=True)
        if _refunded_total(db, original.id, exclude_id=txn.id) + new_amount > original.amount:
            raise ValidationFailedError("Refunds cannot exceed the original expense amount.")
    if txn.kind == "expense" and new_amount < _refunded_total(db, txn.id):
        raise ValidationFailedError("An expense cannot be smaller than the refunds recorded against it.")
    for key, value in changes.items():
        if key in ("category", "occurred_on") and value is None:
            continue
        setattr(txn, key, value)
    db.commit()
    return txn


def delete_transaction(db: Session, user_id: uuid.UUID, txn_id: uuid.UUID) -> None:
    txn = _owned_txn(db, user_id, txn_id)
    if txn.kind == "expense" and db.scalar(select(func.count()).where(BudgetTransaction.refund_of_id == txn.id)):
        raise ValidationFailedError("Delete the refunds linked to this expense first.", code="has_refunds")
    db.delete(txn)
    db.commit()


def list_transactions(db: Session, user_id: uuid.UUID, *, start: date | None, end: date | None, limit: int,
                      offset: int) -> tuple[list[BudgetTransaction], int]:
    cond = [BudgetTransaction.user_id == user_id]
    if start:
        cond.append(BudgetTransaction.occurred_on >= start)
    if end:
        cond.append(BudgetTransaction.occurred_on <= end)
    total = db.scalar(select(func.count()).select_from(BudgetTransaction).where(*cond)) or 0
    rows = db.scalars(select(BudgetTransaction).where(*cond)
                      .order_by(BudgetTransaction.occurred_on.desc(), BudgetTransaction.created_at.desc())
                      .limit(limit).offset(offset))
    return list(rows), total


def _txns_between(db: Session, user_id: uuid.UUID, start: date, end: date) -> list[BudgetTransaction]:
    return list(db.scalars(select(BudgetTransaction).where(
        BudgetTransaction.user_id == user_id, BudgetTransaction.occurred_on >= start,
        BudgetTransaction.occurred_on <= end)))


def summary(db: Session, user_id: uuid.UUID, anchor: date | None = None, period: Period | None = None) -> SummaryOut:
    anchor = anchor or local_today(db, user_id)
    budget = budget_on(db, user_id, anchor)
    chosen: Period = period or (budget.period if budget else "weekly")  # type: ignore[assignment]
    currency = user_currency(db, user_id)
    start, end = budget_engine.period_bounds(chosen, anchor)
    rows = _txns_between(db, user_id, start, end)
    applies = budget is not None and budget.period == chosen and budget.currency == currency
    result = budget_engine.summarize(
        period=chosen, anchor=anchor, currency=currency, budget_amount=budget.amount if applies and budget else None,
        transactions=[Txn(r.kind, r.amount, r.currency, r.occurred_on) for r in rows])  # type: ignore[arg-type]
    by_cat: dict[str, Decimal] = {}
    for r in rows:
        if r.currency == currency:
            by_cat[r.category] = by_cat.get(r.category, Decimal(0)) + (r.amount if r.kind == "expense" else -r.amount)
    return SummaryOut(**result.__dict__, has_budget=applies, by_category=by_cat, explanation=EXPLANATION)


def trend(db: Session, user_id: uuid.UUID, days: int) -> list[tuple[date, Decimal]]:
    end = local_today(db, user_id)
    start = end - timedelta(days=days - 1)
    rows = _txns_between(db, user_id, start, end)
    return budget_engine.daily_net([Txn(r.kind, r.amount, r.currency, r.occurred_on) for r in rows],  # type: ignore[arg-type]
                                   user_currency(db, user_id), start, end)
