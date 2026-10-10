"""Text normalization shared by matching and uniqueness rules."""

from __future__ import annotations

import re
import unicodedata

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_label(value: str) -> str:
    """Lowercase, strip accents and punctuation, collapse whitespace.

    "Paneer  Butter-Masala!" -> "paneer butter masala"
    """
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii")
    return _NON_ALNUM.sub(" ", ascii_only.lower()).strip()


def clean_display(value: str, max_len: int) -> str:
    """Collapse internal whitespace and trim to a maximum length."""
    return " ".join(value.split())[:max_len]
