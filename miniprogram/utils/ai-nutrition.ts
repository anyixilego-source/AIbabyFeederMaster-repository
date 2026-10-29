import {request,getAuth} from './api'
import {familyState} from './family-state'
export const AI_NUTRITION_POLICY='AI_FOOD_NUTRITION_V1'
export const AI_ALGORITHM_NOTICE='AI估算值与资料计算量合并，按合计判断是否达到适用参考值；AI结果可能有偏差。'
export interface AiSaveItem {foodId?:string|null;observedName?:string|null;name?:string;localId?:string;mealItemId?:string;aiFoodNutritionId?:string|null;nutritionSource?:string;[key:string]:unknown}
interface AiReply {localId:string;status:string;estimate?:{id:string;payload:{name:string;form:string|null}};message?:string;diagnostic?:{code:string;meaning:string}}
interface Draft {createdAt:number;identity:string;operationId:string;choice?:boolean;results:Record<string,string>}
const modal=(title:string,content:string,confirmText:string,cancelText:string)=>new Promise<boolean>(resolve=>wx.showModal({title,content,confirmText,cancelText,success:r=>resolve(r.confirm),fail:()=>resolve(false)}))
const itemId=(i:AiSaveItem,index:number)=>i.localId||i.mealItemId||'item-'+index
const itemName=(i:AiSaveItem)=>String(i.observedName||i.name||'').trim()
function apply(items:AiSaveItem[],replies:AiReply[]){return items.map((i,index)=>{if(i.foodId||i.aiFoodNutritionId||i.nutritionSource==='NONE')return i;const found=replies.find(r=>r.localId===itemId(i,index)&&r.status==='READY'&&r.estimate);return found?{...i,aiFoodNutritionId:found.estimate!.id,nutritionSource:'AI_ESTIMATE',matchStatus:'UNMATCHED',matchReason:'AI_ESTIMATE'}:i})}
export async function cachedAiNutrition(subject:string,items:AiSaveItem[]):Promise<AiSaveItem[]>{
 const needed=items.flatMap((i,index)=>!i.foodId&&!i.aiFoodNutritionId&&i.nutritionSource!=='NONE'?[{localId:itemId(i,index),name:itemName(i),form:null}]:[])
 if(!needed.length)return items
 const result=await request<{items:AiReply[]}>('/subjects/'+subject+'/ai-food-nutrition/lookup',{method:'POST',data:{items:needed}})
 return apply(items,result.items)
}
export async function prepareAiNutrition(subject:string,original:AiSaveItem[],isCurrent:()=>boolean=()=>true,progress:(text:string)=>void=()=>{},intent=''):Promise<AiSaveItem[]>{
 const auth=getAuth(),who=JSON.stringify([auth?.accountId,auth?.clientSessionId]),current=()=>isCurrent()&&who===JSON.stringify([getAuth()?.accountId,getAuth()?.clientSessionId])&&(!familyState()?.subjectId||familyState()?.subjectId===subject)
 const guard=()=>{if(familyState()?.canRecord===false)throw Error('当前权限已变化，不能生成或保存记录');if(!current())throw Error('宝宝、账号或页面状态已变化，请重新打开记录')}
 guard();let items=original
 try{items=await cachedAiNutrition(subject,items)}catch(e){guard();/* A lookup failure does not remove the name-only recording path. */}
 guard();let pending=items.map((i,index)=>({i,index})).filter(x=>!x.i.foodId&&!x.i.aiFoodNutritionId&&x.i.nutritionSource!=='NONE')
 if(!pending.length)return items
 const identity=JSON.stringify([intent,pending.map(x=>[itemId(x.i,x.index),itemName(x.i)])]),key='foodmaster.aiNutritionDraft.'+(auth?.accountId||auth?.clientSessionId||'')+':'+subject
 let draft=wx.getStorageSync(key) as Draft|undefined
 if(!draft||draft.identity!==identity||!draft.createdAt||Date.now()-draft.createdAt>86400000)draft={createdAt:Date.now(),identity,operationId:'ai-food-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12),results:{}}
 const store=()=>{guard();wx.setStorageSync(key,draft)}
 if(draft.choice===undefined){draft.choice=await modal('为'+pending.length+'项食物估算营养？',pending.slice(0,4).map(x=>itemName(x.i)).join('、')+(pending.length>4?'等':'')+'。\n'+AI_ALGORITHM_NOTICE+'\n只发送食物名和做法，并复用去个人信息的估算资料；不发送宝宝资料或照片。','估算保存','仅记名称');guard();store()}
 if(!draft.choice)return items.map((i,index)=>pending.some(x=>x.index===index)?{...i,nutritionSource:'NONE',aiFoodNutritionId:null}:i)
 items=items.map((i,index)=>draft!.results[itemId(i,index)]?{...i,aiFoodNutritionId:draft!.results[itemId(i,index)],nutritionSource:'AI_ESTIMATE',matchStatus:'UNMATCHED',matchReason:'AI_ESTIMATE'}:i)
 for(;;){
  guard();pending=items.map((i,index)=>({i,index})).filter(x=>!x.i.foodId&&!x.i.aiFoodNutritionId&&x.i.nutritionSource!=='NONE')
  if(!pending.length)return items
  const failed:string[]=[]
  for(let offset=0;offset<pending.length;offset+=5){
   guard();const group=pending.slice(offset,offset+5);progress('营养估算 '+Math.min(offset+group.length,pending.length)+'/'+pending.length)
   const data={operationId:draft.operationId,accepted:true,policyVersion:AI_NUTRITION_POLICY,allowGenerate:true,items:group.map(x=>({localId:itemId(x.i,x.index),name:itemName(x.i),form:null}))}
   let result:{items:AiReply[]}
   try{result=await request('/subjects/'+subject+'/ai-food-nutrition/resolve-batch',{method:'POST',data,timeout:70000})}
   catch(e){guard();try{result=await request('/subjects/'+subject+'/ai-food-nutrition/operations/'+encodeURIComponent(draft.operationId))}catch{result={items:[]}}for(const entry of group)if(!result.items.some(r=>r.localId===itemId(entry.i,entry.index)))result.items.push({localId:itemId(entry.i,entry.index),status:'FAILED',message:e instanceof Error?e.message:'请求未完成，请重试'})}
   guard();items=apply(items,result.items)
   for(const entry of group){const bound=items[entry.index]!;if(bound.aiFoodNutritionId)draft.results[itemId(entry.i,entry.index)]=bound.aiFoodNutritionId;else{const r=result.items.find(r=>r.localId===itemId(entry.i,entry.index));failed.push(itemName(entry.i)+(r?.diagnostic?'（'+r.diagnostic.code+'：'+r.diagnostic.meaning+'）':r?.message?'（'+r.message+'）':r?.status==='GENERATING'?'（仍在生成，请稍候重试）':''))}}
   store()
  }
  if(!failed.length){progress('正在保存');return items}
  const retry=await modal('部分食物暂未估算成功',failed.slice(0,3).join('、')+'。成功项已保留。可重试失败项，或按现有结果保存，失败项仍只记名称。','重试失败','保留名称')
  guard();if(!retry)return items.map(i=>!i.foodId&&!i.aiFoodNutritionId?{...i,nutritionSource:'NONE'}:i)
 }
}
