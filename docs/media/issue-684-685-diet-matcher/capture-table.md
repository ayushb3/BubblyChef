# §6 capture: head vs main (deterministic, no live model)

Cases: 1100. Identical: **342**. Changed: **758** (249 direct rows changed by the matcher, 475 direct rows changed only in the persisted column, 34 chain/refine/library/meal rows).

**Every #544 refine-corpus row is identical: YES** (25 of 25 rows).

Changed rows not predicted by §1.3 / §2: **0**. One changed row comes from review finding 5 rather than §1.3 (flagged below).

## Chains, refine, library, meal (every changed row)

| case | main | head | §3 test | predicted by |
|---|---|---|---|---|
| `S1` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=[] aside=["Vegetarian"] saved=["Vegetarian"] | S1 | §2.1 steps 2-5 |
| `S3` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=[] aside=["Vegetarian"] saved=["Vegetarian"] | S3 | §2.1 |
| `S5c` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=[] aside=["Vegetarian"] saved=["Vegetarian"] | S5c | §2.1 step 3 (fresh fields) |
| `S7.t1` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=[] aside=["Vegetarian"] saved=["Vegetarian"] | S7 | §2.1, §2.2, §2.3 |
| `S7.refine` | sent=["Vegetarian"] aside=[] saved=null | sent=[] aside=["Vegetarian"] saved=null | S7 (refine skips via carried set-aside) | §2.2/§2.3 |
| `S8.pick` | sent=[] aside=[] saved=null | sent=[] aside=["Vegetarian"] saved=["Vegetarian"] | S8 | §2.2, §2.3 |
| `S8.t2` | sent=[] aside=[] saved=[] | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | S8 | §2.3 |
| `S9b` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=["Vegetarian"] aside=[] saved=[] | S9b | §2.3 (always-set dietary) |
| `S10.t1\|make it non-vegan` | sent=["Vegan"] aside=[] saved=["Vegan"] | sent=[] aside=["Vegan"] saved=["Vegan"] | S10 | §2.1 step 4 |
| `S10.t1\|a non-vegetarian pasta` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=[] aside=["Vegetarian"] saved=["Vegetarian"] | S10 | §2.1 step 4 |
| `S10c.fresh-vegan` | sent=["Vegan"] aside=[] saved=["Vegan"] | sent=[] aside=[] saved=[] | S10c | §2.1 step 1 |
| `S10c.session-gf` | sent=["Vegan"] aside=[] saved=["Vegan"] | sent=["Gluten-free"] aside=[] saved=["Gluten-free"] | S10c | §2.1 step 1 |
| `S10d.t1` | sent=["Vegan"] aside=[] saved=["Vegan"] | sent=[] aside=["Vegan"] saved=[] | S10d | §2.1 step 4 (stored_now) |
| `S10d.t2` | sent=["Vegan"] aside=[] saved=["Vegan"] | sent=["Vegan"] aside=[] saved=[] | S10d (persisted no longer holds the stored label) | §2.3 |
| `S11.t1` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=[] aside=["Vegetarian"] saved=["Vegetarian"] | S11 | §2.1, §2.2 |
| `S11b.t1` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=["Vegetarian"] aside=[] saved=[] | S11b | §2.3 (stored-only not persisted) |
| `S11b.t2` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=[] aside=[] saved=[] | S11b | §2.3 |
| `S14\|pasta with chicken, no cheese` | sent=["Vegetarian"] aside=[] saved=["Vegetarian"] | sent=[] aside=["Vegetarian"] saved=["Vegetarian"] | S14 control | §2.1 step 3 |
| `S15.t1` | sent=["Vegan"] aside=[] saved=["Vegan"] | sent=["Vegan"] aside=[] saved=["Vegetarian"] | S15 | §2.3 (R5) |
| `S15.t2` | sent=["Vegan"] aside=[] saved=["Vegan"] | sent=["Vegetarian"] aside=["Vegan"] saved=["Vegetarian"] | S15 | §2.3 (R5) |
| `refine\|add pancetta\|stored=['Vegetarian']` | sent=["Vegetarian"] aside=[] saved=null | sent=[] aside=["Vegetarian"] saved=null | C3 | §1.3 row 3 |
| `refine\|add chorizo\|stored=['Vegetarian']` | sent=["Vegetarian"] aside=[] saved=null | sent=[] aside=["Vegetarian"] saved=null | C3 | §1.3 row 3 |
| `refine\|add butter beans\|stored=['Vegan']` | sent=[] aside=["Vegan"] saved=null | sent=["Vegan"] aside=[] saved=null | C3 | §1.3 row 3 (guard 2) |
| `refine\|make it meat and dairy free\|stored=['Vegetarian']` | sent=[] aside=["Vegetarian"] saved=null | sent=["Vegetarian"] aside=[] saved=null | C3 (R2) | §1.2 whole-tweak check |
| `refine\|make it meat and dairy free\|stored=['Vegetarian', 'Dairy-free']` | sent=["Dairy-free"] aside=["Vegetarian"] saved=null | sent=["Vegetarian", "Dairy-free"] aside=[] saved=null | C3 (R2) | §1.2 whole-tweak check |
| `refine\|egg and dairy free please\|stored=['Vegan']` | sent=[] aside=["Vegan"] saved=null | sent=["Vegan"] aside=[] saved=null | C3 (R2) | §1.2 whole-tweak check |
| `library\|carbonara` | sent=["Vegetarian"] aside=null saved=null | sent=[] aside=null saved=null | C4 | §1.3 row 4 |
| `library\|tempeh BLT untagged` | sent=[] aside=null saved=null | sent=["Vegetarian"] aside=null saved=null | C4 / test_library_refine_of_an_untagged_tempeh_blt_keeps_the_diet | §1.3 row 4 |
| `meal\|C6\|Spaghetti Carbonara\|stored=['Vegetarian']` | sent=["vegetarian"] aside=null saved=null | sent=[] aside=null saved=null | C6 | §1.3 row 8 |
| `meal\|C6\|Chat Curry\|stored=['Vegan']` | sent=[] aside=null saved=null | sent=["vegan"] aside=null saved=null | C6 | §1.3 row 8 |
| `meal\|C7\|Chorizo Paella\|tags=None\|['vegetarian']\|quicker` | sent=["vegetarian"] aside=null saved=null | sent=[] aside=null saved=null | C7 | §1.3 row 7 |
| `meal\|C7\|Cheesy Bake\|tags=None\|['Dairy-free']\|make it dairy free` | sent=[] aside=null saved=null | sent=["Dairy-free"] aside=null saved=null | C7 (norm_label asked-for row) | review finding 5; NOT in §1.3 |
| `meal\|C8\|add some prawns` | sent=["vegetarian"] aside=null saved=null | sent=[] aside=null saved=null | C8 | §1.3 row 6 |
| `meal\|S12\|a chicken dinner` | sent=["Vegetarian"] aside=null saved=null | sent=[] aside=null saved=null | S12 | §2.1 (fresh meal turn) |

