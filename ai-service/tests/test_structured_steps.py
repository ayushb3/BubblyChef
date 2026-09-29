"""Structured recipe steps (issue #648) — validator + builder unit tests.

Covers every validation rule from issue #647's "Structured steps" section:
missing duration estimated (from text, or a 3-minute fallback) and flagged;
`depends_on` null -> previous step, explicit [] -> no dependencies, a
forward/self reference dropped; a missing `hands_on` defaults to True;
labels trimmed and capped; a step-count mismatch (or any other validation
failure) rejects the whole set rather than raising.
"""

from bubbly_chef.models.recipe import (
    StepMetadata,
    StructuredStep,
    build_structured_steps,
)


# ---------------------------------------------------------------------------
# duration_minutes / duration_estimated
# ---------------------------------------------------------------------------


class TestDurationDefaulting:
    def test_missing_duration_is_estimated_from_text(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Simmer the sauce for 15 minutes", "label": "Simmer the sauce"},
            context={"index": 0},
        )
        assert step.duration_minutes == 15
        assert step.duration_estimated is True

    def test_missing_duration_with_no_phrase_falls_back_to_three(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Season to taste", "label": "Season"},
            context={"index": 0},
        )
        assert step.duration_minutes == 3
        assert step.duration_estimated is True

    def test_duration_range_phrase_uses_the_midpoint(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Bake for 20-30 minutes", "label": "Bake"},
            context={"index": 0},
        )
        assert step.duration_minutes == 25
        assert step.duration_estimated is True

    def test_hour_phrase_is_converted_to_minutes(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Marinate for 1 hour", "label": "Marinate"},
            context={"index": 0},
        )
        assert step.duration_minutes == 60
        assert step.duration_estimated is True

    def test_explicit_duration_is_not_flagged_estimated(self) -> None:
        step = StructuredStep.model_validate(
            {
                "text": "Simmer the sauce for 15 minutes",
                "label": "Simmer the sauce",
                "duration_minutes": 12,
            },
            context={"index": 0},
        )
        assert step.duration_minutes == 12
        assert step.duration_estimated is False

    def test_explicit_duration_estimated_flag_is_preserved(self) -> None:
        """Round-tripping an already-persisted step must not re-derive the flag."""
        step = StructuredStep.model_validate(
            {
                "text": "Simmer the sauce for 15 minutes",
                "label": "Simmer the sauce",
                "duration_minutes": 15,
                "duration_estimated": True,
            }
        )
        assert step.duration_estimated is True


# ---------------------------------------------------------------------------
# hands_on
# ---------------------------------------------------------------------------


class TestHandsOnDefaulting:
    def test_missing_hands_on_defaults_to_true(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Simmer the sauce", "label": "Simmer"}, context={"index": 0}
        )
        assert step.hands_on is True

    def test_explicit_hands_off_is_preserved(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Simmer the sauce", "label": "Simmer", "hands_on": False},
            context={"index": 0},
        )
        assert step.hands_on is False


# ---------------------------------------------------------------------------
# depends_on
# ---------------------------------------------------------------------------


class TestDependsOnNormalization:
    def test_null_depends_on_means_the_previous_step(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Add the garlic", "label": "Add garlic"}, context={"index": 3}
        )
        assert step.depends_on == [2]

    def test_null_depends_on_at_step_zero_means_no_dependencies(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Boil water", "label": "Boil water"}, context={"index": 0}
        )
        assert step.depends_on == []

    def test_explicit_empty_list_means_no_dependencies(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Boil water", "label": "Boil water", "depends_on": []},
            context={"index": 5},
        )
        assert step.depends_on == []

    def test_forward_reference_is_dropped(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Plate the dish", "label": "Plate", "depends_on": [0, 5]},
            context={"index": 2},
        )
        assert step.depends_on == [0]

    def test_self_reference_is_dropped(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Plate the dish", "label": "Plate", "depends_on": [2]},
            context={"index": 2},
        )
        assert step.depends_on == []

    def test_every_index_dropped_leaves_an_explicit_empty_list(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Start cooking", "label": "Start", "depends_on": [4, 9]},
            context={"index": 1},
        )
        assert step.depends_on == []


