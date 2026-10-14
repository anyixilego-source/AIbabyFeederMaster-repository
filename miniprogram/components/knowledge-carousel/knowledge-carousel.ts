interface KnowledgeItem { id: string; title: string; text: string; evidence: Array<{id: string; bookPages: string}> }
Component({
  properties: { items: { type: Array, value: [] as KnowledgeItem[] } },
  data: { current: 0, slideHeight: 160, visible: true, touching: false, attached: false, measurement: 0 },
  observers: {
    items() { this.setData({ current: 0, touching: false }); this.measureSlides() }
  },
  lifetimes: {
    ready() { this.data.attached = true; this.measureSlides() },
    detached() { this.data.attached = false; ++this.data.measurement }
  },
  pageLifetimes: {
    show() { this.setData({ visible: true, touching: false }); this.measureSlides() },
    hide() { this.setData({ visible: false, touching: false }) },
    resize() { this.measureSlides() }
  },
  methods: {
    slideChanged(e: WechatMiniprogram.CustomEvent<{ current: number }>) { this.setData({ current: e.detail.current }) },
    touchStarted() { this.setData({ touching: true }) },
    touchEnded() { this.setData({ touching: false }) },
    measureSlides() {
      const own = ++this.data.measurement
      if (!this.data.attached || !this.data.items.length) return
      wx.nextTick(() => {
        if (!this.data.attached || own !== this.data.measurement) return
        this.createSelectorQuery().selectAll('.knowledge-slide-content').boundingClientRect().exec(result => {
          if (!this.data.attached || own !== this.data.measurement) return
          const bounds = result[0] as Array<{ height: number }> | undefined
          if (!bounds?.length) return
          const max = Math.max(...bounds.map(rect => rect.height))
          if (max > 0) this.setData({ slideHeight: Math.max(100, Math.ceil(max) + (this.data.items.length > 1 ? 28 : 0)) })
        })
      })
    }
  }
})
