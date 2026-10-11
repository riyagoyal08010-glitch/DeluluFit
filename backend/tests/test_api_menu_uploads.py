"""Menu upload milestone: authentication, ownership, mess links, input validation and storage safety.

Complements test_api_menus.py (which covers the upload pipeline, review and extraction) and reuses
its helpers, including the fixture that empties the shared upload folder around every test.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import models as m
from app.services import storage
from tests.api_helpers import error_code, register
from tests.test_api_menus import TODAY, _empty_storage, count, image_bytes, stored_files, upload  # noqa: F401


def test_unauthenticated_upload_retrieve_and_delete_are_rejected(make_client: Callable[[], TestClient],
                                                                  db: Session) -> None:
    owner, anon = register(make_client()), make_client()
    mid = upload(owner, image_bytes()).json()["id"]

    res = anon.post("/api/v1/menus", data={"menu_date": TODAY.isoformat()},
                    files={"image": ("menu.jpg", image_bytes(size=(30, 30)), "image/jpeg")})
    assert res.status_code == 401 and error_code(res) == "not_authenticated"
    for res in (anon.get("/api/v1/menus"), anon.get(f"/api/v1/menus/{mid}"),
                anon.get(f"/api/v1/menus/{mid}/image"), anon.delete(f"/api/v1/menus/{mid}")):
        assert res.status_code == 401, res.text
    assert count(db, m.MessMenu) == 1 and count(db, m.MenuUpload) == 1 and len(stored_files()) == 1


def test_list_contains_only_the_current_students_menus(make_client: Callable[[], TestClient]) -> None:
    alice, bob = register(make_client()), register(make_client())
    mine = {upload(alice, None).json()["id"], upload(alice, image_bytes()).json()["id"]}
    theirs = {upload(bob, None).json()["id"]}

    listing = alice.get("/api/v1/menus").json()
    assert listing["total"] == 2 and {i["id"] for i in listing["items"]} == mine
    listing = bob.get("/api/v1/menus").json()
    assert listing["total"] == 1 and {i["id"] for i in listing["items"]} == theirs
    # Exposed fields never include where or how the file is stored.
    assert all("storage_key" not in i and "path" not in i for i in listing["items"])


def test_successful_retrieval_returns_the_menu_without_storage_details(client: TestClient) -> None:
    user = register(client)
    created = upload(user, image_bytes(size=(80, 60)), meal_type="dinner").json()
    res = user.get(f"/api/v1/menus/{created['id']}")
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == created["id"] and body["menu_date"] == TODAY.isoformat()
    assert body["meal_type_hint"] == "dinner" and body["mess_id"] is None and body["has_image"] is True
    assert body["image"] == {"width": 80, "height": 60, "size_bytes": body["image"]["size_bytes"]}
    assert "menus/" not in res.text and "storage" not in res.text


@pytest.mark.parametrize("form", [
    {"menu_date": TODAY.isoformat(), "meal_type": "brunch"},
    {"menu_date": "2026-02-30"},
    {"menu_date": "yesterday"},
    {},
    {"menu_date": TODAY.isoformat(), "mess_id": "not-a-uuid"},
])
def test_invalid_date_meal_period_and_mess_are_rejected(client: TestClient, db: Session,
                                                        form: dict[str, str]) -> None:
    user = register(client)
    res = user.client.post("/api/v1/menus", data=form, headers={"X-CSRF-Token": user.csrf},
                           files={"image": ("menu.jpg", image_bytes(), "image/jpeg")})
    assert res.status_code == 422 and error_code(res) == "validation_failed", res.text
    assert count(db, m.MessMenu) == 0 and stored_files() == []


def test_menu_can_be_linked_only_to_the_students_own_mess(make_client: Callable[[], TestClient],
                                                           db: Session) -> None:
    alice, bob = register(make_client()), register(make_client())
    own = alice.post("/api/v1/messes", json={"name": "North Mess"}).json()["id"]
    foreign = bob.post("/api/v1/messes", json={"name": "South Mess"}).json()["id"]

    def post(user, mess_id: str) -> object:  # type: ignore[no-untyped-def]
        return user.client.post("/api/v1/menus", data={"menu_date": TODAY.isoformat(), "mess_id": mess_id},
                                files={"image": ("menu.jpg", image_bytes(), "image/jpeg")},
                                headers={"X-CSRF-Token": user.csrf})

    for mess_id in (foreign, str(uuid.uuid4())):
        res = post(alice, mess_id)
        assert res.status_code == 422 and error_code(res) == "mess_unavailable", res.text  # type: ignore[attr-defined]
    # Refused before anything was stored.
    assert count(db, m.MessMenu) == 0 and count(db, m.MenuUpload) == 0 and stored_files() == []

    res = post(alice, own)
    assert res.status_code == 201, res.text  # type: ignore[attr-defined]
    assert res.json()["mess_id"] == own  # type: ignore[attr-defined]
    assert alice.get("/api/v1/menus").json()["items"][0]["mess_id"] == own


def test_failed_file_cleanup_still_deletes_the_menu(client: TestClient, db: Session,
                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    user = register(client)
    mid = upload(user, image_bytes()).json()["id"]

    def refuse(self: storage.LocalStorage, key: str) -> None:
        raise PermissionError("simulated storage failure")

    monkeypatch.setattr(storage.LocalStorage, "delete", refuse)
    assert user.delete(f"/api/v1/menus/{mid}").status_code == 204
    # The record is gone and the photo can no longer be reached; the orphaned private file is logged.
    assert count(db, m.MessMenu) == 0 and count(db, m.MenuUpload) == 0
    assert user.get(f"/api/v1/menus/{mid}/image").status_code == 404
    assert len(stored_files()) == 1


def test_deleting_one_menu_leaves_other_menus_and_files_alone(make_client: Callable[[], TestClient],
                                                              db: Session) -> None:
    alice, bob = register(make_client()), register(make_client())
    keep_mine = upload(alice, image_bytes(size=(40, 40))).json()["id"]
    gone = upload(alice, image_bytes(size=(41, 40))).json()["id"]
    upload(bob, image_bytes(size=(42, 40)))
    assert len(stored_files()) == 3

    assert alice.delete(f"/api/v1/menus/{gone}").status_code == 204
    assert len(stored_files()) == 2 and count(db, m.MenuUpload) == 2
    assert alice.get(f"/api/v1/menus/{keep_mine}/image").status_code == 200
    assert bob.get("/api/v1/menus").json()["total"] == 1


@pytest.mark.parametrize("key", ["../outside", "menus/../../outside", "/etc/passwd", "menus\\..\\x",
                                 "menus/a b", "short", "MENUS/UPPER/case1"])
def test_storage_refuses_keys_that_could_escape_its_folder(tmp_path: Path, key: str) -> None:
    store = storage.LocalStorage(tmp_path / "root")
    for op in (lambda: store.put(key, b"x", "image/jpeg"), lambda: store.get(key), lambda: store.delete(key)):
        with pytest.raises(ValueError):
            op()
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == []
