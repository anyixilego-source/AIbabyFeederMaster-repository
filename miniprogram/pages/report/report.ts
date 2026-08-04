Page({
  data: {
    nutrients: [
      { name: '蛋白质', badge: '蛋', value: 90, status: '充足', color: '#73c959' }, { name: '铁', badge: 'Fe', value: 60, status: '偏低', color: '#f6a623' },
      { name: '钙', badge: 'Ca', value: 85, status: '充足', color: '#73c959' }, { name: '维生素A', badge: 'A', value: 80, status: '充足', color: '#73c959' },
      { name: '维生素C', badge: 'C', value: 95, status: '充足', color: '#73c959' }, { name: '膳食纤维', badge: '纤', value: 55, status: '偏低', color: '#f6a623' }
    ],
    highlights: [
      { title: '蛋白质来源丰富', desc: '摄入了牛肉、鸡蛋等优质蛋白' }, { title: '蔬菜种类多样', desc: '摄入了3种不同颜色的蔬菜' }, { title: '碳水搭配合理', desc: '谷物、薯类搭配均衡' }
    ],
    recommendations: [
      { badge: '铁', tone: 'protein', title: '增加铁来源', desc: '推荐食材：牛肉、猪肝、强化铁米粉' },
      { badge: '纤', tone: 'vegetable', title: '补充膳食纤维', desc: '推荐食材：燕麦、红薯、西兰花' },
      { badge: '脂', tone: 'fat', title: '优质脂肪', desc: '可适量添加牛油果、鳕鱼等' }
    ]
  },
  goBack() { wx.redirectTo({ url: '/pages/index/index' }) },
  share() { wx.showShareMenu({ menus: ['shareAppMessage','shareTimeline'] }); wx.showToast({ title: '可使用右上角菜单分享', icon: 'none' }) },
  openRecords() { wx.redirectTo({ url: '/pages/records/records' }) },
  onShareAppMessage() { return { title: '小米的每日营养报告', path: '/pages/report/report' } }
})
