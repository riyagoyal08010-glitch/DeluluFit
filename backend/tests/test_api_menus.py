"""Mess menus: secure upload, private images, extraction jobs, review, confirmation, deletion,
suggestions and menu-linked meal logging.

The extraction provider here is a test double passed straight to the job runner; production code
has no fake provider. A real provider integration is not exercised by this suite.
"""

from __future__ import annotations

import io
import uuid
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import models as m
from app.db.session import SessionLocal
from app.services import menu_service
from app.services.extraction import ExtractionError, ExtractionResult, parse_result
from app.services.nutrition.seed import load_seed, read_seed_file
from tests.api_helpers import ApiUser, error_code, register

TODAY = date.today()
DATA = read_seed_file()


# --- helpers ----------------------------------------------------------------------------------

def image_bytes(fmt: str = "JPEG", size: tuple[int, int] = (64, 48), *, gps: bool = False) -> bytes:
    img = Image.new("RGB", size, (200, 120, 40))
    out = io.BytesIO()
    if gps:
        exif = Image.Exif()
        exif[0x010F] = "PhoneMaker"          # camera make
        exif[0x8825] = {1: "N", 2: (12.0, 58.0, 30.0), 3: "E", 4: (77.0, 35.0, 10.0)}  # GPS IFD
        img.save(out, format=fmt, exif=exif.tobytes())
    else:
        img.save(out, format=fmt)
    return out.getvalue()


def upload(user: ApiUser, data: bytes | None = None, *, name: str = "menu.jpg", menu_date: date = TODAY,
           meal_type: str | None = None, content_type: str = "image/jpeg") -> Any:
    form: dict[str, str] = {"menu_date": menu_date.isoformat()}
    if meal_type:
        form["meal_type"] = meal_type
    files = {"image": (name, data, content_type)} if data is not None else None
    return user.client.post("/api/v1/menus", data=form, files=files, headers={"X-CSRF-Token": user.csrf})


def stored_files() -> list[Path]:
    return [p for p in Path(get_settings().local_storage_dir).rglob("*") if p.is_file() and p.name != ".probe"]


def count(db: Session, model: type) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model)) or 0


class FakeProvider:
    """Test double: returns a fixed result or raises a fixed error."""

    name = "test"
    model = None

    def __init__(self, outcome: ExtractionResult | ExtractionError) -> None:
        self.outcome = outcome
        self.calls: list[tuple[str, str | None]] = []

    def extract(self, image: bytes, content_type: str, *, meal_hint: str | None) -> ExtractionResult:
        self.calls.append((content_type, meal_hint))
        assert image[:2] == b"\xff\xd8"  # the worker reads the stored, normalized JPEG
        if isinstance(self.outcome, ExtractionError):
            raise self.outcome
        return self.outcome


RESULT = parse_result({
    "is_menu": True, "menu_date": TODAY.isoformat(),
    "sections": [
        {"heading": "LUNCH", "meal_type": "lunch", "items": [
            {"name": "Paneer", "serving_note": "1 bowl", "confidence": 0.92},
            {"name": "Jeera aloo", "serving_note": None, "confidence": 0.61}]},
        {"heading": "Dinner", "meal_type": "dinner", "items": [
            {"name": "Dal", "serving_note": None, "confidence": None}]},
        {"heading": "Empty", "meal_type": None, "items": []},
    ]})


@pytest.fixture(autouse=True)
def _empty_storage() -> Iterator[None]:
    """The suite shares one temporary upload folder; start every test with it empty."""
    import shutil

    root = Path(get_settings().local_storage_dir)
    shutil.rmtree(root / "menus", ignore_errors=True)
    yield
    shutil.rmtree(root / "menus", ignore_errors=True)


@pytest.fixture
def foods(db: Session) -> dict[str, uuid.UUID]:
    load_seed(db, DATA)
    db.commit()
    return {name: fid for fid, name in db.execute(select(m.Food.id, m.Food.canonical_name))}


@pytest.fixture
def extraction_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    settings = get_settings()
    monkeypatch.setattr(settings, "extraction_provider", "anthropic")
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-not-used")
    yield


