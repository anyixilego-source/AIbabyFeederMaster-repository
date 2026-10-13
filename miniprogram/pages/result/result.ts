import {backTo,navigateRoot} from '../../utils/navigation'
import { gramUnits, validNewWeight, weightNotice,exactGrams } from '../../utils/meal-edit'
import { ApiError, request, uploadRecognitionImage } from '../../utils/api'
import { cleanupExpiredLocalImages, retentionOptions, saveLocalImage } from '../../utils/image-retention'
import {pendingRecord,submitRecord} from '../../utils/record-submit'
import { ensureSessionContext } from '../../utils/session'
import { abandonCurrentMeal, discardAbandonedMeals } from '../../utils/pending-meal'

interface RecognitionItem {
  observedName: string
  form: string | null
  count: number | null
  amountHint: string | null
  confidence: number
  uncertainties: string[]
}
interface RecognitionResult { mode: 'AI_CANDIDATES' | 'MANUAL_SEARCH'; items?: RecognitionItem[]; reason?: string }
interface FoodResult { selectedFoodRevisionId?:string|null;foodId: string; canonicalNameZh: string; foodForm: string | null; processingMethod: string | null }
interface ConfirmedFoodItem {
  selectedFoodRevisionId?:string|null
  localId: string
  candidateIndex: number
  observedName: string
  foodId: string | null
  canonicalNameZh: string
  badge: string
  servedAmount: string
  consumedAmount: string
  ratioPercent: number
  ratioAdjustedOrder: number
  source: 'AI_CANDIDATE' | 'SEARCH' | 'MANUAL'
  unmatched?: boolean
  matchReason?: string
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
const weightExamples = [
  { grams: 25, hint: '约半个蛋', icon: '/assets/weight-example-25-v1.png' },
  { grams: 50, hint: '约1个蛋', icon: '/assets/weight-example-50-v1.png' },
  { grams: 80, hint: '约1根香蕉', icon: '/assets/weight-example-80-v1.png' },
  { grams: 100, hint: '约2个蛋', icon: '/assets/weight-example-100-v1.png' },
  { grams: 150, hint: '约2根香蕉', icon: '/assets/weight-example-150-v1.png' },
  { grams: 170, hint: '约1个苹果', icon: '/assets/weight-example-170-v1.png' },
  { grams: 200, hint: '约1个橙子', icon: '/assets/weight-example-200-v1.png' },
  { grams: 250, hint: '约苹果+香蕉', icon: '/assets/weight-example-250-v1.png' },
  { grams: 300, hint: '约苹果+香蕉+鸡蛋', icon: '/assets/weight-example-300-v1.png' },
]
const weightTicks = [0, 50, 100, 150, 200, 250, 300].map((grams) => ({ grams, label: `${grams}g` }))
function weightPresentation(value: string, previewGrams?: number) {
  const grams = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(grams) && grams >= 0
  const sliderAmount = valid ? Math.min(300, grams) : 0
  const preview = previewGrams ?? grams
  const example = valid && Number.isFinite(preview)
    ? weightExamples.reduce<(typeof weightExamples)[number] | undefined>((closest, item) => {
      const distance = Math.abs(item.grams - preview)
      return distance <= 10 && (!closest || distance < Math.abs(closest.grams - preview)) ? item : closest
    }, undefined)
    : undefined
  return {
    sliderAmount,
    sliderPercent: sliderAmount / 3,
    bubblePercent: example ? example.grams / 3 : 0,
    bubbleAlign: example && example.grams <= 40 ? 'start' : example && example.grams >= 260 ? 'end' : 'center',
    weightHint: example?.hint || '',
    weightIcon: example?.icon || '',
    weightWarning: valid ? weightNotice(value) : '',
  }
}
function snappedWeight(value: number): number {
  const bounded = Math.max(0, Math.min(300, Math.round(value)))
  const tick = Math.round(bounded / 50) * 50
  return Math.abs(bounded - tick) <= 6 ? tick : bounded
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
  const total = Math.round(Number(totalText) * 10)
  if (!Number.isFinite(total) || total <= 0) return items.map((item) => ({ ...item, consumedAmount: '' }))
  const allocations=items.map((item,index)=>({index,raw:total*Number(item.ratioPercent||0)/100,units:Math.floor(total*Number(item.ratioPercent||0)/100)}))
  let remainder=total-allocations.reduce((sum,a)=>sum+a.units,0)
  for(const a of [...allocations].sort((a,b)=>(b.raw-b.units)-(a.raw-a.units)||a.index-b.index)){if(remainder<=0)break;a.units++;remainder--}
  return items.map((item,index)=>({...item,consumedAmount:String((allocations[index]?.units||0)/10)}))
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
function confirmedFoodSelection(
  food: FoodResult,
  candidate: RecognitionItem | undefined,
  candidateIndex: number,
  current?: ConfirmedFoodItem,
): ConfirmedFoodItem {
  const unmatched = !food.foodId
  return {
    localId: current?.localId || `${Date.now().toString(36)}-${candidateIndex}-${food.foodId || 'by-name'}`,
    candidateIndex,
    observedName: unmatched ? food.canonicalNameZh : (candidate?.observedName || food.canonicalNameZh),
    foodId: unmatched ? null : food.foodId,selectedFoodRevisionId:unmatched?null:food.selectedFoodRevisionId,
    canonicalNameZh: food.canonicalNameZh,
    badge: food.canonicalNameZh.slice(0, 1),
    servedAmount: current?.servedAmount || '',
    consumedAmount: current?.consumedAmount || '',
    ratioPercent: current?.ratioPercent || 0,
    ratioAdjustedOrder: current?.ratioAdjustedOrder || 0,
    source: unmatched ? 'MANUAL' : (candidate ? 'AI_CANDIDATE' : 'SEARCH'),
    unmatched,
    matchReason: unmatched ? 'NO_MATCH_NO_NUTRITION' : undefined,
  }
}

Page({
  data: { reviewLabel:wx.getSystemInfoSync().platform==='devtools'?(wx.getStorageSync('foodmaster.trial.reviewEnvironment')?.label || ''):'',
    showFoodSelector:false, manualEntry: false, searchMessage:'', searchExample:'构造样例食品',
    photo: '/assets/camera-food-guide-v5.jpg', samplePhoto: true, busy: false, saving: false, abandoned: false,
    accepted: false, retentionIndex: 0, retentionOptions,
    result: null as RecognitionResult | null,
    foods: [] as Array<{ badge: string; name: string; details: string; uncertainty: string; tone: string; index: number; mappedName: string }>,
    query: '', searchResults: [] as FoodResult[], pendingCandidateIndex: -1, searchCursor: '', searchHasMore: false, searchingMore: false,
    confirmedFoods: [] as ConfirmedFoodItem[],
    mealTotalAmount: '200', ...weightPresentation('200'), weightBubbleVisible: false, weightTicks,
    ratioTotal: 0, ratioAdjustmentSequence: 0,
    nutrition: [] as Array<{ name: string; badge: string; value: string; tone: string }>,
    coverageText: '', warnings: [] as string[],
    errorMessage: '', scrollIntoView: '', manualFocus: false,
  },

  onLoad() {
    this.setData({ abandoned: false, saving: false,manualEntry:Boolean(wx.getStorageSync('foodmaster.trial.manualEntry')) })
    cleanupExpiredLocalImages()
    const photo = wx.getStorageSync('foodmaster.trial.mealPhoto') as string | undefined
    if (photo && !photo.startsWith('/assets/')) this.setData({ photo, samplePhoto: false })
  },
  onShow() {
    if (this.data.abandoned && !this.data.saving) {
      abandonCurrentMeal()
      void discardAbandonedMeals()
      backTo('/pages/camera/camera',this)
    }
  },
  onHide() {
    this.setData({ abandoned: true })
    if (!this.data.saving) {
      abandonCurrentMeal()
      void discardAbandonedMeals()
    }
  },
  onUnload() {
    abandonCurrentMeal()
    void discardAbandonedMeals()
  },
  async leaveRecognition(confirmDiscard: boolean) {
    if (this.data.saving) { wx.showToast({ title: '正在保存，请稍候', icon: 'none' }); return }
    if (confirmDiscard && wx.getStorageSync('foodmaster.trial.currentMealId')) {
      const confirmed = await new Promise<boolean>((resolve) => wx.showModal({
        title: '退出本次识别？',
        content: '未保存的内容会放弃，下次需要重新选择图片并识别。',
        confirmText: '退出',
        success: ({ confirm }) => resolve(confirm),
        fail: () => resolve(false),
      }))
      if (!confirmed) return
    }
    this.setData({ abandoned: true })
    abandonCurrentMeal()
    await discardAbandonedMeals()
    backTo('/pages/camera/camera',this)
  },
  goBack() { void this.leaveRecognition(true) },
  retry() { void this.leaveRecognition(this.data.confirmedFoods.length > 0) },
  toggleConsent() { this.setData({ accepted: !this.data.accepted }) },
  openConsentDetails() {
    wx.showModal({
      title: '图片处理授权说明',
      content: '为识别食物营养成分，需要将所选食物图片发送至 DeepSeek 模型。API 调用场景下图片不用于训练；服务端仅在请求期间临时接触且不保存；原始图片只保存在本地终端，并按你选择的期限自动删除；图片中的无关人物由 AI Prompt 忽略。不同意不影响手工搜索等基础功能。',
      showCancel: false,
      confirmText: '我知道了',
    })
  },
  onConsentPrimaryAction() {
    if (this.data.busy) return
    if (!this.data.accepted) {
      this.setData({ accepted: true })
      return
    }
    void this.recognize()
  },
  onRetentionChange(event: WechatMiniprogram.CustomEvent) { this.setData({ retentionIndex: Number(event.detail.value) }) },
  onQueryInput(event: WechatMiniprogram.Input) { this.setData({ query: event.detail.value }) },
  onManualBlur() { this.setData({ manualFocus: false }) },
  onMealTotalInput(event: WechatMiniprogram.Input) {
    const mealTotalAmount = event.detail.value
    const confirmedFoods = applyRatioAmounts(this.data.confirmedFoods, mealTotalAmount)
    this.setData({ mealTotalAmount, ...weightPresentation(mealTotalAmount), weightBubbleVisible: false, confirmedFoods })
  },
  updateMealTotalFromSlider(event: WechatMiniprogram.SliderChange, weightBubbleVisible: boolean) {
    const rawAmount = Math.max(0, Math.min(300, Math.round(Number(event.detail.value))))
    const mealTotalAmount = String(snappedWeight(rawAmount))
    const presentation = weightPresentation(mealTotalAmount, rawAmount)
    const sliderAmount = weightBubbleVisible ? rawAmount : presentation.sliderAmount
    const updates: Partial<{
      sliderAmount: number; sliderPercent: number; weightBubbleVisible: boolean
      mealTotalAmount: string; confirmedFoods: ConfirmedFoodItem[]
      weightHint: string; weightIcon: string; bubbleAlign: string; bubblePercent: number; weightWarning: string
    }> = {}
    if (this.data.sliderAmount !== sliderAmount) updates.sliderAmount = sliderAmount
    if (this.data.sliderPercent !== sliderAmount / 3) updates.sliderPercent = sliderAmount / 3
    if (this.data.weightBubbleVisible !== weightBubbleVisible) updates.weightBubbleVisible = weightBubbleVisible
    if (this.data.mealTotalAmount !== mealTotalAmount) {
      updates.mealTotalAmount = mealTotalAmount
      updates.confirmedFoods = applyRatioAmounts(this.data.confirmedFoods, mealTotalAmount)
    }
    if (this.data.weightHint !== presentation.weightHint) {
      updates.weightHint = presentation.weightHint
      updates.weightIcon = presentation.weightIcon
      updates.bubbleAlign = presentation.bubbleAlign
      updates.bubblePercent = presentation.bubblePercent
    }
    if (this.data.weightWarning !== presentation.weightWarning) updates.weightWarning = presentation.weightWarning
    if (Object.keys(updates).length) this.setData(updates)
  },
  onMealWeightChanging(event: WechatMiniprogram.SliderChange) {
    this.updateMealTotalFromSlider(event, true)
  },
  onMealWeightChange(event: WechatMiniprogram.SliderChange) {
    this.updateMealTotalFromSlider(event, false)
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
    this.setData({ busy: true, saving: true })
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
        mealTotalAmount: '200', ...weightPresentation('200'), weightBubbleVisible: false, ratioTotal: 0, ratioAdjustmentSequence: 0,
        foods: items.map((item, index) => ({
          badge: item.observedName.slice(0, 1), name: item.observedName,
          details: [item.form, item.count === null ? null : `${item.count} 份`, item.amountHint || '份量待确认', `置信度 ${Math.round(item.confidence * 100)}%`].filter(Boolean).join(' · '),
          uncertainty: item.uncertainties.filter((value) => !value.includes('实际摄入克数')).join('；'), tone: 'vegetable', index, mappedName: '',
        })),
      })
      if (result.mode === 'MANUAL_SEARCH') {
        wx.showToast({ title: '识别失败，请手工搜索', icon: 'none' })
      } else if (items.length) {
        await this.autoMapCandidates(items)
      }
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '识别失败，请手工搜索'
      this.setData({ errorMessage: message })
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      this.setData({ busy: false, saving: false })
      if (this.data.abandoned && wx.getStorageSync('foodmaster.trial.currentMealId')) {
        abandonCurrentMeal()
        void discardAbandonedMeals()
        backTo('/pages/camera/camera',this)
      }
    }
  },

