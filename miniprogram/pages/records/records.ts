import {recognizeMilkLabel,labelConsentKey,labelForm} from '../../utils/milk-label'
import {checkFamilyContext} from '../../utils/family-sync'
import {canRecordBaby,familyState} from '../../utils/family-state'
import {sharedMealPhoto,retrySharedMealPhotos} from '../../utils/shared-meal-photo'
import { displayInteger, integerInput } from '../../utils/quantity-format'
import {readMilkEntryDefaults,rememberMilkEntry,milkEntryOwner} from '../../utils/milk-entry-defaults'
import { savedMealName, recordFoodName } from '../../utils/meal-presentation'
import { openPage, navigateRoot ,ensureHomeParent,backPage} from '../../utils/navigation'
import { MEAL_EDIT_OCCUPANCY_ENABLED,reserveMealEdit,releaseMealEdit,editReason } from '../../utils/meal-edit-session'
import { SavedMeal,deleteSavedMeal,operationId } from '../../utils/meal-edit'
import {pendingRecord,submitRecord} from '../../utils/record-submit'
import { ApiError, request } from '../../utils/api'
import {mealPhotoPath} from '../../utils/meal-photo'
import { ensureSessionContext, SessionContext } from '../../utils/session'

interface MealSummary {
  mealId: string
  mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'MILK_FEED' | 'OTHER'
  occurredAt: string
  status: 'DRAFT' | 'CONFIRMED' | 'VOID'
  recordedBy?:string;modifiedBy?:string
  displayName?:string|null;nameState?:string|null
  notes: string | null
}
interface MealDetail extends MealSummary {
  items: Array<{ mealItemId: string; foodId?: string | null; canonicalNameZh?:string|null;matchStatus?:string; observedName: string | null; servedAmount: string | null; consumedAmount: string | null; unit: string; status: string; source?: string; weightOrigin?: string }>
}
interface DisplayMeal {
  mealId: string; type: string; time: string; dateLabel: string; title: string; name: string
  recordedBy:string;modifiedBy:string;ingredients: string; foodCount: number; consumedTotal: string; tone: string; photoPath: string; recordLabel: string
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
  return displayInteger(grams)
}
function datesAround(selectedDate: string) {
  const selected = new Date(`${selectedDate}T00:00:00`)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(selected)
    date.setDate(selected.getDate() + index - 6)
    return { week: '日一二三四五六'[date.getDay()], day: date.getDate(), date: dateOnly(date), active: index === 6, recorded:null as boolean|null }
  })
}
async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

// 第一批方案 §7.4/§7.6：紧凑奶量卡片——已知奶量+次数、未知事件另写、不显示 0ml 冒充已知。
interface MilkRow {
  nutritionProfileRevisionId?:string|null;linkedMealItemId?:string|null;
  recordedBy?:string;modifiedBy?:string
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
  return displayInteger(ml)
}
function milkTypeLabel(key: string): string {
  return milkTypeLabels.find((item) => item.key === key)?.label ?? '奶类'
}

