"""Load data/foods_usda_fndds.json into the database named by DATABASE_URL.

Idempotent: running it again only adds what is missing and versions nutrient
profiles that changed. Run from the backend directory after `alembic upgrade head`:

    python scripts/load_food_seed.py            # load and commit
    python scripts/load_food_seed.py --check    # validate the file only, no database access
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.nutrition.seed import DEFAULT_SEED_PATH, SeedDataError, read_seed_file, validate_seed  # noqa: E402


def main(argv: list[str]) -> int:
    data = read_seed_file(DEFAULT_SEED_PATH)
    try:
        validate_seed(data)
    except SeedDataError as exc:
        for problem in exc.problems:
            print(f"invalid: {problem}", file=sys.stderr)
        return 1
    if "--check" in argv:
        print(f"ok: {len(data['foods'])} foods, dataset {data['dataset']} {data['dataset_version']}")
        return 0

    from app.db.session import SessionLocal
    from app.services.nutrition.seed import load_seed

    with SessionLocal() as db:
        report = load_seed(db, data)
        db.commit()
    print(f"foods created={report.foods_created} updated={report.foods_updated} "
          f"aliases created={report.aliases_created} nutrient versions={report.nutrient_versions_created} "
          f"servings created={report.servings_created} skipped={report.servings_skipped}")
    for conflict in report.serving_conflicts:
        print(f"serving left unchanged (mass differs): {conflict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
