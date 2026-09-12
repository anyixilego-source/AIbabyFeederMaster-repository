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
  coverageRatio: string
  warnings: string[]
  generatedAt: string
  result: { assessment: { status: string; nutrients: AssessmentNutrient[]; boundaryStatement: string } }
}

const nutrientNames: Record<string, string> = {
  ENERGY: '能量', PROTEIN: '蛋白质', FAT_TOTAL: '脂肪', CARBOHYDRATE: '碳水', CALCIUM: '钙', IRON: '铁',
  VITAMIN_A_RAE: '维生素A', VITAMIN_C: '维生素C', FIBER_DIETARY: '膳食纤维', ZINC: '锌',
}
const unitNames: Record<string, string> = { KILOCALORIE: 'kcal', KCAL: 'kcal', GRAM: 'g', MILLIGRAM: 'mg', MICROGRAM: 'μg' }
const statusLabels: Record<string, string> = {
  AT_OR_ABOVE_REFERENCE: '达到参考值', BELOW_REFERENCE: '低于参考值（非诊断）',
  ABOVE_UPPER_LIMIT: '高于上限参考', WITHIN_UPPER_LIMIT: '未超过上限',
  NO_INTAKE_DATA: '无摄入数据', INSUFFICIENT_COVERAGE: '数据覆盖不足',
  NO_REFERENCE_VALUE: '无适用参考值', UNIT_MISMATCH: '单位不匹配',
}
const warningLabels: Record<string, string> = {
  NO_CONFIRMED_INTAKE: '本时段没有已确认的实际摄入记录',
  NO_NUTRIENT_DATA: '本时段暂无可用于计算的营养数据',
  NO_INTAKE_DATA: '没有已确认的摄入数据',
  INSUFFICIENT_COVERAGE: '数据覆盖不足，暂不作参考值比较',
  NO_REFERENCE_VALUE: '当前规则没有提供适用参考值',
  UNIT_MISMATCH: '摄入数据与参考规则单位不一致',
}
function warningLabel(warning: string): string {
  const [nutrientCode, code] = warning.split(':')
  if (code) return `${nutrientNames[nutrientCode] || nutrientCode}：${warningLabels[code] || code}`
  return warningLabels[warning] || warning
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
    nutrients: [] as Array<{ name: string; badge: string; value: number; amount: string; status: string; color: string; warn: boolean }>,
    warnings: [] as string[],
  },

  onShow() { void this.loadReport() },

  async loadReport() {
    this.setData({ loading: true })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const today = new Date()
      const periodStart = dateOnly(today)
      const payload = operationPayload(`assessment:${active.subjectId}:${periodStart}`, {
        periodStart, periodEndExclusive: tomorrow(today), timezoneOffsetMinutes: -today.getTimezoneOffset(),
      })
      const [subject, report] = await Promise.all([
        request<SubjectSummary>(`/subjects/${active.subjectId}`),
        request<AssessmentReport>(`/subjects/${active.subjectId}/assessment-reports`, { method: 'POST', data: payload }),
      ])
      completeOperation(`assessment:${active.subjectId}:${periodStart}`, payload.operationId)
      const assessment = report.result.assessment
      const coverage = Math.round(Number(report.coverageRatio) * 100)
      this.setData({
        babyName: subject.displayName, ageText: ageLabel(subject.birthDate),
        dateLabel: `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`,
        reportStatus: assessment.status === 'ASSESSED' ? '参考规则已匹配' : '参考规则暂不可用',
        coverage, coverageText: `${coverage}%`, warnings: report.warnings.map(warningLabel),
        nutrients: assessment.nutrients.map((item) => {
          const value = Math.round(Number(item.coverageRatio) * 100)
          const label = statusLabels[item.status] || item.status
          return {
            name: nutrientNames[item.nutrientCode] || item.nutrientCode,
            badge: (nutrientNames[item.nutrientCode] || item.nutrientCode).slice(0, 1), value,
            amount: item.averageDailyValue === null ? '暂无数值' : `${item.averageDailyValue} ${unitNames[item.unitCode] || item.unitCode}`,
            status: label,
            color: item.status === 'ABOVE_UPPER_LIMIT' ? '#ef6c64' : item.status === 'AT_OR_ABOVE_REFERENCE' ? '#73c959' : '#f6a623',
            warn: item.status !== 'AT_OR_ABOVE_REFERENCE' && item.status !== 'WITHIN_UPPER_LIMIT',
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
  share() { wx.showToast({ title: '内部学习版暂不分享个体报告', icon: 'none' }) },
  openRecords() { wx.redirectTo({ url: '/pages/records/records' }) },
})
