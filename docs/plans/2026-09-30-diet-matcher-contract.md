# Issues #684 + #685: the shared diet matcher, the contract

One backend PR. Its body carries, each on its own line:

```
Fixes #684
Fixes #685
```

- **Issue #684**, *Shared forbidden-food table misses common meats (pancetta, chorizo, prosciutto…)* (open). The table that decides "this message asks for a food your diet forbids" has no pancetta, chorizo, steak, prawns and so on, and it only partly handles plurals. So a stored-Vegetarian user asking for "chorizo pasta" gets it made **under** Vegetarian, and "add pancetta" as a tweak doesn't set Vegetarian aside.
- **Issue #685**, *A diet said in chat isn't set aside for a dish that contradicts it on the direct recipe path* (open). A diet the conversation carries ("vegetarian dinner ideas" said earlier) is re-added to every later direct request without any check, so "chicken curry" is generated under Vegetarian. PR #681 (issue #544, merged as `087a481`) fixed this on the brainstorm **pick** path only.

**Branch:** `fix/issues-684-685-diet-matcher`, off `main` at `087a481`. Copy this file to `docs/plans/2026-09-30-issues-684-685-diet-matcher-contract.md` in the PR.

It's backend only (`ai-service/`). No frontend change, no migration, no prompt text change, so no classifier fixture re-capture.

**R6 changelog** (review of R5; two findings accepted; this is the build revision):
1. The inherited-diet check (§2.1 steps 3 and 5) uses refine's two-part test on the message, plus a separate field check that keeps the default guards. New S14 rows keep Vegetarian: "vegan pulled pork tacos", "meat and dairy free pasta", and fresh preferred `["tempeh bacon"]`.
2. S9's flipped row now states `stored_dietary: []` and `fresh_dietary: []`. §8 gains a known gap: negation words can strip a food the user actually wants.

**R5 changelog** (review of R4, "needs changes"; all six findings accepted; details in the sections and in the R5 table at the end):
1. `_message_sets_label_aside` is True only when `non-LABEL` is present **and** `not _tweak_names_label(label, text)`, so "a vegan dinner my non-vegan family will enjoy" keeps Vegan. New rows in S10b and S10c.
2. The inherited-diet check ignores negated foods. Its haystack is `join_fields(*added_clauses(input_text), *fresh must_use, *fresh preferred)`, checked with `plant_markers=False`. New S14: "pasta with no meat" and "something without chicken" keep Vegetarian.
3. The persisted diet is `_dedupe_labels([*fresh_dietary, *session_dietary, *(final labels that aren't stored-only)])`, so `back` is all of `session_dietary`. The S9 "covers" row is flipped. New S15: stored Vegan + "vegetarian dinner ideas" persists `["Vegetarian"]`, and a later "cheese omelette" sends Vegetarian.
4. `non[\s-]?dairy` is a false friend for `dairy`. New T-FP rows: "non-dairy milk" and "non-dairy creamer".
5. `_message_sets_label_aside` runs `re.escape` on each label word, as `nodes.py:847-848` does. New S10b row: "Low carb (keto)" doesn't raise.
6. Guard 5's marker window also stops at `but`, `then`, `also` and `except`. New T-TP row: "vegetarian but chicken curry" names chicken.
7. T-D1's `_combine_dietary_preferences` and `_drop_redundant_dietary` are added to §3's import list for the callers file.

**R4 changelog** (Opus review of R3, "needs changes"; all eight findings accepted; details in the sections and in the R4 table at the end):
1. A stored-origin label already in `session_dietary` is kept by `kept_final` and `back`, and anything in the session counts as conversation-origin. `back` drops its dead "unless named this turn" clause. S11 now keeps a legacy session label. New S5d is the stored-diet four-turn chain.
2. The S10 row "is honey not vegan?" becomes "is this not vegan?" (no forbidden food). The honey sentence stays in S10b only.
3. `_message_sets_label_aside` also filters `fresh_dietary` (before the merge) and the stored list (this turn only; the profile is never changed). New tests S10c and S10d.
4. The tests are split into two files: `test_issues_684_685_callers.py` imports only symbols that exist on main (C*, S1-S8, S10-S13), and `test_diet_terms.py` holds the pure-API tests (T-*, S9, S10b).
5. Guard 1(b) requires and/or/&/slash before the last item, uses the new separator (Oxford comma, "dairy/gluten free"), handles "meat- and dairy-free", and adds `tree[\s-]nut`. There are new T-F1 rows.
6. Macadamia joins NUTS. Lox, liver, suet, bresaola, speck, oxtail and tripe become Vegetarian terms, with false friends for "vegetable suet" and "speck of".
7. Guard 5's markers for DAIRY ∪ {egg, honey} are only vegan, plant-based, dairy-free, tofu, tempeh and seitan, so "vegetarian cheese toastie" hits Vegan and Dairy-free.
8. The no-stored `requested` is deduped. `_message_sets_label_aside` is False for a label with no words. `_combine_dietary_preferences` and `_drop_redundant_dietary` dedupe through `norm_label`.

**The design in one line:** one deep, pure matcher module owns "does this text ask for a food this diet forbids", with the plant-based guard inside it, and every caller uses it. The direct path runs the same contradiction check on the conversation's diet that the pick path already runs.

## 0. What exists (on `origin/main` at `087a481`)

**The table and matcher** (`ai-service/bubbly_chef/workflows/recipe/nodes.py`):
- `_DIETARY_FORBIDDEN_INGREDIENTS` is at **718-744**. Issue #684 says ~728; it's 718. It has five labels: vegetarian, vegan, pescatarian, dairy-free and nut-free. Plurals are listed by hand for only some terms (`egg`/`eggs`, `nuts`, `peanuts`…), so `sausages`, `shrimps` and `prawns` don't match.
- `_dietary_contradicted(label, haystack)` (**756-759**) is a bare `\bterm\b` search, with no guard at all.
- `_DIETARY_SUBSUMES` (751) and `_drop_redundant_dietary` (762) aren't touched.
- `_combine_dietary_preferences(stored, requested, constraints, input_text)` (**777-815**) builds its haystack from `input_text` plus `must_use_ingredients` and `preferred_ingredients` (792-795). It drops a contradicted *stored* label, then appends every *requested* label unconditionally (810-813).

**#681's plant-based guard** (`workflows/recipe/refine_diet.py`, refine-only today):
- `_PLANT_COMPOUND` (**35-38**): a plant base ("coconut", "oat", "almond"…) plus a dairy noun ("milk", "cream", "butter"…), stripped as a whole phrase.
- `_PLANT_MARKER` (**39-41**): a marker word (vegan, veggie, vegetarian, plant-based, meatless, mock, faux, tofu, tempeh, seitan) plus the **one** next word.
- `added_text` (**44-60**) applies the compound regex before the `-free` strip, and the marker regex **per clause, after** the swap, substitute, instead-of and negation rules. Its output joins the clauses with a space.
- `negated_text` (63-73) isn't touched.

**Every caller of the matcher.** These all change behaviour through the wider table:

