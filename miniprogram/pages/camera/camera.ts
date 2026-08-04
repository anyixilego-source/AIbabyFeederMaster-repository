Page({
  data: { cameraEnabled: false, cameraError: false, tipVisible: true, flash: 'off' as 'auto'|'on'|'off', position: 'back' as 'back'|'front' },
  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/index/index' }) }) },
  dismissTip() { this.setData({ tipVisible: false }) },
  chooseAlbum() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'], success: (res) => { wx.setStorageSync('mealPhoto', res.tempFiles[0].tempFilePath); wx.navigateTo({ url: '/pages/result/result' }) } })
  },
  capture() {
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
