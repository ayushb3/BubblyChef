"""Issue #542: an exact (case/whitespace/punctuation-insensitive) saved-recipe
title match must return that recipe alone, not a padded "which one?" list.
Per the triage decision, `search_saved_recipes` also needs a score cutoff so
weak fuzzy matches don't pad the list out to `limit` either.

Before the fix, `search_saved_recipes` ranked every candidate with any token
overlap (score > 0) and returned up to `limit` (5) of them — so asking for a
recipe by its literal saved title still surfaced weaker, unrelated matches
alongside it, and a fuzzy query with several near-zero matches got a full
padded list instead of just the real ones.

Revised after re-review (PR #605, 2026-09-23 18:32) for three gaps in the
first pass:

1. The score cutoff was applied to the *combined* score, so a genuine
   description-only match (a realistic 20-40 word description) scored well
   under the floor and was dropped as if nothing matched at all. The floor
   now only ever drops a row whose *sole* signal is a near-zero title
   overlap — any description/tag signal bypasses it.
2. The exact-match short-circuit compared the raw query string to the raw
   title string, so it only fired for a bare "butter chicken" — not
   "show me my saved butter chicken" or "butter chicken?", which is what the
   issue's example actually looks like in chat. It now compares the
   *tokenized* query (`_tokenize_query` — stopwords stripped, case/whitespace/
   punctuation folded) against the tokenized title.
3. The short-circuit fired even for a single-token query like "chicken" that
   exactly equals one saved title ("Chicken") while several other saved
   titles ("Roast Chicken", "Chicken Tikka") also plausibly match it — those
   got silently dropped from a 3-result list down to 1. It now only
   short-circuits when no other candidate title is a strict superset of the
   query tokens; otherwise the ranked list is returned, with the exact match
   sorted first.

Follows the `_FakeClient`/`_FakeQuery` pattern from
`test_issue_493_saved_recipe_search.py`.
"""

from __future__ import annotations

from typing import Any

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository


class _FakeQuery:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self._filters: dict[str, Any] = {}

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return self

    def eq(self, field: str, value: Any) -> _FakeQuery:
        self._filters[field] = value
        return self

    def order(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return self

    def limit(self, _n: int) -> _FakeQuery:
        return self

    def execute(self) -> Any:
        filtered = [
            row
            for row in self._rows
            if all(row.get(k) == v for k, v in self._filters.items())
        ]
        return type("Result", (), {"data": filtered})()


class _FakeClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self._rows)


def _repo_for(rows: list[dict[str, Any]]) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = _FakeClient(rows)  # type: ignore[assignment]
    return repo


