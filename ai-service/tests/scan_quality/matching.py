"""Pure scoring for the scan quality bar (issue #255).

No network, no AI, no filesystem: given the items the scan produced and the
items a human read off the receipt, decide which are right. Kept separate from
the live runner so the matching rule itself is unit-tested in the default suite.

The matching rule (documented in ``README.md`` next to this file):

1. **Name** - both sides are normalized (lowercased, punctuation and digits
   dropped, each word singularized) and compared as word sets. An expected item
   matches a scanned item when either word set contains the other, against the
   scanned ``name`` or its ``original_name``/``source_line``, or against any
   expected ``aliases``. So ``"gala apples"`` matches a scanned ``"apple"`` and
   ``"ground beef 80/20"`` matches ``"ground beef"``, but ``"spinach"`` never
   matches ``"spaghetti"``.
2. **Quantity** - only checked when the expected item lists a ``quantity``
   (a number, or a list of equally defensible readings such as ``[1, 12]`` for
   "1 DZ"). A scanned quantity passes if it is within
   ``max(QUANTITY_ABS_TOL, QUANTITY_REL_TOL * expected)`` of any listed value.
   Units are not compared: parsers legitimately say ``1 dozen`` or ``12 count``.
3. **One-to-one** - each scanned item can satisfy at most one expected item, so
   a single "milk" line cannot pay for two expected milks.

Accuracy for a receipt is ``correct / (expected + spurious)``: a missed item,
a wrong-quantity item and an invented item (a ``TOTAL`` line scanned as food)
each cost the same.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from typing import Any

# A scanned quantity within this absolute distance of an expected one passes
# (so 1 vs 1.5 is fine, 1 vs 2 is not) ...
QUANTITY_ABS_TOL = 0.5
# ... or within this fraction of it, for larger counts (12 +/- 1.2).
QUANTITY_REL_TOL = 0.10

_NON_WORD = re.compile(r"[^a-z\s]+")


def _singular(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("oes"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def name_tokens(name: str) -> frozenset[str]:
    """Normalize a food name to a set of singular lowercase words.

    Digits are dropped on purpose ("80/20", "32oz", "1 lb") so a size on the
    receipt line never decides whether the food matches.
    """
    cleaned = _NON_WORD.sub(" ", name.lower())
    return frozenset(_singular(w) for w in cleaned.split() if len(w) > 1)


def names_match(expected: str, scanned: str) -> bool:
    """True when one name's words are a subset of the other's (both non-empty)."""
    a, b = name_tokens(expected), name_tokens(scanned)
    if not a or not b:
        return False
    return a <= b or b <= a


def quantity_ok(expected: float | list[float] | None, scanned: float | None) -> bool:
    """Apply the quantity tolerance. ``None`` expected means 'not checked'."""
    if expected is None:
        return True
    if scanned is None:
        return False
    candidates = expected if isinstance(expected, list) else [expected]
    return any(
        abs(scanned - want) <= max(QUANTITY_ABS_TOL, QUANTITY_REL_TOL * want)
        for want in candidates
    )


@dataclass(frozen=True)
class ExpectedItem:
    """One line item a human read off the receipt."""

    name: str
    quantity: float | list[float] | None = None
    aliases: tuple[str, ...] = ()

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> ExpectedItem:
        qty = raw.get("quantity")
        if isinstance(qty, list):
            qty = [float(q) for q in qty]
        elif qty is not None:
            qty = float(qty)
        return cls(name=str(raw["name"]), quantity=qty, aliases=tuple(raw.get("aliases", [])))


@dataclass(frozen=True)
class ScannedItem:
    """A line item the scan surfaced to the user (ready_to_add or needs_review)."""

    name: str
    original_name: str = ""
    source_line: str = ""
    quantity: float | None = None
    confidence: float = 0.0

    @classmethod
    def from_response(cls, raw: dict[str, Any]) -> ScannedItem:
        qty = raw.get("quantity")
        return cls(
            name=str(raw.get("name") or ""),
            original_name=str(raw.get("original_name") or ""),
            source_line=str(raw.get("source_line") or ""),
            quantity=float(qty) if isinstance(qty, (int, float)) else None,
            confidence=float(raw.get("confidence") or 0.0),
        )

    def labels(self) -> list[str]:
        return [s for s in (self.name, self.original_name, self.source_line) if s]


@dataclass
class ReceiptScore:
    """Outcome of scoring one receipt."""

    expected_count: int
    correct: list[str] = field(default_factory=list)
    # (expected name, why) for expected items the scan got wrong or missed.
    missed: list[tuple[str, str]] = field(default_factory=list)
    spurious: list[str] = field(default_factory=list)

    @property
    def accuracy(self) -> float:
        denom = self.expected_count + len(self.spurious)
        return len(self.correct) / denom if denom else 1.0


def score_receipt(expected: list[ExpectedItem], scanned: list[ScannedItem]) -> ReceiptScore:
    """Match ``scanned`` against ``expected`` one-to-one and score it."""
    score = ReceiptScore(expected_count=len(expected))
    unused = list(range(len(scanned)))

    for exp in expected:
        names = [exp.name, *exp.aliases]
        name_hits = [
            i for i in unused if any(names_match(n, lbl) for n in names for lbl in scanned[i].labels())
        ]
        if not name_hits:
            score.missed.append((exp.name, "not found"))
            continue
        # Prefer a hit whose quantity also passes, so an earlier wrong-quantity
        # duplicate cannot shadow a right one.
        good = [i for i in name_hits if quantity_ok(exp.quantity, scanned[i].quantity)]
        if not good:
            got = scanned[name_hits[0]].quantity
            score.missed.append((exp.name, f"quantity {got} vs expected {exp.quantity}"))
            unused.remove(name_hits[0])  # it matched by name, so it is not 'spurious'
            continue
        unused.remove(good[0])
        score.correct.append(exp.name)

    score.spurious = [scanned[i].name or scanned[i].source_line for i in unused]
    return score


def overall_accuracy(scores: list[ReceiptScore]) -> float:
    """Pooled accuracy across receipts (every line item weighs the same)."""
    correct = sum(len(s.correct) for s in scores)
    denom = sum(s.expected_count + len(s.spurious) for s in scores)
    return correct / denom if denom else 1.0


def median_seconds(durations: list[float]) -> float:
    return statistics.median(durations) if durations else 0.0
