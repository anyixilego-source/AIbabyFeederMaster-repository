import { ApiError, request, uploadRecognitionImage } from '../../utils/api'
import { cleanupExpiredLocalImages, retentionOptions, saveLocalImage } from '../../utils/image-retention'
import { completeOperation, getPendingOperation, operationPayload } from '../../utils/operation'

interface RecognitionItem {
  observedName: string
  form: string | null
  count: number | null
  amountHint: string | null
  confidence: number
  uncertainties: string[]
}
interface RecognitionResult { mode: 'AI_CANDIDATES' | 'MANUAL_SEARCH'; items?: RecognitionItem[]; reason?: string }
interface FoodResult { foodId: string; canonicalNameZh: string; foodForm: string | null; processingMethod: string | null }
interface ConfirmedFoodItem {
  localId: string
  candidateIndex: number
  observedName: string
  foodId: string
  canonicalNameZh: string
  badge: string
  servedAmount: string
  consumedAmount: string
  ratioPercent: number
  ratioAdjustedOrder: number
  source: 'AI_CANDIDATE' | 'SEARCH'
}
interface CalculationResult {
  coverageRatio: string
  warnings: string[]
  nutrients: Array<{ nutrientCode: string; knownValue: string | null; unitCode: string; coverageRatio: string; complete: boolean }>
}

const nutrientNames: Record<string, string> = {
  ENERGY: '能量', PROTEIN: '蛋白质', FAT: '脂肪', FAT_TOTAL: '脂肪', CARBOHYDRATE: '碳水', CALCIUM: '钙', IRON: '铁',
  VITAMIN_A_RAE: '维生素A', VITAMIN_C: '维生素C', DIETARY_FIBER: '膳食纤维', FIBER_DIETARY: '膳食纤维', ZINC: '锌',
}
const unitNames: Record<string, string> = { KILOCALORIE: 'kcal', KCAL: 'kcal', GRAM: 'g', MILLIGRAM: 'mg', MICROGRAM: 'μg' }
const warningNames: Record<string, string> = {
  NO_NUTRIENT_DATA: '暂无可用于计算的营养数据',
  ESTIMATED_ZERO_USED: '计算包含估计零值', PARTIAL_VALUE_USED: '计算包含部分已知值',
  TRACE_VALUE_PRESENT: '计算包含微量值', NUTRIENT_ABSENT_FOR_ITEM: '部分食品缺少该营养素数据',
}
function numberText(value: string): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toString() : value
}
function warningText(warning: string): string {
  const [nutrientCode, code] = warning.split(':')
  if (code === 'INCOMPLETE') return `${nutrientNames[nutrientCode] || nutrientCode}数据不完整`
  return warningNames[warning] || warning
}
function gramText(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}
function ratioTotal(items: ConfirmedFoodItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.ratioPercent || 0), 0)
}
function initialRatios(items: ConfirmedFoodItem[]): ConfirmedFoodItem[] {
  if (!items.length) return items
  if (ratioTotal(items) === 100 && items.every((item) => item.ratioPercent >= 1)) return items
  const adjustedTotal = items.reduce((sum, item) => sum + (item.ratioAdjustedOrder > 0 ? Number(item.ratioPercent || 0) : 0), 0)
  let automatic = items.filter((item) => item.ratioAdjustedOrder === 0)
  if (!automatic.length || adjustedTotal > 100 - automatic.length) automatic = items
  const automaticIds = new Set(automatic.map((item) => item.localId))
  const fixedTotal = automatic.length === items.length ? 0 : adjustedTotal
  const remaining = 100 - fixedTotal
  const base = Math.floor(remaining / automatic.length)
  let extra = remaining - base * automatic.length
  return items.map((item) => {
    if (!automaticIds.has(item.localId)) return item
    const ratioPercent = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra -= 1
    return { ...item, ratioPercent, ratioAdjustedOrder: automatic.length === items.length ? 0 : item.ratioAdjustedOrder }
  })
}
function applyRatioAmounts(items: ConfirmedFoodItem[], totalText: string): ConfirmedFoodItem[] {
  const total = Number(totalText)
  if (!Number.isFinite(total) || total <= 0) return items.map((item) => ({ ...item, consumedAmount: '' }))
  return items.map((item) => ({
    ...item,
    consumedAmount: gramText(total * Number(item.ratioPercent || 0) / 100),
  }))
}
function linkedRatioChange(items: ConfirmedFoodItem[], index: number, requestedValue: number, adjustedOrder: number): {
  items: ConfirmedFoodItem[]
  limited: boolean
} {
  if (index < 0 || index >= items.length) return { items, limited: true }
  if (items.length === 1) return { items: [{ ...items[0]!, ratioPercent: 100, ratioAdjustedOrder: adjustedOrder }], limited: true }
  const minimum = 1
  const maximum = 100 - (items.length - 1) * minimum
  const current = Number(items[index]?.ratioPercent || 0)
  const requested = Math.round(Number.isFinite(requestedValue) ? requestedValue : current)
  const value = Math.max(minimum, Math.min(maximum, requested))
  let remaining = Math.abs(value - current)
  const direction = value > current ? -1 : 1
  const circularDistance = (candidateIndex: number) => (candidateIndex - index + items.length) % items.length
  const candidates = items.map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ itemIndex }) => itemIndex !== index)
    .sort((left, right) => {
      const leftTouched = left.item.ratioAdjustedOrder === 0 ? 0 : 1
      const rightTouched = right.item.ratioAdjustedOrder === 0 ? 0 : 1
      if (leftTouched !== rightTouched) return leftTouched - rightTouched
      if (leftTouched === 1 && left.item.ratioAdjustedOrder !== right.item.ratioAdjustedOrder) {
        return left.item.ratioAdjustedOrder - right.item.ratioAdjustedOrder
      }
      return circularDistance(left.itemIndex) - circularDistance(right.itemIndex)
    })
  const changed = items.map((item, itemIndex) => itemIndex === index
    ? { ...item, ratioPercent: value, ratioAdjustedOrder: adjustedOrder }
    : { ...item })
  for (const candidate of candidates) {
    if (remaining <= 0) break
    const candidateItem = changed[candidate.itemIndex]!
    const capacity = direction < 0
      ? Math.max(0, candidateItem.ratioPercent - minimum)
      : maximum - candidateItem.ratioPercent
    const amount = Math.min(remaining, capacity)
    candidateItem.ratioPercent += direction * amount
    remaining -= amount
  }
  return remaining > 0
    ? { items, limited: true }
    : { items: changed, limited: value !== requested }
}