@pytest.mark.asyncio
class TestExactTitleMatch:
    async def test_exact_title_match_returns_only_that_recipe(self) -> None:
        """An exact title match must not be padded with weaker fuzzy
        matches, even though they'd otherwise score > 0 and fit under
        `limit`. None of the fuzzy candidates here contain the full query
        token set, so none of them counts as "another plausible full
        match"."""
        rows = [
            {
                "id": "exact",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "fuzzy1",
                "user_id": "u1",
                "title": "Chicken Tikka Masala",
                "description": "",
                "tags": [],
            },
            {
                "id": "fuzzy2",
                "user_id": "u1",
                "title": "Chicken Stock Notes",
                "description": "",
                "tags": [],
            },
            {
                "id": "fuzzy3",
                "user_id": "u1",
                "title": "Chicken Peanut Bowl",
                "description": "",
                "tags": [],
            },
            {
                "id": "fuzzy4",
                "user_id": "u1",
                "title": "Roast Chicken",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "Butter Chicken", limit=5)

        assert [r["id"] for r in results] == ["exact"]

    async def test_exact_match_is_case_and_whitespace_insensitive(self) -> None:
        rows = [
            {
                "id": "exact",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "fuzzy",
                "user_id": "u1",
                "title": "Chicken Stock Notes",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "  butter    CHICKEN  ", limit=5)

        assert [r["id"] for r in results] == ["exact"]

    async def test_fuzzy_matching_unchanged_when_no_exact_match(self) -> None:
        """Regression guard: the exact-match short-circuit must not affect
        ranking when nothing matches exactly."""
        rows = [
            {
                "id": "r1",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "r2",
                "user_id": "u1",
                "title": "Chicken Stock Notes",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=5)

        assert [r["id"] for r in results] == ["r1", "r2"]

    @pytest.mark.parametrize(
        "query",
        [
            "show me my saved butter chicken",
            "butter chicken?",
            "can you show me my saved butter chicken",
        ],
    )
    async def test_exact_match_on_tokenized_query_not_just_bare_title(
        self, query: str
    ) -> None:
        """Regression for PR #605 re-review finding 1: the short-circuit
        must fire on the sentence a real chat message sends, not just a bare
        title. `_tokenize_query` strips filler ("show", "me", "my", "saved")
        and punctuation, reducing all three of these to {butter, chicken} —
        the same as the saved title."""
        rows = [
            {
                "id": "exact",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "fuzzy1",
                "user_id": "u1",
                "title": "Chicken Tikka Masala",
                "description": "",
                "tags": [],
            },
            {
                "id": "fuzzy2",
                "user_id": "u1",
                "title": "Chicken Stock Notes",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", query, limit=5)

        assert [r["id"] for r in results] == ["exact"]

    async def test_single_token_query_matching_several_titles_keeps_the_list(
        self,
    ) -> None:
        """Regression for PR #605 re-review finding 3: "chicken" equals the
        token set of saved "Chicken" exactly, but "Roast Chicken" and
        "Chicken Tikka" both also contain "chicken" and are just as
        plausible — none of the three should be silently dropped. The exact
        match still ranks first (highest title score)."""
        rows = [
            {
                "id": "roast",
                "user_id": "u1",
                "title": "Roast Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "exact",
                "user_id": "u1",
                "title": "Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "tikka",
                "user_id": "u1",
                "title": "Chicken Tikka",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=5)

        ids = [r["id"] for r in results]
        assert ids[0] == "exact"
        assert set(ids) == {"exact", "roast", "tikka"}


def _title_with_padding(word: str, total_tokens: int) -> str:
    """Build a title with exactly `total_tokens` tokens, one of which is
    `word` — lets a test target a precise token-overlap ratio (1/total)."""
    filler = [f"tok{i}" for i in range(total_tokens - 1)]
    return " ".join([word, *filler])


@pytest.mark.asyncio
class TestScoreCutoff:
    async def test_below_cutoff_title_only_match_is_dropped(self) -> None:
        """A title whose only overlap is a single token in a long field
        scores under `_MIN_TITLE_SCORE` (1/25 = 0.04) and, with no
        description/tag signal at all, must not pad the result list."""
        rows = [
            {
                "id": "strong",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "below_cutoff",
                "user_id": "u1",
                "title": _title_with_padding("chicken", 25),
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=5)

        assert [r["id"] for r in results] == ["strong"]

    async def test_near_miss_above_cutoff_still_shown(self) -> None:
        """A weak but real title-only match just above `_MIN_TITLE_SCORE`
        (1/15 = 0.0667) must still surface, ranked below the stronger
        match — the cutoff drops noise, not genuine partial matches."""
        rows = [
            {
                "id": "strong",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "near_miss",
                "user_id": "u1",
                "title": _title_with_padding("chicken", 15),
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=5)

        assert [r["id"] for r in results] == ["strong", "near_miss"]

    async def test_nothing_above_cutoff_returns_empty_list(self) -> None:
        """When the only candidate is a title-only near-zero overlap (no
        description/tag signal at all), the caller gets the same empty list
        it gets today for zero overlap — the `saved_recipe_lookup_response`
        node already turns that into the "couldn't find" + "generate a new
        one instead" reply (`test_zero_matches_offers_to_generate`)."""
        rows = [
            {
                "id": "below_cutoff",
                "user_id": "u1",
                "title": _title_with_padding("chicken", 25),
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=5)

        assert results == []

    async def test_description_only_match_in_a_realistic_length_description_still_shown(
        self,
    ) -> None:
        """Regression for PR #605 re-review finding: a realistic (30-word)
        description naming the dish scores well under any floor that's safe
        for a short title (2/30 title-overlap-style ratio ~= 0.067, weighted
        0.4x = ~0.027), because scores are normalised by field length. The
        cutoff must only ever apply to the title score, so this row —
        genuinely naming the dish, just not in its title — is still
        returned, not silently treated as "no saved recipe"."""
        long_description = (
            "This creamy butter chicken curry is a weeknight favorite that "
            "pairs wonderfully with steamed rice or warm naan bread and only "
            "takes about forty five minutes from start to finish making it "
            "perfect for a cozy family dinner any night of the week really"
        )
        assert len(long_description.split()) >= 30
        rows = [
            {
                "id": "desc_match",
                "user_id": "u1",
                "title": "Weeknight Dinner Idea",
                "description": long_description,
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "butter chicken", limit=5)

        assert [r["id"] for r in results] == ["desc_match"]
