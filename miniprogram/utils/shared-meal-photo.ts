import {getAuth,request,uploadMealPhoto} from './api'
import {familyGeneration,familyState} from './family-state'

const downloaded=new Map<string,number>()
let retrying=false
export function expireSharedPhotos(){let changed=false;for(const [p,expiry] of downloaded){if(expiry<=Date.now()){downloaded.delete(p);try{wx.getFileSystemManager().unlinkSync(p)}catch{}changed=true}}return changed}
const consentKey=(account:string,subject:string)=>'foodmaster.family-photo-consent.'+account+':'+subject
const pendingKey=(account:string)=>'foodmaster.family-photo-pending.'+account
interface PendingPhoto {mealId:string;subjectId:string;filePath:string;operationId:string;expiresAt:number}
export function hasCloudPhotoChoice(subject:string){const account=getAuth()?.accountId;return !!account&&!!wx.getStorageSync(consentKey(account,subject))}
export function cloudPhotoConsented(subject:string){const account=getAuth()?.accountId;return !!account&&wx.getStorageSync(consentKey(account,subject))==='FAMILY_PHOTO_V1'}
export function setCloudPhotoConsent(subject:string,accepted:boolean){const account=getAuth()?.accountId;if(!account)return;wx.setStorageSync(consentKey(account,subject),accepted?'FAMILY_PHOTO_V1':'DECLINED')}
function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3)|8).toString(16)})}
function queue(account:string):PendingPhoto[]{const value:unknown=wx.getStorageSync(pendingKey(account));return Array.isArray(value)?value as PendingPhoto[]:[]}
export function queueSharedMealPhoto(mealId:string,subjectId:string,filePath:string,expiresAt:number){
  const account=getAuth()?.accountId;if(!account||!cloudPhotoConsented(subjectId)||!filePath)return
  const rows=queue(account);if(!rows.some(r=>r.mealId===mealId))rows.push({mealId,subjectId,filePath,expiresAt:Math.min(expiresAt,Date.now()+30*86400000),operationId:uuid()})
  wx.setStorageSync(pendingKey(account),rows)
}
export async function retrySharedMealPhotos(){
  if(retrying)return
  const auth=getAuth(),active=familyState();if(!auth?.accountId||!active?.canRecord||active.sharedVersion==='legacy')return
  retrying=true
  try{
  const account=auth.accountId
  for(const row of queue(account)){
    if(familyState()?.subjectId!==active.subjectId||getAuth()?.clientSessionId!==auth.clientSessionId)return
    if(row.expiresAt<=Date.now()){wx.setStorageSync(pendingKey(account),queue(account).filter(r=>r.operationId!==row.operationId));continue}
    if(row.subjectId!==active.subjectId||!cloudPhotoConsented(row.subjectId)||row.expiresAt<=Date.now())continue
    try{await uploadMealPhoto(row.mealId,row.filePath,row.operationId)
      if(getAuth()?.clientSessionId!==auth.clientSessionId)return
      wx.setStorageSync(pendingKey(account),queue(account).filter(r=>r.operationId!==row.operationId))
    }catch{ /* Preserve same operation for explicit retry; meal is already saved. */ }
  }
  }finally{retrying=false}
}
export async function sharedMealPhoto(mealId:string,subjectId:string):Promise<string>{
  const auth=getAuth(),generation=familyGeneration();if(!auth?.accountId||familyState()?.subjectId!==subjectId)return ''
  const data=await request<{photo:{photoId:string;expiresAt:string}|null}>('/meals/'+mealId+'/photo')
  if(!data.photo)return ''
  const expires=Date.parse(data.photo.expiresAt);if(expires<=Date.now())return ''
  const prefix=wx.env.USER_DATA_PATH+'/family-photo-'+auth.accountId+'-'+subjectId+'-'+data.photo.photoId+'.'
  // Read the server's currently authorized metadata before looking at any cache.
  for(const ext of ['jpg','png','webp']){const cached=prefix+ext;try{wx.getFileSystemManager().accessSync(cached);if(familyGeneration()===generation&&getAuth()?.clientSessionId===auth.clientSessionId){downloaded.set(cached,expires);return cached}}catch{}}
  const bytes=await request<ArrayBuffer>('/meals/'+mealId+'/photo/'+data.photo.photoId,{responseType:'arraybuffer'})
  if(familyGeneration()!==generation||getAuth()?.clientSessionId!==auth.clientSessionId||expires<=Date.now())return ''
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength>5*1024*1024)throw Error('照片内容无效')
  const b=new Uint8Array(bytes),ext=b[0]===137?'png':b[0]===255?'jpg':b[0]===82?'webp':'';if(!ext)throw Error('照片格式无效')
  const path=wx.env.USER_DATA_PATH+'/family-photo-'+auth.accountId+'-'+subjectId+'-'+data.photo.photoId+'.'+ext
  await new Promise<void>((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:bytes,success:()=>resolve(),fail:reject}))
  if(familyGeneration()!==generation||getAuth()?.clientSessionId!==auth.clientSessionId||familyState()?.subjectId!==subjectId){try{wx.getFileSystemManager().unlinkSync(path)}catch{}return ''}
  downloaded.set(path,expires)
  return path // authorization and expiry are checked on every view; no unguarded disk fallback
}
