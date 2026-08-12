# Piece units and package units are incommensurable, and the cook flow says so rather than guessing

A recipe asks for `4 slices bread`. The pantry holds `1 item bread`. Both sides normalize into the `count` dimension, so they compare — and the comparison says the user is three short and deducts the entire loaf. The same happens for `8 leaves basil` against `1 bunch basil` and `2 cloves garlic` against `1 head garlic`.

The comparison is wrong because the two counts count different things. A recipe's piece unit counts pieces *of* an ingredient; a pantry row's package unit counts packages *containing* an unknown number of those pieces. Mapping both to `count` at 1.0 is what makes them match at all, and it is exactly what makes the match meaningless. The pantry does not record slices per loaf or leaves per bunch, and there is no conventional figure to supply: a sandwich loaf is 20 slices and a sourdough boule is 12, a bunch of basil is whatever the shop tied together.

The cook flow therefore reports a distinct `imprecise` status for this case: the ingredient counts as satisfied, nothing is deducted, and the pantry row is stamped with the recipe and time that consumed it imprecisely.

Three things drive that shape.

**Under-deducting is recoverable; destroying a package is not.** A pantry count that drifts low is corrected by editing one number. A loaf deleted because a recipe wanted four slices is gone, and the user has to notice it happened, work out why, and re-add the item. Given the system genuinely cannot know the true amount, it should err toward the failure the user can undo.

**`shortfall` was an active lie.** It told a user holding a full loaf of bread that they were short of bread. The proposal is reviewed before anything is written, so the deduction was never silent — but a status that misdescribes the pantry is worse than one that admits ignorance, because the user reasonably trusts it and confirms.

**The alternative was inventing data.** Estimating a loaf at 500 g to deduct `4 slices ≈ 112 g` would work, and it would be a fabrication. `domain/density.py` already commits to the opposite rule — "correctness over coverage", every entry a real citable figure, anything else deliberately absent so the lookup returns None and the caller refuses. Piece-per-package counts have no citable figure, so they stay absent and the caller refuses in the same way. This ADR is that existing rule applied to a second kind of missing data, not a new principle.

Genuine conversion still comes first. When a pantry row has a real mass base, `PIECE_WEIGHTS_G` resolves the piece honestly — `2 slices cheese` against `500 g cheese` deducts 42 g, and `1 stick butter` against a gram row deducts 113 g. `imprecise` is the fallback for package-shaped rows only, never a shortcut past a conversion that would have worked.

The distinction rests on the pantry row's **raw display unit**, read before `normalize_unit` collapses `item` into `count`. That collapse discards the thing this check needs: `1 item bread` is a package the user is holding, while `6 count garlic` is a genuine tally of cloves and must keep deducting normally. Anything reading the normalized unit here would either miss the reported bug or break the working case.

Note that this reclassifies `head` and `bunch`, which `_TO_COUNT` groups under "pieces of an ingredient". A head of garlic and a bunch of basil are things you buy, not things you use — they belong with `loaf` and `bag`.

The real fix for the general case is data the pantry does not collect: an optional pieces-per-package count on the row, captured at add time. That remains worth doing and would let these deductions become exact. This decision is what the system does until then, and it should be revisited rather than worked around if that field ever lands.

Recorded from the triage of #222, following the unit-conversion work in #221. Related: #6 (unit conversion), #209 (cook-flow conflict UX), #224 (base units unpopulated on write).
