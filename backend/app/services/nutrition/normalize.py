"""Food-name normalization.

`normalize_food_name` is the single normalization used for foods.normalized_name,
food_aliases.normalized_alias and every lookup, so stored keys and queries can
never drift apart. It deliberately does no fuzzy rewriting: spelling variants
("chapati", "chapatti", "chappati") are listed as aliases in the reference data.
"""

from __future__ import annotations

import re

from app.services.text import normalize_label

# Separators that usually join two distinct dishes in a menu line. "with" is
# intentionally absent: "tea with milk" is one food.
_COMPOUND_SPLIT = re.compile(r"\s*(?:,|\+|&|/|\band\b)\s*", re.IGNORECASE)


def normalize_food_name(raw: str) -> str:
    """Lowercase, strip accents and punctuation, collapse whitespace.

    "Dal  Tadka!" -> "dal tadka"; "Rajmá-Chawal" -> "rajma chawal".
    """
    return normalize_label(raw)


def singular_variant(normalized: str) -> str | None:
    """A conservative singular form of the last word, or None when there is none.

    "rotis" -> "roti", "boiled eggs" -> "boiled egg", "tomatoes" -> "tomato".
    Only used after an exact lookup fails, so names that genuinely end in "s"
    ("chips", "oats") are found by their exact alias first.
    """
    tokens = normalized.split()
    if not tokens:
        return None
    last = tokens[-1]
    if len(last) > 4 and last.endswith("oes"):
        stem = last[:-2]
    elif len(last) > 3 and last.endswith("s") and not last.endswith("ss"):
        stem = last[:-1]
    else:
        return None
    return " ".join([*tokens[:-1], stem])


def split_compound(raw: str) -> list[str]:
    """Split "Rice and dal" / "Roti + sabzi" into normalized parts; [] when it is one item."""
    parts = [normalize_food_name(p) for p in _COMPOUND_SPLIT.split(raw)]
    parts = [p for p in parts if p]
    return parts if len(parts) >= 2 else []
