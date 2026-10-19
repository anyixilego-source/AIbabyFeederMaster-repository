/** UI text only. Never feed rounded values back into calculations, comparisons or history. */
export function displayInteger(value: string | number | null | undefined): string {
  if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return '—'
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n > 0 && n < 1) return '<1'
  // Avoid Intl/toLocaleString options, which some mini-program runtimes ignore.
  return String(Math.round(n))
}
/** Numeric input text is separate from the original value retained by an edit draft. */
export function integerInput(value: string | number): string {
  if (typeof value === 'string' && !value.trim()) return ''
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n)) : ''
}
