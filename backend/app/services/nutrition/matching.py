"""Alias-based food matching with explicit ambiguity handling.

Rules, applied in order to the normalized name:

1. Exact key (a food's canonical name or one of its aliases).
   - one food, HIGH/MEDIUM confidence  -> matched
   - one food, LOW confidence          -> needs_confirmation ("low_confidence")
   - several foods                     -> needs_confirmation ("ambiguous")
2. The same, for a conservative singular form ("rotis" -> "roti").
3. Several dishes in one line ("rice and dal") -> needs_confirmation
   ("multiple_items"), offering the parts that matched.
4. Shared words ("dal makhani" ~ "dal", "biryani" ~ "veg biryani")
   -> needs_confirmation ("partial"), LOW confidence, never auto-selected.
5. A close spelling of a known name ("chapathi", "panner") -> needs_confirmation
   ("similar_spelling"), LOW confidence.
6. Otherwise -> unknown.

`search` is the ranked lookup behind the food-search endpoint. Its `score`
is a ranking key in [0, 1] with fixed tiers, NOT a probability of being right:

    1.00            exact name or alias
    0.60 - 0.80     the query is the start of a name ("chap" -> "chapati")
    0.40 - 0.60     shared words, scaled by word overlap (Jaccard)
    0.20 - 0.40     similar spelling, scaled by difflib similarity (>= 0.82 only)

A result from a higher tier always ranks above one from a lower tier.

Nothing here guesses silently: anything other than a confident exact match is
returned as candidates for the student to confirm.
"""

from __future__ import annotations

import difflib
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Literal

from app.services.nutrition.confidence import AUTO_ACCEPT, Confidence, rank, strongest
from app.services.nutrition.normalize import normalize_food_name, singular_variant, split_compound

MatchStatus = Literal["matched", "needs_confirmation", "unknown"]
MatchMethod = Literal["canonical", "alias", "singular", "partial", "fuzzy", "user_confirmed"]
SearchKind = Literal["exact", "prefix", "words", "fuzzy"]

MAX_CANDIDATES = 5
MAX_SEARCH_RESULTS = 50
# Measured: "panner"~"paneer" 0.833 is kept; "karela"~"kela" (bitter gourd vs banana) 0.800 is not.
FUZZY_MIN_RATIO = 0.82
FUZZY_MIN_LENGTH = 4
# Words that carry no identity on their own when comparing menu names.
_STOPWORDS = frozenset({"and", "with", "of", "the", "a", "an", "in", "on", "style"})


class UnknownFoodError(ValueError):
    """The referenced food is not in the index."""


@dataclass(frozen=True)
class FoodEntry:
    food_id: uuid.UUID
    canonical_name: str
    normalized_name: str
    # normalized alias -> confidence (HIGH / MEDIUM / LOW)
    aliases: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Candidate:
    food_id: uuid.UUID
    canonical_name: str
    confidence: Confidence
    method: MatchMethod
    matched_key: str


@dataclass(frozen=True)
class SearchHit:
    food_id: uuid.UUID
    canonical_name: str
    matched_key: str
    kind: SearchKind
    score: float  # ranking key, see module docstring; not a probability
    alias_confidence: Confidence


@dataclass(frozen=True)
class MatchResult:
    query: str
    normalized_query: str
    status: MatchStatus
    reason: str
    candidates: tuple[Candidate, ...] = ()

    @property
    def food(self) -> Candidate | None:
        """The selected food; only set when the match needs no confirmation."""
        return self.candidates[0] if self.status == "matched" else None

    @property
    def confidence(self) -> Confidence:
        return self.candidates[0].confidence if self.status == "matched" else "UNKNOWN"

    @property
    def requires_confirmation(self) -> bool:
        return self.status == "needs_confirmation"


def _tokens(text: str) -> frozenset[str]:
    return frozenset(t for t in text.split() if t not in _STOPWORDS)


