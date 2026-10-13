import { ApiError, request, getAuth } from './api'
import { ageDisplay, ageDisplayFromMonths } from './age'
import { completeOperation, operationPayload } from './operation'
import type { SubjectSummary } from './session'

export interface AssessmentNutrient {
  nutrientCode: string
  status: string
  referenceType?: string | null
  averageDailyValue: string | null
  unitCode: string
  coverageRatio: string
  recommendedValue: string | null
  upperLimitValue: string | null
  rangeLowerValue?: string | null
  rangeUpperValue?: string | null
  warnings: string[]
  outputEligibility?: string
  numericRelation?: string
  statement?: string
  reasonCodes?: string[]
  indicators?: Array<{ rule: { source: string; sourceVersion: string; code: string; reviewedBy: string; referenceType: string }; ambiguous: boolean }>
}

export interface AssessmentReport {
  reportId: string
  subjectId?: string
  periodStart: string
  coverageRatio: string
  warnings: string[]
  generatedAt: string
  inputFingerprint?: string | null
  supersedesReportId?: string | null
  result: {
    assessment: { status: string; nutrients: AssessmentNutrient[]; boundaryStatement: string; assessmentAlgorithmVersion?: string }
    evidence?: { ageMonths: number; date: string; subject: { birthDate: string }; records: ReportRecord[]; facts: ReportFact[] }
    observations?: Array<{ id: string; nutrientCode: string; text: string }>
    limitations?: Array<{ nutrientCode: string; text: string; reasonCodes: string[] }>
    actions?: Array<{ id: string; text: string }>
    knowledge?: { version: string; scopeDeclaration: string; claims: Array<{ id: string; title: string; text: string; evidence: Array<{ id: string; source: string; bookPages: string }> }> }
  }
}

interface ReportRecord { mealId: string; mealItemId: string; foodId: string | null; name: string; consumedGrams: string; weightOrigin: string }
interface ReportFact { mealItemId: string; foodId: string; nutrientCode: string; contribution: string | null; nutrientFactId?: string; sourceReleaseId?: string; sourceVersion: string }

export interface NutrientSource {
  foodId: string
  name: string
  badge: string
  value: number
  valueText: string
  percent: number
  recordWeightText: string
  sourceVersionText: string
  evidenceIds: string[]
}

export interface NutrientView {
  nutrientCode: string
  name: string
  badge: string
  iconPath: string
  progressPercent: number
  progressLabel: string
  progressTone: string
  showProgress: boolean
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
  rangeLowerValue: string | null
  rangeUpperValue: string | null
  referenceType: string | null
  sources: NutrientSource[]
  sourceText: string
  outputEligibility: string
  numericRelation: string
  reasonCodes: string[]
  referenceSource: string
  referenceLabel: string
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
  weightLabel: string
  snapshotAvailable: boolean
  updateState: 'CURRENT' | 'FAILED' | 'LEGACY'
}

export const nutrientNames: Record<string, string> = {
  ENERGY: '能量', ENERGY_KCAL: '能量', PROTEIN: '蛋白质', FAT_TOTAL: '脂肪', CARBOHYDRATE: '碳水化合物',
  CALCIUM: '钙', IRON: '铁', SODIUM: '钠', VITAMIN_A_RAE: '维生素A', VITAMIN_C: '维生素C',
  FIBER_DIETARY: '膳食纤维', ZINC: '锌', FOLATE: '叶酸', IODINE: '碘',
}

export const unitNames: Record<string, string> = {
  KILOCALORIE: '千卡', KCAL: '千卡', GRAM: '克', MILLIGRAM: '毫克', MICROGRAM: '微克', MICROGRAM_RAE: '微克 RAE',
}

