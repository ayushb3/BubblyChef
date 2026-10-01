import { redirect } from 'next/navigation'
import { storageSheetHref } from '@/lib/kitchen/places'

/**
 * `/pantry/use-soon` (the Use Soon triage view, #139) folded into the storage
 * sheet's List with the expiry filter on (issue #750): expired food and food
 * expiring within three days, each with Cook this and Used up / Tossed.
 */
export default function UseSoonRedirect() {
  redirect(storageSheetHref({ expiry: ['expiring', 'expired'] }))
}
