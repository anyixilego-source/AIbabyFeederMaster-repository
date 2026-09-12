import { ApiError, request } from '../../utils/api'
import { completeOperation, getPendingOperation, operationPayload } from '../../utils/operation'
import { ensureSessionContext, SessionContext } from '../../utils/session'

async function context(): Promise<SessionContext> {
  const app = getApp<IAppOption>()
  return app.globalData.ready || ensureSessionContext()
}

Page({
  data: {
    cameraEnabled: false, cameraError: false, tipVisible: true, preparing: false, preparationError: '',
    flash: 'off' as 'auto'|'on'|'off', position: 'back' as 'back'|'front',
  },
  onLoad() { void this.prepareMeal() },
  async prepareMeal() {
    if (this.data.preparing && !this.data.preparationError) return
    this.setData({ preparing: true, preparationError: '' })
    try {
      const active = await context()
      if (!active.subjectId) throw new Error('请先建立宝宝档案')
      const existingMealId = wx.getStorageSync('foodmaster.currentMealId') as string | undefined
      if (existingMealId) {
        try {
          const meal = await request<{ status: string }>(`/meals/${existingMealId}`)
          if (meal.status === 'DRAFT') return
          wx.removeStorageSync('foodmaster.currentMealId')
        } catch (caught) {
          if (!(caught instanceof ApiError) || caught.statusCode === 0) throw caught
          wx.removeStorageSync('foodmaster.currentMealId')
        }
      }
      const scope = `create-meal:${active.subjectId}`
      const payload = getPendingOperation(scope) || operationPayload(scope, {
        mealType: 'OTHER', occurredAt: new Date().toISOString(), notes: '拍照记录',
      })
      const meal = await request<{ mealId: string }>(`/subjects/${active.subjectId}/meals`, { method: 'POST', data: payload })
      completeOperation(scope, payload.operationId)
      wx.setStorageSync('foodmaster.currentMealId', meal.mealId)
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '餐食记录准备失败'
      this.setData({ preparationError: message })
      wx.showToast({ title: message, icon: 'none' })
    } finally { this.setData({ preparing: false }) }
  },
  readyForPhoto(): boolean {
    if (this.data.preparing) { wx.showToast({ title: '正在准备餐食记录', icon: 'none' }); return false }
    if (this.data.preparationError || !wx.getStorageSync('foodmaster.currentMealId')) {
      wx.showToast({ title: '请先重新准备餐食记录', icon: 'none' }); return false
    }
    return true
  },
  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/index/index' }) }) },
  dismissTip() { this.setData({ tipVisible: false }) },
  chooseAlbum() {
    if (!this.readyForPhoto()) return
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'], success: (res) => { wx.setStorageSync('mealPhoto', res.tempFiles[0].tempFilePath); wx.navigateTo({ url: '/pages/result/result' }) } })
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
    wx.createCameraContext().takePhoto({ quality: 'high', success: (res) => { wx.setStorageSync('mealPhoto', res.tempImagePath); wx.navigateTo({ url: '/pages/result/result' }) }, fail: () => wx.showToast({ title: '拍摄失败，请从相册选择', icon: 'none' }) })
  },
  toggleFlash() { this.setData({ flash: this.data.flash === 'off' ? 'on' : 'off' }) },
  switchCamera() { this.setData({ position: this.data.position === 'back' ? 'front' : 'back' }) },
  openSettings() { wx.openSetting({ success: (res) => this.setData({ cameraEnabled: !!res.authSetting['scope.camera'], cameraError: !res.authSetting['scope.camera'] }) }) },
  cameraFailed() { this.setData({ cameraError: true, cameraEnabled: false }) }
})