const statusLabels: Record<string, string> = {
  AT_OR_ABOVE_REFERENCE: '已记录量达到参考值', BELOW_REFERENCE: '已记录量低于参考值',
  ABOVE_UPPER_LIMIT: '已记录量超过上限参考', WITHIN_UPPER_LIMIT: '已记录量未超过上限',
  NO_INTAKE_DATA: '暂无可计算的摄入数据', INSUFFICIENT_COVERAGE: '数据不足，暂不比较',
  NO_REFERENCE_VALUE: '当前规则无适用参考值', UNIT_MISMATCH: '单位不同，暂不比较',
  REFERENCE_INFORMATION_ONLY: '一般参考信息，仅供了解',
  REFERENCE_COMPARISON_SUSPENDED: '参考对照待核对，仅展示已记录量',
}

const warningLabels: Record<string, string> = {
  NO_CONFIRMED_INTAKE: '本报告没有已确认的餐食记录；奶量如有记录会另行展示。',
  NO_NUTRIENT_DATA: '今天暂无可用于计算的营养数据。',
  NO_INTAKE_DATA: '没有已确认的摄入数据，无法进行参考值比较。',
  INSUFFICIENT_COVERAGE_NO_COMPARISON: '部分营养数据不完整，当前数值仅代表已知部分。',
  NO_REFERENCE_VALUE: '当前规则没有提供适用参考值。',
  UNIT_MISMATCH_NO_COMPARISON: '摄入数据与参考规则单位不同，暂不比较。',
  BELOW_REFERENCE_NOT_DIAGNOSIS: '已记录量低于参考值，仅供记录参考，不代表营养诊断。',
  REFERENCE_UPPER_LIMIT_EXCEEDED: '已记录量超过上限参考值，请结合完整饮食记录理解。',
  INCOMPLETE: '部分食物缺少该营养素数据，当前数值仅代表已知部分。',
  INCONSISTENT_OR_MISSING_UNIT: '数据单位缺失或不一致，暂不进行参考值比较。',
  REFERENCE_COMPARISON_SUSPENDED_PENDING_SOURCE_AUDIT: '数据口径或覆盖仍待核对，暂不作参考值比较。',
}

const suspendedReferenceCodes = new Set(['CARBOHYDRATE', 'VITAMIN_A_RAE', 'FOLATE', 'IODINE'])
const suspendedWarning = 'REFERENCE_COMPARISON_SUSPENDED_PENDING_SOURCE_AUDIT'

// The public API and historical snapshots may still use the older comparison
// policy. Normalize at the report boundary without changing stored history.
export function suspendReportComparison(report: AssessmentReport): AssessmentReport {
  const nutrients = report.result.assessment.nutrients.map((item) => {
    if (!suspendedReferenceCodes.has(item.nutrientCode)) return item
    const noIntake = item.averageDailyValue === null
    const incomplete = !noIntake && Number(item.coverageRatio) < 1
    return {
      ...item,
      status: noIntake ? 'NO_INTAKE_DATA' : incomplete ? 'INSUFFICIENT_COVERAGE' : 'REFERENCE_COMPARISON_SUSPENDED',
      referenceType: null, recommendedValue: null, upperLimitValue: null,
      rangeLowerValue: null, rangeUpperValue: null,
      warnings: noIntake ? ['NO_INTAKE_DATA'] : incomplete
        ? ['INSUFFICIENT_COVERAGE_NO_COMPARISON', suspendedWarning] : [suspendedWarning],
    }
  })
  const warnings = report.warnings.filter((warning) => {
    const [code, reason] = warning.split(':')
    return !suspendedReferenceCodes.has(code)
      || !['BELOW_REFERENCE_NOT_DIAGNOSIS', 'REFERENCE_UPPER_LIMIT_EXCEEDED', 'NO_REFERENCE_VALUE',
        'UNIT_MISMATCH_NO_COMPARISON'].includes(reason)
  })
  for (const nutrient of nutrients) {
    if (nutrient.warnings.includes(suspendedWarning)) warnings.push(`${nutrient.nutrientCode}:${suspendedWarning}`)
  }
  return {
    ...report,
    warnings: [...new Set(warnings)],
    result: { ...report.result, assessment: { ...report.result.assessment, nutrients } },
  }
}

