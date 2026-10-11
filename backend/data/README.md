# Reference nutrition data

## `foods_usda_fndds.json`

| | |
|---|---|
| Source | USDA FoodData Central (FDC), Food and Nutrient Database for Dietary Studies (FNDDS) "Survey Foods" |
| Release | CSV release dated 2024-10-31 (FNDDS 2021–2023) — `dataset_version` in the file |
| Licence | Public domain, CC0 1.0 Universal, as published by USDA for FoodData Central data. Attribution is not required; the suggested citation is: *U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.* |
| Download | https://fdc.nal.usda.gov/download-datasets |
| Built by | `scripts/build_usda_seed.py <extracted-survey-csv-folder>` |
| Loaded by | `scripts/load_food_seed.py` (idempotent; see `app/services/nutrition/seed.py`) |

### What comes from USDA and what is curated

* **From the FDC files, unmodified:** every nutrient value, every portion
  label and gram weight, and the FDC description in `source_reference`
  (`"FDC ID <id>: <description>"`).
* **Curated by hand in `build_usda_seed.py`:** which FDC record stands in for a
  common Indian hostel food name, the alias list and each alias's confidence,
  `diet_type`, `known_allergens` and `preparation_notes`. These are judgments,
  not USDA data.

### Units and conventions

* Nutrients are per **100 g** edible portion (`reference_mass_g = 100`):
  `energy_kcal` in kcal; `protein_g`, `carbohydrate_g` (by difference),
  `fat_g` (total lipid) and `fibre_g` (total dietary fibre) in grams.
  Accepted FDC nutrient ids: 1008/1003/1005/1004/1079, or the legacy numbers
  208/203/205/204/291 used by the FNDDS CSV.
* A nutrient that is absent from the source is `null` and stays `NULL` in the
  database. It is never stored or calculated as zero. (In the current file
  every food has all five values.)
* Portions keep the FNDDS wording and US measures (`1 cup` = 236.6 ml,
  `1 fl oz` = 29.57 ml).

### Limits — read before showing numbers to students

* These are **generic US survey foods**. "Dal", "Sambar" or "Chicken curry"
  is the closest FNDDS record, not an Indian mess recipe; oil, ghee, water
  content and portion sizes in a hostel kitchen can differ substantially.
  Alias confidence (`HIGH` / `MEDIUM` / `LOW`) records how good the stand-in
  is, and `LOW` aliases are never applied without the student confirming.
* Allergen and diet labels describe the reference recipe only and are not a
  guarantee about any dish served in a mess.
* Some FNDDS portions are not portions of the food itself. Labels beginning
  with "Guideline amount" (e.g. milk "per fl oz of beverage" = 2.5 g, meaning
  milk added to coffee) are **skipped by the loader**. Other small portions
  ("1 surface inch", "1 chip", "1 peanut") are genuine and kept.
* Millilitre quantities are converted only for foods with a `1 fl oz`
  portion (milk, buttermilk, tea, coffee). `1 cup` is not used as a density
  because for solids it is a bulk volume.

### Verification status (2026-10-11)

Checked automatically by `tests/test_food_seed.py`: provenance on every food
and portion, single 100 g basis, non-negative values within NUMERIC(8, 2),
macronutrients ≤ 100 g per 100 g, fibre ≤ carbohydrate, energy within 15 % of
the Atwater 4/4/9 estimate, positive portion weights, unique normalized names
and aliases.

Not yet done: an independent re-check of the values against the FDC source.
An attempt to spot-check through the public FDC API was rate-limited (HTTP 429
on the shared `DEMO_KEY`). To verify, download the 2024-10-31 survey CSV,
rerun `build_usda_seed.py`, and confirm `git diff data/foods_usda_fndds.json`
is empty.
