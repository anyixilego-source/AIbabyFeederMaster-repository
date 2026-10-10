import { formatNumber } from './nutrition-report'
import type { NutrientView, AssessmentReport } from './nutrition-report'
type Evidence = NonNullable<AssessmentReport['result']['evidence']>
export function foodCards(nutrient: NutrientView, evidence?: Evidence) {
  if (!evidence) return []
  const foods = new Map<string, Evidence['records']>()
  for (const record of evidence.records) foods.set(record.foodId, [...(foods.get(record.foodId) || []), record])
  const known = new Map(nutrient.sources.map(source => [source.foodId, source]))
  const knownTotal = nutrient.sources.reduce((sum, source) => sum + source.value, 0)
  return [...foods].map(([foodId, records]) => {
    const source = known.get(foodId), calculable = !!source
    const hasMissing = records.some(record => !evidence.facts.some(fact => fact.mealItemId === record.mealItemId && fact.nutrientCode === nutrient.nutrientCode && fact.contribution !== null && Number.isFinite(Number(fact.contribution)) && Number(fact.contribution) >= 0))
    const weight = (records.some(record => record.weightOrigin === 'USER_ACCEPTED_ESTIMATE') ? '约' : '') + formatNumber(records.reduce((sum, record) => sum + Number(record.consumedGrams), 0)) + ' 克'
    return { foodId, name: records[0].name, badge: records[0].name.slice(0, 1), calculable, hasMissing,
      value: source?.value ?? null, valueText: source?.valueText || '', recordWeightText: weight,
      percent: calculable && knownTotal > 0 ? source!.percent : null,
      percentText: calculable ? knownTotal > 0 ? source!.percent + '%' : '占比不适用' : '无可计算' }
  }).sort((left, right) => Number(right.calculable) - Number(left.calculable) || (right.value ?? 0) - (left.value ?? 0) || left.foodId.localeCompare(right.foodId))
}
