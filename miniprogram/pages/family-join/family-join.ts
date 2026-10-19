import {clearSharedPhotoFiles,resetBabyEntryState} from '../../utils/family-sync'
import {invalidateFamilyState} from '../../utils/family-state'
import {ApiError,request} from '../../utils/api'
import {ensureSessionContext,refreshSessionContext} from '../../utils/session'
import {navigateRoot} from '../../utils/navigation'
Page({
 data:{loading:true,busy:false,errorMessage:'',displayName:'',roleLabel:'',state:'',approvedSubject:''},_token:'',_sequence:0,
 onLoad(q:Record<string,string>){this._token=q.invite||'';void this.load()},onShow(){if(this._token&&!this.data.loading)void this.load()},onUnload(){this._token='';++this._sequence},
 async load(){const seq=++this._sequence;this.setData({loading:true,errorMessage:''});try{
   await(getApp<IAppOption>().globalData.ready||ensureSessionContext())
   const r=await request<{role:string;displayName:string;state:string;subjectId:string|null}>('/family/invitations/preview',{method:'POST',data:{inviteToken:this._token}})
   if(seq!==this._sequence)return
   this.setData({displayName:this.data.displayName||r.displayName,roleLabel:r.role==='CAREGIVER'?'可记录':'仅查看',state:r.state,approvedSubject:r.subjectId||''})
 }catch(e){if(seq===this._sequence)this.setData({errorMessage:e instanceof ApiError&&e.statusCode===404?'邀请已失效或当前后台尚未启用家庭协作，请联系邀请人':e instanceof Error?e.message:'邀请暂时无法读取'})}finally{if(seq===this._sequence)this.setData({loading:false})}},
 setName(e:WechatMiniprogram.Input){this.setData({displayName:e.detail.value})},
 async apply(){if(this.data.busy)return;this.setData({busy:true});try{await request('/family/invitations/apply',{method:'POST',data:{inviteToken:this._token,displayName:this.data.displayName}});this.setData({state:'PENDING'})}catch(e){wx.showModal({title:'申请未完成',content:e instanceof Error?e.message:'请重试',showCancel:false})}finally{this.setData({busy:false})}},
 async enter(){if(!this.data.approvedSubject)return;resetBabyEntryState();clearSharedPhotoFiles();invalidateFamilyState();await refreshSessionContext(this.data.approvedSubject);this._token='';navigateRoot('/pages/records/records')},
 goBack(){this._token='';navigateRoot('/pages/profile/profile')},
})
