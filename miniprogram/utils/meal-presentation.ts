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

export function confirmedMealNotes(notes: string | null, photo: boolean, _label: string): string | null {
  if (!photo || (notes?.trim() && notes !== '拍照记录' && notes !== '拍照记录食物')) return notes
  return '拍照记录食物' // The image candidate's label is never the final saved title.
}

export function mealCardName(notes: string | null, photo: boolean, fallback: string): string {
  if (notes === '拍照记录' || notes === '拍照记录食物') return '拍照记录食物'
  return notes?.trim() || (photo ? '拍照记录食物' : fallback)
}


export function recordFoodName(item:{foodId?:string|null;matchStatus?:string;canonicalNameZh?:string|null;observedName?:string|null}):string {
  if(item.matchStatus==='UNMATCHED'||!item.foodId)return item.observedName?.trim()||'按名称记录食品'
  return item.canonicalNameZh?.trim() || (item.canonicalNameZh===undefined?item.observedName?.trim():'') || '已确认食品'
}
export function savedMealName(meal:{notes:string|null;displayName?:string|null;nameState?:string|null;items:Array<{foodId?:string|null;matchStatus?:string;canonicalNameZh?:string|null;observedName?:string|null}>},photo:boolean,fallback:string):string {
  const custom=meal.notes?.trim()
  if(custom&&!['拍照记录','拍照记录食物','手工记录'].includes(custom))return custom
  if(meal.displayName)return meal.displayName
  if(meal.nameState){const names=[...new Set(meal.items.map(recordFoodName))];return names.slice(0,2).join('、')+(names.length>2?'等':'')||fallback}
  return mealCardName(meal.notes,photo,fallback)
}
