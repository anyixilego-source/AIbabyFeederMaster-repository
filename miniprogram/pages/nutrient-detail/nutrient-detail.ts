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
  const suspended = ['CARBOHYDRATE', 'VITAMIN_A_RAE', 'FOLATE', 'IODINE'].includes(nutrient.nutrientCode)
  const recommended = nutrient.recommendedValue === null ? null : Number(nutrient.recommendedValue)
  const upper = nutrient.upperLimitValue === null ? null : Number(nutrient.upperLimitValue)
  const lowerRange = nutrient.rangeLowerValue === null ? null : Number(nutrient.rangeLowerValue)
  const upperRange = nutrient.rangeUpperValue === null ? null : Number(nutrient.rangeUpperValue)
  const hasRange = lowerRange !== null && upperRange !== null
  const isEnergyEstimate = nutrient.referenceType === 'EER'
  const isCarbEstimate = nutrient.referenceType === 'AMDR_DERIVED'
  const current = nutrient.numericValue || 0
  let referenceText = suspended ? '数据口径或覆盖待核对，暂不展示参考值' : '当前规则未提供适用参考值'
  let scaleMax = Math.max(current, 1)
  if (hasRange) {
    referenceText = isCarbEstimate
      ? `按一般能量需要量估算：${formatNumber(lowerRange)}–${formatNumber(upperRange)} ${nutrient.unitText}/日`
      : `一般参考区间 ${formatNumber(lowerRange)}–${formatNumber(upperRange)} ${nutrient.unitText}/日`
    scaleMax = Math.max(upperRange * 1.25, current, 1)
  } else if (recommended !== null && upper !== null) {
    referenceText = `一般参考值 ${formatNumber(recommended)}；上限参考 ${formatNumber(upper)} ${nutrient.unitText}/日`
    scaleMax = Math.max(upper, current, 1)
  } else if (recommended !== null) {
    referenceText = `${isEnergyEstimate ? '一般能量估计值' : '一般参考值'} ${formatNumber(recommended)} ${nutrient.unitText}/日`
    scaleMax = Math.max(recommended * 1.25, current, 1)
  } else if (upper !== null) {
    referenceText = `上限参考值 ${formatNumber(upper)} ${nutrient.unitText}/日`
    scaleMax = Math.max(upper, current, 1)
  }
  const markerPercent = Math.max(2, Math.min(98, Math.round(current / scaleMax * 100)))
  return {
    referenceText, markerPercent, scaleMaxText: formatNumber(scaleMax),
    referenceAvailable: recommended !== null || upper !== null || hasRange,
    hasRange,
    rangeStartPercent: hasRange ? Math.round(lowerRange / scaleMax * 100) : 0,
    rangeWidthPercent: hasRange ? Math.round((upperRange - lowerRange) / scaleMax * 100) : 0,
    showCurrentMarker: !isCarbEstimate && nutrient.numericValue !== null
      && nutrient.status !== 'UNIT_MISMATCH' && nutrient.status !== 'INSUFFICIENT_COVERAGE',
    referenceMainText: suspended ? '目前仅展示可计算的已记录量' : hasRange ? '两端为一般参考区间的下限和上限' : isEnergyEstimate
      ? '按月龄和性别估计的一般能量需要量' : '已记录摄入与当前月龄的一般参考值对照',
    referenceSubText: suspended ? '来源定义或食品覆盖仍待核对，不据此判断摄入是否充足。' : isCarbEstimate
      ? '由能量供能比推算；食品碳水口径待核对，暂不判断达标。'
      : hasRange ? '区间上限不是安全摄入上限，也不是过量判断线。'
        : '仅供了解，不代表营养达标、缺乏或医学判断。',
    expandableConclusion: !suspended && !['EER', 'AI_RANGE', 'AMDR_DERIVED'].includes(nutrient.referenceType || ''),
  }
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
    referenceAvailable: false,
    hasRange: false,
    rangeStartPercent: 0,
    rangeWidthPercent: 0,
    showCurrentMarker: true,
    referenceMainText: '',
    referenceSubText: '',
    expandableConclusion: true,
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
        referenceAvailable: reference.referenceAvailable,
        hasRange: reference.hasRange,
        rangeStartPercent: reference.rangeStartPercent,
        rangeWidthPercent: reference.rangeWidthPercent,
        showCurrentMarker: reference.showCurrentMarker,
        referenceMainText: reference.referenceMainText,
        referenceSubText: reference.referenceSubText,
        expandableConclusion: reference.expandableConclusion,
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

  toggleConclusion() { if (this.data.expandableConclusion) this.setData({ conclusionExpanded: !this.data.conclusionExpanded }) },
  toggleAbout() { this.setData({ aboutExpanded: !this.data.aboutExpanded }) },
  goBack() { wx.navigateBack() },
})
