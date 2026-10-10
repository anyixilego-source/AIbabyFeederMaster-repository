import {request,reviewEnvironment,downloadPrivateRecipeImage,cachedPrivateCollectionImage} from '../../utils/api'
import {ensureSessionContext} from '../../utils/session'
import {backPage,openPage,backTo} from '../../utils/navigation'
import {operationId,menuRisk,type MenuRecipe} from '../../utils/diet-plan'
interface CollectionItem {dishFingerprint:string;name:string;recipe:MenuRecipe;imageId:string|null;imageUrl:string|null;imagePath:string;imageLoading:boolean;imageRepairing:boolean;imageFailed:boolean;imageMessage:string}
interface PictureState {status:string;imageId:string|null;imageUrl:string|null;message:string}
Page({
 data:{loading:true,errorMessage:'',subjectId:'',babyName:'宝宝',items:[] as CollectionItem[],busy:'',confirming:'',mode:'LIST',detailKey:'',recipe:null as MenuRecipe|null,recipeCollectionView:true,showRecipeInfo:false,risk:menuRisk,imagePath:'',imageMessage:'',imageGenerating:false,imageStatus:'',detailLoading:false,consentVersion:'',reviewLabel:reviewEnvironment()?.label||''},
 _sequence:0,_detailEpoch:0,_entrySubject:'',_operations:{} as Record<string,string>,
 onLoad(options:Record<string,string>){if(options.recipe){this._entrySubject=options.subjectId||'';this.setData({mode:'RECIPE',detailKey:options.recipe})}},
 onShow(){void this.load()},onHide(){++this._sequence;++this._detailEpoch;this.setData({confirming:'',busy:''})},onUnload(){++this._sequence;++this._detailEpoch},
 async load(){
  const seq=++this._sequence;this.setData({loading:true,errorMessage:'',confirming:'',busy:''});if(this.data.mode==='RECIPE')this.setData({recipe:null});
  try{
   const app=getApp<IAppOption>(),ctx=await(app.globalData.ready||ensureSessionContext());if(seq!==this._sequence)return;
   if(!ctx.subjectId)throw Error('请先建立宝宝档案');
   if(this._entrySubject&&ctx.subjectId!==this._entrySubject){this.setData({recipe:null,items:[]});throw Error('请切换至收藏菜品对应的宝宝')}
   if(ctx.subjectId!==this.data.subjectId){this._operations={};if(this.data.subjectId){++this._detailEpoch;this.setData({mode:'LIST',detailKey:'',recipe:null,showRecipeInfo:false})}this.setData({items:[],busy:''})}
   this.setData({subjectId:ctx.subjectId,babyName:ctx.subjects.find(s=>s.subjectId===ctx.subjectId)?.displayName||'宝宝'});
   if(this.data.mode==='RECIPE'){await this.loadDetail(this.data.detailKey,seq);return}
   const v=await request<{items:CollectionItem[];consentVersion:string}>('/subjects/'+ctx.subjectId+'/diet-collections');if(seq!==this._sequence)return;
   const items=v.items.map(i=>{const file=i.imageUrl?cachedPrivateCollectionImage(i.imageUrl):'';return {...i,imagePath:file,imageLoading:!file,imageRepairing:!file&&!i.imageUrl,imageFailed:false,imageMessage:''}});
   this.setData({items,consentVersion:v.consentVersion});void this.loadImages(seq);
  }catch(e){if(seq===this._sequence)this.setData({errorMessage:e instanceof Error?e.message:'收藏暂未加载'})}
  finally{if(seq===this._sequence)this.setData({loading:false})}
 },
 async loadImages(seq:number){
  const pending=this.data.items.filter(i=>!i.imagePath).map(i=>i.dishFingerprint);let index=0;
  const worker=async()=>{while(index<pending.length&&seq===this._sequence)await this.loadImage(pending[index++],seq)};
  await Promise.all([worker(),worker()]);
 },
 async loadImage(key:string,seq:number){
  let item=this.data.items.find(i=>i.dishFingerprint===key);if(!item||seq!==this._sequence)return;
  this.patchImage(key,{imageLoading:true,imageRepairing:!item.imageUrl,imageFailed:false,imageMessage:''});
  try{
   let file='';
   if(item.imageUrl&&item.imageId){try{file=cachedPrivateCollectionImage(item.imageUrl)||await downloadPrivateRecipeImage(item.imageUrl)}catch{/* Server checks whether the recorded picture is still available. */}}
   if(seq!==this._sequence)return;
   if(!file){
    const url='/subjects/'+this.data.subjectId+'/diet-collections/'+key+'/image';
    const operation=this._operations[key]||(this._operations[key]=operationId());
    let state=await request<PictureState>(url,{method:'POST',data:{operationId:operation,consentVersion:this.data.consentVersion}});
    for(let attempt=0;['QUEUED','RUNNING'].includes(state.status)&&attempt<90;attempt++){
     if(seq!==this._sequence||!this.data.items.some(i=>i.dishFingerprint===key))return;
     this.patchImage(key,{imageRepairing:true,imageMessage:state.status==='QUEUED'?'排队补图中…':'正在补图…'});
     await new Promise<void>(resolve=>setTimeout(resolve,2000));if(seq!==this._sequence)return;
     state=await request<PictureState>(url);
    }
    if(seq!==this._sequence)return;
    if(state.status!=='READY'||!state.imageUrl||!state.imageId){delete this._operations[key];throw Error(['QUEUED','RUNNING'].includes(state.status)?'补图仍在排队，点击图片继续查看':state.message||'暂未补好图片，点击图片重试')}
    this.patchImage(key,{imageId:state.imageId,imageUrl:state.imageUrl,imageRepairing:false,imageMessage:''});
    file=cachedPrivateCollectionImage(state.imageUrl)||await downloadPrivateRecipeImage(state.imageUrl);delete this._operations[key];
   }
   if(seq!==this._sequence)return;item=this.data.items.find(i=>i.dishFingerprint===key);if(!item)return;
   this.patchImage(key,{imagePath:file,imageLoading:false,imageRepairing:false,imageFailed:false,imageMessage:''});
  }catch(e){if(seq===this._sequence)this.patchImage(key,{imageLoading:false,imageRepairing:false,imageFailed:true,imageMessage:e instanceof Error?e.message:'暂未补好图片，点击图片重试'})}
 },
 patchImage(key:string,patch:Partial<CollectionItem>){const index=this.data.items.findIndex(i=>i.dishFingerprint===key);if(index>=0){const item={...this.data.items[index],...patch};this.setData({['items['+index+']']:item});if(this.data.mode==='RECIPE'&&this.data.detailKey===key)this.displayImage(item)}},
 displayImage(item:CollectionItem){this.setData({imagePath:item.imagePath,imageGenerating:item.imageRepairing&&item.imageLoading,imageStatus:item.imageFailed?'FAILED':item.imageLoading?'LOADING':'READY',imageMessage:item.imageMessage||(item.imageLoading?(item.imageRepairing?'补图中…':'图片加载中…'):'')})},
 openRecipe(e:WechatMiniprogram.TouchEvent){const key=String(e.currentTarget.dataset.key);this.dismissConfirmation();if(this.data.loading||this.data.errorMessage||this.data.busy===key||!this.data.items.some(i=>i.dishFingerprint===key))return;openPage('/pages/diet-favorites/diet-favorites?subjectId='+encodeURIComponent(this.data.subjectId)+'&recipe='+encodeURIComponent(key))},
 async loadDetail(key:string,seq:number){const epoch=++this._detailEpoch,subject=this.data.subjectId;this.setData({detailLoading:true,recipe:null});try{
  const value=await request<CollectionItem&{consentVersion:string}>('/subjects/'+subject+'/diet-collections/'+key);
  if(seq!==this._sequence||epoch!==this._detailEpoch||this.data.mode!=='RECIPE'||this.data.detailKey!==key||subject!==this.data.subjectId)return;
  const previous=this.data.items.find(i=>i.dishFingerprint===key),file=value.imageUrl?cachedPrivateCollectionImage(value.imageUrl):'';
  const item={...value,imagePath:file,imageLoading:!file,imageRepairing:!file&&!value.imageUrl,imageFailed:false,imageMessage:''};
  if(previous&&previous.imageId===value.imageId&&previous.imageUrl===value.imageUrl){Object.assign(item,{imagePath:previous.imagePath,imageLoading:previous.imageLoading,imageRepairing:previous.imageRepairing,imageFailed:previous.imageFailed,imageMessage:previous.imageMessage})}
  const index=this.data.items.findIndex(i=>i.dishFingerprint===key);if(index<0)this.setData({items:[...this.data.items,item]});else this.setData({['items['+index+']']:item});
  this.setData({recipe:value.recipe,consentVersion:value.consentVersion,errorMessage:''});this.displayImage(item);if(!item.imagePath&&!previous)void this.loadImage(key,seq);
 }catch(e){if(seq===this._sequence&&epoch===this._detailEpoch&&this.data.mode==='RECIPE')this.setData({recipe:null,errorMessage:e instanceof Error?e.message:'菜品暂未加载'})}finally{if(seq===this._sequence&&epoch===this._detailEpoch)this.setData({detailLoading:false})}},
 retryDetail(){void this.loadDetail(this.data.detailKey,this._sequence)},
 openImageViewer(){this.dismissConfirmation();void this.viewImage({currentTarget:{dataset:{key:this.data.detailKey}}} as unknown as WechatMiniprogram.TouchEvent)},
 retryImage(){void this.loadImage(this.data.detailKey,this._sequence)},
 toggleRecipeInfo(){this.setData({showRecipeInfo:!this.data.showRecipeInfo})},
 dismissConfirmation(){if(this.data.confirming)this.setData({confirming:''})},
 requestRemove(e:WechatMiniprogram.TouchEvent){const key=String(e.currentTarget.dataset.key);if(!this.data.busy&&this.data.items.some(i=>i.dishFingerprint===key))this.setData({confirming:key})},
 keepRemove(){this.dismissConfirmation()},
 async viewImage(e:WechatMiniprogram.TouchEvent){
  this.dismissConfirmation();const key=String(e.currentTarget.dataset.key),seq=this._sequence;let item=this.data.items.find(i=>i.dishFingerprint===key);if(!item||item.imageLoading)return;
  if(!item.imagePath){await this.loadImage(key,seq);if(seq!==this._sequence)return;item=this.data.items.find(i=>i.dishFingerprint===key)}
  if(item?.imagePath)wx.previewImage({current:item.imagePath,urls:[item.imagePath]});
 },
 async confirmRemove(e:WechatMiniprogram.TouchEvent){const fingerprint=String(e.currentTarget.dataset.key),subject=this.data.subjectId,seq=this._sequence;if(!subject||this.data.busy||this.data.confirming!==fingerprint)return;this.setData({busy:fingerprint,confirming:''});try{await request('/subjects/'+subject+'/diet-collections/remove',{method:'POST',data:{dishFingerprint:fingerprint}});if(seq===this._sequence&&subject===this.data.subjectId)this.setData({items:this.data.items.filter(i=>i.dishFingerprint!==fingerprint)})}catch(e){if(seq===this._sequence&&subject===this.data.subjectId)wx.showToast({title:e instanceof Error?e.message:'取消收藏暂未完成',icon:'none'})}finally{if(seq===this._sequence)this.setData({busy:''})}},
 goBack(){this.dismissConfirmation();if(this.data.mode==='RECIPE')backTo('/pages/diet-favorites/diet-favorites',this);else backPage('/pages/profile/profile',this)}
})
