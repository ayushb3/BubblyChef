import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

/**
 * Proxy for GET /v1/dashboard/daily (#225, #168).
 *
 * Forwards `tz_offset_minutes` straight through — the client (lib/api/dashboard.ts)
 * is responsible for computing the negated value; this route does not touch the sign.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tzOffsetMinutes = searchParams.get('tz_offset_minutes')

  const params = new URLSearchParams()
  if (tzOffsetMinutes !== null) params.set('tz_offset_minutes', tzOffsetMinutes)

  const res = await aiProxyFetch(`/v1/dashboard/daily?${params}`)

  if (res instanceof NextResponse) return res

  const data = await res.json()
  if (!res.ok) {
    return NextResponse.json(
      { error: data.detail ?? 'Dashboard daily fetch failed' },
      { status: res.status },
    )
  }

  return NextResponse.json(data)
}
