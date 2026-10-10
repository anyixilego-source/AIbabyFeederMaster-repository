import { navigateRoot } from '../../utils/navigation'
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
        report: '/pages/report-overview/report-overview',
        profile: '/pages/profile/profile'
      }
      const url = routes[key]
      if (url) navigateRoot(url)
    }
  }
})
