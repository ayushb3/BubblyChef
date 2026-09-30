"""Applying a structured "I no longer follow this diet" to what chat remembers (#687).

The extractor decides; this module only applies what it returned. Nothing here reads
the user's message, and `resolve_diet_change` takes no text on purpose: clearing a
diet by pattern-matching the message was rejected after three review rounds, because
"I'm not a vegetarian but my partner is", "we're not vegan tonight", "no longer
vegan?" and "that's not vegetarian!" all looked like removals. So a diet is cleared
only when the structured `DietChanges` says so, and every doubt keeps it: keeping a
diet is the safe direction.

Three sources of diet labels are kept apart:

* ``session``: what the conversation remembered (`session.metadata.recipe_constraints`).
  This is the only thing a removal can clear.
* ``stored``: the profile's dietary preferences. Never changed and never relaxed from
  chat; the user is told so and pointed at their profile.
* ``fresh``: a diet this same message names. A removal of a diet the same extraction
  also names is self-contradictory, so the diet is kept.
"""

from dataclasses import dataclass, field

from bubbly_chef.domain.diet_terms import norm_label
from bubbly_chef.models.recipe import DietChanges


@dataclass(frozen=True)
class DietChangeOutcome:
    """What a `DietChanges` did to the labels chat holds."""

    # Session labels cleared for the rest of the conversation (scope "conversation").
    dropped: list[str] = field(default_factory=list)
    # Session labels set aside for this request only (scope "this_request"); they come
    # back on the next turn.
    relaxed: list[str] = field(default_factory=list)
    # Labels the user asked to drop that the profile holds. Kept, whatever the scope.
    kept_by_profile: list[str] = field(default_factory=list)

    @property
    def acted(self) -> bool:
        """True when the turn should be answered as a diet change."""
        return bool(self.dropped or self.relaxed or self.kept_by_profile)


def resolve_diet_change(
    changes: DietChanges | None,
    session: list[str],
    stored: list[str],
    fresh: list[str],
) -> DietChangeOutcome:
    """Decide which held labels `changes` actually clears.

    Labels are compared through `norm_label`, so "dairy free" matches "Dairy-Free".
    A removal of a label nothing holds does nothing. A removal of a label this same
    message also names (`fresh`) is ignored. A profile label is reported in
    `kept_by_profile` and never in `dropped` or `relaxed`, even when the chat also
    holds a copy of it (the copy is cleared, the profile still applies).
    """
    if changes is None or not changes.remove:
        return DietChangeOutcome()

    fresh_keys = {norm_label(label) for label in fresh}
    session_by_key = {norm_label(label): label for label in session}
    stored_by_key = {norm_label(label): label for label in stored}

    dropped: list[str] = []
    relaxed: list[str] = []
    kept_by_profile: list[str] = []
    seen: set[str] = set()
    for requested in changes.remove:
        key = norm_label(requested)
        if not key or key in seen or key in fresh_keys:
            continue
        seen.add(key)
        if key in stored_by_key:
            kept_by_profile.append(stored_by_key[key])
        if key in session_by_key:
            if changes.scope == "conversation":
                dropped.append(session_by_key[key])
            else:
                relaxed.append(session_by_key[key])
    return DietChangeOutcome(dropped=dropped, relaxed=relaxed, kept_by_profile=kept_by_profile)


def _join(labels: list[str]) -> str:
    if len(labels) <= 1:
        return "".join(labels)
    return ", ".join(labels[:-1]) + " and " + labels[-1]


def diet_change_reply(outcome: DietChangeOutcome) -> str:
    """The assistant's answer to a diet change, built from the outcome alone.

    Deterministic on purpose: the reply states what actually happened to the diets,
    which a free-text model reply could get wrong in either direction.
    """
    # A label the profile also holds is never dropped or relaxed in effect: the profile
    # read re-adds it every turn. Saying "dropped" or "set aside" for it would be false,
    # so only the profile sentence below talks about it.
    profile_keys = {norm_label(label) for label in outcome.kept_by_profile}
    dropped = [label for label in outcome.dropped if norm_label(label) not in profile_keys]
    relaxed = [label for label in outcome.relaxed if norm_label(label) not in profile_keys]

    parts: list[str] = []
    if dropped:
        parts.append(f"Okay, I've dropped {_join(dropped)} for the rest of this chat.")
    if relaxed:
        parts.append(
            f"Got it. {_join(relaxed)} stays on for this chat, but I'll set it "
            "aside for a dish you ask for that goes against it."
        )
    if outcome.kept_by_profile:
        parts.append(
            f"{_join(outcome.kept_by_profile)} is also saved in your profile, so I'll "
            "keep following it. You can change that in your profile settings."
        )
    return " ".join(parts)
