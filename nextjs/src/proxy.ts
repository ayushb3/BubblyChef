import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// The Next.js `proxy` file convention (renamed from `middleware` in Next 16,
// issue #337). This is the app's only auth gate for page routes: it refreshes
// the Supabase session cookie and starts/redirects visitors per
// `lib/supabase/auth-routing.ts`. `proxy` always runs on the Node.js runtime.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