Page({
  data: {
    photo: '/assets/camera-food-guide-v5.jpg', samplePhoto: true, busy: false,
    accepted: false, retentionIndex: 0, retentionOptions,
    result: null as RecognitionResult | null,
    foods: [] as Array<{ badge: string; name: string; details: string; uncertainty: string; tone: string; index: number; mappedName: string }>,
    query: '', searchResults: [] as FoodResult[], pendingCandidateIndex: -1,
    confirmedFoods: [] as ConfirmedFoodItem[],
    mealTotalAmount: '200', ratioTotal: 0, ratioAdjustmentSequence: 0,
    nutrition: [] as Array<{ name: string; badge: string; value: string; tone: string }>,
    coverageText: '', warnings: [] as string[],
    errorMessage: '', scrollIntoView: '', manualFocus: false,
  },

  onLoad() {
    cleanupExpiredLocalImages()
    const photo = wx.getStorageSync('mealPhoto') as string | undefined
    if (photo && !photo.startsWith('/assets/')) this.setData({ photo, samplePhoto: false })
  },

  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/camera/camera' }) }) },
  retry() { wx.navigateBack({ delta: 1, fail: () => wx.redirectTo({ url: '/pages/camera/camera' }) }) },
  onConsentChange(event: WechatMiniprogram.CustomEvent) { this.setData({ accepted: event.detail.value.length > 0 }) },
  onRetentionChange(event: WechatMiniprogram.CustomEvent) { this.setData({ retentionIndex: Number(event.detail.value) }) },
  onQueryInput(event: WechatMiniprogram.Input) { this.setData({ query: event.detail.value }) },
  onManualBlur() { this.setData({ manualFocus: false }) },
  onMealTotalInput(event: WechatMiniprogram.Input) {
    const mealTotalAmount = event.detail.value
    const confirmedFoods = applyRatioAmounts(this.data.confirmedFoods, mealTotalAmount)
    this.setData({ mealTotalAmount, confirmedFoods })
  },
  updateLinkedRatio(event: WechatMiniprogram.SliderChange, showFeedback: boolean) {
    const index = Number(event.currentTarget.dataset.index)
    const ratioAdjustmentSequence = this.data.ratioAdjustmentSequence + 1
    const linked = linkedRatioChange(this.data.confirmedFoods, index, Number(event.detail.value), ratioAdjustmentSequence)
    const confirmedFoods = applyRatioAmounts(linked.items, this.data.mealTotalAmount)
    this.setData({ confirmedFoods, ratioTotal: ratioTotal(confirmedFoods), ratioAdjustmentSequence })
    if (showFeedback && linked.limited) {
      wx.showToast({ title: '已达到当前食材可调整范围', icon: 'none' })
    }
  },
  onRatioSliderChanging(event: WechatMiniprogram.SliderChange) {
    this.updateLinkedRatio(event, false)
  },
  onRatioSliderChange(event: WechatMiniprogram.SliderChange) {
    this.updateLinkedRatio(event, true)
  },

  async recognize(): Promise<void> {
    if (this.data.busy) return
    if (this.data.samplePhoto) { wx.showToast({ title: '请先拍照或选择图片', icon: 'none' }); return }
    if (!this.data.accepted) { wx.showToast({ title: '请先同意图片处理授权', icon: 'none' }); return }
    this.setData({ busy: true })
    try {
      const retention = this.data.retentionOptions[this.data.retentionIndex]
      const localPath = await saveLocalImage(this.data.photo, retention.value)
      const result = await uploadRecognitionImage<RecognitionResult>(localPath, {
        policyVersion: 'food-image-consent-v1', localRetention: retention.value,
      })
      const items = result.items || []
      this.setData({
        result,
        errorMessage: '',
        confirmedFoods: [], nutrition: [], coverageText: '', warnings: [],
        mealTotalAmount: '200', ratioTotal: 0, ratioAdjustmentSequence: 0,
        foods: items.map((item, index) => ({
          badge: item.observedName.slice(0, 1), name: item.observedName,
          details: [item.form, item.count === null ? null : `${item.count} 份`, item.amountHint || '份量待确认', `置信度 ${Math.round(item.confidence * 100)}%`].filter(Boolean).join(' · '),
          uncertainty: item.uncertainties.filter((value) => !value.includes('实际摄入克数')).join('；'), tone: 'vegetable', index, mappedName: '',
        })),
      })
      if (result.mode === 'MANUAL_SEARCH') wx.showToast({ title: '识别失败，请手工搜索', icon: 'none' })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '识别失败，请手工搜索'
      this.setData({ errorMessage: message })
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ busy: false }) }
  },

  useCandidate(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const candidate = this.data.result?.items?.[index]
    if (candidate) this.setData({ query: candidate.observedName, pendingCandidateIndex: index }, () => { void this.searchFood() })
  },

  startManualSearch() {
    this.setData({ pendingCandidateIndex: -1, scrollIntoView: 'confirm-section', manualFocus: true })
  },

  async searchFood(): Promise<void> {
    const query = this.data.query.trim()
    if (!query) { wx.showToast({ title: '请输入食品名称', icon: 'none' }); return }
    this.setData({ busy: true })
    try {
      const response = await request<{ items: FoodResult[] }>(`/foods/search?q=${encodeURIComponent(query)}&limit=8`)
      const searchResults = response.items || []
      this.setData({ searchResults })
      if (!searchResults.length) { wx.showToast({ title: '没有找到标准食品', icon: 'none' }); return }
      wx.showActionSheet({
        itemList: searchResults.map((item) => item.canonicalNameZh).slice(0, 6),
        success: ({ tapIndex }) => {
          const selected = searchResults[tapIndex]
          if (selected) this.selectFood(selected)
        },
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '食品搜索失败'
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ busy: false }) }
  },

  selectFood(food: FoodResult) {
    const candidateIndex = this.data.pendingCandidateIndex
    const candidate = candidateIndex >= 0 ? this.data.result?.items?.[candidateIndex] : undefined
    const currentIndex = candidateIndex >= 0
      ? this.data.confirmedFoods.findIndex((item) => item.candidateIndex === candidateIndex)
      : -1
    const current = currentIndex >= 0 ? this.data.confirmedFoods[currentIndex] : undefined
    const selected: ConfirmedFoodItem = {
      localId: current?.localId || `${Date.now().toString(36)}-${food.foodId}`,
      candidateIndex,
      observedName: candidate?.observedName || food.canonicalNameZh,
      foodId: food.foodId,
      canonicalNameZh: food.canonicalNameZh,
      badge: food.canonicalNameZh.slice(0, 1),
      servedAmount: current?.servedAmount || '',
      consumedAmount: current?.consumedAmount || '',
      ratioPercent: current?.ratioPercent || 0,
      ratioAdjustedOrder: current?.ratioAdjustedOrder || 0,
      source: candidate ? 'AI_CANDIDATE' : 'SEARCH',
    }
    let confirmedFoods = currentIndex >= 0
      ? this.data.confirmedFoods.map((item, index) => index === currentIndex ? selected : item)
      : [...this.data.confirmedFoods, selected]
    confirmedFoods = applyRatioAmounts(initialRatios(confirmedFoods), this.data.mealTotalAmount || '200')
    const foods = this.data.foods.map((item) => item.index === candidateIndex ? { ...item, mappedName: food.canonicalNameZh } : item)
    this.setData({
      confirmedFoods, foods, query: '', pendingCandidateIndex: -1, scrollIntoView: 'confirm-section',
      ratioTotal: ratioTotal(confirmedFoods),
    })
  },

  removeFood(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const removed = this.data.confirmedFoods[index]
    if (!removed) return
    let confirmedFoods = this.data.confirmedFoods.filter((_item, itemIndex) => itemIndex !== index)
    confirmedFoods = applyRatioAmounts(initialRatios(confirmedFoods), this.data.mealTotalAmount)
    const foods = this.data.foods.map((item) => item.index === removed.candidateIndex ? { ...item, mappedName: '' } : item)
    this.setData({ confirmedFoods, foods, nutrition: [], coverageText: '', warnings: [], ratioTotal: ratioTotal(confirmedFoods) })
  },

  async calculate(): Promise<CalculationResult | null> {
    const items = this.data.confirmedFoods.map((item) => ({ foodId: item.foodId, amount: item.consumedAmount.trim(), unit: 'g' }))
    if (!items.length || items.some((item) => !/^\d+(?:\.\d{1,6})?$/.test(item.amount) || Number(item.amount) <= 0)) return null
    const calculation = await request<CalculationResult>('/nutrition/calculate', {
      method: 'POST', data: { items },
    })
    const nutrients = calculation.nutrients.filter((item) => item.knownValue !== null).slice(0, 6).map((item) => ({
      name: nutrientNames[item.nutrientCode] || item.nutrientCode,
      badge: (nutrientNames[item.nutrientCode] || item.nutrientCode).slice(0, 1),
      value: `${numberText(item.knownValue!)} ${unitNames[item.unitCode] || item.unitCode}`,
      tone: item.nutrientCode === 'ENERGY' ? 'heat' : item.nutrientCode === 'PROTEIN' ? 'protein' : 'mineral',
    }))
    const coverage = Math.round(Number(calculation.coverageRatio) * 1000) / 10
    this.setData({ nutrition: nutrients, coverageText: `${coverage}%`, warnings: calculation.warnings.map(warningText) })
    return calculation
  },

  async save(): Promise<void> {
    if (this.data.busy) return
    const mealId = wx.getStorageSync('foodmaster.currentMealId') as string | undefined
    const foods = this.data.confirmedFoods
    if (!mealId) { wx.showToast({ title: '请从新增记录进入拍照', icon: 'none' }); return }
    if (!foods.length) { wx.showToast({ title: '请至少确认一种标准食品', icon: 'none' }); return }
    if (!/^\d+(?:\.\d{1,6})?$/.test(this.data.mealTotalAmount) || Number(this.data.mealTotalAmount) <= 0) {
      wx.showToast({ title: '请填写本餐实际摄入总克数', icon: 'none' }); return
    }
    if (this.data.ratioTotal !== 100) {
      wx.showToast({ title: `食材占比合计需为100%，当前${this.data.ratioTotal}%`, icon: 'none' }); return
    }
    for (const food of foods) {
      const consumedAmount = food.consumedAmount.trim()
      const servedAmount = food.servedAmount.trim()
      if (!/^\d+(?:\.\d{1,6})?$/.test(consumedAmount) || Number(consumedAmount) <= 0) {
        wx.showToast({ title: `请填写${food.canonicalNameZh}实际吃下克数`, icon: 'none' }); return
      }
      if (servedAmount && (!/^\d+(?:\.\d{1,6})?$/.test(servedAmount) || Number(servedAmount) < Number(consumedAmount))) {
        wx.showToast({ title: `${food.canonicalNameZh}端上桌克数不能小于实际摄入`, icon: 'none' }); return
      }
    }
    this.setData({ busy: true })
    try {
      await this.calculate()
      const operations: Array<{ scope: string; operationId: unknown }> = []
      for (const food of foods) {
        const scope = `add-meal-item:${mealId}:${food.localId}`
        const base: Record<string, unknown> = {
          foodId: food.foodId, observedName: food.observedName, consumedAmount: food.consumedAmount.trim(),
          source: food.source, status: 'CONFIRMED',
        }
        if (food.servedAmount.trim()) base.servedAmount = food.servedAmount.trim()
        const payload = getPendingOperation(scope) || operationPayload(scope, base)
        await request(`/meals/${mealId}/items`, { method: 'POST', data: payload })
        operations.push({ scope, operationId: payload.operationId })
      }
      await request(`/meals/${mealId}/confirm`, { method: 'POST' })
      operations.forEach((operation) => completeOperation(operation.scope, operation.operationId))
      wx.setStorageSync('mealSaved', true)
      wx.setStorageSync('foodmaster.reportNeedsRefresh', true)
      wx.removeStorageSync('foodmaster.currentMealId')
      wx.redirectTo({ url: '/pages/records/records?saved=1' })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '保存失败'
      wx.showModal({ title: '保存失败', content: message, showCancel: false })
    } finally { this.setData({ busy: false }) }
  },
})
