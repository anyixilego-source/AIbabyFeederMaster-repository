Page({
  data: {
    saved: false,
    dates: [
      { week: '日', day: 21 }, { week: '一', day: 22 }, { week: '二', day: 23 }, { week: '三', day: 24 },
      { week: '四', day: 25 }, { week: '五', day: 26 }, { week: '六', day: 27, active: true }
    ],
    meals: [
      { type: '早餐', time: '08:30', name: '南瓜小米粥', ingredients: '南瓜、小米', tags: ['碳水化合物','维生素A'], tone: 'day', position: '30% center' },
      { type: '午餐', time: '12:00', name: '牛肉西兰花饭', ingredients: '牛肉、西兰花、胡萝卜、大米', tags: ['优质蛋白','铁'], tone: 'day', position: '68% center' },
      { type: '晚餐', time: '18:30', name: '南瓜小米粥', ingredients: '南瓜、小米', tags: ['碳水化合物','维生素A'], tone: 'night', position: '50% center' },
      { type: '加餐', time: '15:30', name: '香蕉泥', ingredients: '香蕉', tags: ['膳食纤维'], tone: 'snack', position: '82% center' }
    ]
  },
  onLoad(query: Record<string,string>) { if (query.saved === '1' || wx.getStorageSync('mealSaved')) this.setData({ saved: true }) },
  goBack() { wx.redirectTo({ url: '/pages/index/index' }) },
  addMeal() { wx.navigateTo({ url: '/pages/camera/camera' }) },
  openReport() { wx.redirectTo({ url: '/pages/report/report' }) },
  chooseDate(event: WechatMiniprogram.TouchEvent) { const day = Number(event.currentTarget.dataset.day); this.setData({ dates: this.data.dates.map((item) => ({ ...item, active: item.day === day })) }) },
  closeSaved() { this.setData({ saved: false }); wx.removeStorageSync('mealSaved') }
})
