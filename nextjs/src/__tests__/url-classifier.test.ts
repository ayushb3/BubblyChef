import { classifyUrl } from '@/lib/url-classifier'

describe('classifyUrl', () => {
  // --- YouTube ---
  it('classifies youtube.com/watch URLs', () => {
    expect(classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      type: 'youtube',
      platform: 'youtube',
    })
  })

  it('classifies YouTube Shorts URLs', () => {
    expect(classifyUrl('https://www.youtube.com/shorts/abc123')).toEqual({
      type: 'youtube',
      platform: 'youtube',
    })
  })

  it('classifies youtu.be short links', () => {
    expect(classifyUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      type: 'youtube',
      platform: 'youtube',
    })
  })

  // --- TikTok ---
  it('classifies TikTok video URLs', () => {
    expect(classifyUrl('https://www.tiktok.com/@chef/video/7123456789')).toEqual({
      type: 'tiktok',
      platform: 'tiktok',
    })
  })

  // --- Recipe sites ---
  it('classifies allrecipes.com as recipe_site', () => {
    expect(classifyUrl('https://www.allrecipes.com/recipe/12345/chocolate-cake/')).toEqual({
      type: 'recipe_site',
      platform: 'allrecipes',
    })
  })

  it('classifies nytimes.com/recipes as recipe_site', () => {
    expect(classifyUrl('https://cooking.nytimes.com/recipes/12345-pasta')).toEqual({
      type: 'recipe_site',
      platform: 'nytimes-cooking',
    })
  })

  it('classifies bbcgoodfood.com as recipe_site', () => {
    expect(classifyUrl('https://www.bbcgoodfood.com/recipes/chocolate-cake')).toEqual({
      type: 'recipe_site',
      platform: 'bbcgoodfood',
    })
  })

  // --- Unknown ---
  it('returns unknown for unrecognised URLs', () => {
    expect(classifyUrl('https://www.example.com/some-page')).toEqual({ type: 'unknown' })
  })

  it('returns unknown for invalid URLs', () => {
    expect(classifyUrl('not a url')).toEqual({ type: 'unknown' })
  })
})