| # | Caller | file:line | Text checked | Path |
|---|---|---|---|---|
| 1 | `extract_recipe_constraints` → `_combine_dietary_preferences` | `recipe/nodes.py:1090-1104` | message + merged must_use/preferred | first turn of #394: direct card **and** brainstorm (both run extract, `router.py:851-853`) |
| 2 | `research_recipe`, the pick branch | `recipe/nodes.py:1383-1390` | the picked name only (`{}` constraints) | brainstorm pick (#544) |
| 3 | `refine_dietary_constraints`, the tweak | `recipe/nodes.py:931, 958` | `added_text(tweak)` | chat refine and library refine |
| 4 | `refine_dietary_constraints`, the library ingredients | `recipe/nodes.py:934-936, 961-968` | the saved row's `ingredients[].name`, **unguarded** | library refine (`api/routes/recipes_ai.py:160`) |
| 5 | `carry_dietary_tags` | `recipe/nodes.py:1020-1026` | `added_text(tweak)` | library refine (`recipes_ai.py:178`) |
| 6 | `_finish_meal_followup_constraints` → `_combine_dietary_preferences` | `meal/nodes.py:193-221` (called at 873) | pill text + merged fields | meal follow-up |
| 7 | `_drop_diets_the_main_contradicts` | `meal/nodes.py:224-258` (called at 877) | main card's title + ingredient names | meal follow-up under a fixed main |
| 8 | `fixed_main_constraints` → `_combine_dietary_preferences` | `meal/fixed_main.py:376-402` | main card's title + ingredient names | fresh fixed-main meal turn |

No other code reads the table. `services/dietary_preferences.py:10` only mentions it in a docstring.

**Issue #685's mechanism** (`extract_recipe_constraints`, `recipe/nodes.py:1041-1112`):
- Before the merge at 1068-1070, `constraints` is this turn's fresh extraction.
- `_merge_constraints` (658-709) makes `dietary` "fresh wins when non-empty, else inherit prior". So when this turn names no diet, the merged `dietary` **is** the conversation's persisted diet.
- **With no stored diet** (1091), nothing checks that inherited diet at all. That's the issue as filed.
- **With a stored diet, it's broken too, which the issue doesn't say.** The inherited list is passed as `requested` (1092-1095), and `_combine_dietary_preferences` re-appends it after dropping the contradicted stored copy.
  - The persisted session already holds the stored label after any earlier recipe turn, because extract folds it in and `router.py:1217-1221` saves it.
  - So a stored-Vegetarian user's **second** recipe turn, "chicken curry", is generated under Vegetarian.
  - #394's protection holds only on a session's first recipe turn. The #544 test `test_chicken_curry_first_turn_is_not_generated_under_vegetarian` passes only because it has no session.
- **The pick path, as #681 fixed it** (`research_recipe`, 1370-1402), filters the rehydrated session diet against the picked name. Two gaps remain:
  - `diets_set_aside` (1406) is computed against **stored** labels only, so a session-only Vegetarian set aside by "Chicken Tikka" isn't recorded. `test_issue_544_refine_dietary.py:411-420` pins `== stored`, i.e. `[]` for a session-only diet.
  - The filtered constraints are what gets persisted (`router.py:1217-1221`), so a session-only diet is **forgotten** after one contradicting pick. Nothing re-reads it the way the stored diet is re-read.
- **Persistence sites** (`workflows/router.py`), all `RecipeConstraints.model_validate(state["recipe_constraints"])`:
  - brainstorm/generation, **1153-1157**;
  - RECIPE_CARD, **1217-1221**;
  - the cooking-help brainstorm fallback, **1424-1428**.
  The comment at 1146-1152 says a set-aside preference "reasserts itself as soon as a later message stops contradicting it". Because of 1092-1095 above, that's false for inherited labels.
- **The meal follow-up is already safe from #685.** It calls extract with the retained prior's `dietary` blanked (`meal/nodes.py:855-872`), so nothing is inherited. The fresh meal turn (`meal/nodes.py:891`) does inherit the session's diet, and gets the new check.
- **Per-turn state** (`workflows/state.py:151-157`): `constraints_extracted` and `dietary_set_aside`, neither persisted. `generate_grounded_recipe` stamps `diets_set_aside` from `dietary_set_aside` (`recipe/nodes.py:1577`).
- **The prompt.** `generate_grounded_recipe` drops empty values from the constraints JSON (`recipe/nodes.py:1472-1473`), so `"dietary": []` and a missing key render identically.

**Tests that pin today's behaviour and will change** (§3.4):
- `tests/test_issue_544_refine_dietary.py:884-889`, `test_library_refine_without_the_tag_drops_the_misfiring_diet`, asserts that an untagged "tempeh bacon" row **drops** Vegetarian.
- The tag-rescue tests at 872-881 and 892-899 rely on that same misfire.
- The pick test at 411-420 asserts `diets_set_aside == stored`.

**Overlap:** open PR #686, *fix: pantry writes skip missing rows, keep amounts in step, pages mount once* (pantry write paths; it touches `tests/test_issue_651_make_it_a_meal.py`). This PR adds no edits to that file. All new tests go in a new file.

## 1. Issue #684: one shared matcher

### 1.1 New module `ai-service/bubbly_chef/domain/diet_terms.py`

It's pure: no imports from `workflows/` and no I/O. `domain/` already holds the other deterministic food knowledge (normalizer, expiry, catalog). It owns:

**Literal text versus regex (R1).** Two kinds of data live in this module, and the code and tests treat them differently:
- **Literal text:** `FORBIDDEN_FOODS` terms, the `IRREGULAR_PLURALS` values and `NO_PLURAL` (R4). `term_pattern` escapes them with `re.escape`, and tests compare them as plain strings.
- **Regex fragments:** every guard tuple (`PLANT_COMPOUND_BASES`, `PLANT_COMPOUND_NOUNS`, `PLANT_MARKER_WORDS`, `DAIRY_EGG_MARKERS`, `MILK_BASES`, `BUTTER_ONLY_BASES`, `IMITATION_BASES`, `IMITATED_TERMS`, `FREE_LIST_ITEMS`) and every false-friend phrase. They're joined with `|` **unescaped** (for example `plant[- ]based`, `dairy[- ]free`).
  - Tests never compare a fragment as text against input. They compile it, or compare the built pattern (T-ID1).
  - Each tuple's declaration carries a one-line comment saying "regex fragments".

**`FORBIDDEN_FOODS: dict[str, frozenset[str]]`.** Singular terms only; plurals come from `term_pattern`. It's built from five named sets:
- `MEAT`: meat, beef, pork, chicken, turkey, lamb, mutton, veal, venison, duck, goose, quail, bacon, ham, sausage, steak, brisket, jerky, pancetta, prosciutto, chorizo, salami, pepperoni, guanciale, pastrami, mortadella, nduja, bratwurst, kielbasa, andouille, foie gras, meatball, lard, lardon, tallow, gelatin, gelatine, and (R4) liver, suet, bresaola, speck, oxtail, tripe
  - `speck` is in `NO_PLURAL` (R4), a literal-text set that `term_pattern` leaves unpluralised, so "specks of pepper" doesn't match.
- `SEAFOOD`: fish, shellfish, seafood, salmon, tuna, cod, haddock, halibut, tilapia, catfish, swordfish, monkfish, sea bass, snapper, herring, eel, anchovy, sardine, mackerel, trout, bonito, caviar, roe, lox (R4), shrimp, prawn, crab, crawfish, crayfish, lobster, clam, mussel, oyster, scallop, squid, calamari, octopus
- **Rib and rabbit are deliberately not terms (R1).** "Rib" hits "rib of celery" and "ribbon"-style words, and "rabbit" hits "Welsh rabbit" (a cheese dish). Both are listed in §8.
- `DAIRY`: dairy, milk, buttermilk, cream, butter, ghee, cheese, yogurt, yoghurt
- `NUTS`: nut, peanut, almond, cashew, walnut, pecan, pistachio, hazelnut, macadamia (R4)
- The labels:
  - `vegetarian` = MEAT ∪ SEAFOOD
  - `vegan` = MEAT ∪ SEAFOOD ∪ DAIRY ∪ {egg, honey}
  - `pescatarian` = MEAT
  - `dairy-free` = DAIRY
  - `nut-free` = NUTS

  The keys are in normalised form.
- **The label lookup (R1)** goes through `norm_label(label) = re.sub(r"[\s_-]+", "-", label.strip().lower())`.
  - `norm_label` moves here from `recipe/nodes.py:818-820`, and `nodes._norm_label = norm_label` stays as an alias.
  - So a stored "Dairy Free" or "dairy_free" now reaches `dairy-free`. On main, `label.strip().lower()` missed them. That's a behaviour change, stated in the PR body.
- **Every term on main is kept.** The only removals are hand-written plurals (`eggs`, `nuts`, `peanuts`, `almonds`…) that the helper now generates. `nuts` becomes `nut`, which also matches the singular ("nut roast"). That's a true positive, listed in the PR body.

**`term_pattern(term: str) -> str`**, the plural helper:
- It builds the regex **from the singular** and never stems the input text. That's how it avoids bad stems like "tomatoe" and "berrie".
- For a multi-word term, it pluralises the last word only ("sea bass" → "sea basses").
- The rules:
  - **Irregular plurals first (R1):** `IRREGULAR_PLURALS = {"goose": "geese", "octopus": "octopi"}` adds an alternative (`goose|geese`) as well as the regular rule;
  - consonant + `y` → `stem(?:y|ies)`: anchovy → anchovies; berry → berries, never "berrie";
  - ends in `s`, `x`, `z`, `ch` or `sh` → `term(?:es)?`: fish → fishes, octopus → octopuses;
  - ends in `o` → `term(?:e?s)?`: tomato → tomatoes and tomatos;
  - otherwise → `term(?:s)?`: prawn → prawns, turkey (vowel + y) → turkeys.
- Wrapped in `\b…\b`, compiled once (`functools.lru_cache`).
- **Why not `(?:e?s)?` everywhere** (issue #684's sketch): it makes "cod" match "codes" and "ham" match "hames".

**The hard separator (R1, the blocker).** `FIELD_SEP = " | "`.
- **Every haystack that joins more than one field joins them with `FIELD_SEP`**, never a space: message versus ingredient fields, and ingredient name versus ingredient name.
- `|` is in neither `[\s-]` nor `[\w']`, so no guard regex can cross it. `\bterm\b` still matches next to it.
- **Without it,** guards 4 and 5 read across a list: `["pasta", "mushrooms", "bacon"]` joined with spaces becomes "mushrooms bacon", so guard 4 hides the bacon. `["tofu", "chicken thighs"]` becomes "tofu chicken", so guard 5 hides the chicken.
- The public helper `join_fields(*parts: str) -> str` does the joining. Every haystack in §1.3 uses it.

**Guards.** They're term-aware: an occurrence is rejected, never whole phrases stripped. So "almond milk" still names *almond* for Nut-free while it doesn't name *milk* for Vegan. A match of term *t* at position *m* doesn't count when any of these holds:
1. **`-free`, including coordinated lists (R1; closed set in R3).** Always on, and never crosses `FIELD_SEP`. A match doesn't count when either:
   - **(a)** any term is directly followed by `[\s-]?free\b`: meat-free, egg free, dairy-free, nut-free;
   - **(b)** the term is itself in the closed set `FREE_LIST_ITEMS`, and is followed by coordinated items from that same set, then `-free`. `FREE_LIST_ITEMS` is meat, dairy, egg, nut, `tree[\s-]nut` (R4), peanut, gluten, wheat, soy, lactose, fish, shellfish and sugar: regex fragments, each as `(?:ITEM)s?-?`, where the optional `-` is the suspended hyphen. **The R4 form:**
     - `SEP = (?:\s*,\s*(?:(?:and|or|&)\s+)?|\s+(?:and|or|&)\s+|\s*/\s*)`;
     - `LAST = (?:\s*,\s*(?:and|or|&)\s+|\s+(?:and|or|&)\s+|\s*/\s*)`, a coordinating separator or a slash, never a bare comma;
     - after the term (and its optional `-`): `(?:SEP ITEM)*LAST ITEM[\s-]?free\b`.
     - **So a bare two-item "X, Y free" is not a list**: "pasta with fish, dairy free" names fish.
     - It covers "meat and dairy free", "egg and dairy free", "egg, dairy and nut free", the Oxford comma ("meat, dairy, and gluten free"), "dairy/gluten free", the suspended hyphen ("meat- and dairy-free") and "tree-nut and peanut free".
   - Because the list is closed, "pasta with chicken, dairy free" and "a chicken and dairy-free dinner" **still name chicken**. Chicken isn't a list item, so neither (a) nor (b) applies.
2. **Fixed false friends for *t*.** The match falls inside one of these spans (regex fragments). Always on.
   - `butter`: `butter[\s-]+beans?`, `butter[\s-]+lettuce`
   - `cream`: `cream[\s-]+of[\s-]+tartar`, `cream[\s-]+soda`
   - `egg`: `(?:flax|chia)[\s-]*eggs?`, `eggs?[\s-]+(?:replacer|substitute)s?`
   - `duck`: `duck[\s-]+(?:eggs?|sauce)`
   - `quail`: `quail[\s-]+eggs?` (for Vegetarian; Vegan still hits `egg`)
   - `oyster`: `oyster[\s-]+(?:mushrooms?|crackers?)` (**not** oyster sauce, which is real oyster)
   - `lobster`: `lobster[\s-]+mushrooms?`
   - `beef`: `beef[\s-]*(?:steak[\s-]+)?tomato(?:e?s)?`
   - `steak`: `steak[\s-]+(?:cut[\s-]+)?fries`, `steak-cut[\s-]+fries`
   - `crab`: `crab[\s-]?apples?`
   - `lamb`: `lamb'?s?[\s-]+lettuce`
   - `chicken`: `chicken[\s-]+of[\s-]+the[\s-]+woods`
   - `dairy` (R5): `non[\s-]?dairy`
   - `suet` (R4): `vegetable[\s-]+suet`
   - `speck` (R4): `speck[\s-]+of`
3. **Non-dairy base (R1: split by noun).** *t* is a dairy noun (milk, cream, butter, cheese, yogurt, yoghurt, buttermilk) directly preceded by a base + `[\s-]+`. Always on.
   - `MILK_BASES` apply to every dairy noun: #681's compound bases (coconut, oat, almond, soy, cashew, rice, hemp, pea, plant-based, vegan, dairy-free, non-dairy), plus soya, hazelnut, macadamia, flax, walnut, pistachio, peanut, nut, seed, sunflower and sesame.
   - `BUTTER_ONLY_BASES` (apple, cocoa, cacao, shea, pumpkin) apply to `butter` only, so "pumpkin cream" or "apple cheese" still count as dairy.
   - That covers coconut milk, soya milk, macadamia milk, peanut butter and cocoa butter.
4. **Vegetable imitation.** *t* ∈ `IMITATED_TERMS` = {steak, bacon, chorizo, sausage, meatball, meat, pork, tuna, jerky, brisket, caviar}, directly preceded by an `IMITATION_BASES` word, plus `s?[\s-]+(?:pulled[\s-]+)?`. The bases are cauliflower, mushroom, portobello, eggplant, aubergine, cabbage, celeriac, beet, beetroot, squash, jackfruit, carrot, coconut, watermelon, lentil, bean and chickpea.
   - That covers cauliflower steak, jackfruit pulled pork, coconut bacon, mushroom meatballs, mushroom jerky, chickpea tuna and eggplant caviar.
   - Because of `FIELD_SEP`, it never reaches across two ingredient names.
   - The narrow term set is deliberate: "mushroom chicken" and "coconut shrimp" are real meat dishes and **must** still match.
   - Always on.
5. **Plant marker window.** Only when `plant_markers=True`, and only for animal terms (not `NUTS`: a "vegan almond cake" still has almonds).
   - The match counts as imitation when the text before it ends with one of #681's marker words (`PLANT_MARKER_WORDS`), followed by up to two more words, with no `and`, `or`, `with`, `plus`, `n`, `but`, `then`, `also` or `except` between (the last four added in R5) and no punctuation. The regex is `\b(?:MARKERS)(?:[\s-]+(?!(?:and|or|with|plus|n|but|then|also|except)\b)[\w']+){0,2}[\s-]+$` on `text[:m.start()]`. So "vegetarian but chicken curry" still names chicken.
   - A marker directly preceded by `non[\s-]?` or `not\s+` doesn't count.
   - **Which markers count depends on the term (R4).**
     - For meat and seafood terms, it's every `PLANT_MARKER_WORDS` entry.
     - For DAIRY terms and {egg, honey}, it's only `DAIRY_EGG_MARKERS` = vegan, plant-based, dairy-free, tofu, tempeh and seitan (regex fragments). A vegetarian or meatless dish can still hold cheese, eggs or honey.
     - So "vegetarian cheese toastie" and "meatless egg bake" still hit a stored Vegan, and the toastie hits Dairy-free. "vegan cheese" and "tofu egg scramble" don't.
   - It covers vegan chorizo, tempeh bacon, vegan pulled pork and "veggie sausages". "Tofu and chicken" still matches. So does "non-vegetarian chicken curry".
   - A two-word tail, rather than #681's one word, because "vegan pulled pork" and "vegan chorizo sausage" are common.
   - The window can't cross `FIELD_SEP`. So `["tofu", "chicken thighs"]` still names chicken.

**Public API** (typed, mypy strict):
- `mentions(term: str, text: str, *, plant_markers: bool = True) -> bool`. Like `names_forbidden_food`, it lowercases `text` and turns `’` into `'` itself (R3), so it's safe to call directly.
- `names_forbidden_food(label: str, text: str, *, plant_markers: bool = True) -> bool`. It lowercases `text` itself and turns `’` into `'` before matching (R2), so "lamb’s lettuce" hits the false friend. It looks `label` up through `norm_label`.
- `norm_label(label: str) -> str`, `FIELD_SEP` and `join_fields(*parts: str) -> str`.
- The regex-fragment tuples `PLANT_COMPOUND_BASES`, `PLANT_COMPOUND_NOUNS` and `PLANT_MARKER_WORDS`, moved from `refine_diet.py` **verbatim**.

### 1.2 `workflows/recipe/refine_diet.py`: the guard moves, and refine stays identical

- Its word lists move into `diet_terms` (§1.1). `_PLANT_COMPOUND` and `_PLANT_MARKER` are rebuilt from the imported tuples, and must produce **byte-identical** `.pattern` strings to lines 36-41 on main. A test pins both literals (§3.1, T-ID1).
- **`added_text` and `negated_text` produce unchanged output.** Refine's clause-scoped, one-word stripping stays exactly as #681 tuned it.
- **One refactor (R1, corrected in R2):** `added_text`'s whole body (46-60) moves into a new `added_clauses(tweak: str) -> list[str]`. That includes the preprocessing: lowercasing, the `’` fix, `_PLANT_COMPOUND` and `_FREE_SPAN`. `added_text` becomes `" ".join(added_clauses(tweak))`.
  - It's identical by construction, so there's no separate equality test (T-ID3 is dropped).
  - The proof is `test_added_text`, `test_a_negation_ends_at_an_adding_verb_but_not_at_a_bare_and` and the #544 refine corpus, all passing unmodified.
- **Refine matches per clause (R1).** `added_text` joins clauses with a space. So "add tofu, chicken too" becomes "add tofu chicken too", and "add mushrooms, bacon too" becomes "add mushrooms bacon too". On that joined text, guard 5 would hide the chicken and guard 4 would hide the bacon.
  - So the **diet** checks (`recipe/nodes.py:958` and `1025`) run on `added_haystack = join_fields(*added_clauses(tweak))`, with `plant_markers=False`. `FIELD_SEP` keeps the guards inside a clause.
  - `plant_markers=False`, because #681's own marker strip already ran per clause.
  - **A second check that can only keep a diet (R2).** A label is set aside (958) only when it's contradicted in `added_haystack` **and** `names_forbidden_food(label, tweak_lower, plant_markers=False)` is true on the whole tweak. `tweak_lower` is lowercased, with `’` → `'`.
    - It's needed because `added_text` strips the `-free` span before guard 1 can see the list: "make it meat and dairy free" becomes "make it meat and", which names meat. On the whole tweak, guard 1's coordinated-list rule covers "meat". The same goes for "egg and dairy free please".
    - `carry_dietary_tags` (1025) uses the same two-part test, so it can only keep more tags.
    - Every set-aside row in the #681 corpus ("swap the tofu for chicken", "use chicken instead of tofu", "add a little cheese", "add bacon", "make it non-vegetarian, add chicken", "make it not vegetarian, add chicken") also names its food in the whole tweak, so the corpus is unchanged. That's asserted by `test_tweak_adds_a_forbidden_food_only_when_it_really_adds_it` passing unmodified.
  - The **exclusion** checks (994) keep using `added_text`, unchanged.
- **On the per-clause text, guards 1-4 apply:**
  - Guard 1 is a no-op, because `-free` spans are already stripped.
  - Guard 3 on #681's own compounds is a no-op, because they're already stripped.
  - Refine changes **only** for a clause holding a false-friend phrase from guards 2, 3 (new bases) or 4, and in the safe direction: it stops setting a diet aside ("add butter beans", "add cauliflower steak").

### 1.3 `workflows/recipe/nodes.py`

- `_DIETARY_FORBIDDEN_INGREDIENTS = FORBIDDEN_FOODS` stays as an alias, so the name is unchanged for imports and tests.
- `_dietary_contradicted(label, haystack, *, plant_markers: bool = True) -> bool` becomes a thin wrapper over `names_forbidden_food`. `meal/nodes.py:92` keeps importing it unchanged.
- **Caller by caller:**

| # | Caller | Call after this PR | Behaviour change |
|---|---|---|---|
| 1 | extract → combine | default (all guards) | wider table; the plant guard is new on the first-turn path ("tempeh bacon", "coconut milk" stop dropping the diet) |
| 2 | research pick | default | wider table and guards on the picked name ("Prawn Pad Thai" sets Vegetarian aside; "Oyster Mushroom Stir-Fry" doesn't) |
| 3 | refine tweak, 958 | `plant_markers=False` on `added_haystack` (per clause) | wider table ("add pancetta" sets Vegetarian aside) plus guards 2-4 within a clause; #681 corpus identical |
| 4 | library ingredients, 965 | default, on `join_fields(*names)` | wider table and **all** guards, per ingredient name. Without them, widening would newly drop Vegetarian on untagged "cauliflower steak" or "oyster mushrooms" rows. The untagged "tempeh bacon" misfire (#544 §8's known gap) is fixed |
| 5 | `carry_dietary_tags`, 1025 | `plant_markers=False` on `added_haystack` | wider table |
| 6 | meal follow-up combine | default | wider table and guards on pill text |
| 7 | `_drop_diets_the_main_contradicts` | default | wider table and guards on the main card |
| 8 | `fixed_main_constraints` | default | wider table and guards. An untagged vegan "coconut milk" main no longer drops a stored Vegan |

- **Every haystack gets the hard separator (R1, the blocker).**
  - `_combine_dietary_preferences`'s haystack (792-795) becomes `_dietary_haystack(input_text, constraints) -> str = join_fields(input_text, *must_use, *preferred).lower()`. This fixes callers 1, 6 and 8: `fixed_main.py:397-402` passes the card's ingredient names as `preferred_ingredients`, so it's fixed here with no edit to that file.
  - The library `ingredient_names` (934-936) becomes `join_fields(*(ing.name for ing in …)).lower()`.
  - `meal/nodes.py:243`, the `_drop_diets_the_main_contradicts` haystack, becomes `join_fields(card.title, *(i.name for i in card.ingredients)).lower()`. That's a one-line edit to `meal/nodes.py`, the only one there.
  - `research_recipe`'s picked name (1384) is a single field, so it's unchanged.
  - Matching a whole word is unaffected, so every true positive on main still matches (T-P3).

## 2. Issue #685: the direct path checks the conversation's diet

### 2.1 `extract_recipe_constraints` (`recipe/nodes.py:1041-1112`)

1. Capture `fresh = dict(constraints)` and `fresh_dietary = list(fresh.get("dietary") or [])` **before** the merge at 1068.
   - **R4:** first drop from `fresh_dietary` every label with `_message_sets_label_aside(label, input_text)`, and write the filtered list back into `constraints["dietary"]` **before** the merge.
   - So an extraction that returns `["Vegan"]` for "make it non-vegan" sends no Vegan.
   - If nothing fresh remains, the merge still inherits the session's diet instead of being overridden by a label the user just turned down.
2. After the merge: `inherited = [] if fresh_dietary else list(constraints.get("dietary") or [])`.
   - These are the conversation's labels, whatever their origin, including a stored label an earlier turn persisted.
   - A diet named **this turn** is never checked: it's an explicit ask. "vegetarian chicken curry" keeps Vegetarian.
3. **The inherited-diet test (R6, replacing R5's single haystack).** It reads this turn's text and this turn's **freshly extracted** must_use and preferred, never inherited ones:
   ```python
   def _inherited_contradicted(l: str) -> bool:
       text = input_text  # names_forbidden_food lowercases and fixes ’ itself
       message = (
           names_forbidden_food(l, join_fields(*added_clauses(text)), plant_markers=False)
           and names_forbidden_food(l, text)
       )
       fields = names_forbidden_food(
           l, join_fields(*(fresh.get("must_use_ingredients") or []),
                          *(fresh.get("preferred_ingredients") or []))
       )
       return message or fields
   ```
   - The message half is refine's two-part test (§1.2).
     - The per-clause text drops negated foods.
     - The whole message, checked with the **default** guards (plant markers and coordinated `-free` lists included), must also name the food.
     - So "vegan pulled pork tacos" and "meat and dairy free pasta" keep Vegetarian.
   - The field half uses the default guards, so a fresh preferred `["tempeh bacon"]` keeps Vegetarian.
   - The bullets below are from R5 and still describe the negation behaviour.
   - **(R5)** The message goes through `refine_diet.added_clauses`, so negated foods don't count: `_NEGATION` strips no, without, skip and the rest.
   - Because `added_clauses` has already applied #681's marker strip clause by clause, this check runs with `plant_markers=False`.
   - So "pasta with no meat" and "something without chicken" keep an inherited Vegetarian (S14). This haystack is used **only** for the inherited-diet check (step 5).
   - An inherited must_use of chicken from an earlier "use up my chicken" doesn't undo a later "actually make it vegetarian".
   - A fresh extraction that folds chicken into `preferred_ingredients` does count, as in #394.
   - The **stored**-diet combine (step 5) keeps its #394 haystack (merged constraints), unchanged.
4. **A `non-LABEL` dish modifier sets an inherited label aside for this turn only (R3, replacing R1-R2's rejection tiers).**
   - New `_message_sets_label_aside(label, text)` is True only when **both** of these hold, on text lowercased with `’` → `'`:
     - `\bnon[- ]LABEL(?![\w-])` matches. `LABEL` is `norm_label(label)`'s words, each passed through `re.escape` (R5, as `nodes.py:847-848` does) and joined by `[\s_-]+`.
     - **(R5)** `not _tweak_names_label(label, text)`: the message has no plain, un-negated mention of the label.
   - Examples:
     - "make it non-vegan" and "a non-vegetarian pasta" set the label aside;
     - "a vegan dinner my non-vegan family will enjoy" and "vegetarian chili for my non-vegetarian friends" don't. The plain mention wins.
     - A label such as "Low carb (keto)" can't break the regex.
   - The label leaves `requested` for this reply. `back` restores it, so the next turn has it again.
   - **A bare "not (a) LABEL" does nothing, and the diet is sent.** That covers "that's not vegetarian!", "is this not vegan?", "I'm not a vegetarian but my partner is", "not vegan tonight", "no longer vegan? ok" and "I'm not vegetarian any more".
   - **There's no permanent clearing in this PR** (decision 16, §8). A remembered conversation diet is cleared only by starting a new chat or changing the profile.
   - **R4: the same check covers every label source, for this one turn:**
     - inherited labels (step 5);
     - `fresh_dietary` (step 1);
     - **the stored list:** `stored_now = [l for l in stored if not _message_sets_label_aside(l, input_text)]` is what step 6 combines. The profile is never changed, so the stored label comes back on the next turn's read. `stored_dietary` (step 7) keeps the **unfiltered** `stored`, so research records it in `diets_set_aside`.
   - `_message_sets_label_aside` returns False for a label with no words (`norm_label(label).strip("-") == ""`) (R4).
   - `_NEGATED_NAME_PREFIXES` and refine's `_tweak_names_label` are untouched.
5. `requested = fresh_dietary or _dedupe_labels([l for l in inherited if not _message_sets_label_aside(l, input_text) and not _inherited_contradicted(l)])`. `_inherited_contradicted` is the R6 two-part test from step 3; it replaces R5's single-haystack call. The `_dedupe_labels` is new in R4: an old session can hold "Dairy Free" and "dairy-free" side by side.
6. If stored is non-empty, `constraints["dietary"] = _combine_dietary_preferences(stored_now, requested, constraints, input_text)`, as today but with the filtered lists. Otherwise, if `inherited` is non-empty, `constraints["dietary"] = requested`. Otherwise the key is left as it is (or holds the filtered fresh list from step 1), so state is unchanged when there's nothing to check.
   - **R4: `_combine_dietary_preferences` and `_drop_redundant_dietary`** compare labels through `norm_label` instead of `.strip().lower()`, for the `present_lower` set (809-813) and the `present`/`key` checks (764-771). So "Dairy Free" and "dairy-free" dedupe.
   - `_DIETARY_SUBSUMES`' keys are already in normalised form.
   - Nothing else in these functions changes.
7. Return three new per-turn keys alongside `constraints_extracted`:
   - `"session_dietary": inherited`, pre-filter;
   - `"fresh_dietary": fresh_dietary`;
   - `"stored_dietary": stored`.

   R1-R2's `session_dietary_rejected` / `session_dietary_cleared` key is removed in R3.

### 2.2 `research_recipe` (`recipe/nodes.py:1342-1416`), one definition covering both paths

- Pick branch: `session_dietary = rehydrated_dietary`. Direct branch: `session_dietary = list(state.get("session_dietary") or [])`.
- `dietary_set_aside = _diets_set_aside(_dedupe_labels([*stored_dietary, *session_dietary]), constraints.get("dietary") or [])` replaces 1406.
  - It's still "labels not covered by the final diet", now over stored **and** conversation labels, stored first.
  - A this-turn `non-LABEL` set-aside **is** recorded, so a refine of this card skips it.
  - R2's cleared-label exclusion is gone with permanent clearing (R3).
  - A final Vegan still covers a stored Vegetarian.
- It returns `session_dietary` too, so the persistence step sees it on both paths.

### 2.3 Persistence: a set-aside conversation diet is remembered, not forgotten

- New `constraints_to_persist(state: WorkflowState) -> dict[str, Any] | None` in `recipe/nodes.py`:
  - **R5:** it returns `state["recipe_constraints"]` with `dietary = _dedupe_labels([*fresh_dietary, *session_dietary, *kept_final])`.
    - `session_dietary` (that is, `back`) is **all** of it now, not just the labels the final diet doesn't cover.
    - **Why:** `stored Vegan` + "vegetarian dinner ideas" gives a final `["Vegan"]` (the combine collapses to the stricter diet). Under R4, the fresh Vegetarian was then lost, because only the final diet fed `kept_final`, and Vegan is stored-only.
    - The collapse to the stricter diet still happens when the diets are combined at generation time, never when they're stored.
    - The R2-R4 bullets below describe `kept_final`. The R4 `back` bullet is superseded.
  - **`kept_final` (R2, widened in R4):** the labels in the final diet that meet any of these, compared by `norm_label`:
    - they **aren't stored-origin**;
    - they **were named this turn** (`fresh_dietary`);
    - **(R4)** they're **already in `session_dietary`**.
    - Why R2 added the rule: R1 kept all of `final`, and `final` includes the stored labels extract and research fold in, so a profile diet stuck in the session after the profile dropped it. A stored label that only the stored read supplied is still not persisted.
    - **Why R4 widens it:** after this PR, **anything already in the session counts as conversation-origin**, even if it matches a stored label. Otherwise a label the user named ("actually make it vegetarian") is persisted on that turn, dropped on the next turn because it's stored-origin and no longer fresh, and lost on the turn after (S5d).
  - **`back` (R4; superseded in R5 by "all of `session_dietary`"):** the `session_dietary` labels not covered by the final diet. A this-turn set-aside is always put back, as it still is in R5.
    - R2-R3's "not stored-origin, unless named this turn" clause is dropped. It could never fire, because a fresh diet empties `inherited`.
    - Under the R4 rule, a stored-origin label already in the session is conversation-origin anyway.
  - **Stored-origin** means in the per-turn `stored_dietary` key, written by extract (which already reads it at 1090) and by research on the pick path. So the helper does no I/O.
  - It returns the constraints **unchanged when `stored_dietary` isn't in state**, i.e. when neither extract nor research ran this turn (refine, cooking-help without extract). Otherwise it always applies both rules, even with no `session_dietary`.
  - **It always sets the `dietary` key when it applies (R3), even to `[]`,** and returns `{**(recipe_constraints or {}), "dietary": [...]}`.
    - The router saves only when the dict is truthy (`if constraints:` at `router.py:1154`, `1218` and `1425`).
    - So an intentionally empty diet still saves as the non-empty dict `{"dietary": []}`. It overwrites a stale persisted `["Vegetarian"]` instead of being skipped, which would leave the stale value in place.
    - The three router sites keep their `if constraints:` guard, applied to the helper's return value.
  - **Legacy sessions (R4).** A session persisted before this PR can hold a stored label (main folded it in at every recipe turn). Under the R4 rule it's conversation-origin, and it stays until a new chat. That's the "errs on keeping" side (§8).
  - A conversation diet that duplicates the stored one ("vegetarian ideas" with a stored Vegetarian) is persisted on the turn it's named, and kept from then on because it's in the session. R3's accepted edge, where it was dropped, is gone.
- The three router sites (1153, 1217 and 1424) call it instead of reading `state["recipe_constraints"]` directly. The comment at 1146-1152 is rewritten to say this is what makes the reassertion true for conversation diets.
- **The effect.** "vegetarian dinner ideas" → "chicken curry" → "pasta":
  - the chicken card is generated without Vegetarian and records `diets_set_aside == ["Vegetarian"]`;
  - the session still holds Vegetarian, so "pasta" is vegetarian again;
  - a "make it spicier" refine on the chicken card skips Vegetarian through the card's carried set-aside (#544 rule (i)).
- **Refine is unaffected.** It sets no `session_dietary`, and `test_a_refine_set_aside_is_never_written_back_to_the_session` keeps passing unmodified.
- **The pick path's forgetting (§0) is fixed by the same helper.**
- `workflows/state.py` gains three keys next to 151-157, each commented as per-turn and never persisted: `session_dietary`, `fresh_dietary` and `stored_dietary` (all `list[str]`). Research also writes `stored_dietary` on the pick path.
- **Refine is still unaffected (R2 check).** A refine state has no `stored_dietary`, so `test_a_refine_set_aside_is_never_written_back_to_the_session` (saved `dietary == ["Vegetarian"]`) passes unmodified.
- **No clearing (R3).** A remembered conversation diet stays until a new chat. "I'm not vegetarian any more" doesn't clear it: that message probably routes to general chat anyway, where extract never runs. A stored diet is changed on the profile page (§8).

## 3. Tests

**Two new files (R4), so "fails on main" can really be shown:**
- **`ai-service/tests/test_issues_684_685_callers.py`** holds the caller tests: C1-C8 (including C1b and C6b), S1-S8 (including S5b, S5c and S5d), S9b, S10, S10c, S10d, S11, S11b, S12, S13, S14 and S15, plus T-D1 (it imports only main symbols).
  - It **imports only symbols that exist on main at `087a481`**: `extract_recipe_constraints`, `score_pantry_ingredients`, `research_recipe`, `generate_grounded_recipe`, `refine_recipe_node`, `carry_dietary_tags`, `_dietary_contradicted`, `_combine_dietary_preferences` and `_drop_redundant_dietary` (R5, for T-D1), `_drop_diets_the_main_contradicts` and `_finish_meal_followup_constraints` from their modules; `fixed_main_constraints`; `meal_options_stage`; `update_session_node`; the models; and `create_app`.
  - So every row either fails on main on its assertion, or passes on main, never with an `ImportError`.
  - To show it: copy the file into the `git archive` of main (`$SCRATCH/main-tree/ai-service/tests/`) and run it there. The PR body lists the red and green rows.
- **`ai-service/tests/test_diet_terms.py`** holds the pure-API tests: every T-* row (T-P*, T-TP, T-FP, T-F1, T-G1, T-M1, T-ID1, T-ID2, T-Q1, T-L1), S9 and S10b.
  - It imports the new symbols (`diet_terms`, `constraints_to_persist`, `_message_sets_label_aside`, `added_clauses`). It can't run on main, and none of its rows are marked "fails on main".
  - T-ID2's refine assertion also appears as a C3 row in the callers file.
- **The rule for rows below:** a row keeps its "(fails on main)" / "(naive-widen guard)" marker only if it lives in the callers file. Markers on T-* rows describe main's behaviour, which the same row in the callers file demonstrates, where one exists.
- It has its own small harness copied from `test_issue_544_refine_dietary.py:64-216` (`_FakeAI`, `_env`, `_direct_turn`, `_pick_turn`, `_refine`). No cross-test imports.
- Single patch target: `bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences`. The meal tests also patch `bubbly_chef.workflows.meal.fixed_main.get_stored_dietary_preferences`, as the #651 suites do.
- **(fails on main)** marks tests that must be seen red on a `main` checkout first. **(naive-widen guard)** marks tests that pass on main but would fail if the table were widened without the guards.

### 3.1 Pure matcher (`diet_terms`)

- **T-P1 `term_pattern`, positive:** anchovy/anchovies, turkey/turkeys, tomato/tomatoes/tomatos, berry/berries, fish/fishes, prawn/prawns, octopus/octopuses, sausage/sausages, meatball/meatballs.
- **T-P2 `term_pattern`, negative:** cod ≠ codes; ham ≠ hamburger, graham; egg ≠ eggplant, eggless; nut ≠ nutmeg, coconut, butternut, doughnut, chestnut; lard ≠ larder; scallop ≠ scalloped; goose ≠ gooseberry; pepperoni ≠ pepper; chicken ≠ chickpea; berry never matches "berrie".
- **T-P3 table hygiene:**
  - no entry equals another entry's generated plural (no `egg` + `eggs`);
  - every term on main's 718-744 table is still matched by its label (for each old term *x* under label *L*, `names_forbidden_food(L, x)`), so nothing was lost.
- **T-TP, true positives for Vegetarian,** each in a sentence ("pasta with X"): pancetta, chorizo, prosciutto, salami, pepperoni, steak, duck, lamb, anchovies, prawns, shrimp, crab, gelatin, lard. Plurals and forms: steaks, anchovy, salamis, sausages, shrimps, crabs, ducks, lamb chops, meatballs, "non-vegetarian chicken curry", "tofu and chicken", "mushroom chicken", "coconut shrimp", "oyster sauce", "soy sauce chicken". **(fails on main)** for every term not in the old table and for the plurals sausages and shrimps. Also:
  - Vegan: eggs, honey, ghee, buttermilk, cheese, "duck eggs".
  - Dairy-free: "buttermilk pancakes" **(fails on main)**.
  - Nut-free: "peanut butter", "almond milk", "pine nuts", walnuts.
- **R1 true positives** (Vegetarian), each **(fails on main)**: fish sauce (passes on main, pinned so a false friend never swallows it), halibut, tilapia, haddock, catfish, swordfish, monkfish, sea bass, snapper, herring, eel, caviar, roe, crawfish, crayfish, bonito, brisket, bratwurst, kielbasa, andouille, mortadella, nduja, quail, foie gras, jerky, tallow, geese, octopi. Also "apple cheese" and "pumpkin cream" for Vegan (guard 3's butter-only bases, R1).
- **T-FP, false positives, parametrized** over Vegetarian and Vegan, plus Dairy-free for the dairy rows:
  - coconut milk, butter beans, oyster mushrooms, cauliflower steak, tempeh bacon, vegan chorizo, eggplant, chickpeas, peanut butter, cream of tartar;
  - plus duck eggs (Vegetarian only), quail eggs (Vegetarian only), crab apples, lamb's lettuce, flax egg (Vegan), meat-free, egg-free, chickpea tuna, jackfruit pulled pork, coconut bacon, mushroom meatballs, mushroom jerky, eggplant caviar, vegan pulled pork, "veggie sausages";
  - **R1:** soya milk, hazelnut milk, macadamia milk, flax milk, walnut milk, pistachio milk (Vegan and Dairy-free; they still hit Nut-free where the base is a nut), beef tomatoes, steak fries, steak-cut fries, oyster crackers, lobster mushroom, "meat and dairy free", "egg and dairy free", "egg, dairy and nut free", chicken of the woods, duck sauce, cream soda, butter lettuce, chia egg, cocoa butter, shea butter.
  - **R1 separator rows** (these assert that it **is** named, through `join_fields`): `join_fields("pasta", "mushrooms", "bacon")` and `join_fields("tofu", "chicken thighs")` name a Vegetarian-forbidden food; the space-joined strings of the same fields don't. That pins why the separator exists.
  - Each asserts `not names_forbidden_food(label, text)`.
  - **(fails on main)** for Vegan with coconut milk, butter beans, peanut butter, cream of tartar and tempeh bacon, for Vegetarian with tempeh bacon, and for egg-free under Vegan.
  - **(naive-widen guard)** for oyster mushrooms, cauliflower steak, vegan chorizo, duck eggs, crab apples, lamb's lettuce, chickpea tuna, jackfruit pulled pork and mushroom meatballs.
- **T-F1, guard 1's closed set (R3):**
  - "pasta with chicken, dairy free" and "a chicken and dairy-free dinner" name a Vegetarian-forbidden food (chicken isn't a list item);
  - "meat and dairy free", "egg, dairy and nut free" and "fish and gluten free" don't name meat, egg or fish;
  - `mentions("chicken", "Chicken")` and `mentions("lamb", "lamb’s shoulder")` are True (R3: `mentions` normalises itself);
  - **(R4) not a list, so the food is named:**
    - "pasta with fish, dairy free" (Vegetarian: fish);
    - "meat, dairy free" (Vegetarian: a bare two-item comma);
  - **(R4) a list, so the food isn't named:**
    - "meat, dairy and gluten free";
    - the Oxford comma "meat, dairy, and gluten free";
    - "meat or dairy free";
    - "egg & dairy free" (Vegan: egg);
    - "dairy/gluten free" (Dairy-free: dairy);
    - the suspended hyphen "meat- and dairy-free";
    - "egg, dairy and tree nut free" (Vegan: egg);
    - "tree-nut and peanut free" (Nut-free: nut and peanut).
- **T-M1 guard 5's markers by term (R4):**
  - "vegetarian cheese toastie" names a food for Vegan and Dairy-free;
  - "meatless egg bake" and "veggie honey glaze" name one for Vegan;
  - "vegan cheese", "plant-based butter", "tofu egg scramble" and "dairy-free yogurt" don't;
  - "vegetarian sausage" still doesn't name one for Vegetarian.
- **T-D1 dedupe through `norm_label` (R4):**
  - `_combine_dietary_preferences(["Dairy Free"], ["dairy-free"], {}, "pasta") == ["Dairy Free"]`;
  - `_drop_redundant_dietary(["Vegan", "Dairy Free"]) == ["Vegan"]`.

  Both fail on main, whose `.strip().lower()` keeps both spellings.
- **R4 true positives:**
  - Vegetarian: lox, "chicken liver pâté", suet, bresaola, speck, oxtail, tripe;
  - Nut-free: "macadamia cookies" **(fails on main)**.
  - **R4 false positives:** "vegetable suet", "a speck of salt" and "specks of pepper" don't name a food for Vegetarian (`NO_PLURAL` and the false friend).
- **R5 rows:**
  - T-FP: "non-dairy milk" and "non-dairy creamer" don't name a food for Vegan or Dairy-free;
  - T-TP: "vegetarian but chicken curry" names chicken for Vegetarian (the window stops at `but`), and so do "vegan then chicken wings" and "veggie, also chicken".
- **T-G1 the `plant_markers` flag:** "tempeh bacon" contradicts Vegetarian with `plant_markers=False` and doesn't with the default; "butter beans" doesn't contradict Vegan either way (guard 2 is always on).
- **T-ID1 refine identity:** `refine_diet._PLANT_COMPOUND.pattern` and `_PLANT_MARKER.pattern` equal the literal strings from main's `refine_diet.py:36-41` (copied into the test).
- **T-ID2:** `added_text("add tofu, chicken too")` still contains "chicken", and a chat refine with that tweak on a vegetarian card sets Vegetarian aside. That proves the marker window isn't re-applied to refine's joined text.
- **T-ID3 is dropped (R2).** `added_text` is `" ".join(added_clauses(...))` by construction. The proof is `test_added_text`, the negation-span tests and the #544 corpus, all unmodified (§1.2).
- **T-Q1 (R2):** `names_forbidden_food("vegetarian", "lamb’s lettuce")` is False, and `names_forbidden_food("vegetarian", "add the lamb’s shoulder")` is True.
- **T-L1 (R1):** `names_forbidden_food` finds `dairy-free` for the labels "Dairy Free", "dairy_free" and "DAIRY-FREE" **(fails on main for the first two)**.
- **T-P1 addition (R1):** goose/geese, octopus/octopi. T-P3 also checks that every `IRREGULAR_PLURALS` key is a table term.

### 3.2 Every caller (issue #684)

- **C1 first turn, direct** (real node order):
  - stored Vegetarian, "chorizo pasta": the generator is called without Vegetarian and `diets_set_aside == ["Vegetarian"]` **(fails on main)**;
  - "vegan chorizo pasta" keeps Vegetarian **(naive-widen guard)**;
  - stored Vegan, "coconut milk curry": kept **(fails on main)**;
  - stored Vegetarian, "cauliflower steak with chimichurri": kept.
- **C1b first turn, brainstorm:** stored Vegetarian, "salami ideas" through extract: `recipe_constraints["dietary"] == []` **(fails on main)**.
- **C2 pick:**
  - stored Vegetarian, "Prawn Pad Thai": set aside **(fails on main)**;
  - "Oyster Mushroom Stir-Fry": kept **(naive-widen guard)**.
- **C3 chat refine:**
  - "add pancetta" on a vegetarian card: `"dietary" not in sent`, and the refined card carries it **(fails on main)**;
  - "add chorizo": set aside **(fails on main)**;
  - "add oyster mushrooms": kept **(naive-widen guard)**;
  - stored Vegan, "add butter beans": kept **(fails on main)**;
  - **R1:** "add mushrooms, bacon too" on a vegetarian card sets Vegetarian aside (passes on main; it guards the clause join against guard 4);
  - **R1:** "add cauliflower steak" keeps Vegetarian **(naive-widen guard)**;
  - **R2:** "make it meat and dairy free" keeps stored Vegetarian (and sends Dairy-free when it's stored) **(fails on main: "meat" survives `added_text`'s strip)**;
  - **R2:** "egg and dairy free please" keeps stored Vegan **(fails on main)**.
- **C4 library route:**
  - an untagged "Carbonara" (spaghetti, pancetta), "make it quicker", stored Vegetarian: `"dietary" not in constraints` **(fails on main)**;
  - **R1:** an untagged row with ingredients ("pasta", "mushrooms", "bacon") drops Vegetarian (passes on main; it guards the separator against guard 4);
  - **R1:** an untagged row with ("tofu", "chicken thighs") drops Vegetarian (passes on main; it guards the separator against guard 5);
  - an untagged "Cauliflower Steaks" (cauliflower steak, tahini): kept **(naive-widen guard)**;
  - an untagged "Tempeh BLT": kept **(fails on main; the inverse of the old pinned misfire)**.
- **C5 `carry_dietary_tags`:**
  - a "vegetarian" tag is dropped by "add pancetta" **(fails on main)**;
  - **(R3)** "add chicken, dairy free cheese" drops the "vegetarian" tag, because the whole-tweak check still names chicken under guard 1's closed set. The matching chat refine sets Vegetarian aside.
- **C6 `fixed_main_constraints`:**
  - stored Vegetarian, main "Spaghetti Carbonara" with pancetta: vegetarian isn't in `dietary` **(fails on main)**;
  - stored Vegan, the untagged "Chat Curry" (chickpeas, coconut milk): vegan kept **(fails on main)**.
- **C6b (R1):** stored Vegetarian, an untagged main with ingredients ("pasta", "mushrooms", "bacon"): vegetarian set aside (the separator through `_dietary_haystack`).
- **C7 `_drop_diets_the_main_contradicts`:**
  - carried vegetarian, main "Chorizo Paella" untagged: dropped **(fails on main)**;
  - **R1:** an untagged main "Garden Bake" with ingredients ("tofu", "chicken thighs"): dropped (the separator at `meal/nodes.py:243`).
- **C8 `_finish_meal_followup_constraints`:** retained `{"dietary": ["vegetarian"]}`, merged `{}`, pill "add some prawns": vegetarian dropped **(fails on main)**.

### 3.3 Issue #685

A "session" here is `{"metadata": {"recipe_constraints": {...}}}`, run through the direct order.
- **S1** session `dietary: ["Vegetarian"]`, no stored diet, "chicken curry": the generator is called without Vegetarian, and the card has `diets_set_aside == ["Vegetarian"]` **(fails on main)**.
- **S2** the same session, "pasta": Vegetarian is sent, and `diets_set_aside == []`.
- **S3** stored Vegetarian **and** session `["Vegetarian"]` (any earlier card turn), "chicken curry": set aside, and `diets_set_aside == ["Vegetarian"]` (one entry) **(fails on main: the requested side re-adds it)**.
- **S4** session `["Vegetarian"]`, extraction stubbed to `dietary: ["Vegetarian"]` ("vegetarian chicken curry"): kept. A diet named this turn is never checked.
- **S5 (R1, reversed):** session `{dietary: ["Vegetarian"], must_use_ingredients: ["chicken"]}`, "something quick": Vegetarian is **kept**. An inherited must_use isn't this turn's ask.
- **S5b chain (R1),** through `update_session_node` between turns:
  1. "use up my chicken" (extraction: must_use `["chicken"]`);
  2. "actually make it vegetarian" (extraction: dietary `["Vegetarian"]`);
  3. "something quick" (extraction: nothing).

  Turn 3 sends Vegetarian.
- **S5d stored-diet variant (R4),** the same harness with **stored Vegetarian**, four turns:
  1. "use up my chicken";
  2. "actually make it vegetarian";
  3. "something quick";
  4. "something quick".

  Vegetarian is sent at T3 **and** at T4, and it's in the persisted `dietary` after T3. It passes on main. Under R3 it failed at T4: the label was stored-origin and not fresh at T3, so T3 dropped it from the session, and T4's stored combine set it aside against the inherited chicken.
- **S5c (R1):** session `["Vegetarian"]`, "something with the leftovers", extraction returns `preferred_ingredients: ["chicken"]`. Vegetarian is set aside, `diets_set_aside == ["Vegetarian"]`, and the persisted session keeps Vegetarian. A fresh extracted ingredient counts, as in #394 **(fails on main)**.
- **S6** brainstorm: session `["Vegetarian"]`, "chicken ideas" through extract: `"Vegetarian" not in recipe_constraints["dietary"]`, and `state["session_dietary"] == ["Vegetarian"]` **(fails on main)**.
- **S7 persistence chain.** S1's result through `update_session_node` (router `get_repository` patched, as at `test_issue_544_refine_dietary.py:724-741`):
  - the saved `recipe_constraints.dietary == ["Vegetarian"]` and `picked_recipe.diets_set_aside == ["Vegetarian"]`;
  - then "pasta" from the saved session sends Vegetarian;
  - then a "make it spicier" refine on the chicken card, with that saved `prior`, gives `"dietary" not in sent` **(fails on main: the card records nothing, so refine re-sends Vegetarian)**.
- **S8 pick persistence:** session `["Vegetarian"]`, no stored diet, a "Chicken Tikka" pick through `update_session_node`: the saved `dietary == ["Vegetarian"]` **(fails on main: saved `[]`)**. Then a "tofu curry" direct turn from that session sends Vegetarian **(fails on main)**.
- **S9 `constraints_to_persist` unit:**
  - no `stored_dietary` key returns the same constraints;
  - a covered label isn't duplicated;
  - **(R5, flipped; R6 states the full state)** a held Vegetarian is persisted even when the final diet's Vegan covers it. With `session_dietary: ["Vegetarian"]`, `stored_dietary: []`, `fresh_dietary: []` and a final `["Vegan"]`, both labels are persisted: Vegan isn't stored-only, and Vegetarian is in the session;
  - **(R2, R4)** a stored-origin label in `final` is dropped unless it's in `fresh_dietary` **or already in `session_dietary`**;
  - **(R4)** `back` returns a stored-origin `session_dietary` label that the final diet doesn't cover;
  - **(R3)** when it applies, the `dietary` key is always present: `{"recipe_constraints": {}, "stored_dietary": ["Vegetarian"], "fresh_dietary": [], "session_dietary": []}` returns `{"dietary": []}`.
- **S9b (R3's router half, moved to the callers file in R4).** A session with no prior constraints, stored Vegetarian, "pasta", with the extraction stub **raising**, so extract starts from `{}`.
  - Through `update_session_node`, the router saves (the `{"dietary": []}` dict passes its truthy guard), and the saved `recipe_constraints.dietary == []`.
  - **(fails on main: it saves `["Vegetarian"]`)**
- **S5b passes on main.** It pins decision 8, so no fix can make an inherited must_use override a later-named diet.
- **S10 the one-turn tier (R3, replacing R1-R2's clearing tests).** Session `["Vegetarian"]` (or `["Vegan"]` for the vegan rows), no stored diet, through `update_session_node`, then a "pasta" turn from the saved session.
  - **Set aside for this turn only:** "make it non-vegan" and "a non-vegetarian pasta".
    - The label isn't sent this turn and is recorded in `diets_set_aside`.
    - It's restored in the persisted `dietary`, and the next "pasta" sends it.
    - **(fails on main: main sends it this turn)**
  - **Does nothing; the diet is sent this turn and the next:** "that's not vegetarian!", "is this not vegan?" (R4: no forbidden food, unlike R3's honey sentence, which would be contradicted), "not vegetarian-friendly enough", "I'm not a vegetarian but my partner is", "not vegan tonight", "no longer vegan? ok" and "I'm not vegetarian any more".
- **S10b unit (R3; pure-API file):**
  - `_message_sets_label_aside` is True for "make it non-vegan", "non vegetarian pasta" and "I’d like it non-vegan" (with a curly apostrophe).
  - It's False for every "does nothing" row above, and for "is honey not vegan?" (R4: kept here only).
  - **(R4)** It's False for the labels `""` and `"-"`.
  - **(R5)** It's False for "a vegan dinner my non-vegan family will enjoy" (Vegan) and "vegetarian chili for my non-vegetarian friends" (Vegetarian).
  - **(R5)** The label "Low carb (keto)" with "non-low carb (keto) please" doesn't raise and returns True. With "pasta", it returns False.
- **S10c non-LABEL beats a fresh extraction (R4):**
  - extraction stubbed to `dietary: ["Vegan"]` for "make it non-vegan", no stored diet, no session: Vegan isn't sent **(fails on main)**;
  - a variant with session `["Gluten-free"]`: Gluten-free is still sent, because the filtered fresh list is empty, so the merge inherits it;
  - **(R5)** session `["Vegan"]`, "a vegan dinner my non-vegan family will enjoy", extraction `["Vegan"]`: Vegan is sent;
  - **(R5)** session `["Vegetarian"]`, "vegetarian chili for my non-vegetarian friends": Vegetarian is sent.
- **S10d a stored label, this turn only (R4):** stored Vegan, "make it non-vegan":
  - Vegan isn't sent, and `diets_set_aside == ["Vegan"]` **(fails on main)**;
  - through `update_session_node`, then "pasta": Vegan is sent again, from the stored read. The profile is never changed.
- **S11 a legacy session label is kept (R1, reversed in R4):** stored Vegetarian, session `["Vegetarian"]` (as main persisted it), "chicken curry" through `update_session_node`:
  - Vegetarian isn't sent, and `diets_set_aside == ["Vegetarian"]`;
  - the persisted `dietary` **keeps** Vegetarian (`back`: the session label is conversation-origin);
  - the next "pasta" sends Vegetarian.
- **S11b the profile diet isn't stuck in the session (R2):**
  - stored Vegetarian, "pasta" through `update_session_node`: the persisted `dietary` lacks Vegetarian (Vegetarian **was** sent this turn);
  - then the stored diet is patched to `[]` and "pasta" runs from the saved session: Vegetarian isn't sent **(fails on main: the session kept it)**.
  - A variant where the message names it ("vegetarian pasta", extraction `dietary: ["Vegetarian"]`) persists Vegetarian.
- **S14 negated foods don't count against an inherited diet (R5),** parametrized over "pasta with no meat" and "something without chicken". Session `["Vegetarian"]`, no stored diet:
  - Vegetarian is sent, and it isn't in `diets_set_aside`.
  - It passes on main, which never checks inherited labels. It pins that the new check doesn't misfire on negation.
  - A control, "pasta with chicken, no cheese", sets Vegetarian aside.
  - **(R6) Vegetarian is kept, session `["Vegetarian"]`, no stored diet:**
    - "vegan pulled pork tacos": the whole-message check's plant markers apply;
    - "meat and dairy free pasta": the whole-message check's coordinated `-free` list applies;
    - "something quick", with extraction returning `preferred_ingredients: ["tempeh bacon"]`: the field check's default guards apply.

    Each passes on main, which never checks inherited labels, and pins the two-part test.
- **S15 a named looser diet survives a stricter stored one (R5):** stored Vegan, "vegetarian dinner ideas" (extraction `dietary: ["Vegetarian"]`), through `update_session_node`:
  - the persisted `dietary == ["Vegetarian"]`;
  - then "cheese omelette" from the saved session sends Vegetarian, and not Vegan, which the cheese contradicts;
  - **(fails on main:** main persists `["Vegan"]` and the second turn sends Vegan, re-added from the session).
- **S12 meal fresh turn (R1).** The `meal_options_stage` branch at `meal/nodes.py:891`, with session `recipe_constraints.dietary == ["Vegetarian"]`, no stored diet and no retained meal, message "a chicken dinner": the meal's `recipe_constraints["dietary"]` lacks Vegetarian **(fails on main)**. With "a pasta dinner", it holds Vegetarian.
- **S13 cooking-help fallback (R1).** `update_session_node` with intent `cooking_help`, `brainstorm_ideas` present, `recipe_constraints == {"dietary": []}`, `session_dietary == ["Vegetarian"]` and `stored_dietary == []`: the saved `recipe_constraints.dietary == ["Vegetarian"]`. That proves `router.py:1424` uses `constraints_to_persist`.

### 3.4 Existing tests that change

Name each in the PR body with the reason.
- **`test_issue_544_refine_dietary.py:411-420`, `test_session_vegetarian_does_not_survive_a_chicken_tikka_pick`:** assert `diets_set_aside == ["Vegetarian"]` for both params (was `== stored`). That's §2.2: the pick records a set-aside conversation diet. `"dietary" not in state["recipe_constraints"]` stays, because persistence restores it only in `update_session_node`.
- **`:884-889`, `test_library_refine_without_the_tag_drops_the_misfiring_diet`:** rename it `test_library_refine_of_an_untagged_tempeh_blt_keeps_the_diet` and assert kept. The guard now reaches the library check (§1.3 row 4).
- **`:900-921`, `test_chained_library_refines_keep_the_diet_through_the_carried_tag` (R1):** the same fixture switch as below. Its tag is otherwise no longer what keeps the diet.
- **`:925-936`, `test_a_library_tweak_that_sets_the_diet_aside_drops_the_carried_tag`:** no change needed. "add bacon" still sets the diet aside, and the tempeh fixture no longer matters there.
- **`:872-881` and `:892-899`, the tag-rescue tests:** switch the fixture to a row that **still** misfires, "Chicken-Style Lentil Bake" with ingredients ("chicken-style seasoning", "lentils"), with a precondition `assert _dietary_contradicted("vegetarian", "chicken-style seasoning")`. Add a no-tag twin that drops, so the tag rescue is still proven.

### 3.5 Guards that must pass unmodified

- `test_dietary_preferences.py` (#394), `test_constraint_inheritance.py`, `test_issue_651_meal_pills.py`, `test_issue_651_make_it_a_meal.py`, `test_issue_650_meal_from_chat.py`, `test_refine_recipe_node.py` and `test_session_round_trip.py`.
- **All of `test_issue_544_refine_dietary.py` except §3.4**, including the whole `test_tweak_adds_a_forbidden_food_only_when_it_really_adds_it` corpus and `test_added_text`. Together with T-ID1 and T-ID2, this is the proof that refine's parsing is unchanged.
- If a #394 or #651 guard fails, stop and report it. Don't edit it. It means a caller changed in a way §1.3 doesn't list.

## 4. Ownership

**`backend` only**, one agent, in the session worktree. The files:
- `bubbly_chef/domain/diet_terms.py` (new)
- `bubbly_chef/workflows/recipe/refine_diet.py`
- `bubbly_chef/workflows/recipe/nodes.py`
- `bubbly_chef/workflows/router.py` (the three persistence sites and the comment only)
- `bubbly_chef/workflows/state.py`
- `tests/test_issues_684_685_callers.py` (new, R4: main-importable caller tests)
- `tests/test_diet_terms.py` (new, R4: pure-API tests)
- `tests/test_issue_544_refine_dietary.py` (§3.4 only)

- `bubbly_chef/workflows/meal/nodes.py`, **one line** (R1): the haystack at 243 goes through `join_fields`.

`meal/fixed_main.py` gets **no edits**; it's fixed through `_dietary_haystack`. No frontend, prompt, migration or model change.

## 5. Gates

```
cd ai-service && pytest && ruff check bubbly_chef/ && ./scripts/mypy_gate.sh
```

- The new module must be mypy-strict clean, with no baseline growth.
- Every **(fails on main)** test is seen red against a `git archive` of `main` before the fix, noted in the PR body.

## 6. Verify: side-by-side prompt capture, no live model

Gemini is capped and there's no local Ollama, so verify is a deterministic capture, head against main, with a fake AI manager. The PR body states that no live model was used.

1. **The main tree:** `git archive origin/main ai-service | tar -x -C "$SCRATCH/main-tree"`. Never check out main in the worktree.
2. **The script:** `$SCRATCH/diet_capture.py`, outside the repo. For each case it prints one JSON line `{case, sent_dietary, diets_set_aside, persisted_dietary}`, driven with the §3 harness (`_FakeAI`, patched stored diet, `search_recipe`, `get_repository`). The cases:
   - **Direct:** stored ∈ {[], Vegetarian, Vegan, Dairy-free, Nut-free} × every T-TP and T-FP sentence.
   - **Session chains:** S1, S3, S5, S5b, S5c, S5d, S7, S9b, S10, S10c, S10d, S11, S11b, S14 and S15, and the S8 pick chain, including `update_session_node`'s persisted `dietary`.
   - **Refine:** every tweak in `test_tweak_adds_a_forbidden_food_only_when_it_really_adds_it`, plus "add pancetta", "add chorizo", "add oyster mushrooms", "add butter beans", "add tofu, chicken too", "add mushrooms, bacon too", "add cauliflower steak", "make it meat and dairy free" and "egg and dairy free please".
   - **Library:** the C4 rows (the two separator rows included) and the Tempeh BLT.
   - **Meal:** C6, C6b, C7, C8 and S12.
3. **Run it twice** with the head worktree's interpreter: `cd <tree>/ai-service && PYTHONPATH=. python "$SCRATCH/diet_capture.py" > "$SCRATCH/<head|main>.jsonl"`. Then `diff`.
4. **The PR body carries:**
   - a table of every changed row (case, main, head), each mapped to a §3 test and marked expected;
   - the count of identical rows;
   - an explicit line that **every #544 refine-corpus row is identical**.
   Any changed row not predicted by §1.3 or §2 blocks the PR.

## 7. Decisions (reversible; log each in the sprint doc)

1. **One matcher in `domain/diet_terms.py`, used by every caller.** *Rejected:*
   - widening the table in place in `nodes.py`, which gives the first-turn, meal and library paths new false positives (cauliflower steak, oyster mushrooms, duck eggs) that only refine is guarded against;
   - a second, refine-only table (#544 R3), which the #544 review already rejected.
2. **The guard rejects a term occurrence; it doesn't strip whole phrases.** So "almond milk" still names almond for Nut-free, and "peanut butter" still names peanut. *Rejected:* reusing #681's whole-phrase strip on the shared path, which would hide the nut in "almond milk" from a Nut-free check.
3. **Refine keeps its own clause-scoped strip and calls with `plant_markers=False`.** Its regexes are rebuilt from the moved word lists, and the pattern strings are pinned. *Rejected:* letting refine use the shared marker window, which misreads "add tofu, chicken too" across the clause join.
4. **The false friends are always on, refine included.** *Rejected:* keeping refine byte-identical there too, which would leave "add butter beans" dropping Vegan and let widening add "add oyster mushrooms" and "add cauliflower steak" misfires.
5. **The vegetable-imitation guard neutralises only the imitated terms** (steak, bacon, chorizo, sausage, meatball, meat, pork, tuna), so "mushroom chicken" and "coconut shrimp" still count. *Rejected:* treating mushroom and coconut as general plant markers.
6. **The plural helper builds from the singular, with suffix rules by ending.** *Rejected:* `(?:e?s)?` on every term (cod → "codes"), and stemming the input text (tomatoes → "tomatoe").
7. **A miss keeps the diet, and that's the safe direction.** Where a phrase is ambiguous ("tofu chicken", "vegan mayo chicken salad"), the guard leans towards keeping the diet. The generator then gets "vegetarian + chicken" and makes a plant-based version, which is better than silently dropping the diet.
8. **Issue #685: check inherited labels only, against this turn's text and freshly extracted ingredients (R1).** *Rejected:*
   - checking fresh labels too, which would drop Vegetarian from "vegetarian chicken curry";
   - the merged haystack (the original draft), where an inherited "use up my chicken" silently undoes a later "actually make it vegetarian". That breaks decision 7's "a miss keeps the diet".

   The cost: the prompt can carry Vegetarian beside an inherited must_use of chicken, and the generator resolves it (§8).
9. **Remember a set-aside conversation diet in the persisted session** (`constraints_to_persist`), and record it in `diets_set_aside`. *Rejected:* persisting the filtered diet, as the pick path does on main. That fixes "chicken curry" but makes the conversation forget "I'm vegetarian" for good after one chicken dish. The stored diet is re-read every turn; a conversation diet isn't.
10. **Issue #685 also covers stored diets on a session's second recipe turn** (S3), since the mechanism is the same. The PR body says it widens the issue as filed.
11. **A hard field separator in every haystack (R1).** *Rejected:* space-joined haystacks, where guards 4 and 5 read across neighbouring ingredients; and turning guards 4 and 5 off for ingredient lists, which brings back "cauliflower steak" misfires on rows.
12. **Refine matches per clause through `added_clauses`, not with the imitation guard off (R1).** *Rejected:* `imitations=False` in refine, which lets widening add "add cauliflower steak" misfires.
13. **A stored label only the stored read supplied is never persisted (R2). A label already in the session counts as conversation-origin and is kept (R4). A persisted diet always carries the `dietary` key (R3).** *Rejected:*
    - R2-R3's "stored-origin unless named this turn", which drops a label the user named two turns ago (S5d);
    - persisting all of `final`, which keeps a profile diet in the session after the profile drops it;
    - omitting an empty `dietary`, which the router's truthy guard would skip, leaving a stale value.
14. **Labels are looked up through `norm_label` (R1).** *Rejected:* keeping `strip().lower()`, which silently never checks "Dairy Free".
15. **Refine sets a diet aside only when both the per-clause text and the whole tweak name the food (R2).** The second check can only keep a diet. *Rejected:* teaching `added_text`'s `-free` strip about coordinated lists, which would change #681's parser.
16. **No permanent clearing of a conversation diet in this PR (R3, the coordinator's call).** A remembered conversation diet is cleared only by a new chat or a profile change. That errs on keeping the diet. Only a `non-LABEL` dish modifier ("make it non-vegan") sets it aside, and for one turn. A bare "not (a) LABEL" does nothing. *Rejected:*
    - regex first-person clearing (three review rounds; it still fired on "but my partner is", "tonight" and questions);
    - a one-turn set-aside on any negated mention (R2), which drops the diet when the user complains ("that's not vegetarian!").

    A bare "I'm not vegetarian any more" probably routes to general chat, where extract never runs anyway.
17. **Guard 1's coordinated `-free` lists accept only a closed set of items (R3).** *Rejected:* any word as a list item (R1-R2), which read "chicken, dairy free" as a free-from list and kept Vegetarian next to real chicken.

## 8. Out of scope

- **Negation words can strip a positive food (known gap, R6).**
  - `_NEGATION`'s words include less, not, cut and hold, so "less salt, more chicken", "cut the chicken into strips" or "hold on, add chicken" can remove the chicken from the per-clause text.
  - An inherited diet is then kept, which is the safe direction: the generator makes a vegetarian version.
  - Refine has the same gap, from #681.
- **Negation on the stored-diet and meal paths.** An **inherited** conversation diet ignores negated foods (R5, S14). A **stored** Vegetarian is still set aside by "pasta without chicken" or "pizza without pepperoni", because the #394 combine keeps its raw haystack. The first-turn path has no `added_text` pass, and this PR widens the terms that can hit it. Suggest a follow-up issue: run a first-turn `added_text`-style pass.
- **Named cheeses and other dairy** (paneer, parmesan, mozzarella, ricotta, feta) for Vegan and Dairy-free, and meat dishes as terms (burger, bolognese, hot dog). Ambiguous or dish-level, so not added.
- **Brand imitations** (Beyond, Impossible, Quorn) and "chicken-style" seasonings, which still misfire. That misfire is now the tag-rescue fixture (§3.4).
- **`_merge_constraints` override:** a fresh diet replaces the conversation's ("gluten-free" said later drops an earlier "vegetarian"). That's existing behaviour.
- **Rib and rabbit** aren't terms ("rib of celery", "Welsh rabbit"). "Short ribs" and "rabbit stew" therefore keep a stored Vegetarian, which is the safe miss.
- **An inherited must_use that contradicts a kept diet** (the S5b chain) isn't dropped from the constraints. The prompt carries both, and the generator makes a vegetarian dish. Dropping contradicting inherited ingredients is a follow-up.
- **Clearing a remembered conversation diet from chat (follow-up; the coordinator files the issue).** In this PR, "I'm not vegetarian any more" doesn't clear it. Only a new chat or a profile change does. A stored diet is changed on the profile page.
  - The follow-up should decide clearing at the intent or classifier level, not with regex.
  - Regex clearing was tried for three review rounds and still fired on "I'm not a vegetarian but my partner is", "not vegan tonight" and "no longer vegan? ok".
- **Complaints** ("that's not vegetarian!") do nothing to the diet. It's still sent, which errs on keeping it. Whether the reply should acknowledge the complaint is a separate question.
- **Refine's whole-tweak check (R2)** can only keep a diet. After R3's closed set, "add chicken, dairy free cheese" still names chicken, so it sets Vegetarian aside and drops the tag (C5). No over-keep edge is known.
- **Legacy sessions keep a stored label (R4).** A session persisted before this PR, which main filled with the stored diet, keeps that label as a conversation diet until a new chat, even if the profile drops it. That errs on keeping. So does a conversation diet that duplicates the stored one once it's in the session (§2.3).
- **Refine's own plant strip (#681) is unchanged by guard 5's R4 marker split.** Refine calls with `plant_markers=False`, and `added_text` still strips "vegetarian cheese" as a marker phrase. So "add vegetarian cheese" on a stored-Vegan card keeps Vegan: the safe direction, and #681 behaviour.
- **A "non-LABEL" modifier** sets a stored label aside for one turn only. It never edits the profile.
- **Refine's own plant guard** stays at #681's one-word window ("add vegan chorizo sausage" still sets Vegetarian aside in refine).
- **Plurals in exclusions** and allergies (issue #500, the allergies work): untouched.
- **Routing:** whether "chicken curry" after a card routes to direct generation or to refine is the classifier's call. The tests drive the nodes.

## 9. Needs the human

None. It's a reversible v1 bug fix with no cost. Decision 9 (persisting a set-aside conversation diet) and decision 10 (widening issue #685 to stored diets) are logged product calls, stated in the PR body.

## Revision R1 (fresh review: one blocker, ten findings, all accepted)

| # | Finding | Change |
|---|---|---|
| 1 | **BLOCKER:** guards 4 and 5 read across space-joined fields (`["pasta","mushrooms","bacon"]` hides bacon; `["tofu","chicken thighs"]` hides chicken) | `FIELD_SEP = " \| "` and `join_fields` in `diet_terms`. Every multi-field haystack uses them: `_dietary_haystack` (`recipe/nodes.py:792-795`, which also fixes `fixed_main.py:397-402` and the meal combine), the library `ingredient_names` (934-936) and `meal/nodes.py:243` (a one-line edit, added to §4). Refine matches per clause through the new `added_clauses`, joined with `FIELD_SEP` and `plant_markers=False`; `added_text` output is byte-identical (T-ID3). Tests: the T-FP separator rows; C3 "add mushrooms, bacon too" and "add cauliflower steak"; C4's two separator rows; C6b; C7's tofu/chicken-thighs main (§1.1, §1.2, §1.3, §3, §7.11-12) |
| 2 | False positives | Guard 2 gains beef tomatoes, steak fries and steak-cut fries, oyster crackers, lobster mushroom and quail eggs. Guard 3 gains soya, hazelnut, macadamia, flax, walnut and pistachio milk bases. Guard 1 covers coordinated `-free` lists ("meat and dairy free"). All of these, plus chicken of the woods, duck sauce, cream soda, butter lettuce and chia egg, are in T-FP. "fish sauce" is in the true positives |
| 3 | Missing meats | Added halibut, tilapia, haddock, catfish, swordfish, monkfish, sea bass, snapper, herring, eel, caviar, roe, crawfish, crayfish, bonito, brisket, bratwurst, kielbasa, andouille, mortadella, nduja, quail, foie gras, jerky and tallow. `IRREGULAR_PLURALS` gives geese and octopi. Rib and rabbit are deliberately left out (§8). Jerky, brisket and caviar join guard 4's imitated terms ("mushroom jerky", "eggplant caviar") |
| 4 | S5 contradicted decision 7 | Inherited labels are checked against **this turn's** text and freshly extracted ingredients only (`_dietary_haystack(input_text, fresh)`). The stored combine keeps its #394 haystack. S5 is reversed (kept). The chain S5b ("use up my chicken" → "actually make it vegetarian" → "something quick") keeps Vegetarian. Decision 8 is rewritten, and the leftover contradiction is in §8 |
| 5 | A conversation diet must be clearable | `_message_rejects_label` (non-/not/no longer/not a/not an). A rejected inherited label leaves `requested` and is never put back. `back` also excludes stored labels (a per-turn `stored_dietary` key, no I/O in the helper). Tests: S10 (clearing, four phrasings) and S11 (stored not persisted); decision 13 |
| 6 | The chained library test relies on the tempeh misfire | `test_chained_library_refines_keep_the_diet_through_the_carried_tag` (`:900-921`) moves to the chicken-style fixture, listed in §3.4 |
| 7 | Coverage gaps | S5c: extraction returns preferred `["chicken"]`, so Vegetarian is set aside, recorded and still persisted. S12: the meal fresh turn (`meal/nodes.py:891`) with a session Vegetarian. S13: the router cooking-help fallback (`router.py:1424`) uses `constraints_to_persist` |
| 8 | Guard 3's bases were too broad | Split into `MILK_BASES` (every dairy noun) and `BUTTER_ONLY_BASES` (apple, cocoa, cacao, shea, pumpkin: butter only). Pinned: "apple cheese" and "pumpkin cream" still hit Vegan |
| 9 | Regex or literal text? | Stated in §1.1. Table terms and irregular plurals are literal (`re.escape`); every guard tuple and false-friend phrase is a regex fragment, joined unescaped. Tests compile fragments or compare built patterns, never raw text |
| 10 | Label lookup | `names_forbidden_food` looks labels up through `norm_label`, moved to `diet_terms` with `nodes._norm_label` kept as an alias. T-L1: "Dairy Free" and "dairy_free" reach `dairy-free`. The §8 "label spelling" gap is removed, and the change goes in the PR body (decision 14) |

## Revision R2 (review: one blocker, six findings, all accepted)

| # | Finding | Change |
|---|---|---|
| 1 | **BLOCKER:** R1's rejection cleared a conversation diet on a complaint ("not vegetarian-friendly enough", "that's not vegetarian!", "is honey not vegan?") | Two tiers (§2.1 step 4). **Cleared for good** only by `_message_clears_label`: `(?:i'?m\|i am\|we'?re\|we are)\s+(?:not\|no longer)\s+(?:an?\s+)?LABEL`, a clause-initial `no longer LABEL`, or `make it non[- ]?LABEL`, with `(?![\w-])` after LABEL. Any other negated mention sets the label aside for this reply only, and `back` restores it. "vegetarian-friendly" isn't a mention at all. The state key becomes `session_dietary_cleared`. S10 is rewritten with positives ("I'm not vegetarian any more", "we're no longer vegan", …) and the three negatives; S10b tests the unit; decision 13 |
| 2 | "Stored labels never persisted" was false: `constraints_to_persist` kept all of `final` | `kept_final` keeps a final label only if it isn't stored-origin or was named this turn (`fresh_dietary`). `back` has the same stored rule. The helper applies whenever `stored_dietary` is in state (extract or research ran), and is unchanged otherwise, so refine is unaffected. It covers all three router sites (1153/1217/1424). New per-turn keys: `fresh_dietary`, `stored_dietary`. S11b: the profile diet is removed between turns, so "pasta" doesn't send it. S9 extended; the accepted edge is in §8 |
| 3 | Refine and coordinated `-free` lists | A refine sets a diet aside only when it's contradicted in the per-clause `added_haystack` **and** `names_forbidden_food(label, tweak_lower, plant_markers=False)` on the whole tweak. It can only keep a diet. `carry_dietary_tags` uses the same test. C3 gains "make it meat and dairy free" and "egg and dairy free please". Every set-aside row in the #681 corpus names its food in the whole tweak, so the corpus is unchanged (§1.2, decision 15). The over-keep edge ("add chicken, dairy free cheese") is in §8 |
| 4 | `added_clauses` must include the preprocessing | `added_clauses` holds `added_text`'s whole body (lowercasing, the `’` fix, `_PLANT_COMPOUND`, `_FREE_SPAN`, the clause loop). `added_text = " ".join(added_clauses(...))` by construction. T-ID3 is dropped; the proof is `test_added_text`, the negation-span tests and the #544 corpus, all unmodified |
| 5 | The direct branch's `diets_set_aside` recorded cleared labels | `_diets_set_aside` runs over `stored ∪ (session_dietary − session_dietary_cleared)`. Cleared labels aren't recorded; this-turn set-asides are (§2.2) |
| 6 | Curly apostrophes | `names_forbidden_food` (and `_message_clears_label`) turn `’` into `'` before matching. T-Q1 ("lamb’s lettuce") |

## Revision R3 (simplify: the coordinator's product call)

The R1 and R2 rows on clearing (R1 #5; R2 #1 and #5) are **superseded** by this revision.

| # | Finding | Change |
|---|---|---|
| 1 | Permanent clearing fires too often ("I'm not a vegetarian but my partner is", "not vegan tonight", "no longer vegan? ok") | **Removed from this PR.** A remembered conversation diet is cleared only by a new chat or a profile change. `_message_clears_label`, the `session_dietary_cleared` state key, `back`'s cleared rule and `_diets_set_aside`'s cleared exclusion are all gone, along with the R2 clearing tests. Decision 16 logs the rejected alternative, "regex first-person clearing (three review rounds; still fires on 'but my partner is', 'tonight', questions)". §8 lists clearing as a follow-up; the coordinator files the issue |
| 2 | The one-turn tier dropped the diet on a complaint | Only a `non[- ]LABEL(?![\w-])` dish modifier (`_message_sets_label_aside`: "make it non-vegan", "a non-vegetarian pasta") sets an inherited label aside, for this turn only; it's recorded in `diets_set_aside` and restored by `back`. A bare "not (a) LABEL" does nothing, and the diet is sent. S10 and S10b are rewritten: "that's not vegetarian!", "is honey not vegan?", "not vegetarian-friendly enough", "I'm not a vegetarian but my partner is", "not vegan tonight", "no longer vegan? ok" and "I'm not vegetarian any more" all send it |
| 3 | Guard 1's coordinated lists accepted any word | (b) now applies only when the term **and** every coordinated item are in the closed set `FREE_LIST_ITEMS` (meat, dairy, egg, nut, peanut, gluten, wheat, soy, lactose, fish, shellfish, sugar). T-F1: "pasta with chicken, dairy free" and "a chicken and dairy-free dinner" set Vegetarian aside. C5: "add chicken, dairy free cheese" drops the Vegetarian tag. §8's over-keep entry is corrected; decision 17 |
| 4 | Nit: `mentions()` normalisation | `mentions` lowercases and turns `’` into `'` itself (§1.1, T-F1) |
| 5 | Nit: an empty diet and the router's truthy guard | `constraints_to_persist` always sets `dietary` when it applies, returning `{**(rc or {}), "dietary": [...]}`. So an intentionally empty diet saves as the non-empty dict `{"dietary": []}` through the `if constraints:` guards at `router.py:1154/1218/1425`, overwriting a stale value. S9 is extended; decision 13 |

## Revision R4 (Opus review of R3: needs changes, eight findings, all accepted)

| # | Finding | Change |
|---|---|---|
| 1 | A stored-origin label was dropped two turns later | `kept_final` also keeps a label already in `session_dietary`; anything in the session is conversation-origin. `back` = `session_dietary` not covered by the final diet (the dead "unless named this turn" clause is gone). S11 is reversed (a legacy session label is kept). New S5d is the stored-Vegetarian four-turn chain, kept at T4. S9 and decision 13 updated, and §8 notes legacy sessions |
| 2 | S10's "is honey not vegan?" contains honey | The S10 row is now "is this not vegan?"; the honey sentence is in S10b only |
| 3 | "non-LABEL" was only checked on inherited labels | `_message_sets_label_aside` also filters `fresh_dietary` (before the merge, so the session diet still inherits) and the stored list (`stored_now`, this turn only; `stored_dietary` stays unfiltered, so it's recorded in `diets_set_aside`; the profile is never changed). S10c: extraction `["Vegan"]` + "make it non-vegan". S10d: stored Vegan is set aside, then comes back next turn |
| 4 | The test file couldn't fail on main for the right reason | Split: `test_issues_684_685_callers.py` (main-importable symbols only: C*, S1-S8, S9b, S10, S10c, S10d, S11-S13; copied into the main archive to show red and green rows) and `test_diet_terms.py` (T-*, S9, S10b). §3's header states the file for each row; the R3 router half of S9 moved to S9b |
| 5 | Guard 1(b) list forms | The last separator must be and/or/&/slash (no bare "X, Y free"). `SEP = (?:\s*,\s*(?:(?:and\|or\|&)\s+)?\|\s+(?:and\|or\|&)\s+\|\s*/\s*)`, items `(?:ITEM)s?-?` for the suspended hyphen, and `tree[\s-]nut` added. T-F1 gains "pasta with fish, dairy free" (fish named), "meat, dairy free", the Oxford comma, "or", "&", "dairy/gluten free", "meat- and dairy-free", tree nut rows |
| 6 | Word lists | Macadamia joins NUTS. Lox (SEAFOOD) and liver, suet, bresaola, speck, oxtail and tripe (MEAT) become Vegetarian terms. `NO_PLURAL = {"speck"}`; false friends `vegetable suet` and `speck of`. R4 true- and false-positive rows added |
| 7 | Guard 5 markers too broad for dairy, egg and honey | `DAIRY_EGG_MARKERS` (vegan, plant-based, dairy-free, tofu, tempeh, seitan) for DAIRY ∪ {egg, honey}; full markers for meat and seafood. T-M1: "vegetarian cheese toastie" hits Vegan and Dairy-free. Refine is unaffected (§8) |
| 8 | Dedupe and empty labels | The no-stored `requested` is wrapped in `_dedupe_labels`. `_message_sets_label_aside` is False for a label with no words. `_combine_dietary_preferences` (809-813) and `_drop_redundant_dietary` (764-771) compare through `norm_label`. T-D1 |

## Revision R5 (review of R4: needs changes, six findings, all accepted)

| # | Finding | Change |
|---|---|---|
| 1 | "non-LABEL" fired beside a plain mention | `_message_sets_label_aside` = `non-LABEL` matches **and** `not _tweak_names_label(label, text)`. S10b and S10c: "a vegan dinner my non-vegan family will enjoy" keeps Vegan, and "vegetarian chili for my non-vegetarian friends" keeps Vegetarian |
| 2 | The inherited-diet check counted negated foods | For that check only, the haystack is `join_fields(*added_clauses(input_text), *fresh must_use, *fresh preferred)`, with `plant_markers=False` (`_NEGATION` strips no/without/skip). S14: "pasta with no meat" and "something without chicken" send Vegetarian, and it isn't in `diets_set_aside`; "pasta with chicken, no cheese" is the control. §8's negation bullet now covers only stored diets |
| 3 | Persisting lost a fresh looser diet under a stricter stored one | Persist `_dedupe_labels([*fresh_dietary, *session_dietary, *(final labels that aren't stored-only)])`, so `back` is all of `session_dietary`. The collapse to the stricter diet happens at combine time only. The S9 "covers" row is flipped. S15: stored Vegan + "vegetarian dinner ideas" persists `["Vegetarian"]`, then "cheese omelette" sends Vegetarian |
| 4 | "non-dairy" hit `dairy` | False friend `non[\s-]?dairy` for `dairy`. T-FP rows "non-dairy milk" and "non-dairy creamer" (Vegan, Dairy-free) |
| 5 | Label words unescaped | `_message_sets_label_aside` runs `re.escape` on each word, as `nodes.py:847-848` does. S10b: "Low carb (keto)" doesn't raise |
| 6 | Guard 5's window crossed `but`, `then`, `also` and `except` | Added to the window's stop words. T-TP: "vegetarian but chicken curry" names chicken |
| — | T-D1 imports | `_combine_dietary_preferences` and `_drop_redundant_dietary` added to §3's callers-file import list |

## Revision R6 (review of R5: two findings accepted; the build revision)

| # | Finding | Change |
|---|---|---|
| 1 | R5's single inherited-diet haystack lost the whole-message guards | `_inherited_contradicted(l)` = `(names_forbidden_food(l, join_fields(*added_clauses(text)), plant_markers=False) and names_forbidden_food(l, text)) or names_forbidden_food(l, join_fields(*fresh_must_use, *fresh_preferred))`, with the field check on the default guards (§2.1 steps 3 and 5). S14 gains three rows that keep Vegetarian: "vegan pulled pork tacos", "meat and dairy free pasta", fresh preferred `["tempeh bacon"]` |
| 2 | S9's flipped row didn't give its full state | It states `stored_dietary: []` and `fresh_dietary: []` |
| — | Known gap | §8: negation words (less, not, cut, hold) can strip a positive food, so an inherited diet is kept (the safe direction) |