## Direct first turn: the matcher changed what is sent (§1.3 row 1)

Columns: stored diet, message. `sent` is the dietary list the generator received; `aside` is the card's diets_set_aside. The persisted column changes too (see next section).

| stored | message | main sent / aside | head sent / aside | §3 test |
|---|---|---|---|---|
| ['Vegetarian'] | anchovy | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | anchovy | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | anchovies | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | anchovies | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | turkeys | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | turkeys | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | fishes | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | fishes | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | prawn | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | prawn | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | prawns | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | prawns | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | octopus | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | octopus | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | octopuses | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | octopuses | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | octopi | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | octopi | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | goose | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | goose | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | geese | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | geese | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | sausages | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | sausages | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | meatball | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | meatball | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | meatballs | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | meatballs | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | sea bass | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | sea bass | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | sea basses | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegan'] | sea basses | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_matches_the_forms_of_a_term |
| ['Vegetarian'] | cod | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_does_not_match_lookalikes |
| ['Vegan'] | cod | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_does_not_match_lookalikes |
| ['Nut-free'] | nut | ["Nut-free"] / [] | [] / ["Nut-free"] | test_term_pattern_does_not_match_lookalikes |
| ['Vegetarian'] | lard | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_does_not_match_lookalikes |
| ['Vegan'] | lard | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_does_not_match_lookalikes |
| ['Vegetarian'] | scallop | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_does_not_match_lookalikes |
| ['Vegan'] | scallop | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_does_not_match_lookalikes |
| ['Vegetarian'] | pepperoni | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_term_pattern_does_not_match_lookalikes |
| ['Vegan'] | pepperoni | ["Vegan"] / [] | [] / ["Vegan"] | test_term_pattern_does_not_match_lookalikes |
| ['Vegetarian'] | pasta with pancetta | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with pancetta | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with chorizo | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with chorizo | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with prosciutto | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with prosciutto | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with salami | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with salami | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with pepperoni | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with pepperoni | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with steak | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with steak | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with duck | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with duck | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with anchovies | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with anchovies | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with prawns | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with prawns | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with crab | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with crab | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with gelatin | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with gelatin | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | pasta with lard | ["Vegetarian"] / [] | [] / ["Vegetarian"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegan'] | pasta with lard | ["Vegan"] / [] | [] / ["Vegan"] | T-TP test_tp_vegetarian_forbidden_terms_in_a_sentence |
| ['Vegetarian'] | steaks | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegan'] | steaks | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegetarian'] | salamis | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegan'] | salamis | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegetarian'] | shrimps | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegan'] | shrimps | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegetarian'] | crabs | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegan'] | crabs | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegetarian'] | ducks | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegan'] | ducks | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegetarian'] | oyster sauce | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegan'] | oyster sauce | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_vegetarian_forms_and_lookalike_dishes |
| ['Vegetarian'] | halibut | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | halibut | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | tilapia | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | tilapia | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | haddock | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | haddock | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | catfish | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | catfish | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | swordfish | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | swordfish | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | monkfish | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | monkfish | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | snapper | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | snapper | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | herring | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | herring | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | eel | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | eel | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | caviar | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | caviar | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | roe | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | roe | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | crawfish | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | crawfish | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | crayfish | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | crayfish | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | bonito | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | bonito | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | brisket | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | brisket | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | bratwurst | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | bratwurst | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | kielbasa | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | kielbasa | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | andouille | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | andouille | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | mortadella | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | mortadella | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | nduja | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | nduja | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | quail | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | quail | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | foie gras | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | foie gras | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | jerky | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | jerky | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | tallow | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r1_terms |
| ['Vegan'] | tallow | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r1_terms |
| ['Vegetarian'] | lox | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r4_vegetarian_terms |
| ['Vegan'] | lox | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r4_vegetarian_terms |
| ['Vegetarian'] | suet | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r4_vegetarian_terms |
| ['Vegan'] | suet | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r4_vegetarian_terms |
| ['Vegetarian'] | bresaola | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r4_vegetarian_terms |
| ['Vegan'] | bresaola | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r4_vegetarian_terms |
| ['Vegetarian'] | speck | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r4_vegetarian_terms |
| ['Vegan'] | speck | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r4_vegetarian_terms |
| ['Vegetarian'] | oxtail | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r4_vegetarian_terms |
| ['Vegan'] | oxtail | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r4_vegetarian_terms |
| ['Vegetarian'] | tripe | ["Vegetarian"] / [] | [] / ["Vegetarian"] | test_tp_r4_vegetarian_terms |
| ['Vegan'] | tripe | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_r4_vegetarian_terms |
| ['Vegan'] | ghee | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_vegan |
| ['Dairy-free'] | ghee | ["Dairy-free"] / [] | [] / ["Dairy-free"] | test_tp_vegan |
| ['Vegan'] | buttermilk | ["Vegan"] / [] | [] / ["Vegan"] | test_tp_vegan |
| ['Dairy-free'] | buttermilk | ["Dairy-free"] / [] | [] / ["Dairy-free"] | test_tp_vegan |
| ['Vegan'] | peanut butter | [] / ["Vegan"] | ["Vegan"] / [] | test_tp_nut_free |
| ['Dairy-free'] | peanut butter | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_tp_nut_free |
| ['Vegan'] | almond milk | [] / ["Vegan"] | ["Vegan"] / [] | test_tp_nut_free |
| ['Dairy-free'] | almond milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_tp_nut_free |
| ['Nut-free'] | macadamia cookies | ["Nut-free"] / [] | [] / ["Nut-free"] | test_tp_nut_free |
| ['Vegan'] | coconut milk | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | coconut milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | butter beans | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | butter beans | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | tempeh bacon | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | tempeh bacon | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | cream of tartar | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | cream of tartar | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | lamb's lettuce | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | lamb's lettuce | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | meat-free | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | meat-free | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | egg-free | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | chickpea tuna | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | chickpea tuna | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | jackfruit pulled pork | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | jackfruit pulled pork | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | coconut bacon | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | coconut bacon | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | vegan pulled pork | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | vegan pulled pork | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | soya milk | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | soya milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | hazelnut milk | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | hazelnut milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | macadamia milk | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | macadamia milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Nut-free'] | macadamia milk | ["Nut-free"] / [] | [] / ["Nut-free"] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | flax milk | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | flax milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | walnut milk | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | walnut milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | pistachio milk | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | pistachio milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | beef tomatoes | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | beef tomatoes | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | meat and dairy free | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | meat and dairy free | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | meat and dairy free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | egg and dairy free | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | egg and dairy free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | egg, dairy and nut free | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | egg, dairy and nut free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | chicken of the woods | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | chicken of the woods | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | cream soda | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | cream soda | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | butter lettuce | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | butter lettuce | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | chia egg | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | cocoa butter | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | cocoa butter | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | shea butter | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | shea butter | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | non-dairy milk | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | non-dairy milk | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | non-dairy creamer | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Dairy-free'] | non-dairy creamer | [] / ["Dairy-free"] | ["Dairy-free"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | salad with beef steak tomatoes | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | salad with beef steak tomatoes | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | beef-steak tomato salad | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | beef-steak tomato salad | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | meat substitute | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | meat substitute | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | meat alternatives | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | meat alternatives | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegetarian'] | rice paper bacon | [] / ["Vegetarian"] | ["Vegetarian"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | rice paper bacon | [] / ["Vegan"] | ["Vegan"] / [] | T-FP test_fp_plant_and_lookalike_foods_name_nothing |
| ['Vegan'] | vegan cheese | [] / ["Vegan"] | ["Vegan"] / [] | test_fp_dairy_free_rows |
| ['Dairy-free'] | vegan cheese | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_fp_dairy_free_rows |
| ['Vegan'] | dairy-free yogurt | [] / ["Vegan"] | ["Vegan"] / [] | test_fp_dairy_free_rows |
| ['Dairy-free'] | dairy-free yogurt | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_fp_dairy_free_rows |
| ['Vegan'] | plant-based butter | [] / ["Vegan"] | ["Vegan"] / [] | test_fp_dairy_free_rows |
| ['Dairy-free'] | plant-based butter | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_fp_dairy_free_rows |
| ['Dairy-free'] | pasta with chicken, dairy free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_chicken_is_not_a_free_list_item |
| ['Dairy-free'] | a chicken and dairy-free dinner | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_chicken_is_not_a_free_list_item |
| ['Vegetarian'] | fish and gluten free | [] / ["Vegetarian"] | ["Vegetarian"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | fish and gluten free | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegetarian'] | meat, dairy and gluten free | [] / ["Vegetarian"] | ["Vegetarian"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | meat, dairy and gluten free | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | meat, dairy and gluten free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegetarian'] | meat, dairy, and gluten free | [] / ["Vegetarian"] | ["Vegetarian"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | meat, dairy, and gluten free | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | meat, dairy, and gluten free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegetarian'] | meat or dairy free | [] / ["Vegetarian"] | ["Vegetarian"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | meat or dairy free | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | meat or dairy free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | egg & dairy free | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | egg & dairy free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | dairy/gluten free | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | dairy/gluten free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegetarian'] | meat- and dairy-free | [] / ["Vegetarian"] | ["Vegetarian"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | meat- and dairy-free | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | meat- and dairy-free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | egg, dairy and tree nut free | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | egg, dairy and tree nut free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Nut-free'] | tree-nut and peanut free | [] / ["Nut-free"] | ["Nut-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegetarian'] | meat-and-dairy-free lasagne | [] / ["Vegetarian"] | ["Vegetarian"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Vegan'] | meat-and-dairy-free lasagne | [] / ["Vegan"] | ["Vegan"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | meat-and-dairy-free lasagne | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_coordinated_free_list_names_nothing |
| ['Dairy-free'] | pasta with fish, dairy free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_bare_two_item_comma_is_not_a_list |
| ['Dairy-free'] | meat, dairy free | [] / ["Dairy-free"] | ["Dairy-free"] / [] | test_f1_a_bare_two_item_comma_is_not_a_list |
| ['Vegan'] | tofu egg scramble | [] / ["Vegan"] | ["Vegan"] / [] | test_m1_dairy_and_egg_markers |

## Direct first turn: only the persisted column changed (§2.3, S11b)

Main persists the stored (profile) diet into the session after every recipe turn; head doesn't (`constraints_to_persist`: a stored label only the profile supplied is never written back). `sent` and `aside` are identical in these rows. Test: S11b, S9, S9b. Row-level list: `capture-persisted-only.tsv`.

| stored diet | rows |
|---|---|
| ['Dairy-free'] | 158 |
| ['Nut-free'] | 187 |
| ['Vegetarian'] | 85 |
| ['Vegan'] | 45 |
