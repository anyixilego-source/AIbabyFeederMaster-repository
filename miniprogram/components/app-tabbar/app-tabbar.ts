Component({
  properties: {
    active: { type: String, value: 'home' },
    showCamera: { type: Boolean, value: false }
  },
  methods: {
    open(event: WechatMiniprogram.TouchEvent) {
      const key = event.currentTarget.dataset.key
      const routes: Record<string, string> = {
        home: '/pages/index/index',
        records: '/pages/records/records',
        camera: '/pages/camera/camera',
        report: '/pages/report/report',
        profile: '/pages/profile/profile'
      }
      const url = routes[key]
      if (!url || key === this.data.active) return
      wx.redirectTo({ url })
    }
  }
})
