import {startFamilySync,stopFamilySync,purgeSharedPhotoCache} from './utils/family-sync'
import { ensureSessionContext } from './utils/session'
import { cleanupExpiredLocalImages } from './utils/image-retention'
import { abandonCurrentMeal, discardAbandonedMeals } from './utils/pending-meal'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    purgeSharedPhotoCache()
    cleanupExpiredLocalImages()
    // 冷启动不恢复上次未保存的识别；失败的清理请求会在后续启动时重试。
    abandonCurrentMeal()
    const ready = ensureSessionContext().then((context) => {
      this.globalData.householdId = context.householdId || undefined
      this.globalData.subjectId = context.subjectId || undefined
      startFamilySync()
      void discardAbandonedMeals()
      return context
    }).catch((error: unknown) => {
      if (this.globalData.ready === ready) this.globalData.ready = undefined
      throw error
    })
    this.globalData.ready = ready
  },
  onHide(){stopFamilySync()},
  onShow() {
    startFamilySync()
    void (this.globalData.ready || ensureSessionContext()).then(() => discardAbandonedMeals()).catch(() => {})
  },
})
