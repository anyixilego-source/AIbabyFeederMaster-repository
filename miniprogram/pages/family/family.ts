import {ApiError,getAuth,request,clearAuth} from '../../utils/api'
import {refreshSessionContext} from '../../utils/session'
import {FamilyContext,invalidateFamilyState} from '../../utils/family-state'
import {clearSharedPhotoFiles,checkFamilyContext,resetBabyEntryState} from '../../utils/family-sync'
import {cloudPhotoConsented,setCloudPhotoConsent,retrySharedMealPhotos} from '../../utils/shared-meal-photo'
import {ageDisplay} from '../../utils/age'
import {backPage,navigateRoot} from '../../utils/navigation'

interface Member {isSelf?:boolean;accountId:string;displayName:string;role:string;roleLabel:string}
interface Invite {invitationId:string;displayName:string;applicantName?:string;applicationStatus?:string;role:string;expiresAt:string;status:string}
interface Session {sessionId:string;deviceLabel:string;createdAt:string;lastUsedAt:string|null;current:boolean;timeText:string}
function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return(c==='x'?r:(r&3)|8).toString(16)})}
const roles:Record<string,string>={OWNER:'管理员',CAREGIVER:'可记录',VIEWER:'仅查看'}
function confirm(title:string,content:string){return new Promise<boolean>(resolve=>wx.showModal({title,content,success:r=>resolve(r.confirm),fail:()=>resolve(false)}))}
Page({
  data:{loading:true,busy:false,errorMessage:'',subjectId:'',babyName:'宝宝',ageText:'',roleLabel:'',canManage:false,
    members:[] as Member[],invitations:[] as Invite[],sessions:[] as Session[],sessionPanel:false,showInfo:false,
    invitePanel:false,inviteRole:'CAREGIVER',inviteName:'',shareReady:false,inviteExpires:'',photoConsent:false,photoBusy:false,
    canSwitch:false,canLeave:false,memberPanel:false,selfNamePanel:false,memberId:'',memberName:'',memberRole:'CAREGIVER'},
  _sequence:0,_poll:undefined as ReturnType<typeof setInterval>|undefined,_context:null as FamilyContext|null,_inviteToken:'',_operation:'',
  onShow(){void this.load();this._poll=setInterval(()=>{if(!this.data.busy&&!this.data.invitePanel&&!this.data.memberPanel)void this.load()},30000)},
  onHide(){if(this._poll)clearInterval(this._poll);this._poll=undefined;++this._sequence},
  onUnload(){if(this._poll)clearInterval(this._poll);this._inviteToken='';++this._sequence},
  async load(){
    const sequence=++this._sequence;this.setData({errorMessage:''})
    try{const ctx=await refreshSessionContext()
      if(!ctx.subjectId){this.setData({loading:false,canSwitch:ctx.subjects.length>1,errorMessage:ctx.subjects.length>1?'请选择当前宝宝':'请先创建宝宝档案，或从家人分享的邀请进入',subjectId:''});return}
      const [detail,sessions]=await Promise.all([request<{context:FamilyContext;members:Member[];invitations:Invite[]}>('/family/subjects/'+ctx.subjectId),request<Session[]>('/identity/sessions')])
      if(sequence!==this._sequence)return
      this._context=detail.context
      this.setData({loading:false,subjectId:ctx.subjectId,babyName:detail.context.displayName,ageText:ageDisplay(detail.context.birthDate),
        roleLabel:roles[detail.context.role],canManage:detail.context.canManage,canLeave:detail.context.role!=='OWNER',canSwitch:ctx.subjects.length>1,
        photoConsent:cloudPhotoConsented(ctx.subjectId),members:detail.members.map(m=>({...m,isSelf:m.accountId===getAuth()?.accountId,roleLabel:roles[m.role]||'仅查看'})),invitations:detail.invitations,
        sessions:sessions.map(s=>({...s,timeText:new Date(s.lastUsedAt||s.createdAt).toLocaleString('zh-CN')}))})
    }catch(e){if(sequence===this._sequence)this.setData({loading:false,members:[],invitations:[],errorMessage:e instanceof ApiError&&e.statusCode===404?'家庭协作尚未在当前后台启用':e instanceof Error?e.message:'暂时无法读取家庭资料'})}
  },
  async switchBaby(){
    if(this.data.busy)return
    const ctx=await refreshSessionContext(),choices=ctx.subjects
    if(choices.length<2)return
    wx.showActionSheet({itemList:choices.map(s=>s.displayName+(s.subjectId===ctx.subjectId?'（当前）':'')),success:async r=>{
      const target=choices[r.tapIndex];if(!target||target.subjectId===ctx.subjectId)return
      const editing=getCurrentPages().some(p=>{const d=p.data as {editing?:boolean;saving?:boolean;milkPanel?:{visible?:boolean}};return d.editing||d.saving||d.milkPanel?.visible||/pages\/(result|meal-edit)\//.test(p.route)})
      if(editing&&!await confirm('切换宝宝','其他页面有未保存输入。切换会离开这些页面；如需继续编辑，请取消切换。已提交但待核对的操作仍保留在原宝宝。'))return
      if(!await confirm('切换宝宝','切换到“'+target.displayName+'”？记录和报告将按这个宝宝展示。'))return
      this.setData({busy:true});try{resetBabyEntryState();clearSharedPhotoFiles();invalidateFamilyState();await refreshSessionContext(target.subjectId);wx.setStorageSync('foodmaster.recordEpoch',Number(wx.getStorageSync('foodmaster.recordEpoch')||0)+1);navigateRoot('/pages/profile/profile')}
      catch(e){this.setData({errorMessage:e instanceof Error?e.message:'切换失败'});await refreshSessionContext().catch(()=>{})}finally{this.setData({busy:false})}
    }})
  },
  openInvite(){this._inviteToken='';this._operation=uuid();this.setData({invitePanel:true,shareReady:false,inviteName:'',inviteRole:'CAREGIVER'})},
  closeInvite(){if(!this.data.busy){this._inviteToken='';this.setData({invitePanel:false,shareReady:false})}},
  setInviteName(e:WechatMiniprogram.Input){this.setData({inviteName:e.detail.value})},
  setInviteRole(e:WechatMiniprogram.TouchEvent){this.setData({inviteRole:String(e.currentTarget.dataset.role)})},
  async createInvite(){if(this.data.busy)return;this.setData({busy:true});try{
    const r=await request<{inviteToken:string;expiresAt:string}>('/family/subjects/'+this.data.subjectId+'/invitations',{method:'POST',data:{role:this.data.inviteRole,displayName:this.data.inviteName,operationId:this._operation}})
    this._inviteToken=r.inviteToken;this.setData({shareReady:true,inviteExpires:r.expiresAt.slice(0,10)})
  }catch(e){wx.showModal({title:'邀请尚未准备好',content:e instanceof Error?e.message:'请重试',showCancel:false})}finally{this.setData({busy:false})}},
  onShareAppMessage(){return this._inviteToken?{title:'邀请你一起照护宝宝',path:'/pages/family-join/family-join?invite='+encodeURIComponent(this._inviteToken)}:{title:'宝宝辅食识别规划大师',path:'/pages/index/index'}},
  async invitationAction(e:WechatMiniprogram.TouchEvent){
    const id=String(e.currentTarget.dataset.id),action=String(e.currentTarget.dataset.action);if(this.data.busy)return
    if(!await confirm(action==='approve'?'批准加入':action==='reject'?'拒绝申请':'撤销邀请','请与家人核对申请称呼后再批准。批准后，对方可查看本宝宝既有记录。'))return
    this.setData({busy:true});try{await request('/family/subjects/'+this.data.subjectId+'/invitations/'+id+(action==='revoke'?'':'/'+action),{method:action==='revoke'?'DELETE':'POST'});await this.load();await checkFamilyContext()}
    catch(e){wx.showModal({title:'操作未完成',content:e instanceof Error?e.message:'请重试',showCancel:false})}finally{this.setData({busy:false})}
  },
  async saveSelfName(){if(this.data.busy||!this._context)return;this.setData({busy:true});try{await request('/family/subjects/'+this.data.subjectId+'/my-name',{method:'PATCH',data:{displayName:this.data.memberName,expectedVersion:this._context.sharedVersion}});this.setData({memberPanel:false,selfNamePanel:false});await this.load()}catch(e){wx.showModal({title:'称呼未保存',content:e instanceof Error?e.message:'请重试',showCancel:false})}finally{this.setData({busy:false})}},
  openMember(e:WechatMiniprogram.TouchEvent){const own=this.data.members.find(x=>x.accountId===e.currentTarget.dataset.id);if(own?.isSelf){this.setData({memberPanel:true,selfNamePanel:true,memberId:own.accountId,memberName:own.displayName});return}if(!this.data.canManage)return;const m=this.data.members.find(x=>x.accountId===e.currentTarget.dataset.id);if(!m||m.role==='OWNER')return;this.setData({memberPanel:true,selfNamePanel:false,memberId:m.accountId,memberName:m.displayName,memberRole:m.role})},
  closeMember(){if(!this.data.busy)this.setData({memberPanel:false})},
  setMemberName(e:WechatMiniprogram.Input){this.setData({memberName:e.detail.value})},
  setMemberRole(e:WechatMiniprogram.TouchEvent){this.setData({memberRole:String(e.currentTarget.dataset.role)})},
  async saveMember(){await this.changeMember(false)},async removeMember(){await this.changeMember(true)},
  async leave(){const id=getAuth()?.accountId;if(!id)return;this.setData({memberId:id});await this.changeMember(true)},
  async changeMember(remove:boolean){if(this.data.busy||!this._context)return
    if(remove&&!await confirm('移除照护权限','对方将不能再访问此宝宝；已创建的历史记录会保留。'))return
    this.setData({busy:true});try{await request('/family/subjects/'+this.data.subjectId+'/members/'+this.data.memberId,{method:remove?'DELETE':'PATCH',data:{expectedVersion:this._context.sharedVersion,role:this.data.memberRole,displayName:this.data.memberName}})
      this.setData({memberPanel:false});if(this.data.memberId===getAuth()?.accountId){resetBabyEntryState();clearSharedPhotoFiles(this.data.subjectId);invalidateFamilyState();await refreshSessionContext();navigateRoot('/pages/profile/profile')}else{await this.load();await checkFamilyContext()}
    }catch(e){wx.showModal({title:'操作未完成',content:e instanceof Error?e.message:'请重试',showCancel:false});await this.load()}finally{this.setData({busy:false})}
  },
  toggleSessions(){this.setData({sessionPanel:!this.data.sessionPanel})},
  async revokeSession(e:WechatMiniprogram.TouchEvent){if(this.data.busy)return;const id=String(e.currentTarget.dataset.id),s=this.data.sessions.find(x=>x.sessionId===id);if(!s||!await confirm('退出登录会话',s.current?'将退出当前登录。':'该会话及刷新产生的后续登录令牌都会失效。'))return
    this.setData({busy:true});try{await request('/identity/sessions/'+id,{method:'DELETE'});if(s.current){clearSharedPhotoFiles();invalidateFamilyState();clearAuth();getApp<IAppOption>().globalData={};navigateRoot('/pages/index/index')}else await this.load()}
    catch(e){wx.showModal({title:'退出未完成',content:e instanceof Error?e.message:'请重试',showCancel:false})}finally{this.setData({busy:false})}
  },
  async togglePhoto(){if(!this._context||this.data.busy)return
    const next=!this.data.photoConsent
    if(next&&!await confirm('家庭照片同步','同意后，新保存的餐食照片会上传私有云端，供本宝宝有查看权限的照护者查看，默认保留30天。到期图片删除、餐食记录保留。不补传过去照片，识别用途和本地保存期限分别处理。'))return
    setCloudPhotoConsent(this.data.subjectId,next);this.setData({photoConsent:next})
  },
  async retryPhotos(){this.setData({photoBusy:true});try{await retrySharedMealPhotos();wx.showToast({title:'已尝试同步，失败项会保留待重试',icon:'none'})}finally{this.setData({photoBusy:false})}},
  toggleInfo(){this.setData({showInfo:!this.data.showInfo})},
  goBack(){backPage('/pages/profile/profile',this)},noop(){},
})
