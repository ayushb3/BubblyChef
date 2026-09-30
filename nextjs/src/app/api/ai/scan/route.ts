import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

export async function POST(request: Request) {
  // Forward the multipart form data directly to the AI service
  const formData = await request.formData()
  const file = formData.get('file')
  const preprocess = formData.get('preprocess') ?? 'true'
  const preprocessMode = formData.get('preprocess_mode') ?? 'auto'

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  // Rebuild FormData for the AI service
  const aiForm = new FormData()
  aiForm.append('file', file)

  const params = new URLSearchParams({
    preprocess: String(preprocess),
    preprocess_mode: String(preprocessMode),
  })

  // The upstream call can throw (AI service down, connection refused, DNS)
  // before any response exists. Hand the client a known code rather than
  // letting Next answer with its own HTML 500 (issue #642). The raw error
  // message can name hosts and providers, so it is never forwarded.
  let res: Response
  try {
    res = await aiProxyFetch(`/v1/scan/receipt?${params}`, {
      method: 'POST',
      body: aiForm,
      // Don't set Content-Type — fetch sets it with the boundary for FormData
    })
  } catch {
    return NextResponse.json(
      { error: 'Scan service unavailable', code: 'vision_provider_unavailable' },
      { status: 503 },
    )
  }

  if (res instanceof NextResponse) return res

  // A platform-generated 502/504 page (or any non-JSON body) must not blow up
  // the proxy: parse defensively and fall through to a known code.
  const data = await res.json().catch(() => null)

  if (!res.ok) {
    // The AI service sends a sanitized { message, code } object as `detail`
    // (see ai-service/bubbly_chef/services/scan_errors.py, issue #396).
    // Fall back to a plain string for older/other error shapes.
    const detail = data?.detail
    const message =
      detail && typeof detail === 'object'
        ? (detail.message ?? 'Scan failed')
        : typeof detail === 'string'
          ? detail
          : 'Scan failed'
    const code =
      detail && typeof detail === 'object'
        ? detail.code
        : res.status === 502 || res.status === 503
          ? 'vision_provider_unavailable'
          : undefined

    return NextResponse.json(
      { error: message, ...(code ? { code } : {}) },
      { status: res.status },
    )
  }

  if (data === null) {
    // 200 but not JSON: the service is misbehaving, not the user.
    return NextResponse.json({ error: 'Scan failed', code: 'scan_failed' }, { status: 502 })
  }

  return NextResponse.json(data)
}
