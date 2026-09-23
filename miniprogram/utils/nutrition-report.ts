import { request } from './api'
import { completeOperation, operationPayload } from './operation'
import type { SubjectSummary } from './session'

export interface AssessmentNutrient {
  nutrientCode: string
  status: string
  averageDailyValue: string | null
  unitCode: string
  coverageRatio: string
  recommendedValue: string | null
  upperLimitValue: string | null
  warnings: string[]
}

export interface AssessmentReport {
  reportId: string
  periodStart: string
  coverageRatio: string
  warnings: string[]
  generatedAt: string
  result: { assessment: { status: string; nutrients: AssessmentNutrient[]; boundaryStatement: string } }
}

interface MealSummary {
  mealId: string
  mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'OTHER'
  occurredAt: string
  status: 'DRAFT' | 'CONFIRMED'
  notes: string | null
}

interface MealItem {
  mealItemId: string
  foodId: string | null
  observedName: string | null
  servedAmount: string | null
  consumedAmount: string | null
  unit: string
  status: string
}

interface MealDetail extends MealSummary { items: MealItem[] }

interface FoodSnapshot {
  foodId: string
  canonicalNameZh: string
  nutrients: Array<{ nutrientCode: string; valuePer100g: string | null; status: string; unitCode: string }>
}

export interface NutrientSource {
  foodId: string
  name: string
  badge: string
  value: number
  valueText: string
  percent: number
}

export interface NutrientView {
  nutrientCode: string
  name: string
  badge: string
  iconPath: string
  progressPercent: number
  progressLabel: string
  progressTone: string
  category: 'MACRO' | 'MINERAL' | 'VITAMIN' | 'OTHER'
  amountText: string
  numericValue: number | null
  unitText: string
  status: string
  statusText: string
  statusTone: string
  dataNote: string
  recommendedValue: string | null
  upperLimitValue: string | null
  sources: NutrientSource[]
  sourceText: string
}

export interface FoodRecord {
  key: string
  foodId: string | null
  name: string
  amount: number
  amountText: string
  badge: string
  tone: string
}

export interface ReportBundle {
  subject: SubjectSummary
  report: AssessmentReport
  reports: AssessmentReport[]
  date: string
  dateLabel: string
  ageText: string
  mealCount: number
  foodCount: number
  totalConsumedText: string
  nutrients: NutrientView[]
  warnings: string[]
  foodRecords: FoodRecord[]
}

export const nutrientNames: Record<string, string> = {
  ENERGY: '能量', ENERGY_KCAL: '能量', PROTEIN: '蛋白质', FAT_TOTAL: '脂肪', CARBOHYDRATE: '碳水化合物',
  CALCIUM: '钙', IRON: '铁', SODIUM: '钠', VITAMIN_A_RAE: '维生素A', VITAMIN_C: '维生素C',
  FIBER_DIETARY: '膳食纤维', ZINC: '锌',
}

export const unitNames: Record<string, string> = {
  KILOCALORIE: '千卡', KCAL: '千卡', GRAM: '克', MILLIGRAM: '毫克', MICROGRAM: '微克', MICROGRAM_RAE: '微克 RAE',
}

const statusLabels: Record<string, string> = {
  AT_OR_ABOVE_REFERENCE: '已记录量达到参考值', BELOW_REFERENCE: '已记录量低于参考值',
  ABOVE_UPPER_LIMIT: '已记录量超过上限参考', WITHIN_UPPER_LIMIT: '已记录量未超过上限',
  NO_INTAKE_DATA: '暂无可计算的摄入数据', INSUFFICIENT_COVERAGE: '数据不足，暂不比较',
  NO_REFERENCE_VALUE: '当前规则无适用参考值', UNIT_MISMATCH: '单位不同，暂不比较',
}