  useCandidate(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const candidate = this.data.result?.items?.[index]
    if (candidate) this.setData({ query: candidate.observedName, pendingCandidateIndex: index }, () => { void this.searchFood() })
  },

  startManualSearch() {
    this.setData({showFoodSelector:true,pendingCandidateIndex:-1,query:''})
  },

  searchSample() { this.setData({query:this.data.searchExample,pendingCandidateIndex:-1});void this.searchFood() },
  closeFoodSelector(){this.setData({showFoodSelector:false})},
  onFoodSelection(e:WechatMiniprogram.CustomEvent<{food:FoodResult;unmatched:boolean;matchReason?:string}>){const candidateIndex=this.data.pendingCandidateIndex;this.selectFood(e.detail.food);if(e.detail.unmatched&&e.detail.matchReason){const index=candidateIndex>=0?this.data.confirmedFoods.findIndex(i=>i.candidateIndex===candidateIndex):this.data.confirmedFoods.length-1;this.setData({confirmedFoods:this.data.confirmedFoods.map((item,i)=>i===index?{...item,matchReason:e.detail.matchReason}:item)})}this.setData({showFoodSelector:false})},
  async searchFood(): Promise<void> {
    this.setData({showFoodSelector:true});return
  },
  async legacySearchFood(): Promise<void> {
    const query = this.data.query.trim()
    if (!query) { wx.showToast({ title: '请输入食品名称', icon: 'none' }); return }
    this.setData({ busy: true, searchCursor: '', searchHasMore: false })
    try {
      const response = await request<{ items: FoodResult[]; nextCursor: string | null; hasMore: boolean }>(`/foods/search?q=${encodeURIComponent(query)}&limit=15`)
      const searchResults = response.items || []
      this.setData({ searchResults, searchCursor: response.nextCursor || '', searchHasMore: response.hasMore,
        searchMessage: searchResults.length ? '' : '没有找到匹配的标准食品。可在下方按名称记录（暂无营养资料）。' })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '食品搜索失败'
      this.setData({ searchResults: [], searchMessage: message })
    } finally { this.setData({ busy: false }) }
  },

