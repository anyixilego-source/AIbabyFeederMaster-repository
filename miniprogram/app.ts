import { ensureSessionContext } from './utils/session'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    this.globalData.ready = ensureSessionContext().then((context) => {
      this.globalData.householdId = context.householdId || undefined
      this.globalData.subjectId = context.subjectId || undefined
      return context
    })
  },
})
