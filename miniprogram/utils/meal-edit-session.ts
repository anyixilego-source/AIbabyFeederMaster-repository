import { ApiError,request } from './api'
import { operationId } from './meal-edit'

// Paused by yzk for small-group testing; re-enable only after the performance专项 is accepted.
export const MEAL_EDIT_OCCUPANCY_ENABLED:boolean=false

export interface EditSession {editToken:string;expiresAt:string;serverNow:string;revisionToken:string;validUntil:number}
interface SessionResponse {editToken:string;expiresAt:string;serverNow:string;revisionToken:string}
// Memory only: no draft, token in URL/storage, or cross-session resumption.
const reserved=new Map<string,EditSession>()
function session(value:SessionResponse):EditSession {
  return {...value,validUntil:Date.now()+Math.max(0,Date.parse(value.expiresAt)-Date.parse(value.serverNow))-2000}
}
export async function reserveMealEdit(mealId:string) {
  if(!MEAL_EDIT_OCCUPANCY_ENABLED)throw Error('编辑占用检查暂未启用')
  const body={sessionId:operationId()};let value:SessionResponse
  try{value=await request<SessionResponse>('/meals/'+mealId+'/edit-session',{method:'POST',data:body})}
  catch(e){if(e instanceof ApiError&&e.statusCode>0&&e.statusCode<500)throw e;value=await request<SessionResponse>('/meals/'+mealId+'/edit-session',{method:'POST',data:body})}
  const acquired=session(value)
  reserved.set(mealId,acquired);return acquired
}
export function takeMealEdit(mealId:string){const value=reserved.get(mealId);reserved.delete(mealId);return value}
export async function renewMealEdit(mealId:string,current:EditSession){if(!MEAL_EDIT_OCCUPANCY_ENABLED)throw Error('编辑占用检查暂未启用');return session(await request<SessionResponse>('/meals/'+mealId+'/edit-session',{method:'PATCH',data:{editToken:current.editToken}}))}
export async function releaseMealEdit(mealId:string,current:EditSession){
  if(reserved.get(mealId)?.editToken===current.editToken)reserved.delete(mealId)
  if(!MEAL_EDIT_OCCUPANCY_ENABLED)return
  await request('/meals/'+mealId+'/edit-session',{method:'DELETE',data:{editToken:current.editToken}})
}
export function editReason(error:unknown) {
  return error instanceof ApiError&&error.data&&typeof error.data==='object'?(error.data as {reasonCode?:string}).reasonCode:''
}
export function editUnavailable(error:unknown){return error instanceof ApiError&&(error.statusCode===409||error.statusCode===401||error.statusCode===403||error.statusCode===404)}
