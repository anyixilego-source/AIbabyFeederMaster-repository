export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'MILK_FEED' | 'OTHER'

// Apply only when creating a record; never reclassify a saved or user-edited meal.
export function defaultMealType(at: Date): MealType {
  const hour = at.getHours()
  if (!Number.isFinite(hour)) return 'OTHER'
  if (hour < 10) return 'BREAKFAST'
  if (hour < 15) return 'LUNCH'
  if (hour < 17) return 'SNACK'
  if (hour < 21) return 'DINNER'
  return 'SNACK'
}

export function recognizedMealName(result: { mode?: string; items?: unknown[]; mealName?: unknown } | null): string {
  if (result?.mode !== 'AI_CANDIDATES' || !result.items?.length || typeof result.mealName !== 'string') return ''
  const name = result.mealName.trim()
  return name && Array.from(name).length <= 30 && !/[\u0000-\u001f\u007f]/.test(name) ? name : ''
}

export function confirmedMealNotes(notes: string | null, photo: boolean, label: string): string | null {
  if (!photo || (notes?.trim() && notes !== '拍照记录' && notes !== '拍照记录食物')) return notes
  return label || '拍照记录食物'
}

export function mealCardName(notes: string | null, photo: boolean, fallback: string): string {
  if (notes === '拍照记录' || notes === '拍照记录食物') return '拍照记录食物'
  return notes?.trim() || (photo ? '拍照记录食物' : fallback)
}
