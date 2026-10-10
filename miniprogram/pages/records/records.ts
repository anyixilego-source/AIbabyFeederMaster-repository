import { openPage, navigateRoot ,ensureHomeParent} from '../../utils/navigation'
import { MEAL_EDIT_OCCUPANCY_ENABLED,reserveMealEdit,releaseMealEdit,editReason } from '../../utils/meal-edit-session'
import { SavedMeal,deleteSavedMeal,operationId } from '../../utils/meal-edit'
import { ApiError, request } from '../../utils/api'
import { ensureSessionContext, SessionContext } from '../../utils/session'

interface MealSummary {
  mealId: string
  mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'MILK_FEED' | 'OTHER'
  occurredAt: string
  status: 'DRAFT' | 'CONFIRMED' | 'VOID'
  notes: string | null
}
interface MealDetail extends MealSummary {
  items: Array<{ mealItemId: string; foodId?: string | null; observedName: string | null; servedAmount: string | null; consumedAmount: string | null; unit: string; status: string; weightOrigin?: string }>
}
interface DisplayMeal {
  mealId: string; type: string; time: string; dateLabel: string; title: string; name: string
  ingredients: string; foodCount: number; consumedTotal: string; tone: string
  items: Array<{ mealItemId: string; name: string; served: string | null; consumed: string; unit: string }>
}

const mealLabels: Record<MealSummary['mealType'], string> = {
  BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐', SNACK: '加餐', MILK_FEED: '奶餐', OTHER: '其他',
}

function unitLabel(unit: string): string {
  if (unit.toLowerCase() === 'g') return '克'
  if (unit.toLowerCase() === 'ml') return '毫升'
  return unit
}

function dateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}
function formatGrams(value: string | number | null): string {
  if (value === null || value === '') return '未填写'
  const grams = Number(value)
  if (!Number.isFinite(grams)) return '未填写'
  if (grams > 0 && grams < 0.1) return '<0.1'
  const rounded = Math.round(grams * 10) / 10
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)
}
function datesAround(selectedDate: string) {
  const selected = new Date(`${selectedDate}T00:00:00`)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(selected)
    date.setDate(selected.getDate() + index - 6)
    return { week: '日一二三四五六'[date.getDay()], day: date.getDate(), date: dateOnly(date), active: index === 6 }
  })
}
async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