const warningLabels: Record<string, string> = {
  NO_CONFIRMED_INTAKE: '今天没有已确认的实际摄入记录。',
  NO_NUTRIENT_DATA: '今天暂无可用于计算的营养数据。',
  NO_INTAKE_DATA: '没有已确认的摄入数据，无法进行参考值比较。',
  INSUFFICIENT_COVERAGE_NO_COMPARISON: '部分营养数据不完整，当前数值仅代表已知部分。',
  NO_REFERENCE_VALUE: '当前规则没有提供适用参考值。',
  UNIT_MISMATCH_NO_COMPARISON: '摄入数据与参考规则单位不同，暂不比较。',
  BELOW_REFERENCE_NOT_DIAGNOSIS: '已记录量低于参考值，仅供记录参考，不代表营养诊断。',
  REFERENCE_UPPER_LIMIT_EXCEEDED: '已记录量超过上限参考值，请结合完整饮食记录理解。',
  INCOMPLETE: '部分食物缺少该营养素数据，当前数值仅代表已知部分。',
  INCONSISTENT_OR_MISSING_UNIT: '数据单位缺失或不一致，暂不进行参考值比较。',
}

const categoryOrder: Record<NutrientView['category'], number> = { MACRO: 0, MINERAL: 1, VITAMIN: 2, OTHER: 3 }
const nutrientOrder = ['ENERGY', 'ENERGY_KCAL', 'PROTEIN', 'FAT_TOTAL', 'CARBOHYDRATE', 'FIBER_DIETARY', 'CALCIUM', 'IRON', 'ZINC', 'SODIUM', 'VITAMIN_A_RAE', 'VITAMIN_C']
const tones = ['blue', 'green', 'orange', 'purple', 'cyan', 'yellow']

let bundleCacheKey = ''
let bundleCache: Promise<ReportBundle> | null = null

export function dateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function tomorrow(date: Date): string {
  const next = new Date(date)
  next.setDate(next.getDate() + 1)
  return dateOnly(next)
}

export function ageMonths(birthDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00`)
  const today = new Date()
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth()
  if (today.getDate() < birth.getDate()) months -= 1
  return Math.max(0, months)
}

export function formatNumber(value: string | number): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return String(value)
  return parsed.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function warningLabel(warning: string): string {
  const [prefix, code] = warning.split(':')
  if (code && nutrientNames[prefix]) return `${nutrientNames[prefix]}：${warningLabels[code] || '存在尚未归类的数据说明。'}`
  if (prefix === 'RULES_UNAVAILABLE') return '当前月龄或条件没有匹配的参考规则。'
  if (prefix === 'AMBIGUOUS_RULE') return `${nutrientNames[code] || '部分营养素'}存在多条适用规则，暂不比较。`
  return warningLabels[warning] || '存在尚未归类的数据说明。'
}

export function loadReportBundle(subjectId: string, force = false): Promise<ReportBundle> {
  const key = `${subjectId}:${dateOnly(new Date())}`
  if (!force && bundleCache && bundleCacheKey === key) return bundleCache
  bundleCacheKey = key
  bundleCache = createReportBundle(subjectId, force).catch((error: unknown) => {
    bundleCache = null
    throw error
  })
  return bundleCache
}

async function createReportBundle(subjectId: string, force: boolean): Promise<ReportBundle> {
  const now = new Date()
  const today = dateOnly(now)
  const [subject, mealSummaries, existingReports] = await Promise.all([
    request<SubjectSummary>(`/subjects/${subjectId}`),
    request<MealSummary[]>(`/subjects/${subjectId}/meals`),
    request<AssessmentReport[]>(`/subjects/${subjectId}/assessment-reports`),
  ])
  let report = force ? undefined : latestReport(existingReports, today)
  if (!report) {
    const scope = `assessment:${subjectId}:${today}`
    const payload = operationPayload(scope, {
      periodStart: today, periodEndExclusive: tomorrow(now), timezoneOffsetMinutes: -now.getTimezoneOffset(),
    })
    report = await request<AssessmentReport>(`/subjects/${subjectId}/assessment-reports`, { method: 'POST', data: payload })
    completeOperation(scope, payload.operationId)
  }
  const todaySummaries = mealSummaries.filter((meal) => meal.status === 'CONFIRMED' && dateOnly(new Date(meal.occurredAt)) === today)
  const mealDetails = await Promise.all(todaySummaries.map((meal) => request<MealDetail>(`/meals/${meal.mealId}`)))
  const items = mealDetails.flatMap((meal) => meal.items.filter((item) => item.status === 'CONFIRMED' && Number(item.consumedAmount || 0) > 0))
  const foodIds = [...new Set(items.map((item) => item.foodId).filter((foodId): foodId is string => Boolean(foodId)))]
  const snapshots = await Promise.all(foodIds.map((foodId) => request<FoodSnapshot>(`/foods/${foodId}/nutrients`).catch(() => null)))
  const snapshotMap = new Map(snapshots.filter((snapshot): snapshot is FoodSnapshot => snapshot !== null).map((snapshot) => [snapshot.foodId, snapshot]))
  const sources = buildSources(items, snapshotMap)
  const nutrients = report.result.assessment.nutrients.map((item) => nutrientView(item, sources.get(item.nutrientCode) || []))
    .sort((left, right) => categoryOrder[left.category] - categoryOrder[right.category]
      || nutrientRank(left.nutrientCode) - nutrientRank(right.nutrientCode))
  const reports = [report, ...existingReports.filter((item) => item.reportId !== report!.reportId)]
  const foodRecords = buildFoodRecords(items, snapshotMap)
  const totalConsumed = items.reduce((sum, item) => sum + Number(item.consumedAmount || 0), 0)
  const warnings = [...new Set(report.warnings.map(warningLabel))]
  return {
    subject, report, reports, date: today,
    dateLabel: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 周${'日一二三四五六'[now.getDay()]}`,
    ageText: `${ageMonths(subject.birthDate)}个月`, mealCount: todaySummaries.length,
    foodCount: foodRecords.length, totalConsumedText: formatNumber(totalConsumed), nutrients, warnings, foodRecords,
  }
}

