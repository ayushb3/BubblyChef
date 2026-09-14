// PROTOTYPE — throwaway route for #273 (guided cooking mode).
// Four radically different guided-cook flows, switchable via ?variant=A|B|C|D
// and the floating bar. Delete this whole folder once #273 resolves and the
// winning shape is folded into #263. Hidden from prod by the switcher gate; the
// route itself is harmless (no data, no mutations).
'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Switcher from './Switcher'
import VariantA from './VariantA'
import VariantB from './VariantB'
import VariantC from './VariantC'
import VariantD from './VariantD'
import VariantE from './VariantE'
import VariantF from './VariantF'

function Inner() {
  const variant = (useSearchParams().get('variant') ?? 'A').toUpperCase()
  return (
    <>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      {variant === 'D' && <VariantD />}
      {variant === 'E' && <VariantE />}
      {variant === 'F' && <VariantF />}
      <Switcher />
    </>
  )
}

export default function CookPrototypePage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  )
}
