"""How hard the user wants expiring food pushed into suggestions (issue #502, Spec B.10).

The profile's `expiry_priority` setting, three levels:

* `off`        -- expiring food gets no special treatment: no urgency points when
                  ranking the pantry, no "expiring soon" block or rule in a prompt.
* `gentle`     -- the default, and what every user had before the setting existed: a
                  nudge the model may decline when an expiring item doesn't belong.
* `aggressive` -- build around expiring food wherever it can work.

Whatever the level, an explicit dish request (a named dish, a cuisine, "must use"
ingredients) wins: expiring items are added only where they fit.

Pure: no I/O. `services.expiry_priority` reads the stored value.
"""

from typing import Literal, get_args

ExpiryPriority = Literal["off", "gentle", "aggressive"]

EXPIRY_PRIORITIES: tuple[str, ...] = get_args(ExpiryPriority)
DEFAULT_EXPIRY_PRIORITY: ExpiryPriority = "gentle"

# `score_and_rank` urgency points as (expires within 3 days, expires within 7 days).
_URGENCY_WEIGHTS: dict[ExpiryPriority, tuple[int, int]] = {
    "off": (0, 0),
    "gentle": (4, 2),
    "aggressive": (8, 5),
}


def coerce_expiry_priority(raw: object) -> ExpiryPriority:
    """`raw` as a level, or the default (Gentle) when it is missing or not a known level.

    A profile row from before the column existed, a NULL, or a stray string must all
    behave as Gentle rather than raise.
    """
    if isinstance(raw, str):
        key = raw.strip().lower()
        if key == "off":
            return "off"
        if key == "gentle":
            return "gentle"
        if key == "aggressive":
            return "aggressive"
    return DEFAULT_EXPIRY_PRIORITY


def urgency_weights(priority: ExpiryPriority) -> tuple[int, int]:
    """Points an item earns for expiring within 3 days, and within 7 days."""
    return _URGENCY_WEIGHTS[priority]