const categoryOrder: Record<NutrientView['category'], number> = { MACRO: 0, MINERAL: 1, VITAMIN: 2, OTHER: 3 }
const nutrientOrder = ['ENERGY', 'ENERGY_KCAL', 'PROTEIN', 'FAT_TOTAL', 'CARBOHYDRATE', 'FIBER_DIETARY', 'CALCIUM', 'IRON', 'ZINC', 'SODIUM', 'VITAMIN_A_RAE', 'VITAMIN_C']
const tones = ['blue', 'green', 'orange', 'purple', 'cyan', 'yellow']

let bundleCacheKey = ''
let bundleSequence = 0
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

export function formatNumber(value: string | number): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return String(value)
  return parsed.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function warningLabel(warning: string): string {
  const [prefix, code] = warning.split(':')
  if (code && nutrientNames[prefix]) return `${nutrientNames[prefix]}：${warningLabels[code] || '本项有数据或规则限制，详情见报告。'}`
  if (prefix === 'RULES_UNAVAILABLE') return '当前月龄或条件没有匹配的参考规则。'
  if (prefix === 'AMBIGUOUS_RULE') return `${nutrientNames[code] || '部分营养素'}存在多条适用规则，暂不比较。`
  return warningLabels[warning] || '本项有数据或规则限制，详情见报告。'
}

export function loadReportBundle(subjectId: string, force = false, reportId = '', selectedDate = ''): Promise<ReportBundle> {
  const key = subjectId + ':' + (reportId || selectedDate || dateOnly(new Date())) + ':' + (getAuth()?.accessToken || '') + ':' + Number(wx.getStorageSync('foodmaster.recordEpoch') || 0)
  if (!force && bundleCache && bundleCacheKey === key) {
    if (reportId) return bundleCache
    const cached = bundleCache
    return cached.then(async bundle => {
      try {
        const day = new Date(bundle.date + 'T12:00:00')
        const current = await request<{reportId:string|null;isCurrent:boolean;effectiveInputVersion:string}>('/subjects/'+subjectId+'/assessment-reports/current?date='+bundle.date+'&timezoneOffsetMinutes='+(-day.getTimezoneOffset()))
        if (current.isCurrent && current.reportId === bundle.report.reportId && current.effectiveInputVersion === bundle.report.inputFingerprint) return bundle
      } catch (error) {
        if (error instanceof ApiError && [401,403].includes(error.statusCode)) throw error
        return {...bundle,updateState:'FAILED' as const}
      }
      return loadReportBundle(subjectId,true,reportId,selectedDate)
    })
  }
  bundleCacheKey = key
  const sequence = ++bundleSequence
  const promise = createReportBundle(subjectId, reportId, sequence, selectedDate).catch((error: unknown) => {
    if (bundleCache === promise) bundleCache = null
    throw error
  })
  bundleCache = promise
  return promise
}

