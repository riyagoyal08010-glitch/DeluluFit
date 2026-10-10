"""Build data/foods_usda_fndds.json from USDA FoodData Central bulk CSV downloads.

Nothing in the output is typed in by hand except the curation below: which
FDC record represents which common Indian hostel food name, the dietary
classification and obvious allergens. Every nutrient value and portion
weight comes from the FDC files, with the FDC ID kept as the source reference.

Source: USDA FoodData Central, Food and Nutrient Database for Dietary Studies
(FNDDS), "Survey Foods" CSV release 2024-10-31. Public domain (CC0 1.0).
https://fdc.nal.usda.gov/download-datasets

Usage:
    python scripts/build_usda_seed.py <path-to-extracted-survey-csv-folder>
"""

from __future__ import annotations

import csv
import json
import sys
from decimal import Decimal
from pathlib import Path

DATASET = "USDA FoodData Central - FNDDS Survey Foods"
DATASET_VERSION = "2024-10-31"
# The FNDDS survey CSV stores legacy nutrient numbers (208, 203, ...) in the
# nutrient_id column, while other FDC releases use nutrient ids (1008, 1003, ...).
# Both encodings are accepted; they do not overlap.
NUTRIENT_IDS = {"1008": "energy_kcal", "1003": "protein_g", "1005": "carbohydrate_g", "1004": "fat_g",
                "1079": "fibre_g",
                "208": "energy_kcal", "203": "protein_g", "205": "carbohydrate_g", "204": "fat_g", "291": "fibre_g"}
NUTRIENT_FIELDS = ("energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g")

V, E, N, VG = "vegetarian", "eggetarian", "non_vegetarian", "vegan"

