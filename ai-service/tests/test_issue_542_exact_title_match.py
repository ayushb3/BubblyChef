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

Revised again (3rd re-review pass, 2026-09-23) for two further gaps:

4. The exact-match comparison tokenized its two sides differently: the query
   went through `_tokenize_query` (stopwords stripped) but the title went
   through `_tokenize` (stopwords kept, deliberately, for the ranked-scoring
   path below). A saved title containing a stopword ("Chicken and Rice",
   "Mac and Cheese", "Pasta with Pesto", "One Pot Chicken") could never equal
   the stripped query tokens, so the short-circuit never fired for it — and
   it also tripped the strict-superset guard, suppressing the short-circuit
   even when it was the only saved recipe. Both sides are now tokenized with
   `_tokenize_query` for this comparison.
5. The absolute `_MIN_TITLE_SCORE` floor only ever fired against a title of
   21+ tokens (1/21 ≈ 0.048 < 0.05); every realistic title (2-5 tokens)
   scored well above it on a single shared word, so the "score cutoff" half
   of #542's scope did nothing against the issue's actual padded-list
   scenario. `search_saved_recipes` now instead drops a title-only match
   that's missing at least one query token when another candidate's title
   contains *every* query token (`TestFullQueryCoverageCutoff` below) — the
   generalisation of the exact-match short-circuit to a title with an exact
   match plus extra words ("Butter Chicken Curry" for query "butter
   chicken"). The dead absolute floor and its three synthetic-title tests
   (`_title_with_padding(..., 25/15)`) were removed on the 4th re-review
   pass — they never fired on any realistic input, and the coverage cutoff
   above already covers the real scenario.

Revised again (4th re-review pass, 2026-09-23): Ayush confirmed the
coverage cutoff should auto-pick when it leaves exactly one candidate, not
just narrow the list — pinned at the node level in
`TestCoverageCutoffAutoPick` below (`test_issue_542_exact_title_match.py`),
alongside its counter-case (two candidates that both have full coverage
still get the ranked "which one?" list).

Follows the `_FakeClient`/`_FakeQuery` pattern from
`test_issue_493_saved_recipe_search.py`.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.workflows.chat.nodes import saved_recipe_lookup_response


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


@pytest.mark.asyncio
class TestExactMatchStopwordTokenization:
    """Regression for PR #605 3rd re-review finding 1: the exact-match
    comparison must tokenize the title the same way it tokenizes the query
    (`_tokenize_query`, stopwords stripped), or a title containing a
    stopword can never short-circuit."""

    @pytest.mark.parametrize(
        ("title", "query"),
        [
            ("Chicken and Rice", "chicken rice"),
            ("Mac and Cheese", "mac cheese"),
            ("Pasta with Pesto", "pasta pesto"),
            ("One Pot Chicken", "pot chicken"),
        ],
    )
    async def test_stopword_title_only_recipe_returns_that_recipe_alone(
        self, title: str, query: str
    ) -> None:
        """The only saved recipe has a stopword in its title; asking for it
        by the stopword-stripped query must return it, not an empty/padded
        result caused by the two sides tokenizing differently."""
        rows = [
            {
                "id": "exact",
                "user_id": "u1",
                "title": title,
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", query, limit=5)

        assert [r["id"] for r in results] == ["exact"]

    @pytest.mark.parametrize(
        ("title", "query"),
        [
            ("Chicken and Rice", "chicken rice"),
            ("Mac and Cheese", "mac cheese"),
            ("Pasta with Pesto", "pasta pesto"),
            ("One Pot Chicken", "pot chicken"),
        ],
    )
    async def test_stopword_title_exact_match_among_several_saved_recipes(
        self, title: str, query: str
    ) -> None:
        """Same stopword-title equality, but with other saved recipes in the
        pool that don't match at all — the exact match must still be
        isolated from unrelated candidates, not padded or dropped."""
        rows = [
            {
                "id": "exact",
                "user_id": "u1",
                "title": title,
                "description": "",
                "tags": [],
            },
            {
                "id": "unrelated1",
                "user_id": "u1",
                "title": "Blueberry Pancakes",
                "description": "",
                "tags": [],
            },
            {
                "id": "unrelated2",
                "user_id": "u1",
                "title": "Garden Salad",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", query, limit=5)

        assert [r["id"] for r in results] == ["exact"]


@pytest.mark.asyncio
class TestScoreCutoff:
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


@pytest.mark.asyncio
class TestFullQueryCoverageCutoff:
    """Regression for PR #605 3rd re-review finding 2: `_MIN_TITLE_SCORE`
    never fires against realistic (2-5 token) titles, so #542's actual
    complaint — a multi-word query returns a padded list of titles that
    share only one word with it — was untouched by the first cutoff pass.

    These use titles of realistic length (2-4 tokens), the same shape as
    the issue's own scenario, not synthetic padding built to straddle a
    constant.
    """

    async def test_padded_list_from_the_issue_scenario_is_shortened(self) -> None:
        """Query 'butter chicken' against a saved 'Butter Chicken Curry'
        (contains every query word, plus one) alongside several
        'chicken'-only matches that were the padding #542 complained about.
        Once a title contains the full query, the chicken-only rows are
        dropped rather than padding the list out to `limit`."""
        rows = [
            {
                "id": "full_coverage",
                "user_id": "u1",
                "title": "Butter Chicken Curry",
                "description": "",
                "tags": [],
            },
            {
                "id": "chicken_only_1",
                "user_id": "u1",
                "title": "Chicken Tikka Masala Bowl",
                "description": "",
                "tags": [],
            },
            {
                "id": "chicken_only_2",
                "user_id": "u1",
                "title": "Chicken Noodle Soup Recipe",
                "description": "",
                "tags": [],
            },
            {
                "id": "chicken_only_3",
                "user_id": "u1",
                "title": "Grilled Chicken Skewers Plate",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "butter chicken", limit=5)

        assert [r["id"] for r in results] == ["full_coverage"]

    async def test_partial_matches_survive_when_nothing_has_full_coverage(self) -> None:
        """No saved title contains every query word, so there's nothing to
        prefer over the partial matches — the cutoff must not empty the
        list just because every candidate is partial."""
        rows = [
            {
                "id": "roast",
                "user_id": "u1",
                "title": "Roast Chicken",
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

        results = await repo.search_saved_recipes("u1", "butter chicken", limit=5)

        assert {r["id"] for r in results} == {"roast", "tikka"}

    async def test_description_only_match_survives_alongside_a_full_coverage_title(
        self,
    ) -> None:
        """A row with no title overlap at all, but a description that names
        the dish, must still surface even when another candidate's title
        has full query coverage — the coverage cutoff only drops rows with
        no independent desc/tag signal."""
        rows = [
            {
                "id": "full_coverage",
                "user_id": "u1",
                "title": "Butter Chicken Curry",
                "description": "",
                "tags": [],
            },
            {
                "id": "desc_match",
                "user_id": "u1",
                "title": "Weeknight Dinner Idea",
                "description": (
                    "This creamy butter chicken curry is a weeknight favorite that "
                    "pairs wonderfully with steamed rice or warm naan bread and only "
                    "takes about forty five minutes from start to finish making it "
                    "perfect for a cozy family dinner any night of the week really"
                ),
                "tags": [],
            },
            {
                "id": "chicken_only",
                "user_id": "u1",
                "title": "Chicken Noodle Soup Recipe",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "butter chicken", limit=5)

        ids = {r["id"] for r in results}
        assert "full_coverage" in ids
        assert "desc_match" in ids
        assert "chicken_only" not in ids

    async def test_single_token_query_unaffected_by_coverage_cutoff(self) -> None:
        """A single-token query trivially gives every containing title 'full
        coverage', so this cutoff must never fire for it — that's what keeps
        `TestExactTitleMatch.test_single_token_query_matching_several_titles_keeps_the_list`
        (a real, already-fixed scenario) intact. Same shape, checked directly
        against the coverage rule rather than the short-circuit."""
        rows = [
            {
                "id": "roast",
                "user_id": "u1",
                "title": "Roast Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "stock",
                "user_id": "u1",
                "title": "Chicken Stock Notes",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=5)

        assert {r["id"] for r in results} == {"roast", "stock"}


def _patch_repo(matches: list[dict[str, Any]]) -> Any:
    """Same pattern as `test_issue_493_saved_recipe_lookup._patch_repo` — the
    node under test only ever sees what `search_saved_recipes` returns, so
    the coverage-cutoff arithmetic itself doesn't need to run here; that's
    covered directly by `TestFullQueryCoverageCutoff` above."""
    repo = MagicMock()
    repo.search_saved_recipes = AsyncMock(return_value=matches)
    repo.get_user_recipes = AsyncMock(return_value=[])
    return patch(
        "bubbly_chef.workflows.chat.nodes.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    )


def _node_state(input_text: str) -> dict[str, Any]:
    return {
        "input_text": input_text,
        "user_id": "u1",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
    }


@pytest.mark.asyncio
class TestCoverageCutoffAutoPick:
    """Regression for PR #605 4th re-review finding 1: Ayush confirmed the
    coverage cutoff should auto-pick, not just narrow the list — when it
    leaves exactly one candidate, the node replies with a confident "Found
    it", the same as any other single-match result. This pins the node-level
    behaviour those upstream tokens produce, not the repository arithmetic
    (already covered by `TestFullQueryCoverageCutoff`)."""

    async def test_full_coverage_cutoff_down_to_one_match_auto_picks(self) -> None:
        """"butter chicken" against a saved "Butter Chicken Curry" — the
        repository's coverage cutoff drops the weaker "chicken"-only rows,
        so the node receives a single match and must announce it directly
        rather than asking "which one?"."""
        matches = [{"id": "full_coverage", "title": "Butter Chicken Curry"}]
        with _patch_repo(matches):
            result = await saved_recipe_lookup_response(
                _node_state("show me my saved butter chicken")
            )

        message = result["assistant_message"]
        assert message == "Found it — your saved Butter Chicken Curry!"
        assert [m["id"] for m in result["saved_recipe_matches"]] == ["full_coverage"]

    async def test_two_full_coverage_matches_still_lists_and_asks(self) -> None:
        """Counter-case: when two saved titles both cover every query token,
        the coverage cutoff can't prefer one over the other, so the node
        still receives both and must fall back to the ranked "which one?"
        list rather than guessing."""
        matches = [
            {"id": "curry", "title": "Butter Chicken Curry"},
            {"id": "bowl", "title": "Butter Chicken Bowl"},
        ]
        with _patch_repo(matches):
            result = await saved_recipe_lookup_response(
                _node_state("show me my saved butter chicken")
            )

        message = result["assistant_message"]
        assert "I found a few saved recipes" in message
        assert "Butter Chicken Curry" in message
        assert "Butter Chicken Bowl" in message
        assert message.strip().endswith("?")
        assert [m["id"] for m in result["saved_recipe_matches"]] == ["curry", "bowl"]