async function createReportBundle(subjectId: string, reportId: string, sequence: number, selectedDate = ''): Promise<ReportBundle> {
  const now = selectedDate ? new Date(selectedDate + 'T12:00:00') : new Date()
  const subject = await request<SubjectSummary>('/subjects/' + subjectId)
  let report: AssessmentReport
  let updateState: 'CURRENT' | 'FAILED' | 'LEGACY' = 'CURRENT'
  if (reportId) report = await request<AssessmentReport>('/assessment-reports/' + reportId)
  else {
    type Current={subjectId:string;reportId:string|null;isCurrent:boolean;effectiveInputVersion:string;basedOnInputVersion:string|null}
    const currentPath='/subjects/'+subjectId+'/assessment-reports/current?date='+dateOnly(now)+'&timezoneOffsetMinutes='+(-now.getTimezoneOffset())
    const current=await request<Current>(currentPath)
    if(current.subjectId!==subjectId)throw Error('报告所属宝宝不一致')
    if(current.isCurrent&&current.reportId){report=await request<AssessmentReport>('/assessment-reports/'+current.reportId)}else {
    const scope = 'assessment:' + subjectId + ':' + dateOnly(now) + ':' + sequence
    const payload = operationPayload(scope, {periodStart:dateOnly(now),periodEndExclusive:tomorrow(now),timezoneOffsetMinutes:-now.getTimezoneOffset()})
    // Two attempts share the operation id. The server independently reuses effective inputs.
    try {
      try { report = await request<AssessmentReport>('/subjects/' + subjectId + '/assessment-reports', {method:'POST',data:payload}) }
      catch (error) {
        if (error instanceof ApiError && error.statusCode > 0 && error.statusCode < 500) throw error
        report = await request<AssessmentReport>('/subjects/' + subjectId + '/assessment-reports', {method:'POST',data:payload})
      }
      completeOperation(scope,payload.operationId)
    } catch (error) {
      if (error instanceof ApiError && [401,403].includes(error.statusCode)) throw error
      const previous = await request<AssessmentReport[]>('/subjects/' + subjectId + '/assessment-reports')
      const fallback = previous.filter(r=>r.periodStart===dateOnly(now)).sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt))[0]
      if (!fallback) throw error
      report = fallback; updateState='FAILED'
    }
    }
    if(updateState==='CURRENT'){const checked=await request<Current>(currentPath);if(!checked.isCurrent||checked.reportId!==report.reportId||checked.effectiveInputVersion!==report.inputFingerprint)updateState='FAILED'}
  }
  if(report.subjectId && report.subjectId !== subjectId)throw new Error('请先切换到该报告所属宝宝')
  report = suspendReportComparison(report)
  const records = report.result.evidence?.records || []
  const facts = report.result.evidence?.facts || []
  const sources = buildSources(records,facts)
  const nutrients = report.result.assessment.nutrients.map(item=>{const view=nutrientView(item,sources.get(item.nutrientCode)||[]);return report.result.evidence?view:{...view,sourceText:'旧报告未保存来源明细，不能从当前食品重建'}})
    .sort((left,right)=>categoryOrder[left.category]-categoryOrder[right.category] || nutrientRank(left.nutrientCode)-nutrientRank(right.nutrientCode))
  const date = new Date(report.periodStart + 'T12:00:00')
  const snapshotAvailable = Boolean(report.result.evidence)
  if (!snapshotAvailable && updateState === 'CURRENT') updateState = 'LEGACY'
  return { subject,report,reports:[report],date:report.periodStart,
    dateLabel:report.periodStart + ' 周' + '日一二三四五六'[date.getDay()],
    ageText:report.result.evidence ? ageDisplayFromMonths(report.result.evidence.ageMonths) : ageDisplay(subject.birthDate,date),
    mealCount:new Set(records.map(r=>r.mealId)).size,foodCount:new Set(records.map(r=>r.foodId||r.mealItemId)).size,
    totalConsumedText:(records.some(r=>r.weightOrigin==='USER_ACCEPTED_ESTIMATE')?'约':'')+formatNumber(records.reduce((sum,r)=>sum+Number(r.consumedGrams),0)),nutrients,
    warnings:[...new Set(report.warnings.map(warningLabel))],foodRecords:buildFoodRecords(records),snapshotAvailable,updateState,
    weightLabel:records.some(r=>r.weightOrigin==='USER_ACCEPTED_ESTIMATE') ? '记录重量（含估算）' : '记录重量' }
}

