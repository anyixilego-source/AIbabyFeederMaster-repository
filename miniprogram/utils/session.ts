import { ApiError, AuthSession, getAuth, request, setAuth, reviewEnvironment } from './api'
import {FamilyContext,setFamilyState} from './family-state'

export interface HouseholdSummary {householdId:string;name?:string;role?:string}
export interface SubjectSummary {
  subjectId:string;displayName:string;birthDate:string;sex:'FEMALE'|'MALE'|'UNSPECIFIED'
  householdId?:string;role?:string;canRecord?:boolean;canManage?:boolean;sharedVersion?:string
}
export interface SessionContext {
  householdId:string|null;subjectId:string|null;households:HouseholdSummary[];subjects:SubjectSummary[]
  current?:FamilyContext
}
function wechatCode():Promise<string>{return new Promise((resolve,reject)=>wx.login({success:({code})=>code?resolve(code):reject(Error('微信登录未返回code')),fail:reject}))}
async function login(){const code=await wechatCode();setAuth(await request<AuthSession>('/identity/wechat/login',{method:'POST',auth:false,data:{code,displayName:'微信用户',deviceLabel:'微信小程序'}}))}
function selectionKey(){const account=getAuth()?.accountId;if(!account)throw Error('请重新登录');return 'foodmaster.current-baby.'+account}
async function loadSessionContext(preferred?:string):Promise<SessionContext>{
  if(!getAuth())await login()
  let households:HouseholdSummary[]
  try{households=await request<HouseholdSummary[]>('/households')}catch(e){if(getAuth())throw e;await login();households=await request<HouseholdSummary[]>('/households')}
  let choices:FamilyContext[]
  try{choices=await request<FamilyContext[]>('/family/subjects')}
  catch(e){
    if(!(e instanceof ApiError)||e.statusCode!==404)throw e
    // Local development precedes cloud deployment. Keep the current single-user
    // server usable without pretending that its family capability is available.
    choices=[]
    for(const h of households){const subjects=await request<SubjectSummary[]>('/households/'+h.householdId+'/subjects');choices.push(...subjects.map(s=>({...s,householdId:h.householdId,sharedVersion:'legacy',role:h.role==='OWNER'?'OWNER':'VIEWER',canManage:h.role==='OWNER',canRecord:h.role==='OWNER'} as FamilyContext)))}
  }
  const review=reviewEnvironment()
  const selected=preferred||review?.subjectId||String(wx.getStorageSync(selectionKey())||'')
  if(preferred&&!choices.some(s=>s.subjectId===preferred))throw Error('该宝宝已不可访问，请刷新列表')
  if(review?.subjectId&&!choices.some(s=>s.subjectId===review.subjectId))throw Error('验证宝宝已不可用')
  const current=choices.find(s=>s.subjectId===selected)||choices.find(s=>s.canManage)||(choices.length===1?choices[0]:undefined)
  const householdId=current?.householdId||review?.householdId||households.find(h=>h.role==='OWNER')?.householdId||households[0]?.householdId||null
  if(current)wx.setStorageSync(selectionKey(),current.subjectId);else wx.removeStorageSync(selectionKey())
  setFamilyState(current||null)
  return {householdId,subjectId:current?.subjectId||null,households,subjects:choices as SubjectSummary[],current}
}
export function ensureSessionContext(){return loadSessionContext()}
export function refreshSessionContext(preferred?:string):Promise<SessionContext>{
  const app=getApp<IAppOption>()
  const ready=loadSessionContext(preferred).then(ctx=>{if(app.globalData.ready===ready){app.globalData.householdId=ctx.householdId||undefined;app.globalData.subjectId=ctx.subjectId||undefined}return ctx})
    .catch((e:unknown)=>{if(app.globalData.ready===ready)app.globalData.ready=undefined;throw e})
  app.globalData.ready=ready;return ready
}
