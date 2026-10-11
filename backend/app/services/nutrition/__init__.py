"""Deterministic nutrition engine.

Modules, from raw text to a stored estimate:

    normalize   food-name normalization (shared with food_aliases.normalized_alias)
    matching    alias-based matching, ambiguity handling, user confirmation
    confidence  how certain a match / portion / estimate is
    units       quantity validation and serving / gram / millilitre conversion
    calculator  proportional nutrient arithmetic with explicit missing values
    provenance  engine version and the input snapshot stored with each estimate
    estimates   computing and persisting versioned, immutable estimates
    catalog     loading foods, nutrient profiles and servings from the database
    seed        validating and loading the curated reference dataset

All arithmetic uses Decimal; no model or LLM is involved in any calculation.
"""
