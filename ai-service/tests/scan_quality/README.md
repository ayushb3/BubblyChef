# Scan quality harness (issue #255)

Measures the PRD scan bar against real receipt photos: a typical receipt finishes
in **<= 15 s** (median) and **>= 90 %** of line items are correct.

It sends each fixture through `POST /v1/scan/receipt` in-process - the real route,
so the real Gemini vision OCR, the real parse workflow and the real confidence
bucketing, all through `AIManager` - and prints a table you can paste into a PR.

## Run it

It spends Gemini quota (two calls per receipt: vision OCR, then parse), so it is
opt-in. Default `pytest` and CI skip it.

```bash
cd ai-service
BUBBLY_RUN_LIVE_TESTS=1 pytest tests/test_scan_quality_live.py -v -s
```

Use `-s` to see the report. To cap spend, set `BUBBLY_SCAN_QUALITY_MAX_AI_REQUESTS=<n>`;
the request that would exceed it is refused. The offline tests for the matching
rule and the plumbing (`tests/test_scan_quality_harness.py`) run in the normal suite.

## Add a receipt

Fixtures live in `nextjs/e2e/fixtures/receipts/` (shared with the Playwright e2e).

1. Drop the photo in as `<name>.png` (or `.jpg`/`.jpeg`).
2. Next to it, add `<name>.expected.json`, written by reading the receipt, **not**
   by copying what the parser printed:

```json
{
  "store": "Grocery Mart",
  "notes": "Anything tricky: crumpled, oblique, abbreviations, items that are not food.",
  "items": [
    {"name": "eggs", "quantity": [1, 12]},
    {"name": "whole milk", "quantity": 1},
    {"name": "gala apples", "aliases": ["apples"]},
    {"name": "ground beef", "quantity": 1}
  ]
}
```

| Field | Meaning |
|---|---|
| `name` | The food as a person would say it. Required. |
| `quantity` | Optional. A number, or a list of equally defensible readings (`[1, 12]` for "1 DZ"). Omit it to not check quantity. |
| `aliases` | Optional. Other names a correct scan might use, for store abbreviations a word-set match can't bridge (`"CHKN BRST"`). |

List only food line items. Totals, tax, payment lines and footers are not items:
if the scan returns one, it counts as spurious. Images with no `.expected.json`
(like `grocery-mart-stub.png`) are ignored.

Then run the command above and paste the report into your PR.

## The matching rule

Defined in `matching.py` (and unit-tested), because the issue did not fix one.

- **Surfaced items.** Only `ready_to_add` + `needs_review` count. Items the route
  puts in `skipped` (confidence < 0.5) are never shown to the user, so an expected
  item that lands there is a miss.
- **Name.** Lowercase, drop punctuation and digits (so "80/20" and "32oz" never
  decide a match), singularize each word, compare word sets. Match when either
  set contains the other, checked against the scanned `name`, `original_name`
  and `source_line`, and against the expected `aliases`. "gala apples" matches
  "apple"; "spinach" does not match "spaghetti".
- **Quantity.** Only if the expected item has one. Pass if the scanned quantity is
  within `max(0.5, 10% of expected)` of any listed value. Units are not compared
  ("1 dozen" and "12 count" are both fine).
- **One-to-one.** A scanned item satisfies at most one expected item.
- **Accuracy** per receipt = `correct / (expected + spurious)`: a missed item, a
  wrong quantity and an invented item each cost one. **Overall** pools every line
  item across receipts. Time is wall clock for the whole request (OCR + parse),
  and the bar uses the **median** across receipts.

The browser shrinks uploads over 4 MB to a JPEG before sending; the harness does
the same (`shrink_like_browser`) so it times a request a real user could make.
The `AI requests` column counts every outbound HTTP request during the scan,
including provider retries and fallbacks.

## Limits

Two clean fixtures on a wooden table are a smoke test, not the corpus. The bar
means little until crumpled, oblique, patterned-background and heavily abbreviated
photos are in (issue #255 is waiting on those).