export function nutrientView(item: AssessmentNutrient, sources: NutrientSource[]): NutrientView {
  const name = nutrientNames[item.nutrientCode] || '其他营养素'
  const coverage = Number(item.coverageRatio)
  const numericValue = item.averageDailyValue === null ? null : Number(item.averageDailyValue)
  const suspended = suspendedReferenceCodes.has(item.nutrientCode)
  const informational = suspended || item.outputEligibility !== 'FULL_COMPARISON'
  const rangeLowerValue = item.rangeLowerValue ?? null
  const rangeUpperValue = item.rangeUpperValue ?? null
  const referenceRaw = item.recommendedValue ?? item.upperLimitValue
  const reference = referenceRaw === null ? null : Number(referenceRaw)
  const hasComparableReference = numericValue !== null && Number.isFinite(numericValue)
    && reference !== null && Number.isFinite(reference) && reference > 0
  const progressRatio = !informational && hasComparableReference ? numericValue / reference * 100 : null
  const progressLabel = rangeLowerValue !== null && rangeUpperValue !== null
    ? `一般参考区间 ${formatNumber(rangeLowerValue)}–${formatNumber(rangeUpperValue)} ${unitNames[item.unitCode] || ''}/日（非达标判断）`
    : item.referenceType === 'EER' && reference !== null
      ? `一般能量估计值约 ${formatNumber(reference)} ${unitNames[item.unitCode] || ''}/日`
    : progressRatio !== null
    ? `已记录量／一般参考值 ${Math.round(progressRatio)}%`
    : reference !== null && Number.isFinite(reference) && reference > 0
      ? `参考信息 ${formatNumber(reference)} ${unitNames[item.unitCode] || ''}/日（仅供了解）`
      : suspended ? '数据口径待核对，暂不展示参考进度' : '当前月龄暂无适用参考值'
  return {
    nutrientCode: item.nutrientCode, name, badge: name.slice(0, 1), iconPath: nutrientIcon(item.nutrientCode), category: nutrientCategory(item.nutrientCode),
    progressPercent: progressRatio === null ? 0 : Math.max(0, Math.min(100, progressRatio)),
    progressLabel,
    progressTone: nutrientProgressTone(item.nutrientCode),
    showProgress: !informational && progressRatio !== null,
    amountText: item.averageDailyValue === null ? '暂无数值' : formatNumber(item.averageDailyValue),
    numericValue,
    unitText: unitNames[item.unitCode] || '单位待核对', status: item.status,
    statusText: item.outputEligibility ? (item.statement || statusLabels[item.status] || '暂无法比较') : '历史策略，仅展示原记录值与参考信息', statusTone: item.outputEligibility === 'FULL_COMPARISON' ? statusTone(item.status) : 'neutral',
    dataNote: item.reasonCodes?.some(r=>['UNIT_BASIS_OR_SOURCE_UNVERIFIED','REFERENCE_UNIT_MISMATCH','UNIT_CONFLICT','SOURCE_CONFLICT','SOURCE_VERSION_MISSING','SOURCE_LINEAGE_MISSING','BASIS_UNSUPPORTED','DUPLICATE_NUTRIENT_FACTS'].includes(r)) ? '单位、基准或来源尚不可核对，暂不比较' : item.averageDailyValue === null ? '已记录食品暂无本项可计算值' : coverage < 1 ? `部分食物缺少${name}数据` : item.reasonCodes?.includes('PARTIAL_NUTRIENT_DATA') ? `部分${name}数值仍不完整` : '',
    recommendedValue: item.recommendedValue, upperLimitValue: item.upperLimitValue,
    rangeLowerValue, rangeUpperValue, referenceType: item.referenceType ?? null, sources,
    outputEligibility:item.outputEligibility || 'LEGACY_UNVERIFIED',numericRelation:item.numericRelation || 'NOT_CALCULABLE',
    reasonCodes:item.reasonCodes || item.warnings,
    referenceSource:(item.indicators || []).filter(i=>!i.ambiguous).map(i=>i.rule.source + ' · ' + i.rule.sourceVersion).join('；'),
    referenceLabel:item.referenceType || '',
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

export function nutrientIcon(code: string): string {
  if (code === 'ENERGY' || code === 'ENERGY_KCAL') return '/assets/report-icon-energy-v1.png'
  if (code === 'PROTEIN') return '/assets/report-icon-protein-v1.png'
  if (code === 'FAT_TOTAL') return '/assets/report-icon-fat-v1.png'
  if (code === 'CARBOHYDRATE') return '/assets/report-icon-carbohydrate-v1.png'
  if (code === 'CALCIUM') return '/assets/report-icon-calcium-v1.png'
  if (code === 'IRON') return '/assets/report-icon-iron-v1.png'
  if (code === 'SODIUM') return '/assets/report-icon-sodium-v1.png'
  if (code === 'ZINC') return '/assets/report-icon-zinc-v1.png'
  if (code === 'VITAMIN_A_RAE' || code === 'VITAMIN_C') return '/assets/report-icon-vitamin-v1.png'
  if (code === 'FIBER_DIETARY') return '/assets/report-icon-fiber-v1.png'
  return '/assets/report-icon-mineral-v1.png'
}

function nutrientCategory(code: string): NutrientView['category'] {
  if (['ENERGY', 'ENERGY_KCAL', 'PROTEIN', 'FAT_TOTAL', 'CARBOHYDRATE', 'FIBER_DIETARY'].includes(code)) return 'MACRO'
  if (['CALCIUM', 'IRON', 'ZINC', 'SODIUM', 'IODINE'].includes(code)) return 'MINERAL'
  if (code.startsWith('VITAMIN_') || code === 'FOLATE') return 'VITAMIN'
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

function buildSources(records: ReportRecord[], facts: ReportFact[]): Map<string,NutrientSource[]> {
  const grouped = new Map<string,Map<string,{foodId:string;name:string;value:number}>>()
  for (const fact of facts) {
    if (fact.contribution === null) continue
    const value=Number(fact.contribution)
    if (!Number.isFinite(value) || value < 0) continue
    const name=records.find(r=>r.mealItemId===fact.mealItemId)?.name || '已确认食物'
    const foods=grouped.get(fact.nutrientCode) || new Map<string,{foodId:string;name:string;value:number}>()
    const previous=foods.get(fact.foodId)
    foods.set(fact.foodId,{foodId:fact.foodId,name,value:(previous?.value || 0)+value})
    grouped.set(fact.nutrientCode,foods)
  }
  return new Map([...grouped].map(([code,foods])=>{
    const rows=[...foods.values()].sort((a,b)=>b.value-a.value || a.foodId.localeCompare(b.foodId))
    const total=rows.reduce((sum,r)=>sum+r.value,0)
    return [code,rows.map(row=>{
      const usedRecords=records.filter(r=>r.foodId===row.foodId)
      const usedFacts=facts.filter(f=>f.foodId===row.foodId && f.nutrientCode===code)
      return {...row,badge:row.name.slice(0,1),valueText:formatNumber(row.value),percent:total>0?Math.round(row.value/total*100):0,
        recordWeightText:(usedRecords.some(r=>r.weightOrigin==='USER_ACCEPTED_ESTIMATE')?'约':'')+formatNumber(usedRecords.reduce((sum,r)=>sum+Number(r.consumedGrams),0))+' 克',
        sourceVersionText:[...new Set(usedFacts.map(f=>f.sourceVersion))].sort().join('、'),
        evidenceIds:[...new Set(usedFacts.map(f=>f.nutrientFactId).filter((id):id is string=>Boolean(id)))].sort()}
    })]
  }))
}
function buildFoodRecords(records: ReportRecord[]): FoodRecord[] {
  const foods=new Map<string,{key:string;foodId:string|null;name:string;amount:number;estimated:boolean}>()
  for (const r of records) { const key=r.foodId||r.mealItemId;const p=foods.get(key);foods.set(key,{key,foodId:r.foodId,name:r.name,amount:(p?.amount||0)+Number(r.consumedGrams),estimated:Boolean(p?.estimated)||r.weightOrigin==='USER_ACCEPTED_ESTIMATE'}) }
  return [...foods.values()].map((r,i)=>({key:r.key,foodId:r.foodId,name:r.name,amount:r.amount,
    amountText:(r.estimated?'约':'')+formatNumber(r.amount)+' 克',badge:r.name.slice(0,1),tone:tones[i%tones.length]!}))
}

export function latestReportByDate(reports: AssessmentReport[]): Map<string, AssessmentReport> {
  const result = new Map<string, AssessmentReport>()
  for (const report of [...reports].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))) {
    if (!result.has(report.periodStart)) result.set(report.periodStart, report)
  }
  return result
}