# (fdc_id, canonical name, category, diet_type, known allergens, preparation note,
#  [(alias, confidence)])
# diet_type is conservative: anything that may contain dairy/ghee is "vegetarian", not "vegan".
CURATION: list[tuple[str, str, str, str, list[str], str | None, list[tuple[str, str]]]] = [
    ("2707713", "Roti / chapati", "bread", V, ["wheat_gluten"], None,
     [("roti", "HIGH"), ("chapati", "HIGH"), ("chapatti", "HIGH"), ("chappati", "HIGH"), ("phulka", "HIGH"),
      ("fulka", "HIGH"), ("tawa roti", "HIGH"), ("butter roti", "MEDIUM")]),
    ("2707715", "Paratha", "bread", V, ["wheat_gluten"], "Plain paratha; stuffed parathas differ.",
     [("paratha", "HIGH"), ("plain paratha", "HIGH"), ("lachha paratha", "MEDIUM"), ("aloo paratha", "LOW")]),
    ("2707714", "Puri", "bread", V, ["wheat_gluten"], "Deep-fried wheat bread.", [("puri", "HIGH"), ("poori", "HIGH")]),
    ("2707613", "Naan", "bread", V, ["wheat_gluten", "milk"], None, [("naan", "HIGH"), ("butter naan", "MEDIUM")]),
    ("2707598", "White bread", "bread", V, ["wheat_gluten"], None,
     [("bread", "MEDIUM"), ("white bread", "HIGH"), ("bread slice", "HIGH")]),
    ("2708408", "Steamed white rice", "grain", VG, [], "Cooked white rice, no added fat.",
     [("rice", "HIGH"), ("plain rice", "HIGH"), ("steamed rice", "HIGH"), ("boiled rice", "HIGH"),
      ("white rice", "HIGH"), ("chawal", "HIGH"), ("jeera rice", "MEDIUM")]),
    ("2708414", "Brown rice", "grain", VG, [], "Cooked brown rice, no added fat.", [("brown rice", "HIGH")]),
    ("2709077", "Rice pilaf", "grain", V, [], "Seasoned rice cooked with fat.",
     [("pulao", "MEDIUM"), ("pulav", "MEDIUM"), ("veg pulao", "MEDIUM"), ("rice pilaf", "HIGH")]),
    ("2708381", "Oatmeal (made with water)", "grain", VG, [], "Plain oats cooked in water, no added fat.",
     [("oats", "MEDIUM"), ("oatmeal", "HIGH"), ("porridge", "MEDIUM")]),
    ("2708453", "Corn flakes", "grain", VG, [], "Dry cereal, without milk.", [("corn flakes", "HIGH"), ("cornflakes", "HIGH")]),
    ("2707427", "Dal", "pulse", V, [], "Generic cooked lentil dal; recipes and lentil types vary.",
     [("dal", "HIGH"), ("daal", "HIGH"), ("dhal", "HIGH"), ("yellow dal", "HIGH"), ("dal fry", "MEDIUM"),
      ("dal tadka", "MEDIUM"), ("arhar dal", "MEDIUM"), ("toor dal", "MEDIUM"), ("moong dal", "MEDIUM"),
      ("masoor dal", "MEDIUM"), ("chana dal", "MEDIUM")]),
    ("2707431", "Lentil curry", "pulse", V, [], None, [("lentil curry", "HIGH")]),
    ("2707430", "Sambar", "pulse", V, [], "Lentil and vegetable stew.", [("sambar", "HIGH"), ("sambhar", "HIGH")]),
    ("2707380", "Kidney beans (cooked, with fat)", "pulse", V, [],
     "Cooked kidney beans with added fat; a rajma curry with gravy will differ.",
     [("rajma", "MEDIUM"), ("kidney beans", "HIGH"), ("rajma masala", "LOW")]),
    ("2707415", "Chickpeas (cooked, with fat)", "pulse", V, [],
     "Cooked chickpeas with added fat; chole with gravy will differ.",
     [("chole", "MEDIUM"), ("chhole", "MEDIUM"), ("chana", "MEDIUM"), ("kabuli chana", "MEDIUM"),
      ("chickpeas", "HIGH"), ("chana masala", "LOW")]),
    ("2707389", "Mung beans (cooked)", "pulse", VG, [], None, [("mung beans", "HIGH"), ("green moong", "MEDIUM")]),
    ("2708346", "Idli", "south_indian", V, [], None, [("idli", "HIGH"), ("idly", "HIGH")]),
    ("2708347", "Plain dosa", "south_indian", V, [], None, [("dosa", "HIGH"), ("plain dosa", "HIGH"), ("sada dosa", "HIGH")]),
    ("2709129", "Masala dosa", "south_indian", V, [], "Dosa with filling.", [("masala dosa", "MEDIUM")]),
    ("2709128", "Upma", "breakfast", V, ["wheat_gluten"], "Semolina (wheat) based.",
     [("upma", "HIGH"), ("rava upma", "HIGH"), ("suji upma", "HIGH")]),
    ("2708730", "Samosa", "snack", V, ["wheat_gluten"], None, [("samosa", "HIGH"), ("aloo samosa", "HIGH")]),
    ("2710066", "Pakora", "snack", V, [], "Batter-fried vegetables; batter and filling vary.",
     [("pakora", "HIGH"), ("pakoda", "HIGH"), ("bhajji", "MEDIUM"), ("bhaji", "MEDIUM")]),
    ("2707429", "Papad", "snack", V, [], "Grilled or broiled.", [("papad", "HIGH"), ("papadum", "HIGH")]),
    ("2709422", "Potato chips", "snack", V, [], None, [("potato chips", "HIGH"), ("chips", "MEDIUM")]),
    ("2709456", "French fries", "snack", V, [], None, [("french fries", "HIGH"), ("fries", "HIGH")]),
    ("2710067", "Vegetable curry", "vegetable", V, [], "Generic vegetable curry; vegetables and gravy vary.",
     [("vegetable curry", "HIGH"), ("veg curry", "HIGH"), ("mix veg", "MEDIUM"), ("mixed vegetable", "MEDIUM"),
      ("sabzi", "LOW"), ("sabji", "LOW")]),
    ("2709947", "Okra (cooked, with fat)", "vegetable", V, [], None, [("bhindi", "MEDIUM"), ("okra", "HIGH")]),
    ("2709385", "Boiled potato", "vegetable", VG, [], None, [("boiled potato", "HIGH"), ("potato", "MEDIUM")]),
    ("2709784", "Cucumber (raw)", "vegetable", VG, [], None, [("cucumber", "HIGH"), ("kheera", "HIGH")]),
    ("2709719", "Tomato (raw)", "vegetable", VG, [], None, [("tomato", "HIGH")]),
    ("2709795", "Onion (raw)", "vegetable", VG, [], None, [("onion", "HIGH"), ("pyaz", "HIGH")]),
    ("2709660", "Carrot (raw)", "vegetable", VG, [], None, [("carrot", "HIGH"), ("gajar", "HIGH")]),
    ("2709757", "Tomato soup", "soup", V, [], None, [("tomato soup", "HIGH")]),
    ("2705740", "Paneer", "dairy", V, ["milk"], "Plain paneer as described by FNDDS, not a paneer curry.", [("paneer", "HIGH")]),
    ("2705418", "Curd (plain whole-milk yogurt)", "dairy", V, ["milk"], None,
     [("curd", "HIGH"), ("dahi", "HIGH"), ("yogurt", "HIGH"), ("plain yogurt", "HIGH")]),
    ("2705385", "Milk (whole)", "dairy", V, ["milk"], None, [("milk", "HIGH"), ("whole milk", "HIGH"), ("doodh", "HIGH")]),
    ("2705393", "Buttermilk", "dairy", V, ["milk"], "Cultured buttermilk; spiced Indian chaas may differ.",
     [("buttermilk", "HIGH"), ("chaas", "MEDIUM"), ("chhach", "MEDIUM")]),
    ("2705685", "Rice pudding", "dessert", V, ["milk"], None, [("rice pudding", "HIGH"), ("kheer", "MEDIUM")]),
    ("2710168", "Ghee", "fat", V, ["milk"], None, [("ghee", "HIGH")]),
    ("2710154", "Butter", "fat", V, ["milk"], None, [("butter", "HIGH"), ("makhan", "HIGH")]),
    ("2707154", "Boiled egg", "egg", E, ["egg"], None,
     [("boiled egg", "HIGH"), ("egg", "MEDIUM"), ("anda", "MEDIUM"), ("poached egg", "HIGH")]),
    ("2707200", "Omelette (made with oil)", "egg", E, ["egg"], None,
     [("omelette", "HIGH"), ("omelet", "HIGH"), ("egg omelette", "HIGH"), ("scrambled egg", "HIGH"),
      ("egg bhurji", "MEDIUM")]),
    ("2706437", "Chicken curry", "meat", N, [], None,
     [("chicken curry", "HIGH"), ("chicken masala", "MEDIUM"), ("chicken gravy", "MEDIUM")]),
    ("2706538", "Chicken biryani", "meat", N, [], None, [("chicken biryani", "HIGH")]),
    ("2706460", "Fish curry", "meat", N, ["fish"], None, [("fish curry", "HIGH")]),
    ("2706413", "Mutton with gravy", "meat", N, [], None, [("mutton curry", "MEDIUM"), ("mutton gravy", "MEDIUM")]),
    ("2708985", "Vegetable biryani", "grain", V, [], None, [("veg biryani", "HIGH"), ("vegetable biryani", "HIGH")]),
    ("2707435", "Tofu", "pulse", VG, ["soy"], None, [("tofu", "HIGH"), ("soya paneer", "MEDIUM")]),
    ("2707517", "Roasted peanuts (salted)", "nut", VG, ["peanut"], None,
     [("peanuts", "HIGH"), ("roasted peanuts", "HIGH"), ("moongphali", "HIGH")]),
    ("2707537", "Peanut butter", "nut", VG, ["peanut"], None, [("peanut butter", "HIGH")]),
    ("2709224", "Banana", "fruit", VG, [], None, [("banana", "HIGH"), ("kela", "HIGH")]),
    ("2709215", "Apple", "fruit", VG, [], None, [("apple", "HIGH"), ("seb", "HIGH")]),
    ("2709171", "Orange", "fruit", VG, [], None, [("orange", "HIGH"), ("santra", "HIGH")]),
    ("2709242", "Mango", "fruit", VG, [], None, [("mango", "HIGH"), ("aam", "HIGH")]),
    ("2709246", "Papaya", "fruit", VG, [], None, [("papaya", "HIGH"), ("papita", "HIGH")]),
    ("2709238", "Guava", "fruit", VG, [], None, [("guava", "HIGH"), ("amrood", "HIGH")]),
    ("2707572", "Coconut water", "beverage", VG, [], "Unsweetened.", [("coconut water", "HIGH"), ("nariyal pani", "HIGH")]),
    ("2710506", "Tea with milk", "beverage", V, ["milk"], "As described by FNDDS; sugar and milk amounts in hostel chai vary.",
     [("tea with milk", "HIGH"), ("milk tea", "HIGH"), ("chai", "MEDIUM"), ("tea", "LOW")]),
    ("2710488", "Black tea", "beverage", VG, [], "Brewed, no milk or sugar.", [("black tea", "HIGH")]),
    ("2710375", "Black coffee", "beverage", VG, [], "Brewed, no milk or sugar.", [("black coffee", "HIGH")]),
]


