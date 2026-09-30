"""Server-side outcome of a pantry proposal turn (issue #444).

A pantry proposal card is only actionable while its outcome is unknown. The
outcome is recorded on the persisted assistant turn, at
`conversation_history.metadata.proposal_review`, so a restored card (same
browser, another device) never re-offers a row that already landed -- that
would write a duplicate pantry row (issue #127).

Contract: docs/plans/2026-09-30-issue-444-proposal-state-contract.md.

Two halves:
- pure functions (`own_keys`, `read_review`, `review_after_apply`,
  `review_after_reject`, `already_applied`, and the save-time
  `metadata_for_save`), with no I/O;
- `apply_pantry_with_review` / `reject_with_review`, the orchestration the
  routes delegate to.
"""

import logging
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from bubbly_chef.models.proposals import FailedRow, ProposalReview
from bubbly_chef.models.requests import (
    ApplyRequest,
    ApplyResponse,
    RejectRequest,
    RejectResponse,
)
from bubbly_chef.repository.supabase_repo import PantryApplyResult, SupabaseRepository

logger = logging.getLogger(__name__)

# Shown to the user when the already-applied check can't run; nothing was written.
_GUARD_READ_FAILED = "Couldn't check what was already added — try again"


def proposal_action_key(name: str) -> str:
    """Identity of a proposal row: its name, trimmed and lower-cased.

    Must stay the same expression as the frontend's `proposalActionKey` in
    `nextjs/src/types/chat.ts` (`a.item.name.trim().toLowerCase()`).
    """
    return name.strip().lower()


# ---------------------------------------------------------------------------
# Save-time stamping
# ---------------------------------------------------------------------------


def is_pantry_proposal_turn(envelope: dict[str, Any] | None) -> bool:
    """A `pantry_update` envelope with a proposal (zero-action, vague-only turns
    included) and a usable `request_id` -- the turns that get stamped, and that
    must be saved before the envelope reaches the client."""
    if not envelope:
        return False
    request_id = envelope.get("request_id")
    return (
        envelope.get("intent") == "pantry_update"
        and envelope.get("proposal") is not None
        and isinstance(request_id, str)
        and bool(request_id)
    )


def metadata_for_save(envelope: dict[str, Any] | None) -> dict[str, Any] | None:
    """The `metadata` to persist for an assistant turn.

    Pantry proposal turns get the envelope's `request_id` stamped in, which is
    the key apply and reject use to find the row. Every other turn is saved
    exactly as before.
    """
    if envelope is None:
        return None
    metadata = envelope.get("metadata")
    if not is_pantry_proposal_turn(envelope):
        return metadata if isinstance(metadata, dict) else None
    base = metadata if isinstance(metadata, dict) else {}
    return {**base, "request_id": envelope["request_id"]}


# ---------------------------------------------------------------------------
# Pure logic
# ---------------------------------------------------------------------------


def own_keys(turn_row: dict[str, Any]) -> set[str]:
    """Keys of a turn's own persisted rows (`proposal.actions[*].item.name`).

    Tolerant: anything malformed contributes nothing, and it never raises.
    """
    proposal = turn_row.get("proposal")
    if not isinstance(proposal, dict):
        return set()
    actions = proposal.get("actions")
    if not isinstance(actions, list):
        return set()
    keys: set[str] = set()
    for action in actions:
        if not isinstance(action, dict):
            continue
        item = action.get("item")
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if isinstance(name, str) and name.strip():
            keys.add(proposal_action_key(name))
    return keys


def read_review(metadata: Any) -> ProposalReview | None:
    """The turn's recorded review, or None when absent or malformed."""
    if not isinstance(metadata, dict):
        return None
    raw = metadata.get("proposal_review")
    if raw is None:
        return None
    try:
        return ProposalReview.model_validate(raw)
    except ValidationError as err:
        logger.warning(f"Ignoring malformed proposal_review: {err}")
        return None


def already_applied(turn_rows: list[dict[str, Any]]) -> set[str]:
    """Union of `applied_keys` across the named turns."""
    keys: set[str] = set()
    for row in turn_rows:
        review = read_review(row.get("metadata"))
        if review is not None:
            keys.update(review.applied_keys)
    return keys


