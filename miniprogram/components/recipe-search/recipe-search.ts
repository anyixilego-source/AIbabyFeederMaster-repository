Component({
  properties: { recipeName: { type: String, value: '' } },
  data: { searchTerm: '' },
  observers: {
    recipeName(name: string) {
      const value = (name || '').trim()
      this.setData({ searchTerm: value ? value + ' 做法' : '' })
    }
  },
  methods: {
    copySearchTerm() {
      if (!this.data.searchTerm) return
      wx.setClipboardData({
        data: this.data.searchTerm,
        success() { wx.showToast({ title: '已复制', icon: 'success', duration: 1500 }) },
        fail() { wx.showToast({ title: '复制未完成，请重试', icon: 'none', duration: 1500 }) }
      })
    }
  }
})
