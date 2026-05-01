export type UrlType = 'youtube' | 'tiktok' | 'recipe_site' | 'unknown'

export interface UrlClassification {
  type: UrlType
  platform?: string
}

const RECIPE_SITES: Record<string, string> = {
  'allrecipes.com': 'allrecipes',
  'cooking.nytimes.com': 'nytimes-cooking',
  'bbcgoodfood.com': 'bbcgoodfood',
  'food.com': 'food-com',
  'epicurious.com': 'epicurious',
  'seriouseats.com': 'seriouseats',
  'thekitchn.com': 'thekitchn',
  'bonappetit.com': 'bonappetit',
  'delish.com': 'delish',
  'taste.com.au': 'taste',
  'simplyrecipes.com': 'simplyrecipes',
}

export function classifyUrl(url: string): UrlClassification {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { type: 'unknown' }
  }

  const host = parsed.hostname.replace(/^www\./, '')

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
    return { type: 'youtube', platform: 'youtube' }
  }

  if (host === 'tiktok.com') {
    return { type: 'tiktok', platform: 'tiktok' }
  }

  if (RECIPE_SITES[host]) {
    return { type: 'recipe_site', platform: RECIPE_SITES[host] }
  }

  return { type: 'unknown' }
}