def run_job(provider: FakeProvider) -> bool:
    return menu_service.run_next_job(SessionLocal, provider)


def make_due(db: Session) -> None:
    db.execute(update(m.MenuExtractionJob).values(available_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    db.commit()


def draft_body(menu: dict[str, Any], items: list[dict[str, Any]], menu_date: date | None = None) -> dict[str, Any]:
    return {"menu_date": (menu_date or date.fromisoformat(menu["menu_date"])).isoformat(), "items": items}


def keep(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"id": i["id"], "name": i["name"], "meal_type": i["meal_type"],
             "food_id": i["food"]["id"] if i["food"] else None, "price": i["price"]} for i in items]


# --- upload validation ------------------------------------------------------------------------

def test_upload_stores_a_normalized_private_copy_without_metadata(client: TestClient, db: Session) -> None:
    user = register(client)
    original = image_bytes(gps=True)
    assert Image.open(io.BytesIO(original)).getexif().get(0x8825)  # the fixture really has GPS data

    res = upload(user, original, name="../../etc/passwd my menu.jpg", meal_type="lunch")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "needs_review"          # extraction is disabled in tests
    assert body["extraction"]["available"] is False
    assert body["has_image"] is True and body["meal_type_hint"] == "lunch"
    assert body["draft"]["items"] == []

    row = db.scalar(select(m.MenuUpload))
    assert row.original_filename is None                 # the client's name is not kept
    assert "passwd" not in row.storage_key and ".." not in row.storage_key
    assert row.storage_key.startswith(f"menus/{uuid.UUID(user.id).hex}/")
    assert row.content_type == "image/jpeg"

    files = stored_files()
    assert len(files) == 1
    assert Path(get_settings().local_storage_dir).resolve() in files[0].resolve().parents
    stored = Image.open(files[0])
    assert stored.format == "JPEG"
    assert dict(stored.getexif()) == {}                  # EXIF, including GPS, is gone
    assert files[0].read_bytes() != original


@pytest.mark.parametrize("fmt,ctype", [("PNG", "image/png"), ("WEBP", "image/webp")])
def test_png_and_webp_are_accepted_and_stored_as_jpeg(client: TestClient, fmt: str, ctype: str) -> None:
    user = register(client)
    res = upload(user, image_bytes(fmt), name=f"menu.{fmt.lower()}", content_type=ctype)
    assert res.status_code == 201, res.text
    assert Image.open(stored_files()[0]).format == "JPEG"


@pytest.mark.parametrize("data,name,ctype,code", [
    (b"just some text, not an image", "menu.jpg", "image/jpeg", "invalid_image"),
    (b"<?php system($_GET['c']); ?>", "menu.php.jpg", "image/jpeg", "invalid_image"),
    (image_bytes("GIF"), "menu.gif", "image/gif", "unsupported_image_type"),
    (image_bytes("BMP"), "menu.jpg", "image/jpeg", "unsupported_image_type"),  # content decides, not the name
    (image_bytes()[:200], "menu.jpg", "image/jpeg", "invalid_image"),          # truncated
])
def test_rejects_files_that_are_not_supported_images(client: TestClient, db: Session, data: bytes, name: str,
                                                     ctype: str, code: str) -> None:
    user = register(client)
    res = upload(user, data, name=name, content_type=ctype)
    assert res.status_code == 422 and error_code(res) == code, res.text
    assert count(db, m.MessMenu) == 0 and count(db, m.MenuUpload) == 0 and stored_files() == []


def test_rejects_empty_oversized_and_too_many_pixels(client: TestClient, db: Session,
                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    user = register(client)
    assert error_code(upload(user, b"")) == "upload_empty"
    settings = get_settings()
    monkeypatch.setattr(settings, "max_upload_bytes", 2000)
    big = image_bytes(size=(400, 400)) + b"\0" * 3000
    res = upload(user, big)
    assert res.status_code == 413 and error_code(res) == "upload_too_large"
    monkeypatch.setattr(settings, "max_upload_bytes", 8 * 1024 * 1024)
    monkeypatch.setattr(settings, "max_image_pixels", 100)
    res = upload(user, image_bytes(size=(20, 20)))
    assert res.status_code == 422 and error_code(res) == "image_too_large"
    assert count(db, m.MessMenu) == 0 and stored_files() == []


def test_menu_date_must_be_sensible(client: TestClient) -> None:
    user = register(client)
    res = upload(user, None, menu_date=TODAY + timedelta(days=200))
    assert res.status_code == 422 and error_code(res) == "menu_date_out_of_range"


def test_same_photo_twice_points_to_the_existing_menu(client: TestClient, db: Session) -> None:
    user = register(client)
    data = image_bytes()
    first = upload(user, data).json()
    res = upload(user, data)
    assert res.status_code == 409 and error_code(res) == "duplicate_upload"
    assert res.json()["error"]["details"]["menu_id"] == first["id"]
    assert count(db, m.MenuUpload) == 1 and len(stored_files()) == 1
    # Another student may upload the same photo.
    other = register(TestClient(client.app))
    assert upload(other, data).status_code == 201


def test_failed_database_write_leaves_no_orphaned_file(client: TestClient, db: Session,
                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    user = register(client)

    def boom(_: date) -> str:
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(menu_service, "_title", boom)
    with pytest.raises(RuntimeError):
        upload(user, image_bytes())
    assert stored_files() == [] and count(db, m.MenuUpload) == 0


def test_upload_rate_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "upload_rate_limit_per_hour", 2)
    user = register(client)
    assert upload(user, image_bytes(size=(10, 10))).status_code == 201
    assert upload(user, image_bytes(size=(11, 10))).status_code == 201
    assert upload(user, image_bytes(size=(12, 10))).status_code == 429


# --- authentication and ownership -------------------------------------------------------------

def test_requires_a_session_and_csrf(client: TestClient) -> None:
    anon = client.get("/api/v1/menus")
    assert anon.status_code == 401
    user = register(client)
    res = client.post("/api/v1/menus", data={"menu_date": TODAY.isoformat()})  # no CSRF header
    assert res.status_code == 403 and error_code(res) == "csrf_failed"
    menu = upload(user).json()
    client.cookies.clear()
    assert client.get(f"/api/v1/menus/{menu['id']}/image").status_code == 401


def test_other_students_cannot_see_or_change_a_menu(make_client: Callable[[], TestClient], db: Session) -> None:
    owner, other = register(make_client()), register(make_client())
    menu = upload(owner, image_bytes()).json()
    mid = menu["id"]
    attempts = [
        other.get(f"/api/v1/menus/{mid}"), other.get(f"/api/v1/menus/{mid}/image"),
        other.get(f"/api/v1/menus/{mid}/suggestions"),
        other.put(f"/api/v1/menus/{mid}/draft", json=draft_body(menu, [{"name": "X", "meal_type": "lunch"}])),
        other.post(f"/api/v1/menus/{mid}/confirm"), other.post(f"/api/v1/menus/{mid}/revise"),
        other.post(f"/api/v1/menus/{mid}/extraction"), other.delete(f"/api/v1/menus/{mid}"),
    ]
    for res in attempts:
        assert res.status_code in (404, 503), res.text   # 503 only: extraction is off before ownership
        if res.status_code == 404:
            assert error_code(res) == "not_found"
    assert other.get("/api/v1/menus").json()["total"] == 0
    assert owner.get(f"/api/v1/menus/{mid}").status_code == 200
    assert count(db, m.MessMenu) == 1 and len(stored_files()) == 1


def test_owner_gets_the_image_privately(client: TestClient) -> None:
    user = register(client)
    menu = upload(user, image_bytes()).json()
    res = user.get(f"/api/v1/menus/{menu['id']}/image")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"
    assert "no-store" in res.headers["cache-control"] and "private" in res.headers["cache-control"]
    assert res.headers["x-content-type-options"] == "nosniff"
    assert Image.open(io.BytesIO(res.content)).format == "JPEG"
    # A typed-in menu has no image.
    typed = upload(user, None).json()
    assert error_code(user.get(f"/api/v1/menus/{typed['id']}/image")) == "no_image"


# --- review workflow --------------------------------------------------------------------------

def test_typed_menu_review_confirm_and_revise(client: TestClient, db: Session, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    menu = upload(user, None, meal_type="lunch").json()
    assert menu["has_image"] is False and menu["status"] == "needs_review"

    res = user.post(f"/api/v1/menus/{menu['id']}/confirm")
    assert res.status_code == 422 and error_code(res) == "menu_empty"

    res = user.put(f"/api/v1/menus/{menu['id']}/draft", json=draft_body(menu, [
        {"name": "  Paneer   butter masala ", "meal_type": "lunch", "food_id": str(foods["Paneer"])},
        {"name": "Dal", "meal_type": "lunch"},
        {"name": "Kheer", "meal_type": "dinner", "price": "20.00"},
    ]))
    assert res.status_code == 200, res.text
    items = res.json()["draft"]["items"]
    assert [i["name"] for i in items] == ["Paneer butter masala", "Dal", "Kheer"]
    assert all(i["source"] == "manual" and not i["is_user_corrected"] for i in items)
    assert items[0]["food"]["canonical_name"] == "Paneer" and items[1]["food"] is None
    assert items[2]["price"] == "20.00" and items[2]["meal_type"] == "dinner"

    # Edit one, remove one, keep one: ids are stable.
    edited = keep(items)
    edited[1]["name"] = "Dal tadka"
    del edited[2]
    res = user.put(f"/api/v1/menus/{menu['id']}/draft", json=draft_body(menu, edited))
    new_items = res.json()["draft"]["items"]
    assert [i["id"] for i in new_items] == [items[0]["id"], items[1]["id"]]
    assert new_items[1]["name"] == "Dal tadka"

    bad = user.put(f"/api/v1/menus/{menu['id']}/draft",
                   json=draft_body(menu, [{"id": str(uuid.uuid4()), "name": "X", "meal_type": "lunch"}]))
    assert bad.status_code == 422 and error_code(bad) == "unknown_item"

    confirmed = user.post(f"/api/v1/menus/{menu['id']}/confirm").json()
    assert confirmed["status"] == "confirmed" and confirmed["draft"] is None
    version_id = confirmed["confirmed"]["id"]
    again = user.post(f"/api/v1/menus/{menu['id']}/confirm")   # a repeated click
    assert again.status_code == 200 and again.json()["confirmed"]["id"] == version_id

    res = user.put(f"/api/v1/menus/{menu['id']}/draft", json=draft_body(menu, edited))
    assert res.status_code == 409 and error_code(res) == "no_draft"

    # Confirmed versions are immutable in the database itself.
    with pytest.raises(DBAPIError):
        db.execute(text("UPDATE menu_items SET display_name = 'Changed' WHERE id = :id"), {"id": items[0]["id"]})
        db.flush()
    db.rollback()

    revised = user.post(f"/api/v1/menus/{menu['id']}/revise").json()
    assert revised["status"] == "needs_review"
    assert revised["confirmed"]["id"] == version_id
    assert [i["name"] for i in revised["draft"]["items"]] == ["Paneer butter masala", "Dal tadka"]
    assert revised["draft"]["source"] == "revision"
    assert user.post(f"/api/v1/menus/{menu['id']}/revise").json()["draft"]["id"] == revised["draft"]["id"]

    listing = user.get("/api/v1/menus").json()
    assert listing["total"] == 1 and listing["items"][0]["has_draft"] and listing["items"][0]["has_confirmed"]


# --- extraction -------------------------------------------------------------------------------

def test_extraction_is_unavailable_without_a_provider(client: TestClient) -> None:
    user = register(client)
    menu = upload(user, image_bytes()).json()
    assert menu["extraction"] == {"available": False, "job": None, "can_start": False, "can_retry": False}
    res = user.post(f"/api/v1/menus/{menu['id']}/extraction")
    assert res.status_code == 503 and error_code(res) == "extraction_unavailable"


def test_extraction_adds_candidates_with_provenance(client: TestClient, extraction_on: None,
                                                    foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    menu = upload(user, image_bytes(), meal_type="lunch").json()
    assert menu["status"] == "processing" and menu["extraction"]["job"]["status"] == "queued"
    assert menu["draft"]["source"] == "extraction"

    # While the photo is being read, the draft can't be edited or confirmed.
    res = user.put(f"/api/v1/menus/{menu['id']}/draft", json=draft_body(menu, []))
    assert res.status_code == 409 and error_code(res) == "extraction_in_progress"
    assert error_code(user.post(f"/api/v1/menus/{menu['id']}/confirm")) == "extraction_in_progress"
    assert error_code(user.post(f"/api/v1/menus/{menu['id']}/extraction")) == "extraction_in_progress"

    provider = FakeProvider(RESULT)
    assert run_job(provider) is True
    assert provider.calls == [("image/jpeg", "lunch")]
    assert run_job(provider) is False            # nothing else queued; no duplicate processing

    body = user.get(f"/api/v1/menus/{menu['id']}").json()
    assert body["status"] == "needs_review"
    job = body["extraction"]["job"]
    assert job["status"] == "succeeded" and job["item_count"] == 3 and job["detected_date"] == TODAY.isoformat()
    items = body["draft"]["items"]
    assert [(i["name"], i["meal_type"]) for i in items] == [("Paneer", "lunch"), ("Jeera aloo", "lunch"),
                                                            ("Dal", "dinner")]
    assert all(i["source"] == "extraction" and not i["is_user_corrected"] for i in items)
    assert items[0]["serving_note"] == "1 bowl" and items[0]["section_heading"] == "LUNCH"
    assert items[0]["extraction_confidence"] == "0.920" and items[2]["extraction_confidence"] is None
    assert items[0]["food"]["id"] == str(foods["Paneer"])   # unambiguous name: linked
    assert items[1]["food"] is None                          # unknown dish: left for review

    # Correcting a name marks it user-corrected; a typed addition is manual.
    edited = keep(items)
    edited[1]["name"] = "Jeera aloo sabzi"
    edited.append({"name": "Curd", "meal_type": "lunch"})
    res = user.put(f"/api/v1/menus/{menu['id']}/draft", json=draft_body(menu, edited)).json()["draft"]["items"]
    by_name = {i["name"]: i for i in res}
    assert by_name["Jeera aloo sabzi"]["is_user_corrected"] and by_name["Jeera aloo sabzi"]["source"] == "extraction"
    assert not by_name["Paneer"]["is_user_corrected"]
    assert by_name["Curd"]["source"] == "manual"
    assert error_code(user.post(f"/api/v1/menus/{menu['id']}/extraction")) == "already_extracted"


def test_unreadable_photo_succeeds_with_no_dishes(client: TestClient, extraction_on: None) -> None:
    user = register(client)
    menu = upload(user, image_bytes()).json()
    run_job(FakeProvider(parse_result({"is_menu": False, "menu_date": None, "sections": []})))
    body = user.get(f"/api/v1/menus/{menu['id']}").json()
    assert body["status"] == "needs_review" and body["draft"]["items"] == []
    assert body["extraction"]["job"]["is_menu"] is False and body["extraction"]["job"]["item_count"] == 0


def test_malformed_provider_output_is_a_failure_not_an_empty_menu() -> None:
    for payload in ({"sections": "nope"}, {"is_menu": True, "sections": [{"items": [{"name": ""}]}]}, "text"):
        with pytest.raises(ExtractionError) as exc:
            parse_result(payload)
        assert exc.value.code == "invalid_response" and exc.value.retryable


def test_retryable_failures_back_off_then_fail_after_max_attempts(client: TestClient, db: Session,
                                                                  extraction_on: None) -> None:
    user = register(client)
    menu = upload(user, image_bytes()).json()
    provider = FakeProvider(ExtractionError("provider_timeout", "Reading the photo took too long.", retryable=True))
    attempts = get_settings().extraction_max_attempts
    assert run_job(provider)
    job = user.get(f"/api/v1/menus/{menu['id']}").json()["extraction"]["job"]
    assert job["status"] == "queued" and job["attempt_count"] == 1 and job["error_code"] == "provider_timeout"
    assert run_job(provider) is False          # backed off: not due yet
    for _ in range(attempts - 1):
        make_due(db)
        assert run_job(provider)
    body = user.get(f"/api/v1/menus/{menu['id']}").json()
    assert body["status"] == "failed"
    assert body["extraction"]["job"]["attempt_count"] == attempts
    assert body["extraction"]["can_retry"] is True
    assert len(provider.calls) == attempts

    # The student can still type the dishes in after a failure.
    res = user.put(f"/api/v1/menus/{menu['id']}/draft", json=draft_body(menu, [{"name": "Dal", "meal_type": "lunch"}]))
    assert res.status_code == 200


def test_permanent_failure_and_bounded_manual_retry(client: TestClient, db: Session, extraction_on: None) -> None:
    user = register(client)
    menu = upload(user, image_bytes()).json()
    declined = FakeProvider(ExtractionError("provider_declined", "Declined.", retryable=False))
    run_job(declined)
    body = user.get(f"/api/v1/menus/{menu['id']}").json()
    assert body["status"] == "failed" and body["extraction"]["job"]["error_code"] == "provider_declined"

    for n in range(menu_service.MAX_MANUAL_RETRIES):
        res = user.post(f"/api/v1/menus/{menu['id']}/extraction")
        assert res.status_code == 202 and res.json()["status"] == "processing", res.text
        # A double click while queued doesn't create a second run.
        assert error_code(user.post(f"/api/v1/menus/{menu['id']}/extraction")) == "extraction_in_progress"
        run_job(declined)
    res = user.post(f"/api/v1/menus/{menu['id']}/extraction")
    assert res.status_code == 409 and error_code(res) == "retry_limit"
    assert count(db, m.MenuExtractionJob) == 1

    # A retry that succeeds fills in the dishes.
    db.execute(update(m.MenuExtractionJob).values(metrics={}))
    db.commit()
    user.post(f"/api/v1/menus/{menu['id']}/extraction")
    run_job(FakeProvider(RESULT))
    assert len(user.get(f"/api/v1/menus/{menu['id']}").json()["draft"]["items"]) == 3


def test_result_for_a_deleted_menu_is_dropped(client: TestClient, db: Session, extraction_on: None,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    user = register(client)
    menu = upload(user, image_bytes()).json()

    class DeletesFirst(FakeProvider):
        def extract(self, image: bytes, content_type: str, *, meal_hint: str | None) -> ExtractionResult:
            assert user.delete(f"/api/v1/menus/{menu['id']}").status_code == 204
            return RESULT

    assert run_job(DeletesFirst(RESULT)) is True
    assert count(db, m.MenuItem) == 0 and count(db, m.MenuExtractionJob) == 0


# --- deletion ---------------------------------------------------------------------------------

def test_delete_removes_menu_image_and_jobs_but_keeps_logged_meals(client: TestClient, db: Session,
                                                                   foods: dict[str, uuid.UUID],
                                                                   extraction_on: None) -> None:
    user = register(client)
    menu = upload(user, image_bytes()).json()
    run_job(FakeProvider(RESULT))
    body = user.get(f"/api/v1/menus/{menu['id']}").json()
    user.post(f"/api/v1/menus/{menu['id']}/confirm")
    dish = user.get(f"/api/v1/menus/{menu['id']}").json()["confirmed"]["items"][0]
    meal = user.post("/api/v1/meals", json={
        "meal_type": "lunch", "consumed_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        "menu_meal_id": dish["meal_id"],
        "items": [{"food_id": dish["food"]["id"], "menu_item_id": dish["id"], "quantity": "150", "unit": "g"}]})
    assert meal.status_code == 201 and meal.json()["source"] == "mess_menu"
    assert body["draft"] is not None

    assert user.delete(f"/api/v1/menus/{menu['id']}").status_code == 204
    for model in (m.MessMenu, m.MenuVersion, m.MenuItem, m.MenuUpload, m.MenuExtractionJob):
        assert count(db, model) == 0, model
    assert stored_files() == []
    db.expire_all()
    log = db.scalar(select(m.MealLog))
    assert log is not None and log.source == "manual" and log.menu_meal_id is None
    assert db.scalar(select(m.ConsumedItem.menu_item_id)) is None
    assert user.get(f"/api/v1/meals/{meal.json()['id']}").status_code == 200
    assert user.delete(f"/api/v1/menus/{menu['id']}").status_code == 404


def test_account_deletion_removes_menu_files(client: TestClient) -> None:
    user = register(client)
    upload(user, image_bytes())
    assert len(stored_files()) == 1
    res = user.post("/api/v1/auth/delete-account", json={"password": "correct horse battery", "confirmation": "DELETE"})
    assert res.status_code == 204
    assert stored_files() == []


# --- suggestions ------------------------------------------------------------------------------

def confirmed_menu(user: ApiUser, foods: dict[str, uuid.UUID], dishes: list[tuple[str, str, str | None]]) -> str:
    menu = upload(user, None).json()
    items = [{"name": n, "meal_type": mt, **({"food_id": str(foods[f])} if f else {})} for n, mt, f in dishes]
    assert user.put(f"/api/v1/menus/{menu['id']}/draft", json=draft_body(menu, items)).status_code == 200
    assert user.post(f"/api/v1/menus/{menu['id']}/confirm").status_code == 200
    return str(menu["id"])


DISHES = [("Rajma chawal", "lunch", "Kidney beans (cooked, with fat)"), ("Paneer butter masala", "lunch", "Paneer"),
          ("Chicken curry", "lunch", "Chicken curry"), ("Jeera aloo", "lunch", None),
          ("Karela fry", "dinner", None)]


def test_suggestions_follow_recorded_preferences_pattern_and_allergies(client: TestClient,
                                                                       foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    user.put("/api/v1/profile", json={"display_name": "A", "dietary_pattern": "vegetarian"})
    user.put("/api/v1/profile/preferences", json={"items": [{"label": "Rajma", "preference": "like"},
                                                            {"label": "karela", "preference": "avoid"}]})
    user.put("/api/v1/profile/allergies", json={"items": [{"allergen": "milk", "severity": "severe"}]})
    mid = confirmed_menu(user, foods, DISHES)
    meals_before = user.get("/api/v1/meals").json()["total"]

    res = user.get(f"/api/v1/menus/{mid}/suggestions").json()
    assert res["confirmed"] and res["rule_version"] == "menu-rules-1"
    assert res["personalization"]["personalized"] is True
    assert "milk" in res["allergy_notice"]
    d = {x["name"]: x for x in res["dishes"]}
    order = [x["name"] for x in res["dishes"]]

    assert d["Rajma chawal"]["group"] == "suggested" and d["Rajma chawal"]["score"] == 3
    assert {r["code"] for r in d["Rajma chawal"]["reasons"]} == {"likes", "fits_pattern"}
    assert order[0] == "Rajma chawal"
    # Allergen listed for the linked reference food: never hidden, flagged "check first".
    assert d["Paneer butter masala"]["group"] == "check_first"
    assert "allergen_listed" in {c["code"] for c in d["Paneer butter masala"]["cautions"]}
    assert d["Chicken curry"]["group"] == "check_first"
    assert "pattern_conflict" in {c["code"] for c in d["Chicken curry"]["cautions"]}
    assert d["Karela fry"]["group"] == "check_first"
    # Unknown dish: no penalty, but no claim of safety either.
    jeera = d["Jeera aloo"]
    assert jeera["group"] == "available" and jeera["score"] == 0
    assert {c["code"] for c in jeera["cautions"]} == {"diet_unknown", "allergy_unknown"}
    assert jeera["nutrition"] is None and jeera["price"] is None and jeera["food"] is None
    assert len(res["dishes"]) == 5
    # Nutrition is reference data per 100 g, with statuses; nothing invented for unknown dishes.
    rajma = d["Rajma chawal"]["nutrition"]
    assert rajma["reference_mass_g"] == "100.00"
    assert rajma["nutrients"]["energy_kcal"]["status"] == "reported" or rajma["nutrients"]["energy_kcal"]["display"]

    lunch_only = user.get(f"/api/v1/menus/{mid}/suggestions?meal_type=dinner").json()
    assert [x["name"] for x in lunch_only["dishes"]] == ["Karela fry"]
    assert set(lunch_only["meal_types"]) == {"lunch", "dinner"}
    # Viewing suggestions never logs a meal.
    assert user.get("/api/v1/meals").json()["total"] == meals_before


def test_suggestions_without_personal_data_say_so(client: TestClient, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    mid = confirmed_menu(user, foods, DISHES[:2])
    res = user.get(f"/api/v1/menus/{mid}/suggestions").json()
    assert res["personalization"]["personalized"] is False
    assert "menu order" in res["personalization"]["message"]
    assert res["allergy_notice"] is None
    assert [x["group"] for x in res["dishes"]] == ["available", "available"]
    assert [x["name"] for x in res["dishes"]] == ["Rajma chawal", "Paneer butter masala"]
    assert res["budget"]["has_budget"] is False


def test_suggestions_need_a_confirmed_menu(client: TestClient) -> None:
    user = register(client)
    menu = upload(user, image_bytes()).json()
    res = user.get(f"/api/v1/menus/{menu['id']}/suggestions").json()
    assert res["confirmed"] is False and res["dishes"] == [] and res["status"] == "needs_review"


# --- logging from a menu ----------------------------------------------------------------------

def test_meal_logging_from_a_menu_is_explicit_owned_and_idempotent(make_client: Callable[[], TestClient],
                                                                   foods: dict[str, uuid.UUID]) -> None:
    user, other = register(make_client()), register(make_client())
    mid = confirmed_menu(user, foods, DISHES)
    dishes = user.get(f"/api/v1/menus/{mid}").json()["confirmed"]["items"]
    lunch = [x for x in dishes if x["meal_type"] == "lunch"]
    dinner = [x for x in dishes if x["meal_type"] == "dinner"]
    when = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    key = str(uuid.uuid4())
    body = {"meal_type": "lunch", "consumed_at": when, "idempotency_key": key, "menu_meal_id": lunch[0]["meal_id"],
            "items": [{"food_id": lunch[0]["food"]["id"], "menu_item_id": lunch[0]["id"], "quantity": "200",
                       "unit": "g"},
                      {"display_name": "Jeera aloo", "menu_item_id": lunch[3]["id"], "quantity": "1",
                       "unit": "serving"}]}
    first = user.post("/api/v1/meals", json=body)
    assert first.status_code == 201, first.text
    assert first.json()["source"] == "mess_menu"
    again = user.post("/api/v1/meals", json=body)               # repeated click / retry
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    assert user.get("/api/v1/meals").json()["total"] == 1

    # Someone else's menu, a dish from another meal, and a dish without its meal are refused.
    foreign = other.post("/api/v1/meals", json={**body, "idempotency_key": str(uuid.uuid4())})
    assert foreign.status_code == 422 and error_code(foreign) == "menu_unavailable"
    wrong = user.post("/api/v1/meals", json={**body, "idempotency_key": str(uuid.uuid4()),
                                             "items": [{"display_name": "Karela fry", "menu_item_id": dinner[0]["id"],
                                                        "quantity": "1", "unit": "serving"}]})
    assert wrong.status_code == 422 and error_code(wrong) == "menu_item_mismatch"
    orphan = user.post("/api/v1/meals", json={"meal_type": "lunch", "consumed_at": when,
                                              "items": [{"display_name": "X", "menu_item_id": lunch[0]["id"],
                                                         "quantity": "1", "unit": "serving"}]})
    assert orphan.status_code == 422
    manual = user.post("/api/v1/meals", json={"meal_type": "lunch", "consumed_at": when, "items": []}).json()
    add = user.post(f"/api/v1/meals/{manual['id']}/items", json={"display_name": "X", "menu_item_id": lunch[0]["id"],
                                                                "quantity": "1", "unit": "serving"})
    assert add.status_code == 422 and error_code(add) == "menu_item_mismatch"


def test_unconfirmed_menu_meal_cannot_be_logged(client: TestClient, foods: dict[str, uuid.UUID]) -> None:
    user = register(client)
    mid = confirmed_menu(user, foods, DISHES[:1])
    draft = user.post(f"/api/v1/menus/{mid}/revise").json()["draft"]["items"][0]
    res = user.post("/api/v1/meals", json={"meal_type": "lunch",
                                           "consumed_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
                                           "menu_meal_id": draft["meal_id"], "items": []})
    assert res.status_code == 422 and error_code(res) == "menu_unavailable"
