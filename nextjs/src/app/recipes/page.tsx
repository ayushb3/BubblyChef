import BubblesHeader from '@/components/layout/BubblesHeader'
import RecipeBookLoader from '@/components/recipes/RecipeBookLoader'
import ThemePicker from '@/components/ui/ThemePicker'

export default function RecipesPage() {
  return (
    <main className="min-h-screen pb-24" style={{ background: 'var(--color-bg)' }}>
      <BubblesHeader rightSlot={<ThemePicker />} />
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <RecipeBookLoader />
      </div>
    </main>
  )
}
