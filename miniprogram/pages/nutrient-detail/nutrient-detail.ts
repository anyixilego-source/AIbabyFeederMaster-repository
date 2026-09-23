import { ApiError } from '../../utils/api'
import { formatNumber, loadReportBundle } from '../../utils/nutrition-report'
import type { NutrientView } from '../../utils/nutrition-report'
import { ensureSessionContext } from '../../utils/session'
import type { SessionContext } from '../../utils/session'

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

function referencePresentation(nutrient: NutrientView) {
  const recommended = nutrient.recommendedValue === null ? null : Number(nutrient.recommendedValue)
  const upper = nutrient.upperLimitValue === null ? null : Number(nutrient.upperLimitValue)
  const current = nutrient.numericValue || 0
  let referenceText = '当前规则未提供适用参考值'
  let scaleMax = Math.max(current, 1)
  if (recommended !== null && upper !== null) {
    referenceText = `一般参考值 ${formatNumber(recommended)}；上限参考 ${formatNumber(upper)} ${nutrient.unitText}/日`
    scaleMax = Math.max(upper, current, 1)
  } else if (recommended !== null) {
    referenceText = `一般参考值 ${formatNumber(recommended)} ${nutrient.unitText}/日`
    scaleMax = Math.max(recommended * 1.25, current, 1)
  } else if (upper !== null) {
    referenceText = `上限参考值 ${formatNumber(upper)} ${nutrient.unitText}/日`
    scaleMax = Math.max(upper, current, 1)
  }
  const markerPercent = Math.max(2, Math.min(98, Math.round(current / scaleMax * 100)))
  return { referenceText, markerPercent, scaleMaxText: formatNumber(scaleMax) }
}

Page({
  data: {
    loading: true,
    errorMessage: '',
    nutrientCode: '',
    name: '营养素',
    badge: '营',
    amountText: '—',
    unitText: '',
    sourceCount: 0,
    sources: [] as NutrientView['sources'],
    referenceText: '',
    markerPercent: 0,
    scaleMaxText: '',
    conclusion: '',
    conclusionTone: 'neutral',
    dataNote: '',
    conclusionExpanded: false,
    aboutExpanded: false,
    reasons: [] as string[],
    suggestions: [] as string[],
  },

  onLoad(query: Record<string, string>) {
    this.setData({ nutrientCode: decodeURIComponent(query.code || '') })
    void this.loadDetail()
  },

  async loadDetail() {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const bundle = await loadReportBundle(active.subjectId)
      const nutrient = bundle.nutrients.find((item) => item.nutrientCode === this.data.nutrientCode)
      if (!nutrient) throw new Error('没有找到该营养素的报告数据')
      const reference = referencePresentation(nutrient)
      const reasons = ['今天可能还有未记录的奶量或其他食物。']
      if (nutrient.dataNote) reasons.push(nutrient.dataNote + '，当前结果只代表已知部分。')
      const suggestions = ['补充遗漏的食物和实际吃下重量后，再更新报告。', '结合连续多天记录观察，不根据单日结果自行判断营养问题。']
      this.setData({
        name: nutrient.name,
        badge: nutrient.badge,
        amountText: nutrient.amountText,
        unitText: nutrient.unitText,
        sourceCount: nutrient.sources.length,
        sources: nutrient.sources.slice(0, 5),
        referenceText: reference.referenceText,
        markerPercent: reference.markerPercent,
        scaleMaxText: reference.scaleMaxText,
        conclusion: nutrient.statusText,
        conclusionTone: nutrient.statusTone,
        dataNote: nutrient.dataNote,
        reasons,
        suggestions,
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '详情加载失败'
      this.setData({ errorMessage: message })
    } finally {
      this.setData({ loading: false })
    }
  },

  toggleConclusion() { this.setData({ conclusionExpanded: !this.data.conclusionExpanded }) },
  toggleAbout() { this.setData({ aboutExpanded: !this.data.aboutExpanded }) },
  goBack() { wx.navigateBack() },
})
