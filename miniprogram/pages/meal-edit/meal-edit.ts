import {backPage,backTo,navigateRoot} from '../../utils/navigation'
// Reuse the original records page after save; navigation failure retains a redirect fallback.
import { ApiError,request } from '../../utils/api'
import { ensureSessionContext } from '../../utils/session'
import { MEAL_EDIT_OCCUPANCY_ENABLED,EditSession,reserveMealEdit,takeMealEdit,renewMealEdit,releaseMealEdit,editUnavailable } from '../../utils/meal-edit-session'
import { SavedMeal,EditItem,draftItem,adjustWeight,totalText,totalUnits,weightNotice,exactGrams,validateItems,changedItems,itemPayload,mealTypes,localDate,snapWeight,operationId,recordSaved,deleteSavedMeal,SavedResult } from '../../utils/meal-edit'

function confirmDiscard(){return new Promise<boolean>(resolve=>wx.showModal({title:'退出并放弃本次修改？',content:'退出后不会保留未保存修改，再次进入将从已保存记录重新编辑。',confirmText:'放弃修改',success:r=>resolve(r.confirm),fail:()=>resolve(false)}))}
Page({
 data:{loading:true,busy:false,errorMessage:'',message:'',mealId:'',date:'',time:'',today:localDate(new Date()),mealType:'LUNCH',mealTypes,items:[] as EditItem[],total:'0',changed:false,validation:'',weightWarning:'',openSlider:'',showCalendar:false,showSearch:false,query:'',searching:false,searchItems:[] as Array<{foodId:string|null;canonicalNameZh:string}>,searchMessage:'',searchState:'idle',searchCursor:'',searchHasMore:false,searchingMore:false,searchTarget:'',invalidated:false,unresolved:false,unresolvedDelete:false,impact:'',originalLabel:'',ticks:Array.from({length:11},(_,i)=>({value:i*50,left:i*10})),reviewLabel:wx.getSystemInfoSync().platform==='devtools'?(wx.getStorageSync('foodmaster.reviewEnvironment')?.label||''):''},
 _baseline:null as SavedMeal|null,_pending:null as {fingerprint:string;payload:Record<string,unknown>}|null,
 _deletePending:null as {operationId:string;expectedRevision:string;editToken?:string}|null,
 _lease:null as EditSession|null,_timer:null as ReturnType<typeof setInterval>|null,_expiryTimer:null as ReturnType<typeof setTimeout>|null,
 _visible:false,_closed:false,_renewing:false,_checking:false,_searchSequence:0,_searchDebounce:null as ReturnType<typeof setTimeout>|null,
 onLoad(query:Record<string,string>){this._closed=false;this._visible=true;this.setData({mealId:query.mealId||''});void this.load()},
 async load(){
  try {
   if(MEAL_EDIT_OCCUPANCY_ENABLED){this._lease=takeMealEdit(this.data.mealId)||await reserveMealEdit(this.data.mealId);takeMealEdit(this.data.mealId)}
   if(this._closed){void this.release();return}
   const meal=await request<SavedMeal>('/meals/'+this.data.mealId)
   const active=await (getApp<IAppOption>().globalData.ready||ensureSessionContext())
   if(active.subjectId!==meal.subjectId)throw Error('当前宝宝已切换，请返回记录页重新进入')
   if(active.current?.canRecord===false)throw Error('当前为仅查看权限，不能修改餐食')
   if(MEAL_EDIT_OCCUPANCY_ENABLED&&meal.revisionToken!==this._lease?.revisionToken)throw Error('编辑状态已失效，请返回记录页重新打开这餐')
   if(this._closed)return
   this.applyBaseline(meal);this.startHeartbeat()
  }catch(e){if(!this._closed){this.setData({errorMessage:e instanceof Error?e.message:'记录加载失败'});void this.release()}}
  finally{if(!this._closed)this.setData({loading:false})}
 },
 onShow(){this._visible=true;if(MEAL_EDIT_OCCUPANCY_ENABLED&&this._lease&&!this.data.loading&&!this.data.invalidated){this._checking=true;void this.renew().finally(()=>{this._checking=false});this.startHeartbeat()}},
 onHide(){this._visible=false;this.stopHeartbeat()},
 startHeartbeat(){
  this.stopHeartbeat();if(!MEAL_EDIT_OCCUPANCY_ENABLED||!this._lease||!this._visible||this._closed||this.data.invalidated)return
  this._timer=setInterval(()=>void this.renew(),30000)
  this._expiryTimer=setTimeout(()=>{if(!this._closed)this.invalidate()},Math.max(0,this._lease.validUntil-Date.now()))
 },
 stopHeartbeat(){if(this._timer)clearInterval(this._timer);if(this._expiryTimer)clearTimeout(this._expiryTimer);this._timer=null;this._expiryTimer=null},
 async renew(){
  if(!MEAL_EDIT_OCCUPANCY_ENABLED||this._renewing||this._closed||!this._visible||!this._lease||this.data.invalidated||this.data.busy||this.data.unresolved)return
  if(Date.now()>=this._lease.validUntil){this.invalidate();return}
  this._renewing=true;const lease=this._lease
  try {const refreshed=await renewMealEdit(this.data.mealId,lease);if(this._closed||this.data.invalidated||this._lease?.editToken!==lease.editToken)return;this._lease=refreshed;this.startHeartbeat()}
  catch(e){if(!this._closed&&!this.data.busy&&this._lease?.editToken===lease.editToken){if(editUnavailable(e)||Date.now()>=lease.validUntil)this.invalidate();else this.setData({message:'暂时无法确认编辑状态，请检查网络；当前输入仍在。'})}}
  finally{this._renewing=false}
 },
 invalidate(message='编辑状态已失效，请返回记录页重新打开这餐。'){
  this.stopHeartbeat();this.setData({invalidated:true,showSearch:false,showCalendar:false,openSlider:'',message:this.data.unresolved?(this.data.unresolvedDelete?'删除结果尚未确认，请重试同一次删除或返回记录页查看。':'保存结果尚未确认，请重试同一次保存或返回记录页查看。'):message})
  wx.disableAlertBeforeUnload()
 },
 editable(){return !this.data.busy&&!this.data.invalidated&&!this.data.unresolved&&!this._checking&&!this._closed},
 applyBaseline(meal:SavedMeal){
  if(meal.status!=='CONFIRMED'||meal.items.some(i=>i.unit!=='g'||i.status!=='CONFIRMED'))throw Error('这餐暂不支持编辑，请保留原记录')
  this._baseline=meal;this._pending=null;this._deletePending={operationId:operationId(),expectedRevision:meal.revisionToken,...(MEAL_EDIT_OCCUPANCY_ENABLED&&this._lease?{editToken:this._lease.editToken}:{})}
  const d=new Date(meal.occurredAt),date=localDate(d),time=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')
  this.setData({date,time,mealType:meal.mealType,items:meal.items.map(draftItem),invalidated:false,unresolved:false,message:'',openSlider:'',originalLabel:date+' '+time+' · '+(meal.notes||mealTypes.find(t=>t.key===meal.mealType)?.label||'饮食记录')});this.recompute()
 },
 recompute(){if(!this._baseline)return;const base=this._baseline,d=new Date(base.occurredAt),changed=changedItems(this.data.items)||this.data.date!==localDate(d)||this.data.time!==String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')||this.data.mealType!==base.mealType;const total=totalText(this.data.items);this.setData({changed,total,validation:validateItems(this.data.items),weightWarning:totalUnits(this.data.items)===null?'':weightNotice(exactGrams(totalUnits(this.data.items)!)),impact:this.data.date===localDate(d)?'保存后，将更新'+this.data.date+'及相关报告':'这餐将从'+localDate(d)+'移动到'+this.data.date+'，两个日期的相关报告将更新'});if(changed&&!this.data.invalidated)wx.enableAlertBeforeUnload({message:'修改尚未保存，离开将放弃本次修改'});else wx.disableAlertBeforeUnload()},
 weightInput(e:WechatMiniprogram.Input){if(!this.editable())return;const key=String(e.currentTarget.dataset.key);this.setData({items:this.data.items.map(i=>i.key===key?adjustWeight(i,e.detail.value.trim()):i)});this.recompute()},
 toggleSlider(e:WechatMiniprogram.TouchEvent){if(!this.editable())return;const key=String(e.currentTarget.dataset.key);this.setData({openSlider:this.data.openSlider===key?'':key})},
 slideChanging(e:WechatMiniprogram.SliderChanging){this.slide(e,false)},slideChanged(e:WechatMiniprogram.SliderChange){this.slide(e,true)},
 slide(e:WechatMiniprogram.CustomEvent<{value:number}>,release:boolean){if(!this.editable())return;const key=String(e.currentTarget.dataset.key),raw=Math.round(e.detail.value),snap=snapWeight(raw),value=release&&snap!==null?snap:raw;this.setData({items:this.data.items.map(i=>i.key===key?{...adjustWeight(i,String(value)),slider:value,snap:release?null:snap}:i)});this.recompute()},
 removeItem(e:WechatMiniprogram.TouchEvent){if(!this.editable())return;const key=String(e.currentTarget.dataset.key);this.setData({items:this.data.items.map(i=>i.key===key?{...i,removed:!i.removed}:i),openSlider:this.data.openSlider===key?'':this.data.openSlider});this.recompute()},
 openCalendar(){if(this.editable())this.setData({showCalendar:true})},closeCalendar(){this.setData({showCalendar:false})},
 changeDate(e:WechatMiniprogram.CustomEvent<{value:string}>){if(!this.editable())return;this.setData({date:e.detail.value,showCalendar:false});this.recompute()},
 changeTime(e:WechatMiniprogram.PickerChange){if(!this.editable())return;this.setData({time:String(e.detail.value)});this.recompute()},
 changeType(e:WechatMiniprogram.TouchEvent){if(!this.editable())return;this.setData({mealType:String(e.currentTarget.dataset.key)});this.recompute()},
 openSearch(e:WechatMiniprogram.TouchEvent){if(!this.editable())return;this.setData({showSearch:true,searchTarget:String(e.currentTarget.dataset.key||''),query:'',searchItems:[],searchMessage:''})},
 closeSearch(){if(!this.data.searching)this.setData({showSearch:false})},queryInput(e:WechatMiniprogram.Input){if(!this.editable())return;this.setData({query:e.detail.value});if(this._searchDebounce)clearTimeout(this._searchDebounce);this._searchDebounce=setTimeout(()=>{if(this.data.query.trim()&&this.data.showSearch)void this.searchFood()},350)},
 async searchFood(){if(!this.editable()||this.data.searching||!this.data.query.trim())return;const sequence=++this._searchSequence;this.setData({searching:true,searchMessage:'',searchCursor:'',searchHasMore:false});try{const response=await request<{items:Array<{foodId:string|null;canonicalNameZh:string}>;nextCursor:string|null;hasMore:boolean}>('/foods/search?q='+encodeURIComponent(this.data.query.trim())+'&limit=15');if(sequence!==this._searchSequence||!this.editable())return;this.setData({searchItems:response.items,searchCursor:response.nextCursor||'',searchHasMore:response.hasMore,searchState:response.items.length?'results':'empty',searchMessage:response.items.length?'':'没有找到标准食品，请核对食品全名及生熟状态。也可在下方按名称记录（暂无营养资料）。'})}catch(e){if(!this._closed){const status=e instanceof ApiError?e.statusCode:0;this.setData({searchState:'error',searchItems:[],searchMessage:status===429?'搜索太频繁，请稍候再试':e instanceof Error?e.message:'食品搜索失败'})}}finally{if(!this._closed)this.setData({searching:false})}},
 async loadMoreSearch(){if(!this.editable()||this.data.searchingMore||!this.data.searchHasMore||!this.data.searchCursor)return;this.setData({searchingMore:true});try{const response=await request<{items:Array<{foodId:string|null;canonicalNameZh:string}>;nextCursor:string|null;hasMore:boolean}>('/foods/search?q='+encodeURIComponent(this.data.query.trim())+'&limit=15&cursor='+encodeURIComponent(this.data.searchCursor));if(!this.editable())return;const seen=new Set(this.data.searchItems.map((i: any) => i.foodId||i.canonicalNameZh));this.setData({searchItems:[...this.data.searchItems,...response.items.filter((i: any) => !seen.has(i.foodId||i.canonicalNameZh))],searchCursor:response.nextCursor||'',searchHasMore:response.hasMore})}catch(e){if(!this._closed)wx.showToast({title:e instanceof Error?e.message:'加载更多失败',icon:'none'})}finally{if(!this._closed)this.setData({searchingMore:false})}},
 chooseUnmatched(){if(!this.editable()||this.data.searching)return;const name=this.data.query.trim();if(!name){wx.showToast({title:'请先输入食品名称',icon:'none'});return}const target=this.data.searchTarget;let items=this.data.items;if(target){items=items.map((i: any) => i.key!==target?i:{...i,unmatched:true,foodId:null,selectedFoodRevisionId:null,name,matchReason:this.data.searchState==='error'?'REQUEST_FAILED':'NO_MATCH_NO_NUTRITION'})}else items=[...items,{key:operationId(),original:null,unmatched:true,foodId:null,selectedFoodRevisionId:null,name,input:'',raw:'',removed:false,touched:false,weightChanged:true,slider:0,snap:null,highPrecision:false,origin:'USER_ACCEPTED_ESTIMATE',served:null,matchReason:this.data.searchState==='error'?'REQUEST_FAILED':'NO_MATCH_NO_NUTRITION'}];this.setData({items,showSearch:false});this.recompute()},
 onFoodSelection(e:WechatMiniprogram.CustomEvent<{food:{foodId:string;canonicalNameZh:string;selectedFoodRevisionId?:string|null};unmatched:boolean;matchReason?:string}>){if(e.detail.unmatched){this.setData({query:e.detail.food.canonicalNameZh,searchState:e.detail.matchReason==='REQUEST_FAILED'?'error':'results'});this.chooseUnmatched()}else void this.chooseFood({currentTarget:{dataset:{foodId:e.detail.food.foodId,selectedFoodRevisionId:e.detail.food.selectedFoodRevisionId,observedName:e.detail.food.canonicalNameZh}}} as unknown as WechatMiniprogram.TouchEvent)},
 async chooseFood(event:WechatMiniprogram.TouchEvent){
  if(!this.editable()||this.data.searching)return
  const foodId=String(event.currentTarget.dataset.foodId||'');if(!foodId)return
  this.setData({searching:true})
  try{const selected=event.currentTarget.dataset.selectedFoodRevisionId?{foodId,selectedFoodRevisionId:String(event.currentTarget.dataset.selectedFoodRevisionId),observedName:String(event.currentTarget.dataset.observedName)}:await request<{foodId:string;observedName:string;selectedFoodRevisionId:string}>('/meals/'+this.data.mealId+'/food-selection/'+foodId)
   if(!this.editable())return
   const target=this.data.searchTarget;const entry=(i:EditItem):EditItem=>({...i,foodId:selected.foodId,selectedFoodRevisionId:selected.selectedFoodRevisionId,name:selected.observedName,unmatched:false,matchReason:undefined})
   const items=target?this.data.items.map(i=>i.key===target?entry(i):i):[...this.data.items,entry({key:operationId(),original:null,foodId:null,selectedFoodRevisionId:null,name:'',input:'',raw:'',removed:false,touched:false,weightChanged:true,slider:0,snap:null,highPrecision:false,origin:'USER_ACCEPTED_ESTIMATE',served:null})]
   this.setData({items,showSearch:false});this.recompute()
  }catch(e){if(!this._closed)wx.showToast({title:e instanceof Error?e.message:'食品选择失败',icon:'none'})}finally{if(!this._closed)this.setData({searching:false})}
 },
 async verifySubject(){const active=await (getApp<IAppOption>().globalData.ready||ensureSessionContext());if(active.subjectId!==this._baseline?.subjectId)throw Error('当前宝宝已切换，请返回记录页重新进入')},
 async save(){
  if(this.data.unresolvedDelete){await this.deleteMeal();return}
  if(this.data.busy||this._checking||!this._baseline||(MEAL_EDIT_OCCUPANCY_ENABLED&&!this._lease)||!this.data.changed||this._closed)return
  if(this.data.invalidated&&!this.data.unresolved)return
  if(MEAL_EDIT_OCCUPANCY_ENABLED&&!this.data.unresolved&&this._lease&&Date.now()>=this._lease.validUntil){this.invalidate();return}
  const invalid=validateItems(this.data.items);if(invalid){this.setData({message:'未保存：'+invalid});return}
  this.setData({busy:true,message:''})
  let submitted=false
  try {
   await this.verifySubject()
   if(!this.data.unresolved){
    const original=new Date(this._baseline.occurredAt);let occurredAt=new Date(this.data.date+'T'+this.data.time+':'+String(original.getSeconds()).padStart(2,'0'));occurredAt.setMilliseconds(original.getMilliseconds())
    if(this.data.date===localDate(original)&&this.data.time===String(original.getHours()).padStart(2,'0')+':'+String(original.getMinutes()).padStart(2,'0'))occurredAt=original
    if(!Number.isFinite(occurredAt.getTime())||occurredAt.getTime()>Date.now()+300000)throw Error('日期和时间不能在未来')
    if(totalUnits(this.data.items)!>300000000){const ok=await new Promise<boolean>(resolve=>wx.showModal({title:'核对本餐总量',content:weightNotice(exactGrams(totalUnits(this.data.items)!))+'确认记录这个重量吗？',confirmText:'确认记录',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));if(!ok)return}
    if(this.data.invalidated||(MEAL_EDIT_OCCUPANCY_ENABLED&&this._lease&&Date.now()>=this._lease.validUntil)){this.invalidate();return}
    const body={expectedRevision:this._baseline.revisionToken,...(MEAL_EDIT_OCCUPANCY_ENABLED&&this._lease?{editToken:this._lease.editToken}:{}),occurredAt:occurredAt.toISOString(),mealType:this.data.mealType,items:itemPayload(this.data.items),...(totalUnits(this.data.items)!>300000000?{weightReview:{policyVersion:'MEAL_WEIGHT_REVIEW_V2',acknowledged:true,reviewedTotalGrams:exactGrams(totalUnits(this.data.items)!)}}:{})},fingerprint=JSON.stringify(body)
    if(this._pending?.fingerprint!==fingerprint)this._pending={fingerprint,payload:{...body,operationId:operationId()}}
   }
   submitted=true
   const saved=await request<SavedResult>('/meals/'+this.data.mealId,{method:'PATCH',data:this._pending!.payload})
   recordSaved(saved,'修改已保存');this.setData({unresolved:false});await this.leave('/pages/records/records?date='+this.data.date+'&saved=1')
  }catch(e){
   if(editUnavailable(e)){this.setData({unresolved:false});this.invalidate(e instanceof Error?e.message:undefined)}
   else if(submitted&&(!(e instanceof ApiError)||e.statusCode===0||e.statusCode>=500)){this.setData({unresolved:true,message:'保存结果尚未确认，输入仍在。请重试保存，或返回记录页查看。'})}
   else this.setData({message:'修改未保存：'+(e instanceof Error?e.message:'请重试')})
  }finally{if(!this._closed)this.setData({busy:false})}
 },
 async deleteMeal(){
  if(this.data.busy||this._checking||this._closed||!this._baseline||!this._deletePending||(MEAL_EDIT_OCCUPANCY_ENABLED&&!this._lease))return
  if(!this.data.unresolvedDelete&&!this.editable())return
  if(MEAL_EDIT_OCCUPANCY_ENABLED&&!this.data.unresolvedDelete&&this._lease&&Date.now()>=this._lease.validUntil){this.invalidate();return}
  let submitted=false
  this.setData({busy:true});try{await this.verifySubject();submitted=true;if(await deleteSavedMeal(this._baseline,this._deletePending,this.data.unresolvedDelete)){this.setData({unresolved:false,unresolvedDelete:false});await this.leave('/pages/records/records?date='+localDate(new Date(this._baseline.occurredAt))+'&saved=1')}}
  catch(e){if(editUnavailable(e)){this.setData({unresolved:false,unresolvedDelete:false});this.invalidate(e instanceof Error?e.message:undefined)}else if(submitted&&(!(e instanceof ApiError)||e.statusCode===0||e.statusCode>=500))this.setData({unresolved:true,unresolvedDelete:true,message:'删除结果尚未确认，请重试删除或返回记录页查看。'});else this.setData({message:'这餐尚未删除：'+(e instanceof Error?e.message:'请重试')})}
  finally{if(!this._closed)this.setData({busy:false})}
 },
 async release(){this.stopHeartbeat();const current=this._lease;this._lease=null;if(MEAL_EDIT_OCCUPANCY_ENABLED&&current)try{await releaseMealEdit(this.data.mealId,current)}catch{/* Automatic expiry handles disconnects. */}},
 async leave(url:string){this._closed=true;wx.disableAlertBeforeUnload();void this.release();const previous=getCurrentPages().slice(-2)[0] as WechatMiniprogram.Page.Instance<any,any>|undefined,date=/[?&]date=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(url)?.[1];if(previous?.route==='pages/records/records'&&typeof previous.prepareSavedReturn==='function'&&date){previous.prepareSavedReturn(date);backTo('/pages/records/records',this)}else navigateRoot(url)},
 async goBack(){if(this.data.busy)return;if(this.data.changed&&!this.data.invalidated&&!await confirmDiscard())return;this._closed=true;wx.disableAlertBeforeUnload();void this.release();backPage('/pages/records/records?date='+(this._baseline?localDate(new Date(this._baseline.occurredAt)):this.data.today),this)},
 onUnload(){this._closed=true;this._visible=false;this._searchSequence++;wx.disableAlertBeforeUnload();void this.release();this._pending=null;this._deletePending=null;this._baseline=null;this.data.items=[]},noop(){}
})