def main(folder: Path, out: Path) -> None:
    wanted = {c[0] for c in CURATION}
    foods = {r["fdc_id"]: r for r in csv.DictReader((folder / "food.csv").open(encoding="utf-8"))
             if r["fdc_id"] in wanted}
    missing = wanted - foods.keys()
    if missing:
        raise SystemExit(f"FDC ids not found in dataset: {sorted(missing)}")
    nutrients: dict[str, dict[str, str]] = {k: {} for k in wanted}
    with (folder / "food_nutrient.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["fdc_id"] in wanted and r["nutrient_id"] in NUTRIENT_IDS:
                nutrients[r["fdc_id"]][NUTRIENT_IDS[r["nutrient_id"]]] = str(Decimal(r["amount"]))
    portions: dict[str, list[dict[str, str]]] = {k: [] for k in wanted}
    with (folder / "food_portion.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if (r["fdc_id"] in wanted and r["gram_weight"] and r["portion_description"]
                    and "quantity not specified" not in r["portion_description"].lower()):
                portions[r["fdc_id"]].append({"label": r["portion_description"][:80],
                                              "mass_g": str(Decimal(r["gram_weight"])), "seq": r["seq_num"]})
    records = []
    for fdc_id, name, category, diet, allergens, note, aliases in CURATION:
        servings = sorted(portions[fdc_id], key=lambda p: int(p["seq"] or 0))
        seen: set[str] = set()
        unique_servings = []
        for p in servings:
            if p["label"].lower() not in seen:
                seen.add(p["label"].lower())
                unique_servings.append({"label": p["label"], "mass_g": p["mass_g"]})
        records.append({
            "canonical_name": name, "category": category, "diet_type": diet, "known_allergens": allergens,
            "preparation_notes": note,
            "aliases": [{"alias": a, "confidence": c} for a, c in aliases],
            "nutrients": {"reference_mass_g": "100", **{k: nutrients[fdc_id].get(k) for k in NUTRIENT_FIELDS},
                          "source_name": DATASET,
                          "source_reference": f"FDC ID {fdc_id}: {foods[fdc_id]['description']}",
                          "dataset_version": DATASET_VERSION},
            "servings": [dict(s, source_name=DATASET, source_reference=f"FDC ID {fdc_id} food_portion")
                         for s in unique_servings[:6]],
        })
    out.write_text(json.dumps({"dataset": DATASET, "dataset_version": DATASET_VERSION, "license": "CC0 1.0",
                               "url": "https://fdc.nal.usda.gov/download-datasets", "foods": records},
                              indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(records)} foods to {out}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), Path(__file__).resolve().parents[1] / "data" / "foods_usda_fndds.json")