Page({
  data: { reviewLabel:wx.getSystemInfoSync().platform==='devtools'?(wx.getStorageSync('foodmaster.reviewEnvironment')?.label || ''):'',
    recordsScrollTop:0,savedAction:'本餐已保存', deleting:false, editing:false, showCalendar:false, reportUpdateState: '', saved: false, loading: false, errorMessage: '', selectedDate: dateOnly(new Date()), selectedDateLabel: '', todayDate: dateOnly(new Date()),
    dates: datesAround(dateOnly(new Date())),
    meals: [] as DisplayMeal[], selectedMeal: null as DisplayMeal | null,
    confirmedCount: 0, consumedTotal: '0',
  },

  onLoad(query: Record<string, string>) {
    if(query.date)this.setData({selectedDate:query.date})
    if (query.saved === '1' || wx.getStorageSync('mealSaved')) this.setData({ saved: true })
  },
  onShow() {
    if(ensureHomeParent(this))return
    this.setData({ savedAction:String(wx.getStorageSync('foodmaster.mealSavedAction') || '本餐已保存'), reportUpdateState: String(wx.getStorageSync('foodmaster.reportUpdateState') || ''), saved: this.data.saved || Boolean(wx.getStorageSync('mealSaved')) })
    const scrollTop=this._scrollTop
    void this.loadMeals().finally(()=>this.setData({recordsScrollTop:scrollTop}))
  },

  _scrollTop:0,
  onRecordsScroll(e:WechatMiniprogram.CustomEvent<{scrollTop:number}>){if(!this.data.loading)this._scrollTop=e.detail.scrollTop},
  _details:new Map<string,SavedMeal>(),_deletePending:null as {mealId:string;operationId:string;expectedRevision:string}|null, _loadSequence:0,
  async loadMeals() {
    const sequence=++this._loadSequence,selectedKey=this.data.selectedDate
    this.setData({ loading: true, errorMessage: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const from=new Date(selectedKey+'T00:00:00'),before=new Date(from);before.setDate(before.getDate()+1)
      let details:MealDetail[]
      try{details=await request<MealDetail[]>(`/subjects/${active.subjectId}/meal-records?from=${encodeURIComponent(from.toISOString())}&before=${encodeURIComponent(before.toISOString())}`)}
      catch(e){if(!(e instanceof ApiError)||e.statusCode!==404)throw e;const summaries=await request<MealSummary[]>(`/subjects/${active.subjectId}/meals`),selected=summaries.filter(meal=>meal.status==='CONFIRMED'&&dateOnly(new Date(meal.occurredAt))===selectedKey);details=[];for(let i=0;i<selected.length;i+=4)details.push(...await Promise.all(selected.slice(i,i+4).map(meal=>request<MealDetail>(`/meals/${meal.mealId}`))))}
      if(sequence!==this._loadSequence)return
      this._details=new Map((details as unknown as SavedMeal[]).map(d=>[d.mealId,d]))
      let consumedTotal = 0
      let hasEstimated = false
      const meals = details.map((meal) => {
        const confirmed = meal.items.filter((item) => item.status === 'CONFIRMED')
        const mealConsumed = confirmed.reduce((sum, item) => sum + (item.unit.toLowerCase() === 'g' ? Number(item.consumedAmount || 0) : 0), 0)
        consumedTotal += mealConsumed
        const estimated = confirmed.some(item=>item.weightOrigin==='USER_ACCEPTED_ESTIMATE')
        hasEstimated = hasEstimated || estimated
        const occurredAt = new Date(meal.occurredAt)
        const time = `${occurredAt.getHours().toString().padStart(2, '0')}:${occurredAt.getMinutes().toString().padStart(2, '0')}`
        const name = meal.notes || `${mealLabels[meal.mealType]}记录`
        return {
          mealId: meal.mealId, type: mealLabels[meal.mealType],
          time, dateLabel: `${occurredAt.getFullYear()}年${occurredAt.getMonth() + 1}月${occurredAt.getDate()}日`,
          title: `${time} · ${name}`, name,
          ingredients: confirmed.map((item) => item.observedName || '已确认食品').join('、') || '暂无已确认食物',
          foodCount: new Set(confirmed.map(item => item.foodId ? 'food:' + item.foodId : 'item:' + item.mealItemId)).size, consumedTotal: (estimated?'约':'')+formatGrams(mealConsumed),
          tone: meal.mealType === 'DINNER' ? 'night' : meal.mealType === 'SNACK' ? 'snack' : 'day',
          items: confirmed.map((item) => ({
            mealItemId: item.mealItemId, name: item.observedName || '已确认食品',
            served: item.servedAmount ? formatGrams(item.servedAmount) : null,
            consumed: (item.weightOrigin==='USER_ACCEPTED_ESTIMATE'?'约':'')+formatGrams(item.consumedAmount), unit: unitLabel(item.unit),
          })),
        }
      })
      const selectedDate = new Date(`${this.data.selectedDate}T00:00:00`)
      this.setData({
        selectedDateLabel: `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`, meals,
        confirmedCount: details.length,
        consumedTotal: (hasEstimated?'约':'')+formatGrams(consumedTotal),
      })
    } catch (caught) {
      if(sequence!==this._loadSequence)return
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '记录加载失败'
      this.setData({ errorMessage: message, meals: [], confirmedCount: 0, consumedTotal: '0' })
      wx.showToast({ title: message, icon: 'none' })
    } finally { if(sequence===this._loadSequence)this.setData({ loading: false }) }
  },

  openCalendar(){this.setData({showCalendar:true})},
  closeCalendar(){this.setData({showCalendar:false})},
  goBack() { navigateRoot('/pages/index/index') },
  openReport() { if(!this.data.loading&&!this.data.errorMessage&&this.data.meals.length)openPage('/pages/report/report?date='+encodeURIComponent(this.data.selectedDate)+'&fromRecords=1') },
  async addMeal() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      openPage('/pages/camera/camera')
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '创建餐食失败'
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },
  chooseDate(event: WechatMiniprogram.TouchEvent) {
    const selectedDate = String(event.currentTarget.dataset.date)
    this.setData({ selectedDate, dates: this.data.dates.map((item) => ({ ...item, active: item.date === selectedDate })) })
    void this.loadMeals()
  },
  changeDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const selectedDate = event.detail.value
    this.setData({ selectedDate, dates: datesAround(selectedDate) })
    void this.loadMeals()
  },
  retryLoad() { void this.loadMeals() },
  openMeal(event: WechatMiniprogram.TouchEvent) {
    const mealId = String(event.currentTarget.dataset.mealId)
    this.setData({ selectedMeal: this.data.meals.find((meal) => meal.mealId === mealId) || null })
  },
  async editSelectedMeal(){if(this.data.deleting||this.data.editing||!this.data.selectedMeal)return;const id=this.data.selectedMeal.mealId;this.setData({editing:true});let lease;try{if(MEAL_EDIT_OCCUPANCY_ENABLED)lease=await reserveMealEdit(id);await new Promise<void>((resolve,reject)=>openPage('/pages/meal-edit/meal-edit?mealId='+id,{success:()=>{this.setData({selectedMeal:null});resolve()},fail:reject}))}catch(e){if(MEAL_EDIT_OCCUPANCY_ENABLED&&lease)void releaseMealEdit(id,lease).catch(()=>{});wx.showModal({title:editReason(e)==='MEAL_EDIT_BUSY'?'这餐正在编辑':'暂时不能编辑',content:e instanceof Error?e.message:'请稍后重试',showCancel:false})}finally{this.setData({editing:false})}},
  prepareSavedReturn(selectedDate:string){this._loadSequence++;this._details.clear();this._deletePending=null;this.setData({selectedDate,dates:datesAround(selectedDate),selectedMeal:null,meals:[],confirmedCount:0,consumedTotal:'0',loading:true,errorMessage:''})},
  async deleteSelectedMeal(){if(this.data.deleting||this.data.editing||!this.data.selectedMeal)return;const meal=this._details.get(this.data.selectedMeal.mealId);if(!meal)return;if(this._deletePending?.mealId!==meal.mealId||this._deletePending.expectedRevision!==meal.revisionToken)this._deletePending={mealId:meal.mealId,operationId:operationId(),expectedRevision:meal.revisionToken};this.setData({deleting:true});try{if(await deleteSavedMeal(meal,this._deletePending)){this.setData({selectedMeal:null,saved:true,savedAction:'这餐已删除',reportUpdateState:String(wx.getStorageSync('foodmaster.reportUpdateState'))});await this.loadMeals()}}catch(e){const conflict=e instanceof ApiError&&e.statusCode===409,occupied=editReason(e)==='MEAL_EDIT_BUSY';wx.showModal({title:occupied?'这餐正在编辑':conflict?'这餐已有新修改':'尚未删除',content:occupied?(e instanceof Error?e.message:'这餐正在其他设备编辑，请稍后再试。'):conflict?'尚未删除最新记录，请重新打开核对。':e instanceof Error?e.message:'请重试',showCancel:false});if(conflict&&!occupied){this.setData({selectedMeal:null});await this.loadMeals()}}finally{this.setData({deleting:false})}},
  closeMeal() {if(this.data.deleting)return; this.setData({ selectedMeal: null }) },
  noop() {},
  closeSaved() { this.setData({ saved: false }); wx.removeStorageSync('mealSaved') },
})