Page({
  data: { canRecord:true,reviewLabel:wx.getSystemInfoSync().platform==='devtools'?(wx.getStorageSync('foodmaster.reviewEnvironment')?.label || ''):'',
    pendingMealScope:'',pendingMealBusy:false,recordsScrollTop:0,savedAction:'本餐已保存', deleting:false, editing:false, showCalendar:false, reportUpdateState: '', saved: false, loading: false, errorMessage: '', selectedDate: dateOnly(new Date()), selectedDateLabel: '', todayDate: dateOnly(new Date()),
    dates: datesAround(dateOnly(new Date())),
    meals: [] as DisplayMeal[], selectedMeal: null as DisplayMeal | null,
    confirmedCount: 0, consumedTotal: '0',
    milkLinkedChoice:'UNCHANGED',milkLinkIndex:0,milkLinkOptions:[] as Array<{id:string;label:string}>,milkLinkLabels:[] as string[],milkReferenceChoice:'AUTO',milkReferenceLabel:'未设置',milkReferenceExisting:'',
    milkNutrition:{visible:false,manual:false,loading:false,firstUse:false,canRemember:true,saving:false,error:'',options:[] as Array<{revisionId:string;profileId:string;revision:number;canSetDefault?:boolean;profile:{name:string}}>,defaultRevision:0,makeDefault:true,name:'',source:'用户核对产品营养成分表',energyUnitIndex:0,energyUnitLabels:['千焦（kJ）','千卡（kcal）'],basisIndex:0,basisLabels:['每100毫升冲调后奶液','每100克干粉','请核对营养基准'],ageFrom:'6',ageTo:'72',powderGrams:'',preparedVolumeMl:'',choIndex:0,choLabels:['口径待确认','总碳水（含膳食纤维）','可利用碳水（不含膳食纤维）'],aIndex:0,aLabels:['口径待确认','RAE','RE'],folateIndex:0,folateLabels:['口径待确认','DFE','天然叶酸','合成叶酸'],fields:[] as Array<{code:string;name:string;unit:string;unitCode:string;value:string;originalStatus?:string;touched?:boolean;labelRawText?:string}>},
    milkAmount: '', milkHasKnownVolume: false, milkPreview: '',
    milkCount:0,milkTitle: '今日奶量', milkMain: '奶量未知', milkSub: '', milkHasRecords: false,
    milkItems: [] as Array<{ milkRecordId: string; time: string; typeLabel: string; volumeLabel: string;recordedBy?:string;modifiedBy?:string }>,
    milkExpanded: false,milkCursor:'',milkHasMore:false,milkLoadingMore:false,
    milkTypes: milkTypeLabels,
    milkLabelBusy:false,milkLabelError:'',milkLabelNote:'',milkLabelMatches:[] as Array<{revisionId:string;name:string}>,
    milkPanel: { visible: false, mode: 'create', recordId: '', revisionToken: '', recordDate: dateOnly(new Date()), time: '08:00', milkTypeIndex: 0, volume: '', unknownVolume:false,errorMessage:'', about: false, retrying:false,subjectId:'',originalOccurredAt:'',volumeTouched:false,originTouched:false,saving: false, deleting: false, operationId: '' },
  },

  _milkEntryId:'',_milkEntrySubject:'',_milkEntrySequence:0,_milkEntryAlive:true,
  onLoad(query: Record<string, string>) {
    if(query.fromMilkTrend==='1'&&query.milkRecordId&&query.subjectId){this._milkEntryId=query.milkRecordId;this._milkEntrySubject=query.subjectId;return}
    if(query.date)this.setData({selectedDate:query.date})
    if (query.saved === '1' || wx.getStorageSync('foodmaster.mealSaved')) this.setData({ saved: true })
  },
  onShow() {this._nameChecks=0;
    void checkFamilyContext()
    this._markersAlive=true
    this._milkEntryAlive=true
    if(this._milkEntryId){void this.loadMilkEntry();return}
    if(ensureHomeParent(this))return
    this.setData({ savedAction:String(wx.getStorageSync('foodmaster.mealSavedAction') || '本餐已保存'), reportUpdateState: String(wx.getStorageSync('foodmaster.reportUpdateState') || ''), saved: this.data.saved || Boolean(wx.getStorageSync('foodmaster.mealSaved')) })
    const scrollTop=this._scrollTop
    void this.loadMeals().finally(()=>this.setData({recordsScrollTop:scrollTop}))
  },

  onHide(){++this._milkLabelSequence;this.setData({milkLabelBusy:false});++this._milkReferenceAttempt;this._milkReferenceResumeAfterChoice=false;++this._milkNutritionSequence;if(this._nameTimer)clearTimeout(this._nameTimer);this._nameTimer=null;this._markersAlive=false;++this._markerSequence;if(this._milkEntryId)++this._milkEntrySequence},
  onUnload(){++this._milkLabelSequence;++this._milkReferenceAttempt;this._milkReferenceResumeAfterChoice=false;++this._milkNutritionSequence;if(this._nameTimer)clearTimeout(this._nameTimer);this._nameTimer=null;this._markersAlive=false;++this._markerSequence;this._milkEntryAlive=false;++this._milkEntrySequence},
  async loadMilkEntry(){
    const seq=++this._milkEntrySequence,id=this._milkEntryId;this.setData({loading:true,errorMessage:''});
    try{const active=await context();if(active.current?.canRecord===false)throw Error('当前为仅查看权限，请在奶量列表中查看记录');if(active.subjectId!==this._milkEntrySubject)throw Error('宝宝已切换，请返回后重新打开');
      const row=await request<MilkRow&{recordId:string;recordDate:string;subjectId:string;recordSaved:boolean}>('/milk-records/'+encodeURIComponent(id));
      if(seq!==this._milkEntrySequence||!this._milkEntryAlive)return;
      if(row.subjectId!==active.subjectId||row.recordId!==id)throw Error('奶量记录所属宝宝不一致');
      if(!row.recordSaved)throw Error('这条奶量记录已删除，无法编辑');
      this._milkRecords=[{...row,milkRecordId:row.recordId}];this._milkSubject=active.subjectId;this._milkDate=row.recordDate;
      this.setData({selectedDate:row.recordDate});this.openMilkEdit({currentTarget:{dataset:{id}}} as unknown as WechatMiniprogram.TouchEvent);
    }catch(error){if(seq===this._milkEntrySequence&&this._milkEntryAlive)this.setData({errorMessage:error instanceof Error?error.message:'奶量记录暂时无法打开'})}
    finally{if(seq===this._milkEntrySequence&&this._milkEntryAlive)this.setData({loading:false})}
  },
  finishMilkEntry(){this.setData({'milkPanel.visible':false});backPage('/pages/records/records',this)},
  _scrollTop:0,
  onRecordsScroll(e:WechatMiniprogram.CustomEvent<{scrollTop:number}>){if(!this.data.loading)this._scrollTop=e.detail.scrollTop},
  _details:new Map<string,SavedMeal>(),_deletePending:null as {mealId:string;operationId:string;expectedRevision:string}|null, _loadSequence:0,
  _milkReferenceReadyScope:'',_milkReferenceNeedsSelection:false,_milkReferenceResumeAfterChoice:false,_milkReferenceAttempt:0,
  _milkNutritionSequence:0,_milkNutritionSavedOwner:'',_milkNutritionSaved:null as {revisionId:string;profile?:{name:string}}|null,_milkNutritionEditing:null as {profileId:string;expectedRevision:number;milkTypes:string[]}|null,
  _milkSequence:0,_milkRecords:[] as MilkRow[],_milkSubject:'',_milkDate:'',
  _markersAlive:true,_markerSequence:0,
  async loadDateMarkers(subjectId:string,loadSequence:number){
    const sequence=++this._markerSequence,windowKey=this.data.dates.map(d=>d.date).join(',')
    try{
      const rows=await request<MealSummary[]>('/subjects/'+encodeURIComponent(subjectId)+'/meals')
      const active=await context()
      if(!this._markersAlive||sequence!==this._markerSequence||loadSequence!==this._loadSequence||active.subjectId!==subjectId||windowKey!==this.data.dates.map(d=>d.date).join(','))return
      const recorded=new Set(rows.filter(row=>row.status==='CONFIRMED'&&Number.isFinite(new Date(row.occurredAt).getTime())).map(row=>dateOnly(new Date(row.occurredAt))))
      this.setData({dates:this.data.dates.map(day=>({...day,recorded:recorded.has(day.date)}))})
    }catch{/* Unknown dates remain unmarked; do not infer absence from a failed read. */}
  },
  _nameTimer:null as ReturnType<typeof setTimeout>|null,
  _nameChecks:0,
  pollMealNames(details:MealDetail[],sequence:number){
    if(this._nameTimer)clearTimeout(this._nameTimer)
    const pending=details.filter(m=>['PENDING','RUNNING'].includes(m.nameState||''))
    if(!pending.length||this._nameChecks>=10)return
    this._nameTimer=setTimeout(async()=>{
      this._nameTimer=null;this._nameChecks++
      if(sequence!==this._loadSequence||!this._markersAlive)return
      const updates=await Promise.all(pending.map(async meal=>{try{return await request<MealDetail>('/meals/'+meal.mealId)}catch{return null}}))
      if(sequence!==this._loadSequence||!this._markersAlive)return
      const valid=updates.filter((m):m is MealDetail=>Boolean(m))
      const meals=this.data.meals.map(row=>{const meal=valid.find(m=>m.mealId===row.mealId);if(!meal)return row;const name=savedMealName(meal,true,row.name);return {...row,name,title:row.time+' · '+name}})
      const selected=this.data.selectedMeal,selectedUpdate=selected&&meals.find(row=>row.mealId===selected.mealId)
      this.setData({meals,...(selected&&selectedUpdate?{selectedMeal:{...selected,name:selectedUpdate.name,title:selectedUpdate.title}}:{})})
      this.pollMealNames(valid,sequence)
    },2000)
  },
  async loadMeals() {
    const sequence=++this._loadSequence,selectedKey=this.data.selectedDate
    this.setData({ loading: true, errorMessage: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      this.setData({canRecord:canRecordBaby()})
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
        const photoPath = mealPhotoPath(meal.mealId)
        const isPhoto = Boolean(photoPath || meal.notes === '拍照记录' || meal.notes === '拍照记录食物' || confirmed.some(item => item.source === 'AI_CANDIDATE'))
        const name = savedMealName({...meal,items:confirmed}, isPhoto, mealLabels[meal.mealType] + '记录')
        return {
          recordedBy:meal.recordedBy||'',modifiedBy:meal.modifiedBy||'',mealId: meal.mealId, photoPath, recordLabel:isPhoto?'拍照记录':meal.notes==='手工记录'?'手工记录':'', type: mealLabels[meal.mealType],
          time, dateLabel: `${occurredAt.getFullYear()}年${occurredAt.getMonth() + 1}月${occurredAt.getDate()}日`,
          title: `${time} · ${name}`, name,
          ingredients: confirmed.map(recordFoodName).join('、') || '暂无已确认食物',
          foodCount: new Set(confirmed.map(item => item.foodId ? 'food:' + item.foodId : 'item:' + item.mealItemId)).size, consumedTotal: (estimated?'约':'')+formatGrams(mealConsumed),
          tone: meal.mealType === 'DINNER' ? 'night' : meal.mealType === 'SNACK' ? 'snack' : 'day',
          items: confirmed.map((item) => ({
            mealItemId: item.mealItemId, name: recordFoodName(item),
            served: item.servedAmount ? formatGrams(item.servedAmount) : null,
            consumed: (item.weightOrigin==='USER_ACCEPTED_ESTIMATE'?'约':'')+formatGrams(item.consumedAmount), unit: unitLabel(item.unit),
          })),
        }
      })
      this.pollMealNames(details,sequence)
      void this.loadSharedPhotos(meals,active.subjectId,sequence)
      void retrySharedMealPhotos()
      const selectedDate = new Date(`${this.data.selectedDate}T00:00:00`)
      this.setData({
        selectedDateLabel: `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`, meals,
        dates:this.data.dates.map(day=>({...day,recorded:day.date===selectedKey?details.length>0:null})),
        confirmedCount: details.length,
        consumedTotal: formatGrams(consumedTotal),
      })
      void this.loadDateMarkers(active.subjectId,sequence)
      await this.loadMilk()
    } catch (caught) {
      if(sequence!==this._loadSequence)return
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '记录加载失败'
      this.setData({ errorMessage: message, meals: [], confirmedCount: 0, consumedTotal: '0' })
      wx.showToast({ title: message, icon: 'none' })
    } finally { if(sequence===this._loadSequence)this.setData({ loading: false }) }
  },

  async loadSharedPhotos(meals:DisplayMeal[],subjectId:string,sequence:number){
    if(familyState()?.sharedVersion==='legacy')return
    const pending=meals.filter(m=>!m.photoPath);let next=0
    await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{while(next<pending.length){const m=pending[next++];if(!m)return
      try{const photoPath=await sharedMealPhoto(m.mealId,subjectId);if(!photoPath||sequence!==this._loadSequence)return
        this.setData({meals:this.data.meals.map(row=>row.mealId===m.mealId?{...row,photoPath}:row)})
      }catch{ /* No cloud photo or no access: keep default illustration, never substitute generated food. */ }
    }}))
  },
  async loadMilk(more=false) {
    if(more&&(this.data.milkLoadingMore||!this.data.milkHasMore))return
    const sequence = more?this._milkSequence:++this._milkSequence,date=this.data.selectedDate
    if(!more&&this._milkDate!==date){this._milkRecords=[];this.setData({milkItems:[],milkHasRecords:false,milkCount:0,milkMain:'奶量未知',milkSub:'',milkAmount:'',milkHasKnownVolume:false,milkPreview:'',milkCursor:'',milkHasMore:false,milkExpanded:false})}
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
        milkAmount: formatMl(summary.knownVolumeMl), milkHasKnownVolume: summary.knownVolumeMl !== null,
        milkPreview: this._milkRecords.slice(0,2).map(row => { const at = new Date(row.occurredAt); return milkTypeLabel(row.milkType) + ' ' + String(at.getHours()).padStart(2,'0') + ':' + String(at.getMinutes()).padStart(2,'0') }).reverse().join(' / '),
        milkMain: main, milkSub: sub, milkHasRecords: summary.feedCount > 0,milkCount:summary.feedCount,
        milkCursor:page.nextCursor||'',milkHasMore:page.hasMore,milkLoadingMore:false,
        milkItems: this._milkRecords.map((row) => {
          const at = new Date(row.occurredAt)
          const time = `${at.getHours().toString().padStart(2, '0')}:${at.getMinutes().toString().padStart(2, '0')}`
          const volumeLabel = row.quantityMode === 'EVENT_ONLY' ? '奶量未知' : `${formatMl(row.volumeMl)}毫升`
          return { recordedBy:row.recordedBy,modifiedBy:row.modifiedBy,milkRecordId: row.milkRecordId, time, typeLabel: milkTypeLabel(row.milkType), volumeLabel }
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
    this.resetMilkLabel();
    if(!canRecordBaby()){wx.showToast({title:'当前为仅查看权限',icon:'none'});return}
    if (this.data.loading) return
    const now = new Date()
    const time = this.data.selectedDate === this.data.todayDate
      ? `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      : '08:00'
    const active=await context();if(!active.subjectId){wx.showToast({title:'请先建立宝宝档案',icon:'none'});return}const previous=pendingRecord('milk-create:'+active.subjectId),defaults=readMilkEntryDefaults(active.subjectId)
    this.setData({ milkPanel: { visible: true, mode: 'create', recordId: '', revisionToken: '', recordDate: this.data.selectedDate, time, milkTypeIndex: 0, volume: '', unknownVolume:false,errorMessage:'', about: false, retrying:false,subjectId:'',originalOccurredAt:'',volumeTouched:false,originTouched:false,saving: false, deleting: false, operationId: operationId() } })
    this.setData({'milkPanel.subjectId':active.subjectId,...(defaults?{'milkPanel.milkTypeIndex':milkTypeLabels.findIndex(t=>t.key===defaults.milkType),'milkPanel.volume':integerInput(defaults.volume),'milkPanel.unknownVolume':defaults.eventOnly}:{})})
    this._milkReferenceReadyScope='';this._milkReferenceNeedsSelection=false;this._milkReferenceResumeAfterChoice=false;++this._milkReferenceAttempt;this.setData({'milkNutrition.firstUse':false,'milkNutrition.canRemember':true,'milkNutrition.makeDefault':true});
    this._milkNutritionSaved=null;this.setData({milkLinkedChoice:'NONE',milkReferenceChoice:'AUTO',milkReferenceLabel:'未设置',milkReferenceExisting:''});this.prepareMilkLinks();void this.loadMilkNutritionOptions();
    if(previous)this.restoreMilkSubmission(previous.payload)
  },
  restoreMilkSubmission(body:Record<string,unknown>){const at=new Date(String(body.occurredAt));this.setData({'milkPanel.retrying':true,'milkPanel.recordDate':String(body.recordDate||dateOnly(at)),'milkPanel.time':String(at.getHours()).padStart(2,'0')+':'+String(at.getMinutes()).padStart(2,'0'),'milkPanel.volume':body.volumeMl===null||body.volumeMl===undefined?'':integerInput(String(body.volumeMl)),'milkPanel.milkTypeIndex':milkTypeLabels.findIndex(t=>t.key===body.milkType),'milkPanel.unknownVolume':body.quantityMode==='EVENT_ONLY'||body.quantityMode===undefined&&body.milkType==='DIRECT_BREASTFEEDING'&&body.volumeMl==null,milkLinkedChoice:Object.prototype.hasOwnProperty.call(body,'linkedMealItemId')?String(body.linkedMealItemId||'NONE'):'UNCHANGED',milkReferenceChoice:Object.prototype.hasOwnProperty.call(body,'nutritionProfileRevisionId')?String(body.nutritionProfileRevisionId||'NONE'):'UNCHANGED','milkPanel.about':body.volumeOrigin==='USER_ACCEPTED_ESTIMATE'});wx.showToast({title:'上次提交待核对，重试将核对原提交',icon:'none'})},
  openMilkEdit(event: WechatMiniprogram.TouchEvent) {
    this.resetMilkLabel();
    if(!canRecordBaby()){wx.showToast({title:'当前为仅查看权限，可在列表查看明细',icon:'none'});return}
    const recordId = String(event.currentTarget.dataset.id)
    const row = this._milkRecords.find((item) => item.milkRecordId === recordId)
    if (!row) return
    const at = new Date(row.occurredAt)
    const time = `${at.getHours().toString().padStart(2, '0')}:${at.getMinutes().toString().padStart(2, '0')}`
    const index = milkTypeLabels.findIndex((item) => item.key === row.milkType)
    this.setData({ milkPanel: { visible: true, mode: 'edit', recordId, revisionToken: row.revisionToken, recordDate: this.data.selectedDate, time, milkTypeIndex: index < 0 ? 0 : index, volume: row.volumeMl === null ? '' : integerInput(row.volumeMl), unknownVolume:row.quantityMode==='EVENT_ONLY',errorMessage:'', about: row.volumeOrigin === 'USER_ACCEPTED_ESTIMATE', retrying:false,subjectId:'',originalOccurredAt:'',volumeTouched:false,originTouched:false,saving: false, deleting: false, operationId: operationId() } })
    this._milkReferenceReadyScope='';this._milkReferenceNeedsSelection=false;this._milkReferenceResumeAfterChoice=false;++this._milkReferenceAttempt;this.setData({'milkNutrition.firstUse':false,'milkNutrition.canRemember':true});
    this._milkNutritionSaved=null;this.setData({'milkPanel.subjectId':this._milkSubject,'milkPanel.originalOccurredAt':row.occurredAt,milkReferenceChoice:'UNCHANGED',milkLinkedChoice:'UNCHANGED',milkReferenceExisting:row.nutritionProfileRevisionId||'',milkReferenceLabel:row.nutritionProfileRevisionId?'已保存的营养资料':'未设置'});this.prepareMilkLinks(row.linkedMealItemId);void this.loadMilkNutritionOptions()
    const previous=pendingRecord('milk-update:'+recordId);if(previous)this.restoreMilkSubmission(previous.payload)
  },
  closeMilkPanel() { if (this.data.milkPanel.saving||this.data.milkPanel.deleting||this.data.milkNutrition.saving) return; ++this._milkNutritionSequence;++this._milkReferenceAttempt;this._milkReferenceResumeAfterChoice=false; this.setData({ 'milkPanel.visible': false });if(this._milkEntryId)this.finishMilkEntry() },
  milkEditorLocked() {const p=this.data.milkPanel;return p.retrying||p.saving||p.deleting||this.data.milkNutrition.saving},
  setMilkType(event:WechatMiniprogram.TouchEvent) {if(this.milkEditorLocked())return;const index=Number(event.currentTarget.dataset.index);if(!milkTypeLabels[index])return;this.setData({'milkPanel.milkTypeIndex':index,milkReferenceChoice:this.data.milkPanel.mode==='edit'?'UNCHANGED':'AUTO','milkPanel.errorMessage':'',...(milkTypeLabels[index]!.key==='DIRECT_BREASTFEEDING'&&!this.data.milkPanel.volume.trim()?{'milkPanel.unknownVolume':true}:{})});void this.loadMilkNutritionOptions()},
  milkDateChange(event:WechatMiniprogram.PickerChange) {if(this.milkEditorLocked())return;this.setData({'milkPanel.recordDate':String(event.detail.value),'milkPanel.errorMessage':'',milkReferenceChoice:this.data.milkPanel.mode==='edit'?'UNCHANGED':'AUTO'});void this.loadMilkNutritionOptions()},
  milkTimeChange(event:WechatMiniprogram.PickerChange) {if(this.milkEditorLocked())return;this.setData({'milkPanel.time':String(event.detail.value),'milkPanel.errorMessage':''})},
  milkVolumeInput(event:WechatMiniprogram.Input) {if(this.milkEditorLocked()||this.data.milkPanel.unknownVolume)return;this.setData({'milkPanel.volume':event.detail.value,'milkPanel.volumeTouched':true,'milkPanel.errorMessage':''})},
  toggleMilkUnknown() {if(this.milkEditorLocked())return;this.setData({'milkPanel.unknownVolume':!this.data.milkPanel.unknownVolume,'milkPanel.volumeTouched':true,'milkPanel.errorMessage':''})},

  prepareMilkLinks(existing?:string|null){
    const sameDate=this.data.milkPanel.recordDate===this.data.selectedDate;
    const options=[...(existing?[{id:'UNCHANGED',label:'保留原关联（同一次摄入仅计算一次）'}]:[]),{id:'NONE',label:'没有在食物中重复记录'},
      ...(sameDate?this.data.meals.flatMap(meal=>meal.items.map(item=>({id:item.mealItemId,label:meal.time+' · '+item.name}))):[])];
    this.setData({milkLinkOptions:options,milkLinkLabels:options.map(r=>r.label),milkLinkIndex:0});
  },
  chooseMilkLink(e:WechatMiniprogram.PickerChange){if(this.milkEditorLocked())return;const index=Number(e.detail.value),row=this.data.milkLinkOptions[index];if(row)this.setData({milkLinkedChoice:row.id,milkLinkIndex:index});},
  async loadMilkNutritionOptions() {
    const seq=++this._milkNutritionSequence,owner=milkEntryOwner(),p=this.data.milkPanel,subject=p.subjectId,type=milkTypeLabels[p.milkTypeIndex]?.key;
    if(!subject||!type)return;
    this._milkReferenceReadyScope='';this._milkReferenceNeedsSelection=false;
    this.setData({'milkNutrition.loading':true,'milkNutrition.error':'','milkNutrition.options':[]});
    try {
      const response=await request<{ageMonths:number;defaultRevision:number;defaultProfileRevisionId:string|null;requiresReferenceSelection?:boolean;options:Array<{revisionId:string;profileId:string;revision:number;canSetDefault?:boolean;profile:{name:string}}>}>(`/subjects/${subject}/milk-nutrition-options?recordDate=${p.recordDate}&milkType=${type}`);
      if(seq!==this._milkNutritionSequence||owner!==milkEntryOwner()||!this.data.milkPanel.visible||subject!==this.data.milkPanel.subjectId||p.recordDate!==this.data.milkPanel.recordDate||type!==milkTypeLabels[this.data.milkPanel.milkTypeIndex]?.key)return;
      this._milkReferenceReadyScope=this.milkReferenceScope();this._milkReferenceNeedsSelection=response.requiresReferenceSelection===true;
      this.setData({'milkNutrition.options':response.options,'milkNutrition.defaultRevision':response.defaultRevision,'milkNutrition.loading':false,
        'milkNutrition.ageFrom':String(response.ageMonths<12?6:response.ageMonths<36?12:36),'milkNutrition.ageTo':String(response.ageMonths<12?12:response.ageMonths<36?36:72)});
      const id=this.data.milkReferenceChoice==='AUTO'?response.defaultProfileRevisionId:this.data.milkReferenceChoice==='UNCHANGED'?this.data.milkReferenceExisting:this.data.milkReferenceChoice;
      const choice=response.options.find(r=>r.revisionId===id);
      this.setData({milkReferenceLabel:choice?.profile.name||(id&&id!=='NONE'?'已保存的营养资料':'未设置')});
    }catch(e){if(seq===this._milkNutritionSequence)this.setData({'milkNutrition.loading':false,'milkNutrition.error':'营养资料暂不可用，仍可保存奶量记录'});}
  },
  openMilkNutrition(){if(this.milkEditorLocked())return;this.setData({'milkNutrition.visible':true,'milkNutrition.manual':false});void this.loadMilkNutritionOptions()},
  closeMilkNutrition(){if(this.data.milkNutrition.saving)return;++this._milkLabelSequence;this.setData({milkLabelBusy:false,milkLabelError:'',milkLabelNote:'',milkLabelMatches:[]});this._milkLabelPhotos=[];if(this.data.milkNutrition.firstUse&&this.data.milkReferenceChoice==='AUTO')this.setData({milkReferenceChoice:'NONE',milkReferenceLabel:'仅记录奶量'});this._milkReferenceResumeAfterChoice=false;this.setData({'milkNutrition.visible':false,'milkNutrition.firstUse':false})},
  chooseMilkNutrition(e:WechatMiniprogram.TouchEvent){if(this.data.milkNutrition.saving)return;const id=String(e.currentTarget.dataset.id),row=this.data.milkNutrition.options.find(r=>r.revisionId===id);if(id!=='NONE'&&id!=='UNCHANGED'&&!row)return;this.setData({milkReferenceChoice:id,milkReferenceLabel:row?.profile.name||(id==='UNCHANGED'?'保留原参考':'仅记录奶量'),'milkNutrition.canRemember':id!=='UNCHANGED'&&row?.canSetDefault!==false,...(id==='UNCHANGED'||row?.canSetDefault===false?{'milkNutrition.makeDefault':false}:{})});},
  milkReferenceScope(){const p=this.data.milkPanel;return [milkEntryOwner(),p.subjectId,p.recordDate,milkTypeLabels[p.milkTypeIndex]?.key].join('|')},
  async ensureMilkReferenceSelection():Promise<boolean>{
    const scope=this.milkReferenceScope(),attempt=this._milkReferenceAttempt;
    this.setData({'milkPanel.saving':true});
    try{if(this._milkReferenceReadyScope!==scope||this.data.milkNutrition.loading)await this.loadMilkNutritionOptions();
      if(attempt!==this._milkReferenceAttempt||scope!==this.milkReferenceScope()||!this.data.milkPanel.visible)return false;
      if(this._milkReferenceNeedsSelection){this._milkReferenceResumeAfterChoice=true;this.setData({'milkNutrition.visible':true,'milkNutrition.manual':false,'milkNutrition.firstUse':true,'milkNutrition.error':''});return false;}
      return true;
    }finally{this.setData({'milkPanel.saving':false})}
  },
  async persistMilkDefault(subject:string,type:string,id:string|null,revision:number,owner:string):Promise<void>{
    let result:{revision?:number;nutritionProfileRevisionId?:string|null};
    try{result=await submitRecord<typeof result>('milk-default:'+subject+':'+type,
      '/subjects/'+subject+'/milk-nutrition-defaults/'+type,'PUT','SET_MILK_NUTRITION_DEFAULT',{expectedRevision:revision,nutritionProfileRevisionId:id});}
    catch(e){if(e instanceof ApiError&&e.statusCode===409)await this.loadMilkNutritionOptions();throw e;}
    if(owner!==milkEntryOwner()||(await context()).subjectId!==subject||subject!==this.data.milkPanel.subjectId)throw Error('账号或宝宝已切换，请返回重新打开');
    if(Object.prototype.hasOwnProperty.call(result,'nutritionProfileRevisionId')&&result.nutritionProfileRevisionId!==id){await this.loadMilkNutritionOptions();throw Error('上次常用资料已核对，请确认本次选择后重试');}
    if(typeof result.revision==='number')this.setData({'milkNutrition.defaultRevision':result.revision});
  },
  async confirmMilkNutritionChoice():Promise<void>{
    const n=this.data.milkNutrition,p=this.data.milkPanel,id=this.data.milkReferenceChoice,type=milkTypeLabels[p.milkTypeIndex]?.key;
    if(n.saving||n.loading||!type||!canRecordBaby())return;
    if(id==='AUTO'){this.setData({'milkNutrition.error':'请选择适用的营养参考，或仅记录奶量'});return;}
    if(!['NONE','UNCHANGED'].includes(id)&&!n.options.some(r=>r.revisionId===id)){this.setData({'milkNutrition.error':'资料已变化，请重新选择'});return;}
    const owner=milkEntryOwner(),scope=this.milkReferenceScope(),attempt=this._milkReferenceAttempt;
    this.setData({'milkNutrition.saving':true,'milkNutrition.error':''});
    try{
      if((await context()).subjectId!==p.subjectId||scope!==this.milkReferenceScope())throw Error('宝宝已切换，请返回重新打开');
      if(n.makeDefault&&n.canRemember&&id!=='UNCHANGED')await this.persistMilkDefault(p.subjectId,type,id==='NONE'?null:id,n.defaultRevision,owner);
      if(attempt!==this._milkReferenceAttempt||scope!==this.milkReferenceScope()||!this.data.milkPanel.visible)throw Error('页面或账号已变化，请重新核对');
      this.setData({'milkNutrition.visible':false,'milkNutrition.firstUse':false});
      const resume=this._milkReferenceResumeAfterChoice;this._milkReferenceResumeAfterChoice=false;
      if(resume){this.setData({'milkNutrition.saving':false});await this.saveMilkRecord();}
    }catch(e){this.setData({'milkNutrition.error':e instanceof Error?e.message:'设置结果待核对，请重试'});}
    finally{this.setData({'milkNutrition.saving':false});}
  },
  resetMilkLabel(){++this._milkLabelSequence;this._milkLabelEvidenceRef='';this._milkLabelPhotos=[];this._milkLabelOperation='';this.setData({milkLabelBusy:false,milkLabelError:'',milkLabelNote:'',milkLabelMatches:[]})},
  copyMilkLabelError(){if(this.data.milkLabelError)wx.setClipboardData({data:this.data.milkLabelError})},
  previewMilkLabel(){if(this._milkLabelPhotos.length)wx.previewImage({urls:this._milkLabelPhotos,current:this._milkLabelPhotos[0]})},
  _milkLabelEvidenceRef:'',_milkLabelSequence:0,_milkLabelPhotos:[] as string[],_milkLabelOperation:'',
  async openMilkLabel(){
    if(this.data.milkLabelBusy||this.milkEditorLocked()||this._milkNutritionSaved||!canRecordBaby())return;
    const scope=this.milkReferenceScope();
    try{const selected=await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve,reject)=>wx.chooseMedia({count:3,mediaType:['image'],sourceType:['camera','album'],sizeType:['compressed'],success:resolve,fail:reject}));
      if(scope!==this.milkReferenceScope()||!this.data.milkNutrition.visible)return;this._milkLabelPhotos=selected.tempFiles.map(f=>f.tempFilePath);this._milkLabelOperation=operationId();await this.retryMilkLabel();
    }catch(e){if(!String((e as {errMsg?:string})?.errMsg||'').includes('cancel'))this.setData({milkLabelError:'照片未选好，请重新选择'})}
  },
  async retryMilkLabel(){
    if(this.data.milkLabelBusy||!this._milkLabelPhotos.length||!canRecordBaby())return;
    const scope=this.milkReferenceScope(),owner=milkEntryOwner(),panel={...this.data.milkPanel};
    if(!wx.getStorageSync(labelConsentKey())){const agreed=await new Promise<boolean>(r=>wx.showModal({title:'识别产品标签',content:'本次标签图片将发送至DeepSeek提取资料。识别后请核对，未读出的项目不会自动补全。',confirmText:'同意并识别',success:x=>r(x.confirm),fail:()=>r(false)}));if(!agreed||scope!==this.milkReferenceScope()||owner!==milkEntryOwner())return;wx.setStorageSync(labelConsentKey(),true)}
    const sequence=++this._milkLabelSequence;this.setData({milkLabelBusy:true,milkLabelError:'',milkLabelNote:''});
    try{const type=milkTypeLabels[panel.milkTypeIndex]?.key||'';const result=await recognizeMilkLabel(panel.subjectId,type,panel.recordDate,this._milkLabelPhotos,this._milkLabelOperation,()=>sequence===this._milkLabelSequence&&scope===this.milkReferenceScope()&&owner===milkEntryOwner()&&this.data.milkNutrition.visible);
      if(sequence!==this._milkLabelSequence||scope!==this.milkReferenceScope()||owner!==milkEntryOwner()||!this.data.milkNutrition.visible)return;
      if(result.status==='AI_UNAVAILABLE'){this.setData({milkLabelError:[result.message,result.diagnostic?.code,result.diagnostic?.meaning,result.diagnostic?.diagnosticId].filter(Boolean).join(' · ')});return}
      if(result.status==='NEEDS_NUTRITION_TABLE'){this.setData({milkLabelError:'已识别到包装或配料信息，请补拍清晰的营养成分表。'});return}
      const c=result.candidate;if(!c)throw Error('未取得可核对的标签资料');
      let replace=true;if(this.data.milkNutrition.manual&&this.data.milkNutrition.fields.some(f=>f.value)){const answer=await new Promise<number>(r=>wx.showActionSheet({itemList:['仅补充空白项','替换为本次识别结果'],success:x=>r(x.tapIndex),fail:()=>r(-1)}));if(answer<0)return;replace=answer===1}
      if(sequence!==this._milkLabelSequence||scope!==this.milkReferenceScope())return;
      if(!replace&&(c.basis!==(this.data.milkNutrition.basisIndex===0?'PER_100ML_PREPARED':'PER_100G_POWDER')||this.data.milkNutrition.name&&c.name!==this.data.milkNutrition.name)){this.setData({milkLabelError:'产品或营养基准与现有输入不同，请选择替换后核对。'});return;}
      if(!this.data.milkNutrition.manual)this.beginMilkProduct();this._milkLabelEvidenceRef=result.evidence?JSON.stringify(result.evidence):'';const previous=this.data.milkNutrition,energy=c.nutrients.find(f=>f.nutrientCode==='ENERGY_KCAL'),a=c.nutrients.find(f=>f.nutrientCode==='VITAMIN_A_RAE'),folate=c.nutrients.find(f=>f.nutrientCode==='FOLATE'),cho=c.nutrients.find(f=>f.nutrientCode==='CARBOHYDRATE');
      this.setData({'milkNutrition.name':replace?c.name:previous.name||c.name,'milkNutrition.source':'用户核对产品标签（AI辅助提取）'+(result.evidence?'；识别号'+result.evidence.id+'；'+result.evidence.model+'；'+result.evidence.promptVersion:''),'milkNutrition.fields':labelForm(c,previous.fields,replace),...(replace?{'milkNutrition.basisIndex':c.basis==='PER_100ML_PREPARED'?0:c.basis==='PER_100G_POWDER'?1:2,'milkNutrition.ageFrom':c.ageFromMonths===null?'':String(c.ageFromMonths),'milkNutrition.ageTo':c.ageToMonthsExclusive===null?'':String(c.ageToMonthsExclusive),'milkNutrition.powderGrams':c.powderGrams||'','milkNutrition.preparedVolumeMl':c.preparedVolumeMl||'','milkNutrition.energyUnitIndex':energy?.unitCode==='KILOCALORIE'?1:0,'milkNutrition.aIndex':a?.chemicalBasis==='RAE'?1:a?.chemicalBasis==='RE'?2:0,'milkNutrition.folateIndex':Math.max(0,['UNKNOWN','DFE','NATURAL_FOLATE','FOLIC_ACID'].indexOf(folate?.chemicalBasis||'UNKNOWN')),'milkNutrition.choIndex':Math.max(0,['UNKNOWN','TOTAL_CARBOHYDRATE','AVAILABLE_CARBOHYDRATE'].indexOf(cho?.chemicalBasis||'UNKNOWN'))}:{}),...(!replace?{'milkNutrition.energyUnitIndex':previous.fields.find(f=>f.code==='ENERGY_KCAL')?.value?previous.energyUnitIndex:energy?.unitCode==='KILOCALORIE'?1:0,'milkNutrition.aIndex':previous.fields.find(f=>f.code==='VITAMIN_A_RAE')?.value?previous.aIndex:a?.chemicalBasis==='RAE'?1:a?.chemicalBasis==='RE'?2:0,'milkNutrition.folateIndex':previous.fields.find(f=>f.code==='FOLATE')?.value?previous.folateIndex:Math.max(0,['UNKNOWN','DFE','NATURAL_FOLATE','FOLIC_ACID'].indexOf(folate?.chemicalBasis||'UNKNOWN')),'milkNutrition.choIndex':previous.fields.find(f=>f.code==='CARBOHYDRATE')?.value?previous.choIndex:Math.max(0,['UNKNOWN','TOTAL_CARBOHYDRATE','AVAILABLE_CARBOHYDRATE'].indexOf(cho?.chemicalBasis||'UNKNOWN'))}:{}),milkLabelNote:'已填入可识别项目，请核对产品、基准、月龄与冲调说明。'+(c.warnings.length?' '+c.warnings.join('；'):''),milkLabelMatches:result.matches||[]});
    }catch(e){if(sequence===this._milkLabelSequence)this.setData({milkLabelError:e instanceof Error?e.message:'识别暂未完成，可重试或手工填写'})}finally{if(sequence===this._milkLabelSequence)this.setData({milkLabelBusy:false})}
  },
  reuseMilkLabel(e:WechatMiniprogram.TouchEvent){const id=String(e.currentTarget.dataset.id);if(!this.data.milkLabelMatches.some(m=>m.revisionId===id))return;this.setData({'milkNutrition.manual':false});this.chooseMilkNutrition(e)},
  beginMilkProduct(){
    if(this.data.milkNutrition.saving)return;this._milkLabelEvidenceRef='';this.setData({milkLabelNote:'',milkLabelMatches:[]});
    const names:Record<string,string>={ENERGY_KCAL:'能量',PROTEIN:'蛋白质',FAT_TOTAL:'脂肪',CARBOHYDRATE:'碳水化合物',FIBER_DIETARY:'膳食纤维',CALCIUM:'钙',IRON:'铁',ZINC:'锌',IODINE:'碘',SODIUM:'钠',VITAMIN_A_RAE:'维生素A',VITAMIN_C:'维生素C',FOLATE:'叶酸'};
    const gram=['PROTEIN','FAT_TOTAL','CARBOHYDRATE','FIBER_DIETARY'],micro=['IODINE','VITAMIN_A_RAE','FOLATE'];
    this._milkNutritionSaved=null;this._milkNutritionEditing=null;this.setData({'milkNutrition.manual':true,'milkNutrition.error':'','milkNutrition.name':'','milkNutrition.source':'用户核对产品营养成分表','milkNutrition.makeDefault':true,'milkNutrition.basisIndex':0,'milkNutrition.ageFrom':'6','milkNutrition.ageTo':'72','milkNutrition.powderGrams':'','milkNutrition.preparedVolumeMl':'','milkNutrition.aIndex':0,'milkNutrition.folateIndex':0,'milkNutrition.energyUnitIndex':0,'milkNutrition.choIndex':0,'milkNutrition.fields':Object.keys(names).map(code=>({code,name:names[code],unit:code==='ENERGY_KCAL'?'千焦':gram.includes(code)?'克':micro.includes(code)?'微克':'毫克',unitCode:code==='ENERGY_KCAL'?'KILOCALORIE':gram.includes(code)?'GRAM':micro.includes(code)?'MICROGRAM':'MILLIGRAM',value:''}))});
  },
  editMilkProduct(e:WechatMiniprogram.TouchEvent){
    if(this.data.milkNutrition.saving)return;const row=this.data.milkNutrition.options.find(r=>r.revisionId===String(e.currentTarget.dataset.id));if(!row)return;
    const p=row.profile as unknown as {name:string;sourceKind:string;source:string;milkTypes:string[];ageFromMonths:number;ageToMonthsExclusive:number;basis:string;powderGrams:string|null;preparedVolumeMl:string|null;nutrients:Array<{nutrientCode:string;value:string|null;status:string;chemicalBasis:string;unitCode:string}>};
    if(p.sourceKind!=='PRODUCT_LABEL')return;this.beginMilkProduct();this._milkNutritionEditing={profileId:row.profileId,expectedRevision:row.revision,milkTypes:p.milkTypes};
    const energy=p.nutrients.find(f=>f.nutrientCode==='ENERGY_KCAL');
    const a=p.nutrients.find(f=>f.nutrientCode==='VITAMIN_A_RAE'),folate=p.nutrients.find(f=>f.nutrientCode==='FOLATE');
    this.setData({'milkNutrition.energyUnitIndex':energy?.unitCode==='KILOCALORIE'?1:0,'milkNutrition.name':p.name,'milkNutrition.source':p.source,'milkNutrition.ageFrom':String(p.ageFromMonths),'milkNutrition.ageTo':String(p.ageToMonthsExclusive),'milkNutrition.basisIndex':p.basis==='PER_100G_POWDER'?1:0,'milkNutrition.powderGrams':p.powderGrams||'','milkNutrition.preparedVolumeMl':p.preparedVolumeMl||'',
      'milkNutrition.choIndex':Math.max(0,['UNKNOWN','TOTAL_CARBOHYDRATE','AVAILABLE_CARBOHYDRATE'].indexOf(p.nutrients.find(f=>f.nutrientCode==='CARBOHYDRATE')?.chemicalBasis||'UNKNOWN')),'milkNutrition.aIndex':Math.max(0,['UNKNOWN','RAE','RE'].indexOf(a?.chemicalBasis||'UNKNOWN')),'milkNutrition.folateIndex':Math.max(0,['UNKNOWN','DFE','NATURAL_FOLATE','FOLIC_ACID'].indexOf(folate?.chemicalBasis||'UNKNOWN')),
      'milkNutrition.fields':this.data.milkNutrition.fields.map(f=>{const original=p.nutrients.find(n=>n.nutrientCode===f.code);return {...f,unit:f.code==='ENERGY_KCAL'?(energy?.unitCode==='KILOCALORIE'?'千卡':'千焦'):f.unit,value:original?.value??'',originalStatus:original?.status,touched:false};})});
  },
  milkNutritionInput(e:WechatMiniprogram.Input){if(this.data.milkNutrition.saving||this._milkNutritionSaved)return;const key=String(e.currentTarget.dataset.field);if(['name','source','ageFrom','ageTo','powderGrams','preparedVolumeMl'].includes(key))this.setData({['milkNutrition.'+key]:e.detail.value});},
  milkNutrientInput(e:WechatMiniprogram.Input){if(this.data.milkNutrition.saving||this._milkNutritionSaved)return;const index=Number(e.currentTarget.dataset.index);this.setData({['milkNutrition.fields['+index+'].value']:e.detail.value,['milkNutrition.fields['+index+'].touched']:true});},
  milkNutritionPicker(e:WechatMiniprogram.PickerChange){if(this.data.milkNutrition.saving||this._milkNutritionSaved)return;const field=String(e.currentTarget.dataset.field);if(['basisIndex','aIndex','folateIndex','energyUnitIndex','choIndex'].includes(field))this.setData({['milkNutrition.'+field]:Number(e.detail.value),...(field==='energyUnitIndex'?{'milkNutrition.fields':this.data.milkNutrition.fields.map(f=>f.code==='ENERGY_KCAL'?{...f,unit:Number(e.detail.value)===0?'千焦':'千卡'}:f)}:{})});},
  toggleMilkDefault(){if(!this.data.milkNutrition.saving)this.setData({'milkNutrition.makeDefault':!this.data.milkNutrition.makeDefault})},
  async saveMilkProduct(){
    if(this.data.milkLabelBusy)return;if(![0,1].includes(this.data.milkNutrition.basisIndex)){this.setData({'milkNutrition.error':'请先核对营养基准'});return;}
    if(this.data.milkNutrition.saving||!canRecordBaby())return;
    const p=this.data.milkPanel,n=this.data.milkNutrition,type=milkTypeLabels[p.milkTypeIndex]?.key;
    if(!type||!n.name.trim()){this.setData({'milkNutrition.error':'请填写奶类产品名称'});return;}
    const subject=p.subjectId,owner=milkEntryOwner(),attempt=this._milkReferenceAttempt,scope=this.milkReferenceScope();if(this._milkNutritionSavedOwner!==owner)this._milkNutritionSaved=null;this.setData({'milkNutrition.saving':true,'milkNutrition.error':''});
    try {
      if((await context()).subjectId!==subject)throw Error('宝宝已切换，请返回重新打开');
      if(!this._milkNutritionSaved){
        const profile={name:n.name,milkTypes:this._milkNutritionEditing?.milkTypes||[type],ageFromMonths:Number(n.ageFrom),ageToMonthsExclusive:Number(n.ageTo),basis:n.basisIndex?'PER_100G_POWDER':'PER_100ML_PREPARED',powderGrams:n.powderGrams||null,preparedVolumeMl:n.preparedVolumeMl||null,source:n.source,...(this._milkLabelEvidenceRef?{evidenceRef:this._milkLabelEvidenceRef}:{}),
          nutrients:n.fields.map(f=>({nutrientCode:f.code,...(f.labelRawText?{labelRawText:f.labelRawText}:{}),unitCode:f.code==='ENERGY_KCAL'?(n.energyUnitIndex===0?'KILOJOULE':'KILOCALORIE'):f.code==='VITAMIN_A_RAE'?(n.aIndex===1?'MICROGRAM_RAE':n.aIndex===2?'MICROGRAM_RE':'MICROGRAM'):f.code==='FOLATE'?(n.folateIndex===1?'MICROGRAM_DFE':'MICROGRAM'):f.unitCode,value:f.value||null,status:f.value?'NUMERIC':!f.touched&&['TRACE','SOURCE_CONFLICT'].includes(f.originalStatus||'')?f.originalStatus:'MISSING',chemicalBasis:f.code==='CARBOHYDRATE'?['UNKNOWN','TOTAL_CARBOHYDRATE','AVAILABLE_CARBOHYDRATE'][n.choIndex]:f.code==='VITAMIN_A_RAE'?['UNKNOWN','RAE','RE'][n.aIndex]:f.code==='FOLATE'?['UNKNOWN','DFE','NATURAL_FOLATE','FOLIC_ACID'][n.folateIndex]:'STANDARD'}))};
        this._milkNutritionSaved=await submitRecord<{revisionId:string;profile?:{name:string}}>('milk-profile:'+subject,`/subjects/${subject}/milk-nutrition-profiles`,'POST','SAVE_MILK_NUTRITION_PROFILE',{...(this._milkNutritionEditing?{profileId:this._milkNutritionEditing.profileId,expectedRevision:this._milkNutritionEditing.expectedRevision}:{}),profile});
        this._milkNutritionSavedOwner=owner;
      }
      if(milkEntryOwner()!==owner||(await context()).subjectId!==subject)throw Error('账号或宝宝已切换，请返回重新打开');
      const id=this._milkNutritionSaved.revisionId;
      if(n.makeDefault)await this.persistMilkDefault(subject,type,id,n.defaultRevision,owner);
      if(milkEntryOwner()!==owner||(await context()).subjectId!==subject||this.data.milkPanel.subjectId!==subject||attempt!==this._milkReferenceAttempt||scope!==this.milkReferenceScope())return;
      this.setData({milkReferenceChoice:id,milkReferenceLabel:this._milkNutritionSaved.profile?.name||n.name,'milkNutrition.visible':false,'milkNutrition.manual':false,'milkNutrition.firstUse':false});
      const resume=this._milkReferenceResumeAfterChoice;this._milkReferenceResumeAfterChoice=false;
      if(resume){this.setData({'milkNutrition.saving':false});await this.saveMilkRecord();}
    }catch(e){this.setData({'milkNutrition.error':e instanceof Error?e.message:'资料保存失败，重试将核对原提交'});}
    finally{this.setData({'milkNutrition.saving':false});}
  },

  async saveMilkRecord() {
    const panel = this.data.milkPanel
    if (panel.saving||panel.deleting||this.data.milkNutrition.saving) return
    const milkType = milkTypeLabels[panel.milkTypeIndex]?.key
    if(!milkType)return
    const volume = panel.volume.trim()
    const eventOnly=panel.unknownVolume,owner=milkEntryOwner(),scope=panel.mode==='create'?'milk-create:'+panel.subjectId:'milk-update:'+panel.recordId
    if (!eventOnly && !volume) { wx.showToast({ title: '请填写实际喝下的奶量（毫升）', icon: 'none' }); return }
    if (!eventOnly && (panel.mode==='create'||panel.volumeTouched) && (!/^\d+$/.test(volume)||Number(volume)<=0)) { wx.showToast({ title: '奶量请填写整数（毫升）', icon: 'none' }); return }
    if (!/^\d{2}:\d{2}$/.test(panel.time)) { wx.showToast({ title: '请选择时间', icon: 'none' }); return }
    if(panel.mode==='create'&&!panel.retrying&&!eventOnly&&this.data.milkReferenceChoice==='AUTO'&&!pendingRecord(scope)){if(!await this.ensureMilkReferenceSelection())return;}
    const oldTime=panel.originalOccurredAt?new Date(panel.originalOccurredAt):null
    const oldClock=oldTime?String(oldTime.getHours()).padStart(2,'0')+':'+String(oldTime.getMinutes()).padStart(2,'0'):''
    const occurredAt = oldTime&&dateOnly(oldTime)===panel.recordDate&&oldClock===panel.time?panel.originalOccurredAt:`${panel.recordDate}T${panel.time}:00+08:00`
    const body: Record<string, unknown> = {
      occurredAt, recordDate: panel.recordDate, milkType,
      ...(this.data.milkLinkedChoice!=='UNCHANGED'?{linkedMealItemId:this.data.milkLinkedChoice==='NONE'?null:this.data.milkLinkedChoice}:{}),
      ...(!['AUTO','UNCHANGED'].includes(this.data.milkReferenceChoice)?{nutritionProfileRevisionId:this.data.milkReferenceChoice==='NONE'?null:this.data.milkReferenceChoice}:{}),
      quantityMode:eventOnly?'EVENT_ONLY':'KNOWN_VOLUME',...(panel.mode==='create'||panel.volumeTouched||eventOnly?{volumeMl:eventOnly?null:volume}:{}),...(eventOnly?{volumeOrigin:'UNKNOWN_METHOD'}:panel.mode==='create'||panel.volumeTouched||panel.originTouched?{volumeOrigin:panel.about?'USER_ACCEPTED_ESTIMATE':'UNKNOWN_METHOD'}:{}),
    }
    this.setData({ 'milkPanel.saving': true,'milkPanel.errorMessage':'' })
    try {
      const current=await context();if(current.subjectId!==panel.subjectId||owner!==milkEntryOwner())throw Error('账号或宝宝已切换，请重新进入记录页')
      const confirmedBody=pendingRecord(scope)?.payload||body
      if (panel.mode === 'create') {
        var response = await submitRecord<{reportUpdate?:{status?:string};milkType?:string;quantityMode?:string;volumeMl?:string|null}>('milk-create:'+panel.subjectId,`/subjects/${panel.subjectId}/milk-records`,'POST','CREATE_MILK_RECORD',body)
      } else {
        var response = await submitRecord<{reportUpdate?:{status?:string};milkType?:string;quantityMode?:string;volumeMl?:string|null}>('milk-update:'+panel.recordId,`/milk-records/${panel.recordId}`,'PATCH','UPDATE_MILK_RECORD',{expectedRevision:panel.revisionToken,...body})
      }
      rememberMilkEntry(panel.subjectId,{milkType:response.milkType||confirmedBody.milkType,eventOnly:(response.quantityMode||confirmedBody.quantityMode)==='EVENT_ONLY',volume:response.volumeMl!==undefined?(response.volumeMl===null?'':String(response.volumeMl)):confirmedBody.volumeMl!==undefined?(confirmedBody.volumeMl===null?'':String(confirmedBody.volumeMl)):panel.volume},owner)
      this.setData({ 'milkPanel.visible': false, saved: true, savedAction: panel.mode === 'create' ? '奶量已记录' : '奶量已修改', reportUpdateState: String(response.reportUpdate?.status || '') })
      if(this._milkEntryId){this.finishMilkEntry();return}
      await this.loadMilk()
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '奶量保存失败'
      this.setData({'milkPanel.errorMessage':message})
      try{const pending=pendingRecord(scope);if(pending)this.restoreMilkSubmission(pending.payload)}catch{/* Existing feedback remains if the session is no longer available. */}
      wx.showToast({ title: message, icon: 'none' })
      if (caught instanceof ApiError && caught.statusCode === 409) { this.setData({ 'milkPanel.visible': false }); if(this._milkEntryId)await this.loadMilkEntry();else await this.loadMilk() }
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
      if(this._milkEntryId){this.finishMilkEntry();return}
      await this.loadMilk()
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '删除失败'
      wx.showToast({ title: message, icon: 'none' })
      if (caught instanceof ApiError && caught.statusCode === 409) { this.setData({ 'milkPanel.visible': false }); if(this._milkEntryId)await this.loadMilkEntry();else await this.loadMilk() }
    } finally { this.setData({ 'milkPanel.deleting': false }) }
  },
  hideMealPhoto(e:WechatMiniprogram.CustomEvent){const mealId=String(e.currentTarget.dataset.mealId);this.setData({meals:this.data.meals.map(meal=>meal.mealId===mealId?{...meal,photoPath:''}:meal)})},
  openCalendar(){this.setData({showCalendar:true})},
  closeCalendar(){this.setData({showCalendar:false})},
  goBack() { if(this._milkEntryId){if(!this.data.milkPanel.saving&&!this.data.milkPanel.deleting)this.finishMilkEntry();return}navigateRoot('/pages/index/index') },
  openReport() { if(!this.data.loading&&!this.data.errorMessage&&(this.data.meals.length||this.data.milkHasRecords))openPage('/pages/report/report?date='+encodeURIComponent(this.data.selectedDate)+'&fromRecords=1') },
  startEmptyPhoto(){void this.addMeal()},
  startEmptyManual(){if(!this.data.loading)openPage('/pages/camera/camera?entry=manual')},
  async addMeal() {
    if(!canRecordBaby()){wx.showToast({title:'当前为仅查看权限',icon:'none'});return}
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
  retryLoad() { if(this._milkEntryId)void this.loadMilkEntry();else void this.loadMeals() },
  goCreateProfile() { wx.switchTab({ url: '/pages/profile/profile' }) },
  openMeal(event: WechatMiniprogram.TouchEvent) {
    const mealId = String(event.currentTarget.dataset.mealId)
    this.setData({ selectedMeal: this.data.meals.find((meal) => meal.mealId === mealId) || null })
  },
  async editSelectedMeal(){if(!canRecordBaby())return;if(this.data.deleting||this.data.editing||!this.data.selectedMeal)return;const id=this.data.selectedMeal.mealId;this.setData({editing:true});let lease;try{if(MEAL_EDIT_OCCUPANCY_ENABLED)lease=await reserveMealEdit(id);await new Promise<void>((resolve,reject)=>openPage('/pages/meal-edit/meal-edit?mealId='+id,{success:()=>{this.setData({selectedMeal:null});resolve()},fail:reject}))}catch(e){if(MEAL_EDIT_OCCUPANCY_ENABLED&&lease)void releaseMealEdit(id,lease).catch(()=>{});wx.showModal({title:editReason(e)==='MEAL_EDIT_BUSY'?'这餐正在编辑':'暂时不能编辑',content:e instanceof Error?e.message:'请稍后重试',showCancel:false})}finally{this.setData({editing:false})}},
  prepareSavedReturn(selectedDate:string){this._loadSequence++;this._details.clear();this._deletePending=null;this.setData({selectedDate,dates:datesAround(selectedDate),selectedMeal:null,meals:[],confirmedCount:0,consumedTotal:'0',loading:true,errorMessage:''})},
  async deleteSelectedMeal(){if(!canRecordBaby())return;if(this.data.deleting||this.data.editing||!this.data.selectedMeal)return;const meal=this._details.get(this.data.selectedMeal.mealId);if(!meal)return;if(this._deletePending?.mealId!==meal.mealId||this._deletePending.expectedRevision!==meal.revisionToken)this._deletePending={mealId:meal.mealId,operationId:operationId(),expectedRevision:meal.revisionToken};this.setData({deleting:true});try{if(await deleteSavedMeal(meal,this._deletePending)){this.setData({selectedMeal:null,saved:true,savedAction:'这餐已删除',reportUpdateState:String(wx.getStorageSync('foodmaster.reportUpdateState'))});await this.loadMeals()}}catch(e){const conflict=e instanceof ApiError&&e.statusCode===409,occupied=editReason(e)==='MEAL_EDIT_BUSY';wx.showModal({title:occupied?'这餐正在编辑':conflict?'这餐已有新修改':'尚未删除',content:occupied?(e instanceof Error?e.message:'这餐正在其他设备编辑，请稍后再试。'):conflict?'尚未删除最新记录，请重新打开核对。':e instanceof Error?e.message:'请重试',showCancel:false});if(conflict&&!occupied){this.setData({selectedMeal:null});await this.loadMeals()}}finally{this.setData({deleting:false})}},
  closeMeal() {if(this.data.deleting)return; this.setData({ selectedMeal: null }) },
  noop() {},
  closeSaved() { this.setData({ saved: false }); wx.removeStorageSync('foodmaster.mealSaved') },
})
