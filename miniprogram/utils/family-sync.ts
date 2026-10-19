import {abandonCurrentMeal} from './pending-meal'
import {expireSharedPhotos} from './shared-meal-photo'
import {ApiError,getAuth,request} from './api'
import {familyState,setFamilyState,invalidateFamilyState,FamilyContext} from './family-state'
import {refreshSessionContext} from './session'
import {navigateRoot} from './navigation'

let timer:ReturnType<typeof setInterval>|undefined,checking=false
function epoch(){wx.setStorageSync('foodmaster.recordEpoch',Number(wx.getStorageSync('foodmaster.recordEpoch')||0)+1)}
type VisiblePage=WechatMiniprogram.Page.Instance<Record<string,unknown>,Record<string,never>>&{loadMeals?:()=>Promise<void>;loadReport?:()=>Promise<void>;load?:()=>Promise<void>;_loaded?:boolean}
export function resetBabyEntryState(){
  abandonCurrentMeal()
  for(const key of ['mealPhoto','foodmaster.manualEntry','foodmaster.mealSaved','foodmaster.mealSavedAction','foodmaster.reportUpdateState'])wx.removeStorageSync(key)
}
export function purgeSharedPhotoCache(){
  const manager=wx.getFileSystemManager();try{for(const name of manager.readdirSync(wx.env.USER_DATA_PATH)){if(name.startsWith('family-photo-'))try{manager.unlinkSync(wx.env.USER_DATA_PATH+'/'+name)}catch{}}}catch{}
}
export function clearSharedPhotoFiles(subject?:string){
  const account=getAuth()?.accountId;if(!account)return
  const fs=wx.getFileSystemManager(),prefix='family-photo-'+account+'-'+(subject?subject+'-':'')
  try{for(const file of fs.readdirSync(wx.env.USER_DATA_PATH)){if(file.startsWith(prefix))try{fs.unlinkSync(wx.env.USER_DATA_PATH+'/'+file)}catch{}}}catch{}
}
export async function checkFamilyContext(){
  if(checking)return
  const old=familyState();if(!old||old.sharedVersion==='legacy'||!getAuth())return
  checking=true
  try{
    const ctx=await request<FamilyContext>('/family/subjects/'+old.subjectId+'/context')
    if(familyState()?.subjectId!==old.subjectId)return
    const expiredPhoto=expireSharedPhotos()
    if(ctx.sharedVersion===old.sharedVersion&&ctx.role===old.role&&!expiredPhoto)return
    setFamilyState(ctx);epoch()
    const app=getApp<IAppOption>(),previous=await app.globalData.ready
    if(previous&&previous.subjectId===ctx.subjectId)app.globalData.ready=Promise.resolve({...previous,current:ctx})
    const pages=getCurrentPages(),page=pages[pages.length-1] as unknown as VisiblePage|undefined
    if(!page)return
    page.setData({canRecord:ctx.canRecord,canManage:ctx.canManage})
    const d=page.data as {editing?:boolean;saving?:boolean;milkPanel?:{visible?:boolean};pendingMealBusy?:boolean;showPreferences?:boolean;showSharePanel?:boolean;savingPreferences?:boolean}
    if(d.showPreferences||d.showSharePanel||d.savingPreferences||d.editing||d.saving||d.milkPanel?.visible||d.pendingMealBusy||/meal-edit|result|camera/.test(page.route)){
      wx.showToast({title:'共享资料已有更新，当前输入已保留，保存时会再次核对',icon:'none',duration:2500});return
    }
    if(page.route==='pages/family/family')return // family page polls its complete approval list separately
    if(page.loadMeals)await page.loadMeals();else if(page.loadReport)await page.loadReport();else if(page.load){
      if(['pages/report-overview/report-overview','pages/milk-trend/milk-trend'].includes(page.route))page.setData({periodId:''})
      page._loaded=false;await page.load()
    }
  }catch(e){
    if(e instanceof ApiError&&e.statusCode===403&&familyState()?.subjectId===old.subjectId){
      resetBabyEntryState();invalidateFamilyState();clearSharedPhotoFiles(old.subjectId);epoch()
      // Clear every retained page before returning; revoked views must never be
      // reused from an earlier navigation stack or late request.
      for(const page of getCurrentPages())page.setData({hasMenu:false,days:[],currentDay:null,recipe:null,imagePath:'',showImageViewer:false,showSharePanel:false,canManageMenu:false,source:null,hasResult:false,hasRecords:false,meals:[],selectedMeal:null,milkItems:[],records:[],nutrients:[],allNutrients:[],observations:[],observationCards:[],knowledge:[],dates:[],loading:true,subjectId:'',babyName:'宝宝',name:'宝宝',birthDate:'',ageText:'',canRecord:false,canManage:false,errorMessage:'宝宝权限已变更，请重新选择'})
      await refreshSessionContext();wx.showToast({title:'共享宝宝已不可访问，已返回可用宝宝',icon:'none'});navigateRoot('/pages/profile/profile')
    }else{const pages=getCurrentPages();pages[pages.length-1]?.setData({familySyncMessage:'共享更新尚未核对，请检查网络后重试'})}
  }finally{checking=false}
}
export function startFamilySync(){stopFamilySync();void checkFamilyContext();timer=setInterval(()=>{void checkFamilyContext()},30000)}
export function stopFamilySync(){if(timer)clearInterval(timer);timer=undefined}
