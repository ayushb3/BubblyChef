import RecipeBookLoader from '@/components/recipes/RecipeBookLoader'

export default function RecipesPage() {
  return (
    <main className="min-h-screen py-8 px-4" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-3xl mx-auto">
        <h1
          className="text-3xl font-extrabold text-center mb-6 text-[var(--color-text)]"
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          Recipe Book 📖
        </h1>
        <RecipeBookLoader />
      </div>
    </main>
  )
}
