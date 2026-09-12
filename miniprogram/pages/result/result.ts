import { ApiError, request, uploadRecognitionImage } from '../../utils/api'
import { cleanupExpiredLocalImages, retentionOptions, saveLocalImage } from '../../utils/image-retention'
import { completeOperation, operationPayload } from '../../utils/operation'

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
interface CalculationResult {
  coverageRatio: string
  warnings: string[]
  nutrients: Array<{ nutrientCode: string; knownValue: string | null; unitCode: string; coverageRatio: string; complete: boolean }>
}

const nutrientNames: Record<string, string> = {
  ENERGY: '能量', PROTEIN: '蛋白质', FAT: '脂肪', CARBOHYDRATE: '碳水', CALCIUM: '钙', IRON: '铁',
  VITAMIN_A_RAE: '维生素A', VITAMIN_C: '维生素C', DIETARY_FIBER: '膳食纤维',
}
const unitNames: Record<string, string> = { KILOCALORIE: 'kcal', KCAL: 'kcal', GRAM: 'g', MILLIGRAM: 'mg', MICROGRAM: 'μg' }

Page({
  data: {
    photo: '/assets/camera-food-guide-v5.jpg', samplePhoto: true, busy: false,
    accepted: false, retentionIndex: 0, retentionOptions,
    result: null as RecognitionResult | null,
    foods: [] as Array<{ badge: string; name: string; amount: string; confidence: string; tone: string; index: number }>,
    query: '', searchResults: [] as FoodResult[], selectedFood: null as FoodResult | null,
    servedAmount: '', consumedAmount: '',
    nutrition: [] as Array<{ name: string; badge: string; value: string; tone: string }>,
    coverageText: '', warnings: [] as string[],
    errorMessage: '',
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
  onServedInput(event: WechatMiniprogram.Input) { this.setData({ servedAmount: event.detail.value }) },
  onConsumedInput(event: WechatMiniprogram.Input) { this.setData({ consumedAmount: event.detail.value }) },

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
        foods: items.map((item, index) => ({
          badge: item.observedName.slice(0, 1), name: item.observedName,
          amount: item.amountHint || '待确认', confidence: `${Math.round(item.confidence * 100)}%`, tone: 'vegetable', index,
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
    if (candidate) this.setData({ query: candidate.observedName }, () => { void this.searchFood() })
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
        success: ({ tapIndex }) => this.setData({ selectedFood: searchResults[tapIndex] || null }),
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '食品搜索失败'
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ busy: false }) }
  },

  editFood() { wx.showToast({ title: '请搜索并选择标准食品', icon: 'none' }) },

  async calculate(): Promise<CalculationResult | null> {
    const food = this.data.selectedFood
    const amount = this.data.consumedAmount.trim()
    if (!food || !/^\d+(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) return null
    const calculation = await request<CalculationResult>('/nutrition/calculate', {
      method: 'POST', data: { items: [{ foodId: food.foodId, amount, unit: 'g' }] },
    })
    const nutrients = calculation.nutrients.filter((item) => item.knownValue !== null).slice(0, 6).map((item) => ({
      name: nutrientNames[item.nutrientCode] || item.nutrientCode,
      badge: (nutrientNames[item.nutrientCode] || item.nutrientCode).slice(0, 1),
      value: `${item.knownValue} ${unitNames[item.unitCode] || item.unitCode}`,
      tone: item.nutrientCode === 'ENERGY' ? 'heat' : item.nutrientCode === 'PROTEIN' ? 'protein' : 'mineral',
    }))
    this.setData({ nutrition: nutrients, coverageText: `${Number(calculation.coverageRatio) * 100}%`, warnings: calculation.warnings })
    return calculation
  },

  async save(): Promise<void> {
    if (this.data.busy) return
    const mealId = wx.getStorageSync('foodmaster.currentMealId') as string | undefined
    const food = this.data.selectedFood
    const servedAmount = this.data.servedAmount.trim()
    const consumedAmount = this.data.consumedAmount.trim()
    if (!mealId) { wx.showToast({ title: '请从新增记录进入拍照', icon: 'none' }); return }
    if (!food) { wx.showToast({ title: '请先选择标准食品', icon: 'none' }); return }
    if (!/^\d+(?:\.\d{1,6})?$/.test(consumedAmount) || Number(consumedAmount) <= 0) { wx.showToast({ title: '请填写实际吃下克数', icon: 'none' }); return }
    if (servedAmount && (!/^\d+(?:\.\d{1,6})?$/.test(servedAmount) || Number(servedAmount) < Number(consumedAmount))) {
      wx.showToast({ title: '端上桌克数不能小于实际摄入', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      await this.calculate()
      const scope = `add-meal-item:${mealId}`
      const base: Record<string, unknown> = {
        foodId: food.foodId, observedName: food.canonicalNameZh, consumedAmount,
        source: this.data.result?.mode === 'AI_CANDIDATES' ? 'AI_CANDIDATE' : 'SEARCH', status: 'CONFIRMED',
      }
      if (servedAmount) base.servedAmount = servedAmount
      const payload = operationPayload(scope, base)
      await request(`/meals/${mealId}/items`, { method: 'POST', data: payload })
      completeOperation(scope, payload.operationId)
      await request(`/meals/${mealId}/confirm`, { method: 'POST' })
      wx.setStorageSync('mealSaved', true)
      wx.removeStorageSync('foodmaster.currentMealId')
      wx.redirectTo({ url: '/pages/records/records?saved=1' })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '保存失败'
      wx.showModal({ title: '保存失败', content: message, showCancel: false })
    } finally { this.setData({ busy: false }) }
  },
})
