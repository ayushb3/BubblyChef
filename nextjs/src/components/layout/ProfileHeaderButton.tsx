import Link from 'next/link'
import { UserCircle } from '@phosphor-icons/react/dist/ssr'

export default function ProfileHeaderButton() {
  return (
    <Link
      href="/profile"
      aria-label="Profile"
      className="w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
    >
      <UserCircle size={24} className="text-[var(--color-primary)]" />
    </Link>
  )
}
