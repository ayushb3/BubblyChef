"""Deterministic ingredient preservation for recipe refine (issues #579, #535).

A refine used to trust the model's fully regenerated ingredient list. A model
asked to "add mushrooms" would hand back the whole recipe with "Pasta" quietly
renamed "Spaghetti" and "Butter" swapped for "Olive Oil", and a second tweak
("no cheese") could lose the mushrooms the first one added. Nothing in the code
noticed, because nothing compared the new list to the old one.

The model's job is now to *report what the instruction touched* (structured
output: ``added`` / ``removed`` / ``changed``), and this module applies only
those edits onto the prior card's own ingredients. An ingredient the model does
not report comes through untouched, byte for byte, whatever the regenerated
list looked like. No text of the user's message is inspected here: which
ingredients an instruction names is the model's structured answer.

Pure functions over ``Ingredient`` objects, no AI and no I/O.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.models.recipe import Ingredient


def _key(name: str) -> str:
    """Comparison key for an ingredient name: lowercase, single-spaced."""
    return " ".join(name.lower().split())


def _keys(name: str) -> set[str]:
    """Every spelling of `name` worth matching on (raw, and its catalog canonical)."""
    raw = _key(name)
    if not raw:
        return set()
    return {raw, _key(normalize_food_name(raw))}


def _tokens(name: str) -> set[str]:
    return {_singular(t) for t in re.findall(r"[a-z0-9%]+", name.lower())}


def _singular(token: str) -> str:
    if len(token) > 3 and token.endswith("ies"):
        return token[:-3] + "y"
    if len(token) > 3 and token.endswith("es") and token[-3] in "sxz":
        return token[:-2]
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _find(name: str, pool: Sequence[Ingredient], *, exact_only: bool = False) -> list[int]:
    """Indices in `pool` that `name` refers to.

    An exact (or catalog-canonical) name match wins alone. Only when nothing
    matches exactly do we fall back to ingredients whose name contains every
    word of `name` ("cheese" finds "parmesan cheese" and "cheddar cheese"),
    so a model that shortens a name still lands on the right rows, while
    "butter" never reaches "peanut butter" when a plain "butter" exists.
    """
    wanted = _keys(name)
    if not wanted:
        return []
    exact = [i for i, ing in enumerate(pool) if wanted & _keys(ing.name)]
    if exact or exact_only:
        return exact
    wanted_tokens = _tokens(name)
    if not wanted_tokens:
        return []
    return [i for i, ing in enumerate(pool) if wanted_tokens <= _tokens(ing.name)]


@dataclass
class AppliedEdits:
    """The prior ingredient list after the model's reported edits."""

    ingredients: list[Ingredient]
    # Prior ingredients the edit list actually dropped.
    removed: list[Ingredient] = field(default_factory=list)
    # Names the model reported but that matched nothing on the prior card; they
    # are ignored (never guessed at) and surfaced for logging.
    unmatched_removals: list[str] = field(default_factory=list)
    unmatched_changes: list[str] = field(default_factory=list)
    # An added name that answers to two or more rows already on the card: which
    # one it updates is unknowable, so it is reported rather than guessed at.
    unmatched_additions: list[str] = field(default_factory=list)


def apply_ingredient_edits(
    previous: Sequence[Ingredient],
    *,
    added: Sequence[Ingredient] = (),
    removed: Sequence[str] = (),
    changed: Sequence[Ingredient] = (),
) -> AppliedEdits:
    """Apply a refine's reported edits onto the previous card's ingredients.

    - Anything not reported keeps its exact name, amount, unit and preparation.
    - ``changed`` targets a prior ingredient by name and updates its amount,
      unit, preparation and optional flag; the name itself is never rewritten,
      so a rename cannot slip in through ``changed`` (a swap is a removal plus
      an addition).
    - ``added`` appends. An added name that an ingredient already on the card
      answers to updates that ingredient instead of duplicating it.
    - ``removed`` drops the ingredient(s) it names. A name matching nothing is
      ignored.

    Edits apply in the order removed, changed, added, so a turn that removes
    "butter" and adds "olive oil" ends with olive oil and no butter.
    """
    working = [ing.model_copy(deep=True) for ing in previous]
    dropped: list[Ingredient] = []
    unmatched_removals: list[str] = []
    unmatched_changes: list[str] = []
    unmatched_additions: list[str] = []

    for name in removed:
        hits = _find(name, working)
        if not hits:
            unmatched_removals.append(name)
            continue
        dropped.extend(working[i] for i in hits)
        working = [ing for i, ing in enumerate(working) if i not in set(hits)]

    def _update(index: int, edit: Ingredient) -> None:
        # Identity stays: name and the substitutes list are the prior card's.
        working[index] = working[index].model_copy(
            update={
                "quantity": edit.quantity,
                "unit": edit.unit,
                "preparation": edit.preparation,
                "optional": edit.optional,
            }
        )

    for edit in changed:
        hits = _find(edit.name, working)
        if len(hits) != 1:
            # No match, or a name too vague to pick one row: guessing would
            # edit an ingredient the user never named.
            unmatched_changes.append(edit.name)
            continue
        _update(hits[0], edit)

    for new in added:
        hits = _find(new.name, working, exact_only=True)
        if len(hits) == 1:
            _update(hits[0], new)
        elif not hits:
            working.append(new.model_copy(deep=True))
        else:
            unmatched_additions.append(new.name)

    return AppliedEdits(
        ingredients=working,
        removed=dropped,
        unmatched_removals=unmatched_removals,
        unmatched_changes=unmatched_changes,
        unmatched_additions=unmatched_additions,
    )