class FoodIndex:
    """In-memory lookup over active foods. Build it once per request or batch."""

    def __init__(self, entries: Iterable[FoodEntry]) -> None:
        self._foods: dict[uuid.UUID, FoodEntry] = {}
        self._keys: dict[str, list[Candidate]] = {}
        for entry in entries:
            self._foods[entry.food_id] = entry
            self._add(entry.normalized_name, Candidate(entry.food_id, entry.canonical_name, "HIGH", "canonical",
                                                       entry.normalized_name))
            for key, conf in entry.aliases.items():
                rank(conf)  # validates the level
                self._add(key, Candidate(entry.food_id, entry.canonical_name, conf, "alias", key))  # type: ignore[arg-type]
        self._key_tokens = {key: _tokens(key) for key in self._keys}

    def _add(self, key: str, cand: Candidate) -> None:
        bucket = self._keys.setdefault(key, [])
        # One candidate per food per key; keep the strongest if a food lists a key twice.
        for i, existing in enumerate(bucket):
            if existing.food_id == cand.food_id:
                if rank(cand.confidence) > rank(existing.confidence):
                    bucket[i] = cand
                return
        bucket.append(cand)

    def __len__(self) -> int:
        return len(self._foods)

    def get(self, food_id: uuid.UUID) -> FoodEntry:
        try:
            return self._foods[food_id]
        except KeyError:
            raise UnknownFoodError(f"food {food_id} is not in the index") from None

    # --- matching -------------------------------------------------------------------------

    def _exact(self, key: str, *, singular: bool = False) -> list[Candidate]:
        found = self._keys.get(key, [])
        if singular:
            found = [Candidate(c.food_id, c.canonical_name, c.confidence, "singular", c.matched_key) for c in found]
        return sorted(found, key=lambda c: (-rank(c.confidence), c.canonical_name))

    def _lookup(self, normalized: str) -> list[Candidate]:
        hits = self._exact(normalized)
        if not hits:
            variant = singular_variant(normalized)
            if variant:
                hits = self._exact(variant, singular=True)
        return hits

    def _partial(self, normalized: str) -> list[Candidate]:
        query = _tokens(normalized)
        if not query:
            return []
        best: dict[uuid.UUID, tuple[float, Candidate]] = {}
        for key, key_tokens in self._key_tokens.items():
            if not key_tokens or not (key_tokens <= query or query <= key_tokens):
                continue
            overlap = len(key_tokens & query) / len(key_tokens | query)
            for c in self._keys[key]:
                cand = Candidate(c.food_id, c.canonical_name, "LOW", "partial", key)
                if c.food_id not in best or overlap > best[c.food_id][0]:
                    best[c.food_id] = (overlap, cand)
        ranked = sorted(best.values(), key=lambda pair: (-pair[0], pair[1].canonical_name))
        return [cand for _, cand in ranked[:MAX_CANDIDATES]]

    def _fuzzy(self, normalized: str) -> list[tuple[float, Candidate]]:
        if len(normalized) < FUZZY_MIN_LENGTH:
            return []
        best: dict[uuid.UUID, tuple[float, Candidate]] = {}
        for key, cands in self._keys.items():
            ratio = difflib.SequenceMatcher(None, normalized, key).ratio()
            if ratio < FUZZY_MIN_RATIO:
                continue
            for c in cands:
                if c.food_id not in best or ratio > best[c.food_id][0]:
                    best[c.food_id] = (ratio, Candidate(c.food_id, c.canonical_name, "LOW", "fuzzy", key))
        return sorted(best.values(), key=lambda pair: (-pair[0], pair[1].canonical_name))

    def search(self, raw: str, limit: int = 10) -> list[SearchHit]:
        """Ranked, deduplicated results for a search box. Empty query -> no results."""
        q = normalize_food_name(raw)
        if not q:
            return []
        limit = max(1, min(limit, MAX_SEARCH_RESULTS))
        best: dict[uuid.UUID, SearchHit] = {}

        def offer(c: Candidate, key: str, kind: SearchKind, score: float) -> None:
            current = best.get(c.food_id)
            if current is None or score > current.score:
                best[c.food_id] = SearchHit(c.food_id, c.canonical_name, key, kind, round(score, 4), c.confidence)

        q_tokens = _tokens(q)
        for key, cands in self._keys.items():
            if key == q:
                for c in cands:
                    offer(c, key, "exact", 1.0)
            elif key.startswith(q) and len(q) >= 2:
                for c in cands:
                    offer(c, key, "prefix", 0.6 + 0.2 * len(q) / len(key))
            else:
                key_tokens = self._key_tokens[key]
                shared = key_tokens & q_tokens
                if shared and (key_tokens <= q_tokens or q_tokens <= key_tokens):
                    jaccard = len(shared) / len(key_tokens | q_tokens)
                    for c in cands:
                        offer(c, key, "words", 0.4 + 0.2 * jaccard)
        for ratio, c in self._fuzzy(q):
            offer(c, c.matched_key, "fuzzy", 0.2 + 0.2 * (ratio - FUZZY_MIN_RATIO) / (1 - FUZZY_MIN_RATIO))
        return sorted(best.values(), key=lambda h: (-h.score, h.canonical_name))[:limit]

    def match(self, raw: str) -> MatchResult:
        normalized = normalize_food_name(raw)
        if not normalized:
            return MatchResult(raw, normalized, "unknown", "empty")

        hits = self._lookup(normalized)
        if len(hits) > 1:
            return MatchResult(raw, normalized, "needs_confirmation", "ambiguous", tuple(hits[:MAX_CANDIDATES]))
        if len(hits) == 1:
            hit = hits[0]
            if hit.confidence in AUTO_ACCEPT:
                return MatchResult(raw, normalized, "matched", "exact", (hit,))
            return MatchResult(raw, normalized, "needs_confirmation", "low_confidence", (hit,))

        parts = split_compound(raw)
        if parts:
            seen: dict[uuid.UUID, Candidate] = {}
            for part in parts:
                for c in self._lookup(part):
                    seen.setdefault(c.food_id, c)
            return MatchResult(raw, normalized, "needs_confirmation", "multiple_items",
                               tuple(list(seen.values())[:MAX_CANDIDATES]))

        partial = self._partial(normalized)
        if partial:
            return MatchResult(raw, normalized, "needs_confirmation", "partial", tuple(partial))
        similar = [c for _, c in self._fuzzy(normalized)[:MAX_CANDIDATES]]
        if similar:
            return MatchResult(raw, normalized, "needs_confirmation", "similar_spelling", tuple(similar))
        return MatchResult(raw, normalized, "unknown", "no_match")

    def confirm(self, raw: str, food_id: uuid.UUID) -> MatchResult:
        """Record the student's choice of food for `raw`.

        Confirmation settles which food was meant; it does not make a generic
        reference food an exact description of a mess preparation. So the
        result is MEDIUM, or HIGH when the name already matched this food HIGH.
        """
        entry = self.get(food_id)
        normalized = normalize_food_name(raw)
        prior = [c for c in self._lookup(normalized) if c.food_id == food_id] if normalized else []
        level = strongest("MEDIUM", *(c.confidence for c in prior))
        cand = Candidate(entry.food_id, entry.canonical_name, level, "user_confirmed",
                         prior[0].matched_key if prior else normalized)
        return MatchResult(raw, normalized, "matched", "user_confirmed", (cand,))
