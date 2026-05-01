import type { GeneratedRecipe } from '@/types/recipes'

describe('GeneratedRecipe type', () => {
  it('accepts a recipe with no source fields (existing usage)', () => {
    const recipe: GeneratedRecipe = {
      title: 'Pasta',
      ingredients: [],
      instructions: [],
    }
    expect(recipe.source_url).toBeUndefined()
    expect(recipe.source_platform).toBeUndefined()
  })

  it('accepts source_url as a string', () => {
    const recipe: GeneratedRecipe = {
      title: 'Pasta',
      ingredients: [],
      instructions: [],
      source_url: 'https://www.allrecipes.com/recipe/12345/pasta/',
    }
    expect(recipe.source_url).toBe('https://www.allrecipes.com/recipe/12345/pasta/')
  })

  it('accepts source_url as null', () => {
    const recipe: GeneratedRecipe = {
      title: 'Pasta',
      ingredients: [],
      instructions: [],
      source_url: null,
    }
    expect(recipe.source_url).toBeNull()
  })

  it('accepts source_platform as a string', () => {
    const recipe: GeneratedRecipe = {
      title: 'Pasta',
      ingredients: [],
      instructions: [],
      source_platform: 'allrecipes',
    }
    expect(recipe.source_platform).toBe('allrecipes')
  })

  it('accepts source_platform as null', () => {
    const recipe: GeneratedRecipe = {
      title: 'Pasta',
      ingredients: [],
      instructions: [],
      source_platform: null,
    }
    expect(recipe.source_platform).toBeNull()
  })

  it('accepts both source_url and source_platform together', () => {
    const recipe: GeneratedRecipe = {
      title: 'Pasta',
      ingredients: [],
      instructions: [],
      source_url: 'https://cooking.nytimes.com/recipes/1234-pasta',
      source_platform: 'nytimes-cooking',
    }
    expect(recipe.source_url).toBe('https://cooking.nytimes.com/recipes/1234-pasta')
    expect(recipe.source_platform).toBe('nytimes-cooking')
  })
})
