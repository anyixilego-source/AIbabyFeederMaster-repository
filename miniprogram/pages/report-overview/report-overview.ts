import { ApiError } from '../../utils/api'
import { dateOnly, formatNumber, latestReportByDate, loadReportBundle, nutrientNames, unitNames } from '../../utils/nutrition-report'
import type { AssessmentNutrient, ReportBundle } from '../../utils/nutrition-report'
import { ensureSessionContext } from '../../utils/session'
import type { SessionContext } from '../../utils/session'

interface TrendOption { code: string; label: string }
interface TrendBar {
  date: string
  label: string
  valueText: string
  heightPercent: number
  current: boolean
  missing: boolean
  labelInside: boolean
}
interface ChartTick { valueText: string; topPercent: number }

const defaultTrendOptions: TrendOption[] = [
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

function niceStep(value: number): number {
  const exponent = Math.floor(Math.log10(Math.max(value, 0.0001)))
  const base = 10 ** exponent
  const fraction = value / base
  const multiplier = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return multiplier * base
}

Page({
  data: {
    loading: true,
    errorMessage: '',
    reminders: [] as string[],
    trendOptions: defaultTrendOptions,
    selectedTrend: 'ENERGY',
    selectedTrendName: '能量',
    selectedUnit: '',
    trendBars: [] as TrendBar[],
    chartTicks: [] as ChartTick[],
    referenceAvailable: false,
    referenceLabel: '',
    referencePercent: 0,
    foodRecords: [] as ReportBundle['foodRecords'],
    scrollTop: 0,
    showBackToTop: false,
  },

  onLoad() { void this.loadOverview() },

  async loadOverview() {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      currentBundle = await loadReportBundle(active.subjectId)
      const reminders: string[] = []
      if (currentBundle.warnings.length > 0 || currentBundle.nutrients.some((item) => item.dataNote)) {
        reminders.push('部分营养数据不完整，当前数值仅代表已知部分。')
      }
      reminders.push('今天可能还有未记录的奶量或其他食物。')
      if (reminders.length < 3) reminders.push('仅统计已记录并确认的食物。')
      const optionMap = new Map<string, TrendOption>()
      for (const nutrient of currentBundle.nutrients) {
        const code = nutrient.nutrientCode === 'ENERGY_KCAL' ? 'ENERGY' : nutrient.nutrientCode
        if (!optionMap.has(code)) optionMap.set(code, { code, label: nutrient.name })
      }
      const supportedOptions = [...optionMap.values()]
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
      wx.nextTick(() => this.measurePageHeight())
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
    const maximumValue = Math.max(reference || 0, ...availableValues, 1)
    const tickStep = niceStep(maximumValue / 4)
    const scaleMax = tickStep * 4
    const chartTicks: ChartTick[] = Array.from({ length: 5 }, (_, index) => ({
      valueText: formatNumber(scaleMax - tickStep * index),
      topPercent: index * 25,
    }))
    const referencePercent = reference === null ? null : Math.round(reference / scaleMax * 100)
    const trendBars: TrendBar[] = values.map((item, index) => {
      const heightPercent = item.value === null ? 0 : Math.max(4, Math.round(item.value / scaleMax * 100))
      return {
        date: dateOnly(item.date),
        label: `${item.date.getMonth() + 1}/${item.date.getDate()}`,
        valueText: item.value === null ? '—' : formatNumber(item.value),
        heightPercent,
        current: index === values.length - 1,
        missing: item.value === null,
        labelInside: item.value !== null && referencePercent !== null
          && heightPercent >= 14 && Math.abs(heightPercent - referencePercent) <= 10,
      }
    })
    const unitCode = currentNutrient?.unitCode || ''
    this.setData({
      selectedTrendName: nutrientNames[currentNutrient?.nutrientCode || this.data.selectedTrend] || '营养素',
      selectedUnit: unitNames[unitCode] || '',
      trendBars,
      chartTicks,
      referenceAvailable: reference !== null && Number.isFinite(reference),
      referenceLabel: reference === null ? '当前无适用参考线' : `参考达标线 ${formatNumber(reference)}`,
      referencePercent: referencePercent || 0,
    })
  },

  selectTrend(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedTrend: String(event.currentTarget.dataset.code) })
    this.buildTrend()
  },

  measurePageHeight() {
    wx.createSelectorQuery().in(this).select('.page-shell').boundingClientRect((rect) => {
      if (!rect) return
      const windowHeight = wx.getSystemInfoSync().windowHeight
      this.setData({ showBackToTop: rect.height > windowHeight * 2 })
    }).exec()
  },

  goBack() { wx.navigateBack() },
  openRecords() { wx.redirectTo({ url: '/pages/records/records' }) },
  backToTop() { this.setData({ scrollTop: 1 }); setTimeout(() => this.setData({ scrollTop: 0 }), 40) },
})