# ---------------------------------------------------------------------------
# label / ongoing_label
# ---------------------------------------------------------------------------


class TestLabelTrimAndCap:
    def test_label_is_trimmed(self) -> None:
        step = StructuredStep.model_validate(
            {"text": "Boil the pasta", "label": "  Boil the pasta  "},
            context={"index": 0},
        )
        assert step.label == "Boil the pasta"

    def test_label_is_capped(self) -> None:
        long_label = "Boil " * 20
        step = StructuredStep.model_validate(
            {"text": "Boil the pasta", "label": long_label}, context={"index": 0}
        )
        assert len(step.label) <= 60

    def test_ongoing_label_is_trimmed_and_capped(self) -> None:
        step = StructuredStep.model_validate(
            {
                "text": "Simmer the sauce",
                "label": "Simmer",
                "ongoing_label": "  " + "the sauce reduces " * 10,
            },
            context={"index": 0},
        )
        assert step.ongoing_label is not None
        assert step.ongoing_label == step.ongoing_label.strip()
        assert len(step.ongoing_label) <= 60


# ---------------------------------------------------------------------------
# build_structured_steps — the per-generation-path entry point
# ---------------------------------------------------------------------------


class TestBuildStructuredSteps:
    def test_zips_metadata_with_instruction_text(self) -> None:
        instructions = ["Boil the pasta", "Drain and toss with sauce"]
        meta = [
            StepMetadata(label="Boil pasta", hands_on=False, ongoing_label="the pasta boils"),
            StepMetadata(label="Toss with sauce"),
        ]
        steps = build_structured_steps(meta, instructions)

        assert steps is not None
        assert len(steps) == 2
        assert [s.text for s in steps] == instructions
        assert steps[0].hands_on is False
        assert steps[1].depends_on == [0]

    def test_accepts_plain_dicts_too(self) -> None:
        instructions = ["Boil the pasta"]
        steps = build_structured_steps([{"label": "Boil pasta"}], instructions)

        assert steps is not None
        assert steps[0].text == "Boil the pasta"

    def test_count_mismatch_rejects_the_whole_set(self) -> None:
        instructions = ["Boil the pasta", "Drain it"]
        meta = [StepMetadata(label="Boil pasta")]

        assert build_structured_steps(meta, instructions) is None

    def test_out_of_range_duration_is_clamped_not_rejected(self) -> None:
        """One long step ("marinate overnight") must not discard the whole
        set -- on the ensure path that would re-fire a model call on every
        cook-mode open (PR #655 review). It's clamped to 1-240 and flagged."""
        instructions = ["Marinate overnight", "Sear the chicken"]
        meta = [
            {"label": "Marinate", "duration_minutes": 480, "hands_on": False},
            {"label": "Sear", "duration_minutes": 0},
        ]
        steps = build_structured_steps(meta, instructions)

        assert steps is not None
        assert steps[0].duration_minutes == 240
        assert steps[0].duration_estimated is True
        assert steps[1].duration_minutes == 1
        assert steps[1].duration_estimated is True

    def test_in_range_explicit_duration_is_not_flagged_by_the_clamp(self) -> None:
        steps = build_structured_steps([{"label": "Boil", "duration_minutes": 240}], ["Boil"])

        assert steps is not None
        assert steps[0].duration_minutes == 240
        assert steps[0].duration_estimated is False

    def test_invalid_field_type_still_rejects_the_whole_set(self) -> None:
        """A malformed structured-output call (wrong type, not just out of
        range) is still discarded rather than raising, so it never fails the
        caller."""
        meta = [{"label": "Roast", "duration_minutes": "a while"}]

        assert build_structured_steps(meta, ["Roast"]) is None

    def test_empty_is_valid(self) -> None:
        assert build_structured_steps([], []) == []