def _sent_key(action: Any) -> str:
    """Key of a flat apply action (`{action, name, quantity, unit, ...}`)."""
    if not isinstance(action, dict):
        return ""
    name = action.get("name")
    return proposal_action_key(name) if isinstance(name, str) else ""


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def review_after_apply(
    turn_row: dict[str, Any],
    sent_actions: list[dict[str, Any]],
    failed_indices: list[int],
    failed_errors: dict[int, str],
    chain_request_ids: list[str],
    now: datetime,
    dropped_keys: Sequence[str] = (),
) -> ProposalReview:
    """The review to record on one chain turn after an apply attempt.

    `sent_actions` is the list actually handed to the repository (after the
    already-applied guard); `failed_indices` and the keys of `failed_errors`
    index into it. `dropped_keys` are the rows the guard removed because a
    sibling turn had already applied them: this turn's own rows among them are
    credited as applied, so a stale-tab merge doesn't leave them live.
    """
    own = own_keys(turn_row)
    previous = read_review(turn_row.get("metadata"))
    applied_keys = list(previous.applied_keys) if previous else []
    failed_positions = set(failed_indices)

    failed_rows: list[FailedRow] = []
    error: str | None = None
    seen: set[str] = set()
    for index, action in enumerate(sent_actions):
        key = _sent_key(action)
        if key not in own or key in seen:
            continue
        seen.add(key)
        if index in failed_positions:
            if key in applied_keys:
                continue  # already landed earlier: not a live row
            unit = action.get("unit")
            failed_rows.append(
                FailedRow(
                    key=key,
                    name=str(action.get("name")),
                    quantity=_as_float(action.get("quantity")),
                    unit=unit if isinstance(unit, str) else None,
                )
            )
            if error is None:
                error = failed_errors.get(index)
        elif key not in applied_keys:
            applied_keys.append(key)

    for key in dropped_keys:
        if key in own and key not in applied_keys:
            applied_keys.append(key)

    live = own - set(applied_keys)
    return ProposalReview(
        status="failed" if live else "applied",
        applied_keys=applied_keys,
        failed=failed_rows,
        error=error,
        chain_request_ids=list(chain_request_ids),
        updated_at=now,
    )


