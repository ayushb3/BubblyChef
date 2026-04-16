import BubblesHeader from '@/components/layout/BubblesHeader'
import RecipeBookLoader from '@/components/recipes/RecipeBookLoader'

export default function RecipesPage() {
  return (
    <main className="min-h-screen pb-24" style={{ background: 'var(--color-bg)' }}>
      <BubblesHeader />
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <RecipeBookLoader />
      </div>
    </main>
  )
}
