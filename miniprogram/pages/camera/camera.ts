import { ApiError, request } from '../../utils/api'
import { completeOperation, getPendingOperation, operationPayload } from '../../utils/operation'
import { ensureSessionContext, SessionContext } from '../../utils/session'

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

Page({
  data: {
    cameraEnabled: false, cameraError: false, tipVisible: true, preparing: false, preparationError: '', pendingPhoto: '',
    flash: 'off' as 'auto'|'on'|'off', position: 'back' as 'back'|'front',
  },
  onLoad() { void this.discardPendingMeal() },
  onUnload() { void this.discardPendingMeal() },
  async continueWithPhoto(photoPath: string) {
    if (this.data.preparing) return
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
          mealType: 'OTHER', occurredAt: new Date().toISOString(), notes: '拍照记录',
        })
        const meal = await request<{ mealId: string }>(`/subjects/${active.subjectId}/meals`, { method: 'POST', data: payload })
        completeOperation(scope, payload.operationId)
        mealId = meal.mealId
        wx.setStorageSync('foodmaster.currentMealId', mealId)
      }
      wx.setStorageSync('mealPhoto', photoPath)
      this.setData({ pendingPhoto: '' })
      wx.navigateTo({ url: '/pages/result/result' })
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '餐食记录准备失败'
      this.setData({ preparationError: `${message}，请重新选择图片`, pendingPhoto: photoPath })
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ preparing: false }) }
  },
  readyForPhoto(): boolean {
    if (this.data.preparing) { wx.showToast({ title: '正在创建餐食记录', icon: 'none' }); return false }
    return true
  },
  async discardPendingMeal() {
    const mealId = wx.getStorageSync('foodmaster.currentMealId') as string | undefined
    if (!mealId) return
    wx.removeStorageSync('foodmaster.currentMealId')
    try {
      const meal = await request<{ status: string }>(`/meals/${mealId}`)
      if (meal.status === 'DRAFT') await request(`/meals/${mealId}`, { method: 'DELETE', data: { reason: '照护者放弃未保存的拍照记录' } })
    } catch (_caught) {
      // 放弃清理失败不阻断离开页面；服务端草稿不会进入已确认摄入。
    }
  },
  goBack() { void this.discardPendingMeal(); wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/index/index' }) }) },
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