function latestReport(reports: AssessmentReport[], date: string): AssessmentReport | undefined {
  return reports.filter((report) => report.periodStart === date)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0]
}

function nutrientView(item: AssessmentNutrient, sources: NutrientSource[]): NutrientView {
  const name = nutrientNames[item.nutrientCode] || '其他营养素'
  const coverage = Number(item.coverageRatio)
  const numericValue = item.averageDailyValue === null ? null : Number(item.averageDailyValue)
  const referenceRaw = item.recommendedValue ?? item.upperLimitValue
  const reference = referenceRaw === null ? null : Number(referenceRaw)
  const hasComparableReference = numericValue !== null && Number.isFinite(numericValue)
    && reference !== null && Number.isFinite(reference) && reference > 0
  const progressRatio = hasComparableReference ? numericValue / reference * 100 : null
  return {
    nutrientCode: item.nutrientCode, name, badge: name.slice(0, 1), iconPath: nutrientIcon(item.nutrientCode), category: nutrientCategory(item.nutrientCode),
    progressPercent: progressRatio === null ? 0 : Math.max(0, Math.min(100, progressRatio)),
    progressLabel: progressRatio === null ? '' : `${item.recommendedValue !== null ? '约占参考值' : '约占上限参考'} ${Math.round(progressRatio)}%`,
    progressTone: nutrientProgressTone(item.nutrientCode),
    amountText: item.averageDailyValue === null ? '暂无数值' : formatNumber(item.averageDailyValue),
    numericValue,
    unitText: unitNames[item.unitCode] || '单位待核对', status: item.status,
    statusText: statusLabels[item.status] || '暂无法比较', statusTone: statusTone(item.status),
    dataNote: coverage < 1 ? `部分食物缺少${name}数据` : '',
    recommendedValue: item.recommendedValue, upperLimitValue: item.upperLimitValue, sources,
    sourceText: sources.length > 0 ? sources.slice(0, 3).map((source) => source.name).join('、') : '暂无可计算来源',
  }
}

function nutrientProgressTone(code: string): string {
  if (code === 'ENERGY' || code === 'ENERGY_KCAL') return 'blue'
  if (code === 'PROTEIN') return 'green'
  if (code === 'FAT_TOTAL') return 'yellow'
  if (code === 'CARBOHYDRATE') return 'purple'
  return 'cyan'
}

