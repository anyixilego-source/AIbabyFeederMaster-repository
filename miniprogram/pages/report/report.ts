import { ApiError } from '../../utils/api'
import { loadReportBundle } from '../../utils/nutrition-report'
import type { NutrientView } from '../../utils/nutrition-report'
import { ensureSessionContext } from '../../utils/session'
import type { SessionContext } from '../../utils/session'

const categoryLabels = {
  MACRO: '宏量营养素',
  MINERAL: '矿物质',
  VITAMIN: '维生素',
  OTHER: '其他',
}

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

Page({
  data: {
    loading: true,
    errorMessage: '',
    babyName: '宝宝',
    ageText: '',
    dateLabel: '',
    encouragementTitle: '今天还可以继续加油',
    encouragementSubtitle: '慢慢记录就很好！',
    mealCount: 0,
    foodCount: 0,
    totalConsumedText: '0',
    categories: [
      { code: 'MACRO', label: categoryLabels.MACRO },
      { code: 'MINERAL', label: categoryLabels.MINERAL },
      { code: 'VITAMIN', label: categoryLabels.VITAMIN },
      { code: 'OTHER', label: categoryLabels.OTHER },
    ],
    selectedCategory: 'MACRO',
    sortByImportance: false,
    allNutrients: [] as NutrientView[],
    nutrients: [] as NutrientView[],
  },

  onShow() { void this.loadReport(false) },

  async loadReport(force: boolean) {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const bundle = await loadReportBundle(active.subjectId, force)
      const availableCategories = this.data.categories.filter((category) =>
        bundle.nutrients.some((nutrient) => nutrient.category === category.code))
      const selectedCategory = availableCategories.some((category) => category.code === this.data.selectedCategory)
        ? this.data.selectedCategory
        : (availableCategories[0]?.code || 'MACRO')
      const hasNeedsAttention = bundle.nutrients.some((nutrient) => nutrient.statusTone === 'warn' || nutrient.statusTone === 'danger')
      const hasPositiveReference = bundle.nutrients.some((nutrient) => nutrient.status === 'AT_OR_ABOVE_REFERENCE')
      const positiveEncouragement = hasPositiveReference && !hasNeedsAttention
      this.setData({
        babyName: bundle.subject.displayName,
        ageText: bundle.ageText,
        dateLabel: bundle.dateLabel,
        mealCount: bundle.mealCount,
        foodCount: bundle.foodCount,
        totalConsumedText: bundle.totalConsumedText,
        encouragementTitle: positiveEncouragement ? '今天吃得很棒' : '今天还可以继续加油',
        encouragementSubtitle: positiveEncouragement ? '继续加油呀！' : '慢慢记录就很好！',
        categories: availableCategories,
        selectedCategory,
        allNutrients: bundle.nutrients,
      })
      this.applyFilter()
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '报告加载失败'
      this.setData({ errorMessage: message, nutrients: [] })
    } finally {
      this.setData({ loading: false })
    }
  },

  applyFilter() {
    let nutrients = this.data.allNutrients.filter((item) => item.category === this.data.selectedCategory)
    if (this.data.sortByImportance) {
      nutrients = [...nutrients].sort((left, right) => {
        const leftAttention = left.dataNote || left.statusTone === 'warn' || left.statusTone === 'danger' ? 1 : 0
        const rightAttention = right.dataNote || right.statusTone === 'warn' || right.statusTone === 'danger' ? 1 : 0
        return rightAttention - leftAttention
      })
    }
    this.setData({ nutrients })
  },

  selectCategory(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedCategory: String(event.currentTarget.dataset.code) })
    this.applyFilter()
  },

  toggleSort(event: WechatMiniprogram.SwitchChange) {
    this.setData({ sortByImportance: event.detail.value })
    this.applyFilter()
  },

  openNutrient(event: WechatMiniprogram.TouchEvent) {
    const code = encodeURIComponent(String(event.currentTarget.dataset.code))
    wx.navigateTo({ url: `/pages/nutrient-detail/nutrient-detail?code=${code}` })
  },

  openOverview() { wx.navigateTo({ url: '/pages/report-overview/report-overview' }) },
  goBack() { wx.redirectTo({ url: '/pages/index/index' }) },
  refreshReport() { if (!this.data.loading) void this.loadReport(true) },
})
