from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Query, Response, status

from app.api.deps import Auth, DbSession
from app.schemas.budget import (BudgetIn, BudgetOut, BudgetOverview, PeriodLit, SummaryOut, TransactionIn,
                                TransactionOut, TransactionUpdate, TrendPoint)
from app.schemas.common import Page
from app.services import budget_service

router = APIRouter(prefix="/budget", tags=["budget"])


@router.get("", response_model=BudgetOverview)
def overview(auth: Auth, db: DbSession) -> BudgetOverview:
    active = budget_service.active_budget(db, auth.user.id)
    return BudgetOverview(active=BudgetOut.model_validate(active) if active else None,
                          history=[BudgetOut.model_validate(b) for b in budget_service.budget_history(db, auth.user.id)])


@router.put("/active", response_model=BudgetOut)
def set_budget(body: BudgetIn, auth: Auth, db: DbSession) -> BudgetOut:
    return BudgetOut.model_validate(budget_service.set_budget(db, auth.user.id, body))


@router.delete("/active", status_code=status.HTTP_204_NO_CONTENT)
def end_budget(auth: Auth, db: DbSession) -> Response:
    budget_service.end_budget(db, auth.user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/summary", response_model=SummaryOut)
def summary(auth: Auth, db: DbSession, on: date | None = Query(default=None, alias="date"),
            period: PeriodLit | None = None) -> SummaryOut:
    return budget_service.summary(db, auth.user.id, on, period)


@router.get("/trend", response_model=list[TrendPoint])
def trend(auth: Auth, db: DbSession, days: int = Query(default=14, ge=1, le=92)) -> list[TrendPoint]:
    return [TrendPoint(date=d, net_spending=v) for d, v in budget_service.trend(db, auth.user.id, days)]


@router.get("/transactions", response_model=Page[TransactionOut])
def list_transactions(auth: Auth, db: DbSession, start: date | None = None, end: date | None = None,
                      limit: int = Query(default=20, ge=1, le=100),
                      offset: int = Query(default=0, ge=0)) -> Page[TransactionOut]:
    rows, total = budget_service.list_transactions(db, auth.user.id, start=start, end=end, limit=limit, offset=offset)
    return Page(items=[TransactionOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)


@router.post("/transactions", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(body: TransactionIn, auth: Auth, db: DbSession, response: Response) -> TransactionOut:
    txn, created = budget_service.create_transaction(db, auth.user.id, body)
    if not created:
        response.status_code = status.HTTP_200_OK
    return TransactionOut.model_validate(txn)


@router.patch("/transactions/{txn_id}", response_model=TransactionOut)
def update_transaction(txn_id: uuid.UUID, body: TransactionUpdate, auth: Auth, db: DbSession) -> TransactionOut:
    return TransactionOut.model_validate(budget_service.update_transaction(db, auth.user.id, txn_id, body))


@router.delete("/transactions/{txn_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(txn_id: uuid.UUID, auth: Auth, db: DbSession) -> Response:
    budget_service.delete_transaction(db, auth.user.id, txn_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
