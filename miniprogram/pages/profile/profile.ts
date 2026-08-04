Page({
  data: {
    editing: false,
    basic: [
      { tone: 'coral', badge: '性', label: '性别', value: '女宝宝' }, { tone: 'green', badge: '生', label: '出生日期', value: '2023-09-03' },
      { tone: 'yellow', badge: '龄', label: '月龄', value: '10个月23天' }, { tone: 'blue', badge: '血', label: '血型（选填）', value: 'A型' }
    ],
    health: [
      { tone: 'purple', badge: '敏', label: '过敏信息', value: '暂无过敏', good: true }, { tone: 'orange', badge: '忌', label: '不适食用', value: '暂无' },
      { tone: 'green', badge: '注', label: '备注信息', value: '添加备注' }
    ]
  },
  goBack() { wx.redirectTo({ url: '/pages/index/index' }) },
  toggleEdit() { this.setData({ editing: !this.data.editing }); wx.showToast({ title: this.data.editing ? '已进入编辑状态' : '档案已保存', icon: 'none' }) },
  editItem(event: WechatMiniprogram.TouchEvent) { if (!this.data.editing) return; wx.showActionSheet({ itemList: ['修改此项', '暂时清空'], success: () => wx.showToast({ title: `正在编辑${event.currentTarget.dataset.label}`, icon: 'none' }) }) },
  changeAvatar() { wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album','camera'], success: () => wx.showToast({ title: '头像已更新', icon: 'success' }) }) }
})