  async loadMoreSearch(): Promise<void> {
    if (this.data.busy || this.data.searchingMore || !this.data.searchHasMore || !this.data.searchCursor) return
    this.setData({ searchingMore: true })
    try {
      const response = await request<{ items: FoodResult[]; nextCursor: string | null; hasMore: boolean }>(`/foods/search?q=${encodeURIComponent(this.data.query.trim())}&limit=15&cursor=${encodeURIComponent(this.data.searchCursor)}`)
      const seen = new Set(this.data.searchResults.map((item) => item.foodId))
      this.setData({ searchResults: [...this.data.searchResults, ...response.items.filter((item) => !seen.has(item.foodId))],
        searchCursor: response.nextCursor || '', searchHasMore: response.hasMore })
    } catch (caught) {
      wx.showToast({ title: caught instanceof Error ? caught.message : '加载更多失败', icon: 'none' })
    } finally { this.setData({ searchingMore: false }) }
  },

  chooseUnmatched(): void {
    const name = this.data.query.trim()
    if (!name) { wx.showToast({ title: '请先输入食品名称', icon: 'none' }); return }
    this.selectFood({ foodId: '', canonicalNameZh: name, foodForm: null, processingMethod: null }, this.data.pendingCandidateIndex, true)
  },

  async autoMapCandidates(items: RecognitionItem[]): Promise<void> {
    type Match={localId:string|null;autoSelectable:boolean;unmatchedReason:string|null;candidates:Array<{foodId:string;canonicalNameZh:string;processingMethod:string|null}>}
    let results:Match[]=[]
    try{const response=await request<{results:Match[]}>('/foods/match-candidates',{method:'POST',data:{items:items.map((candidate,index)=>({localId:String(index),name:candidate.observedName}))}});results=response.results}catch{results=[]}
    if(this.data.abandoned)return
    const confirmedFoods=items.map((candidate,index)=>{
      const match=results.find(r=>r.localId===String(index)),selected=match?.autoSelectable?match.candidates[0]:undefined
      const food:FoodResult=selected?{...selected,foodForm:null}:{foodId:'',canonicalNameZh:candidate.observedName,foodForm:null,processingMethod:null}
      return {...confirmedFoodSelection(food,candidate,index),source:'AI_CANDIDATE' as const,matchReason:selected?undefined:match?.unmatchedReason||'REQUEST_FAILED'}
    })
    const foods=this.data.foods.map((row,index)=>({...row,mappedName:confirmedFoods[index]?.foodId?'建议匹配：'+confirmedFoods[index].canonicalNameZh:'待选择；可按名称记录'}))
    const allocated=applyRatioAmounts(initialRatios(confirmedFoods),this.data.mealTotalAmount||'200')
    this.setData({confirmedFoods:allocated,foods,pendingCandidateIndex:-1,scrollIntoView:'confirm-section',ratioTotal:ratioTotal(allocated)})
  },

