"""Food-name normalization, alias matching, ambiguity handling and confirmation."""

from __future__ import annotations

import uuid

import pytest

from app.services.nutrition.matching import FoodEntry, FoodIndex, UnknownFoodError
from app.services.nutrition.normalize import normalize_food_name, singular_variant, split_compound
from app.services.nutrition.seed import read_seed_file


def _seed_index() -> tuple[FoodIndex, dict[str, uuid.UUID]]:
    ids: dict[str, uuid.UUID] = {}
    entries = []
    for food in read_seed_file()["foods"]:
        fid = uuid.uuid5(uuid.NAMESPACE_URL, food["canonical_name"])
        ids[food["canonical_name"]] = fid
        entries.append(FoodEntry(fid, food["canonical_name"], normalize_food_name(food["canonical_name"]),
                                 {normalize_food_name(a["alias"]): a["confidence"] for a in food["aliases"]}))
    return FoodIndex(entries), ids


INDEX, IDS = _seed_index()


@pytest.mark.parametrize(("raw", "expected"), [
    ("Paneer  Butter-Masala!", "paneer butter masala"),
    ("  DAL\tTadka ", "dal tadka"),
    ("Rajmá", "rajma"),
    ("Roti / Chapati", "roti chapati"),
    ("!!!", ""),
])
def test_normalize_food_name(raw: str, expected: str) -> None:
    assert normalize_food_name(raw) == expected


@pytest.mark.parametrize(("normalized", "expected"), [
    ("rotis", "roti"), ("boiled eggs", "boiled egg"), ("tomatoes", "tomato"), ("idlis", "idli"),
    ("dal", None), ("glass", None), ("bus", None), ("", None),
])
def test_singular_variant(normalized: str, expected: str | None) -> None:
    assert singular_variant(normalized) == expected


def test_split_compound() -> None:
    assert split_compound("Rice and Dal") == ["rice", "dal"]
    assert split_compound("Roti + Sabzi, Salad") == ["roti", "sabzi", "salad"]
    assert split_compound("Tea with milk") == []
    assert split_compound("Paneer") == []


@pytest.mark.parametrize(("raw", "food", "confidence", "method"), [
    ("Roti", "Roti / chapati", "HIGH", "alias"),
    ("CHAPATTI", "Roti / chapati", "HIGH", "alias"),
    ("roti / chapati", "Roti / chapati", "HIGH", "canonical"),
    ("Rajma", "Kidney beans (cooked, with fat)", "MEDIUM", "alias"),
    ("Chai", "Tea with milk", "MEDIUM", "alias"),
    ("Rotis", "Roti / chapati", "HIGH", "singular"),
    ("Boiled Eggs", "Boiled egg", "HIGH", "singular"),
])
def test_confident_matches_are_selected(raw: str, food: str, confidence: str, method: str) -> None:
    result = INDEX.match(raw)
    assert result.status == "matched", result
    assert result.food is not None
    assert result.food.food_id == IDS[food]
    assert result.confidence == confidence
    assert result.food.method == method
    assert not result.requires_confirmation


@pytest.mark.parametrize("raw", ["tea", "sabzi", "aloo paratha", "rajma masala", "chana masala"])
def test_low_confidence_aliases_need_confirmation(raw: str) -> None:
    result = INDEX.match(raw)
    assert result.status == "needs_confirmation"
    assert result.reason == "low_confidence"
    assert result.food is None and result.confidence == "UNKNOWN"
    assert len(result.candidates) == 1 and result.candidates[0].confidence == "LOW"


def test_partial_names_offer_candidates_but_never_select() -> None:
    result = INDEX.match("Dal Makhani")
    assert result.status == "needs_confirmation" and result.reason == "partial"
    assert IDS["Dal"] in {c.food_id for c in result.candidates}
    assert all(c.confidence == "LOW" and c.method == "partial" for c in result.candidates)
    assert result.food is None


def test_generic_name_matching_several_dishes_is_ambiguous() -> None:
    result = INDEX.match("biryani")
    assert result.requires_confirmation
    assert {IDS["Chicken biryani"], IDS["Vegetable biryani"]} <= {c.food_id for c in result.candidates}


def test_multiple_items_in_one_line_need_confirmation() -> None:
    result = INDEX.match("Rice and Dal")
    assert result.status == "needs_confirmation" and result.reason == "multiple_items"
    assert [c.food_id for c in result.candidates] == [IDS["Steamed white rice"], IDS["Dal"]]


