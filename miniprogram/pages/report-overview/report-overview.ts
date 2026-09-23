import { ApiError } from '../../utils/api'
import { dateOnly, formatNumber, latestReportByDate, loadReportBundle, nutrientNames, unitNames } from '../../utils/nutrition-report'
import type { AssessmentNutrient, ReportBundle } from '../../utils/nutrition-report'
import { ensureSessionContext } from '../../utils/session'
import type { SessionContext } from '../../utils/session'

interface TrendOption { code: string; label: string }
interface TrendBar { date: string; label: string; valueText: string; heightPercent: number; current: boolean; missing: boolean }

const trendOptions: TrendOption[] = [
  { code: 'ENERGY', label: '能量' },
  { code: 'PROTEIN', label: '蛋白质' },
  { code: 'CALCIUM', label: '钙' },
  { code: 'IRON', label: '铁' },
  { code: 'VITAMIN_A_RAE', label: '维生素A' },
]

let currentBundle: ReportBundle | null = null

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

function nutrientForCode(nutrients: AssessmentNutrient[], code: string): AssessmentNutrient | undefined {
  if (code === 'ENERGY') return nutrients.find((item) => item.nutrientCode === 'ENERGY' || item.nutrientCode === 'ENERGY_KCAL')
  return nutrients.find((item) => item.nutrientCode === code)
}

function lastSevenDates(): Date[] {
  const today = new Date()
  const result: Date[] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    result.push(date)
  }
  return result
}

Page({
  data: {
    loading: true,
    errorMessage: '',
    reminders: [] as string[],
    trendOptions,
    selectedTrend: 'ENERGY',
    selectedTrendName: '能量',
    selectedUnit: '',
    trendBars: [] as TrendBar[],
    referenceAvailable: false,
    referenceLabel: '',
    referencePercent: 0,
    foodRecords: [] as ReportBundle['foodRecords'],
    scrollTop: 0,
  },

  onLoad() { void this.loadOverview() },

  async loadOverview() {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      currentBundle = await loadReportBundle(active.subjectId)
      const reminders = [...currentBundle.warnings]
      if (!reminders.some((item) => item.includes('未记录'))) reminders.push('今天可能还有未记录的奶量或其他食物。')
      if (reminders.length < 2) reminders.push('报告仅统计已经记录并确认的食物。')
      const supportedOptions = trendOptions.filter((option) => currentBundle!.nutrients.some((item) =>
        option.code === 'ENERGY' ? ['ENERGY', 'ENERGY_KCAL'].includes(item.nutrientCode) : item.nutrientCode === option.code))
      let selectedTrend = supportedOptions.some((item) => item.code === this.data.selectedTrend)
        ? this.data.selectedTrend
        : (supportedOptions[0]?.code || 'ENERGY')
      const withReference = supportedOptions.find((option) => {
        const nutrient = nutrientForCode(currentBundle!.report.result.assessment.nutrients, option.code)
        return nutrient?.recommendedValue !== null || nutrient?.upperLimitValue !== null
      })
      if (!nutrientForCode(currentBundle.report.result.assessment.nutrients, selectedTrend)?.recommendedValue && withReference) {
        selectedTrend = withReference.code
      }
      this.setData({
        reminders: reminders.slice(0, 3),
        trendOptions: supportedOptions,
        selectedTrend,
        foodRecords: currentBundle.foodRecords,
      })
      this.buildTrend()
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '报告概览加载失败'
      this.setData({ errorMessage: message })
    } finally {
      this.setData({ loading: false })
    }
  },

  buildTrend() {
    if (!currentBundle) return
    const reportsByDate = latestReportByDate(currentBundle.reports)
    const currentNutrient = nutrientForCode(currentBundle.report.result.assessment.nutrients, this.data.selectedTrend)
    const referenceRaw = currentNutrient?.recommendedValue || currentNutrient?.upperLimitValue
    const reference = referenceRaw === null || referenceRaw === undefined ? null : Number(referenceRaw)
    const values = lastSevenDates().map((date) => {
      const report = reportsByDate.get(dateOnly(date))
      const nutrient = report ? nutrientForCode(report.result.assessment.nutrients, this.data.selectedTrend) : undefined
      const value = nutrient?.averageDailyValue === null || nutrient?.averageDailyValue === undefined ? null : Number(nutrient.averageDailyValue)
      return { date, value: value !== null && Number.isFinite(value) ? value : null }
    })
    const availableValues = values.map((item) => item.value).filter((value): value is number => value !== null)
    const scaleMax = Math.max(reference || 0, ...availableValues, 1) * 1.18
    const trendBars: TrendBar[] = values.map((item, index) => ({
      date: dateOnly(item.date),
      label: `${item.date.getMonth() + 1}/${item.date.getDate()}`,
      valueText: item.value === null ? '—' : formatNumber(item.value),
      heightPercent: item.value === null ? 0 : Math.max(4, Math.round(item.value / scaleMax * 100)),
      current: index === values.length - 1,
      missing: item.value === null,
    }))
    const unitCode = currentNutrient?.unitCode || ''
    this.setData({
      selectedTrendName: nutrientNames[currentNutrient?.nutrientCode || this.data.selectedTrend] || '营养素',
      selectedUnit: unitNames[unitCode] || '',
      trendBars,
      referenceAvailable: reference !== null && Number.isFinite(reference),
      referenceLabel: reference === null ? '当前无适用参考线' : `参考达标线 ${formatNumber(reference)}`,
      referencePercent: reference === null ? 0 : Math.round(reference / scaleMax * 100),
    })
  },

  selectTrend(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedTrend: String(event.currentTarget.dataset.code) })
    this.buildTrend()
  },

  goBack() { wx.navigateBack() },
  openRecords() { wx.redirectTo({ url: '/pages/records/records' }) },
  backToTop() { this.setData({ scrollTop: 1 }); setTimeout(() => this.setData({ scrollTop: 0 }), 40) },
})
