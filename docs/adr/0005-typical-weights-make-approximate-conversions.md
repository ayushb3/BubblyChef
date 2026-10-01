# A typical weight, density or can size makes a conversion approximate, not impossible

The cook flow used to refuse any conversion it could not do exactly. `1 cup flour` against `1 bag flour`, `1 onion` against `1 lb onions`, `1 can tomatoes` against `28 oz tomatoes`, `2 tbsp lemon juice` against three lemons: each came back `unit_conflict` or `imprecise`, and the user was asked to do arithmetic the app is supposed to do. For someone cooking with the app every night that is the common case, not the edge, and it is the main place the app can beat pasting a recipe into a chat window: it knows what is in the kitchen and subtracts it.

This ADR changes the rule. A conversion that rests on a **typical** figure is made, deducted, and **flagged approximate**. Only a pair with no honest figure at all stays `imprecise`.

## What counts as exact and what does not

Exact, never flagged: within a dimension (g, kg, oz, lb; ml, l, tsp, tbsp, fl oz, cup, pint, quart, gallon; count, dozen, half dozen, pair), a container that states its size (`28 oz can`), and a definition (a stick of butter is 113 g).

Approximate, flagged: a piece weight (one onion is 150 g), a density (a cup of flour is 127 g), a typical container (a bag of flour is 5 lb, a can of tomatoes is 14.5 oz), a typical carton count (eggs, 12), a juice yield (a lemon is 45 ml). A pantry row whose own base came from one of these is flagged too, since the remaining quantity is only as good as that estimate.

The flag travels on the wire (`IngredientMatch.approximate`, `MealCookSource.approximate`) and the review UI shows it as a leading "≈". Nothing else about the review changes: the deduction is still proposed, still editable, and still written only on an explicit confirm.

## Why this is allowed when ADR 0003 and `density.py` say otherwise

ADR 0003 refused `4 slices bread` against a loaf because the pantry does not record slices per loaf, there is no conventional figure, and a wrong deduction destroys a package. `density.py` holds the rule "correctness over coverage": every entry citable, anything else absent. Both stand for the things they cover. They were protecting against inventing a number.

What changed is the cost on the other side. A refusal is not free: it leaves the pantry wrong in the other direction, and it trains the user to ignore the screen. A typical onion is not an invented number; it is within a few percent of what a real onion weighs, and the user sees "≈" and can correct it with one tap. Under-deduction stays recoverable and so does a 10% error. A deleted loaf does not, and that case is still refused.

So the line is drawn by whether an honest figure exists:

- Garlic against a head, a clove and a head both have typical weights (5 g and 50 g), so `2 cloves` is 0.2 of a head. This supersedes ADR 0003 for garlic and for any food where both sides have a typical weight.
- Bread against a loaf, basil against a bunch: no typical figure for the package, so these stay `imprecise`, exactly as ADR 0003 decided.
- Volume to mass without a density entry (matcha, a spoonful of tofu): stay `imprecise`.

The density table stays staples-only, and every spice added for this work (cumin, cinnamon, paprika, pepper, chili powder, garlic powder, turmeric, cayenne) is a USDA teaspoon weight.

## No model in the loop

Unit conversion is deterministic, tested and free. A model is not asked, because a model's answer would not be reproducible, could not be pinned by a test, and would cost a call per ingredient on a path that has to work offline. The figures live in `domain/piece_weights.py` and `domain/density.py` with a rationale beside each.

## Related behaviour decided with it

- **Ranges.** `1-2 cloves` is available if the pantry covers the upper bound, and deducts the midpoint. A range the pantry cannot cover is a `shortfall`, which deducts what is there up to the midpoint.
- **Trace amounts.** A pinch, a dash, "to taste", "as needed" never block and never deduct. With a pantry row they report `to_taste`; a staple not in the pantry is `assumed`.
- **Juice as the fruit.** `2 tbsp lemon juice` with only lemons in the pantry deducts a fraction of a lemon at a typical yield.
- **Bare count of garlic** in a recipe means cloves.
- **Clove weight is 5 g**, the figure the project settled on, not the USDA 3 g, because a recipe clove is a plump supermarket clove. The comment in `density.py` records both.

## Revisit when

A pieces-per-package field exists on the pantry row (the same data gap ADR 0003 named), or the user can set a weight for a food. Either would turn the typical figures into the user's own and most flags would disappear.

Related: #6 (unit conversion, closed), ADR 0003 (partly superseded as described), #224 (base units), #356 (lots).
