import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { decideRouteAction } from './auth-routing'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    supabaseUrl!,
    supabaseKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const action = decideRouteAction({
    hasUser: !!user,
    isAnonymous: user?.is_anonymous === true,
    pathname: request.nextUrl.pathname,
  })

  switch (action.type) {
    case 'sign-in-anonymously': {
      // No session yet — start the visitor as a guest instead of forcing a
      // login wall. Every RLS policy in this app is `auth.uid() = user_id`
      // with no distinction for anonymous vs confirmed accounts, so an
      // anonymous Supabase user (a real `auth.users` row + UID, issued
      // immediately) already satisfies pantry/recipes/etc. with zero other
      // changes. `signInAnonymously()` drives the GoTrueClient's cookie
      // `setAll` hook above, which updates both `request.cookies` (so
      // downstream Server Components on *this* request see the new
      // session) and `supabaseResponse` (so the browser gets it too).
      const { error: anonError } = await supabase.auth.signInAnonymously()
      if (anonError) {
        // Anonymous sign-ins are a project-level toggle in the Supabase
        // dashboard (Authentication → Sign In / Providers → Anonymous
        // Sign-Ins). If it's off, this call fails and we fall back to the
        // old login-wall behavior rather than leaving the visitor stuck.
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
      }
      return supabaseResponse
    }
    case 'redirect': {
      const url = request.nextUrl.clone()
      url.pathname = action.pathname
      return NextResponse.redirect(url)
    }
    case 'continue':
    default:
      return supabaseResponse
  }
}
