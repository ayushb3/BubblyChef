/**
 * Capitalise the first letter of each whitespace-separated word.
 *
 * Rules:
 * - Each word has its first character upper-cased and the rest lower-cased.
 * - Exception: tokens that are already all-uppercase (e.g. "BBQ", "USA") are
 *   left entirely as-is so abbreviations survive the transform.
 * - Leading/trailing whitespace is trimmed; internal runs of whitespace are
 *   collapsed to a single space.
 *
 * Examples:
 *   "cheddar cheese"  → "Cheddar Cheese"
 *   "olive oil"       → "Olive Oil"
 *   "BBQ sauce"       → "BBQ Sauce"
 *   "all-purpose flour" → "All-purpose Flour"   (hyphen is not a word boundary)
 */
export function titleCase(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word
      // Preserve tokens that are already all-uppercase (abbreviations like BBQ)
      if (word === word.toUpperCase() && /[A-Z]/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * A pantry amount as a tile or row shows it: "1 head", "2 L", "4". The unit
 * "item" is filler (the form's default), so it is dropped rather than read out
 * as "4 item". Float noise from arithmetic ("1.2000000001") is trimmed.
 */
export function formatAmount(quantity: number, unit: string | null | undefined): string {
  const qty = Number.isFinite(quantity) ? String(Number(quantity.toFixed(2))) : ''
  const u = (unit ?? '').trim()
  if (!u || u.toLowerCase() === 'item' || u.toLowerCase() === 'items') return qty
  return `${qty} ${u}`
}
