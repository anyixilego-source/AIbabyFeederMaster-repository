import { openPage, navigateRoot ,ensureHomeParent} from '../../utils/navigation'
import { MEAL_EDIT_OCCUPANCY_ENABLED,reserveMealEdit,releaseMealEdit,editReason } from '../../utils/meal-edit-session'
import { SavedMeal,deleteSavedMeal,operationId } from '../../utils/meal-edit'
import {pendingRecord,submitRecord} from '../../utils/record-submit'
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

// 第一批方案 §7.4/§7.6：紧凑奶量卡片——已知奶量+次数、未知事件另写、不显示 0ml 冒充已知。
interface MilkRow {
  milkRecordId: string
  occurredAt: string
  milkType: 'FORMULA' | 'LIQUID_MILK' | 'EXPRESSED_BREAST_MILK' | 'DIRECT_BREASTFEEDING'
  quantityMode: 'KNOWN_VOLUME' | 'EVENT_ONLY'
  volumeMl: string | null
  volumeOrigin: string
  revisionToken: string
  revision: number
}
interface MilkSummary {
  feedCount: number
  knownVolumeMl: string | null
  unknownVolumeEventCount: number
  estimatedVolumeRecordCount: number
}
const milkTypeLabels: Array<{ key: MilkRow['milkType']; label: string }> = [
  { key: 'FORMULA', label: '配方奶' },
  { key: 'LIQUID_MILK', label: '液态奶' },
  { key: 'EXPRESSED_BREAST_MILK', label: '瓶喂母乳' },
  { key: 'DIRECT_BREASTFEEDING', label: '亲喂母乳' },
]
function formatMl(value: string | number | null): string {
  if (value === null || value === '') return ''
  const ml = Number(value)
  if (!Number.isFinite(ml)) return ''
  return ml % 1 === 0 ? ml.toFixed(0) : ml.toFixed(1)
}
function milkTypeLabel(key: string): string {
  return milkTypeLabels.find((item) => item.key === key)?.label ?? '奶类'
}

