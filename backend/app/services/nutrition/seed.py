"""Validate and load the curated reference dataset (data/foods_usda_fndds.json).

Loading is idempotent and history-preserving:
- foods are matched by normalized canonical name and created when missing;
  descriptive fields (category, diet type, allergens, notes) are updated;
- aliases are added when missing; an alias already owned by another food is an error;
- a nutrient profile that differs from the current one is inserted as a new
  version and the old row is marked not current (it is never edited);
- servings are added by label; an existing label with a different mass is
  reported, not changed. Portions whose label starts with "Guideline amount"
  are skipped: in FNDDS they describe an amount of the food added to something
  else (e.g. milk per fl oz of coffee), not a portion of the food itself.

Nothing is committed here; the caller owns the transaction.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import enums
from app.db.models import Food, FoodAlias, FoodNutrient, FoodServing
from app.services.nutrition.calculator import NUTRIENTS
from app.services.nutrition.normalize import normalize_food_name

DEFAULT_SEED_PATH = Path(__file__).resolve().parents[3] / "data" / "foods_usda_fndds.json"
ALIAS_CONFIDENCE = ("HIGH", "MEDIUM", "LOW")
EXCLUDED_PORTION_PREFIXES = ("guideline amount",)
_FDC_REF = re.compile(r"^FDC ID ([0-9]+)(?![0-9])")


class SeedDataError(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems[:10]) + (" ..." if len(problems) > 10 else ""))
        self.problems = problems


@dataclass
class SeedReport:
    foods_created: int = 0
    foods_updated: int = 0
    aliases_created: int = 0
    nutrient_versions_created: int = 0
    servings_created: int = 0
    servings_skipped: int = 0
    serving_conflicts: list[str] = field(default_factory=list)


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        d = Decimal(str(value))
    except InvalidOperation:
        raise ValueError(f"not a number: {value!r}") from None
    if not d.is_finite():
        raise ValueError(f"not a finite number: {value!r}")
    return d


def _fits_numeric_8_2(d: Decimal) -> bool:
    """food_nutrients / food_servings columns are NUMERIC(8, 2); anything else would be rounded on insert."""
    return d == d.quantize(Decimal("0.01")) and abs(d) < Decimal("1000000")


def is_usable_portion(label: str) -> bool:
    return not label.strip().lower().startswith(EXCLUDED_PORTION_PREFIXES)


def validate_seed(data: dict[str, Any]) -> None:
    """Raise SeedDataError listing every problem found; returns None when the data is usable."""
    problems: list[str] = []
    for key in ("dataset", "dataset_version", "license", "url", "foods"):
        if not data.get(key):
            problems.append(f"missing top-level '{key}'")
    names: dict[str, str] = {}
    alias_owner: dict[str, str] = {}
    for i, food in enumerate(data.get("foods") or []):
        name = str(food.get("canonical_name") or "").strip()
        where = f"food[{i}] {name or '?'}"
        norm = normalize_food_name(name)
        if not norm:
            problems.append(f"{where}: canonical_name is empty")
            continue
        if norm in names:
            problems.append(f"{where}: duplicate canonical name of {names[norm]}")
        names[norm] = name
        if food.get("diet_type") not in enums.DIET_TYPES:
            problems.append(f"{where}: invalid diet_type {food.get('diet_type')!r}")
        bad_allergens = set(food.get("known_allergens") or []) - set(enums.ALLERGENS)
        if bad_allergens:
            problems.append(f"{where}: unknown allergens {sorted(bad_allergens)}")
        for a in food.get("aliases") or []:
            key = normalize_food_name(str(a.get("alias") or ""))
            if not key:
                problems.append(f"{where}: empty alias")
            elif key in alias_owner and alias_owner[key] != norm:
                problems.append(f"{where}: alias {key!r} also belongs to {alias_owner[key]!r}")
            alias_owner[key] = norm
            if a.get("confidence") not in ALIAS_CONFIDENCE:
                problems.append(f"{where}: alias {key!r} has invalid confidence {a.get('confidence')!r}")
        n = food.get("nutrients") or {}
        try:
            ref = _decimal(n.get("reference_mass_g"))
            if ref is None or ref <= 0:
                problems.append(f"{where}: reference_mass_g must be positive")
            coverage = _coverage(n)
            unknown_cov = coverage - set(NUTRIENTS)
            if unknown_cov:
                problems.append(f"{where}: unknown nutrients in source_nutrients {sorted(unknown_cov)}")
            for nutrient in NUTRIENTS:
                v = _decimal(n.get(nutrient))
                if v is not None and nutrient not in coverage:
                    problems.append(f"{where}: {nutrient} has a value but is not in source_nutrients")
                if v is not None and v < 0:
                    problems.append(f"{where}: {nutrient} is negative")
                if v is not None and not _fits_numeric_8_2(v):
                    problems.append(f"{where}: {nutrient} needs more than two decimal places")
        except ValueError as exc:
            problems.append(f"{where}: {exc}")
        for prov in ("source_name", "source_reference", "dataset_version"):
            if not str(n.get(prov) or "").strip():
                problems.append(f"{where}: nutrient provenance '{prov}' is missing")
        for s in food.get("servings") or []:
            label = str(s.get("label") or "").strip()
            try:
                mass = _decimal(s.get("mass_g"))
            except ValueError as exc:
                problems.append(f"{where}: serving {label!r}: {exc}")
                continue
            if not label or len(label) > 80:
                problems.append(f"{where}: serving label must be 1-80 characters")
            if mass is None or mass <= 0:
                problems.append(f"{where}: serving {label!r} must have a positive mass")
            elif not _fits_numeric_8_2(mass):
                problems.append(f"{where}: serving {label!r} mass needs more than two decimal places")
            if not str(s.get("source_name") or "").strip():
                problems.append(f"{where}: serving {label!r} has no source")
    for key, owner in alias_owner.items():
        if key in names and key != owner:
            problems.append(f"alias {key!r} of {owner!r} is another food's canonical name")
    if problems:
        raise SeedDataError(problems)


def _coverage(n: dict[str, Any]) -> set[str]:
    """Nutrients the source provides: an explicit list, else the nutrient keys present.

    A key present with null means "provided by the source, unknown for this
    food"; an absent key means the source does not provide that nutrient.
    """
    if "source_nutrients" in n:
        return set(n["source_nutrients"] or [])
    return {k for k in NUTRIENTS if k in n}


def _source_food_id(n: dict[str, Any]) -> str | None:
    if n.get("source_food_id"):
        return str(n["source_food_id"])
    match = _FDC_REF.match(str(n.get("source_reference") or ""))
    return match.group(1) if match else None


def _nutrient_fields(n: dict[str, Any]) -> dict[str, Any]:
    return {"reference_mass_g": _decimal(n["reference_mass_g"]),
            **{k: _decimal(n.get(k)) for k in NUTRIENTS},
            "source_nutrients": sorted(_coverage(n)),
            "source_name": n["source_name"], "source_reference": n.get("source_reference"),
            "source_food_id": _source_food_id(n), "dataset_version": n.get("dataset_version")}


def _same_profile(row: FoodNutrient, fields: dict[str, Any]) -> bool:
    return all((sorted(getattr(row, k)) if k == "source_nutrients" else getattr(row, k)) == v
               for k, v in fields.items())


def load_seed(db: Session, data: dict[str, Any]) -> SeedReport:
    validate_seed(data)
    report = SeedReport()
    for item in data["foods"]:
        name = " ".join(item["canonical_name"].split())
        norm = normalize_food_name(name)
        food = db.scalar(select(Food).where(Food.normalized_name == norm))
        desc = {"category": item.get("category"), "diet_type": item["diet_type"],
                "known_allergens": list(item.get("known_allergens") or []),
                "preparation_notes": item.get("preparation_notes")}
        if food is None:
            food = Food(canonical_name=name, normalized_name=norm, **desc)
            db.add(food)
            db.flush()
            report.foods_created += 1
        elif any(getattr(food, k) != v for k, v in desc.items()):
            for k, v in desc.items():
                setattr(food, k, v)
            report.foods_updated += 1

        for a in item.get("aliases") or []:
            key = normalize_food_name(a["alias"])
            existing = db.scalar(select(FoodAlias).where(FoodAlias.normalized_alias == key))
            if existing is None:
                db.add(FoodAlias(food_id=food.id, alias=" ".join(a["alias"].split()), normalized_alias=key,
                                 confidence=a["confidence"]))
                report.aliases_created += 1
            elif existing.food_id != food.id:
                raise SeedDataError([f"alias {key!r} already belongs to another food in the database"])

        fields = _nutrient_fields(item["nutrients"])
        current = db.scalar(select(FoodNutrient).where(FoodNutrient.food_id == food.id,
                                                       FoodNutrient.is_current.is_(True)))
        if current is None or not _same_profile(current, fields):
            if current is not None:
                current.is_current = False
                db.flush()  # release the one-current-row index before inserting the new version
            db.add(FoodNutrient(food_id=food.id, is_current=True, **fields))
            report.nutrient_versions_created += 1

        existing_servings = {s.label: s for s in db.scalars(select(FoodServing)
                                                            .where(FoodServing.food_id == food.id))}
        for s in item.get("servings") or []:
            label = s["label"].strip()
            if not is_usable_portion(label):
                report.servings_skipped += 1
                continue
            mass = _decimal(s["mass_g"])
            if label in existing_servings:
                if existing_servings[label].mass_g != mass:
                    report.serving_conflicts.append(f"{name}: {label}")
                continue
            serving = FoodServing(food_id=food.id, label=label, mass_g=mass, source_name=s["source_name"],
                                  source_reference=s.get("source_reference"))
            db.add(serving)
            existing_servings[label] = serving
            report.servings_created += 1
        db.flush()
    return report


def read_seed_file(path: Path = DEFAULT_SEED_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]
