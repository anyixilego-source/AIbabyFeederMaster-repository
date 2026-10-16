import {backPage} from '../../utils/navigation'
import { ApiError, getAuth, request, uploadFeedbackImage } from '../../utils/api'

interface Picture { key: string; path: string; attachmentId: string; state: string; error: string }
interface FeedbackModule {code:string;name:string;children?:FeedbackModule[]}
interface Payload { operationId: string; description: string; contact: string; attachmentIds: string[];moduleCode?:string;context?:{appVersion:string;environment:string;pagePath:string} }
interface Receipt { feedbackId: string; receipt: string; remaining: number }
function operationId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => { const r = Math.floor(Math.random() * 16); return (token === 'x' ? r : (r & 3) | 8).toString(16) })
}
function message(error: unknown): string { return error instanceof ApiError ? (error.statusCode === 401 ? '请先登录后提交反馈' : error.message) : '操作未完成，请重试' }

Page({
  data: { showPrivacyInfo:false,showSuccessInfo:false,showModulePicker:false,moduleCode:'',moduleLabel:'',modules:[] as FeedbackModule[],moduleOptions:[] as FeedbackModule[],moduleTrail:[] as FeedbackModule[],moduleError:'', description: '', contact: '', count: 0, pictures: [] as Picture[], remaining: -1, saving: false, selecting: false, uncertain: false, errorMessage: '', receipt: '', feedbackId: '' },
  _pending: null as Payload | null,
  _alive: true,
  onLoad() { this._alive = true; void this.loadQuota();void this.loadModules() },
  onUnload() { this._alive = false; wx.disableAlertBeforeUnload() },
  async loadQuota() {
    try {
      if (!getAuth()) { this.setData({ errorMessage: '请先登录后提交反馈' }); return }
      const quota = await request<{ remaining: number }>('/feedback/quota')
      if (this._alive) this.setData({ remaining: quota.remaining, errorMessage: '' })
    } catch (error) { if (this._alive) this.setData({ errorMessage: error instanceof ApiError && error.statusCode === 404 ? '当前服务尚未开放意见反馈，请稍后再试' : message(error) }) }
  },
  async loadModules(){try{const value=await request<{modules:FeedbackModule[]}>('/feedback/modules');if(this._alive)this.setData({modules:value.modules,moduleOptions:value.modules,moduleError:''})}catch{if(this._alive)this.setData({moduleError:'功能位置暂不可选，仍可提交文字反馈。'})}},
  openModulePicker(){if(!this.data.saving&&!this.data.uncertain&&this.data.modules.length)this.setData({showModulePicker:true,moduleTrail:[],moduleOptions:this.data.modules})},
  closeModulePicker(){this.setData({showModulePicker:false})},stopModuleTap(){},
  chooseModule(e:WechatMiniprogram.TouchEvent){if(this.data.saving||this.data.uncertain)return;const selected=this.data.moduleOptions.find(n=>n.code===e.currentTarget.dataset.code);if(!selected)return;const path=[...this.data.moduleTrail,selected];this.setData({moduleTrail:path,moduleOptions:selected.children||[]});if(!selected.children?.length)this.commitModule()},
  moduleLevel(e:WechatMiniprogram.TouchEvent){const index=Number(e.currentTarget.dataset.index);if(!Number.isInteger(index)||index< -1||index>=this.data.moduleTrail.length)return;const trail=this.data.moduleTrail.slice(0,index+1);this.setData({moduleTrail:trail,moduleOptions:trail.length?trail[trail.length-1].children||[]:this.data.modules})},
  commitModule(){if(this.data.saving||this.data.uncertain||!this.data.moduleTrail.length)return;this.setData({moduleCode:this.data.moduleTrail[this.data.moduleTrail.length-1].code,moduleLabel:this.data.moduleTrail.map(n=>n.name).join(' › '),showModulePicker:false});this.warnExit()},
  clearModule(){if(!this.data.saving&&!this.data.uncertain){this.setData({moduleCode:'',moduleLabel:''});this.warnExit()}},
  feedbackContext(){const account=wx.getAccountInfoSync().miniProgram;return {appVersion:account.version||'development-preview',environment:account.envVersion,pagePath:'pages/feedback/feedback'}},
  warnExit() {
    if (this.data.description.trim() || this.data.contact.trim() || this.data.pictures.length || this.data.moduleCode) wx.enableAlertBeforeUnload({ message: '有内容尚未提交，退出后需要重新填写。' })
    else wx.disableAlertBeforeUnload()
  },
  onDescription(event: WechatMiniprogram.Input) {
    if (this.data.saving || this.data.uncertain) return
    this.setData({ description: event.detail.value, count: Array.from(event.detail.value).length }); this.warnExit()
  },
  onContact(event: WechatMiniprogram.Input) { if (!this.data.saving && !this.data.uncertain) { this.setData({ contact: event.detail.value }); this.warnExit() } },
  async choosePictures() {
    if (this.data.saving || this.data.uncertain || this.data.selecting || this.data.pictures.length >= 6) return
    this.setData({ selecting: true })
    try {
      const media = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve, reject) => wx.chooseMedia({ count: 6 - this.data.pictures.length, mediaType: ['image'], sourceType: ['album'], success: resolve, fail: reject }))
      const added: Picture[] = []
      for (const image of media.tempFiles) {
        let filePath = image.tempFilePath
        try { filePath = await new Promise<string>((resolve, reject) => wx.compressImage({ src: filePath, quality: 75, success: value => resolve(value.tempFilePath), fail: reject })) } catch { /* Validate the original if compression is unsupported. */ }
        const size = await new Promise<number>((resolve, reject) => wx.getFileSystemManager().getFileInfo({ filePath, success: value => resolve(value.size), fail: reject }))
        if (size > 5 * 1024 * 1024) { wx.showToast({ title: '单张图片超过5MiB，请压缩后选择', icon: 'none' }); continue }
        added.push({ key: operationId(), path: filePath, attachmentId: '', state: '待上传', error: '' })
      }
      if (this._alive) { this.setData({ pictures: this.data.pictures.concat(added).slice(0, 6) }); this.warnExit() }
    } catch (error) { if (!String((error as { errMsg?: string }).errMsg || '').includes('cancel') && this._alive) this.setData({ errorMessage: '选择图片未完成，请重试' }) }
    finally { if (this._alive) this.setData({ selecting: false }) }
  },
  preview(event: WechatMiniprogram.BaseEvent) { const path = event.currentTarget.dataset.path as string; wx.previewImage({ current: path, urls: this.data.pictures.map(image => image.path) }) },
  removePicture(event: WechatMiniprogram.BaseEvent) {
    if (this.data.saving || this.data.uncertain) return
    this.setData({ pictures: this.data.pictures.filter(image => image.key !== event.currentTarget.dataset.key) }); this.warnExit()
  },
  async uploadOne(key: string) {
    const picture = this.data.pictures.find(image => image.key === key); if (!picture || picture.attachmentId) return
    const update = (values: Partial<Picture>) => { if (this._alive) this.setData({ pictures: this.data.pictures.map(image => image.key === key ? { ...image, ...values } : image) }) }
    update({ state: '上传中', error: '' })
    try { const result = await uploadFeedbackImage<{ attachmentId: string }>(picture.path, picture.key); update({ state: '已上传', attachmentId: result.attachmentId }) }
    catch (error) { update({ state: '上传失败', error: message(error) }); throw error }
  },
  async retryPicture(event: WechatMiniprogram.BaseEvent) {
    if (this.data.saving || this.data.uncertain) return
    this.setData({ saving: true }); try { await this.uploadOne(event.currentTarget.dataset.key as string) } catch (error) { this.setData({ errorMessage: message(error) }) } finally { if (this._alive) this.setData({ saving: false }) }
  },
  async submit() {
    if (this.data.saving || this.data.selecting) return
    const description = this.data.description.trim(), contact = this.data.contact.trim()
    if (!this._pending && (!description || Array.from(description).length > 2000)) { this.setData({ errorMessage: '请填写1～2000字的反馈内容' }); return }
    if (!this._pending && Array.from(contact).length > 100) { this.setData({ errorMessage: '联系方式不能超过100字' }); return }
    this.setData({ saving: true, errorMessage: '' })
    try {
      if (!this._pending) {
        for (const image of this.data.pictures) { await this.uploadOne(image.key); if (!this._alive) return }
        if (this.data.pictures.some(image => !image.attachmentId)) throw new Error('图片尚未上传')
        this._pending = { operationId: operationId(), description, contact, attachmentIds: this.data.pictures.map(image => image.attachmentId),moduleCode:this.data.moduleCode||undefined,context:this.feedbackContext() }
      }
      const receipt = await request<Receipt>('/feedback', { method: 'POST', data: this._pending })
      if (!this._alive) return
      this._pending = null; wx.disableAlertBeforeUnload()
      this.setData({ receipt: receipt.receipt, feedbackId: receipt.feedbackId, remaining: receipt.remaining, uncertain: false, description: '', contact: '', pictures: [], count: 0,moduleCode:'',moduleLabel:'',moduleTrail:[],showModulePicker:false })
    } catch (error) {
      if (!this._alive) return
      const uncertain = !!this._pending && (!(error instanceof ApiError) || error.statusCode === 0 || error.statusCode >= 500)
      if (!uncertain) this._pending = null
      // Definitively rejected/expired attachments must be uploaded again under new IDs.
      if (!uncertain && error instanceof ApiError && error.statusCode === 400) this.setData({ pictures: this.data.pictures.map(image => ({ ...image, key: operationId(), attachmentId: '', state: '待上传', error: '' })) })
      this.setData({ uncertain, errorMessage: uncertain ? '提交结果尚未确定，请点击“核对提交结果”。核对前内容保持不变，避免重复提交。' : message(error) })
      this.warnExit(); void this.loadQuotaAfterError()
    } finally { if (this._alive) this.setData({ saving: false }) }
  },
  async loadQuotaAfterError() { try { const q = await request<{ remaining: number }>('/feedback/quota'); if (this._alive) this.setData({ remaining: q.remaining }) } catch { /* Preserve the actionable submission/upload error. */ } },
  togglePrivacyInfo(){this.setData({showPrivacyInfo:!this.data.showPrivacyInfo})},
  toggleSuccessInfo(){this.setData({showSuccessInfo:!this.data.showSuccessInfo})},
  again() { this.setData({ receipt: '', feedbackId: '', errorMessage: '' }) },
  goBack() { if(this.data.showModulePicker){this.closeModulePicker();return}if (!this.data.saving && !this.data.selecting) backPage('/pages/profile/profile',this) },
})
