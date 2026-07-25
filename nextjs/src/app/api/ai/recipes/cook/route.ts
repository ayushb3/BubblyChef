import { aiProxyJson } from '@/lib/api/ai-proxy'

export async function POST(request: Request) {
  const body = await request.json()
  return aiProxyJson('/v1/recipes/cook', body)
}