function nutrientIcon(code: string): string {
  if (code === 'ENERGY' || code === 'ENERGY_KCAL') return '/assets/report-icon-energy-v1.png'
  if (code === 'PROTEIN') return '/assets/report-icon-protein-v1.png'
  if (code === 'FAT_TOTAL') return '/assets/report-icon-fat-v1.png'
  if (code === 'CARBOHYDRATE') return '/assets/report-icon-carbohydrate-v1.png'
  if (code === 'CALCIUM') return '/assets/report-icon-calcium-v1.png'
  if (code === 'IRON') return '/assets/report-icon-iron-v1.png'
  if (code === 'ZINC' || code === 'SODIUM') return '/assets/report-icon-mineral-v1.png'
  if (code === 'VITAMIN_A_RAE' || code === 'VITAMIN_C') return '/assets/report-icon-vitamin-v1.png'
  if (code === 'FIBER_DIETARY') return '/assets/report-icon-fiber-v1.png'
  return '/assets/report-icon-mineral-v1.png'
}

function nutrientCategory(code: string): NutrientView['category'] {
  if (['ENERGY', 'ENERGY_KCAL', 'PROTEIN', 'FAT_TOTAL', 'CARBOHYDRATE', 'FIBER_DIETARY'].includes(code)) return 'MACRO'
  if (['CALCIUM', 'IRON', 'ZINC', 'SODIUM'].includes(code)) return 'MINERAL'
  if (code.startsWith('VITAMIN_')) return 'VITAMIN'
  return 'OTHER'
}

function nutrientRank(code: string): number {
  const index = nutrientOrder.indexOf(code)
  return index < 0 ? nutrientOrder.length : index
}

function statusTone(status: string): string {
  if (status === 'AT_OR_ABOVE_REFERENCE' || status === 'WITHIN_UPPER_LIMIT') return 'good'
  if (status === 'ABOVE_UPPER_LIMIT') return 'danger'
  if (status === 'BELOW_REFERENCE') return 'warn'
  return 'neutral'
}

function buildSources(items: MealItem[], snapshots: Map<string, FoodSnapshot>): Map<string, NutrientSource[]> {
  const grouped = new Map<string, Map<string, { foodId: string; name: string; value: number }>>()
  for (const item of items) {
    if (!item.foodId) continue
    const snapshot = snapshots.get(item.foodId)
    if (!snapshot) continue
    const grams = Number(item.consumedAmount || 0)
    for (const nutrient of snapshot.nutrients) {
      if (nutrient.valuePer100g === null || !['MEASURED', 'ESTIMATED_ZERO', 'PARTIAL'].includes(nutrient.status)) continue
      const value = Number(nutrient.valuePer100g) * grams / 100
      if (!Number.isFinite(value) || value <= 0) continue
      const foods = grouped.get(nutrient.nutrientCode) || new Map<string, { foodId: string; name: string; value: number }>()
      const current = foods.get(item.foodId)
      foods.set(item.foodId, {
        foodId: item.foodId, name: item.observedName || snapshot.canonicalNameZh,
        value: (current?.value || 0) + value,
      })
      grouped.set(nutrient.nutrientCode, foods)
    }
  }
  return new Map([...grouped.entries()].map(([code, foods]) => {
    const rows = [...foods.values()].sort((left, right) => right.value - left.value)
    const total = rows.reduce((sum, row) => sum + row.value, 0)
    return [code, rows.map((row) => ({
      ...row, badge: row.name.slice(0, 1), valueText: formatNumber(row.value), percent: total > 0 ? Math.round(row.value / total * 100) : 0,
    }))]
  }))
}

function buildFoodRecords(items: MealItem[], snapshots: Map<string, FoodSnapshot>): FoodRecord[] {
  const grouped = new Map<string, { foodId: string | null; name: string; amount: number }>()
  for (const item of items) {
    const name = item.observedName || (item.foodId ? snapshots.get(item.foodId)?.canonicalNameZh : null) || '已确认食物'
    const key = item.foodId || name
    const current = grouped.get(key)
    grouped.set(key, { foodId: item.foodId, name, amount: (current?.amount || 0) + Number(item.consumedAmount || 0) })
  }
  return [...grouped.entries()].map(([key, item], index) => ({
    key, foodId: item.foodId, name: item.name, amount: item.amount,
    amountText: `${formatNumber(item.amount)} 克`, badge: item.name.slice(0, 1), tone: tones[index % tones.length]!,
  }))
}

export function latestReportByDate(reports: AssessmentReport[]): Map<string, AssessmentReport> {
  const result = new Map<string, AssessmentReport>()
  for (const report of [...reports].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))) {
    if (!result.has(report.periodStart)) result.set(report.periodStart, report)
  }
  return result
}