def review_after_reject(
    turn_row: dict[str, Any], chain_request_ids: list[str], now: datetime
) -> ProposalReview:
    """The review to record on one chain turn when the card is dismissed.

    A turn that already applied every row keeps `applied`: its items are in the
    pantry, so a dismiss of the rest of the card must not relabel it "Skipped".
    A `failed` (or never-attempted) turn becomes `rejected` and keeps its
    `applied_keys`.
    """
    previous = read_review(turn_row.get("metadata"))
    if previous is not None and previous.status == "applied":
        return ProposalReview(
            status="applied",
            applied_keys=list(previous.applied_keys),
            failed=[],
            error=None,
            chain_request_ids=list(chain_request_ids),
            updated_at=now,
        )
    return ProposalReview(
        status="rejected",
        applied_keys=list(previous.applied_keys) if previous else [],
        failed=list(previous.failed) if previous else [],
        error=None,
        chain_request_ids=list(chain_request_ids),
        updated_at=now,
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def _write_reviews(
    repo: SupabaseRepository,
    user_id: str,
    turns: list[dict[str, Any]],
    turn_ids: list[str],
    build: Callable[[dict[str, Any]], ProposalReview],
) -> list[UUID]:
    """Write `build(turn_row)` into each turn's `metadata.proposal_review`.

    Everything per turn -- reading the old review, computing the new one,
    building the merged metadata and the write -- sits inside one try. A bad
    row or a failed write is logged and that turn is simply not reported as
    recorded; it never changes the caller's result and never raises. Returns
    the recorded request ids in request order.
    """
    recorded: set[str] = set()
    for row in turns:
        metadata = row.get("metadata")
        request_id = metadata.get("request_id") if isinstance(metadata, dict) else None
        try:
            if not isinstance(metadata, dict):
                logger.warning(f"Proposal turn {row.get('id')} has non-dict metadata; skipped")
                continue
            review = build(row)
            merged = {**metadata, "proposal_review": review.model_dump(mode="json")}
            if await repo.set_turn_metadata(user_id, str(row["id"]), merged):
                recorded.add(str(request_id))
        except Exception as err:
            logger.warning(
                f"Failed to record proposal_review: turn={row.get('id')}, "
                f"request_id={request_id}: {err}"
            )
    return [UUID(rid) for rid in turn_ids if rid in recorded]


async def _log_ingestion(
    repo: SupabaseRepository,
    user_id: str,
    request: ApplyRequest,
    actions_count: int,
    errors: list[str],
) -> None:
    try:
        await repo.log_ingestion(
            user_id=user_id,
            request_id=str(request.request_id),
            intent="pantry_update",
            input_payload={"actions_count": actions_count},
            proposal=request.proposal,
            errors=errors,
        )
    except Exception as log_err:
        logger.warning(f"Failed to log ingestion: {log_err}")


async def apply_pantry_with_review(
    repo: SupabaseRepository, user_id: str, request: ApplyRequest
) -> ApplyResponse:
    """Apply a reviewed pantry proposal and, when the request names chat turns,
    record the outcome on them and guard against re-applying landed rows."""
    actions: list[dict[str, Any]] = request.proposal.get("actions", [])
    if not actions:
        return ApplyResponse(request_id=request.request_id, success=True, applied_count=0)

    turn_ids = [str(rid) for rid in request.turn_request_ids]
    if not turn_ids or not request.conversation_id:
        # Receipt-scan confirm or an older client: exactly the pre-#444 path.
        applied, failed, errors, affected_item_ids = await repo.apply_pantry_proposal(
            user_id=user_id, actions=actions
        )
        await _log_ingestion(repo, user_id, request, len(actions), errors)
        return ApplyResponse(
            request_id=request.request_id,
            success=failed == 0,
            applied_count=applied,
            failed_count=failed,
            errors=errors,
            affected_item_ids=affected_item_ids,
        )

    # Fail closed: the guard needs this read. Applying without it could re-write a
    # row that already landed, and with no record made the card would restore armed
    # for a second, duplicating tap. Nothing is written; the client's card stays
    # retryable.
    try:
        turns = await repo.get_turns_by_request_ids(user_id, request.conversation_id, turn_ids)
    except Exception as read_err:
        logger.warning(f"Could not load proposal turns; refusing to apply unguarded: {read_err}")
        return ApplyResponse(
            request_id=request.request_id,
            success=False,
            applied_count=0,
            failed_count=len(actions),
            errors=[_GUARD_READ_FAILED],
            failed_names=[_sent_key(a) for a in actions],
        )
    if len(turns) != len(turn_ids):
        logger.info(
            f"Apply named {len(turn_ids)} turns, found {len(turns)} "
            f"(foreign or legacy ids are ignored)"
        )

    # Server-side guard: a row that already applied never applies twice, even
    # from a stale tab, a second device or a retry after a lost response.
    landed = already_applied(turns)
    sent_actions: list[dict[str, Any]] = []
    already_applied_names: list[str] = []
    for action in actions:
        key = _sent_key(action)
        if key and key in landed:
            if key not in already_applied_names:
                already_applied_names.append(key)
        else:
            sent_actions.append(action)

    # When the guard drops every row there is nothing to write to the pantry, but
    # the named turns still need their review: a stale tab may have merged a new
    # turn into a card another tab already applied, and that turn must not be left
    # pending (it would restore armed and write its rows a second time).
    if sent_actions:
        result = await repo.apply_pantry_proposal_detailed(user_id=user_id, actions=sent_actions)
    else:
        result = PantryApplyResult(applied=0, failed=0, errors=[], affected_item_ids=[])
    failed_names = [
        _sent_key(sent_actions[i]) for i in result.failed_indices if 0 <= i < len(sent_actions)
    ]

    now = datetime.now(UTC)
    recorded = await _write_reviews(
        repo,
        user_id,
        turns,
        turn_ids,
        lambda row: review_after_apply(
            row,
            sent_actions,
            result.failed_indices,
            result.failed_errors,
            turn_ids,
            now,
            already_applied_names,
        ),
    )

    if sent_actions:
        await _log_ingestion(repo, user_id, request, len(sent_actions), result.errors)
    return ApplyResponse(
        request_id=request.request_id,
        success=result.failed == 0,
        applied_count=result.applied,
        failed_count=result.failed,
        errors=result.errors,
        affected_item_ids=result.affected_item_ids,
        failed_names=failed_names,
        already_applied_names=already_applied_names,
        recorded_turn_request_ids=recorded,
    )


async def reject_with_review(
    repo: SupabaseRepository, user_id: str, request: RejectRequest
) -> RejectResponse:
    """Record `rejected` on every named turn of the caller's conversation.

    Unknown ids (another user's, or a legacy turn) match nothing and are
    ignored: no error, so a caller can't probe for someone else's ids.
    """
    turn_ids = [str(rid) for rid in request.turn_request_ids]
    turns = await repo.get_turns_by_request_ids(user_id, request.conversation_id, turn_ids)
    now = datetime.now(UTC)
    recorded = await _write_reviews(
        repo,
        user_id,
        turns,
        turn_ids,
        lambda row: review_after_reject(row, turn_ids, now),
    )
    return RejectResponse(recorded_turn_request_ids=recorded)
