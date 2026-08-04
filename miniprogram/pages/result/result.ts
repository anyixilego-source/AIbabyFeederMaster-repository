Page({
  data: {
    photo: '/assets/home-banner-cropped.png', samplePhoto: true, saving: false,
    foods: [
      { badge: '肉', name: '牛肉碎', amount: '40g', tone: 'protein' },
      { badge: '米', name: '米饭', amount: '80g', tone: 'grain' },
      { badge: '蛋', name: '鸡蛋', amount: '30g', tone: 'egg' },
      { badge: '菜', name: '西兰花', amount: '20g', tone: 'vegetable' },
      { badge: '蔬', name: '胡萝卜', amount: '15g', tone: 'carrot' }
    ],
    nutrition: [
      { name: '热量', badge: '热', value: '320 kcal', tone: 'heat' }, { name: '蛋白质', badge: '蛋', value: '18.6 g', tone: 'protein' },
      { name: '脂肪', badge: '脂', value: '8.2 g', tone: 'fat' }, { name: '碳水化合物', badge: '碳', value: '39.5 g', tone: 'grain' },
      { name: '铁', badge: 'Fe', value: '2.1 mg', tone: 'mineral' }, { name: '钙', badge: 'Ca', value: '85 mg', tone: 'mineral' }
    ]
  },
  onLoad() { const photo = wx.getStorageSync('mealPhoto'); if (photo && !String(photo).startsWith('/assets/')) this.setData({ photo, samplePhoto: false }) },
  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/camera/camera' }) }) },
  retry() { wx.navigateBack({ delta: 1, fail: () => wx.redirectTo({ url: '/pages/camera/camera' }) }) },
  editFood() { wx.showActionSheet({ itemList: ['调整食材名称', '调整估算重量', '添加遗漏食材'], success: () => wx.showToast({ title: '已进入手动调整状态', icon: 'none' }) }) },
  save() {
    if (this.data.saving) return
    this.setData({ saving: true }); wx.setStorageSync('mealSaved', true)
    setTimeout(() => wx.redirectTo({ url: '/pages/records/records?saved=1' }), 450)
  }
})
