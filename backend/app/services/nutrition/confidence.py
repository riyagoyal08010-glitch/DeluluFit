"""Confidence levels and how they combine.

Levels, weakest first: UNKNOWN < LOW < MEDIUM < HIGH (the CHECK-constrained
values in app.db.enums.CONFIDENCE_LEVELS). An estimate is only as certain as
its weakest input, so combination always takes the minimum.

    match confidence    how well the reference food represents the name
                        (from food_aliases.confidence; canonical names are HIGH)
    portion confidence  user_grams -> HIGH (the student weighed or read it)
                        serving_reference -> MEDIUM (mess portions vary)
                        unknown -> UNKNOWN
"""

from __future__ import annotations

from typing import Literal, cast

Confidence = Literal["HIGH", "MEDIUM", "LOW", "UNKNOWN"]

_ORDER: dict[str, int] = {"UNKNOWN": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}

PORTION_CONFIDENCE: dict[str, Confidence] = {
    "user_grams": "HIGH",
    "serving_reference": "MEDIUM",
    "unknown": "UNKNOWN",
}

# Matches that are certain enough to use without asking the student.
AUTO_ACCEPT: frozenset[str] = frozenset({"HIGH", "MEDIUM"})


def rank(level: str) -> int:
    try:
        return _ORDER[level]
    except KeyError:
        raise ValueError(f"unknown confidence level {level!r}") from None


def weakest(*levels: str) -> Confidence:
    if not levels:
        raise ValueError("at least one confidence level is required")
    return cast(Confidence, min(levels, key=rank))


def strongest(*levels: str) -> Confidence:
    if not levels:
        raise ValueError("at least one confidence level is required")
    return cast(Confidence, max(levels, key=rank))


def portion_confidence(mass_source: str) -> Confidence:
    try:
        return PORTION_CONFIDENCE[mass_source]
    except KeyError:
        raise ValueError(f"unknown mass source {mass_source!r}") from None


def estimate_confidence(match_confidence: str, mass_source: str) -> Confidence:
    return weakest(match_confidence, portion_confidence(mass_source))
