import { ApiError, request } from '../../utils/api'
import { completeOperation, operationPayload } from '../../utils/operation'
import { ensureSessionContext, SessionContext, SubjectSummary } from '../../utils/session'

interface AssessmentNutrient {
  nutrientCode: string
  status: string
  averageDailyValue: string | null
  unitCode: string
  coverageRatio: string
  recommendedValue: string | null
  upperLimitValue: string | null
  warnings: string[]
}
interface AssessmentReport {
  reportId: string
  periodStart: string
  coverageRatio: string
  warnings: string[]
  generatedAt: string
  result: { assessment: { status: string; nutrients: AssessmentNutrient[]; boundaryStatement: string } }
}

const nutrientNames: Record<string, string> = {
  ENERGY: '能量', ENERGY_KCAL: '能量', PROTEIN: '蛋白质', FAT_TOTAL: '脂肪', CARBOHYDRATE: '碳水化合物',
  CALCIUM: '钙', IRON: '铁', SODIUM: '钠', VITAMIN_A_RAE: '维生素A', VITAMIN_C: '维生素C',
  FIBER_DIETARY: '膳食纤维', ZINC: '锌',
}
const unitNames: Record<string, string> = {
  KILOCALORIE: '千卡', KCAL: '千卡', GRAM: '克', MILLIGRAM: '毫克', MICROGRAM: '微克', MICROGRAM_RAE: '微克 RAE',
}
const statusLabels: Record<string, string> = {
  AT_OR_ABOVE_REFERENCE: '达到参考值', BELOW_REFERENCE: '低于参考值',
  ABOVE_UPPER_LIMIT: '超过上限参考', WITHIN_UPPER_LIMIT: '未超过上限',
  NO_INTAKE_DATA: '暂无摄入数据', INSUFFICIENT_COVERAGE: '数据不足，暂不比较',
  NO_REFERENCE_VALUE: '当前规则无参考值', UNIT_MISMATCH: '单位不同，暂不比较',
}
const warningLabels: Record<string, string> = {
  NO_CONFIRMED_INTAKE: '本时段没有已确认的实际摄入记录',
  NO_NUTRIENT_DATA: '本时段暂无可用于计算的营养数据',
  NO_INTAKE_DATA: '没有已确认的摄入数据，无法进行参考值比较',
  INSUFFICIENT_COVERAGE: '可计算数据不足，暂不进行参考值比较',
  INSUFFICIENT_COVERAGE_NO_COMPARISON: '可计算数据不足，暂不进行参考值比较',
  NO_REFERENCE_VALUE: '当前规则没有提供适用参考值',
  UNIT_MISMATCH: '摄入数据与参考规则单位不同，暂不比较',
  UNIT_MISMATCH_NO_COMPARISON: '摄入数据与参考规则单位不同，暂不比较',
  BELOW_REFERENCE_NOT_DIAGNOSIS: '本次已确认摄入低于参考值，仅供记录参考，不代表营养诊断',
  REFERENCE_UPPER_LIMIT_EXCEEDED: '本次已确认摄入超过上限参考值，请结合完整饮食记录理解',
  INCOMPLETE: '部分已确认食物缺少该营养素数值，当前合计可能不完整',
  NUTRIENT_ABSENT_FOR_ITEM: '部分已确认食物没有该营养素数据',
  INCONSISTENT_OR_MISSING_UNIT: '数据单位缺失或不一致，暂不进行参考值比较',
  ESTIMATED_ZERO_USED: '计算中使用了来源标注的估计零值',
  PARTIAL_VALUE_USED: '计算中使用了部分已知值',
  TRACE_VALUE_PRESENT: '部分食物仅标注为微量，未按确定数值计入',
  NO_APPLICABLE_RULE: '当前月龄或条件没有匹配的参考规则',
}
function warningLabel(warning: string): string {
  const [prefix, code] = warning.split(':')
  if (code && nutrientNames[prefix]) return `${nutrientNames[prefix]}：${warningLabels[code] || '存在尚未归类的数据说明'}`
  if (prefix === 'RULES_UNAVAILABLE') return `参考规则暂不可用：${warningLabels[code] || '当前条件没有匹配规则'}`
  if (prefix === 'AMBIGUOUS_RULE') return `${nutrientNames[code] || '部分营养素'}存在多条适用规则，暂不比较`
  return warningLabels[warning] || '存在尚未归类的数据说明，请稍后更新报告'
}

