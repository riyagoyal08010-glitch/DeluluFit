"""Optional institution metadata: institutions, hostels, messes."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, uuid_pk


class Institution(CreatedAtMixin, Base):
    """Shared directory entry. Students may add one if theirs is missing."""

    __tablename__ = "institutions"
    __table_args__ = (
        UniqueConstraint("normalized_name"),
        CheckConstraint("length(btrim(name)) > 1", name="name_nonempty"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(160), nullable=False)
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(80))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))


class Hostel(CreatedAtMixin, Base):
    __tablename__ = "hostels"
    __table_args__ = (
        UniqueConstraint("institution_id", "normalized_name"),
        # Target of composite FKs that prove a hostel belongs to an institution.
        UniqueConstraint("id", "institution_id"),
        CheckConstraint("length(btrim(name)) > 0", name="name_nonempty"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    institution_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("institutions.id", ondelete="RESTRICT"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))


class Mess(CreatedAtMixin, Base):
    """A dining facility as described by a student. Owned by that student."""

    __tablename__ = "messes"
    __table_args__ = (
        UniqueConstraint("id", "user_id"),
        UniqueConstraint("user_id", "name"),
        CheckConstraint("length(btrim(name)) > 0", name="name_nonempty"),
        CheckConstraint("hostel_id IS NULL OR institution_id IS NOT NULL", name="hostel_requires_institution"),
        ForeignKeyConstraint(["hostel_id", "institution_id"], ["hostels.id", "hostels.institution_id"],
                             name="fk_messes_hostel_institution"),
        Index("ix_messes_institution_id", "institution_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    institution_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("institutions.id", ondelete="RESTRICT"))
    hostel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