def test_exact_key_shared_by_two_foods_is_ambiguous() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    index = FoodIndex([FoodEntry(a, "Kheer", "kheer"),
                       FoodEntry(b, "Rice pudding", "rice pudding", {"kheer": "MEDIUM"})])
    result = index.match("kheer")
    assert result.status == "needs_confirmation" and result.reason == "ambiguous"
    assert [c.food_id for c in result.candidates] == [a, b]  # strongest first
    assert result.food is None


@pytest.mark.parametrize("raw", ["Pizza", "xyzzy", "Karela"])
def test_unknown_foods(raw: str) -> None:
    result = INDEX.match(raw)
    assert result.status == "unknown" and result.reason == "no_match"
    assert result.candidates == () and result.food is None and result.confidence == "UNKNOWN"


@pytest.mark.parametrize("raw", ["", "   ", "!!!"])
def test_empty_names(raw: str) -> None:
    result = INDEX.match(raw)
    assert result.status == "unknown" and result.reason == "empty"


def test_confirmation_resolves_ambiguity_without_overstating_confidence() -> None:
    tea = INDEX.confirm("tea", IDS["Tea with milk"])
    assert tea.status == "matched" and tea.food is not None
    assert tea.food.food_id == IDS["Tea with milk"] and tea.food.method == "user_confirmed"
    assert tea.confidence == "MEDIUM"  # LOW alias, raised to MEDIUM by the student's confirmation
    roti = INDEX.confirm("roti", IDS["Roti / chapati"])
    assert roti.confidence == "HIGH"  # already a HIGH match
    custom = INDEX.confirm("Dal Makhani", IDS["Dal"])
    assert custom.confidence == "MEDIUM"


def test_confirming_an_unknown_food_is_rejected() -> None:
    with pytest.raises(UnknownFoodError):
        INDEX.confirm("tea", uuid.uuid4())


def test_invalid_alias_confidence_is_rejected() -> None:
    with pytest.raises(ValueError):
        FoodIndex([FoodEntry(uuid.uuid4(), "X", "x", {"y": "SURE"})])


# --- typo tolerance and ranked search ----------------------------------------------------------

@pytest.mark.parametrize(("raw", "food"), [("Chapathi", "Roti / chapati"), ("panner", "Paneer"),
                                           ("sambhaar", "Sambar"), ("omlette", "Omelette (made with oil)")])
def test_close_spellings_are_offered_but_need_confirmation(raw: str, food: str) -> None:
    result = INDEX.match(raw)
    assert result.status == "needs_confirmation" and result.reason == "similar_spelling"
    assert result.candidates[0].food_id == IDS[food]
    assert all(c.method == "fuzzy" and c.confidence == "LOW" for c in result.candidates)


def test_dissimilar_short_names_are_not_fuzzy_matched() -> None:
    # "karela" (bitter gourd) is 0.80 similar to "kela" (banana): below the threshold on purpose.
    assert INDEX.match("karela").status == "unknown"
    assert INDEX.match("pav").status == "unknown"  # too short for fuzzy matching


def test_search_ranks_exact_then_prefix_then_words_then_fuzzy() -> None:
    hits = INDEX.search("dal")
    assert hits[0].food_id == IDS["Dal"] and hits[0].kind == "exact" and hits[0].score == 1.0
    prefix = INDEX.search("chap")
    assert prefix[0].food_id == IDS["Roti / chapati"] and prefix[0].kind == "prefix"
    assert 0.6 < prefix[0].score < 0.8
    words = INDEX.search("paneer tikka")
    assert words[0].food_id == IDS["Paneer"] and words[0].kind == "words" and 0.4 <= words[0].score <= 0.6
    fuzzy = INDEX.search("chapathi")
    assert fuzzy[0].food_id == IDS["Roti / chapati"] and fuzzy[0].kind == "fuzzy"
    assert 0.2 <= fuzzy[0].score <= 0.4


def test_search_deduplicates_foods_and_orders_deterministically() -> None:
    hits = INDEX.search("biryani")
    ids = [h.food_id for h in hits]
    assert len(ids) == len(set(ids))
    assert {IDS["Chicken biryani"], IDS["Vegetable biryani"]} <= set(ids)
    assert hits == INDEX.search("BIRYANI!")
    assert [h.score for h in hits] == sorted((h.score for h in hits), reverse=True)


def test_search_limits_and_empty_queries() -> None:
    assert INDEX.search("") == [] and INDEX.search("  !! ") == []
    assert len(INDEX.search("a", limit=3)) <= 3
    assert len(INDEX.search("r", limit=1000)) <= 50
    assert INDEX.search("xyzzyq") == []
