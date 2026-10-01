/**
 * Finding a pantry item in the kitchen's storage sheet (issue #817).
 *
 * The /pantry grid is gone (#750): `/pantry` redirects to the kitchen home and
 * the items live in the storage sheets (fridge, freezer, shelves, basket). A
 * spec that adds an item through the Add sheet therefore has to open a place
 * and look the item up by name. The sheet's search field covers every place, so
 * it finds the item whichever place the add put it in (a freehand item gets a
 * default place the spec should not depend on).
 *
 * Sources of truth for the selectors:
 *   - components/kitchen/StorageSheet.tsx — search input placeholder
 *     "Search all N items"; each hit is a StorageRow button
 *   - components/kitchen/StorageTile.tsx  — the row's aria-label starts with the item name
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Open the storage sheet from the kitchen home and search every place for
 * `itemName`. Returns the matching row buttons (zero or more); callers assert
 * on them — visible after an add, gone after a delete.
 *
 * Call this with the Add sheet closed and the home mounted. The sheet stays
 * open afterwards, holding the search text, so a caller can re-assert on the
 * returned locator after an edit or delete (the sheet comes back with its
 * search text when the edit sheet closes).
 */
export async function findItemInStorageSheet(page: Page, itemName: string): Promise<Locator> {
  // Any place opens the same sheet; search is across all of them.
  await page.getByRole('button', { name: /^Fridge/ }).click();
  const search = page.getByPlaceholder(/^Search all/);
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill(itemName);
  // Case-insensitive: titleCase() capitalizes the leading letter.
  return page.getByRole('button', { name: new RegExp(itemName, 'i') });
}
