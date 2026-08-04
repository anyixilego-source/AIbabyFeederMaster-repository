Component({
  data: {
    score: 88,
    nutrients: [
      { name: '蛋白质', value: 90, state: '充足', color: '#73c959' },
      { name: '钙', value: 85, state: '充足', color: '#73c959' },
      { name: '维生素', value: 80, state: '充足', color: '#73c959' },
      { name: '膳食纤维', value: 60, state: '偏低', color: '#f6a623' }
    ],
    advice: [
      { tone: 'protein', badge: '蛋', title: '适量补充优质蛋白', description: '可添加牛肉、鱼肉、鸡肉等，帮助宝宝成长' },
      { tone: 'vegetable', badge: '菜', title: '增加绿色蔬菜摄入', description: '如西兰花、菠菜等，补充维生素和矿物质' },
      { tone: 'grain', badge: '谷', title: '尝试多样化主食', description: '可搭配南瓜、红薯等粗粮，促进肠道健康' }
    ]
  },
  methods: {
    openCamera() { wx.navigateTo({ url: '/pages/camera/camera' }) },
    openReport() { wx.redirectTo({ url: '/pages/report/report' }) },
    openProfile() { wx.redirectTo({ url: '/pages/profile/profile' }) },
    showNotice() { wx.showToast({ title: '今天没有新的提醒', icon: 'none' }) }
  }
})
