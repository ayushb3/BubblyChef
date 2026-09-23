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

  const res = await aiProxyFetch(`/v1/scan/receipt?${params}`, {
    method: 'POST',
    body: aiForm,
    // Don't set Content-Type — fetch sets it with the boundary for FormData
  })

  if (res instanceof NextResponse) return res

  const data = await res.json()
  if (!res.ok) {
    // The AI service sends a sanitized { message, code } object as `detail`
    // (see ai-service/bubbly_chef/services/scan_errors.py, issue #396).
    // Fall back to a plain string for older/other error shapes.
    const detail = data.detail
    const message =
      detail && typeof detail === 'object' ? (detail.message ?? 'Scan failed') : (detail ?? 'Scan failed')
    const code = detail && typeof detail === 'object' ? detail.code : undefined

    return NextResponse.json(
      { error: message, ...(code ? { code } : {}) },
      { status: res.status },
    )
  }

  return NextResponse.json(data)
}