function statusTone(status: string): string {
  if (status === 'AT_OR_ABOVE_REFERENCE' || status === 'WITHIN_UPPER_LIMIT') return 'good'
  if (status === 'ABOVE_UPPER_LIMIT') return 'danger'
  if (status === 'BELOW_REFERENCE') return 'warn'
  return 'neutral'
}

function dateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}
function tomorrow(date: Date): string {
  const next = new Date(date)
  next.setDate(next.getDate() + 1)
  return dateOnly(next)
}
function ageLabel(birthDate: string): string {
  const birth = new Date(`${birthDate}T00:00:00`)
  const today = new Date()
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth()
  if (today.getDate() < birth.getDate()) months -= 1
  return `${Math.max(0, months)}个月`
}
async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

Page({
  data: {
    loading: true, babyName: '宝宝', ageText: '', dateLabel: '', reportStatus: '加载中',
    coverage: 0, coverageText: '0%',
    nutrients: [] as Array<{ nutrientCode: string; name: string; badge: string; value: number; amount: string; status: string; ringColor: string; statusTone: string }>,
    warnings: [] as string[],
  },

  onShow() { void this.loadReport(false) },

  async loadReport(force: boolean) {
    this.setData({ loading: true })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const today = new Date()
      const periodStart = dateOnly(today)
      const [subject, reports] = await Promise.all([
        request<SubjectSummary>(`/subjects/${active.subjectId}`),
        request<AssessmentReport[]>(`/subjects/${active.subjectId}/assessment-reports`),
      ])
      let report = force ? undefined : reports.find((item) => item.periodStart === periodStart)
      if (!report) {
        const payload = operationPayload(`assessment:${active.subjectId}:${periodStart}`, {
          periodStart, periodEndExclusive: tomorrow(today), timezoneOffsetMinutes: -today.getTimezoneOffset(),
        })
        report = await request<AssessmentReport>(`/subjects/${active.subjectId}/assessment-reports`, { method: 'POST', data: payload })
        completeOperation(`assessment:${active.subjectId}:${periodStart}`, payload.operationId)
      }
      const assessment = report.result.assessment
      const coverage = Math.round(Number(report.coverageRatio) * 100)
      this.setData({
        babyName: subject.displayName, ageText: ageLabel(subject.birthDate),
        dateLabel: `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`,
        reportStatus: assessment.status === 'ASSESSED' ? '参考规则已匹配' : '参考规则暂不可用',
        coverage, coverageText: `${coverage}%`, warnings: report.warnings.map(warningLabel),
        nutrients: assessment.nutrients.map((item) => {
          const value = Math.round(Number(item.coverageRatio) * 100)
          const label = statusLabels[item.status] || '暂无法比较'
          const name = nutrientNames[item.nutrientCode] || '其他营养素'
          return {
            nutrientCode: item.nutrientCode, name, badge: name.slice(0, 1), value,
            amount: item.averageDailyValue === null ? '暂无可计算数值' : `${item.averageDailyValue} ${unitNames[item.unitCode] || '（单位待核对）'}`,
            status: label,
            ringColor: value === 100 ? '#42b7ca' : '#f6a623',
            statusTone: statusTone(item.status),
          }
        }),
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '报告加载失败'
      wx.showToast({ title: message, icon: 'none' })
      this.setData({ reportStatus: '报告暂不可用', warnings: [message] })
    } finally { this.setData({ loading: false }) }
  },

  goBack() { wx.redirectTo({ url: '/pages/index/index' }) },
  refreshReport() { if (!this.data.loading) void this.loadReport(true) },
  openRecords() { wx.redirectTo({ url: '/pages/records/records' }) },
})
