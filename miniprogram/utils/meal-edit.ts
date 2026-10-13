import { request } from './api'
export interface SavedItem {mealItemId:string;foodId:string|null;selectedFoodRevisionId:string|null;observedName:string|null;consumedAmount:string;servedAmount:string|null;unit:string;status:string;weightOrigin:string;source:string;matchStatus?:'MATCHED'|'UNMATCHED'}
export interface SavedMeal {mealId:string;subjectId:string;revisionToken:string;mealType:string;occurredAt:string;status:string;notes:string|null;items:SavedItem[]}
export interface EditItem {key:string;original:SavedItem|null;foodId:string|null;selectedFoodRevisionId:string|null;name:string;input:string;raw:string;removed:boolean;touched:boolean;weightChanged:boolean;slider:number;snap:number|null;highPrecision:boolean;origin:string;served:string|null;unmatched?:boolean;matchReason?:string}
export const mealTypes=[{key:'BREAKFAST',label:'早餐'},{key:'LUNCH',label:'午餐'},{key:'DINNER',label:'晚餐'},{key:'SNACK',label:'加餐'},{key:'MILK_FEED',label:'奶餐'},{key:'OTHER',label:'其他'}]
export function localDate(value:Date){return value.getFullYear()+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0')}
// Exact millionth-gram arithmetic; guard JS integer precision rather than a food-weight policy cap.
export function gramUnits(value:string):number|null {
  if(!/^\d+(?:\.\d{1,6})?$/.test(value))return null
  const [whole,fraction='']=value.split('.');const units=Number(whole)*1000000+Number(fraction.padEnd(6,'0'))
  return Number.isSafeInteger(units)?units:null
}
export function exactGrams(units:number):string{if(!Number.isSafeInteger(units)||units<0)throw Error('克重超出精度范围');const whole=Math.floor(units/1000000),fraction=String(units%1000000).padStart(6,'0').replace(/0+$/,'');return String(whole)+(fraction?'.'+fraction:'')}
export function formatGrams(value:string){const u=gramUnits(value);if(u===null)return value;const tenths=Math.round(u/100000);return tenths===0&&u>0?value:String(tenths/10)}
export function equalGrams(a:string,b:string){const x=gramUnits(a),y=gramUnits(b);return x!==null&&y!==null&&x===y}
export function validNewWeight(value:string){const units=gramUnits(value);return /^\d+(?:\.\d)?$/.test(value)&&units!==null&&units>0}
export function sliderPosition(value:string){return Math.min(500,Math.max(0,Math.round(Number(value)||0)))}
export function snapWeight(value:number){const v=Math.min(500,Math.max(0,Math.round(value))),near=Math.round(v/50)*50;return near>=50&&Math.abs(v-near)<=6?near:null}
export function draftItem(item:SavedItem):EditItem {return {key:item.mealItemId,original:item,foodId:item.foodId,selectedFoodRevisionId:item.selectedFoodRevisionId,name:item.observedName||'已确认食品',input:formatGrams(item.consumedAmount),raw:item.consumedAmount,removed:false,touched:false,weightChanged:false,slider:sliderPosition(item.consumedAmount),snap:null,highPrecision:!equalGrams(formatGrams(item.consumedAmount),item.consumedAmount),origin:item.weightOrigin,served:item.servedAmount,unmatched:item.matchStatus==='UNMATCHED',matchReason:item.matchStatus==='UNMATCHED'?'NO_MATCH_NO_NUTRITION':undefined}}
export function adjustWeight(item:EditItem,value:string):EditItem {const changed=!item.original||!equalGrams(value,item.original.consumedAmount);return {...item,input:value,raw:changed?value:item.original!.consumedAmount,touched:true,weightChanged:changed,slider:sliderPosition(value),snap:null,origin:changed?'USER_ACCEPTED_ESTIMATE':item.original!.weightOrigin}}
export function totalUnits(items:EditItem[]):number|null {let total=0;for(const item of items.filter(i=>!i.removed)){const u=gramUnits(item.raw);if(u===null)return null;total+=u;if(!Number.isSafeInteger(total))return null}return total}
export function totalText(items:EditItem[]){const u=totalUnits(items);return u===null?'待核对':String(u/1000000)}
export function validateItems(items:EditItem[]){const active=items.filter(i=>!i.removed);if(!active.length)return '请至少保留一种食品，或使用删除整餐';for(const i of active){const u=gramUnits(i.raw);if(u===null)return i.name+'：克数格式无效或超出数字精度范围，请核对';if(u<=0)return i.name+'：请填写大于0的克数';if(i.weightChanged&&!validNewWeight(i.input))return i.name+'：新输入仅支持整数或1位小数'}const total=totalUnits(items);return total===null?'本餐合计超出数字精度范围，请核对克数':''}
export function weightNotice(total:string){const units=gramUnits(total);return units!==null&&units>300000000?'本餐合计'+total+'克，超过'+(units>1000000000?'1000':'300')+'克。请核对实际吃下总量；确认后仍可保存。':''}
export function changedItems(items:EditItem[]){return items.some(i=>i.original?i.removed||i.foodId!==i.original.foodId||i.weightChanged:!i.removed)}
export function itemPayload(items:EditItem[]){return items.filter(i=>!i.removed).map(i=>{const base={...(i.original?{mealItemId:i.original.mealItemId}:{}),observedName:i.name,consumedAmount:i.raw};if(!i.foodId){return {...base,matchStatus:'UNMATCHED',matchReason:i.matchReason||'NO_MATCH_NO_NUTRITION',source:'MANUAL',status:'CONFIRMED'}}return {...base,foodId:i.foodId,selectedFoodRevisionId:i.selectedFoodRevisionId}})}
export function operationId(){return 'meal-edit-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)}
export interface SavedResult {reportUpdate?:{status:string}}
export function recordSaved(result:SavedResult,action:string){wx.setStorageSync('foodmaster.trial.reportUpdateState',result.reportUpdate?.status||'FAILED');wx.setStorageSync('foodmaster.trial.mealSaved',true);wx.setStorageSync('foodmaster.trial.mealSavedAction',action);wx.setStorageSync('foodmaster.trial.reportNeedsRefresh',true)}
export async function deleteSavedMeal(meal:SavedMeal,pending:{operationId:string;expectedRevision:string;editToken?:string},alreadyConfirmed=false){
  const d=new Date(meal.occurredAt),label=localDate(d)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')
  const confirmed=alreadyConfirmed||await new Promise<boolean>(resolve=>wx.showModal({title:'删除这餐？',content:label+' · '+(meal.notes||mealTypes.find(t=>t.key===meal.mealType)?.label||'饮食记录')+'。删除后不再计入当前报告，历史版本保留。',confirmText:'删除这餐',confirmColor:'#d64d53',success:r=>resolve(r.confirm),fail:()=>resolve(false)}))
  if(!confirmed)return false
  const saved=await request<SavedResult>('/meals/'+meal.mealId,{method:'DELETE',data:pending});recordSaved(saved,'这餐已删除');return true
}
