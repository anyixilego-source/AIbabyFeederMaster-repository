import {canRecordBaby} from '../../utils/family-state'
import { defaultMealType } from '../../utils/meal-presentation'
import {openPage,backPage,resumePendingPrimary} from '../../utils/navigation'
import { ApiError, request } from '../../utils/api'
import { completeOperation, getPendingOperation, operationPayload } from '../../utils/operation'
import { ensureSessionContext, SessionContext } from '../../utils/session'
import { abandonCurrentMeal, discardAbandonedMeals } from '../../utils/pending-meal'

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

Page({
  data: {
    cameraEnabled: false, cameraError: false, tipVisible: true, preparing: false, preparationError: '', pendingPhoto: '',
    flash: 'off' as 'auto'|'on'|'off', position: 'back' as 'back'|'front',
  },
  onShow() { resumePendingPrimary(this) },
  _manualEntryPending:false,_manualEntryAlive:true,
  onLoad(query:Record<string,string>) {
    if(!canRecordBaby()){wx.showToast({title:'当前为仅查看权限',icon:'none'});backPage('/pages/records/records',this);return}
    this._manualEntryPending=query.entry==='manual'
    void this.discardPendingMeal().then(()=>{if(this._manualEntryPending)this.launchManualEntry()})
  },
  launchManualEntry(){
    if(!this._manualEntryAlive||!this._manualEntryPending)return
    // Wait for the existing navigation transition before reusing the manual flow.
    if(getApp<{_navigation?:{navigating:boolean}}>()._navigation?.navigating){setTimeout(()=>this.launchManualEntry(),50);return}
    this.startManualRecord()
  },
  onHide() { this._manualEntryPending=false },
  onUnload() { this._manualEntryAlive=false;this._manualEntryPending=false;void this.discardPendingMeal() },
  async continueWithPhoto(photoPath: string) {
    if (this.data.preparing) return
    const recordedAt = new Date()
    this.setData({ preparing: true, preparationError: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      let mealId = wx.getStorageSync('foodmaster.currentMealId') as string | undefined
      const existingMealId = mealId
      if (existingMealId) {
        try {
          const meal = await request<{ status: string }>(`/meals/${existingMealId}`)
          if (meal.status !== 'DRAFT') {
            wx.removeStorageSync('foodmaster.currentMealId')
            mealId = undefined
          }
        } catch (caught) {
          if (!(caught instanceof ApiError) || caught.statusCode === 0) throw caught
          wx.removeStorageSync('foodmaster.currentMealId')
          mealId = undefined
        }
      }
      if (!mealId) {
        const scope = `create-meal:${active.subjectId}`
        const payload = getPendingOperation(scope) || operationPayload(scope, {
          mealType: defaultMealType(recordedAt), occurredAt: recordedAt.toISOString(), notes: photoPath ? '拍照记录' : '手工记录',
        })
        const meal = await request<{ mealId: string }>(`/subjects/${active.subjectId}/meals`, { method: 'POST', data: payload })
        completeOperation(scope, payload.operationId)
        mealId = meal.mealId
        wx.setStorageSync('foodmaster.currentMealId', mealId)
      }
      if(photoPath)wx.setStorageSync('mealPhoto', photoPath);else wx.removeStorageSync('mealPhoto')
      wx.setStorageSync('foodmaster.manualEntry', !photoPath)
      this.setData({ pendingPhoto: '' })
      openPage('/pages/result/result',{
        fail: (error) => {
          this.setData({ preparationError: `无法打开识别页：${error.errMsg}` })
          wx.showToast({ title: '无法打开识别页，请重试', icon: 'none' })
        },
      })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '餐食记录准备失败'
      this.setData({ preparationError: `${message}，请重试新增记录`, pendingPhoto: photoPath })
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ preparing: false }) }
  },
  startManualRecord() { this._manualEntryPending=false;void this.continueWithPhoto('') },
  readyForPhoto(): boolean {
    if (this.data.preparing) { wx.showToast({ title: '正在创建餐食记录', icon: 'none' }); return false }
    return true
  },
  async discardPendingMeal() {
    abandonCurrentMeal()
    await discardAbandonedMeals()
  },
  goBack() { void this.discardPendingMeal(); backPage('/pages/index/index',this) },
  dismissTip() { this.setData({ tipVisible: false }) },
  chooseAlbum() {
    if (!this.readyForPhoto()) return
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'], success: (res) => { void this.continueWithPhoto(res.tempFiles[0].tempFilePath) } })
  },
  capture() {
    if (!this.readyForPhoto()) return
    if (!this.data.cameraEnabled) {
      wx.authorize({
        scope: 'scope.camera',
        success: () => { this.setData({ cameraEnabled: true, cameraError: false }); wx.showToast({ title: '相机已启用，请再次拍照', icon: 'none' }) },
        fail: () => this.setData({ cameraError: true })
      })
      return
    }
    wx.createCameraContext().takePhoto({ quality: 'high', success: (res) => { void this.continueWithPhoto(res.tempImagePath) }, fail: () => wx.showToast({ title: '拍摄失败，请从相册选择', icon: 'none' }) })
  },
  toggleFlash() { this.setData({ flash: this.data.flash === 'off' ? 'on' : 'off' }) },
  switchCamera() { this.setData({ position: this.data.position === 'back' ? 'front' : 'back' }) },
  openSettings() { wx.openSetting({ success: (res) => this.setData({ cameraEnabled: !!res.authSetting['scope.camera'], cameraError: !res.authSetting['scope.camera'] }) }) },
  cameraFailed() { this.setData({ cameraError: true, cameraEnabled: false }) }
})