@dataclass
class RefineEdits:
    """The edit list a refine reply reported: what the instruction touched."""

    added: list[Ingredient] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    changed: list[Ingredient] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.added or self.removed or self.changed)

    def carried_into(
        self, retry: "RefineEdits", dropped: Sequence[Ingredient] = ()
    ) -> "RefineEdits":
        """These edits, extended by a corrective re-ask's (never replaced by them).

        The re-ask is about the *steps*, so its own edit list may well be empty
        or partial. A removal the first answer reported stays removed whatever
        the second says, and the second may only add to, or refine, what the
        first reported: an addition or change naming something the first answer
        removed is dropped, since that would quietly bring the ingredient back.
        """
        removed = list(self.removed)
        seen = {_key(n) for n in removed}
        removed += [n for n in retry.removed if _key(n) not in seen]

        # `dropped` are the card's own ingredients those removals resolved to
        # ("cheese" reaching "parmesan cheese"), which is what a re-add would name.
        gone: set[str] = set()
        for name in self.removed:
            gone |= _keys(name)
        for ing in dropped:
            gone |= _keys(ing.name)
        added = list(self.added)
        added_keys = [_keys(i.name) for i in added]
        for ing in retry.added:
            keys = _keys(ing.name)
            if keys & gone or any(keys & existing for existing in added_keys):
                continue
            added.append(ing)
            added_keys.append(keys)

        retry_changed = {_key(i.name) for i in retry.changed}
        changed = [i for i in self.changed if _key(i.name) not in retry_changed]
        changed += [i for i in retry.changed if not _keys(i.name) & gone]
        return RefineEdits(added=added, removed=removed, changed=changed)


def unreported_additions(
    previous: Sequence[Ingredient], regenerated: Sequence[Ingredient], instruction: str
) -> list[Ingredient]:
    """Regenerated ingredients the instruction names that the card doesn't have.

    Only consulted when a reply reported *no* edits. A model that puts mushrooms
    in its list and steps for "add mushrooms" but leaves `added` empty has made
    the edit and merely not reported it, so it is taken. Anything else in the
    regenerated list that the instruction didn't name is still ignored: the
    alternative of accepting every new name would let the drift back in, and
    the alternative of accepting none (a silent no-op) ships steps that cook an
    ingredient the list doesn't have.
    """
    spoken = {_singular(t) for t in re.findall(r"[a-z0-9%]+", instruction.lower())}
    found: list[Ingredient] = []
    for ing in regenerated:
        if _find(ing.name, previous, exact_only=True):
            continue
        name_tokens = _tokens(ing.name)
        if name_tokens and name_tokens <= spoken:
            found.append(ing)
    return found


def name_divergence(
    previous: Sequence[Ingredient], regenerated: Sequence[Ingredient]
) -> tuple[list[str], list[str]]:
    """(names only in the regenerated list, names only on the previous card).

    Compared after catalog normalisation, so case, plurals and known synonyms
    (spaghetti and pasta) don't count as a difference.
    """
    new = [i.name for i in regenerated if not _find(i.name, previous, exact_only=True)]
    gone = [i.name for i in previous if not _find(i.name, regenerated, exact_only=True)]
    return new, gone


def _mention_patterns(
    removed: Iterable[Ingredient], reported_names: Iterable[str], remaining: Sequence[Ingredient]
) -> list[re.Pattern[str]]:
    """Whole-phrase patterns for each removed ingredient's name.

    A phrase that a still-present ingredient also carries ("butter" removed
    while "peanut butter" stays) is skipped, because a step naming it may be
    about the ingredient that is still on the card.
    """
    remaining_tokens = [_tokens(ing.name) for ing in remaining]
    names = [ing.name for ing in removed] + list(reported_names)
    patterns: list[re.Pattern[str]] = []
    seen: set[str] = set()
    for name in names:
        phrase = _key(name)
        if not phrase or phrase in seen:
            continue
        seen.add(phrase)
        if any(_tokens(name) <= tokens for tokens in remaining_tokens):
            continue
        body = r"\s+".join(re.escape(word) for word in phrase.split())
        patterns.append(re.compile(rf"(?<![a-z0-9]){body}(?:e?s)?(?![a-z0-9])", re.IGNORECASE))
    return patterns


def instructions_mentioning_removed(
    instructions: Sequence[str],
    *,
    removed: Sequence[Ingredient],
    reported_names: Sequence[str],
    remaining: Sequence[Ingredient],
) -> list[int]:
    """Indices of instructions that still name an ingredient the refine removed.

    `reported_names` is what the model called the removals ("cheese"); `removed`
    are the prior-card ingredients they resolved to ("parmesan cheese"). Both
    spellings count, since a step is as likely to say either.
    """
    patterns = _mention_patterns(removed, reported_names, remaining)
    if not patterns:
        return []
    return [
        i
        for i, text in enumerate(instructions)
        if any(pattern.search(text) for pattern in patterns)
    ]