Page({
  data: { reviewLabel:wx.getSystemInfoSync().platform==='devtools'?(wx.getStorageSync('foodmaster.trial.reviewEnvironment')?.label || ''):'',
    pendingMealScope:'',pendingMealBusy:false,recordsScrollTop:0,savedAction:'本餐已保存', deleting:false, editing:false, showCalendar:false, reportUpdateState: '', saved: false, loading: false, errorMessage: '', selectedDate: dateOnly(new Date()), selectedDateLabel: '', todayDate: dateOnly(new Date()),
    dates: datesAround(dateOnly(new Date())),
    meals: [] as DisplayMeal[], selectedMeal: null as DisplayMeal | null,
    confirmedCount: 0, consumedTotal: '0',
    milkCount:0,milkTitle: '今日奶量', milkMain: '奶量未知', milkSub: '', milkHasRecords: false,
    milkItems: [] as Array<{ milkRecordId: string; time: string; typeLabel: string; volumeLabel: string }>,
    milkExpanded: false,milkCursor:'',milkHasMore:false,milkLoadingMore:false,
    milkTypes: milkTypeLabels,
    milkPanel: { visible: false, mode: 'create', recordId: '', revisionToken: '', recordDate: dateOnly(new Date()), time: '08:00', milkTypeIndex: 0, volume: '', about: false, retrying:false,subjectId:'',originalOccurredAt:'',volumeTouched:false,originTouched:false,saving: false, deleting: false, operationId: '' },
  },

  onLoad(query: Record<string, string>) {
    if(query.date)this.setData({selectedDate:query.date})
    if (query.saved === '1' || wx.getStorageSync('foodmaster.trial.mealSaved')) this.setData({ saved: true })
  },
  onShow() {
    if(ensureHomeParent(this))return
    this.setData({ savedAction:String(wx.getStorageSync('foodmaster.trial.mealSavedAction') || '本餐已保存'), reportUpdateState: String(wx.getStorageSync('foodmaster.trial.reportUpdateState') || ''), saved: this.data.saved || Boolean(wx.getStorageSync('foodmaster.trial.mealSaved')) })
    const scrollTop=this._scrollTop
    void this.loadMeals().finally(()=>this.setData({recordsScrollTop:scrollTop}))
  },

  _scrollTop:0,
  onRecordsScroll(e:WechatMiniprogram.CustomEvent<{scrollTop:number}>){if(!this.data.loading)this._scrollTop=e.detail.scrollTop},
  _details:new Map<string,SavedMeal>(),_deletePending:null as {mealId:string;operationId:string;expectedRevision:string}|null, _loadSequence:0,
  _milkSequence:0,_milkRecords:[] as MilkRow[],_milkSubject:'',_milkDate:'',
  async loadMeals() {
    const sequence=++this._loadSequence,selectedKey=this.data.selectedDate
    this.setData({ loading: true, errorMessage: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const pendingScope='meal-create:'+active.subjectId;this.setData({pendingMealScope:pendingRecord(pendingScope)?pendingScope:''})
      const from=new Date(selectedKey+'T00:00:00'),before=new Date(from);before.setDate(before.getDate()+1)
      let details:MealDetail[]
      try{details=await request<MealDetail[]>(`/subjects/${active.subjectId}/meal-records?from=${encodeURIComponent(from.toISOString())}&before=${encodeURIComponent(before.toISOString())}`)}
      catch(e){if(!(e instanceof ApiError)||e.statusCode!==404)throw e;const summaries=await request<MealSummary[]>(`/subjects/${active.subjectId}/meals`),selected=summaries.filter(meal=>meal.status==='CONFIRMED'&&dateOnly(new Date(meal.occurredAt))===selectedKey);details=[];for(let i=0;i<selected.length;i+=4)details.push(...await Promise.all(selected.slice(i,i+4).map(meal=>request<MealDetail>(`/meals/${meal.mealId}`))))}
      if(sequence!==this._loadSequence)return
      this._details=new Map((details as unknown as SavedMeal[]).map(d=>[d.mealId,d]))
      let consumedTotal = 0
      const meals = details.map((meal) => {
        const confirmed = meal.items.filter((item) => item.status === 'CONFIRMED')
        const mealConsumed = confirmed.reduce((sum, item) => sum + (item.unit.toLowerCase() === 'g' ? Number(item.consumedAmount || 0) : 0), 0)
        consumedTotal += mealConsumed
        const estimated = confirmed.some(item=>item.weightOrigin==='USER_ACCEPTED_ESTIMATE')
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
        consumedTotal: formatGrams(consumedTotal),
      })
      await this.loadMilk()
    } catch (caught) {
      if(sequence!==this._loadSequence)return
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '记录加载失败'
      this.setData({ errorMessage: message, meals: [], confirmedCount: 0, consumedTotal: '0' })
      wx.showToast({ title: message, icon: 'none' })
    } finally { if(sequence===this._loadSequence)this.setData({ loading: false }) }
  },

  async loadMilk(more=false) {
    if(more&&(this.data.milkLoadingMore||!this.data.milkHasMore))return
    const sequence = more?this._milkSequence:++this._milkSequence,date=this.data.selectedDate
    if(!more&&this._milkDate!==date){this._milkRecords=[];this.setData({milkItems:[],milkHasRecords:false,milkCount:0,milkMain:'奶量未知',milkSub:'',milkCursor:'',milkHasMore:false,milkExpanded:false})}
    this.setData({milkLoadingMore:more})
    try {
      const active = await context()
      if (!active.subjectId) return
      const page = await request<{ summary: MilkSummary; items: MilkRow[]; nextCursor:string|null;hasMore:boolean }>(`/subjects/${active.subjectId}/milk-records?date=${encodeURIComponent(date)}&limit=15${more?'&cursor='+encodeURIComponent(this.data.milkCursor):''}`)
      if (sequence !== this._milkSequence||date!==this.data.selectedDate) return
      this._milkDate=date;this._milkSubject=active.subjectId
      const { summary, items } = page
      const seen=new Set(more?this._milkRecords.map(r=>r.milkRecordId):[])
      this._milkRecords = more?[...this._milkRecords,...items.filter(r=>!seen.has(r.milkRecordId))]:items
      let main = '奶量未知'
      let sub = ''
      if (summary.knownVolumeMl !== null) {
        main = `${formatMl(summary.knownVolumeMl)}毫升 · ${summary.feedCount}次`
        if (summary.unknownVolumeEventCount > 0) sub = `含${summary.unknownVolumeEventCount}次未记录奶量`
      } else if (summary.feedCount > 0) {
        main = `含${summary.feedCount}次未记录奶量`
      }
      this.setData({
        milkTitle: this.data.selectedDate === this.data.todayDate ? '今日奶量' : '当日奶量',
        milkMain: main, milkSub: sub, milkHasRecords: summary.feedCount > 0,milkCount:summary.feedCount,
        milkCursor:page.nextCursor||'',milkHasMore:page.hasMore,milkLoadingMore:false,
        milkItems: this._milkRecords.map((row) => {
          const at = new Date(row.occurredAt)
          const time = `${at.getHours().toString().padStart(2, '0')}:${at.getMinutes().toString().padStart(2, '0')}`
          const volumeLabel = row.quantityMode === 'EVENT_ONLY' ? '奶量未知' : `${formatMl(row.volumeMl)}毫升`
          return { milkRecordId: row.milkRecordId, time, typeLabel: milkTypeLabel(row.milkType), volumeLabel }
        }),
      })
    } catch (caught) {
      if (sequence !== this._milkSequence) return
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '奶量读取失败'
      wx.showToast({ title: message, icon: 'none' })
    }finally{if(sequence===this._milkSequence)this.setData({milkLoadingMore:false})}
  },
  async resolvePendingMeal(){if(this.data.pendingMealBusy||!this.data.pendingMealScope)return;const scope=this.data.pendingMealScope,previous=pendingRecord(scope);if(!previous){this.setData({pendingMealScope:''});return}this.setData({pendingMealBusy:true});try{const saved=await submitRecord<{reportUpdate?:{status?:string}}>(scope,previous.path,previous.method,previous.kind,previous.payload);this.setData({pendingMealScope:'',saved:true,savedAction:'上次餐食保存已核对',reportUpdateState:saved.reportUpdate?.status||'UNKNOWN'});await this.loadMeals()}catch(e){wx.showToast({title:e instanceof Error?e.message:'结果尚未确认，请稍后再试',icon:'none'})}finally{this.setData({pendingMealBusy:false})}},
  loadMoreMilk(){void this.loadMilk(true)},
  toggleMilkExpand() { this.setData({ milkExpanded: !this.data.milkExpanded }) },
  collapseMilk(){this.setData({milkExpanded:false,recordsScrollTop:this._scrollTop},()=>{this.setData({recordsScrollTop:0});this._scrollTop=0})},
  async openMilkCreate() {
    if (this.data.loading) return
    const now = new Date()
    const time = this.data.selectedDate === this.data.todayDate
      ? `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      : '08:00'
    const active=await context();const previous=pendingRecord('milk-create:'+active.subjectId)
    this.setData({ milkPanel: { visible: true, mode: 'create', recordId: '', revisionToken: '', recordDate: this.data.selectedDate, time, milkTypeIndex: 0, volume: '', about: false, retrying:false,subjectId:'',originalOccurredAt:'',volumeTouched:false,originTouched:false,saving: false, deleting: false, operationId: operationId() } })
    this.setData({'milkPanel.subjectId':active.subjectId})
    if(previous)this.restoreMilkSubmission(previous.payload)
  },
  restoreMilkSubmission(body:Record<string,unknown>){const at=new Date(String(body.occurredAt));this.setData({'milkPanel.retrying':true,'milkPanel.recordDate':String(body.recordDate||dateOnly(at)),'milkPanel.time':String(at.getHours()).padStart(2,'0')+':'+String(at.getMinutes()).padStart(2,'0'),'milkPanel.volume':body.volumeMl===null||body.volumeMl===undefined?'':String(body.volumeMl),'milkPanel.milkTypeIndex':milkTypeLabels.findIndex(t=>t.key===body.milkType),'milkPanel.about':body.volumeOrigin==='USER_ACCEPTED_ESTIMATE'});wx.showToast({title:'上次提交待核对，重试将核对原提交',icon:'none'})},
  openMilkEdit(event: WechatMiniprogram.TouchEvent) {
    const recordId = String(event.currentTarget.dataset.id)
    const row = this._milkRecords.find((item) => item.milkRecordId === recordId)
    if (!row) return
    const at = new Date(row.occurredAt)
    const time = `${at.getHours().toString().padStart(2, '0')}:${at.getMinutes().toString().padStart(2, '0')}`
    const index = milkTypeLabels.findIndex((item) => item.key === row.milkType)
    this.setData({ milkPanel: { visible: true, mode: 'edit', recordId, revisionToken: row.revisionToken, recordDate: this.data.selectedDate, time, milkTypeIndex: index < 0 ? 0 : index, volume: row.volumeMl === null ? '' : formatMl(row.volumeMl), about: row.volumeOrigin === 'USER_ACCEPTED_ESTIMATE', retrying:false,subjectId:'',originalOccurredAt:'',volumeTouched:false,originTouched:false,saving: false, deleting: false, operationId: operationId() } })
    this.setData({'milkPanel.subjectId':this._milkSubject,'milkPanel.originalOccurredAt':row.occurredAt})
    const previous=pendingRecord('milk-update:'+recordId);if(previous)this.restoreMilkSubmission(previous.payload)
  },
  closeMilkPanel() { if (this.data.milkPanel.saving||this.data.milkPanel.deleting) return; this.setData({ 'milkPanel.visible': false }) },
  setMilkType(event: WechatMiniprogram.TouchEvent) { if(this.data.milkPanel.retrying)return;this.setData({ 'milkPanel.milkTypeIndex': Number(event.currentTarget.dataset.index) }) },
  milkTimeChange(event: WechatMiniprogram.PickerChange) { if(this.data.milkPanel.retrying)return;this.setData({ 'milkPanel.time': String(event.detail.value) }) },
  milkVolumeInput(event: WechatMiniprogram.Input) { if(this.data.milkPanel.retrying)return;this.setData({ 'milkPanel.volume': event.detail.value,'milkPanel.volumeTouched':true }) },
  async saveMilkRecord() {
    const panel = this.data.milkPanel
    if (panel.saving) return
    const milkType = milkTypeLabels[panel.milkTypeIndex]!.key
    const volume = panel.volume.trim()
    const isDirect = milkType === 'DIRECT_BREASTFEEDING'
    if (!isDirect && !volume) { wx.showToast({ title: '请填写实际喝下的奶量（毫升）', icon: 'none' }); return }
    if (volume && (!/^\d+(\.\d)?$/.test(volume)||Number(volume)<=0)) { wx.showToast({ title: '奶量只支持整数或1位小数（毫升）', icon: 'none' }); return }
    if (!/^\d{2}:\d{2}$/.test(panel.time)) { wx.showToast({ title: '请选择时间', icon: 'none' }); return }
    const oldTime=panel.originalOccurredAt?new Date(panel.originalOccurredAt):null
    const oldClock=oldTime?String(oldTime.getHours()).padStart(2,'0')+':'+String(oldTime.getMinutes()).padStart(2,'0'):''
    const occurredAt = oldTime&&dateOnly(oldTime)===panel.recordDate&&oldClock===panel.time?panel.originalOccurredAt:`${panel.recordDate}T${panel.time}:00+08:00`
    const body: Record<string, unknown> = {
      occurredAt, recordDate: panel.recordDate, milkType,
      quantityMode:isDirect&&!volume?'EVENT_ONLY':'KNOWN_VOLUME',...(panel.mode==='create'||panel.volumeTouched||isDirect&&!volume?{volumeMl:isDirect&&!volume?null:volume}:{}),...(isDirect&&!volume?{volumeOrigin:'UNKNOWN_METHOD'}:panel.mode==='create'||panel.volumeTouched||panel.originTouched?{volumeOrigin:panel.about?'USER_ACCEPTED_ESTIMATE':'UNKNOWN_METHOD'}:{}),
    }
    this.setData({ 'milkPanel.saving': true })
    try {
      const current=await context();if(current.subjectId!==panel.subjectId)throw Error('宝宝已切换，请重新进入记录页')
      if (panel.mode === 'create') {
        const active = await context()
        var response = await submitRecord<{reportUpdate?:{status?:string}}>('milk-create:'+active.subjectId,`/subjects/${active.subjectId}/milk-records`,'POST','CREATE_MILK_RECORD',body)
      } else {
        var response = await submitRecord<{reportUpdate?:{status?:string}}>('milk-update:'+panel.recordId,`/milk-records/${panel.recordId}`,'PATCH','UPDATE_MILK_RECORD',{expectedRevision:panel.revisionToken,...body})
      }
      this.setData({ 'milkPanel.visible': false, saved: true, savedAction: panel.mode === 'create' ? '奶量已记录' : '奶量已修改', reportUpdateState: String(response.reportUpdate?.status || '') })
      await this.loadMilk()
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '奶量保存失败'
      wx.showToast({ title: message, icon: 'none' })
      if (caught instanceof ApiError && caught.statusCode === 409) { this.setData({ 'milkPanel.visible': false }); await this.loadMilk() }
    } finally { this.setData({ 'milkPanel.saving': false }) }
  },
  async deleteMilkRecord() {
    const panel = this.data.milkPanel
    if (panel.mode !== 'edit' || panel.deleting) return
    const confirmed = await new Promise<boolean>((resolve) => wx.showModal({ title: '删除这条奶量记录', content: '删除后这条记录不再出现在汇总与明细中。', success: (result) => resolve(!!result.confirm), fail: () => resolve(false) }))
    if (!confirmed) return
    this.setData({ 'milkPanel.deleting': true })
    try {
      const response = await submitRecord<{reportUpdate?:{status?:string}}>('milk-delete:'+panel.recordId,`/milk-records/${panel.recordId}`,'DELETE','VOID_MILK_RECORD',{expectedRevision:panel.revisionToken})
      this.setData({ 'milkPanel.visible': false, saved: true, savedAction: '奶量已删除', reportUpdateState: String(response.reportUpdate?.status || '') })
      await this.loadMilk()
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '删除失败'
      wx.showToast({ title: message, icon: 'none' })
      if (caught instanceof ApiError && caught.statusCode === 409) { this.setData({ 'milkPanel.visible': false }); await this.loadMilk() }
    } finally { this.setData({ 'milkPanel.deleting': false }) }
  },
  openCalendar(){this.setData({showCalendar:true})},
  closeCalendar(){this.setData({showCalendar:false})},
  goBack() { navigateRoot('/pages/index/index') },
  openReport() { if(!this.data.loading&&!this.data.errorMessage&&(this.data.meals.length||this.data.milkHasRecords))openPage('/pages/report/report?date='+encodeURIComponent(this.data.selectedDate)+'&fromRecords=1') },
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
  goCreateProfile() { wx.switchTab({ url: '/pages/profile/profile' }) },
  openMeal(event: WechatMiniprogram.TouchEvent) {
    const mealId = String(event.currentTarget.dataset.mealId)
    this.setData({ selectedMeal: this.data.meals.find((meal) => meal.mealId === mealId) || null })
  },
  async editSelectedMeal(){if(this.data.deleting||this.data.editing||!this.data.selectedMeal)return;const id=this.data.selectedMeal.mealId;this.setData({editing:true});let lease;try{if(MEAL_EDIT_OCCUPANCY_ENABLED)lease=await reserveMealEdit(id);await new Promise<void>((resolve,reject)=>openPage('/pages/meal-edit/meal-edit?mealId='+id,{success:()=>{this.setData({selectedMeal:null});resolve()},fail:reject}))}catch(e){if(MEAL_EDIT_OCCUPANCY_ENABLED&&lease)void releaseMealEdit(id,lease).catch(()=>{});wx.showModal({title:editReason(e)==='MEAL_EDIT_BUSY'?'这餐正在编辑':'暂时不能编辑',content:e instanceof Error?e.message:'请稍后重试',showCancel:false})}finally{this.setData({editing:false})}},
  prepareSavedReturn(selectedDate:string){this._loadSequence++;this._details.clear();this._deletePending=null;this.setData({selectedDate,dates:datesAround(selectedDate),selectedMeal:null,meals:[],confirmedCount:0,consumedTotal:'0',loading:true,errorMessage:''})},
  async deleteSelectedMeal(){if(this.data.deleting||this.data.editing||!this.data.selectedMeal)return;const meal=this._details.get(this.data.selectedMeal.mealId);if(!meal)return;if(this._deletePending?.mealId!==meal.mealId||this._deletePending.expectedRevision!==meal.revisionToken)this._deletePending={mealId:meal.mealId,operationId:operationId(),expectedRevision:meal.revisionToken};this.setData({deleting:true});try{if(await deleteSavedMeal(meal,this._deletePending)){this.setData({selectedMeal:null,saved:true,savedAction:'这餐已删除',reportUpdateState:String(wx.getStorageSync('foodmaster.trial.reportUpdateState'))});await this.loadMeals()}}catch(e){const conflict=e instanceof ApiError&&e.statusCode===409,occupied=editReason(e)==='MEAL_EDIT_BUSY';wx.showModal({title:occupied?'这餐正在编辑':conflict?'这餐已有新修改':'尚未删除',content:occupied?(e instanceof Error?e.message:'这餐正在其他设备编辑，请稍后再试。'):conflict?'尚未删除最新记录，请重新打开核对。':e instanceof Error?e.message:'请重试',showCancel:false});if(conflict&&!occupied){this.setData({selectedMeal:null});await this.loadMeals()}}finally{this.setData({deleting:false})}},
  closeMeal() {if(this.data.deleting)return; this.setData({ selectedMeal: null }) },
  noop() {},
  closeSaved() { this.setData({ saved: false }); wx.removeStorageSync('foodmaster.trial.mealSaved') },
})