  onSearchResultTap(event: WechatMiniprogram.TouchEvent): void {
    const index = Number(event.currentTarget.dataset.index)
    const selected = this.data.searchResults[index]
    if (selected) this.selectFood(selected)
  },

  selectFood(food: FoodResult, candidateIndexOverride?: number, shouldScroll = true) {
    const candidateIndex = candidateIndexOverride === undefined ? this.data.pendingCandidateIndex : candidateIndexOverride
    const candidate = candidateIndex >= 0 ? this.data.result?.items?.[candidateIndex] : undefined
    const currentIndex = candidateIndex >= 0
      ? this.data.confirmedFoods.findIndex((item) => item.candidateIndex === candidateIndex)
      : -1
    const current = currentIndex >= 0 ? this.data.confirmedFoods[currentIndex] : undefined
    const selected = confirmedFoodSelection(food, candidate, candidateIndex, current)
    let confirmedFoods = currentIndex >= 0
      ? this.data.confirmedFoods.map((item, index) => index === currentIndex ? selected : item)
      : [...this.data.confirmedFoods, selected]
    confirmedFoods = applyRatioAmounts(initialRatios(confirmedFoods), this.data.mealTotalAmount || '200')
    const foods = this.data.foods.map((item) => item.index === candidateIndex ? { ...item, mappedName: food.canonicalNameZh } : item)
    this.setData({
      confirmedFoods, foods, query: '', pendingCandidateIndex: -1,
      scrollIntoView: shouldScroll ? 'confirm-section' : this.data.scrollIntoView,
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
    // 按名称记录的条目无营养事实，页内预览仅计算标准食品部分；保存后的报告由服务端正确计入分母。
    const items = this.data.confirmedFoods
      .map((item) => ({...(item.foodId?{foodId:item.foodId}:{}),observedName:item.observedName,matchStatus:item.unmatched?'UNMATCHED':'MATCHED',amount:item.consumedAmount.trim(),unit:'g'}))
    if (!items.length || items.some((item) => !/^\d+(?:\.\d{1,6})?$/.test(item.amount) || Number(item.amount) <= 0)) return null
    const calculation = await request<CalculationResult>('/nutrition/calculate', {
      method: 'POST', data: { mode:'RECORDED_ITEMS_V2',items, targetScopeVersion: 'core-13-v1' },
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
    if (this.data.busy || this.data.saving) return
    const mealId = wx.getStorageSync('foodmaster.trial.currentMealId') as string | undefined
    const foods = this.data.confirmedFoods
    if (!mealId) { wx.showToast({ title: '请从新增记录进入', icon: 'none' }); return }
    if (!foods.length) { wx.showToast({ title: '请至少确认一种标准食品', icon: 'none' }); return }
    if (!validNewWeight(this.data.mealTotalAmount)) {
      wx.showToast({ title: '请填写有效的大于0的总克数（最多1位小数）', icon: 'none' }); return
    }
    if (this.data.ratioTotal !== 100) {
      wx.showToast({ title: `食材占比合计需为100%，当前${this.data.ratioTotal}%`, icon: 'none' }); return
    }
    for (const food of foods) {
      const consumedAmount = food.consumedAmount.trim()
      const servedAmount = food.servedAmount.trim()
      if (!validNewWeight(consumedAmount)) {
        wx.showToast({ title: `请填写${food.canonicalNameZh}实际吃下克数`, icon: 'none' }); return
      }
      if (servedAmount && (!/^\d+(?:\.\d{1,6})?$/.test(servedAmount) || Number(servedAmount) <= 0)) {
        wx.showToast({ title: `${food.canonicalNameZh}原记录提供量须大于0`, icon: 'none' }); return
      }
    }
    const actualTotal=foods.reduce((sum,food)=>sum+(gramUnits(food.consumedAmount.trim()) || 0),0)
    if(!Number.isSafeInteger(actualTotal)){wx.showToast({title:'合计超出数字精度范围，请核对克数',icon:'none'});return}
    this.setData({busy:true,saving:true})
    try {
      const draft=await request<{subjectId:string;occurredAt:string;mealType:string;notes:string|null}>('/meals/'+mealId)
      const active=await(getApp<IAppOption>().globalData.ready||ensureSessionContext())
      if(active.subjectId!==draft.subjectId)throw Error('当前宝宝已切换，请返回记录页重新进入')
      const scope='meal-create:'+draft.subjectId,total=exactGrams(actualTotal)
      const body:Record<string,unknown>={mealType:draft.mealType,occurredAt:draft.occurredAt,notes:draft.notes,items:foods.map(food=>({observedName:food.observedName,consumedAmount:food.consumedAmount.trim(),source:food.source,weightOrigin:'USER_ACCEPTED_ESTIMATE',...(food.unmatched?{matchStatus:'UNMATCHED',matchReason:food.matchReason||'NO_MATCH_NO_NUTRITION'}:{matchStatus:'MATCHED',foodId:food.foodId,...(food.selectedFoodRevisionId?{selectedFoodRevisionId:food.selectedFoodRevisionId}:{})})}))}
      const previous=pendingRecord(scope)
      if(previous){
        const {operationId:_operationId,weightReview:_review,...oldBody}=previous.payload
        if(JSON.stringify(oldBody)!==JSON.stringify(body)){
          const accepted=await new Promise<boolean>(resolve=>wx.showModal({title:'先核对上次保存结果',content:'上次提交结果尚未确认。先核对原提交，当前填写的内容不会另存一餐。',confirmText:'核对上次',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));if(!accepted)return
        }
      }else if(actualTotal>300000000){
        const accepted=await new Promise<boolean>(resolve=>wx.showModal({title:'核对本餐总量',content:weightNotice(total)+'确认记录这个重量吗？',confirmText:'确认记录',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));if(!accepted)return
        body.weightReview={policyVersion:'MEAL_WEIGHT_REVIEW_V2',acknowledged:true,reviewedTotalGrams:total}
      }
      const saved=await submitRecord<{mealId:string;reportUpdate?:{status:string}}>(scope,'/subjects/'+draft.subjectId+'/meals/confirmed','POST','CREATE_CONFIRMED_MEAL',body)
      wx.setStorageSync('foodmaster.trial.reportUpdateState',saved.reportUpdate?.status||'UNKNOWN')
      abandonCurrentMeal();void discardAbandonedMeals()
      wx.setStorageSync('foodmaster.trial.mealSaved', true)
      wx.setStorageSync('foodmaster.trial.mealSavedAction', '本餐已保存')
      wx.setStorageSync('foodmaster.trial.reportNeedsRefresh', true)
      wx.removeStorageSync('foodmaster.trial.currentMealId')
      navigateRoot('/pages/records/records?saved=1')
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '保存失败'
      wx.showModal({ title: caught instanceof ApiError&&(caught.statusCode===0||caught.statusCode>=500)?'保存结果尚未确认':'保存失败',content:message+(caught instanceof ApiError&&(caught.statusCode===0||caught.statusCode>=500)?'。再次保存会核对原提交，不会重复新增。':''),showCancel:false })
    } finally {
      this.setData({ busy: false, saving: false })
      if (this.data.abandoned && wx.getStorageSync('foodmaster.trial.currentMealId')) {
        abandonCurrentMeal()
        void discardAbandonedMeals()
      }
    }
  },
})
