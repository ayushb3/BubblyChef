import { redirect } from 'next/navigation'
import { storageSheetHref } from '@/lib/kitchen/places'

/**
 * `/pantry` is gone as a page (issue #750: "The Pantry tab goes, and the list
 * stays"). The list lives in the kitchen's storage sheet, so the old address
 * lands on home with that sheet open in List view.
 *
 * `?add=scan` and `?add=type` still mean "open the add sheet on that tab", so
 * they pass straight through to the home, which owns the add sheet now.
 *
 * Bookmarks, old links and the auth callback's `next=/pantry` all keep working.
 */
export default async function PantryRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { add } = await searchParams
  if (add === 'scan' || add === 'type') redirect(`/?add=${add}`)
  redirect(storageSheetHref())
}
