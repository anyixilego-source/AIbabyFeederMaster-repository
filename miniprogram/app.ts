import { ensureSessionContext } from './utils/session'
import { cleanupExpiredLocalImages } from './utils/image-retention'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    cleanupExpiredLocalImages()
    const ready = ensureSessionContext().then((context) => {
      this.globalData.householdId = context.householdId || undefined
      this.globalData.subjectId = context.subjectId || undefined
      return context
    }).catch((error: unknown) => {
      if (this.globalData.ready === ready) this.globalData.ready = undefined
      throw error
    })
    this.globalData.ready = ready
  },
})
